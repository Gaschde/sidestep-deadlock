import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseCsv } from "../app/lib.mjs";
import { buildOptimizerData, heroCanPurchaseItem } from "../app/optimizer.mjs";
import { carryResourceAxis, evaluateCarryPerformance } from "../app/warden-search.mjs";
import { createDeadlockDomain } from "../app/deadlock-domain.mjs";
import { normalizeMilestones } from "../app/search-milestones.mjs";
import {
  CARRY_OBJECTIVE_DAMAGE_PRIMARY_B,
  measureSoulAxisPath
} from "../app/search-objective-v1.mjs";
import {
  completeNodeBySaving,
  dedupeFuturePathHistory
} from "../app/multiobjective-search.mjs";
import { pathEndDominates } from "../app/path-end-pareto.mjs";
import { benchmarkCases } from "../benchmarks/optimizer-v1/cases.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const REFERENCE_FILE = resolve(ROOT, "benchmarks/optimizer-v1/references/baseline-v0.json");
const DEFAULT_OUTPUT = resolve(ROOT, "artifacts/search-divergence-diagnosis/results.json");
const TARGET_ID = "1f784a3fdbf1ccf4";
const WIDTH = 4;

const SWEET = Object.freeze({
  id: "carry-sweet-70-30-spec-77_5-22_5",
  damageWeight: 0.70,
  survivalWeight: 0.30,
  damageFocusWeights: Object.freeze({
    weapon: Object.freeze({ bullet: 0.775, spirit: 0.225 }),
    spirit: Object.freeze({ bullet: 0.225, spirit: 0.775 }),
    hybrid: Object.freeze({ bullet: 0.5, spirit: 0.5 })
  })
});

const AGGRESSIVE = CARRY_OBJECTIVE_DAMAGE_PRIMARY_B;

function outputPath() {
  const args = process.argv.slice(2);
  const index = args.indexOf("--output");
  return resolve(index >= 0 ? args[index + 1] : DEFAULT_OUTPUT);
}

function loadData() {
  const json = (path) => JSON.parse(readFileSync(resolve(ROOT, path), "utf8"));
  const csv = (path) => parseCsv(readFileSync(resolve(ROOT, path), "utf8"));
  return buildOptimizerData({
    coreManifest: json("data/core/manifest.json"),
    heroManifest: json("data/heroes/manifest.json"),
    items: csv("data/core/items.csv"),
    itemMechanics: csv("data/core/item_mechanics.csv"),
    upgrades: csv("data/core/item_upgrades.csv"),
    economy: json("data/core/economy.json"),
    slots: json("data/core/slots.json"),
    heroes: csv("data/heroes/heroes.csv"),
    heroStats: csv("data/heroes/hero_stats.csv"),
    abilities: csv("data/heroes/abilities.csv"),
    abilityMechanics: csv("data/heroes/ability_mechanics.csv"),
    heroResources: csv("data/heroes/hero_resources.csv")
  });
}

function pathId(events) {
  return createHash("sha256").update(JSON.stringify(events)).digest("hex").slice(0, 16);
}

function stableId(entry) {
  return String(entry?.id ?? entry?.serial ?? entry?.node?.serial ?? "");
}

function eventChain(node) {
  const chain = [];
  for (let current = node; current?.parent; current = current.parent) chain.push(current.event);
  return chain.reverse();
}

function nodeChain(node) {
  const chain = [];
  for (let current = node; current; current = current.parent) chain.push(current);
  return chain.reverse();
}

function transactionCount(node) {
  let count = 0;
  for (let current = node; current?.parent; current = current.parent) {
    count += Number(current.event?.type !== "save");
  }
  return count;
}

function buildFamilyRoots(data) {
  const parent = new Map(data.upgrades.map((edge) => [edge.to_item_id, edge.from_item_id]));
  const cache = new Map();
  return (id) => {
    if (cache.has(id)) return cache.get(id);
    let current = id;
    const seen = new Set();
    while (parent.has(current) && !seen.has(current)) {
      seen.add(current);
      current = parent.get(current);
    }
    cache.set(id, current);
    return current;
  };
}

function extractFront(remaining) {
  const front = remaining.filter((candidate, index) =>
    !remaining.some((other, otherIndex) => otherIndex !== index && pathEndDominates(other, candidate))
  );
  front.sort((a, b) => stableId(a).localeCompare(stableId(b)));
  const selected = new Set(front);
  for (let index = remaining.length - 1; index >= 0; index -= 1) {
    if (selected.has(remaining[index])) remaining.splice(index, 1);
  }
  return front;
}

function partialLayerSelection(layer, capacity, diversityKey) {
  const sorted = (array, compare) => array.sort(compare);
  if (capacity <= 0) return { selected: [], reasons: new Map() };
  if (layer.length <= capacity) {
    const selected = sorted([...layer], (a, b) => stableId(a).localeCompare(stableId(b)));
    return { selected, reasons: new Map(selected.map((entry) => [entry, "full-layer"])) };
  }

  const selected = [];
  const selectedSet = new Set();
  const reasons = new Map();
  const add = (entry, reason) => {
    if (entry && selected.length < capacity && !selectedSet.has(entry)) {
      selected.push(entry);
      selectedSet.add(entry);
      reasons.set(entry, reason);
    }
  };

  if (capacity === 1) {
    add(sorted([...layer], (a, b) => stableId(a).localeCompare(stableId(b)))[0], "stable-id-capacity-1");
    return { selected, reasons };
  }

  const pathExtreme = sorted([...layer], (a, b) =>
    b.pathScore - a.pathScore || b.endScore - a.endScore || stableId(a).localeCompare(stableId(b))
  )[0];
  const endExtreme = sorted([...layer], (a, b) =>
    b.endScore - a.endScore || b.pathScore - a.pathScore || stableId(a).localeCompare(stableId(b))
  )[0];
  add(pathExtreme, "path-extreme");
  add(endExtreme, "end-extreme");

  const buckets = new Map();
  for (const entry of sorted([...layer], (a, b) => stableId(a).localeCompare(stableId(b)))) {
    if (selectedSet.has(entry)) continue;
    const key = String(diversityKey(entry.node));
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(entry);
  }

  const keys = sorted([...buckets.keys()], (a, b) => a.localeCompare(b));
  let progressed = true;
  while (selected.length < capacity && progressed) {
    progressed = false;
    for (const key of keys) {
      const bucket = buckets.get(key);
      if (bucket?.length) {
        add(bucket.shift(), "diversity-round-robin");
        progressed = true;
      }
      if (selected.length >= capacity) break;
    }
  }
  for (const entry of sorted([...layer], (a, b) => stableId(a).localeCompare(stableId(b)))) {
    add(entry, "stable-fallback");
  }
  return { selected, reasons };
}

function selectWithTrace(nodes, width, vectorFor, diversityKey) {
  const remaining = nodes.map((node) => {
    const vector = vectorFor(node);
    return { node, id: stableId(node), pathScore: vector.pathScore, endScore: vector.endScore };
  });
  const layers = [];
  let layeredCount = 0;
  while (remaining.length && layeredCount < width) {
    const front = extractFront(remaining);
    layers.push(front);
    layeredCount += front.length;
  }

  const selectedEntries = [];
  const reasons = new Map();
  let truncatedLayerIndex = null;
  for (let index = 0; index < layers.length && selectedEntries.length < width; index += 1) {
    const capacity = width - selectedEntries.length;
    const layer = layers[index];
    if (layer.length <= capacity) {
      for (const entry of layer) {
        selectedEntries.push(entry);
        reasons.set(entry.node, "full-layer");
      }
      continue;
    }
    truncatedLayerIndex = index;
    const partial = partialLayerSelection(layer, capacity, diversityKey);
    for (const entry of partial.selected) {
      selectedEntries.push(entry);
      reasons.set(entry.node, partial.reasons.get(entry));
    }
  }

  return {
    selected: selectedEntries.map((entry) => entry.node),
    layers,
    reasons,
    metadata: {
      layerSizes: layers.map((layer) => layer.length),
      truncatedLayerIndex,
      layeredCount,
      unlayeredCount: remaining.length,
      firstFrontSize: layers[0]?.length ?? 0
    }
  };
}

function exactTargetLayer(nodes, targetSerial, vectorFor) {
  const remaining = nodes.map((node) => {
    const vector = vectorFor(node);
    return { node, id: stableId(node), pathScore: vector.pathScore, endScore: vector.endScore };
  });
  let layer = 0;
  while (remaining.length) {
    const front = extractFront(remaining);
    if (front.some((entry) => entry.node.serial === targetSerial)) return layer;
    layer += 1;
  }
  return null;
}

function categoryInvestments(data, inventory) {
  const totals = { weapon: 0, vitality: 0, spirit: 0, other: 0 };
  for (const id of inventory) {
    const category = String(data.itemsById.get(id)?.category || "Other").toLowerCase();
    if (Object.hasOwn(totals, category)) totals[category] += Number(data.itemsById.get(id)?.total_cost || 0);
    else totals.other += Number(data.itemsById.get(id)?.total_cost || 0);
  }
  return totals;
}

function createRuntime(data, definition, reference, config) {
  const requested = definition.itemIds ? [...definition.itemIds] : data.items.map((item) => item.item_id);
  const legalItemIds = requested.filter((id) => heroCanPurchaseItem(data.itemsById.get(id), data, definition.hero));
  const checkpoints = normalizeMilestones(definition.milestones, definition.budget);
  const compressed = carryResourceAxis(data, legalItemIds, definition.budget);
  const expectedAxis = [...new Set([...compressed.axis, ...checkpoints])].sort((a, b) => a - b);
  if (JSON.stringify(reference.axis) !== JSON.stringify(expectedAxis)) throw new Error("Frozen reference axis mismatch.");

  const slotUnlocks = [{
    earnedSouls: 0,
    slots: Number(data.slots.item_limit) - Number(data.slots.starting_slots.universal)
  }];
  const domain = createDeadlockDomain({
    data,
    itemIds: legalItemIds,
    budget: definition.budget,
    slotUnlocks,
    soulAxis: expectedAxis,
    metrics: () => ({ value: 0 })
  });
  const clean = (state) => ({ ...state, events: [], snapshots: [] });
  const request = {
    heroId: definition.hero,
    damageFocus: definition.focus,
    budget: definition.budget,
    cacheProfiles: false,
    metricsOnly: true,
    opponentBulletResist: definition.opponentBulletResist,
    opponentSpiritResist: definition.opponentSpiritResist
  };
  const metricCache = new Map();
  const metrics = (state) => {
    const key = [...state.inventory].sort().join("|");
    if (!metricCache.has(key)) {
      const result = evaluateCarryPerformance(state, request, data);
      if (!result.valid) throw new Error(result.reason);
      metricCache.set(key, result.metrics);
    }
    return metricCache.get(key);
  };

  const pointsCache = new WeakMap();
  const nodePoints = (node) => {
    if (pointsCache.has(node)) return pointsCache.get(node);
    const chain = nodeChain(node);
    const points = chain.map((entry) => ({ earnedSouls: entry.state.earnedSouls, metrics: metrics(entry.state) }));
    pointsCache.set(node, points);
    return points;
  };
  const vectorCaches = new Map();
  const vectorForConfig = (objectiveConfig) => {
    if (!vectorCaches.has(objectiveConfig.id)) vectorCaches.set(objectiveConfig.id, new WeakMap());
    const cache = vectorCaches.get(objectiveConfig.id);
    return (node) => {
      if (!cache.has(node)) {
        const measurement = measureSoulAxisPath(
          nodePoints(node),
          reference,
          checkpoints,
          definition.budget,
          definition.focus,
          null,
          objectiveConfig
        );
        cache.set(node, {
          pathScore: measurement.pathScore,
          endScore: measurement.endScore,
          measurement
        });
      }
      return cache.get(node);
    };
  };

  const root = { state: clean(domain.initial), parent: null, event: null, serial: "" };
  const makeNode = (parent, nextState) => {
    const event = nextState.events[0];
    return {
      state: clean(nextState),
      parent,
      event,
      serial: `${parent.serial}|${JSON.stringify(event)}`
    };
  };
  const transitions = (node) => domain.transitions(node.state).map((state) => makeNode(node, state));

  const rootFamily = buildFamilyRoots(data);
  const diversityKey = (node) => {
    const counts = { Weapon: 0, Vitality: 0, Spirit: 0, Other: 0 };
    const roots = [];
    for (const id of node.state.inventory) {
      const category = data.itemsById.get(id)?.category;
      counts[Object.hasOwn(counts, category) ? category : "Other"] += 1;
      roots.push(rootFamily(id));
    }
    return `${counts.Weapon}/${counts.Vitality}/${counts.Spirit}/${counts.Other}:${[...new Set(roots)].sort().join(",")}`;
  };

  return {
    root,
    domain,
    transitions,
    futureKey: (node) => domain.futureKey(node.state),
    diversityKey,
    currentVector: vectorForConfig(config),
    sweetVector: vectorForConfig(SWEET),
    aggressiveVector: vectorForConfig(AGGRESSIVE)
  };
}

function runSearch({ data, definition, reference, config, targetSpecs = null, stopDepth = null, discoverTargetId = null }) {
  const rt = createRuntime(data, definition, reference, config);
  const started = performance.now();
  const timeMs = definition.timeBudgetMs;
  const auditReserveMs = Math.min(2000, timeMs * 0.2);
  const searchDeadline = started + timeMs - auditReserveMs;
  const finalDeadline = started + timeMs;
  const targetByDepth = targetSpecs ? new Map(targetSpecs.map((entry) => [entry.depth, entry])) : null;
  const trace = [];
  let beam = [rt.root];
  let steps = 0;
  let earlySaveCompletionMaterialized = false;
  let foundTarget = null;
  let loss = null;

  while (beam.length && performance.now() < searchDeadline) {
    const candidates = [];
    const expandedSerials = new Set();
    let partialStep = false;
    for (const node of beam) {
      if (performance.now() >= searchDeadline) {
        partialStep = true;
        break;
      }
      if (node.state.earnedSouls === definition.budget) continue;
      expandedSerials.add(node.serial);
      const successors = rt.transitions(node);
      for (const successor of successors) {
        if (successor.state.earnedSouls === definition.budget && discoverTargetId && pathId(eventChain(successor)) === discoverTargetId) {
          foundTarget = successor;
        }
      }
      candidates.push(...successors);
    }

    if (partialStep) {
      if (targetByDepth) {
        const parent = targetByDepth.get(steps);
        if (parent && beam.some((node) => node.serial === parent.serial) && !expandedSerials.has(parent.serial)) {
          loss = { type: "runtime", depth: steps + 1, parentSerial: parent.serial, elapsedMs: performance.now() - started };
        }
      }
      break;
    }
    if (!candidates.length) break;

    const unique = dedupeFuturePathHistory(candidates, rt.futureKey, rt.currentVector);
    const selection = selectWithTrace(unique, WIDTH, rt.currentVector, rt.diversityKey);
    const nextDepth = steps + 1;

    if (targetByDepth?.has(nextDepth)) {
      const spec = targetByDepth.get(nextDepth);
      const generated = candidates.find((node) => node.serial === spec.serial) || null;
      const deduped = unique.find((node) => node.serial === spec.serial) || null;
      const retained = selection.selected.find((node) => node.serial === spec.serial) || null;
      let status = "retained";
      if (!generated) status = "not-generated";
      else if (!deduped) status = "deduped-away";
      else if (!retained) status = "retention-cut";
      const lazyLayer = deduped
        ? selection.layers.findIndex((layer) => layer.some((entry) => entry.node.serial === spec.serial))
        : null;
      trace.push({
        depth: nextDepth,
        earnedSouls: spec.node.state.earnedSouls,
        status,
        lazyParetoLayer: lazyLayer >= 0 ? lazyLayer : null,
        candidatesBeforeDedupe: candidates.length,
        candidatesAfterDedupe: unique.length,
        retained: selection.selected.length,
        layerSizes: selection.metadata.layerSizes,
        truncatedLayerIndex: selection.metadata.truncatedLayerIndex,
        unlayeredCount: selection.metadata.unlayeredCount,
        elapsedMs: performance.now() - started
      });

      if (status !== "retained") {
        loss = {
          type: status === "deduped-away" ? "dedupe" : status === "retention-cut" ? "retention" : "candidate-generation",
          depth: nextDepth,
          target: generated || spec.node,
          candidates,
          unique,
          selection,
          elapsedMs: performance.now() - started,
          timeRemainingMs: searchDeadline - performance.now()
        };
        break;
      }
    }

    beam = selection.selected;
    steps = nextDepth;

    if (foundTarget) break;
    if (stopDepth !== null && steps >= stopDepth) break;

    if (!earlySaveCompletionMaterialized && beam.length) {
      for (const node of beam) {
        if (node.state.earnedSouls === definition.budget) continue;
        if (performance.now() >= finalDeadline) break;
        completeNodeBySaving(node, definition.budget, rt.transitions, finalDeadline);
      }
      earlySaveCompletionMaterialized = true;
    }
  }

  return {
    runtime: rt,
    trace,
    loss,
    foundTarget,
    steps,
    deadlineReached: performance.now() >= searchDeadline,
    elapsedMs: performance.now() - started
  };
}

function dedupeKey(node, rt, vectorFor) {
  const vector = vectorFor(node);
  return `${rt.futureKey(node)}::path=${vector.pathScore}::end=${vector.endScore}`;
}

function candidateRecord(node, rt, data, sweetLayer = null, selectedReason = null) {
  const sweet = rt.sweetVector(node);
  const aggressive = rt.aggressiveVector(node);
  return {
    pathId: pathId(eventChain(node)),
    earnedSouls: node.state.earnedSouls,
    cash: node.state.cash,
    inventory: [...node.state.inventory],
    investments: categoryInvestments(data, node.state.inventory),
    transactions: transactionCount(node),
    lastTransaction: node.event,
    futureKey: rt.futureKey(node),
    sweetDedupeKey: dedupeKey(node, rt, rt.sweetVector),
    diversitySignature: rt.diversityKey(node),
    sweetParetoLayer: sweetLayer,
    selectedReason,
    sweet: {
      pathScore: sweet.pathScore,
      endScore: sweet.endScore,
      pathDamage: sweet.measurement.pathDamage,
      endDamage: sweet.measurement.endDamage,
      pathSurvival: sweet.measurement.pathSurvivability,
      endSurvival: sweet.measurement.endSurvivability
    },
    aggressive: {
      pathScore: aggressive.pathScore,
      endScore: aggressive.endScore,
      pathDamage: aggressive.measurement.pathDamage,
      endDamage: aggressive.measurement.endDamage,
      pathSurvival: aggressive.measurement.pathSurvivability,
      endSurvival: aggressive.measurement.endSurvivability
    },
    history: eventChain(node)
  };
}

function main() {
  const data = loadData();
  const references = JSON.parse(readFileSync(REFERENCE_FILE, "utf8"));
  const definition = benchmarkCases("production").find((entry) => entry.hero === "warden" && entry.focus === "weapon");
  if (!definition) throw new Error("Warden weapon production case missing.");
  const referenceEntry = references.references[definition.id];
  if (!referenceEntry?.reference) throw new Error("Frozen reference missing.");
  const reference = referenceEntry.reference;

  console.log(JSON.stringify({ phase: "discover-aggressive-target", targetId: TARGET_ID }));
  const discovery = runSearch({
    data,
    definition,
    reference,
    config: AGGRESSIVE,
    discoverTargetId: TARGET_ID
  });
  if (!discovery.foundTarget) {
    throw new Error(`Aggressive target ${TARGET_ID} was not generated before search stop.`);
  }

  const chain = nodeChain(discovery.foundTarget);
  const targetSpecs = chain.map((node, depth) => ({ depth, serial: node.serial, node }));
  console.log(JSON.stringify({ phase: "trace-sweet", targetDepth: targetSpecs.length - 1 }));

  const sweetRun = runSearch({
    data,
    definition,
    reference,
    config: SWEET,
    targetSpecs
  });
  if (!sweetRun.loss) throw new Error("Sweet did not lose the aggressive target path in the traced horizon.");

  const lossDepth = sweetRun.loss.depth;
  console.log(JSON.stringify({ phase: "trace-aggressive-at-divergence", lossDepth }));
  const aggressiveRun = runSearch({
    data,
    definition,
    reference,
    config: AGGRESSIVE,
    targetSpecs,
    stopDepth: lossDepth
  });

  const targetSpec = targetSpecs[lossDepth];
  const targetNode = targetSpec.node;
  const sweetRt = sweetRun.runtime;
  const loss = sweetRun.loss;
  let sweetLayer = null;
  let aggressiveCounterfactual = null;
  let selectedCompetitors = [];
  let sameFuture = null;
  let dedupeReplacement = null;

  if (loss.type === "dedupe") {
    const targetKey = dedupeKey(loss.target, sweetRt, sweetRt.currentVector);
    dedupeReplacement = loss.unique.find((node) => dedupeKey(node, sweetRt, sweetRt.currentVector) === targetKey) || null;
  }

  if (loss.type === "retention") {
    sweetLayer = exactTargetLayer(loss.unique, targetSpec.serial, sweetRt.currentVector);
    const cf = selectWithTrace(loss.unique, WIDTH, sweetRt.aggressiveVector, sweetRt.diversityKey);
    const cfTarget = cf.selected.find((node) => node.serial === targetSpec.serial) || null;
    const cfLayerLazy = cf.layers.findIndex((layer) => layer.some((entry) => entry.node.serial === targetSpec.serial));
    aggressiveCounterfactual = {
      retainedOnSameSweetPool: Boolean(cfTarget),
      lazyParetoLayer: cfLayerLazy >= 0 ? cfLayerLazy : null,
      layerSizes: cf.metadata.layerSizes,
      truncatedLayerIndex: cf.metadata.truncatedLayerIndex
    };

    const selectedLayers = new Map();
    for (let i = 0; i < loss.selection.layers.length; i += 1) {
      for (const entry of loss.selection.layers[i]) selectedLayers.set(entry.node, i);
    }
    selectedCompetitors = loss.selection.selected.map((node) =>
      candidateRecord(node, sweetRt, data, selectedLayers.get(node) ?? null, loss.selection.reasons.get(node) || null)
    );

    const targetFuture = sweetRt.futureKey(loss.target);
    sameFuture = {
      candidatesBeforeDedupe: loss.candidates.filter((node) => sweetRt.futureKey(node) === targetFuture).length,
      candidatesAfterDedupe: loss.unique.filter((node) => sweetRt.futureKey(node) === targetFuture).length
    };
  }

  const aggressiveRow = aggressiveRun.trace.find((row) => row.depth === lossDepth) || null;
  const sweetTrace = sweetRun.trace.filter((row) => row.depth <= lossDepth);
  const aggressiveTrace = aggressiveRun.trace.filter((row) => row.depth <= lossDepth);
  const prefixTrace = targetSpecs.slice(1, lossDepth + 1).map((spec) => {
    const sweet = sweetRt.sweetVector(spec.node);
    const aggressive = sweetRt.aggressiveVector(spec.node);
    const srow = sweetTrace.find((row) => row.depth === spec.depth) || null;
    const arow = aggressiveTrace.find((row) => row.depth === spec.depth) || null;
    return {
      depth: spec.depth,
      earnedSouls: spec.node.state.earnedSouls,
      inventory: [...spec.node.state.inventory],
      lastTransaction: spec.node.event,
      historyLength: spec.depth,
      futureKey: sweetRt.futureKey(spec.node),
      sweet: {
        pathScore: sweet.pathScore,
        endScore: sweet.endScore,
        pathDamage: sweet.measurement.pathDamage,
        endDamage: sweet.measurement.endDamage,
        pathSurvival: sweet.measurement.pathSurvivability,
        endSurvival: sweet.measurement.endSurvivability,
        paretoLayer: srow?.lazyParetoLayer ?? (spec.depth === lossDepth ? sweetLayer : null),
        retentionStatus: srow?.status ?? null
      },
      aggressive: {
        pathScore: aggressive.pathScore,
        endScore: aggressive.endScore,
        pathDamage: aggressive.measurement.pathDamage,
        endDamage: aggressive.measurement.endDamage,
        pathSurvival: aggressive.measurement.pathSurvivability,
        endSurvival: aggressive.measurement.endSurvivability,
        paretoLayer: arow?.lazyParetoLayer ?? null,
        retentionStatus: arow?.status ?? null
      }
    };
  });

  const target = candidateRecord(targetNode, sweetRt, data, sweetLayer, null);
  const result = {
    schemaVersion: "optimizer-search-divergence-diagnosis-v1",
    sourceCommit: process.env.GITHUB_SHA || "unknown",
    caseId: definition.id,
    scope: { hero: "warden", focus: "weapon", budget: 40000, beamWidth: WIDTH },
    reference: {
      version: referenceEntry.version,
      source: "frozen supplied baseline-v0",
      identicalAcrossSweetAggressive: true
    },
    target: {
      id: TARGET_ID,
      pathDepth: targetSpecs.length - 1,
      winnerHistory: eventChain(discovery.foundTarget)
    },
    firstDivergence: {
      depth: lossDepth,
      type: loss.type,
      earnedSouls: targetNode.state.earnedSouls,
      lastTransaction: targetNode.event,
      inventory: [...targetNode.state.inventory],
      candidatesBeforeRetention: loss.candidates?.length ?? null,
      candidatesAfterDedupe: loss.unique?.length ?? null,
      candidatesAfterRetention: loss.selection?.selected?.length ?? null,
      sweetParetoLayer: sweetLayer,
      aggressiveParetoLayer: aggressiveRow?.lazyParetoLayer ?? null,
      sweetElapsedMs: loss.elapsedMs,
      sweetSearchTimeRemainingMs: loss.timeRemainingMs ?? null,
      target,
      dedupeReplacement: dedupeReplacement ? candidateRecord(dedupeReplacement, sweetRt, data) : null,
      selectedInstead: selectedCompetitors,
      aggressiveCounterfactualOnIdenticalSweetPool: aggressiveCounterfactual,
      sameFutureKeyMultiplicity: sameFuture
    },
    prefixTrace,
    hypotheses: {
      H1_objectiveGuidance: loss.type === "retention" && aggressiveCounterfactual?.retainedOnSameSweetPool
        ? "SUPPORTED: Aggressive retains the exact target on the identical Sweet candidate pool."
        : "NOT_CONFIRMED",
      H2_beamWidth: loss.type === "retention"
        ? "SUPPORTED_AS_MECHANISM: target survives generation/dedupe but misses Width-4 retention."
        : "NOT_PRIMARY_AT_FIRST_DIVERGENCE",
      H3_paretoLayer: loss.type === "retention" && sweetLayer !== null
        ? `TESTED: Sweet target exact layer=${sweetLayer}; truncated layer=${loss.selection.metadata.truncatedLayerIndex}.`
        : "NOT_PRIMARY_AT_FIRST_DIVERGENCE",
      H4_diversity: loss.type === "retention" && sweetLayer === loss.selection.metadata.truncatedLayerIndex
        ? "POSSIBLE_DIRECT_TIEBREAK: target is in the truncated layer; inspect selectedReason/diversity signatures."
        : "NOT_PRIMARY_AT_FIRST_DIVERGENCE",
      H5_dedupeHistory: loss.type === "dedupe"
        ? "SUPPORTED"
        : "REJECTED_AS_DIRECT_CAUSE: target survives current future+path-history dedupe at first divergence.",
      H6_runtime: loss.type === "runtime"
        ? "SUPPORTED"
        : "REJECTED_AS_FIRST_CAUSE: divergence occurs in a fully processed retention step before deadline.",
      H7_candidateGeneration: loss.type === "candidate-generation"
        ? "SUPPORTED"
        : "REJECTED_AS_FIRST_CAUSE: target state is generated under Sweet before it is lost."
    }
  };

  if (loss.type === "retention") {
    const truncated = loss.selection.metadata.truncatedLayerIndex;
    const sameLayerCut = sweetLayer === truncated;
    const objectiveFlips = Boolean(aggressiveCounterfactual?.retainedOnSameSweetPool);
    result.primaryClassification = objectiveFlips
      ? (sameLayerCut ? "F: Objective-Guidance + partial-layer retention/diversity" : "F: Objective-Guidance + Beam/Pareto retention")
      : (sameLayerCut ? "D: Diversity/partial-layer selection" : "B: Beam/Pareto retention");
  } else if (loss.type === "dedupe") {
    result.primaryClassification = "C: Dedupe/History";
  } else if (loss.type === "runtime") {
    result.primaryClassification = "E: Runtime/Deadline";
  } else {
    result.primaryClassification = "G: noch nicht eindeutig";
  }

  const targetOut = outputPath();
  mkdirSync(dirname(targetOut), { recursive: true });
  writeFileSync(targetOut, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({
    status: "COMPLETE",
    output: targetOut,
    classification: result.primaryClassification,
    firstDivergence: {
      depth: result.firstDivergence.depth,
      type: result.firstDivergence.type,
      earnedSouls: result.firstDivergence.earnedSouls,
      lastTransaction: result.firstDivergence.lastTransaction,
      sweetParetoLayer: result.firstDivergence.sweetParetoLayer,
      aggressiveParetoLayer: result.firstDivergence.aggressiveParetoLayer,
      counterfactualAggressiveRetained: result.firstDivergence.aggressiveCounterfactualOnIdenticalSweetPool?.retainedOnSameSweetPool ?? null,
      timeRemainingMs: result.firstDivergence.sweetSearchTimeRemainingMs
    }
  }));
}

try {
  main();
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
}

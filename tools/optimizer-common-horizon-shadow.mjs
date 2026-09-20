import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseCsv } from "../app/lib.mjs";
import { buildOptimizerData, heroCanPurchaseItem } from "../app/optimizer.mjs";
import { carryResourceAxis, evaluateCarryPerformance } from "../app/warden-search.mjs";
import { createDeadlockDomain } from "../app/deadlock-domain.mjs";
import { normalizeMilestones } from "../app/search-milestones.mjs";
import { measureSoulAxisPath } from "../app/search-objective-v1.mjs";
import {
  completeNodeBySaving,
  dedupeFuturePathHistory,
  pathEndNonDominatedLayers,
  runControlledMultiobjectiveBeamCarry,
  selectPathEndParetoBeam,
  selectPathEndParetoBeamCommonHorizonShadow
} from "../app/multiobjective-search.mjs";
import { pathEndParetoFront } from "../app/path-end-pareto.mjs";
import { benchmarkCases } from "../benchmarks/optimizer-v1/cases.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const REFERENCE_FILE = resolve(ROOT, "benchmarks/optimizer-v1/references/baseline-v0.json");
const DIVERGENCE_FILE = resolve(ROOT, "benchmarks/optimizer-v1/experiments/search-divergence-diagnosis/results.json");
const DEFAULT_OUTPUT = resolve(ROOT, "artifacts/common-horizon-shadow/results.json");
const WIDTH = 4;
const DIVERGENCE_DEPTH = 14;
const TARGET_PATH_ID = "93260772842f0c27";
const KNOWN_PATH = 0.4417724595;
const KNOWN_END = 0.4459173427;
const EPS = 1e-12;

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

function createRuntime(data, definition, reference) {
  const requested = definition.itemIds ? [...definition.itemIds] : data.items.map((item) => item.item_id);
  const legalItemIds = requested.filter((id) => heroCanPurchaseItem(data.itemsById.get(id), data, definition.hero));
  const checkpoints = normalizeMilestones(definition.milestones, definition.budget);
  const compressed = carryResourceAxis(data, legalItemIds, definition.budget);
  const axis = [...new Set([...compressed.axis, ...checkpoints])].sort((a, b) => a - b);
  if (JSON.stringify(reference.axis) !== JSON.stringify(axis)) throw new Error("Frozen reference axis mismatch.");

  const slotUnlocks = [{
    earnedSouls: 0,
    slots: Number(data.slots.item_limit) - Number(data.slots.starting_slots.universal)
  }];
  const domain = createDeadlockDomain({
    data,
    itemIds: legalItemIds,
    budget: definition.budget,
    slotUnlocks,
    soulAxis: axis,
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
  const counters = {
    evaluations: 0,
    transitionCalls: 0,
    generatedStates: 0,
    projectionSaveTransitions: 0,
    horizonVectorEvaluations: 0
  };
  const metricCache = new Map();
  const metrics = (state) => {
    const key = [...state.inventory].sort().join("|");
    if (!metricCache.has(key)) {
      const result = evaluateCarryPerformance(state, request, data);
      if (!result.valid) throw new Error(result.reason);
      metricCache.set(key, result.metrics);
      counters.evaluations += 1;
    }
    return metricCache.get(key);
  };
  const root = { state: clean(domain.initial), parent: null, event: null, serial: "" };
  const makeNode = (parent, nextState) => {
    const event = nextState.events[0];
    return {
      state: clean(nextState),
      parent,
      event,
      serial: parent.serial + "|" + JSON.stringify(event)
    };
  };
  const transitions = (node) => {
    counters.transitionCalls += 1;
    const states = domain.transitions(node.state);
    counters.generatedStates += states.length;
    return states.map((state) => makeNode(node, state));
  };
  const saveOnlyTransitions = (node) => {
    counters.projectionSaveTransitions += 1;
    const state = domain.saveTransition(node.state);
    return state ? [makeNode(node, state)] : [];
  };

  const pointsCache = new WeakMap();
  const nodePoints = (node) => {
    if (!pointsCache.has(node)) {
      pointsCache.set(node, nodeChain(node).map((entry) => ({
        earnedSouls: entry.state.earnedSouls,
        metrics: metrics(entry.state)
      })));
    }
    return pointsCache.get(node);
  };
  const vectorCache = new WeakMap();
  const vectorFor = (node) => {
    if (!vectorCache.has(node)) {
      const measurement = measureSoulAxisPath(
        nodePoints(node), reference, checkpoints, definition.budget, definition.focus, null, SWEET
      );
      vectorCache.set(node, {
        pathScore: measurement.pathScore,
        endScore: measurement.endScore,
        measurement
      });
    }
    return vectorCache.get(node);
  };
  const horizonCaches = new Map();
  const vectorForHorizon = (node, horizon) => {
    if (!horizonCaches.has(horizon)) horizonCaches.set(horizon, new WeakMap());
    const cache = horizonCaches.get(horizon);
    if (!cache.has(node)) {
      counters.horizonVectorEvaluations += 1;
      const measurement = measureSoulAxisPath(
        nodePoints(node), reference, checkpoints, horizon, definition.focus, null, SWEET
      );
      cache.set(node, {
        pathScore: measurement.pathScore,
        endScore: measurement.endScore,
        measurement
      });
    }
    return cache.get(node);
  };

  const rootFamily = (() => {
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
  })();
  const diversityKey = (node) => {
    const counts = { Weapon: 0, Vitality: 0, Spirit: 0, Other: 0 };
    const roots = [];
    for (const id of node.state.inventory) {
      const category = data.itemsById.get(id)?.category;
      counts[Object.hasOwn(counts, category) ? category : "Other"] += 1;
      roots.push(rootFamily(id));
    }
    return counts.Weapon + "/" + counts.Vitality + "/" + counts.Spirit + "/" + counts.Other + ":" +
      [...new Set(roots)].sort().join(",");
  };

  return {
    root,
    transitions,
    saveOnlyTransitions,
    futureKey: (node) => domain.futureKey(node.state),
    diversityKey,
    vectorFor,
    vectorForHorizon,
    counters,
    legalItemIds,
    slotUnlocks
  };
}

function exactLayer(nodes, target, vectorFor) {
  const decorated = nodes.map((node) => {
    const vector = vectorFor(node);
    return { node, id: node.serial, pathScore: vector.pathScore, endScore: vector.endScore };
  });
  const layers = pathEndNonDominatedLayers(decorated);
  return layers.findIndex((layer) => layer.some((entry) => entry.node === target));
}

function runDivergencePool(rt) {
  let beam = [rt.root];
  for (let depth = 1; depth <= DIVERGENCE_DEPTH; depth += 1) {
    const candidates = [];
    for (const node of beam) candidates.push(...rt.transitions(node));
    const unique = dedupeFuturePathHistory(candidates, rt.futureKey, rt.vectorFor);
    if (depth === DIVERGENCE_DEPTH) return { depth, candidates, unique };
    beam = selectPathEndParetoBeam(unique, WIDTH, rt.vectorFor, rt.diversityKey).selected;
  }
  throw new Error("Divergence depth was not reached.");
}

function compactVector(vector) {
  return {
    pathScore: vector.pathScore,
    endScore: vector.endScore,
    pathDamage: vector.measurement?.pathDamage ?? null,
    endDamage: vector.measurement?.endDamage ?? null,
    pathSurvival: vector.measurement?.pathSurvivability ?? null,
    endSurvival: vector.measurement?.endSurvivability ?? null
  };
}

function stage1(rt, storedTarget) {
  const beforeSearch = { ...rt.counters };
  const pool = runDivergencePool(rt);
  const target = pool.unique.find((node) => pathId(eventChain(node)) === TARGET_PATH_ID);
  if (!target) throw new Error("Known target seed was not present after dedupe at divergence.");

  const baselineStarted = performance.now();
  const baseline = selectPathEndParetoBeam(pool.unique, WIDTH, rt.vectorFor, rt.diversityKey);
  const baselineRuntimeMs = performance.now() - baselineStarted;
  const baselineLayer = exactLayer(pool.unique, target, rt.vectorFor);

  const beforeShadow = { ...rt.counters };
  const shadowStarted = performance.now();
  const shadow = selectPathEndParetoBeamCommonHorizonShadow(
    pool.unique,
    WIDTH,
    rt.vectorFor,
    rt.vectorForHorizon,
    rt.saveOnlyTransitions,
    rt.diversityKey
  );
  const shadowRuntimeMs = performance.now() - shadowStarted;
  const projection = shadow.projectionEntries.find((entry) => entry.originalNode === target) || null;
  const projectedByOriginal = new Map(
    shadow.projectionEntries.map((entry) => [entry.originalNode, entry.projectedNode])
  );
  const shadowVector = (node) =>
    rt.vectorForHorizon(projectedByOriginal.get(node) || node, shadow.shadowProjection.commonHorizon);
  const shadowLayer = shadow.shadowProjection.applied ? exactLayer(pool.unique, target, shadowVector) : null;

  const projectionRecords = shadow.projectionEntries.map((entry) => ({
    pathId: pathId(eventChain(entry.originalNode)),
    fromSouls: entry.originalNode.state.earnedSouls,
    toSouls: entry.projectedNode.state.earnedSouls,
    saveSteps: entry.saveSteps,
    original: compactVector(rt.vectorFor(entry.originalNode)),
    projected: compactVector(rt.vectorForHorizon(entry.projectedNode, shadow.shadowProjection.commonHorizon))
  }));

  const baselineIds = baseline.selected.map((node) => pathId(eventChain(node)));
  const shadowIds = shadow.selected.map((node) => pathId(eventChain(node)));
  const targetProjection = projection ? {
    fromSouls: projection.originalNode.state.earnedSouls,
    toSouls: projection.projectedNode.state.earnedSouls,
    saveSteps: projection.saveSteps,
    original: compactVector(rt.vectorFor(projection.originalNode)),
    projected: compactVector(rt.vectorForHorizon(projection.projectedNode, shadow.shadowProjection.commonHorizon))
  } : null;

  return {
    target,
    report: {
      expectedStoredPathId: storedTarget.pathId,
      targetPathId: TARGET_PATH_ID,
      divergenceDepth: pool.depth,
      candidatesBeforeDedupe: pool.candidates.length,
      candidatesAfterDedupe: pool.unique.length,
      soulLevels: [...new Set(pool.unique.map((node) => node.state.earnedSouls))].sort((a, b) => a - b),
      baseline: {
        runtimeMs: baselineRuntimeMs,
        targetLayer: baselineLayer,
        retainedPathIds: baselineIds,
        targetRetained: baselineIds.includes(TARGET_PATH_ID),
        targetVector: compactVector(rt.vectorFor(target))
      },
      shadow: {
        runtimeMs: shadowRuntimeMs,
        ...shadow.shadowProjection,
        targetLayer: shadowLayer,
        retainedPathIds: shadowIds,
        targetRetained: shadowIds.includes(TARGET_PATH_ID),
        targetProjection,
        projectionRecords,
        counterDelta: {
          evaluations: rt.counters.evaluations - beforeShadow.evaluations,
          transitionCalls: rt.counters.transitionCalls - beforeShadow.transitionCalls,
          generatedStates: rt.counters.generatedStates - beforeShadow.generatedStates,
          projectionSaveTransitions: rt.counters.projectionSaveTransitions - beforeShadow.projectionSaveTransitions,
          horizonVectorEvaluations: rt.counters.horizonVectorEvaluations - beforeShadow.horizonVectorEvaluations
        }
      },
      searchToDivergenceCost: {
        evaluations: beforeShadow.evaluations - beforeSearch.evaluations,
        transitionCalls: beforeShadow.transitionCalls - beforeSearch.transitionCalls,
        generatedStates: beforeShadow.generatedStates - beforeSearch.generatedStates
      }
    }
  };
}

function continueFromOriginal(rt, seed, budget) {
  const startCounters = { ...rt.counters };
  const started = performance.now();
  const terminals = new Map();
  const observe = (node) => {
    if (node.state.earnedSouls === budget) terminals.set(node.serial, node);
  };
  const saveComplete = (nodes) => {
    for (const node of nodes) {
      if (node.state.earnedSouls === budget) {
        observe(node);
        continue;
      }
      const completed = completeNodeBySaving(node, budget, rt.transitions, Infinity);
      if (!completed) throw new Error("Save completion failed without deadline.");
      observe(completed);
    }
  };

  let beam = [seed];
  let steps = 0;
  let duplicateStates = 0;
  let earlySaveCompletionMaterialized = false;
  let maxCandidatePool = 0;
  while (beam.length && steps < 1000) {
    const candidates = [];
    for (const node of beam) {
      if (node.state.earnedSouls === budget) {
        observe(node);
        continue;
      }
      const successors = rt.transitions(node);
      for (const successor of successors) observe(successor);
      candidates.push(...successors);
    }
    if (!candidates.length) {
      beam = [];
      break;
    }
    maxCandidatePool = Math.max(maxCandidatePool, candidates.length);
    const unique = dedupeFuturePathHistory(candidates, rt.futureKey, rt.vectorFor);
    duplicateStates += candidates.length - unique.length;
    beam = selectPathEndParetoBeam(unique, WIDTH, rt.vectorFor, rt.diversityKey).selected;
    steps += 1;
    if (!earlySaveCompletionMaterialized && beam.length) {
      saveComplete(beam);
      earlySaveCompletionMaterialized = true;
    }
  }
  if (beam.length && steps >= 1000) throw new Error("Continuation exceeded 1000 steps.");
  if (beam.length) saveComplete(beam);

  const entries = [...terminals.values()].map((node) => {
    const vector = rt.vectorFor(node);
    return {
      id: pathId(eventChain(node)),
      node,
      pathScore: vector.pathScore,
      endScore: vector.endScore,
      measurement: vector.measurement
    };
  });
  const front = pathEndParetoFront(entries);
  const qualifying = front.filter((entry) =>
    entry.pathScore + EPS >= KNOWN_PATH && entry.endScore + EPS >= KNOWN_END
  );
  const representative = [...front].sort((a, b) =>
    b.pathScore - a.pathScore || b.endScore - a.endScore || a.id.localeCompare(b.id)
  )[0] || null;
  const counterDelta = {
    evaluations: rt.counters.evaluations - startCounters.evaluations,
    transitionCalls: rt.counters.transitionCalls - startCounters.transitionCalls,
    generatedStates: rt.counters.generatedStates - startCounters.generatedStates
  };
  return {
    runtimeMs: performance.now() - started,
    steps,
    duplicateStates,
    maxCandidatePool,
    terminalCandidates: terminals.size,
    frontSize: front.length,
    reached40k: front.some((entry) => entry.node.state.earnedSouls === budget),
    meetsKnownOutput: qualifying.length > 0,
    qualifying: qualifying.map((entry) => ({
      id: entry.id,
      pathScore: entry.pathScore,
      endScore: entry.endScore
    })),
    representative: representative ? {
      id: representative.id,
      pathScore: representative.pathScore,
      endScore: representative.endScore,
      earnedSouls: representative.node.state.earnedSouls,
      inventory: [...representative.node.state.inventory]
    } : null,
    counterDelta
  };
}

function stage3(data, definition, reference, rt) {
  const args = {
    data,
    reference,
    heroId: definition.hero,
    damageFocus: definition.focus,
    objectiveConfig: SWEET,
    itemIds: rt.legalItemIds,
    budget: definition.budget,
    milestones: definition.milestones,
    opponentBulletResist: definition.opponentBulletResist,
    opponentSpiritResist: definition.opponentSpiritResist,
    slotUnlocks: rt.slotUnlocks,
    beamWidth: WIDTH,
    maxSteps: 1000,
    timeMs: Infinity,
    auditReserveMs: 0,
    profile: false
  };
  const baseline = runControlledMultiobjectiveBeamCarry(args);
  const shadow = runControlledMultiobjectiveBeamCarry({ ...args, commonHorizonShadow: true });
  const b = baseline.telemetry;
  const s = shadow.telemetry;
  return {
    baseline: {
      runtimeMs: b.runtimeMs,
      evaluations: b.evaluations,
      generatedStates: b.generatedStates,
      transitionCalls: b.transitionCalls,
      retentionCalls: b.retentionCalls,
      maxCandidatePool: b.maxCandidatePool,
      searchComplete: b.searchComplete,
      finalFrontSize: b.finalFrontSize
    },
    shadow: {
      runtimeMs: s.runtimeMs,
      evaluations: s.evaluations,
      generatedStates: s.generatedStates,
      transitionCalls: s.transitionCalls,
      retentionCalls: s.retentionCalls,
      maxCandidatePool: s.maxCandidatePool,
      searchComplete: s.searchComplete,
      finalFrontSize: s.finalFrontSize,
      commonHorizon: s.commonHorizonShadow
    },
    delta: {
      runtimeMs: s.runtimeMs - b.runtimeMs,
      runtimeRatio: b.runtimeMs > 0 ? s.runtimeMs / b.runtimeMs : null,
      evaluations: s.evaluations - b.evaluations,
      generatedStates: s.generatedStates - b.generatedStates,
      transitionCalls: s.transitionCalls - b.transitionCalls,
      retentionCalls: s.retentionCalls - b.retentionCalls,
      maxCandidatePool: s.maxCandidatePool - b.maxCandidatePool
    },
    memoryProxy: {
      metric: "peak simultaneously retained projection-entry references; no byte estimate",
      peakProjectionEntries: s.commonHorizonShadow?.peakProjectionEntries ?? 0,
      peakProjectedCandidates: s.commonHorizonShadow?.peakProjectedCandidates ?? 0
    }
  };
}

function main() {
  const data = loadData();
  const references = JSON.parse(readFileSync(REFERENCE_FILE, "utf8"));
  const divergence = JSON.parse(readFileSync(DIVERGENCE_FILE, "utf8"));
  const definition = benchmarkCases("production").find((entry) =>
    entry.hero === "warden" && entry.focus === "weapon"
  );
  if (!definition) throw new Error("Warden weapon production case missing.");
  const referenceEntry = references.references[definition.id];
  if (!referenceEntry?.reference) throw new Error("Frozen baseline-v0 reference missing.");
  if (divergence.firstDivergence?.target?.pathId !== TARGET_PATH_ID) {
    throw new Error("Stored divergence target mismatch.");
  }

  const rt = createRuntime(data, definition, referenceEntry.reference);
  const first = stage1(rt, divergence.firstDivergence.target);
  const stage1Success =
    first.report.shadow.applied === true &&
    first.report.shadow.commonHorizon === 4000 &&
    first.report.shadow.targetRetained === true &&
    first.report.shadow.targetProjection?.saveSteps === 1;

  let second = { skipped: true, reason: "stage-1-failed" };
  if (stage1Success) {
    second = {
      skipped: false,
      ...continueFromOriginal(rt, first.target, definition.budget)
    };
  }

  const third = stage3(data, definition, referenceEntry.reference, rt);
  const warnings = [];
  if (!stage1Success) warnings.push("known-seed-not-rescued-as-specified");
  if ((first.report.shadow.maxSaveStepsPerCandidate ?? 0) > 1) warnings.push("more-than-one-save-step-in-stage-1-pool");
  if (first.report.shadow.applied && first.report.shadow.projectedCandidates > first.report.candidatesAfterDedupe / 2) {
    warnings.push("projection-touches-majority-of-divergence-pool");
  }
  if (!second.skipped && !second.meetsKnownOutput) warnings.push("rescued-seed-misses-known-40k-output");
  if (third.shadow.commonHorizon?.skippedPools > third.shadow.commonHorizon?.appliedPools) {
    warnings.push("shadow-skips-more-pools-than-it-projects");
  }

  const result = {
    schemaVersion: "optimizer-common-horizon-retention-shadow-v1",
    sourceCommit: process.env.GITHUB_SHA || "unknown",
    caseId: definition.id,
    scope: {
      hero: "warden",
      role: "carry",
      focus: "weapon",
      budget: definition.budget,
      beamWidth: WIDTH,
      objective: SWEET,
      reference: referenceEntry.version
    },
    productionChanged: false,
    uiChanged: false,
    canonicalDataChanged: false,
    invariants: {
      objectiveWeightsChanged: false,
      pathAucChanged: false,
      endbuildGoalChanged: false,
      beamWidthChanged: false,
      lazyParetoChanged: false,
      paretoSemanticsChanged: false,
      dedupeChanged: false,
      diversityChanged: false,
      candidateGenerationChanged: false,
      itemDataChanged: false,
      thresholdsChanged: false,
      saveTo40kChanged: false,
      terminalizationChanged: false,
      churnSemanticsChanged: false,
      retainedStateUsesOriginalNode: true
    },
    stage1: first.report,
    stage2: second,
    stage3: third,
    warnings
  };

  const target = outputPath();
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({
    status: "COMPLETE",
    output: target,
    stage1Success,
    commonHorizon: first.report.shadow.commonHorizon,
    targetRetainedBefore: first.report.baseline.targetRetained,
    targetRetainedAfter: first.report.shadow.targetRetained,
    targetLayerBefore: first.report.baseline.targetLayer,
    targetLayerAfter: first.report.shadow.targetLayer,
    continuationMeetsKnownOutput: second.skipped ? null : second.meetsKnownOutput,
    runtimeRatio: third.delta.runtimeRatio,
    warnings
  }));
}

try {
  main();
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
}

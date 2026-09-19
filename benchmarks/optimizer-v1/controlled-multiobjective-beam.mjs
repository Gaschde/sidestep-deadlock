import { createDeadlockDomain } from "../../app/deadlock-domain.mjs";
import { heroCanPurchaseItem } from "../../app/optimizer.mjs";
import { carryResourceAxis, evaluateCarryPerformance } from "../../app/warden-search.mjs";
import { normalizeMilestones } from "../../app/search-milestones.mjs";
import { normalizeOpponentScenario } from "../../app/search-scenarios.mjs";
import { measureSoulAxisPath } from "../../app/search-objective-v1.mjs";
import { validateSearchPath } from "../../app/validate-search-path.mjs";
import { createBeamProfiler } from "../../app/search-telemetry.mjs";
import { pathEndDominates, pathEndParetoFront } from "./path-end-pareto-lib.mjs";

function transactionCount(node) {
  let count = 0;
  for (let current = node; current?.parent; current = current.parent) {
    count += Number(current.event?.type !== "save");
  }
  return count;
}

function eventChain(node) {
  const chain = [];
  for (let current = node; current?.parent; current = current.parent) chain.push(current.event);
  return chain.reverse();
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

function stableId(entry) {
  return String(entry?.id ?? entry?.serial ?? entry?.node?.serial ?? "");
}

export function pathEndNonDominatedLayers(entries, profiler = null) {
  if (!Array.isArray(entries)) throw new TypeError("entries muss ein Array sein.");
  const timedSort = (array, compare) => profiler?.enabled
    ? profiler.time("sortingMs", () => array.sort(compare))
    : array.sort(compare);
  const remaining = [...entries];
  const layers = [];
  while (remaining.length) {
    const front = remaining.filter((candidate, index) =>
      !remaining.some((other, otherIndex) => otherIndex !== index && pathEndDominates(other, candidate))
    );
    if (!front.length) throw new Error("Pareto layering made no progress.");
    timedSort(front, (a, b) => stableId(a).localeCompare(stableId(b)));
    layers.push(front);
    const selected = new Set(front);
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      if (selected.has(remaining[index])) remaining.splice(index, 1);
    }
  }
  return layers;
}

function partialLayerSelection(layer, capacity, diversityKey, profiler = null) {
  const timedSort = (array, compare) => profiler?.enabled
    ? profiler.time("sortingMs", () => array.sort(compare))
    : array.sort(compare);
  if (capacity <= 0) return [];
  if (layer.length <= capacity) return timedSort([...layer], (a, b) => stableId(a).localeCompare(stableId(b)));

  const selected = [];
  const selectedSet = new Set();
  const add = (entry) => {
    if (entry && selected.length < capacity && !selectedSet.has(entry)) {
      selected.push(entry);
      selectedSet.add(entry);
    }
  };

  if (capacity === 1) {
    add(timedSort([...layer], (a, b) => stableId(a).localeCompare(stableId(b)))[0]);
    return selected;
  }

  const pathExtreme = timedSort([...layer], (a, b) =>
    b.pathScore - a.pathScore || b.endScore - a.endScore || stableId(a).localeCompare(stableId(b))
  )[0];
  const endExtreme = timedSort([...layer], (a, b) =>
    b.endScore - a.endScore || b.pathScore - a.pathScore || stableId(a).localeCompare(stableId(b))
  )[0];
  add(pathExtreme);
  add(endExtreme);

  const buckets = new Map();
  for (const entry of timedSort([...layer], (a, b) => stableId(a).localeCompare(stableId(b)))) {
    if (selectedSet.has(entry)) continue;
    const key = String(diversityKey(entry.node));
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(entry);
  }

  const keys = timedSort([...buckets.keys()], (a, b) => a.localeCompare(b));
  let progressed = true;
  while (selected.length < capacity && progressed) {
    progressed = false;
    for (const key of keys) {
      const bucket = buckets.get(key);
      if (bucket?.length) {
        add(bucket.shift());
        progressed = true;
      }
      if (selected.length >= capacity) break;
    }
  }

  for (const entry of timedSort([...layer], (a, b) => stableId(a).localeCompare(stableId(b)))) add(entry);
  return selected;
}

export function selectPathEndParetoBeam(nodes, width, vectorFor, diversityKey = () => "", profiler = null) {
  if (!Array.isArray(nodes)) throw new TypeError("nodes muss ein Array sein.");
  if (!Number.isSafeInteger(width) || width < 1) throw new RangeError("width muss positiv ganzzahlig sein.");
  if (typeof vectorFor !== "function") throw new TypeError("vectorFor muss eine Funktion sein.");

  const frontierStartedAt = profiler?.enabled ? performance.now() : 0;
  const decorated = nodes.map((node) => {
    const vector = vectorFor(node);
    return {
      node,
      id: stableId(node),
      pathScore: vector.pathScore,
      endScore: vector.endScore
    };
  });
  profiler?.count?.("paretoCandidates", decorated.length);
  const layers = profiler?.enabled
    ? profiler.time("paretoMs", () => pathEndNonDominatedLayers(decorated, profiler))
    : pathEndNonDominatedLayers(decorated, profiler);
  const selected = [];
  let truncatedLayerIndex = null;

  for (let index = 0; index < layers.length && selected.length < width; index += 1) {
    const remaining = width - selected.length;
    const layer = layers[index];
    if (layer.length <= remaining) {
      selected.push(...layer);
      continue;
    }
    truncatedLayerIndex = index;
    selected.push(...(profiler?.enabled
      ? profiler.time("diversityMs", () => partialLayerSelection(layer, remaining, diversityKey, profiler))
      : partialLayerSelection(layer, remaining, diversityKey, profiler)));
  }

  if (profiler?.enabled) profiler.add("frontierMaintenanceMs", performance.now() - frontierStartedAt);
  return {
    selected: selected.map((entry) => entry.node),
    metadata: {
      layerSizes: layers.map((layer) => layer.length),
      firstFrontSize: layers[0]?.length ?? 0,
      firstFrontFullyRetained: (layers[0]?.length ?? 0) <= width,
      frontierOverflow: (layers[0]?.length ?? 0) > width,
      truncatedLayerIndex,
      scalarizationUsed: false,
      retention: "Pareto layers; partial layer uses Path/End extremes plus existing category/family diversity"
    }
  };
}

export function dedupeFuturePathHistory(nodes, futureKey, vectorFor, transactionCounter = transactionCount) {
  if (!Array.isArray(nodes)) throw new TypeError("nodes muss ein Array sein.");
  const unique = new Map();
  for (const node of nodes) {
    const vector = vectorFor(node);
    const key = `${futureKey(node)}::path=${vector.pathScore}::end=${vector.endScore}`;
    const prior = unique.get(key);
    if (!prior ||
        transactionCounter(node) < transactionCounter(prior) ||
        (transactionCounter(node) === transactionCounter(prior) && stableId(node) < stableId(prior))) {
      unique.set(key, node);
    }
  }
  return [...unique.values()];
}

export function runControlledMultiobjectiveBeamCarry({
  data,
  reference,
  heroId,
  damageFocus = "hybrid",
  itemIds,
  budget,
  milestones = [],
  opponentBulletResist = 0,
  opponentSpiritResist = 0,
  slotUnlocks = [],
  beamWidth = 16,
  maxSteps = 1000,
  timeMs = Infinity,
  auditReserveMs = 0,
  profile = false
}) {
  if (!reference?.axis || !reference?.values) throw new TypeError("Frozen reference is required.");
  if (!Number.isSafeInteger(beamWidth) || beamWidth < 1) throw new RangeError("beamWidth ist ungültig.");
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1) throw new RangeError("maxSteps ist ungültig.");
  if (!Number.isSafeInteger(budget) || budget <= 0) throw new RangeError("budget ist ungültig.");
  if (!(timeMs === Infinity || (Number.isFinite(timeMs) && timeMs > 0))) throw new RangeError("timeMs ist ungültig.");
  if (!Number.isFinite(auditReserveMs) || auditReserveMs < 0 || (Number.isFinite(timeMs) && auditReserveMs >= timeMs)) {
    throw new RangeError("auditReserveMs ist ungültig.");
  }

  const started = performance.now();
  const profiler = createBeamProfiler(profile);
  const finiteDeadline = Number.isFinite(timeMs);
  const searchDeadline = finiteDeadline ? started + timeMs - auditReserveMs : Infinity;
  const finalDeadline = finiteDeadline ? started + timeMs : Infinity;
  const scenario = normalizeOpponentScenario({ opponentBulletResist, opponentSpiritResist });
  const checkpoints = normalizeMilestones(milestones, budget);
  const requestedItemIds = itemIds ? [...itemIds] : data.items.map((item) => item.item_id);
  const legalItemIds = requestedItemIds.filter((id) => heroCanPurchaseItem(data.itemsById.get(id), data, heroId));
  const compressed = carryResourceAxis(data, legalItemIds, budget);
  const expectedAxis = [...new Set([...compressed.axis, ...checkpoints])].sort((a, b) => a - b);
  if (JSON.stringify(reference.axis) !== JSON.stringify(expectedAxis)) {
    throw new Error("Frozen reference axis does not match the controlled search axis.");
  }

  const domain = createDeadlockDomain({
    data,
    itemIds: legalItemIds,
    budget,
    slotUnlocks,
    soulAxis: expectedAxis,
    metrics: () => ({ value: 0 }),
    telemetry: profiler.enabled ? profiler : null
  });
  const clean = (state) => ({ ...state, events: [], snapshots: [] });
  const request = {
    heroId,
    damageFocus,
    budget,
    cacheProfiles: false,
    metricsOnly: true,
    ...scenario
  };
  const metricCache = new Map();
  let evaluations = 0;
  const metrics = (state) => {
    const key = [...state.inventory].sort().join("|");
    if (!metricCache.has(key)) {
      profiler.count("metricCacheMisses");
      const result = profiler.time("evaluationMs", () => evaluateCarryPerformance(state, request, data));
      if (!result.valid) throw new Error(result.reason);
      metricCache.set(key, result.metrics);
      evaluations += 1;
      profiler.count("evaluatedInventories");
    } else {
      profiler.count("metricCacheHits");
    }
    return metricCache.get(key);
  };

  const root = { state: clean(domain.initial), parent: null, event: null, serial: "" };
  const pointsCache = new WeakMap();
  const vectorCache = new WeakMap();
  const nodePoints = (node) => {
    if (pointsCache.has(node)) {
      profiler.count("pointsCacheHits");
      return pointsCache.get(node);
    }
    profiler.count("pointsCacheMisses");
    return profiler.time("pathReconstructionMs", () => {
      const chain = [];
      for (let current = node; current; current = current.parent) chain.push(current);
      const points = chain.reverse().map((entry) => ({
        earnedSouls: entry.state.earnedSouls,
        metrics: metrics(entry.state)
      }));
      pointsCache.set(node, points);
      return points;
    });
  };
  const nodeVector = (node) => {
    if (vectorCache.has(node)) {
      profiler.count("vectorCacheHits");
      return vectorCache.get(node);
    }
    profiler.count("vectorCacheMisses");
    const measured = profiler.time("trajectoryScoreMs", () =>
      measureSoulAxisPath(nodePoints(node), reference, checkpoints, budget, damageFocus, profiler));
    vectorCache.set(node, {
      pathScore: measured.pathScore,
      endScore: measured.endScore,
      measurement: measured
    });
    return vectorCache.get(node);
  };

  const makeNode = (parent, nextState) => {
    const event = nextState.events[0];
    return {
      state: clean(nextState),
      parent,
      event,
      serial: `${parent.serial}|${JSON.stringify(event)}`
    };
  };

  let transitionCalls = 0;
  let generatedStates = 0;
  const transitions = (node) => profiler.time("transitionMs", () => {
    transitionCalls += 1;
    profiler.count("transitionCalls");
    const states = domain.transitions(node.state);
    generatedStates += states.length;
    profiler.count("generatedStates", states.length);
    return states.map((state) => makeNode(node, state));
  });
  const soulSummary = (nodes) => {
    if (!nodes.length) return { min: null, max: null, counts: {} };
    const counts = {};
    let min = Infinity;
    let max = -Infinity;
    for (const node of nodes) {
      const souls = node.state.earnedSouls;
      counts[souls] = (counts[souls] || 0) + 1;
      min = Math.min(min, souls);
      max = Math.max(max, souls);
    }
    return { min, max, counts };
  };
  const checkpointCounts = (nodes) => Object.fromEntries(checkpoints.map((souls) => [
    souls,
    nodes.reduce((sum, node) => sum + Number(node.state.earnedSouls === souls), 0)
  ]));

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

  const futureKey = (node) => domain.futureKey(node.state);
  const terminalNodes = new Map();
  const terminalSources = new Map();
  const observeTerminal = (node, source) => {
    if (node.state.earnedSouls !== budget) return;
    if (!terminalNodes.has(node.serial)) {
      terminalNodes.set(node.serial, node);
      profiler.count("terminalNodes");
    }
    const sources = terminalSources.get(node.serial) || new Set();
    sources.add(source);
    terminalSources.set(node.serial, sources);
  };

  let beam = [root];
  let steps = 0;
  let duplicateStates = 0;
  let maxCandidatePool = 0;
  let maxFirstFrontSize = 0;
  let frontierOverflowSteps = 0;
  let maxParetoLayerCount = 0;
  const selectionTrace = [];

  let deadlineReached = false;
  let maxReachedSouls = 0;
  const beamSearchStartedAt = profiler.enabled ? performance.now() : 0;
  while (beam.length && steps < maxSteps && performance.now() < searchDeadline) {
    const candidates = [];
    let partialStep = false;
    for (const node of beam) {
      if (performance.now() >= searchDeadline) {
        partialStep = true;
        deadlineReached = true;
        break;
      }
      if (node.state.earnedSouls === budget) {
        observeTerminal(node, "retained-terminal");
        continue;
      }
      const successors = transitions(node);
      for (const successor of successors) {
        if (successor.state.earnedSouls === budget) observeTerminal(successor, "generated-terminal");
      }
      candidates.push(...successors);
    }
    if (partialStep) break;
    if (!candidates.length) { beam = []; break; }

    maxCandidatePool = Math.max(maxCandidatePool, candidates.length);
    maxReachedSouls = Math.max(maxReachedSouls, ...candidates.map((node) => node.state.earnedSouls));
    const unique = profiler.time("dedupeMs", () =>
      dedupeFuturePathHistory(candidates, futureKey, nodeVector));
    duplicateStates += candidates.length - unique.length;
    profiler.count("uniqueStates", unique.length);
    profiler.count("duplicateStates", candidates.length - unique.length);
    const selection = selectPathEndParetoBeam(unique, beamWidth, nodeVector, diversityKey, profiler);
    maxFirstFrontSize = Math.max(maxFirstFrontSize, selection.metadata.firstFrontSize);
    maxParetoLayerCount = Math.max(maxParetoLayerCount, selection.metadata.layerSizes.length);
    if (selection.metadata.frontierOverflow) frontierOverflowSteps += 1;
    selectionTrace.push({
      step: steps,
      candidates: candidates.length,
      unique: unique.length,
      retained: selection.selected.length,
      ...selection.metadata
    });
    if (profiler.enabled) {
      profiler.pushProgress({
        engine: "multiobjective",
        width: beamWidth,
        depth: steps,
        runtimeMs: performance.now() - started,
        candidates: candidates.length,
        unique: unique.length,
        retained: selection.selected.length,
        firstFrontSize: selection.metadata.firstFrontSize,
        layerSizes: selection.metadata.layerSizes,
        candidateSouls: soulSummary(candidates),
        uniqueSouls: soulSummary(unique),
        retainedSouls: soulSummary(selection.selected),
        checkpointCounts: {
          candidates: checkpointCounts(candidates),
          unique: checkpointCounts(unique),
          retained: checkpointCounts(selection.selected)
        }
      });
    }
    beam = selection.selected;
    steps += 1;
  }

  if (profiler.enabled) profiler.add("beamSearchMs", performance.now() - beamSearchStartedAt);
  if (finiteDeadline && performance.now() >= searchDeadline && beam.length) deadlineReached = true;
  const searchComplete = beam.length === 0;
  if (!searchComplete && steps >= maxSteps && !deadlineReached) {
    throw new Error(`Controlled multiobjective search exceeded maxSteps=${maxSteps}.`);
  }

  const terminalEntries = () => [...terminalNodes.values()].map((node) => {
    const vector = nodeVector(node);
    return {
      id: node.serial,
      node,
      pathScore: vector.pathScore,
      endScore: vector.endScore
    };
  });

  const preAuditFront = profiler.time("paretoMs", () => pathEndParetoFront(terminalEntries()));
  let auditCheckedActions = 0;
  let auditGeneratedStates = 0;
  let auditComplete = searchComplete;
  const terminalAuditStartedAt = profiler.enabled ? performance.now() : 0;
  if (searchComplete) {
    auditLoop: for (const entry of preAuditFront) {
      if (performance.now() >= finalDeadline) { auditComplete = false; break; }
      const before = generatedStates;
      const actions = transitions(entry.node).filter((candidate) =>
        ["purchase", "upgrade", "replacement"].includes(candidate.event?.type)
      );
      auditGeneratedStates += generatedStates - before;
      for (const candidate of actions) {
        if (performance.now() >= finalDeadline) { auditComplete = false; break auditLoop; }
        auditCheckedActions += 1;
        observeTerminal(candidate, "direct-terminal-audit");
      }
    }
  }

  if (profiler.enabled) profiler.add("terminalAuditMs", performance.now() - terminalAuditStartedAt);
  const finalEntries = profiler.time("paretoMs", () => pathEndParetoFront(terminalEntries()));
  const front = finalEntries.map((entry) => {
    const node = entry.node;
    const vector = nodeVector(node);
    const points = nodePoints(node);
    const state = {
      ...node.state,
      inventory: [...node.state.inventory],
      events: eventChain(node),
      snapshots: points
    };
    const validation = profiler.time("validationMs", () => validateSearchPath({
      data,
      itemIds: legalItemIds,
      budget,
      soulAxis: expectedAxis,
      slotUnlocks,
      state
    }));
    if (validation.valid !== true) throw new Error("Illegal path escaped controlled multiobjective search.");
    return {
      state,
      pathScore: vector.pathScore,
      endScore: vector.endScore,
      measurement: vector.measurement,
      transactions: transactionCount(node),
      sources: [...(terminalSources.get(node.serial) || [])].sort(),
      validation
    };
  });

  return {
    front,
    telemetry: {
      runtimeMs: performance.now() - started,
      timeBudgetMs: finiteDeadline ? timeMs : null,
      searchDeadlineMs: finiteDeadline ? timeMs - auditReserveMs : null,
      deadlineReached,
      evaluations,
      generatedStates,
      searchGeneratedStates: generatedStates - auditGeneratedStates,
      auditGeneratedStates,
      transitionCalls,
      duplicateStates,
      beamWidth,
      steps,
      maxCandidatePool,
      maxReachedSouls,
      maxFirstFrontSize,
      frontierOverflowSteps,
      maxParetoLayerCount,
      terminalCandidates: terminalNodes.size,
      preAuditFrontSize: preAuditFront.length,
      finalFrontSize: front.length,
      terminalAudit: {
        depth: 1,
        completeDirectNeighbourhood: auditComplete,
        checkedActions: auditCheckedActions
      },
      pruning: {
        futurePathHistoryDedupe: true,
        globalParetoDominancePruning: false,
        beamTruncation: "Pareto layers; partial layer uses Path/End extremes plus existing diversity"
      },
      scalarizationUsed: false,
      partialVectorSemantics: "Path/End of the legal save-to-horizon completion of the current partial path",
      terminalCompletion: {
        mode: "implicit_piecewise_constant_save_to_horizon_in_path_end_measurement",
        separatePass: false
      },
      searchComplete,
      selectionTrace,
      profile: profiler.snapshot({
        maxReachedSouls,
        completedDepth: steps,
        checkpointSouls: [...checkpoints]
      })
    }
  };
}

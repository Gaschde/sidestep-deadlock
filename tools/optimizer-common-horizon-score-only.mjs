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
  selectPathEndParetoBeamCommonHorizonShadow,
  selectPathEndParetoBeamCommonHorizonScoreOnlyShadow
} from "../app/multiobjective-search.mjs";
import { pathEndParetoFront } from "../app/path-end-pareto.mjs";
import { benchmarkCases } from "../benchmarks/optimizer-v1/cases.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const REFERENCE_FILE = resolve(ROOT, "benchmarks/optimizer-v1/references/baseline-v0.json");
const DIVERGENCE_FILE = resolve(ROOT, "benchmarks/optimizer-v1/experiments/search-divergence-diagnosis/results.json");
const MATERIALIZED_RESULT_FILE = resolve(
  ROOT,
  "benchmarks/optimizer-v1/experiments/common-horizon-retention-shadow/results.json"
);
const DEFAULT_OUTPUT = resolve(ROOT, "artifacts/common-horizon-score-only/results.json");
const WIDTH = 4;
const DIVERGENCE_DEPTH = 14;
const TARGET_PATH_ID = "93260772842f0c27";
const KNOWN_PATH = 0.4417724595;
const KNOWN_END = 0.4459173427;
const VECTOR_TOLERANCE = 1e-12;
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

function createDiagnosticRuntime(data, definition, reference) {
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
    horizonVectorEvaluations: 0,
    horizonVectorCacheHits: 0,
    horizonVectorCacheMisses: 0
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
    if (cache.has(node)) {
      counters.horizonVectorCacheHits += 1;
      return cache.get(node);
    }
    counters.horizonVectorCacheMisses += 1;
    counters.horizonVectorEvaluations += 1;
    const measurement = measureSoulAxisPath(
      nodePoints(node), reference, checkpoints, horizon, definition.focus, null, SWEET
    );
    const vector = {
      pathScore: measurement.pathScore,
      endScore: measurement.endScore,
      measurement
    };
    cache.set(node, vector);
    return vector;
  };

  const parent = new Map(data.upgrades.map((edge) => [edge.to_item_id, edge.from_item_id]));
  const familyCache = new Map();
  const rootFamily = (id) => {
    if (familyCache.has(id)) return familyCache.get(id);
    let current = id;
    const seen = new Set();
    while (parent.has(current) && !seen.has(current)) {
      seen.add(current);
      current = parent.get(current);
    }
    familyCache.set(id, current);
    return current;
  };
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

function layerMap(nodes, vectorFor) {
  const decorated = nodes.map((node) => {
    const vector = vectorFor(node);
    return {
      node,
      id: pathId(eventChain(node)),
      pathScore: vector.pathScore,
      endScore: vector.endScore
    };
  });
  const layers = pathEndNonDominatedLayers(decorated);
  const map = new Map();
  layers.forEach((layer, index) => {
    for (const entry of layer) map.set(entry.node, index);
  });
  return { layers, map };
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

function stage1Equivalence(rt, storedMaterialized) {
  const pool = runDivergencePool(rt);
  if (pool.unique.length !== 248) {
    throw new Error("Expected 248 divergence candidates, got " + pool.unique.length + ".");
  }
  const target = pool.unique.find((node) => pathId(eventChain(node)) === TARGET_PATH_ID);
  if (!target) throw new Error("Known target seed missing at divergence.");

  const baseline = selectPathEndParetoBeam(pool.unique, WIDTH, rt.vectorFor, rt.diversityKey);
  const baselineLayers = layerMap(pool.unique, rt.vectorFor);

  const beforeMaterialized = { ...rt.counters };
  const materialized = selectPathEndParetoBeamCommonHorizonShadow(
    pool.unique,
    WIDTH,
    rt.vectorFor,
    rt.vectorForHorizon,
    rt.saveOnlyTransitions,
    rt.diversityKey
  );
  const materializedCounterDelta = Object.fromEntries(
    Object.keys(rt.counters).map((key) => [key, rt.counters[key] - beforeMaterialized[key]])
  );
  if (!materialized.shadowProjection.applied) {
    throw new Error("Materialized shadow did not apply at known divergence.");
  }

  const commonHorizon = materialized.shadowProjection.commonHorizon;
  const projectedByOriginal = new Map(
    materialized.projectionEntries.map((entry) => [entry.originalNode, entry.projectedNode])
  );
  const materializedVector = (node) =>
    rt.vectorForHorizon(projectedByOriginal.get(node) || node, commonHorizon);

  const beforeScoreOnly = { ...rt.counters };
  const scoreOnly = selectPathEndParetoBeamCommonHorizonScoreOnlyShadow(
    pool.unique,
    WIDTH,
    rt.vectorFor,
    rt.vectorForHorizon,
    rt.diversityKey
  );
  const scoreOnlyCounterDelta = Object.fromEntries(
    Object.keys(rt.counters).map((key) => [key, rt.counters[key] - beforeScoreOnly[key]])
  );
  if (!scoreOnly.shadowProjection.applied) {
    throw new Error("Score-only shadow did not apply at known divergence.");
  }
  if (scoreOnly.shadowProjection.commonHorizon !== commonHorizon) {
    throw new Error("Materialized and score-only chose different common horizons.");
  }

  const scoreOnlyVector = (node) => rt.vectorForHorizon(node, commonHorizon);
  const materializedLayers = layerMap(pool.unique, materializedVector);
  const scoreOnlyLayers = layerMap(pool.unique, scoreOnlyVector);

  let maxAbsPathDifference = 0;
  let maxAbsEndDifference = 0;
  let vectorMismatches = 0;
  let layerMismatches = 0;
  const comparisons = pool.unique.map((node) => {
    const materializedV = materializedVector(node);
    const scoreOnlyV = scoreOnlyVector(node);
    const pathDifference = Math.abs(materializedV.pathScore - scoreOnlyV.pathScore);
    const endDifference = Math.abs(materializedV.endScore - scoreOnlyV.endScore);
    maxAbsPathDifference = Math.max(maxAbsPathDifference, pathDifference);
    maxAbsEndDifference = Math.max(maxAbsEndDifference, endDifference);
    if (pathDifference > VECTOR_TOLERANCE || endDifference > VECTOR_TOLERANCE) vectorMismatches += 1;
    const materializedLayer = materializedLayers.map.get(node);
    const scoreOnlyLayer = scoreOnlyLayers.map.get(node);
    if (materializedLayer !== scoreOnlyLayer) layerMismatches += 1;
    return {
      pathId: pathId(eventChain(node)),
      earnedSouls: node.state.earnedSouls,
      materialized: {
        pathScore: materializedV.pathScore,
        endScore: materializedV.endScore,
        layer: materializedLayer
      },
      scoreOnly: {
        pathScore: scoreOnlyV.pathScore,
        endScore: scoreOnlyV.endScore,
        layer: scoreOnlyLayer
      },
      absDifference: { pathScore: pathDifference, endScore: endDifference }
    };
  });

  const ids = (selection) => selection.selected.map((node) => pathId(eventChain(node)));
  const baselineIds = ids(baseline);
  const materializedIds = ids(materialized);
  const scoreOnlyIds = ids(scoreOnly);
  const retentionIdentical = JSON.stringify(materializedIds) === JSON.stringify(scoreOnlyIds);
  const selectedOriginalOnly = scoreOnly.selected.every((node) => pool.unique.includes(node));
  const targetMaterialized = compactVector(materializedVector(target));
  const targetScoreOnly = compactVector(scoreOnlyVector(target));
  const targetBaselineLayer = baselineLayers.map.get(target);
  const targetMaterializedLayer = materializedLayers.map.get(target);
  const targetScoreOnlyLayer = scoreOnlyLayers.map.get(target);

  const storedTarget = storedMaterialized.stage1?.shadow?.targetProjection?.projected;
  const storedTargetMatches = Boolean(storedTarget) &&
    Math.abs(storedTarget.pathScore - targetMaterialized.pathScore) <= VECTOR_TOLERANCE &&
    Math.abs(storedTarget.endScore - targetMaterialized.endScore) <= VECTOR_TOLERANCE;

  return {
    target,
    report: {
      candidateCount: pool.unique.length,
      tolerance: VECTOR_TOLERANCE,
      commonHorizon,
      maxAbsPathDifference,
      maxAbsEndDifference,
      vectorMismatchesAboveTolerance: vectorMismatches,
      paretoLayerMismatches: layerMismatches,
      retentionIdentical,
      materializedRetainedPathIds: materializedIds,
      scoreOnlyRetainedPathIds: scoreOnlyIds,
      selectedOriginalOnly,
      baseline: {
        targetLayer: targetBaselineLayer,
        targetRetained: baselineIds.includes(TARGET_PATH_ID)
      },
      materialized: {
        targetLayer: targetMaterializedLayer,
        targetRetained: materializedIds.includes(TARGET_PATH_ID),
        targetVector: targetMaterialized,
        projectedCandidates: materialized.shadowProjection.projectedCandidates,
        materializedProjectedNodes: materialized.shadowProjection.materializedProjectedNodes,
        saveTransitions: materialized.shadowProjection.saveTransitions,
        projectionRuntimeMs: materialized.shadowProjection.projectionRuntimeMs,
        horizonScoreRuntimeMs: materialized.shadowProjection.horizonScoreRuntimeMs,
        counterDelta: materializedCounterDelta
      },
      scoreOnly: {
        targetLayer: targetScoreOnlyLayer,
        targetRetained: scoreOnlyIds.includes(TARGET_PATH_ID),
        targetVector: targetScoreOnly,
        scoreOnlyProjections: scoreOnly.shadowProjection.scoreOnlyProjections,
        materializedProjectedNodes: scoreOnly.shadowProjection.materializedProjectedNodes,
        saveTransitions: scoreOnly.shadowProjection.saveTransitions,
        projectionRuntimeMs: scoreOnly.shadowProjection.projectionRuntimeMs,
        horizonScoreRuntimeMs: scoreOnly.shadowProjection.horizonScoreRuntimeMs,
        counterDelta: scoreOnlyCounterDelta
      },
      storedMaterializedTargetMatches: storedTargetMatches,
      comparisons
    }
  };
}

function continueOriginalTo40k(rt, seed, budget) {
  const started = performance.now();
  const countersAtStart = { ...rt.counters };
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
  let maxCandidatePool = 0;
  let earlySaveCompletionMaterialized = false;
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
      endScore: vector.endScore
    };
  });
  const front = pathEndParetoFront(entries);
  const qualifying = front.filter((entry) =>
    entry.pathScore + EPS >= KNOWN_PATH && entry.endScore + EPS >= KNOWN_END
  );
  const delta = Object.fromEntries(
    Object.keys(rt.counters).map((key) => [key, rt.counters[key] - countersAtStart[key]])
  );
  return {
    runtimeMs: performance.now() - started,
    steps,
    duplicateStates,
    maxCandidatePool,
    terminalCandidates: terminals.size,
    frontSize: front.length,
    reached40k: front.every((entry) => entry.node.state.earnedSouls === budget),
    meetsKnownOutput: qualifying.length > 0,
    qualifying: qualifying.map((entry) => ({
      id: entry.id,
      pathScore: entry.pathScore,
      endScore: entry.endScore
    })),
    counterDelta: delta
  };
}

function frontSummary(result) {
  return result.front.map((entry) => ({
    id: pathId(entry.state.events),
    pathScore: entry.pathScore,
    endScore: entry.endScore,
    earnedSouls: entry.state.earnedSouls,
    inventory: [...entry.state.inventory],
    transactions: entry.transactions
  })).sort((a, b) => a.id.localeCompare(b.id));
}

function compactPerformance(result) {
  const telemetry = result.telemetry;
  const profile = telemetry.profile;
  if (!profile) throw new Error("Performance run requires profiling.");
  return {
    wallclockTotalMs: telemetry.runtimeMs,
    searchRuntimeMs: profile.timers.beamSearchMs,
    retentionRuntimeMs: profile.timers.retentionMs,
    frontierMaintenanceRuntimeMs: profile.timers.frontierMaintenanceMs,
    paretoRuntimeMs: profile.timers.paretoMs,
    trajectoryScoreRuntimeMs: profile.timers.trajectoryScoreMs,
    evaluationRuntimeMs: profile.timers.evaluationMs,
    transitionRuntimeMs: profile.timers.transitionMs,
    pathReconstructionRuntimeMs: profile.timers.pathReconstructionMs,
    dedupeRuntimeMs: profile.timers.dedupeMs,
    terminalCompletionRuntimeMs: profile.timers.terminalCompletionMs,
    evaluations: telemetry.evaluations,
    generatedStates: telemetry.generatedStates,
    searchGeneratedStates: telemetry.searchGeneratedStates,
    normalTransitionCalls: telemetry.transitionCalls,
    retentionPools: telemetry.retentionCalls,
    paretoCandidates: profile.counters.paretoCandidates,
    duplicateStates: telemetry.duplicateStates,
    steps: telemetry.steps,
    maxCandidatePool: telemetry.maxCandidatePool,
    searchComplete: telemetry.searchComplete,
    finalFront: frontSummary(result),
    cacheCounters: {
      metricHits: profile.counters.metricCacheHits,
      metricMisses: profile.counters.metricCacheMisses,
      vectorHits: profile.counters.vectorCacheHits,
      vectorMisses: profile.counters.vectorCacheMisses,
      pointsHits: profile.counters.pointsCacheHits,
      pointsMisses: profile.counters.pointsCacheMisses,
      commonHorizonVectorEvaluations: profile.counters.commonHorizonVectorEvaluations,
      commonHorizonVectorCacheHits: profile.counters.commonHorizonVectorCacheHits,
      commonHorizonVectorCacheMisses: profile.counters.commonHorizonVectorCacheMisses
    },
    commonHorizon: telemetry.commonHorizonShadow || null
  };
}

function numericDelta(left, right, keys) {
  return Object.fromEntries(keys.map((key) => [key, right[key] - left[key]]));
}

function normalizedSelectionTrace(telemetry) {
  return telemetry.selectionTrace.map(({ commonHorizonShadow: _shadow, ...entry }) => entry);
}

function runPerformanceABC(data, definition, reference, legalItemIds, slotUnlocks) {
  const args = {
    data,
    reference,
    heroId: definition.hero,
    damageFocus: definition.focus,
    objectiveConfig: SWEET,
    itemIds: legalItemIds,
    budget: definition.budget,
    milestones: definition.milestones,
    opponentBulletResist: definition.opponentBulletResist,
    opponentSpiritResist: definition.opponentSpiritResist,
    slotUnlocks,
    beamWidth: WIDTH,
    maxSteps: 1000,
    timeMs: Infinity,
    auditReserveMs: 0,
    profile: true
  };

  console.log(JSON.stringify({ phase: "performance", variant: "A-baseline" }));
  const baselineRaw = runControlledMultiobjectiveBeamCarry(args);
  console.log(JSON.stringify({ phase: "performance", variant: "B-materialized" }));
  const materializedRaw = runControlledMultiobjectiveBeamCarry({ ...args, commonHorizonShadow: true });
  console.log(JSON.stringify({ phase: "performance", variant: "C-score-only" }));
  const scoreOnlyRaw = runControlledMultiobjectiveBeamCarry({ ...args, commonHorizonScoreOnlyShadow: true });

  const baseline = compactPerformance(baselineRaw);
  const materialized = compactPerformance(materializedRaw);
  const scoreOnly = compactPerformance(scoreOnlyRaw);
  const costKeys = [
    "wallclockTotalMs",
    "searchRuntimeMs",
    "retentionRuntimeMs",
    "frontierMaintenanceRuntimeMs",
    "paretoRuntimeMs",
    "trajectoryScoreRuntimeMs",
    "evaluationRuntimeMs",
    "transitionRuntimeMs",
    "pathReconstructionRuntimeMs",
    "dedupeRuntimeMs",
    "terminalCompletionRuntimeMs",
    "evaluations",
    "generatedStates",
    "searchGeneratedStates",
    "normalTransitionCalls",
    "retentionPools",
    "paretoCandidates",
    "duplicateStates",
    "steps",
    "maxCandidatePool"
  ];

  const materializedVsBaseline = numericDelta(baseline, materialized, costKeys);
  const scoreOnlyVsBaseline = numericDelta(baseline, scoreOnly, costKeys);
  const scoreOnlyVsMaterialized = numericDelta(materialized, scoreOnly, costKeys);

  const traceEqual = JSON.stringify(normalizedSelectionTrace(materializedRaw.telemetry)) ===
    JSON.stringify(normalizedSelectionTrace(scoreOnlyRaw.telemetry));
  const workShapeKeys = [
    "evaluations", "generatedStates", "searchGeneratedStates", "normalTransitionCalls",
    "retentionPools", "paretoCandidates", "duplicateStates", "steps", "maxCandidatePool"
  ];
  const workShapeEqual = workShapeKeys.every((key) => materialized[key] === scoreOnly[key]);
  const finalFrontEqual = JSON.stringify(materialized.finalFront) === JSON.stringify(scoreOnly.finalFront);

  const directMaterialized =
    Number(materialized.commonHorizon?.materializationRuntimeMs || 0) +
    Number(materialized.commonHorizon?.horizonScoreRuntimeMs || 0);
  const directScoreOnly = Number(scoreOnly.commonHorizon?.projectionRuntimeMs || 0);

  return {
    baseline,
    materialized,
    scoreOnly,
    deltas: {
      materializedVsBaseline,
      scoreOnlyVsBaseline,
      scoreOnlyVsMaterialized
    },
    semanticSearchCheck: {
      normalizedSelectionTraceEqual: traceEqual,
      workShapeEqual,
      finalFrontEqual,
      workShapeKeys
    },
    costDecomposition: {
      directProjectionAndScore: {
        materializedMs: directMaterialized,
        materializedNodeCreationMs: materialized.commonHorizon?.materializationRuntimeMs || 0,
        materializedHorizonScoreMs: materialized.commonHorizon?.horizonScoreRuntimeMs || 0,
        scoreOnlyMs: directScoreOnly,
        scoreOnlyMaterializedNodeCreationMs: scoreOnly.commonHorizon?.materializationRuntimeMs || 0,
        scoreOnlyHorizonScoreMs: scoreOnly.commonHorizon?.horizonScoreRuntimeMs || 0,
        deltaScoreOnlyMinusMaterializedMs: directScoreOnly - directMaterialized
      },
      additionalParetoRetentionVsBaseline: {
        materializedRetentionMs: materialized.retentionRuntimeMs - baseline.retentionRuntimeMs,
        scoreOnlyRetentionMs: scoreOnly.retentionRuntimeMs - baseline.retentionRuntimeMs,
        materializedParetoMs: materialized.paretoRuntimeMs - baseline.paretoRuntimeMs,
        scoreOnlyParetoMs: scoreOnly.paretoRuntimeMs - baseline.paretoRuntimeMs,
        materializedFrontierMaintenanceMs:
          materialized.frontierMaintenanceRuntimeMs - baseline.frontierMaintenanceRuntimeMs,
        scoreOnlyFrontierMaintenanceMs:
          scoreOnly.frontierMaintenanceRuntimeMs - baseline.frontierMaintenanceRuntimeMs
      },
      changedSearchTreeVsBaseline: {
        scoreOnlyTotalOverheadMs: scoreOnly.wallclockTotalMs - baseline.wallclockTotalMs,
        scoreOnlySearchRuntimeOverheadMs: scoreOnly.searchRuntimeMs - baseline.searchRuntimeMs,
        extraEvaluations: scoreOnly.evaluations - baseline.evaluations,
        extraGeneratedStates: scoreOnly.generatedStates - baseline.generatedStates,
        extraSearchGeneratedStates: scoreOnly.searchGeneratedStates - baseline.searchGeneratedStates,
        extraTransitionCalls: scoreOnly.normalTransitionCalls - baseline.normalTransitionCalls,
        extraRetentionPools: scoreOnly.retentionPools - baseline.retentionPools,
        extraParetoCandidates: scoreOnly.paretoCandidates - baseline.paretoCandidates,
        evaluationRuntimeDeltaMs: scoreOnly.evaluationRuntimeMs - baseline.evaluationRuntimeMs,
        transitionRuntimeDeltaMs: scoreOnly.transitionRuntimeMs - baseline.transitionRuntimeMs,
        trajectoryScoreRuntimeDeltaMs: scoreOnly.trajectoryScoreRuntimeMs - baseline.trajectoryScoreRuntimeMs
      },
      materializationImplementationCost: {
        totalRuntimeDifferenceMaterializedMinusScoreOnlyMs:
          materialized.wallclockTotalMs - scoreOnly.wallclockTotalMs,
        retentionRuntimeDifferenceMaterializedMinusScoreOnlyMs:
          materialized.retentionRuntimeMs - scoreOnly.retentionRuntimeMs,
        pathReconstructionDifferenceMaterializedMinusScoreOnlyMs:
          materialized.pathReconstructionRuntimeMs - scoreOnly.pathReconstructionRuntimeMs,
        trajectoryScoreDifferenceMaterializedMinusScoreOnlyMs:
          materialized.trajectoryScoreRuntimeMs - scoreOnly.trajectoryScoreRuntimeMs
      }
    }
  };
}

function main() {
  const data = loadData();
  const references = JSON.parse(readFileSync(REFERENCE_FILE, "utf8"));
  const divergence = JSON.parse(readFileSync(DIVERGENCE_FILE, "utf8"));
  const storedMaterialized = JSON.parse(readFileSync(MATERIALIZED_RESULT_FILE, "utf8"));
  const definition = benchmarkCases("production").find((entry) =>
    entry.hero === "warden" && entry.focus === "weapon"
  );
  if (!definition) throw new Error("Warden weapon production case missing.");
  const referenceEntry = references.references[definition.id];
  if (!referenceEntry?.reference) throw new Error("Frozen baseline-v0 reference missing.");
  if (divergence.firstDivergence?.target?.pathId !== TARGET_PATH_ID) {
    throw new Error("Stored divergence target mismatch.");
  }

  console.log(JSON.stringify({ phase: "stage1-equivalence" }));
  const diagnosticRt = createDiagnosticRuntime(data, definition, referenceEntry.reference);
  const stage1 = stage1Equivalence(diagnosticRt, storedMaterialized);
  const semanticEquivalent =
    stage1.report.vectorMismatchesAboveTolerance === 0 &&
    stage1.report.paretoLayerMismatches === 0 &&
    stage1.report.retentionIdentical &&
    stage1.report.selectedOriginalOnly &&
    stage1.report.scoreOnly.materializedProjectedNodes === 0 &&
    stage1.report.scoreOnly.saveTransitions === 0 &&
    stage1.report.scoreOnly.targetRetained &&
    stage1.report.scoreOnly.targetLayer === 0;

  console.log(JSON.stringify({ phase: "stage2-original-continuation" }));
  const stage2Continuation = semanticEquivalent
    ? continueOriginalTo40k(diagnosticRt, stage1.target, definition.budget)
    : { skipped: true, reason: "semantic-equivalence-failed" };

  console.log(JSON.stringify({ phase: "stage3-performance-abc" }));
  const stage3 = semanticEquivalent
    ? runPerformanceABC(
        data,
        definition,
        referenceEntry.reference,
        diagnosticRt.legalItemIds,
        diagnosticRt.slotUnlocks
      )
    : { skipped: true, reason: "semantic-equivalence-failed" };

  let fullScoreOnlyKnownPath = null;
  let fullMaterializedScoreOnlyEquivalent = null;
  if (!stage3.skipped) {
    fullScoreOnlyKnownPath = stage3.scoreOnly.finalFront.some((entry) =>
      entry.pathScore + EPS >= KNOWN_PATH && entry.endScore + EPS >= KNOWN_END
    );
    fullMaterializedScoreOnlyEquivalent =
      stage3.semanticSearchCheck.normalizedSelectionTraceEqual &&
      stage3.semanticSearchCheck.workShapeEqual &&
      stage3.semanticSearchCheck.finalFrontEqual;
  }

  const warnings = [];
  if (!semanticEquivalent) warnings.push("stage1-semantic-equivalence-failed");
  if (!stage2Continuation.skipped && !stage2Continuation.meetsKnownOutput) {
    warnings.push("rescued-original-node-misses-known-40k-output");
  }
  if (fullScoreOnlyKnownPath === false) warnings.push("full-score-only-search-misses-known-40k-output");
  if (fullMaterializedScoreOnlyEquivalent === false) {
    warnings.push("materialized-and-score-only-full-search-shape-differ");
  }

  const result = {
    schemaVersion: "optimizer-common-horizon-score-only-shadow-v1",
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
    sourceMaterializedResult: {
      schemaVersion: storedMaterialized.schemaVersion,
      sourceCommit: storedMaterialized.sourceCommit,
      baselineRuntimeMs: storedMaterialized.stage3?.baseline?.runtimeMs ?? null,
      materializedRuntimeMs: storedMaterialized.stage3?.shadow?.runtimeMs ?? null
    },
    exactEquivalenceRationale:
      "measureSoulAxisPath integrates a piecewise-constant actual path on the union of path/reference changes plus H. Pure save projection preserves inventory metrics, so a materialized save point at H (and any intermediate save points) only repeats the same metrics. Evaluating the original prefix directly with budget=H therefore yields identical Path-AUC and Endbuild.",
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
      baselineDefaultChanged: false
    },
    stage1: stage1.report,
    stage2: {
      originalNodeContinuation: stage2Continuation,
      fullScoreOnlyKnownPath,
      materializedVsScoreOnlyFullSearchEquivalent: fullMaterializedScoreOnlyEquivalent
    },
    stage3,
    warnings
  };

  const target = outputPath();
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({
    status: "COMPLETE",
    output: target,
    semanticEquivalent,
    maxAbsPathDifference: stage1.report.maxAbsPathDifference,
    maxAbsEndDifference: stage1.report.maxAbsEndDifference,
    targetLayerBaseline: stage1.report.baseline.targetLayer,
    targetLayerMaterialized: stage1.report.materialized.targetLayer,
    targetLayerScoreOnly: stage1.report.scoreOnly.targetLayer,
    continuationMeetsKnownOutput: stage2Continuation.skipped ? null : stage2Continuation.meetsKnownOutput,
    fullScoreOnlyKnownPath,
    materializedVsScoreOnlyFullSearchEquivalent: fullMaterializedScoreOnlyEquivalent,
    runtimes: stage3.skipped ? null : {
      baselineMs: stage3.baseline.wallclockTotalMs,
      materializedMs: stage3.materialized.wallclockTotalMs,
      scoreOnlyMs: stage3.scoreOnly.wallclockTotalMs
    },
    warnings
  }));
}

try {
  main();
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
}

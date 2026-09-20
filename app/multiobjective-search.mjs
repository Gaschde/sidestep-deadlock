import { createDeadlockDomain } from "./deadlock-domain.mjs";
import { heroCanPurchaseItem } from "./optimizer.mjs";
import { carryResourceAxis, evaluateCarryPerformance } from "./warden-search.mjs";
import { normalizeMilestones } from "./search-milestones.mjs";
import { normalizeOpponentScenario } from "./search-scenarios.mjs";
import { measureSoulAxisPath } from "./search-objective-v1.mjs";
import { validateSearchPath } from "./validate-search-path.mjs";
import { createBeamProfiler } from "./search-telemetry.mjs";
import { buildSampledCarryReference } from "./sampled-reference.mjs";
import { pathEndDominates, pathEndParetoFront } from "./path-end-pareto.mjs";

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

export function completeNodeBySaving(node, budget, transitions, deadline = Infinity) {
  if (!node?.state) throw new TypeError("node.state fehlt.");
  if (!Number.isSafeInteger(budget) || budget <= 0) throw new RangeError("budget ist ungültig.");
  if (typeof transitions !== "function") throw new TypeError("transitions muss eine Funktion sein.");
  let current = node;
  while (current.state.earnedSouls < budget) {
    if (performance.now() >= deadline) return null;
    const save = transitions(current).find((candidate) => candidate.event?.type === "save");
    if (!save) throw new Error("Legal save completion unavailable.");
    current = save;
  }
  if (current.state.earnedSouls !== budget) throw new Error("Save completion overshot the configured horizon.");
  return current;
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

function extractNextPathEndLayer(remaining, profiler = null) {
  const timedSort = (array, compare) => profiler?.enabled
    ? profiler.time("sortingMs", () => array.sort(compare))
    : array.sort(compare);
  const front = remaining.filter((candidate, index) =>
    !remaining.some((other, otherIndex) => otherIndex !== index && pathEndDominates(other, candidate))
  );
  if (!front.length) throw new Error("Pareto layering made no progress.");
  timedSort(front, (a, b) => stableId(a).localeCompare(stableId(b)));
  const selected = new Set(front);
  for (let index = remaining.length - 1; index >= 0; index -= 1) {
    if (selected.has(remaining[index])) remaining.splice(index, 1);
  }
  return front;
}

export function pathEndNonDominatedLayers(entries, profiler = null) {
  if (!Array.isArray(entries)) throw new TypeError("entries muss ein Array sein.");
  const remaining = [...entries];
  const layers = [];
  while (remaining.length) layers.push(extractNextPathEndLayer(remaining, profiler));
  return layers;
}

export function pathEndLazyNonDominatedLayers(entries, requiredCount, profiler = null) {
  if (!Array.isArray(entries)) throw new TypeError("entries muss ein Array sein.");
  if (!Number.isSafeInteger(requiredCount) || requiredCount < 1) {
    throw new RangeError("requiredCount muss positiv ganzzahlig sein.");
  }
  const remaining = [...entries];
  const layers = [];
  let layeredCount = 0;
  while (remaining.length && layeredCount < requiredCount) {
    const front = extractNextPathEndLayer(remaining, profiler);
    layers.push(front);
    layeredCount += front.length;
  }
  return {
    layers,
    layeredCount,
    unlayeredCount: remaining.length,
    complete: remaining.length === 0
  };
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

function retainPathEndParetoLayers(layers, width, diversityKey, profiler = null, layering = null) {
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

  return {
    selected: selected.map((entry) => entry.node),
    metadata: {
      layerSizes: layers.map((layer) => layer.length),
      firstFrontSize: layers[0]?.length ?? 0,
      firstFrontFullyRetained: (layers[0]?.length ?? 0) <= width,
      frontierOverflow: (layers[0]?.length ?? 0) > width,
      truncatedLayerIndex,
      scalarizationUsed: false,
      lazyLayering: layering !== null,
      layeringComplete: layering?.complete ?? true,
      layeredCandidates: layering?.layeredCount ?? layers.reduce((sum, layer) => sum + layer.length, 0),
      unlayeredCandidates: layering?.unlayeredCount ?? 0,
      retention: "Pareto layers; partial layer uses Path/End extremes plus existing category/family diversity"
    }
  };
}

function decoratePathEndNodes(nodes, vectorFor) {
  return nodes.map((node) => {
    const vector = vectorFor(node);
    return {
      node,
      id: stableId(node),
      pathScore: vector.pathScore,
      endScore: vector.endScore
    };
  });
}

export function selectPathEndParetoBeam(nodes, width, vectorFor, diversityKey = () => "", profiler = null) {
  if (!Array.isArray(nodes)) throw new TypeError("nodes muss ein Array sein.");
  if (!Number.isSafeInteger(width) || width < 1) throw new RangeError("width muss positiv ganzzahlig sein.");
  if (typeof vectorFor !== "function") throw new TypeError("vectorFor muss eine Funktion sein.");

  const frontierStartedAt = profiler?.enabled ? performance.now() : 0;
  const decorated = decoratePathEndNodes(nodes, vectorFor);
  profiler?.count?.("paretoCandidates", decorated.length);
  const layering = profiler?.enabled
    ? profiler.time("paretoMs", () => pathEndLazyNonDominatedLayers(decorated, width, profiler))
    : pathEndLazyNonDominatedLayers(decorated, width, profiler);
  const result = retainPathEndParetoLayers(layering.layers, width, diversityKey, profiler, layering);

  if (profiler?.enabled) profiler.add("frontierMaintenanceMs", performance.now() - frontierStartedAt);
  return result;
}

function exactPathEndLayerIndices(nodes, vectorFor) {
  const rows = decoratePathEndNodes(nodes, vectorFor);
  const endValues = [...new Set(rows.map((entry) => entry.endScore))].sort((a, b) => b - a);
  const endIndex = new Map(endValues.map((value, index) => [value, index + 1]));
  const fenwick = new Array(endValues.length + 1).fill(0);
  const query = (index) => {
    let best = 0;
    for (let current = index; current > 0; current -= current & -current) {
      best = Math.max(best, fenwick[current]);
    }
    return best;
  };
  const update = (index, value) => {
    for (let current = index; current < fenwick.length; current += current & -current) {
      fenwick[current] = Math.max(fenwick[current], value);
    }
  };

  rows.sort((a, b) =>
    b.pathScore - a.pathScore ||
    b.endScore - a.endScore ||
    stableId(a).localeCompare(stableId(b))
  );

  const layers = new Map();
  for (let index = 0; index < rows.length;) {
    const pathScore = rows[index].pathScore;
    const endScore = rows[index].endScore;
    let end = index + 1;
    while (end < rows.length &&
      rows[end].pathScore === pathScore &&
      rows[end].endScore === endScore) end += 1;

    const coordinate = endIndex.get(endScore);
    const layer = query(coordinate);
    for (let cursor = index; cursor < end; cursor += 1) layers.set(rows[cursor].node, layer);
    update(coordinate, layer + 1);
    index = end;
  }
  return layers;
}

function parentDistance(descendant, ancestor) {
  let current = descendant;
  let distance = 0;
  while (current && current !== ancestor) {
    current = current.parent;
    distance += 1;
  }
  if (current !== ancestor) throw new Error("Projected save node is not descended from its original node.");
  return distance;
}

function commonHorizonPlan(nodes) {
  const soulLevels = [...new Set(nodes.map((node) => node?.state?.earnedSouls))]
    .filter((souls) => Number.isSafeInteger(souls) && souls >= 0)
    .sort((a, b) => a - b);
  if (soulLevels.length < 2) {
    return { applied: false, reason: "single-economic-horizon", soulLevels, commonHorizon: null };
  }
  const commonHorizon = soulLevels[1];
  if (soulLevels.some((souls) => souls > commonHorizon)) {
    return {
      applied: false,
      reason: "pool-spans-beyond-next-economic-horizon",
      soulLevels,
      commonHorizon: null
    };
  }
  return {
    applied: true,
    reason: "next-present-economic-horizon",
    soulLevels,
    commonHorizon
  };
}

export function selectPathEndParetoBeamCommonHorizonShadow(
  nodes,
  width,
  vectorFor,
  vectorForHorizon,
  saveTransitions,
  diversityKey = () => "",
  deadline = Infinity,
  profiler = null
) {
  if (!Array.isArray(nodes)) throw new TypeError("nodes muss ein Array sein.");
  if (!Number.isSafeInteger(width) || width < 1) throw new RangeError("width muss positiv ganzzahlig sein.");
  if (typeof vectorFor !== "function") throw new TypeError("vectorFor muss eine Funktion sein.");
  if (typeof vectorForHorizon !== "function") throw new TypeError("vectorForHorizon muss eine Funktion sein.");
  if (typeof saveTransitions !== "function") throw new TypeError("saveTransitions muss eine Funktion sein.");

  const plan = commonHorizonPlan(nodes);
  const soulLevels = plan.soulLevels;
  const projectionStartedAt = performance.now();
  const fallback = (reason, error = null, projectionEntries = []) => {
    const selection = selectPathEndParetoBeam(nodes, width, vectorFor, diversityKey, profiler);
    return {
      ...selection,
      shadowProjection: {
        enabled: true,
        applied: false,
        reason,
        error,
        soulLevels,
        commonHorizon: null,
        mode: "materialized",
        projectedCandidates: projectionEntries.length,
        scoreOnlyProjections: 0,
        materializedProjectedNodes: projectionEntries.length,
        saveTransitions: projectionEntries.reduce((sum, entry) => sum + entry.saveSteps, 0),
        maxSaveStepsPerCandidate: projectionEntries.reduce((max, entry) => Math.max(max, entry.saveSteps), 0),
        projectionRuntimeMs: performance.now() - projectionStartedAt,
        materializationRuntimeMs: performance.now() - projectionStartedAt,
        horizonScoreRuntimeMs: 0,
        horizonVectorRequests: 0
      },
      projectionEntries
    };
  };

  if (!plan.applied) return fallback(plan.reason);
  const commonHorizon = plan.commonHorizon;

  const projectedByOriginal = new Map();
  const projectionEntries = [];
  for (const node of nodes) {
    if (node.state.earnedSouls >= commonHorizon) continue;
    let projected;
    try {
      projected = completeNodeBySaving(node, commonHorizon, saveTransitions, deadline);
    } catch (error) {
      return fallback("save-projection-failed", error?.message || String(error), projectionEntries);
    }
    if (!projected) return fallback("save-projection-deadline", null, projectionEntries);
    if (projected.state.earnedSouls !== commonHorizon) {
      return fallback("save-projection-did-not-reach-horizon", null, projectionEntries);
    }
    const saveSteps = parentDistance(projected, node);
    projectedByOriginal.set(node, projected);
    projectionEntries.push({ originalNode: node, projectedNode: projected, saveSteps });
  }

  const materializationRuntimeMs = performance.now() - projectionStartedAt;
  let horizonScoreRuntimeMs = 0;
  let horizonVectorRequests = 0;
  const retentionVector = (node) => {
    const started = performance.now();
    try {
      horizonVectorRequests += 1;
      return vectorForHorizon(projectedByOriginal.get(node) || node, commonHorizon);
    } finally {
      horizonScoreRuntimeMs += performance.now() - started;
    }
  };
  const selection = selectPathEndParetoBeam(nodes, width, retentionVector, diversityKey, profiler);
  const saveTransitionsUsed = projectionEntries.reduce((sum, entry) => sum + entry.saveSteps, 0);
  return {
    ...selection,
    shadowProjection: {
      enabled: true,
      applied: true,
      reason: "next-present-economic-horizon",
      error: null,
      soulLevels,
      commonHorizon,
      mode: "materialized",
      projectedCandidates: projectionEntries.length,
      scoreOnlyProjections: 0,
      materializedProjectedNodes: projectionEntries.length,
      saveTransitions: saveTransitionsUsed,
      maxSaveStepsPerCandidate: projectionEntries.reduce((max, entry) => Math.max(max, entry.saveSteps), 0),
      projectionRuntimeMs: materializationRuntimeMs,
      materializationRuntimeMs,
      horizonScoreRuntimeMs,
      horizonVectorRequests
    },
    projectionEntries
  };
}

export function selectPathEndParetoBeamCommonHorizonScoreOnlyShadow(
  nodes,
  width,
  vectorFor,
  vectorForHorizon,
  diversityKey = () => "",
  profiler = null
) {
  if (!Array.isArray(nodes)) throw new TypeError("nodes muss ein Array sein.");
  if (!Number.isSafeInteger(width) || width < 1) throw new RangeError("width muss positiv ganzzahlig sein.");
  if (typeof vectorFor !== "function") throw new TypeError("vectorFor muss eine Funktion sein.");
  if (typeof vectorForHorizon !== "function") throw new TypeError("vectorForHorizon muss eine Funktion sein.");

  const planStartedAt = performance.now();
  const plan = commonHorizonPlan(nodes);
  const planningRuntimeMs = performance.now() - planStartedAt;
  const fallback = () => {
    const selection = selectPathEndParetoBeam(nodes, width, vectorFor, diversityKey, profiler);
    return {
      ...selection,
      shadowProjection: {
        enabled: true,
        mode: "score-only",
        applied: false,
        reason: plan.reason,
        error: null,
        soulLevels: plan.soulLevels,
        commonHorizon: null,
        projectedCandidates: 0,
        scoreOnlyProjections: 0,
        materializedProjectedNodes: 0,
        saveTransitions: 0,
        maxSaveStepsPerCandidate: 0,
        projectionRuntimeMs: planningRuntimeMs,
        materializationRuntimeMs: 0,
        horizonScoreRuntimeMs: 0,
        horizonVectorRequests: 0
      },
      projectionEntries: []
    };
  };
  if (!plan.applied) return fallback();

  const commonHorizon = plan.commonHorizon;
  const scoreOnlyProjections = nodes.reduce(
    (sum, node) => sum + Number(node.state.earnedSouls < commonHorizon),
    0
  );
  let horizonScoreRuntimeMs = 0;
  let horizonVectorRequests = 0;

  // Exact equivalence to materialized save projection:
  // measureSoulAxisPath is piecewise-constant and always inserts the requested
  // budget/common horizon into its integration axis. A pure save changes no
  // inventory metrics, so adding a virtual point at H with the same metrics as
  // the original node cannot change Path-AUC or Endbuild at H. Evaluating the
  // original path prefix directly at H therefore produces the same vector.
  const retentionVector = (node) => {
    const started = performance.now();
    try {
      horizonVectorRequests += 1;
      return vectorForHorizon(node, commonHorizon);
    } finally {
      horizonScoreRuntimeMs += performance.now() - started;
    }
  };
  const selection = selectPathEndParetoBeam(nodes, width, retentionVector, diversityKey, profiler);
  return {
    ...selection,
    shadowProjection: {
      enabled: true,
      mode: "score-only",
      applied: true,
      reason: plan.reason,
      error: null,
      soulLevels: plan.soulLevels,
      commonHorizon,
      projectedCandidates: scoreOnlyProjections,
      scoreOnlyProjections,
      materializedProjectedNodes: 0,
      saveTransitions: 0,
      maxSaveStepsPerCandidate: 0,
      projectionRuntimeMs: planningRuntimeMs + horizonScoreRuntimeMs,
      materializationRuntimeMs: 0,
      horizonScoreRuntimeMs,
      horizonVectorRequests
    },
    projectionEntries: []
  };
}

// Test-only semantic oracle for the pre-lazy full-layer retention. Search runners never call this path.
export function selectPathEndParetoBeamFullReferenceForTest(nodes, width, vectorFor, diversityKey = () => "") {
  if (!Array.isArray(nodes)) throw new TypeError("nodes muss ein Array sein.");
  if (!Number.isSafeInteger(width) || width < 1) throw new RangeError("width muss positiv ganzzahlig sein.");
  if (typeof vectorFor !== "function") throw new TypeError("vectorFor muss eine Funktion sein.");
  const decorated = decoratePathEndNodes(nodes, vectorFor);
  const layers = pathEndNonDominatedLayers(decorated);
  return retainPathEndParetoLayers(layers, width, diversityKey);
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
  referenceTimeMs = 1500,
  heroId,
  damageFocus = "hybrid",
  objectiveConfig = null,
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
  profile = false,
  commonHorizonShadow = false,
  commonHorizonScoreOnlyShadow = false,
  commonHorizonRetentionAudit = false,
  onProgress
}) {
  if (!Number.isSafeInteger(beamWidth) || beamWidth < 1) throw new RangeError("beamWidth ist ungültig.");
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1) throw new RangeError("maxSteps ist ungültig.");
  if (!Number.isSafeInteger(budget) || budget <= 0) throw new RangeError("budget ist ungültig.");
  if (!(timeMs === Infinity || (Number.isFinite(timeMs) && timeMs > 0))) throw new RangeError("timeMs ist ungültig.");
  if (!Number.isFinite(auditReserveMs) || auditReserveMs < 0 || (Number.isFinite(timeMs) && auditReserveMs >= timeMs)) {
    throw new RangeError("auditReserveMs ist ungültig.");
  }
  if (!Number.isFinite(referenceTimeMs) || referenceTimeMs < 0) throw new RangeError("referenceTimeMs ist ungültig.");
  if (typeof commonHorizonShadow !== "boolean") throw new TypeError("commonHorizonShadow muss boolean sein.");
  if (typeof commonHorizonScoreOnlyShadow !== "boolean") {
    throw new TypeError("commonHorizonScoreOnlyShadow muss boolean sein.");
  }
  if (typeof commonHorizonRetentionAudit !== "boolean") {
    throw new TypeError("commonHorizonRetentionAudit muss boolean sein.");
  }
  if (commonHorizonRetentionAudit && !commonHorizonScoreOnlyShadow) {
    throw new RangeError("Common-Horizon Retention Audit benötigt den Score-only Shadow.");
  }
  if (commonHorizonRetentionAudit && timeMs !== Infinity) {
    throw new RangeError("Common-Horizon Retention Audit benötigt timeMs=Infinity, damit Observer-Overhead den Search nicht abschneidet.");
  }
  if (commonHorizonShadow && commonHorizonScoreOnlyShadow) {
    throw new RangeError("Materialized und Score-only Common-Horizon Shadow dürfen nicht gleichzeitig aktiv sein.");
  }
  const commonHorizonMode = commonHorizonShadow
    ? "materialized"
    : commonHorizonScoreOnlyShadow
      ? "score-only"
      : "off";
  const commonHorizonEnabled = commonHorizonMode !== "off";

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
  if (reference && JSON.stringify(reference.axis) !== JSON.stringify(expectedAxis)) {
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
  const referenceStartedAt = performance.now();
  let activeReference = reference;
  if (!activeReference) {
    const referenceDeadline = finiteDeadline
      ? Math.min(searchDeadline, started + Math.min(referenceTimeMs, timeMs * 0.2))
      : started + referenceTimeMs;
    activeReference = buildSampledCarryReference({
      axis: expectedAxis,
      initialState: root.state,
      budget,
      metrics,
      transitions: (state) => domain.transitions(state),
      clean,
      deadline: referenceDeadline
    });
  }
  const referenceMs = performance.now() - referenceStartedAt;
  onProgress?.({
    phase: "sampled-reference",
    source: reference ? "supplied" : "sampled",
    runtimeMs: referenceMs,
    evaluations
  });

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
      measureSoulAxisPath(nodePoints(node), activeReference, checkpoints, budget, damageFocus, profiler, objectiveConfig || undefined));
    vectorCache.set(node, {
      pathScore: measured.pathScore,
      endScore: measured.endScore,
      measurement: measured
    });
    return vectorCache.get(node);
  };
  const horizonVectorCaches = new Map();
  let commonHorizonVectorEvaluations = 0;
  let commonHorizonVectorCacheHits = 0;
  let commonHorizonVectorCacheMisses = 0;
  const nodeVectorAtHorizon = (node, horizon) => {
    if (!Number.isSafeInteger(horizon) || horizon <= 0 || horizon > budget) {
      throw new RangeError("Common Horizon ist ungültig.");
    }
    if (!horizonVectorCaches.has(horizon)) horizonVectorCaches.set(horizon, new WeakMap());
    const cache = horizonVectorCaches.get(horizon);
    if (cache.has(node)) {
      commonHorizonVectorCacheHits += 1;
      profiler.count("commonHorizonVectorCacheHits");
      return cache.get(node);
    }
    commonHorizonVectorCacheMisses += 1;
    profiler.count("commonHorizonVectorCacheMisses");
    commonHorizonVectorEvaluations += 1;
    profiler.count("commonHorizonVectorEvaluations");
    const measured = profiler.time("trajectoryScoreMs", () =>
      measureSoulAxisPath(nodePoints(node), activeReference, checkpoints, horizon, damageFocus, profiler, objectiveConfig || undefined));
    const vector = {
      pathScore: measured.pathScore,
      endScore: measured.endScore,
      measurement: measured
    };
    cache.set(node, vector);
    return vector;
  };

  const retentionAudit = commonHorizonRetentionAudit ? {
    pools: [],
    origins: new Map(),
    lineages: new WeakMap(),
    comparisonRuntimeMs: 0,
    classificationRuntimeMs: 0
  } : null;

  const registerAuditOrigin = (node, poolIndex, originStep) => {
    const key = `${poolIndex}:${node.serial}`;
    const existing = retentionAudit.lineages.get(node);
    const lineage = existing ? new Set(existing) : new Set();
    lineage.add(key);
    retentionAudit.lineages.set(node, lineage);
    retentionAudit.origins.set(key, {
      key,
      poolIndex,
      nodeId: node.serial,
      originStep,
      originSouls: node.state.earnedSouls,
      generatedDescendantCount: 0,
      maxGeneratedSearchStep: originStep,
      maxRetainedSearchStep: originStep,
      maxReachedSouls: node.state.earnedSouls,
      terminalDescendantCount: 0,
      finalFrontDescendantCount: 0,
      finalSelectedDescendantCount: 0
    });
    return key;
  };

  const inheritAuditLineage = (parent, node) => {
    if (!retentionAudit) return;
    const lineage = retentionAudit.lineages.get(parent);
    if (lineage?.size) retentionAudit.lineages.set(node, new Set(lineage));
  };

  const observeAuditGenerated = (node, searchStep) => {
    if (!retentionAudit) return;
    const lineage = retentionAudit.lineages.get(node);
    if (!lineage?.size) return;
    for (const key of lineage) {
      const origin = retentionAudit.origins.get(key);
      if (!origin) continue;
      origin.generatedDescendantCount += 1;
      origin.maxGeneratedSearchStep = Math.max(origin.maxGeneratedSearchStep, searchStep);
      origin.maxReachedSouls = Math.max(origin.maxReachedSouls, node.state.earnedSouls);
    }
  };

  const observeAuditRetained = (nodes, searchStep) => {
    if (!retentionAudit) return;
    for (const node of nodes) {
      const lineage = retentionAudit.lineages.get(node);
      if (!lineage?.size) continue;
      for (const key of lineage) {
        const origin = retentionAudit.origins.get(key);
        if (!origin) continue;
        origin.maxRetainedSearchStep = Math.max(origin.maxRetainedSearchStep, searchStep);
        origin.maxReachedSouls = Math.max(origin.maxReachedSouls, node.state.earnedSouls);
      }
    }
  };

  const observeAuditTerminal = (node) => {
    if (!retentionAudit) return;
    const lineage = retentionAudit.lineages.get(node);
    if (!lineage?.size) return;
    for (const key of lineage) {
      const origin = retentionAudit.origins.get(key);
      if (!origin) continue;
      origin.terminalDescendantCount += 1;
      origin.maxReachedSouls = Math.max(origin.maxReachedSouls, node.state.earnedSouls);
    }
  };

  const makeNode = (parent, nextState) => {
    const event = nextState.events[0];
    const node = {
      state: clean(nextState),
      parent,
      event,
      serial: `${parent.serial}|${JSON.stringify(event)}`
    };
    inheritAuditLineage(parent, node);
    return node;
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
  let commonHorizonSaveTransitionCalls = 0;
  const saveOnlyTransitions = (node) => {
    commonHorizonSaveTransitionCalls += 1;
    const state = domain.saveTransition(node.state);
    return state ? [makeNode(node, state)] : [];
  };
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
      observeAuditTerminal(node);
    }
    const sources = terminalSources.get(node.serial) || new Set();
    sources.add(source);
    terminalSources.set(node.serial, sources);
  };

  let beam = [root];
  let steps = 0;
  let duplicateStates = 0;
  let earlySaveCompletionMaterialized = false;
  let saveCompletionGeneratedStates = 0;
  let saveCompletionAttemptedNodes = 0;
  let saveCompletionCompletedNodes = 0;
  let saveCompletionDeadlineReached = false;
  const saveCompletionSourceSouls = [];
  const saveCompletionPhases = [];
  const materializeRetainedBySaving = (nodes, source) => {
    let attemptedNodes = 0;
    let completedNodes = 0;
    let generated = 0;
    let deadlineHit = false;
    const sourceSouls = [];
    for (const node of nodes) {
      if (node.state.earnedSouls === budget) {
        observeTerminal(node, "retained-terminal");
        continue;
      }
      if (performance.now() >= finalDeadline) {
        deadlineHit = true;
        break;
      }
      attemptedNodes += 1;
      sourceSouls.push(node.state.earnedSouls);
      const before = generatedStates;
      const completed = profiler.time("terminalCompletionMs", () =>
        completeNodeBySaving(node, budget, transitions, finalDeadline));
      const generatedForNode = generatedStates - before;
      generated += generatedForNode;
      saveCompletionGeneratedStates += generatedForNode;
      saveCompletionAttemptedNodes += 1;
      saveCompletionSourceSouls.push(node.state.earnedSouls);
      if (!completed) {
        deadlineHit = true;
        saveCompletionDeadlineReached = true;
        break;
      }
      observeTerminal(completed, source);
      completedNodes += 1;
      saveCompletionCompletedNodes += 1;
    }
    saveCompletionDeadlineReached ||= deadlineHit;
    saveCompletionPhases.push({
      source,
      attemptedNodes,
      completedNodes,
      sourceSouls,
      generatedStates: generated,
      deadlineReached: deadlineHit
    });
  };
  let maxCandidatePool = 0;
  let maxFirstFrontSize = 0;
  let frontierOverflowSteps = 0;
  let maxParetoLayerCount = 0;
  let retentionCalls = 0;
  const commonHorizonTelemetry = {
    enabled: commonHorizonEnabled,
    mode: commonHorizonMode,
    appliedPools: 0,
    skippedPools: 0,
    projectedCandidates: 0,
    scoreOnlyProjections: 0,
    materializedProjectedNodes: 0,
    saveTransitions: 0,
    horizonVectorEvaluations: 0,
    horizonVectorCacheHits: 0,
    horizonVectorCacheMisses: 0,
    horizonVectorRequests: 0,
    additionalCarryEvaluations: 0,
    projectionRuntimeMs: 0,
    materializationRuntimeMs: 0,
    horizonScoreRuntimeMs: 0,
    shadowRetentionRuntimeMs: 0,
    peakProjectedCandidates: 0,
    peakProjectionEntries: 0,
    maxSaveStepsPerCandidate: 0,
    horizons: {},
    skippedReasons: {}
  };
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
        observeAuditGenerated(successor, steps + 1);
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
    retentionCalls += 1;
    let selection;
    let shadowTrace = null;
    if (commonHorizonEnabled) {
      const beforeEvaluations = evaluations;
      const beforeVectorEvaluations = commonHorizonVectorEvaluations;
      const beforeVectorCacheHits = commonHorizonVectorCacheHits;
      const beforeVectorCacheMisses = commonHorizonVectorCacheMisses;
      const beforeSaveTransitions = commonHorizonSaveTransitionCalls;
      const auditHorizonVectors = retentionAudit ? new WeakMap() : null;
      const horizonVectorForPool = auditHorizonVectors
        ? (node, horizon) => {
            const vector = nodeVectorAtHorizon(node, horizon);
            auditHorizonVectors.set(node, vector);
            return vector;
          }
        : nodeVectorAtHorizon;
      const shadowStartedAt = performance.now();
      selection = profiler.time("retentionMs", () =>
        commonHorizonMode === "materialized"
          ? selectPathEndParetoBeamCommonHorizonShadow(
              unique,
              beamWidth,
              nodeVector,
              horizonVectorForPool,
              saveOnlyTransitions,
              diversityKey,
              searchDeadline,
              profiler
            )
          : selectPathEndParetoBeamCommonHorizonScoreOnlyShadow(
              unique,
              beamWidth,
              nodeVector,
              horizonVectorForPool,
              diversityKey,
              profiler
            )
      );
      const shadowRetentionRuntimeMs = performance.now() - shadowStartedAt;
      commonHorizonTelemetry.shadowRetentionRuntimeMs += shadowRetentionRuntimeMs;
      const shadow = selection.shadowProjection;
      commonHorizonTelemetry[shadow.applied ? "appliedPools" : "skippedPools"] += 1;
      commonHorizonTelemetry.projectedCandidates += shadow.projectedCandidates;
      commonHorizonTelemetry.scoreOnlyProjections += shadow.scoreOnlyProjections || 0;
      commonHorizonTelemetry.materializedProjectedNodes += shadow.materializedProjectedNodes || 0;
      commonHorizonTelemetry.saveTransitions += commonHorizonSaveTransitionCalls - beforeSaveTransitions;
      commonHorizonTelemetry.horizonVectorEvaluations += commonHorizonVectorEvaluations - beforeVectorEvaluations;
      commonHorizonTelemetry.horizonVectorCacheHits += commonHorizonVectorCacheHits - beforeVectorCacheHits;
      commonHorizonTelemetry.horizonVectorCacheMisses += commonHorizonVectorCacheMisses - beforeVectorCacheMisses;
      commonHorizonTelemetry.horizonVectorRequests += shadow.horizonVectorRequests || 0;
      commonHorizonTelemetry.additionalCarryEvaluations += evaluations - beforeEvaluations;
      commonHorizonTelemetry.projectionRuntimeMs += shadow.projectionRuntimeMs || 0;
      commonHorizonTelemetry.materializationRuntimeMs += shadow.materializationRuntimeMs || 0;
      commonHorizonTelemetry.horizonScoreRuntimeMs += shadow.horizonScoreRuntimeMs || 0;
      commonHorizonTelemetry.peakProjectedCandidates = Math.max(
        commonHorizonTelemetry.peakProjectedCandidates,
        shadow.projectedCandidates
      );
      commonHorizonTelemetry.peakProjectionEntries = Math.max(
        commonHorizonTelemetry.peakProjectionEntries,
        selection.projectionEntries?.length || 0
      );
      commonHorizonTelemetry.maxSaveStepsPerCandidate = Math.max(
        commonHorizonTelemetry.maxSaveStepsPerCandidate,
        shadow.maxSaveStepsPerCandidate
      );
      if (shadow.commonHorizon !== null) {
        commonHorizonTelemetry.horizons[shadow.commonHorizon] =
          (commonHorizonTelemetry.horizons[shadow.commonHorizon] || 0) + 1;
      }
      if (!shadow.applied) {
        commonHorizonTelemetry.skippedReasons[shadow.reason] =
          (commonHorizonTelemetry.skippedReasons[shadow.reason] || 0) + 1;
      }
      shadowTrace = {
        mode: shadow.mode,
        applied: shadow.applied,
        reason: shadow.reason,
        commonHorizon: shadow.commonHorizon,
        soulLevels: shadow.soulLevels,
        projectedCandidates: shadow.projectedCandidates,
        scoreOnlyProjections: shadow.scoreOnlyProjections,
        materializedProjectedNodes: shadow.materializedProjectedNodes,
        saveTransitions: shadow.saveTransitions,
        maxSaveStepsPerCandidate: shadow.maxSaveStepsPerCandidate
      };
      if (retentionAudit && shadow.applied) {
        const auditStartedAt = performance.now();
        const baselineSelection = selectPathEndParetoBeam(unique, beamWidth, nodeVector, diversityKey);
        const baselineSet = new Set(baselineSelection.selected);
        const commonSet = new Set(selection.selected);
        const added = selection.selected.filter((node) => !baselineSet.has(node));
        const removed = baselineSelection.selected.filter((node) => !commonSet.has(node));
        const overlapCount = baselineSelection.selected.reduce(
          (sum, node) => sum + Number(commonSet.has(node)), 0
        );
        const baselineLayers = exactPathEndLayerIndices(unique, nodeVector);
        const commonLayers = exactPathEndLayerIndices(unique, (node) => {
          const vector = auditHorizonVectors.get(node);
          if (!vector) throw new Error("Audit horizon vector missing for applied pool.");
          return vector;
        });
        const describe = (node) => {
          const baselineVector = nodeVector(node);
          const commonVector = auditHorizonVectors.get(node);
          return {
            nodeId: node.serial,
            earnedSouls: node.state.earnedSouls,
            diversityKey: diversityKey(node),
            baselineVector: { pathScore: baselineVector.pathScore, endScore: baselineVector.endScore },
            commonHorizonVector: { pathScore: commonVector.pathScore, endScore: commonVector.endScore },
            baselineParetoLayer: baselineLayers.get(node),
            commonHorizonParetoLayer: commonLayers.get(node)
          };
        };
        const poolIndex = retentionAudit.pools.length;
        const pool = {
          poolIndex,
          step: steps,
          minEarnedSouls: Math.min(...unique.map((node) => node.state.earnedSouls)),
          maxEarnedSouls: Math.max(...unique.map((node) => node.state.earnedSouls)),
          soulLevels: [...shadow.soulLevels],
          commonHorizon: shadow.commonHorizon,
          soulGap: shadow.commonHorizon - Math.min(...unique.map((node) => node.state.earnedSouls)),
          rawCandidateCount: candidates.length,
          candidateCount: unique.length,
          width: beamWidth,
          baselineRetainedNodeIds: baselineSelection.selected.map((node) => node.serial),
          commonHorizonRetainedNodeIds: selection.selected.map((node) => node.serial),
          selectionChanged: added.length > 0 || removed.length > 0,
          retainedOverlapCount: overlapCount,
          nodesAddedByCommonHorizon: added.map(describe),
          nodesRemovedByCommonHorizon: removed.map(describe),
          exchangedBeamSlots: Math.max(added.length, removed.length),
          horizonVectorEvaluations: commonHorizonVectorEvaluations - beforeVectorEvaluations,
          horizonVectorRequests: shadow.horizonVectorRequests || 0,
          horizonScoringRuntimeMs: shadow.horizonScoreRuntimeMs || 0,
          retentionRuntimeMs: shadowRetentionRuntimeMs,
          baselineAuditRetentionRuntimeMs: null,
          baselineLayerSizes: baselineSelection.metadata.layerSizes,
          commonHorizonLayerSizes: selection.metadata.layerSizes,
          originKeys: []
        };
        const baselineAuditFinishedAt = performance.now();
        pool.baselineAuditRetentionRuntimeMs = baselineAuditFinishedAt - auditStartedAt;
        retentionAudit.pools.push(pool);
        for (const node of added) {
          pool.originKeys.push(registerAuditOrigin(node, poolIndex, steps));
        }
        retentionAudit.comparisonRuntimeMs += performance.now() - auditStartedAt;
      }
    } else {
      selection = profiler.time("retentionMs", () =>
        selectPathEndParetoBeam(unique, beamWidth, nodeVector, diversityKey, profiler));
    }
    observeAuditRetained(selection.selected, steps);
    maxFirstFrontSize = Math.max(maxFirstFrontSize, selection.metadata.firstFrontSize);
    maxParetoLayerCount = Math.max(maxParetoLayerCount, selection.metadata.layerSizes.length);
    if (selection.metadata.frontierOverflow) frontierOverflowSteps += 1;
    selectionTrace.push({
      step: steps,
      candidates: candidates.length,
      unique: unique.length,
      retained: selection.selected.length,
      ...selection.metadata,
      ...(commonHorizonEnabled ? { commonHorizonShadow: shadowTrace } : {})
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
    onProgress?.({
      phase: "multiobjective",
      width: beamWidth,
      depth: steps,
      retained: beam.length,
      generatedStates,
      evaluations,
      maxReachedSouls,
      terminalCandidates: terminalNodes.size
    });
    if (!earlySaveCompletionMaterialized && beam.length) {
      materializeRetainedBySaving(beam, "retained-save-completion-early");
      earlySaveCompletionMaterialized = true;
    }
  }

  if (profiler.enabled) profiler.add("beamSearchMs", performance.now() - beamSearchStartedAt);
  if (finiteDeadline && performance.now() >= searchDeadline && beam.length) deadlineReached = true;
  const searchComplete = beam.length === 0;
  if (!searchComplete && steps >= maxSteps && !deadlineReached) {
    throw new Error(`Controlled multiobjective search exceeded maxSteps=${maxSteps}.`);
  }

  if (!searchComplete && beam.length) {
    materializeRetainedBySaving(beam, "retained-save-completion-final");
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

  let finalizedRetentionAudit = null;
  if (retentionAudit) {
    const classifyStartedAt = performance.now();
    for (const entry of finalEntries) {
      const lineage = retentionAudit.lineages.get(entry.node);
      if (!lineage?.size) continue;
      for (const key of lineage) {
        const origin = retentionAudit.origins.get(key);
        if (origin) origin.finalFrontDescendantCount += 1;
      }
    }
    const type4Distinguishable = finalEntries.length === 1;
    if (type4Distinguishable) {
      const lineage = retentionAudit.lineages.get(finalEntries[0].node);
      if (lineage?.size) {
        for (const key of lineage) {
          const origin = retentionAudit.origins.get(key);
          if (origin) origin.finalSelectedDescendantCount += 1;
        }
      }
    }

    const pools = retentionAudit.pools.map((pool) => {
      const origins = pool.originKeys.map((key) => retentionAudit.origins.get(key)).filter(Boolean);
      const addedWithDownstream = pool.nodesAddedByCommonHorizon.map((entry, index) => {
        const origin = origins[index];
        return {
          ...entry,
          downstream: origin ? {
            searchStepsRetainedAfterOrigin: Math.max(0, origin.maxRetainedSearchStep - origin.originStep),
            maxDescendantDepth: Math.max(0, origin.maxGeneratedSearchStep - origin.originStep),
            generatedDescendantCount: origin.generatedDescendantCount,
            maxReachedSouls: origin.maxReachedSouls,
            terminalDescendantCount: origin.terminalDescendantCount,
            finalFrontDescendantCount: origin.finalFrontDescendantCount,
            finalSelectedDescendantCount: origin.finalSelectedDescendantCount
          } : null
        };
      });
      let type = 0;
      if (pool.selectionChanged) {
        if (type4Distinguishable && origins.some((origin) => origin.finalSelectedDescendantCount > 0)) type = 4;
        else if (origins.some((origin) => origin.finalFrontDescendantCount > 0)) type = 3;
        else if (origins.some((origin) => origin.maxRetainedSearchStep - origin.originStep >= 2)) type = 2;
        else type = 1;
      }
      const { originKeys: _originKeys, ...publicPool } = pool;
      return { ...publicPool, nodesAddedByCommonHorizon: addedWithDownstream, type };
    });
    retentionAudit.classificationRuntimeMs += performance.now() - classifyStartedAt;
    finalizedRetentionAudit = {
      enabled: true,
      appliedPools: pools.length,
      selectionChangedPools: pools.reduce((sum, pool) => sum + Number(pool.selectionChanged), 0),
      type4Distinguishable,
      finalFrontSize: finalEntries.length,
      comparisonRuntimeMs: retentionAudit.comparisonRuntimeMs,
      classificationRuntimeMs: retentionAudit.classificationRuntimeMs,
      classificationSemantics: {
        type0: "common horizon applied but retained node set is identical to baseline",
        type1: "retention changed but no newly retained ancestry survives at least two later retention rounds or reaches final front",
        type2: "retention changed and newly retained ancestry survives at least two later retention rounds but reaches no final front node",
        type3: "retention changed and newly retained ancestry reaches a final terminal Pareto-front node",
        type4: type4Distinguishable
          ? "retention changed and newly retained ancestry reaches the sole final Pareto result"
          : "not distinguishable because the search exposes no single selected result when final front size is not one"
      },
      pools
    };
  }

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
      referenceMs,
      referenceSource: reference ? "supplied" : "sampled",
      searchDeadlineMs: finiteDeadline ? timeMs - auditReserveMs : null,
      deadlineReached,
      evaluations,
      generatedStates,
      searchGeneratedStates: generatedStates - auditGeneratedStates - saveCompletionGeneratedStates,
      saveCompletionGeneratedStates,
      auditGeneratedStates,
      transitionCalls,
      duplicateStates,
      beamWidth,
      steps,
      retentionCalls,
      ...(commonHorizonEnabled ? { commonHorizonShadow: commonHorizonTelemetry } : {}),
      ...(finalizedRetentionAudit ? { commonHorizonRetentionAudit: finalizedRetentionAudit } : {}),
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
      objectiveConfigId: objectiveConfig?.id || "carry-balanced-a-50-50",
      partialVectorSemantics: "Path/End of the legal save-to-horizon completion of the current partial path",
      terminalCompletion: {
        mode: "retained_partial_nodes_legal_save_to_horizon",
        separatePass: true,
        source: "all retained partial nodes; early Production-parity fallback plus final retained refresh",
        attemptedNodes: saveCompletionAttemptedNodes,
        completedNodes: saveCompletionCompletedNodes,
        sourceSouls: saveCompletionSourceSouls,
        generatedStates: saveCompletionGeneratedStates,
        deadlineReached: saveCompletionDeadlineReached,
        earlyFallbackMaterialized: earlySaveCompletionMaterialized,
        phases: saveCompletionPhases,
        naturalSearchMaxReachedSouls: maxReachedSouls
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

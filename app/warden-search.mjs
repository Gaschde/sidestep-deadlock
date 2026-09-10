import { directReference } from "./direct-reference.mjs";
import { cachedReference } from "./reference-cache.mjs";
import { createDeadlockDomain } from "./deadlock-domain.mjs";
import { paretoFilter } from "./reference-search.mjs";
import { evaluateCarryScenarios } from "./optimizer.mjs";
import { calculateTrajectoryObjectives } from "./trajectory-objectives.mjs";

// This bridge deliberately only exposes an already supported, source-backed
// Warden calculation.  It does not turn conditional effects or unknown skill
// states into additional performance.
function toOptimizerState(state, data) {
  return { inventory: state.inventory.map((id) => data.itemsById.get(id)).filter(Boolean) };
}

export function evaluateWardenWeaponPerformance(state, request, data) {
  const result = evaluateWardenCarryPerformance(state, request, data);
  if (!result.valid) throw new RangeError(`Warden-Weapon-Bewertung ist nicht verfügbar: ${result.reason}.`);
  return result.metrics.sustainedWeaponDps;
}

export const WARDEN_METRICS = [
  "sustainedWeaponDps", "laneTradeWindowDps", "farmWindowDps", "skirmishWindowDps",
  "teamfightWindowDps", "bulletEhp", "spiritEhp"
];

export function evaluateWardenCarryPerformance(state, request, data) {
  const scenarios = evaluateCarryScenarios(toOptimizerState(state, data), request, data);
  if (!scenarios.valid) return { valid: false, reason: scenarios.reason || "ungültige Warden-Bewertung", scenarios };
  const byId = new Map(scenarios.scenarios.map((scenario) => [scenario.id, scenario]));
  const metrics = {
    sustainedWeaponDps: scenarios.common.sustained_weapon_dps,
    laneTradeWindowDps: byId.get("lane_trade")?.window_dps,
    farmWindowDps: byId.get("farm")?.window_dps,
    skirmishWindowDps: byId.get("skirmish")?.window_dps,
    teamfightWindowDps: byId.get("teamfight")?.window_dps,
    // The two survival dimensions include only verified, permanent recovery
    // over the shared 10-second teamfight window. Raw EHP remains exposed in
    // scenarios.common for audit and is not counted a second time.
    bulletEhp: byId.get("teamfight")?.survival_capacity_bullet ?? scenarios.common.effective_health_bullet,
    spiritEhp: byId.get("teamfight")?.survival_capacity_spirit ?? scenarios.common.effective_health_spirit
  };
  if (WARDEN_METRICS.some((metric) => !Number.isFinite(metrics[metric]) || metrics[metric] < 0)) {
    return { valid: false, reason: "Eine Warden-Metrik ist nicht endlich oder negativ.", scenarios };
  }
  return {
    valid: true,
    metrics,
    scenarios,
    availability: {
      active: scenarios.common.conditional_effects_excluded.filter((effect) => effect.trigger === "item_activation"),
      conditional: scenarios.common.conditional_effects_excluded.filter((effect) => effect.trigger !== "item_activation"),
      treatment: "Aktive und bedingte Effekte bleiben ohne verifizierte Uptime aus der Dauerleistung ausgeschlossen."
    }
  };
}

function referencePoints(labels, budget, metric) {
  const bestAt = new Map();
  for (const { state, label } of labels) {
    const current = bestAt.get(state.earnedSouls);
    if (current === undefined || label[metric] > current) bestAt.set(state.earnedSouls, label[metric]);
  }
  // The empty build is always present at zero; retaining the prior best is
  // intentional because a reference is an attainable upper envelope, not a
  // claim that a player must spend every newly earned Soul.
  let last = bestAt.get(0);
  return [...bestAt.keys()].sort((a, b) => a - b).map((earnedSouls) => {
    last = Math.max(last, bestAt.get(earnedSouls));
    return { earnedSouls, kind: "resource", metrics: { [metric]: last } };
  }).filter((point) => point.earnedSouls <= budget);
}

function greatestCommonDivisor(left, right) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b) [a, b] = [b, a % b];
  return a;
}

export function wardenResourceAxis(data, itemIds, budget) {
  const items = itemIds.map((id) => data.itemsById.get(id));
  const rate = Number(data.economy?.sellback?.rate);
  if (rate !== 0.5 || items.some((item) => !item || !Number.isSafeInteger(Number(item.total_cost)))) {
    throw new RangeError("Die vollständige Warden-Ressourcenverdichtung benötigt kanonische ganzzahlige Preise und 50% Sellback.");
  }
  const ids = new Set(itemIds);
  const payments = [
    ...items.map((item) => Number(item.total_cost)),
    ...data.upgrades.filter((edge) => ids.has(edge.from_item_id) && ids.has(edge.to_item_id)).map((edge) => Number(edge.additional_cost)),
    ...items.map((item) => Number(item.total_cost) * rate)
  ];
  if (payments.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new RangeError("Die Warden-Ressourcenverdichtung benötigt ganzzahlige positive Zahlungen und Verkaufserlöse.");
  }
  const step = payments.reduce(greatestCommonDivisor);
  const axis = [];
  for (let souls = 0; souls <= budget; souls += step) axis.push(souls);
  if (axis.at(-1) !== budget) axis.push(budget);
  return { axis, step };
}

/**
 * Fully specified Warden/Carry/Weapon model for an explicitly supplied item
 * set.  The first pass is a pointwise reference search; the second preserves
 * end DPS and minimizes the two trajectory regrets.  No beam width or other
 * candidate cap is applied.
 */
export function runWardenWeaponPareto({ data, itemIds, budget, slotUnlocks = [], metricSet = ["sustainedWeaponDps"], referenceResult }) {
  if (!Array.isArray(itemIds) || !itemIds.length) throw new TypeError("Die Warden-Suche benötigt eine explizite, nichtleere Itemmenge.");
  const request = { heroId: "warden", objective: "weapon_magazine_dps", budget };
  const selectedMetrics = [...new Set(metricSet)];
  const onProgress = arguments[0]?.onProgress;
  if (!selectedMetrics.length || selectedMetrics.some((metric) => !WARDEN_METRICS.includes(metric))) {
    throw new RangeError("Unbekannte oder leere Warden-Metrikmenge.");
  }
  const resource = wardenResourceAxis(data, itemIds, budget);
  onProgress?.({ phase: "metric-start", metric: selectedMetrics[0], itemCount: itemIds.length, budget });
  const metricsCache = new Map();
  const metrics = (state) => {
    const key = [...state.inventory].sort().join("|");
    if (!metricsCache.has(key)) {
      const evaluation = evaluateWardenCarryPerformance(state, request, data);
      if (!evaluation.valid) throw new RangeError(evaluation.reason);
      metricsCache.set(key, evaluation.metrics);
    }
    return metricsCache.get(key);
  };
  const startedAt = performance.now();
  const heapBefore = typeof process !== "undefined" && typeof process.memoryUsage === "function" ? process.memoryUsage().heapUsed : null;
  const progressFor = (phase) => onProgress ? (telemetry) => onProgress({ phase, metric: selectedMetrics[0], telemetry }) : undefined;
  const reference = referenceResult || computeWardenReference({ data, itemIds, budget, slotUnlocks, metricSet: selectedMetrics, onProgress });
  const referenceByMetric = reference.byMetric;
  onProgress?.({ phase: "model-scope", itemCount: itemIds.length, budget, resourceStep: resource.step,
    unsupportedUpgrades: reference.unsupportedUpgrades });
  const primaryMetric = selectedMetrics[0];
  const references = referenceByMetric[primaryMetric];
  if (selectedMetrics.some((metric) => {
    const points = referenceByMetric[metric];
    return !points.length || points[0].earnedSouls !== 0 || points.at(-1).earnedSouls !== budget;
  })) {
    throw new Error("Die punktweise Warden-Referenz deckt den gesamten Horizont nicht ab.");
  }
  const label = (state) => {
    return Object.fromEntries(selectedMetrics.flatMap((metric) => {
      const result = calculateTrajectoryObjectives({ points: state.snapshots, references: referenceByMetric[metric], metric, horizon: state.earnedSouls });
      return [[`${metric}End`, result.endPerformance],
        [`${metric}NegativeSettledWorstRegret`, -result.settledWorstRegret],
        [`${metric}NegativeRegretIntegral`, -result.regretIntegral]];
    }));
  };
  const domain = createDeadlockDomain({ data, itemIds, soulAxis: resource.axis, budget, slotUnlocks, metrics, label });
  const search = domain.search({ onProgress: progressFor("trajectory-search") });
  const heapAfter = typeof process !== "undefined" && typeof process.memoryUsage === "function" ? process.memoryUsage().heapUsed : null;
  const terminal = search.labels.filter(({ state }) => state.earnedSouls === budget).map((entry) => {
    const objectives = calculateTrajectoryObjectives({
      points: entry.state.snapshots, references, metric: primaryMetric, horizon: budget
    });
    const objectivesByMetric = Object.fromEntries(selectedMetrics.map((metric) => [metric, calculateTrajectoryObjectives({
      points: entry.state.snapshots, references: referenceByMetric[metric], metric, horizon: budget
    })]));
    return { ...entry, objectives, objectivesByMetric };
  });
  const terminalVectors = terminal.map((entry) => ({ ...entry, label: Object.fromEntries(selectedMetrics.flatMap((metric) => {
    const objective = entry.objectivesByMetric[metric];
    return [[`${metric}End`, objective.endPerformance],
      [`${metric}NegativeWorstRegret`, -objective.worstRegret],
      [`${metric}NegativeIntegratedRegret`, -objective.integratedRegret]];
  })) }));
  // Output equivalence is distinct from future equivalence: an equal final
  // objective vector needs one representative, regardless of leftover cash.
  const uniqueVectors = new Map();
  const transactions = (entry) => entry.state.events.filter((event) => event.type !== "save").length;
  for (const entry of terminalVectors) {
    const key = JSON.stringify(entry.label);
    const previous = uniqueVectors.get(key);
    if (!previous || transactions(entry) < transactions(previous) ||
        (transactions(entry) === transactions(previous) && domain.stateKey(entry.state) < domain.stateKey(previous.state))) {
      uniqueVectors.set(key, entry);
    }
  }
  const fullPareto = paretoFilter([...uniqueVectors.values()]);
  const pareto = fullPareto.map((entry) => ({
    ...entry,
    paretoLabel: entry.label,
    label: {
      endPerformance: entry.objectives.endPerformance,
      negativeWorstRegret: -entry.objectives.worstRegret,
      negativeIntegratedRegret: -entry.objectives.integratedRegret
    }
  }));
  const result = {
    request, slotUnlocks: [...slotUnlocks], resource: {
      ...resource,
      completeness: "Vollständig nur auf dem ausgewiesenen Zahlungsraster. Kosten-GCD allein beweist keine Pareto-erhaltende Reduktion der ganzzahligen Soul-Achse bei Verkäufen und mehrdimensionalen Ersetzungen.",
      integerAxisCompletenessProven: resource.step === 1
    }, metrics: selectedMetrics, reference: { kind: "attainable_pointwise_upper_envelope", points: references, byMetric: referenceByMetric },
    search, terminal, pareto, unsupportedUpgrades: domain.resourceEvents.unsupportedUpgrades,
    telemetry: {
      runtimeMs: performance.now() - startedAt,
      referenceExpandedStates: reference.telemetry.expandedStates ?? 0,
      referenceInventories: reference.telemetry.evaluatedInventories ?? 0,
      generatedStates: search.generatedStates,
      retainedLabels: search.labels.length,
      terminalLabels: terminal.length,
      distinctTerminalVectors: uniqueVectors.size,
      distinctParetoVectors: pareto.length,
      prunedLabels: search.prunedLabels,
      heapUsedBytesBefore: heapBefore,
      heapUsedBytesAfter: heapAfter,
      memoryScope: "Node-Heap-Snapshot vor und nach beiden Suchen; kein behauptetes Peak-Memory-Messverfahren."
    },
    scope: "Pareto-Menge im ausgewiesenen Zahlungsraster, der übergebenen Itemmenge und den unterstützten Upgrade-Kanten. Keine vollständige Ganzzahl-/Spieloptimalität bei unbewiesener Rasterreduktion oder ausgeschlossenen Upgrades."
  };
  onProgress?.({ phase: "metric-complete", metric: selectedMetrics[0], telemetry: result.telemetry, paretoCount: pareto.length });
  return result;
}

export function runWardenCarryVectorPareto(options) {
  return runWardenWeaponPareto({ ...options, metricSet: WARDEN_METRICS });
}

// Separate objective dimensions require a JOINT Pareto comparison. The union
// of scalar optima can lose compromise builds; no scalarization is applied.
export function runWardenCarryPareto(options) {
  const { search, terminal, ...result } = runWardenCarryVectorPareto(options);
  return {
    ...result,
    byMetric: Object.fromEntries(WARDEN_METRICS.map((metric) => [metric, {
      reference: { points: result.reference.byMetric[metric] },
      pareto: result.pareto, telemetry: result.telemetry
    }]))
  };
}

// Legacy mode remains an independent traversal of all reachable configurations
// for small differential tests. Neither reference mode changes trajectory search.
export function computeWardenReference({ data, itemIds, budget, slotUnlocks = [], metricSet = WARDEN_METRICS, onProgress, method = "direct", profile = false }) {
  const resource = wardenResourceAxis(data, itemIds, budget);
  const request = { heroId: "warden", objective: "weapon_magazine_dps", budget, cacheProfiles: false };
  const metrics = (state) => {
    const result = evaluateWardenCarryPerformance(state, request, data);
    if (!result.valid) throw new Error(result.reason);
    return result.metrics;
  };
  if (method === "direct") return directReference({ data, itemIds, budget, soulAxis: resource.axis, slotUnlocks, metrics, metricSet, onProgress, profile });
  if (method !== "legacy") throw new Error("Unknown reference method");
  const domain = createDeadlockDomain({ data, itemIds, soulAxis: resource.axis, budget, slotUnlocks, metrics, recordHistory: false, label: metrics });
  const search = domain.search({ labelDependsOnlyOnFuture: true });
  return { byMetric: Object.fromEntries(metricSet.map((metric) => [metric, referencePoints(search.labels, budget, metric)])),
    unsupportedUpgrades: domain.resourceEvents.unsupportedUpgrades, telemetry: { expandedStates: search.expandedStates } };
}

export async function cachedWardenReference({ data, itemIds, budget, slotUnlocks = [], metricSet = WARDEN_METRICS, storage, sourceIdentity, onProgress }) {
  const resource = wardenResourceAxis(data, itemIds, budget);
  return cachedReference({ storage, axis: resource.axis, metricSet,
    identity: { data, itemIds, budget, slotUnlocks, metricSet, resource,
      hero: "warden", role: "carry", damageFocus: "weapon", sourceIdentity },
    compute: () => computeWardenReference({ data, itemIds, budget, slotUnlocks, metricSet, onProgress }),
    onStatus: (status) => onProgress?.({ phase: "reference-cache", status }) });
}

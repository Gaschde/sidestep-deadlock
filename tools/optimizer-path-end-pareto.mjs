import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseCsv } from "../app/lib.mjs";
import { buildOptimizerData, heroCanPurchaseItem } from "../app/optimizer.mjs";
import { createDeadlockDomain } from "../app/deadlock-domain.mjs";
import { searchLabels } from "../app/search-core.mjs";
import { runIterativeDiverseBeamCarry } from "../app/beam-search.mjs";
import { validateSearchPath } from "../app/validate-search-path.mjs";
import { evaluateCarryPerformance } from "../app/warden-search.mjs";
import { scoreMilestonePath, SEARCH_OBJECTIVE_VERSION } from "../app/search-objective.mjs";
import {
  EXPERIMENTAL_OBJECTIVE_VERSION,
  PATH_END_MEASUREMENT_VERSION,
  measureSoulAxisPath,
  scoreSoulAxisPath
} from "../app/search-objective-v1.mjs";
import { benchmarkCases } from "../benchmarks/optimizer-v1/cases.mjs";
import {
  classifyBaseline,
  counterexampleObservables,
  pathEndParetoFront,
  pathEventObservables,
  summarizeTradeoffs
} from "../benchmarks/optimizer-v1/path-end-pareto-lib.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const REFERENCE_FILE = resolve(ROOT, "benchmarks/optimizer-v1/references/baseline-v0.json");
const BASELINE_RESULTS_FILE = resolve(ROOT, "benchmarks/optimizer-v1/experiments/objective-v1a/baseline-current.json");
const DEFAULT_OUTPUT = resolve(ROOT, "artifacts/path-end-pareto/results.json");

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

function outputPath() {
  const args = process.argv.slice(2);
  const index = args.indexOf("--output");
  return resolve(index >= 0 ? args[index + 1] : DEFAULT_OUTPUT);
}

function slotUnlocks(data) {
  return [{ earnedSouls: 0, slots: Number(data.slots.item_limit) - Number(data.slots.starting_slots.universal) }];
}

function caseItemIds(data, definition) {
  const ids = definition.itemIds ? [...definition.itemIds] : data.items.map((item) => item.item_id);
  const missing = ids.filter((id) => !data.itemsById.has(id));
  if (missing.length) throw new Error(`${definition.id}: unknown item ids: ${missing.join(", ")}`);
  return ids.filter((id) => heroCanPurchaseItem(data.itemsById.get(id), data, definition.hero));
}

function requestFor(definition) {
  return {
    heroId: definition.hero,
    damageFocus: definition.focus,
    budget: definition.budget,
    cacheProfiles: false,
    metricsOnly: true,
    opponentBulletResist: definition.opponentBulletResist,
    opponentSpiritResist: definition.opponentSpiritResist
  };
}

function metricsFor(data, definition) {
  const request = requestFor(definition);
  return (state) => {
    const result = evaluateCarryPerformance(state, request, data);
    if (!result.valid) throw new Error(result.reason);
    return result.metrics;
  };
}

function pathId(events) {
  return createHash("sha256").update(JSON.stringify(events)).digest("hex").slice(0, 16);
}

function setHash(ids) {
  return createHash("sha256").update([...ids].sort().join("\n")).digest("hex");
}

function rawCandidate(state, source) {
  return {
    state: {
      ...state,
      inventory: [...state.inventory],
      events: [...state.events],
      snapshots: [...state.snapshots]
    },
    sources: new Set([source])
  };
}

function mergeRaw(map, candidate) {
  const key = pathId(candidate.state.events);
  const existing = map.get(key);
  if (!existing) {
    map.set(key, candidate);
    return;
  }
  for (const source of candidate.sources) existing.sources.add(source);
}

function exactSmallCandidates(data, definition, reference) {
  const itemIds = caseItemIds(data, definition);
  const domain = createDeadlockDomain({
    data,
    itemIds,
    budget: definition.budget,
    soulAxis: reference.axis,
    slotUnlocks: slotUnlocks(data),
    metrics: metricsFor(data, definition)
  });
  const search = searchLabels({
    initialState: domain.initial,
    expand: domain.transitions,
    stateKey: domain.stateKey,
    futureKey: domain.stateKey,
    label: () => ({ reachable: 1 })
  });
  const terminal = search.labels.filter((entry) => entry.state.earnedSouls === definition.budget);
  if (!terminal.length) throw new Error(`${definition.id}: exact candidate set is empty`);
  return {
    raw: terminal.map((entry) => rawCandidate(entry.state, "small-exact-enumeration")),
    metadata: {
      method: "existing searchLabels exact enumeration on frozen synthetic reference axis",
      generatedStates: search.generatedStates,
      expandedStates: search.expandedStates,
      terminalStates: terminal.length,
      prunedLabels: search.prunedLabels,
      completeForModelledSmallAxis: true
    }
  };
}

function controlledBeamRun(data, definition, reference, objectiveVersion, scorer) {
  const width = definition.maxBeamWidth;
  const observed = [];
  const result = runIterativeDiverseBeamCarry({
    data,
    heroId: definition.hero,
    damageFocus: definition.focus,
    itemIds: caseItemIds(data, definition),
    budget: definition.budget,
    milestones: definition.milestones,
    opponentBulletResist: definition.opponentBulletResist,
    opponentSpiritResist: definition.opponentSpiritResist,
    timeMs: definition.timeBudgetMs,
    referenceTimeMs: definition.referenceTimeMs,
    reference,
    slotUnlocks: slotUnlocks(data),
    initialBeamWidth: width,
    maxBeamWidth: width,
    widenFactor: definition.widenFactor,
    scorePath: scorer,
    profile: false,
    onTerminalCandidate: (candidate) => {
      if (candidate.observation?.width !== width) return;
      observed.push(rawCandidate(candidate.state,
        `${objectiveVersion}:${candidate.observation?.phase || "beam-terminal"}`));
    }
  });
  if (!result.searchTelemetry.widthsCompleted.includes(width)) {
    throw new Error(`${definition.id}: fixed width ${width} did not complete for ${objectiveVersion}; refusing partial candidate set`);
  }
  if (!observed.length) throw new Error(`${definition.id}: no terminal candidates observed for ${objectiveVersion}`);
  return {
    raw: observed,
    metadata: {
      objectiveVersion,
      fixedWidth: width,
      completedWidths: result.searchTelemetry.widthsCompleted,
      generatedStates: result.searchTelemetry.generatedStates,
      evaluatedInventories: result.searchTelemetry.evaluations,
      observedTerminalCandidates: observed.length,
      candidateObservation: "passive; only flushed after the fixed Beam width completed"
    }
  };
}

function controlledCandidates(data, definition, reference) {
  const baseline = controlledBeamRun(data, definition, reference, SEARCH_OBJECTIVE_VERSION, scoreMilestonePath);
  const v1a = controlledBeamRun(data, definition, reference, EXPERIMENTAL_OBJECTIVE_VERSION, scoreSoulAxisPath);
  const merged = new Map();
  for (const candidate of [...baseline.raw, ...v1a.raw]) mergeRaw(merged, candidate);
  return {
    raw: [...merged.values()],
    metadata: {
      method: "union of completed fixed-width terminal candidates from the two already-existing A/B scorers",
      paretoUsedDuringGeneration: false,
      runs: [baseline.metadata, v1a.metadata]
    }
  };
}

function materializeCandidate(data, definition, reference, raw) {
  const itemIds = caseItemIds(data, definition);
  const validation = validateSearchPath({
    data,
    itemIds,
    budget: definition.budget,
    soulAxis: reference.axis,
    slotUnlocks: slotUnlocks(data),
    state: raw.state
  });
  if (validation.valid !== true) throw new Error(`${definition.id}: illegal candidate escaped validation`);

  const measurement = measureSoulAxisPath(
    raw.state.snapshots,
    reference,
    definition.milestones,
    definition.budget,
    definition.focus
  );
  const evaluated = evaluateCarryPerformance(raw.state, requestFor(definition), data);
  if (!evaluated.valid) throw new Error(evaluated.reason);
  const costs = new Map(data.items.map((item) => [item.item_id, Number(item.total_cost)]));
  const pathObservables = pathEventObservables(raw.state.events, definition.budget, costs);

  return {
    id: pathId(raw.state.events),
    sources: [...raw.sources].sort(),
    legal: true,
    pathScore: measurement.pathScore,
    endScore: measurement.endScore,
    pathDamage: measurement.pathDamage,
    endDamage: measurement.endDamage,
    pathSurvivability: measurement.pathSurvivability,
    endSurvivability: measurement.endSurvivability,
    inventory: [...raw.state.inventory],
    cash: raw.state.cash,
    endMetrics: evaluated.metrics,
    pathObservables,
    events: raw.state.events,
    soulAxis: measurement.soulAxis.map((row) => ({
      earnedSouls: row.earnedSouls,
      sourceEarnedSouls: row.sourceEarnedSouls,
      score: row.score,
      damage: row.damage,
      survivability: row.survivability
    }))
  };
}

function baselineAnchor(baselineDocument, definition) {
  const record = baselineDocument.records.find((entry) => entry.metadata.caseId === definition.id);
  if (!record) throw new Error(`${definition.id}: frozen baseline-v0 result missing`);
  if (record.legallyPathVerified !== true) throw new Error(`${definition.id}: frozen baseline-v0 path is not legal`);
  return {
    id: `baseline-v0:${definition.id}`,
    source: "frozen objective-v1a A/B baseline-current.json",
    legal: true,
    pathScore: record.commonPathMetrics.pathScore,
    endScore: record.commonPathMetrics.endScore,
    pathDamage: record.commonPathMetrics.pathDamage,
    endDamage: record.commonPathMetrics.endDamage,
    pathSurvivability: record.commonPathMetrics.pathSurvivability,
    endSurvivability: record.commonPathMetrics.endSurvivability,
    inventory: record.inventory,
    cash: record.cash,
    pathObservables: record.pathObservables
  };
}

function caseResult(data, definition, references, baselineDocument) {
  const referenceEntry = references.references[definition.id];
  if (!referenceEntry) throw new Error(`${definition.id}: frozen reference missing`);
  const reference = referenceEntry.reference;
  const generated = definition.level === "small-exact"
    ? exactSmallCandidates(data, definition, reference)
    : controlledCandidates(data, definition, reference);

  const beforeIds = generated.raw.map((entry) => pathId(entry.state.events)).sort();
  const candidates = generated.raw.map((entry) => materializeCandidate(data, definition, reference, entry));
  const afterIds = candidates.map((entry) => entry.id).sort();
  if (JSON.stringify(beforeIds) !== JSON.stringify(afterIds)) {
    throw new Error(`${definition.id}: Pareto measurement changed the candidate set`);
  }
  if (new Set(afterIds).size !== afterIds.length) {
    throw new Error(`${definition.id}: duplicate candidate paths survived candidate-set construction`);
  }

  const baseline = baselineAnchor(baselineDocument, definition);
  const front = pathEndParetoFront(candidates);
  const baselinePosition = classifyBaseline(candidates, baseline);
  const matchingBaselineCandidates = candidates.filter((candidate) =>
    candidate.pathScore === baseline.pathScore &&
    candidate.endScore === baseline.endScore &&
    JSON.stringify([...candidate.inventory].sort()) === JSON.stringify([...(baseline.inventory || [])].sort())
  ).map((candidate) => candidate.id);

  return {
    caseId: definition.id,
    level: definition.level,
    hero: definition.hero,
    role: definition.role,
    focus: definition.focus,
    budget: definition.budget,
    itemIds: caseItemIds(data, definition),
    referenceVersion: referenceEntry.version,
    candidateGeneration: generated.metadata,
    candidateSet: {
      count: candidates.length,
      hash: setHash(afterIds),
      sameBeforeAndAfterMeasurement: true,
      allLegallyReplayVerified: candidates.every((candidate) => candidate.legal)
    },
    baseline: {
      ...baseline,
      position: baselinePosition,
      matchingCandidateIds: matchingBaselineCandidates
    },
    pareto: {
      count: front.length,
      candidateIds: front.map((entry) => entry.id),
      tradeoffs: summarizeTradeoffs(front),
      counterexampleObservables: counterexampleObservables(front, baseline)
    },
    candidates
  };
}

function compactPathObservables(observed) {
  if (!observed) return null;
  const { timeline: _timeline, ...compact } = observed;
  return compact;
}

function compactCandidate(candidate) {
  return {
    id: candidate.id,
    sources: candidate.sources,
    pathScore: candidate.pathScore,
    endScore: candidate.endScore,
    pathDamage: candidate.pathDamage,
    endDamage: candidate.endDamage,
    pathSurvivability: candidate.pathSurvivability,
    endSurvivability: candidate.endSurvivability,
    inventory: candidate.inventory,
    cash: candidate.cash,
    pathObservables: compactPathObservables(candidate.pathObservables)
  };
}

function compactCase(result) {
  const frontIds = new Set(result.pareto.candidateIds);
  return {
    caseId: result.caseId,
    level: result.level,
    hero: result.hero,
    role: result.role,
    focus: result.focus,
    budget: result.budget,
    itemIds: result.itemIds,
    referenceVersion: result.referenceVersion,
    candidateGeneration: result.candidateGeneration,
    candidateSet: result.candidateSet,
    baseline: {
      ...result.baseline,
      pathObservables: compactPathObservables(result.baseline.pathObservables)
    },
    pareto: {
      ...result.pareto,
      front: result.candidates.filter((candidate) => frontIds.has(candidate.id)).map(compactCandidate)
    }
  };
}

function main() {
  const data = loadData();
  const references = JSON.parse(readFileSync(REFERENCE_FILE, "utf8"));
  const baselineDocument = JSON.parse(readFileSync(BASELINE_RESULTS_FILE, "utf8"));
  const definitions = benchmarkCases("all").filter((definition) =>
    definition.level === "small-exact" || definition.level === "controlled-medium"
  );
  const cases = definitions.map((definition) => {
    console.log(JSON.stringify({ phase: "candidate-set", caseId: definition.id }));
    const result = caseResult(data, definition, references, baselineDocument);
    console.log(JSON.stringify({
      phase: "complete",
      caseId: definition.id,
      candidates: result.candidateSet.count,
      pareto: result.pareto.count,
      baselineNondominated: result.baseline.position.nondominatedRelativeToCandidateSet
    }));
    return result;
  });

  const result = {
    schemaVersion: "optimizer-path-end-pareto-v1",
    experiment: "path-vs-end-pareto",
    sourceCommit: process.env.GITHUB_SHA || process.env.SOURCE_COMMIT || "unknown",
    generatedAt: new Date().toISOString(),
    measurementVersion: PATH_END_MEASUREMENT_VERSION,
    objectiveDimensions: ["Path-AUC", "Endbuild"],
    scalarizationUsedForPareto: false,
    productionChanged: false,
    searchHeuristicChanged: false,
    referenceSource: "benchmarks/optimizer-v1/references/baseline-v0.json",
    baselineSource: "benchmarks/optimizer-v1/experiments/objective-v1a/baseline-current.json",
    limitations: [
      "SMALL front is exhaustive only for the existing bounded synthetic benchmark axis.",
      "CONTROLLED fronts are non-dominated only within the fixed observed candidate union, not over all legal paths.",
      "The controlled candidate union is generated by unchanged baseline-v0 and V1A Beam scorers before Pareto evaluation.",
      "Frozen references are attainable sampled envelopes, not admissible bounds or global optima."
    ],
    cases
  };

  const target = outputPath();
  const summaryTarget = resolve(dirname(target), "summary.json");
  const summary = {
    ...result,
    cases: cases.map(compactCase)
  };
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(result, null, 2) + "\n");
  writeFileSync(summaryTarget, JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify({ status: "COMPLETE", output: target, summaryOutput: summaryTarget, cases: cases.length }));
}

try {
  main();
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
}

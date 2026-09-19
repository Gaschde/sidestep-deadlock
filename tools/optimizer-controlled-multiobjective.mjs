import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseCsv } from "../app/lib.mjs";
import { buildOptimizerData, heroCanPurchaseItem } from "../app/optimizer.mjs";
import { runIterativeDiverseBeamCarry } from "../app/beam-search.mjs";
import { benchmarkCases } from "../benchmarks/optimizer-v1/cases.mjs";
import {
  counterexampleObservables,
  pathEndDominates,
  pathEndParetoFront,
  pathEventObservables
} from "../benchmarks/optimizer-v1/path-end-pareto-lib.mjs";
import { runControlledMultiobjectiveBeamCarry } from "../benchmarks/optimizer-v1/controlled-multiobjective-beam.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const REFERENCE_FILE = resolve(ROOT, "benchmarks/optimizer-v1/references/baseline-v0.json");
const FROZEN_PARETO_FILE = resolve(ROOT, "benchmarks/optimizer-v1/experiments/path-end-pareto/summary.json");
const DEFAULT_OUTPUT = resolve(ROOT, "artifacts/controlled-multiobjective-beam/results.json");
const WIDTHS = Object.freeze([8, 16, 32, 64]);
const VECTOR_TOLERANCE = 1e-12;

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

function pathId(events) {
  return createHash("sha256").update(JSON.stringify(events)).digest("hex").slice(0, 16);
}

function hashLines(lines) {
  return createHash("sha256").update([...lines].sort().join("\n")).digest("hex");
}

function vectorEqual(left, right, tolerance = VECTOR_TOLERANCE) {
  return Math.abs(left.pathScore - right.pathScore) <= tolerance &&
    Math.abs(left.endScore - right.endScore) <= tolerance;
}

function compactObservables(value) {
  if (!value) return null;
  const { timeline: _timeline, ...compact } = value;
  return compact;
}

function materializeFront(data, definition, result) {
  const costs = new Map(data.items.map((item) => [item.item_id, Number(item.total_cost)]));
  return result.front.map((entry) => ({
    id: pathId(entry.state.events),
    pathScore: entry.pathScore,
    endScore: entry.endScore,
    pathDamage: entry.measurement.pathDamage,
    endDamage: entry.measurement.endDamage,
    pathSurvivability: entry.measurement.pathSurvivability,
    endSurvivability: entry.measurement.endSurvivability,
    inventory: [...entry.state.inventory],
    cash: entry.state.cash,
    transactions: entry.transactions,
    sources: entry.sources,
    legal: entry.validation.valid === true,
    pathObservables: pathEventObservables(entry.state.events, definition.budget, costs),
    events: entry.state.events
  }));
}

function collapseEquivalentVectors(front) {
  const representatives = [];
  for (const candidate of [...front].sort((a, b) =>
    a.transactions - b.transactions || a.id.localeCompare(b.id)
  )) {
    if (!representatives.some((entry) => vectorEqual(entry, candidate))) representatives.push(candidate);
  }
  return representatives.sort((a, b) =>
    b.pathScore - a.pathScore || b.endScore - a.endScore || a.id.localeCompare(b.id)
  );
}

function frontHash(front) {
  return hashLines(front.map((entry) =>
    `${entry.id}|${entry.pathScore.toPrecision(17)}|${entry.endScore.toPrecision(17)}`
  ));
}

function runBaseline(data, definition, reference) {
  const started = performance.now();
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
    initialBeamWidth: definition.initialBeamWidth,
    maxBeamWidth: definition.maxBeamWidth,
    widenFactor: definition.widenFactor,
    profile: false
  });
  return {
    runtimeMs: performance.now() - started,
    generatedStates: result.searchTelemetry.generatedStates,
    evaluations: result.searchTelemetry.evaluations,
    duplicateStates: result.searchTelemetry.duplicateStates,
    widthsCompleted: result.searchTelemetry.widthsCompleted,
    terminalAuditComplete: result.searchTelemetry.terminalAudit.complete,
    legallyPathVerified: result.semantics?.legallyPathVerified === true
  };
}

function runWidth(data, definition, reference, width) {
  const raw = runControlledMultiobjectiveBeamCarry({
    data,
    reference,
    heroId: definition.hero,
    damageFocus: definition.focus,
    itemIds: caseItemIds(data, definition),
    budget: definition.budget,
    milestones: definition.milestones,
    opponentBulletResist: definition.opponentBulletResist,
    opponentSpiritResist: definition.opponentSpiritResist,
    slotUnlocks: slotUnlocks(data),
    beamWidth: width
  });
  const front = collapseEquivalentVectors(materializeFront(data, definition, raw));
  return {
    width,
    front,
    frontHash: frontHash(front),
    telemetry: raw.telemetry
  };
}

function cumulativeStages(widthRuns) {
  const union = new Map();
  let runtimeMs = 0;
  let searchGeneratedStates = 0;
  let totalGeneratedStates = 0;
  let evaluations = 0;
  let duplicateStates = 0;
  const stages = [];

  for (const run of widthRuns) {
    for (const candidate of run.front) union.set(candidate.id, candidate);
    runtimeMs += run.telemetry.runtimeMs;
    searchGeneratedStates += run.telemetry.searchGeneratedStates;
    totalGeneratedStates += run.telemetry.generatedStates;
    evaluations += run.telemetry.evaluations;
    duplicateStates += run.telemetry.duplicateStates;
    const front = collapseEquivalentVectors(pathEndParetoFront([...union.values()]));
    stages.push({
      throughWidth: run.width,
      widths: widthRuns.filter((entry) => entry.width <= run.width).map((entry) => entry.width),
      front,
      frontHash: frontHash(front),
      runtimeMs,
      searchGeneratedStates,
      totalGeneratedStates,
      evaluations,
      duplicateStates,
      maxFirstFrontSize: Math.max(...widthRuns.filter((entry) => entry.width <= run.width)
        .map((entry) => entry.telemetry.maxFirstFrontSize)),
      frontierOverflowSteps: widthRuns.filter((entry) => entry.width <= run.width)
        .reduce((sum, entry) => sum + entry.telemetry.frontierOverflowSteps, 0),
      terminalCandidates: widthRuns.filter((entry) => entry.width <= run.width)
        .reduce((sum, entry) => sum + entry.telemetry.terminalCandidates, 0)
    });
  }
  return stages;
}

function compareWithFrozen(stage, frozenCase) {
  const frozenFront = frozenCase.pareto.front.map((entry) => ({
    id: entry.id,
    pathScore: entry.pathScore,
    endScore: entry.endScore
  }));

  const known = frozenFront.map((point) => {
    const exactPath = stage.front.find((candidate) => candidate.id === point.id);
    const vectorMatches = stage.front.filter((candidate) => vectorEqual(candidate, point));
    const dominators = stage.front.filter((candidate) => pathEndDominates(candidate, point));
    return {
      id: point.id,
      pathScore: point.pathScore,
      endScore: point.endScore,
      exactPathFound: Boolean(exactPath),
      vectorFound: vectorMatches.length > 0,
      vectorMatches: vectorMatches.map((candidate) => candidate.id),
      dominatedByNew: dominators.map((candidate) => candidate.id),
      status: vectorMatches.length ? "found" : dominators.length ? "dominated-by-new" : "missed"
    };
  });

  const combined = pathEndParetoFront([
    ...frozenFront.map((entry) => ({ ...entry, source: "frozen", id: `frozen:${entry.id}` })),
    ...stage.front.map((entry) => ({ ...entry, source: "experimental", id: `experimental:${entry.id}` }))
  ]);
  const additional = combined
    .filter((entry) => entry.source === "experimental")
    .filter((entry) => !frozenFront.some((knownPoint) => vectorEqual(entry, knownPoint)))
    .map((entry) => ({
      id: entry.id.replace(/^experimental:/, ""),
      pathScore: entry.pathScore,
      endScore: entry.endScore
    }));

  return {
    known,
    knownFound: known.filter((entry) => entry.status === "found").length,
    knownDominatedByNew: known.filter((entry) => entry.status === "dominated-by-new").length,
    knownMissed: known.filter((entry) => entry.status === "missed").length,
    allKnownVectorsFound: known.every((entry) => entry.vectorFound),
    allKnownRepresentedOrDominated: known.every((entry) => entry.vectorFound || entry.dominatedByNew.length),
    additionalCombinedNondominated: additional
  };
}

function stageSummary(stage, frozenCase, baseline) {
  const comparison = compareWithFrozen(stage, frozenCase);
  const pathology = counterexampleObservables(stage.front, frozenCase.baseline);
  return {
    throughWidth: stage.throughWidth,
    widths: stage.widths,
    frontCount: stage.front.length,
    frontHash: stage.frontHash,
    front: stage.front.map((entry) => ({
      id: entry.id,
      pathScore: entry.pathScore,
      endScore: entry.endScore,
      transactions: entry.transactions,
      inventory: entry.inventory,
      pathObservables: compactObservables(entry.pathObservables)
    })),
    comparison,
    cost: {
      runtimeMs: stage.runtimeMs,
      searchGeneratedStates: stage.searchGeneratedStates,
      totalGeneratedStates: stage.totalGeneratedStates,
      evaluations: stage.evaluations,
      duplicateStates: stage.duplicateStates,
      runtimeRatioVsBaseline: baseline.runtimeMs > 0 ? stage.runtimeMs / baseline.runtimeMs : null,
      searchGeneratedRatioVsBaseline: baseline.generatedStates > 0 ?
        stage.searchGeneratedStates / baseline.generatedStates : null,
      evaluationRatioVsBaseline: baseline.evaluations > 0 ? stage.evaluations / baseline.evaluations : null
    },
    searchShape: {
      maxFirstFrontSize: stage.maxFirstFrontSize,
      frontierOverflowSteps: stage.frontierOverflowSteps,
      terminalCandidates: stage.terminalCandidates
    },
    pathologies: pathology
  };
}

function caseExperiment(data, definition, reference, frozenCase) {
  console.log(JSON.stringify({ phase: "baseline", caseId: definition.id }));
  const baseline = runBaseline(data, definition, reference);
  if (!baseline.widthsCompleted.includes(definition.maxBeamWidth)) {
    throw new Error(`${definition.id}: baseline did not complete controlled width ${definition.maxBeamWidth}`);
  }

  const repeats = [];
  for (let repeat = 1; repeat <= 2; repeat += 1) {
    const runs = [];
    for (const width of WIDTHS) {
      console.log(JSON.stringify({ phase: "multiobjective", caseId: definition.id, repeat, width }));
      const run = runWidth(data, definition, reference, width);
      if (run.telemetry.scalarizationUsed !== false || run.telemetry.searchComplete !== true) {
        throw new Error(`${definition.id}: invalid multiobjective run at width ${width}`);
      }
      runs.push(run);
    }
    repeats.push({
      repeat,
      widthRuns: runs,
      stages: cumulativeStages(runs)
    });
  }

  const first = repeats[0];
  const second = repeats[1];
  const reproducibility = {
    identicalWidthFrontHashes: WIDTHS.every((width, index) =>
      first.widthRuns[index].frontHash === second.widthRuns[index].frontHash
    ),
    identicalCumulativeFrontHashes: first.stages.every((stage, index) =>
      stage.frontHash === second.stages[index].frontHash
    ),
    perWidth: WIDTHS.map((width, index) => ({
      width,
      first: first.widthRuns[index].frontHash,
      second: second.widthRuns[index].frontHash,
      identical: first.widthRuns[index].frontHash === second.widthRuns[index].frontHash
    }))
  };

  const stages = first.stages.map((stage) => stageSummary(stage, frozenCase, baseline));
  const firstFullRecovery = stages.find((stage) => stage.comparison.allKnownVectorsFound)?.throughWidth ?? null;
  const firstRepresented = stages.find((stage) => stage.comparison.allKnownRepresentedOrDominated)?.throughWidth ?? null;

  return {
    caseId: definition.id,
    hero: definition.hero,
    focus: definition.focus,
    budget: definition.budget,
    widths: WIDTHS,
    frozenCandidateCount: frozenCase.candidateSet.count,
    frozenFront: frozenCase.pareto.front.map((entry) => ({
      id: entry.id,
      pathScore: entry.pathScore,
      endScore: entry.endScore,
      transactions: entry.pathObservables.transactionCount
    })),
    baseline,
    reproducibility,
    firstWidthRecoveringAllFrozenVectors: firstFullRecovery,
    firstWidthRepresentingOrDominatingAllFrozenVectors: firstRepresented,
    stages,
    runDetails: first.widthRuns.map((run) => ({
      width: run.width,
      frontHash: run.frontHash,
      frontCount: run.front.length,
      telemetry: run.telemetry
    }))
  };
}

function compactCase(result) {
  return {
    caseId: result.caseId,
    hero: result.hero,
    focus: result.focus,
    budget: result.budget,
    widths: result.widths,
    frozenCandidateCount: result.frozenCandidateCount,
    frozenFront: result.frozenFront,
    baseline: result.baseline,
    reproducibility: result.reproducibility,
    firstWidthRecoveringAllFrozenVectors: result.firstWidthRecoveringAllFrozenVectors,
    firstWidthRepresentingOrDominatingAllFrozenVectors: result.firstWidthRepresentingOrDominatingAllFrozenVectors,
    stages: result.stages
  };
}

function main() {
  const data = loadData();
  const references = JSON.parse(readFileSync(REFERENCE_FILE, "utf8"));
  const frozen = JSON.parse(readFileSync(FROZEN_PARETO_FILE, "utf8"));
  const definitions = benchmarkCases("controlled");
  const cases = definitions.map((definition) => {
    const referenceEntry = references.references[definition.id];
    const frozenCase = frozen.cases.find((entry) => entry.caseId === definition.id);
    if (!referenceEntry || !frozenCase) throw new Error(`${definition.id}: frozen inputs missing`);
    return caseExperiment(data, definition, referenceEntry.reference, frozenCase);
  });

  const result = {
    schemaVersion: "optimizer-controlled-multiobjective-beam-v1",
    experiment: "controlled-multiobjective-beam",
    sourceCommit: process.env.GITHUB_SHA || process.env.SOURCE_COMMIT || "unknown",
    generatedAt: new Date().toISOString(),
    objectiveDimensions: ["Path-AUC", "Endbuild"],
    scalarizationUsed: false,
    productionChanged: false,
    controlledOnly: true,
    widths: WIDTHS,
    repeatCount: 2,
    partialVectorSemantics: "Path/End of legal save-to-horizon completion for each partial node",
    retention: "non-dominated layers first; if a layer exceeds capacity, preserve Path/End extremes and reuse existing category/family diversity",
    futureSafeDedupe: "futureKey + exact unrounded Path/End save-completion vector; objective-distinct path histories are not merged",
    terminalAudit: "one complete direct purchase/upgrade/replacement neighbourhood around the discovered terminal Pareto front",
    limitations: [
      "This is a CONTROLLED research search, not the Production optimizer.",
      "Pareto dominance between different future configurations is a retention priority, not a proof-safe global prune.",
      "A dominated partial node may later lead to a Pareto-optimal terminal path; later Pareto layers are retained while capacity permits.",
      "The fixed widths measure state growth without wall-clock truncation; runtime remains observational.",
      "Frozen CONTROLLED fronts are reference fronts over the previously observed candidate union, not global optima."
    ],
    cases
  };

  const target = outputPath();
  const summaryTarget = resolve(dirname(target), "summary.json");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(result, null, 2) + "\n");
  writeFileSync(summaryTarget, JSON.stringify({ ...result, cases: cases.map(compactCase) }, null, 2) + "\n");
  console.log(JSON.stringify({ status: "COMPLETE", output: target, summaryOutput: summaryTarget, cases: cases.length }));
}

try {
  main();
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
}

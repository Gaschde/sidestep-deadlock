import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseCsv } from "../app/lib.mjs";
import { buildOptimizerData, heroCanPurchaseItem } from "../app/optimizer.mjs";
import { runIterativeDiverseBeamCarry } from "../app/beam-search.mjs";
import { PRODUCT_SEARCH_TIME_MS } from "../app/search-config.mjs";
import { measureSoulAxisPath } from "../app/search-objective-v1.mjs";
import { benchmarkCases } from "../benchmarks/optimizer-v1/cases.mjs";
import {
  pathEndDominates,
  pathEndParetoFront,
  pathEventObservables
} from "../benchmarks/optimizer-v1/path-end-pareto-lib.mjs";
import { runControlledMultiobjectiveBeamCarry } from "../benchmarks/optimizer-v1/controlled-multiobjective-beam.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const REFERENCE_FILE = resolve(ROOT, "benchmarks/optimizer-v1/references/baseline-v0.json");
const DEFAULT_OUTPUT = resolve(ROOT, "artifacts/40k-multiobjective-shadow/results.json");
const WIDTHS = Object.freeze([4, 8, 16, 32]);
const REPEATS = 2;
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
  return [{
    earnedSouls: 0,
    slots: Number(data.slots.item_limit) - Number(data.slots.starting_slots.universal)
  }];
}

function caseItemIds(data, definition) {
  const ids = definition.itemIds ? [...definition.itemIds] : data.items.map((item) => item.item_id);
  const missing = ids.filter((id) => !data.itemsById.has(id));
  if (missing.length) throw new Error(definition.id + ": unknown item ids: " + missing.join(", "));
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

function frontHash(front) {
  return hashLines(front.map((entry) =>
    entry.id + "|" + entry.pathScore.toPrecision(17) + "|" + entry.endScore.toPrecision(17)
  ));
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

function materializeCandidate(data, definition, state, measurement, transactions, legal, source) {
  const costs = new Map(data.items.map((item) => [item.item_id, Number(item.total_cost)]));
  return {
    id: pathId(state.events || []),
    source,
    pathScore: measurement.pathScore,
    endScore: measurement.endScore,
    pathDamage: measurement.pathDamage,
    endDamage: measurement.endDamage,
    pathSurvivability: measurement.pathSurvivability,
    endSurvivability: measurement.endSurvivability,
    inventory: [...state.inventory],
    cash: state.cash,
    transactions,
    legal,
    pathObservables: pathEventObservables(state.events || [], definition.budget, costs),
    events: state.events || []
  };
}

function productionRun(data, definition, reference) {
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
  const measurement = measureSoulAxisPath(
    result.state.snapshots,
    reference,
    definition.milestones,
    definition.budget,
    definition.focus
  );
  const candidate = materializeCandidate(
    data,
    definition,
    result.state,
    measurement,
    result.validation.transactions,
    result.semantics?.legallyPathVerified === true,
    "production"
  );
  return {
    runtimeMs: performance.now() - started,
    candidate,
    telemetry: result.searchTelemetry,
    semantics: result.semantics
  };
}

function materializeShadowFront(data, definition, raw) {
  return collapseEquivalentVectors(raw.front.map((entry) =>
    materializeCandidate(
      data,
      definition,
      entry.state,
      entry.measurement,
      entry.transactions,
      entry.validation.valid === true,
      "multiobjective-shadow"
    )
  ));
}

function runShadowOnce(data, definition, reference, repeat) {
  const started = performance.now();
  const runs = [];
  const union = new Map();
  let deadlineReached = false;

  for (const width of WIDTHS) {
    const elapsed = performance.now() - started;
    const remaining = definition.timeBudgetMs - elapsed;
    if (remaining <= 0) {
      deadlineReached = true;
      break;
    }
    const auditReserveMs = Math.min(2000, Math.max(0, remaining * 0.2));
    console.log(JSON.stringify({
      phase: "multiobjective-shadow",
      caseId: definition.id,
      repeat,
      width,
      remainingMs: Math.round(remaining)
    }));
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
      beamWidth: width,
      timeMs: remaining,
      auditReserveMs
    });
    const front = materializeShadowFront(data, definition, raw);
    for (const candidate of front) union.set(candidate.id, candidate);
    runs.push({
      width,
      front,
      frontHash: frontHash(front),
      telemetry: raw.telemetry
    });
    if (!raw.telemetry.searchComplete) {
      deadlineReached = true;
      break;
    }
  }

  const finalFront = collapseEquivalentVectors(pathEndParetoFront([...union.values()]));
  return {
    repeat,
    runtimeMs: performance.now() - started,
    timeBudgetMs: definition.timeBudgetMs,
    deadlineReached,
    widthsStarted: runs.map((run) => run.width),
    widthsCompleted: runs.filter((run) => run.telemetry.searchComplete).map((run) => run.width),
    partialWidth: runs.find((run) => !run.telemetry.searchComplete)?.width ?? null,
    front: finalFront,
    frontHash: frontHash(finalFront),
    frontCount: finalFront.length,
    legal: finalFront.length > 0 && finalFront.every((entry) => entry.legal),
    scalarizationUsed: false,
    searchGeneratedStates: runs.reduce((sum, run) => sum + run.telemetry.searchGeneratedStates, 0),
    totalGeneratedStates: runs.reduce((sum, run) => sum + run.telemetry.generatedStates, 0),
    evaluations: runs.reduce((sum, run) => sum + run.telemetry.evaluations, 0),
    duplicateStates: runs.reduce((sum, run) => sum + run.telemetry.duplicateStates, 0),
    maxFirstFrontSize: runs.length ? Math.max(...runs.map((run) => run.telemetry.maxFirstFrontSize)) : 0,
    frontierOverflowSteps: runs.reduce((sum, run) => sum + run.telemetry.frontierOverflowSteps, 0),
    terminalCandidates: runs.reduce((sum, run) => sum + run.telemetry.terminalCandidates, 0),
    maxNaturalReachedSouls: runs.length ? Math.max(...runs.map((run) => run.telemetry.maxReachedSouls)) : 0,
    saveCompletionGeneratedStates: runs.reduce((sum, run) => sum + (run.telemetry.saveCompletionGeneratedStates || 0), 0),
    terminalCompletion: runs.length ? runs.at(-1).telemetry.terminalCompletion : null,
    terminalAudit: runs.length ? runs.at(-1).telemetry.terminalAudit : null,
    runs: runs.map((run) => ({
      width: run.width,
      frontCount: run.front.length,
      frontHash: run.frontHash,
      searchComplete: run.telemetry.searchComplete,
      deadlineReached: run.telemetry.deadlineReached,
      runtimeMs: run.telemetry.runtimeMs,
      evaluations: run.telemetry.evaluations,
      searchGeneratedStates: run.telemetry.searchGeneratedStates,
      totalGeneratedStates: run.telemetry.generatedStates,
      maxFirstFrontSize: run.telemetry.maxFirstFrontSize,
      frontierOverflowSteps: run.telemetry.frontierOverflowSteps,
      terminalCandidates: run.telemetry.terminalCandidates,
      maxNaturalReachedSouls: run.telemetry.maxReachedSouls,
      saveCompletionGeneratedStates: run.telemetry.saveCompletionGeneratedStates || 0,
      terminalCompletion: run.telemetry.terminalCompletion,
      terminalAudit: run.telemetry.terminalAudit
    }))
  };
}

function reproducibility(first, second) {
  const firstByWidth = new Map(first.runs.map((run) => [run.width, run]));
  const secondByWidth = new Map(second.runs.map((run) => [run.width, run]));
  const commonWidths = WIDTHS.filter((width) => firstByWidth.has(width) && secondByWidth.has(width));
  const perWidth = commonWidths.map((width) => ({
    width,
    firstHash: firstByWidth.get(width).frontHash,
    secondHash: secondByWidth.get(width).frontHash,
    firstComplete: firstByWidth.get(width).searchComplete,
    secondComplete: secondByWidth.get(width).searchComplete,
    identical: firstByWidth.get(width).frontHash === secondByWidth.get(width).frontHash
  }));
  return {
    sameWidthsStarted: JSON.stringify(first.widthsStarted) === JSON.stringify(second.widthsStarted),
    sameWidthsCompleted: JSON.stringify(first.widthsCompleted) === JSON.stringify(second.widthsCompleted),
    identicalFinalFrontHash: first.frontHash === second.frontHash,
    identicalCommonWidthFrontHashes: perWidth.every((entry) => entry.identical),
    perWidth
  };
}

function compareProductionShadow(production, shadow) {
  const p = production.candidate;
  const shadowDominators = shadow.front.filter((entry) => pathEndDominates(entry, p));
  const betterPathNoEndLoss = shadow.front.filter((entry) =>
    entry.pathScore > p.pathScore && entry.endScore >= p.endScore
  );
  const betterEndNoPathLoss = shadow.front.filter((entry) =>
    entry.endScore > p.endScore && entry.pathScore >= p.pathScore
  );
  const combined = pathEndParetoFront([
    { ...p, id: "production:" + p.id },
    ...shadow.front.map((entry) => ({ ...entry, id: "shadow:" + entry.id }))
  ]);
  return {
    production: {
      id: p.id,
      pathScore: p.pathScore,
      endScore: p.endScore,
      legal: p.legal,
      pathObservables: p.pathObservables
    },
    shadowFrontCount: shadow.frontCount,
    shadowDominatesProduction: shadowDominators.map((entry) => entry.id),
    betterPathNoEndLoss: betterPathNoEndLoss.map((entry) => entry.id),
    betterEndNoPathLoss: betterEndNoPathLoss.map((entry) => entry.id),
    productionOnCombinedFront: combined.some((entry) => entry.id === "production:" + p.id),
    combinedFront: combined.map((entry) => ({
      id: entry.id,
      source: entry.source,
      pathScore: entry.pathScore,
      endScore: entry.endScore
    }))
  };
}

function compactPath(candidate) {
  return {
    id: candidate.id,
    source: candidate.source,
    pathScore: candidate.pathScore,
    endScore: candidate.endScore,
    inventory: candidate.inventory,
    transactions: candidate.transactions,
    legal: candidate.legal,
    pathObservables: candidate.pathObservables
  };
}

function caseExperiment(data, definition, reference) {
  if (definition.timeBudgetMs !== PRODUCT_SEARCH_TIME_MS) {
    throw new Error(definition.id + ": Production benchmark is not using the product 60s budget.");
  }

  console.log(JSON.stringify({ phase: "production-60s", caseId: definition.id }));
  const production = productionRun(data, definition, reference);
  const shadowRepeats = [];
  for (let repeat = 1; repeat <= REPEATS; repeat += 1) {
    shadowRepeats.push(runShadowOnce(data, definition, reference, repeat));
  }
  const shadow = shadowRepeats[0];
  const comparison = compareProductionShadow(production, shadow);

  return {
    caseId: definition.id,
    hero: definition.hero,
    focus: definition.focus,
    budget: definition.budget,
    timeBudgetMs: definition.timeBudgetMs,
    referenceVersion: "baseline-v0:" + definition.id,
    production: {
      runtimeMs: production.runtimeMs,
      path: compactPath(production.candidate),
      telemetry: production.telemetry,
      semantics: production.semantics
    },
    shadow: {
      ...shadow,
      front: shadow.front.map(compactPath),
      runs: shadow.runs
    },
    reproducibility: reproducibility(shadowRepeats[0], shadowRepeats[1]),
    repeat2: {
      runtimeMs: shadowRepeats[1].runtimeMs,
      deadlineReached: shadowRepeats[1].deadlineReached,
      widthsStarted: shadowRepeats[1].widthsStarted,
      widthsCompleted: shadowRepeats[1].widthsCompleted,
      partialWidth: shadowRepeats[1].partialWidth,
      frontCount: shadowRepeats[1].frontCount,
      frontHash: shadowRepeats[1].frontHash,
      legal: shadowRepeats[1].legal,
      searchGeneratedStates: shadowRepeats[1].searchGeneratedStates,
      totalGeneratedStates: shadowRepeats[1].totalGeneratedStates,
      evaluations: shadowRepeats[1].evaluations,
      maxNaturalReachedSouls: shadowRepeats[1].maxNaturalReachedSouls,
      saveCompletionGeneratedStates: shadowRepeats[1].saveCompletionGeneratedStates,
      terminalCompletion: shadowRepeats[1].terminalCompletion,
      maxFirstFrontSize: shadowRepeats[1].maxFirstFrontSize,
      frontierOverflowSteps: shadowRepeats[1].frontierOverflowSteps,
      terminalAudit: shadowRepeats[1].terminalAudit
    },
    comparison
  };
}

function compactCase(entry) {
  return {
    caseId: entry.caseId,
    hero: entry.hero,
    focus: entry.focus,
    budget: entry.budget,
    timeBudgetMs: entry.timeBudgetMs,
    production: {
      runtimeMs: entry.production.runtimeMs,
      path: entry.production.path,
      telemetry: entry.production.telemetry,
      semantics: entry.production.semantics
    },
    shadow: entry.shadow,
    reproducibility: entry.reproducibility,
    repeat2: entry.repeat2,
    comparison: entry.comparison
  };
}

function main() {
  const data = loadData();
  const references = JSON.parse(readFileSync(REFERENCE_FILE, "utf8"));
  const definitions = benchmarkCases("production");
  if (definitions.length !== 6) throw new Error("Expected exactly six Production 40k cases.");

  const cases = definitions.map((definition) => {
    const referenceEntry = references.references[definition.id];
    if (!referenceEntry?.reference) throw new Error(definition.id + ": frozen baseline-v0 reference missing.");
    return caseExperiment(data, definition, referenceEntry.reference);
  });

  const result = {
    schemaVersion: "optimizer-40k-multiobjective-shadow-v1",
    experiment: "60s-product-budget-plus-40k-multiobjective-shadow",
    sourceCommit: process.env.GITHUB_SHA || process.env.SOURCE_COMMIT || "unknown",
    generatedAt: new Date().toISOString(),
    productTimeBudgetMs: PRODUCT_SEARCH_TIME_MS,
    productionSelectionChanged: false,
    productionUiChanged: false,
    productionObjectiveChanged: false,
    shadowOnly: true,
    objectiveDimensions: ["Path-AUC", "Endbuild"],
    scalarizationUsedByShadow: false,
    widths: WIDTHS,
    repeatCount: REPEATS,
    reference: {
      file: "benchmarks/optimizer-v1/references/baseline-v0.json",
      policy: "historical baseline-v0 frozen reference reused; historical 25s results are not overwritten"
    },
    limitations: [
      "Production and shadow both receive the same 60s wall-clock budget per case, but use different retention logic.",
      "The Shadow runner performs iterative fixed-width passes inside one 60s envelope; a final width may be partial.",
      "Wall-clock cutoffs can change which width is reached across machines or repeats, so completed-width hashes and final timed fronts are reported separately.",
      "Pareto dominance is relative to observed candidates and is not a global optimality proof.",
      "No Production selection, UI, objective, search heuristic, canonical item data, Afterburn evaluator or solver is changed by this experiment."
    ],
    cases
  };

  const target = outputPath();
  const summaryTarget = resolve(dirname(target), "summary.json");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(result, null, 2) + "\n");
  writeFileSync(summaryTarget, JSON.stringify({
    ...result,
    cases: cases.map(compactCase)
  }, null, 2) + "\n");
  console.log(JSON.stringify({
    status: "COMPLETE",
    output: target,
    summaryOutput: summaryTarget,
    cases: cases.length
  }));
}

try {
  main();
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
}

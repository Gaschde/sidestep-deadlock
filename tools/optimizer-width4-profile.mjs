import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import os from "node:os";
import { parseCsv } from "../app/lib.mjs";
import { buildOptimizerData, heroCanPurchaseItem } from "../app/optimizer.mjs";
import { runIterativeDiverseBeamCarry } from "../app/beam-search.mjs";
import { PRODUCT_SEARCH_TIME_MS } from "../app/search-config.mjs";
import { benchmarkCases } from "../benchmarks/optimizer-v1/cases.mjs";
import { runControlledMultiobjectiveBeamCarry } from "../benchmarks/optimizer-v1/controlled-multiobjective-beam.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const REFERENCE_FILE = resolve(ROOT, "benchmarks/optimizer-v1/references/baseline-v0.json");
const DEFAULT_OUTPUT = resolve(ROOT, "artifacts/optimizer-width4-profile/results.json");
const TARGET_CASES = Object.freeze([
  "production-40k-warden-carry-hybrid",
  "production-40k-infernus-carry-hybrid"
]);
const WIDTH = 4;
const AUDIT_RESERVE_MS = 2000;
const SOUL_THRESHOLDS = Object.freeze([5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000]);

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

function itemIds(data, definition) {
  const ids = definition.itemIds ? [...definition.itemIds] : data.items.map((item) => item.item_id);
  return ids.filter((id) => heroCanPurchaseItem(data.itemsById.get(id), data, definition.hero));
}

function hardware() {
  const cpus = os.cpus();
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    cpuModel: cpus[0]?.model || "unknown",
    cpuCount: cpus.length
  };
}

function progressThresholds(trace) {
  const firstCandidate = {};
  const firstRetained = {};
  for (const threshold of SOUL_THRESHOLDS) {
    const c = trace.find((entry) => Number(entry.candidateSouls?.max) >= threshold);
    const r = trace.find((entry) => Number(entry.retainedSouls?.max) >= threshold);
    firstCandidate[threshold] = c ? { depth: c.depth, runtimeMs: c.runtimeMs } : null;
    firstRetained[threshold] = r ? { depth: r.depth, runtimeMs: r.runtimeMs } : null;
  }
  return { firstCandidate, firstRetained };
}

function summarizeTelemetry(telemetry) {
  const profile = telemetry?.profile;
  const trace = profile?.progressTrace || [];
  const last = trace.at(-1) || null;
  const first = trace[0] || null;
  const maxCandidateSouls = trace.reduce((max, entry) => Math.max(max, Number(entry.candidateSouls?.max ?? 0)), 0);
  const maxRetainedSouls = trace.reduce((max, entry) => Math.max(max, Number(entry.retainedSouls?.max ?? 0)), 0);
  return {
    runtimeMs: telemetry?.runtimeMs ?? null,
    generatedStates: telemetry?.generatedStates ?? null,
    searchGeneratedStates: telemetry?.searchGeneratedStates ?? telemetry?.generatedStates ?? null,
    evaluations: telemetry?.evaluations ?? null,
    transitionCalls: telemetry?.transitionCalls ?? profile?.counters?.transitionCalls ?? null,
    duplicateStates: telemetry?.duplicateStates ?? null,
    maxCandidatePool: telemetry?.maxCandidatePool ?? null,
    widthsStarted: telemetry?.widthsStarted ?? null,
    widthsCompleted: telemetry?.widthsCompleted ?? null,
    searchComplete: telemetry?.searchComplete ?? null,
    steps: telemetry?.steps ?? null,
    maxReachedSouls: telemetry?.maxReachedSouls ?? Math.max(maxCandidateSouls, maxRetainedSouls),
    terminalCandidates: telemetry?.terminalCandidates ?? null,
    terminalAudit: telemetry?.terminalAudit ?? null,
    timers: profile?.timers ?? null,
    counters: profile?.counters ?? null,
    traceLength: trace.length,
    firstProgress: first,
    lastProgress: last,
    thresholds: progressThresholds(trace),
    progressHead: trace.slice(0, 5),
    progressTail: trace.slice(-12)
  };
}

function compactTelemetry(telemetry) {
  if (!telemetry) return null;
  const { selectionTrace, ...rest } = telemetry;
  return rest;
}

function runProduction(data, definition, reference, profile) {
  const started = performance.now();
  const result = runIterativeDiverseBeamCarry({
    data,
    heroId: definition.hero,
    damageFocus: definition.focus,
    itemIds: itemIds(data, definition),
    budget: definition.budget,
    milestones: definition.milestones,
    opponentBulletResist: definition.opponentBulletResist,
    opponentSpiritResist: definition.opponentSpiritResist,
    timeMs: definition.timeBudgetMs,
    referenceTimeMs: definition.referenceTimeMs,
    reference,
    slotUnlocks: slotUnlocks(data),
    initialBeamWidth: WIDTH,
    maxBeamWidth: WIDTH,
    widenFactor: 2,
    profile
  });
  return {
    wallMs: performance.now() - started,
    terminalReached: result.state?.earnedSouls === definition.budget,
    pathVerified: result.semantics?.legallyPathVerified === true,
    transactions: result.validation?.transactions ?? null,
    telemetry: compactTelemetry(result.searchTelemetry),
    summary: summarizeTelemetry(result.searchTelemetry)
  };
}

function runMultiobjective(data, definition, reference, profile) {
  const started = performance.now();
  const result = runControlledMultiobjectiveBeamCarry({
    data,
    reference,
    heroId: definition.hero,
    damageFocus: definition.focus,
    itemIds: itemIds(data, definition),
    budget: definition.budget,
    milestones: definition.milestones,
    opponentBulletResist: definition.opponentBulletResist,
    opponentSpiritResist: definition.opponentSpiritResist,
    slotUnlocks: slotUnlocks(data),
    beamWidth: WIDTH,
    timeMs: definition.timeBudgetMs,
    auditReserveMs: AUDIT_RESERVE_MS,
    profile
  });
  return {
    wallMs: performance.now() - started,
    terminalReached: result.telemetry.terminalCandidates > 0,
    frontCount: result.front.length,
    telemetry: compactTelemetry(result.telemetry),
    summary: summarizeTelemetry(result.telemetry)
  };
}

function runPair(data, definition, reference) {
  console.log(JSON.stringify({ phase: "width4-profile", caseId: definition.id, engine: "production", profile: false }));
  const productionControl = runProduction(data, definition, reference, false);
  console.log(JSON.stringify({ phase: "width4-profile", caseId: definition.id, engine: "production", profile: true }));
  const productionProfiled = runProduction(data, definition, reference, true);
  console.log(JSON.stringify({ phase: "width4-profile", caseId: definition.id, engine: "multiobjective", profile: false }));
  const multiControl = runMultiobjective(data, definition, reference, false);
  console.log(JSON.stringify({ phase: "width4-profile", caseId: definition.id, engine: "multiobjective", profile: true }));
  const multiProfiled = runMultiobjective(data, definition, reference, true);

  return {
    caseId: definition.id,
    hero: definition.hero,
    focus: definition.focus,
    budget: definition.budget,
    width: WIDTH,
    timeBudgetMs: definition.timeBudgetMs,
    auditReserveMs: AUDIT_RESERVE_MS,
    production: {
      control: productionControl,
      profiled: productionProfiled
    },
    multiobjective: {
      control: multiControl,
      profiled: multiProfiled
    }
  };
}

function compactRun(run) {
  return {
    wallMs: run.wallMs,
    terminalReached: run.terminalReached,
    pathVerified: run.pathVerified,
    transactions: run.transactions,
    frontCount: run.frontCount,
    summary: run.summary
  };
}

function main() {
  if (PRODUCT_SEARCH_TIME_MS !== 60000) throw new Error("Expected current 60s product budget.");
  const data = loadData();
  const references = JSON.parse(readFileSync(REFERENCE_FILE, "utf8"));
  const definitions = benchmarkCases("production").filter((entry) => TARGET_CASES.includes(entry.id));
  if (definitions.length !== TARGET_CASES.length) throw new Error("Expected Warden/Infernus Hybrid production definitions.");

  const cases = definitions.map((definition) => {
    const referenceEntry = references.references[definition.id];
    if (!referenceEntry?.reference) throw new Error(definition.id + ": frozen baseline-v0 reference missing.");
    return runPair(data, definition, referenceEntry.reference);
  });

  const result = {
    schemaVersion: "optimizer-width4-profile-v1",
    experiment: "40k-multiobjective-width4-profiling",
    sourceCommit: process.env.GITHUB_SHA || process.env.SOURCE_COMMIT || "unknown",
    generatedAt: new Date().toISOString(),
    hardware: hardware(),
    width: WIDTH,
    productTimeBudgetMs: PRODUCT_SEARCH_TIME_MS,
    auditReserveMs: AUDIT_RESERVE_MS,
    semanticsChanged: false,
    profilingPolicy: {
      controlRun: "profile=false under the same wall-clock budget",
      profiledRun: "profile=true under the same wall-clock budget",
      timerSemantics: "inclusive/nested diagnostic timers; do not add timers into a runtime percentage",
      objective: "unchanged",
      retention: "unchanged",
      domain: "unchanged"
    },
    cases
  };

  const target = outputPath();
  const summaryTarget = resolve(dirname(target), "summary.json");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(result, null, 2) + "\n");
  writeFileSync(summaryTarget, JSON.stringify({
    ...result,
    cases: cases.map((entry) => ({
      caseId: entry.caseId,
      hero: entry.hero,
      focus: entry.focus,
      budget: entry.budget,
      width: entry.width,
      timeBudgetMs: entry.timeBudgetMs,
      auditReserveMs: entry.auditReserveMs,
      production: {
        control: compactRun(entry.production.control),
        profiled: compactRun(entry.production.profiled)
      },
      multiobjective: {
        control: compactRun(entry.multiobjective.control),
        profiled: compactRun(entry.multiobjective.profiled)
      }
    }))
  }, null, 2) + "\n");

  console.log(JSON.stringify({ status: "COMPLETE", output: target, summaryOutput: summaryTarget, cases: cases.length }));
}

try {
  main();
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
}

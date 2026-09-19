import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { parseCsv } from "../app/lib.mjs";
import {
  buildOptimizerData,
  evaluateWeaponMechanics,
  evaluateSpiritMechanics,
  evaluateAfterburnMechanics
} from "../app/optimizer.mjs";
import { evaluateCarryPerformance } from "../app/warden-search.mjs";
import { runIterativeDiverseBeamCarry } from "../app/beam-search.mjs";
import { benchmarkCases } from "../benchmarks/optimizer-v1/cases.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const json = (path) => JSON.parse(readFileSync(resolve(ROOT, path), "utf8"));
const csv = (path) => parseCsv(readFileSync(resolve(ROOT, path), "utf8"));

const data = buildOptimizerData({
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

const references = json("benchmarks/optimizer-v1/references/baseline-v0.json");
const baseline = json("benchmarks/optimizer-v1/baselines/baseline-v0.json");
const definitions = new Map(benchmarkCases("all").map((entry) => [entry.id, entry]));
const records = new Map(baseline.records.map((entry) => [entry.metadata.caseId, entry]));
const slotUnlocks = [{ earnedSouls: 0, slots: Number(data.slots.item_limit) - Number(data.slots.starting_slots.universal) }];

function fixedReference(caseId) {
  const entry = references.references[caseId];
  if (!entry?.reference) throw new Error(`Missing fixed reference for ${caseId}`);
  return entry.reference;
}

function itemIds(definition) {
  return definition.itemIds ? [...definition.itemIds] : data.items.map((item) => item.item_id);
}

function fixedWidth(caseId, width) {
  const definition = definitions.get(caseId);
  const started = performance.now();
  const result = runIterativeDiverseBeamCarry({
    data,
    heroId: definition.hero,
    damageFocus: definition.focus,
    itemIds: itemIds(definition),
    budget: definition.budget,
    milestones: definition.milestones,
    opponentBulletResist: definition.opponentBulletResist,
    opponentSpiritResist: definition.opponentSpiritResist,
    timeMs: definition.timeBudgetMs,
    referenceTimeMs: definition.referenceTimeMs,
    reference: fixedReference(caseId),
    slotUnlocks,
    initialBeamWidth: width,
    maxBeamWidth: width,
    widenFactor: 2,
    profile: false
  });
  return {
    width,
    runtimeMs: performance.now() - started,
    score: result.quality.score,
    generatedStates: result.searchTelemetry.generatedStates,
    evaluations: result.searchTelemetry.evaluations,
    maxCandidatePool: result.searchTelemetry.maxCandidatePool,
    terminalAuditComplete: result.searchTelemetry.terminalAudit.complete,
    terminalAudit: result.searchTelemetry.terminalAudit,
    publishedImprovements: result.searchTelemetry.publishedImprovements,
    widthsCompleted: result.searchTelemetry.widthsCompleted
  };
}

function widthStudy(caseId, widths) {
  const baselineRecord = records.get(caseId);
  const exactScore = baselineRecord?.exact?.exactScore ?? null;
  return {
    caseId,
    baselineScore: baselineRecord?.resultScore ?? null,
    exactScore,
    runs: widths.map((width) => {
      const run = fixedWidth(caseId, width);
      return {
        ...run,
        absoluteGapToExact: exactScore === null ? null : exactScore - run.score,
        deltaVsWidth4: null
      };
    })
  };
}

function finalizeDeltas(study) {
  const width4 = study.runs.find((entry) => entry.width === 4)?.score;
  if (width4 !== undefined) {
    for (const run of study.runs) run.deltaVsWidth4 = run.score - width4;
  }
  return study;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function measure(work, repeats) {
  for (let i = 0; i < 3; i++) work();
  const samples = [];
  for (let i = 0; i < repeats; i++) {
    const started = performance.now();
    work();
    samples.push(performance.now() - started);
  }
  return {
    repeats,
    medianMs: median(samples),
    meanMs: samples.reduce((sum, value) => sum + value, 0) / samples.length,
    minMs: Math.min(...samples),
    maxMs: Math.max(...samples)
  };
}

const evaluatorInventory = records.get("controlled-warden-carry-hybrid").inventory;
function evaluatorStudy(heroId) {
  const stateIds = { inventory: [...evaluatorInventory] };
  const stateItems = { inventory: evaluatorInventory.map((id) => data.itemsById.get(id)).filter(Boolean) };
  const request = {
    heroId,
    damageFocus: "hybrid",
    budget: 8000,
    metricsOnly: true,
    cacheProfiles: false,
    opponentBulletResist: 0,
    opponentSpiritResist: 0
  };
  const weapon = evaluateWeaponMechanics(stateItems, request, data);
  const afterburn = evaluateAfterburnMechanics(stateItems, request, data, weapon);
  const afterburnWindows = [10, 60, 10, 10, 4, 60, 10, 10, 4, 10];
  return {
    heroId,
    inventory: evaluatorInventory,
    fullCompactEvaluation: measure(() => {
      const result = evaluateCarryPerformance(stateIds, request, data);
      if (!result.valid) throw new Error(result.reason);
    }, 30),
    weaponSetup: measure(() => evaluateWeaponMechanics(stateItems, request, data), 100),
    spiritSetup: measure(() => evaluateSpiritMechanics(stateItems, request, data), 100),
    afterburnSetup: measure(() => evaluateAfterburnMechanics(stateItems, request, data, weapon), 100),
    afterburnMetricWork: measure(() => {
      for (const seconds of afterburnWindows) afterburn.damageAt(seconds);
    }, 30),
    afterburn: {
      applicable: afterburn.applicable,
      included: afterburn.included ?? false,
      triggerHits: afterburn.triggerHits ?? null,
      tickInterval: afterburn.tickInterval ?? null,
      weaponRoundsPerSecond: weapon.rounds_per_second
    }
  };
}

const output = {
  schemaVersion: "optimizer-runtime-investigation-v1",
  sourceCommit: process.env.GITHUB_SHA || "local",
  widthStudies: [
    finalizeDeltas(widthStudy("small-exact-warden-carry-weapon", [1, 2, 4, 8, 16, 64])),
    finalizeDeltas(widthStudy("controlled-warden-carry-hybrid", [1, 2, 4, 8, 16])),
    finalizeDeltas(widthStudy("controlled-infernus-carry-hybrid", [1, 2, 4, 8, 16]))
  ],
  evaluatorStudies: [evaluatorStudy("warden"), evaluatorStudy("infernus")]
};

console.log(JSON.stringify(output, null, 2));

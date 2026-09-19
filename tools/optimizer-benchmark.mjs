import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import os from "node:os";
import { parseCsv } from "../app/lib.mjs";
import { buildOptimizerData } from "../app/optimizer.mjs";
import { runIterativeDiverseBeamCarry } from "../app/beam-search.mjs";
import { createDeadlockDomain } from "../app/deadlock-domain.mjs";
import { searchLabels } from "../app/search-core.mjs";
import { evaluateCarryPerformance } from "../app/warden-search.mjs";
import { scoreMilestonePath, SEARCH_OBJECTIVE_VERSION } from "../app/search-objective.mjs";
import { scoreSoulAxisPath, EXPERIMENTAL_OBJECTIVE_VERSION } from "../app/search-objective-v1.mjs";
import { normalizeMilestones } from "../app/search-milestones.mjs";
import { benchmarkCases } from "../benchmarks/optimizer-v1/cases.mjs";
import {
  BASELINE_ID, BENCHMARK_SCHEMA_VERSION, REFERENCE_SCHEMA_VERSION,
  calculateGap, comparisonKey, compareBenchmarkRecords
} from "../benchmarks/optimizer-v1/benchmark-lib.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const DEFAULT_REFERENCE_FILE = resolve(ROOT, "benchmarks/optimizer-v1/references/baseline-v0.json");

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

function cli() {
  const args = process.argv.slice(2);
  const value = (flag, fallback = null) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : fallback;
  };
  return {
    suite: value("--suite", "all"),
    outputDir: resolve(value("--output-dir", "artifacts/optimizer-v1")),
    referenceFile: resolve(value("--references", existsSync(DEFAULT_REFERENCE_FILE) ? DEFAULT_REFERENCE_FILE : "artifacts/optimizer-v1/references-baseline-v0.json")),
    compare: args.includes("--compare") ? [value("--compare"), args[args.indexOf("--compare") + 2]].map((path) => resolve(path)) : null,
    objective: value("--objective", SEARCH_OBJECTIVE_VERSION),
    profile: !args.includes("--no-profile")
  };
}

function objectiveConfig(version) {
  if (version === SEARCH_OBJECTIVE_VERSION) return { version, scorer: scoreMilestonePath };
  if (version === EXPERIMENTAL_OBJECTIVE_VERSION) return { version, scorer: scoreSoulAxisPath };
  throw new RangeError(`Unknown objective version: ${version}`);
}

function hardwareMetadata() {
  const cpus = os.cpus();
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    cpuModel: cpus[0]?.model || "unknown",
    cpuCount: cpus.length
  };
}

function slotUnlocks(data) {
  return [{ earnedSouls: 0, slots: Number(data.slots.item_limit) - Number(data.slots.starting_slots.universal) }];
}

function caseItems(data, definition) {
  const ids = definition.itemIds ? [...definition.itemIds] : data.items.map((item) => item.item_id);
  const missing = ids.filter((id) => !data.itemsById.has(id));
  if (missing.length) throw new Error(`${definition.id}: unknown item ids: ${missing.join(", ")}`);
  return ids;
}

function runBeam(data, definition, reference, profile = true, timeMs = definition.timeBudgetMs, scorePath = scoreMilestonePath) {
  return runIterativeDiverseBeamCarry({
    data,
    heroId: definition.hero,
    damageFocus: definition.focus,
    itemIds: caseItems(data, definition),
    budget: definition.budget,
    milestones: definition.milestones,
    opponentBulletResist: definition.opponentBulletResist,
    opponentSpiritResist: definition.opponentSpiritResist,
    timeMs,
    referenceTimeMs: definition.referenceTimeMs,
    reference,
    slotUnlocks: slotUnlocks(data),
    initialBeamWidth: definition.initialBeamWidth,
    maxBeamWidth: definition.maxBeamWidth,
    widenFactor: definition.widenFactor,
    scorePath,
    profile
  });
}

function exactOracle(data, definition, reference, scorePath = scoreMilestonePath) {
  const ids = caseItems(data, definition);
  const unlocks = slotUnlocks(data);
  const request = {
    heroId: definition.hero,
    damageFocus: definition.focus,
    budget: definition.budget,
    cacheProfiles: false,
    metricsOnly: true,
    opponentBulletResist: definition.opponentBulletResist,
    opponentSpiritResist: definition.opponentSpiritResist
  };
  const metrics = (state) => {
    const result = evaluateCarryPerformance(state, request, data);
    if (!result.valid) throw new Error(result.reason);
    return result.metrics;
  };
  const domain = createDeadlockDomain({
    data,
    itemIds: ids,
    budget: definition.budget,
    soulAxis: reference.axis,
    slotUnlocks: unlocks,
    metrics
  });
  const oracle = searchLabels({
    initialState: domain.initial,
    expand: domain.transitions,
    stateKey: domain.stateKey,
    futureKey: domain.stateKey,
    label: () => ({ reachable: 1 })
  });
  const terminal = oracle.labels.filter((entry) => entry.state.earnedSouls === definition.budget);
  if (!terminal.length) throw new Error(`${definition.id}: exact oracle found no terminal state`);
  const exactScore = Math.max(...terminal.map((entry) =>
    scorePath(entry.state.snapshots, reference, definition.milestones, definition.budget, definition.focus).score));
  return { exactScore, expandedStates: oracle.expandedStates, generatedStates: oracle.generatedStates, terminalStates: terminal.length };
}

function endbuildMetrics(data, definition, result) {
  const evaluated = evaluateCarryPerformance(result.state, {
    heroId: definition.hero,
    damageFocus: definition.focus,
    budget: definition.budget,
    cacheProfiles: false,
    metricsOnly: true,
    opponentBulletResist: definition.opponentBulletResist,
    opponentSpiritResist: definition.opponentSpiritResist
  }, data);
  if (!evaluated.valid) throw new Error(evaluated.reason);
  return evaluated.metrics;
}

function pathObservables(events, budget) {
  let earnedSouls = 0;
  const timeline = [];
  const counts = { purchase: 0, upgrade: 0, replacement: 0, sell: 0 };
  for (const event of events || []) {
    if (event.type === "save") {
      earnedSouls = Number(event.earnedSouls);
      continue;
    }
    if (!Object.hasOwn(counts, event.type)) continue;
    counts[event.type]++;
    timeline.push({
      type: event.type,
      earnedSouls,
      item: event.item ?? null,
      from: event.from ?? null,
      payment: Number(event.payment ?? 0)
    });
  }
  const anchors = [0, ...timeline.map((event) => event.earnedSouls), budget].sort((a, b) => a - b);
  let longestNoShopSoulSpan = 0;
  for (let index = 1; index < anchors.length; index++) {
    longestNoShopSoulSpan = Math.max(longestNoShopSoulSpan, anchors[index] - anchors[index - 1]);
  }
  return {
    counts,
    transactionCount: timeline.length,
    firstTransactionSouls: timeline[0]?.earnedSouls ?? null,
    lastTransactionSouls: timeline.at(-1)?.earnedSouls ?? null,
    longestNoShopSoulSpan,
    timeline
  };
}

function loadReferenceDocument(path) {
  if (!existsSync(path)) return {
    schemaVersion: REFERENCE_SCHEMA_VERSION,
    baselineId: BASELINE_ID,
    sourceCommit: process.env.GITHUB_SHA || process.env.SOURCE_COMMIT || "unknown",
    generatedAt: new Date().toISOString(),
    references: {}
  };
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (parsed.schemaVersion !== REFERENCE_SCHEMA_VERSION) throw new Error("Unsupported reference schema.");
  return parsed;
}

function captureReference(data, definition) {
  const captured = runBeam(data, definition, undefined, false, definition.referenceCaptureTimeMs);
  return {
    version: `${BASELINE_ID}:${definition.id}`,
    source: "current-beam-sampled-reference",
    sourceCommit: process.env.GITHUB_SHA || process.env.SOURCE_COMMIT || "unknown",
    caseId: definition.id,
    captureTimeBudgetMs: definition.referenceCaptureTimeMs,
    referenceTimeMs: definition.referenceTimeMs,
    reference: captured.reference,
    captureTelemetry: captured.searchTelemetry
  };
}

function recordFor(data, definition, referenceEntry, hardware, timestamp, objective, profileEnabled) {
  // The score/result run is intentionally unprofiled so profiler overhead
  // cannot change how much wall-clock search work completes.
  const result = runBeam(data, definition, referenceEntry.reference, false, definition.timeBudgetMs, objective.scorer);
  const profilingRun = profileEnabled
    ? runBeam(data, definition, referenceEntry.reference, true, definition.timeBudgetMs, objective.scorer)
    : null;
  const exact = definition.exactOracle
    ? exactOracle(data, definition, referenceEntry.reference, objective.scorer)
    : null;
  const gap = exact ? calculateGap(exact.exactScore, result.quality.score) : null;
  const ids = caseItems(data, definition);
  const milestones = normalizeMilestones(definition.milestones, definition.budget);
  const metadata = {
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    timestamp,
    commit: process.env.GITHUB_SHA || process.env.SOURCE_COMMIT || "unknown",
    caseId: definition.id,
    level: definition.level,
    hero: definition.hero,
    role: definition.role,
    focus: definition.focus,
    backend: "iterative-diverse-beam",
    budget: definition.budget,
    slots: Number(data.slots.item_limit),
    itemIds: ids,
    timeBudgetMs: definition.timeBudgetMs,
    milestones,
    opponentResistances: {
      bullet: definition.opponentBulletResist,
      spirit: definition.opponentSpiritResist
    },
    objectiveVersion: objective.version,
    referenceSource: referenceEntry.source,
    referenceVersion: referenceEntry.version,
    searchBudget: {
      timeMs: definition.timeBudgetMs,
      initialBeamWidth: definition.initialBeamWidth,
      maxBeamWidth: definition.maxBeamWidth,
      widenFactor: definition.widenFactor
    },
    dataset: {
      core: {
        dataAsOf: data.coreManifest.data_as_of,
        patch: data.coreManifest.patch,
        schemaVersion: data.coreManifest.schema_version,
        itemCount: data.coreManifest.item_count
      },
      heroes: {
        dataAsOf: data.heroManifest.data_as_of,
        patch: data.heroManifest.patch,
        schemaVersion: data.heroManifest.schema_version,
        heroCount: data.heroManifest.hero_count
      }
    },
    hardware
  };
  metadata.comparisonKey = comparisonKey(metadata);
  return {
    metadata,
    resultScore: result.quality.score,
    endbuildMetrics: endbuildMetrics(data, definition, result),
    trajectoryMetrics: {
      score: result.quality.score,
      damage: result.quality.damage,
      survivability: result.quality.survivability,
      pathScore: result.quality.pathScore ?? null,
      endScore: result.quality.endScore ?? null,
      milestones: result.quality.milestones
    },
    commonPathMetrics: (() => {
      const common = scoreSoulAxisPath(result.state.snapshots, referenceEntry.reference,
        definition.milestones, definition.budget, definition.focus);
      return {
        pathScore: common.pathScore,
        endScore: common.endScore,
        combinedScore: common.score,
        pathDamage: common.pathDamage,
        endDamage: common.endDamage,
        pathSurvivability: common.pathSurvivability,
        endSurvivability: common.endSurvivability
      };
    })(),
    pathObservables: pathObservables(result.state.events, definition.budget),
    inventory: result.state.inventory,
    cash: result.state.cash,
    transactions: result.validation.transactions,
    legallyPathVerified: result.semantics.legallyPathVerified,
    locallyVerified: result.semantics.locallyVerified,
    bounded: exact ? true : result.semantics.bounded,
    optimal: exact ? gap.absoluteGap <= 1e-12 : result.semantics.optimal,
    exact: exact ? { ...exact, ...gap } : null,
    searchTelemetry: result.searchTelemetry,
    profilingRun: profilingRun ? {
      resultScore: profilingRun.quality.score,
      inventory: profilingRun.state.inventory,
      legallyPathVerified: profilingRun.semantics.legallyPathVerified,
      locallyVerified: profilingRun.semantics.locallyVerified,
      telemetry: profilingRun.searchTelemetry
    } : null
  };
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

async function main() {
  const options = cli();
  if (options.compare) {
    const [left, right] = options.compare.map((path) => JSON.parse(readFileSync(path, "utf8")));
    const byId = new Map(right.records.map((record) => [record.metadata.caseId, record]));
    const comparisons = left.records.map((record) => {
      const other = byId.get(record.metadata.caseId);
      return other ? { caseId: record.metadata.caseId, ...compareBenchmarkRecords(record, other) }
        : { caseId: record.metadata.caseId, comparable: false, verdict: null, reason: "Case missing in right run." };
    });
    console.log(JSON.stringify({ comparisons }, null, 2));
    return;
  }

  const data = loadData();
  const definitions = benchmarkCases(options.suite);
  const objective = objectiveConfig(options.objective);
  const references = loadReferenceDocument(options.referenceFile);
  const hardware = hardwareMetadata();
  const timestamp = new Date().toISOString();
  const records = [];

  for (const definition of definitions) {
    let entry = references.references[definition.id];
    if (!entry) {
      console.log(JSON.stringify({ phase: "reference-capture", caseId: definition.id }));
      entry = captureReference(data, definition);
      references.references[definition.id] = entry;
    }
    console.log(JSON.stringify({ phase: "benchmark", caseId: definition.id, referenceVersion: entry.version }));
    const record = recordFor(data, definition, entry, hardware, timestamp, objective, options.profile);
    records.push(record);
    console.log(JSON.stringify({ phase: "complete", caseId: definition.id, score: record.resultScore,
      legal: record.legallyPathVerified, exactGap: record.exact?.absoluteGap ?? null }));
  }

  const referenceOutput = resolve(options.outputDir, "references-baseline-v0.json");
  const resultOutput = resolve(options.outputDir, `${objective.version}.json`);
  references.generatedAt = timestamp;
  writeJson(referenceOutput, references);
  writeJson(resultOutput, {
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    baselineId: BASELINE_ID,
    objectiveVersion: objective.version,
    timestamp,
    sourceCommit: process.env.GITHUB_SHA || process.env.SOURCE_COMMIT || "unknown",
    records
  });
  console.log(JSON.stringify({ status: "COMPLETE", resultOutput, referenceOutput, objectiveVersion: objective.version, cases: records.length }));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseCsv } from "../app/lib.mjs";
import { buildOptimizerData, heroCanPurchaseItem } from "../app/optimizer.mjs";
import { evaluateCarryPerformance } from "../app/warden-search.mjs";
import {
  CARRY_OBJECTIVE_DAMAGE_PRIMARY_B,
  measureSoulAxisPath
} from "../app/search-objective-v1.mjs";
import { runControlledMultiobjectiveBeamCarry } from "../app/multiobjective-search.mjs";
import { pathEndDominates, pathEndParetoFront, pathEventObservables } from "../app/path-end-pareto.mjs";
import { benchmarkCases } from "../benchmarks/optimizer-v1/cases.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const REFERENCE_FILE = resolve(ROOT, "benchmarks/optimizer-v1/references/baseline-v0.json");
const DEFAULT_OUTPUT = resolve(ROOT, "artifacts/carry-objective-search-validation/results.json");
const FOCUSES = Object.freeze(["weapon", "spirit", "hybrid"]);
const WIDTHS = Object.freeze([4, 8, 16, 32]);
const REPEATS = 2;

const SWEET_SPOT = Object.freeze({
  id: "carry-sweet-70-30-spec-77_5-22_5",
  damageWeight: 0.70,
  survivalWeight: 0.30,
  damageFocusWeights: Object.freeze({
    weapon: Object.freeze({ bullet: 0.775, spirit: 0.225 }),
    spirit: Object.freeze({ bullet: 0.225, spirit: 0.775 }),
    hybrid: Object.freeze({ bullet: 0.5, spirit: 0.5 })
  })
});

const OBJECTIVES = Object.freeze({
  A: SWEET_SPOT,
  B: CARRY_OBJECTIVE_DAMAGE_PRIMARY_B
});

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

function caseDefinition(focus) {
  const definition = benchmarkCases("production").find((entry) =>
    entry.hero === "warden" && entry.focus === focus
  );
  if (!definition) throw new Error("Missing Warden production case for " + focus);
  return definition;
}

function caseItemIds(data, definition) {
  const ids = definition.itemIds ? [...definition.itemIds] : data.items.map((item) => item.item_id);
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

function pathId(events) {
  return createHash("sha256").update(JSON.stringify(events)).digest("hex").slice(0, 16);
}

function hashIds(ids) {
  return createHash("sha256").update([...ids].sort().join("\n")).digest("hex");
}

function categoryInvestments(data, inventory) {
  const totals = { weapon: 0, vitality: 0, spirit: 0 };
  for (const id of inventory || []) {
    const item = data.itemsById.get(id);
    const category = String(item?.category || "").toLowerCase();
    if (Object.hasOwn(totals, category)) totals[category] += Number(item.total_cost);
  }
  return totals;
}

function thresholdTiming(data, events) {
  const result = {
    weapon: { souls: null, transaction: null },
    vitality: { souls: null, transaction: null },
    spirit: { souls: null, transaction: null }
  };
  let earnedSouls = 0;
  let transaction = 0;
  let inventory = [];

  for (const event of events || []) {
    if (event.type === "save") {
      earnedSouls = Number(event.earnedSouls);
      continue;
    }
    if (event.type === "purchase") {
      inventory = [...inventory, event.item];
    } else if (event.type === "upgrade" || event.type === "replacement") {
      const index = inventory.indexOf(event.from);
      if (index < 0) throw new Error("Threshold replay is missing owned item " + event.from);
      inventory = [...inventory];
      inventory.splice(index, 1, event.item);
    } else if (event.type === "sell") {
      const index = inventory.indexOf(event.from);
      if (index < 0) throw new Error("Threshold replay is missing sold item " + event.from);
      inventory = [...inventory];
      inventory.splice(index, 1);
    } else {
      continue;
    }
    transaction += 1;
    const investment = categoryInvestments(data, inventory);
    for (const category of Object.keys(result)) {
      if (result[category].souls === null && investment[category] >= 4800) {
        result[category] = { souls: earnedSouls, transaction };
      }
    }
  }
  return result;
}

function metricsFor(data, definition) {
  const request = requestFor(definition);
  return (state) => {
    const result = evaluateCarryPerformance(state, request, data);
    if (!result.valid) throw new Error(result.reason);
    return result.metrics;
  };
}

function measureState(state, reference, definition, config) {
  return measureSoulAxisPath(
    state.snapshots,
    reference,
    definition.milestones,
    definition.budget,
    definition.focus,
    null,
    config
  );
}

function candidateRecord(data, definition, entry, objective, repeat, width) {
  const itemCosts = new Map(data.items.map((item) => [item.item_id, Number(item.total_cost)]));
  const observables = pathEventObservables(entry.state.events, definition.budget, itemCosts);
  const investments = categoryInvestments(data, entry.state.inventory);
  const thresholds4800 = thresholdTiming(data, entry.state.events);
  for (const category of Object.keys(investments)) {
    if (investments[category] >= 4800 && thresholds4800[category].souls === null) {
      throw new Error(definition.id + ": missing 4.8k threshold timing for " + category);
    }
  }
  const reacquisitionEvents = observables.reacquiredItems.reduce((sum, row) => sum + Number(row.count), 0);
  return {
    id: pathId(entry.state.events),
    objective,
    repeat,
    width,
    state: entry.state,
    pathScore: entry.pathScore,
    endScore: entry.endScore,
    pathDamage: entry.measurement.pathDamage,
    endDamage: entry.measurement.endDamage,
    pathSurvivability: entry.measurement.pathSurvivability,
    endSurvivability: entry.measurement.endSurvivability,
    inventory: [...entry.state.inventory],
    investments,
    thresholds4800,
    transactions: observables.transactionCount,
    transactionTypes: observables.counts,
    replacements: observables.counts.replacement,
    sells: observables.counts.sell,
    reacquisitionEvents,
    reacquisitions: observables.reacquiredItems,
    churn: {
      sameSoulTransactionGroups: observables.sameSoulTransactionGroups,
      sellRebuys: observables.sellRebuys,
      replacementRebuys: observables.replacementRebuys,
      upgradeBacktracks: observables.upgradeBacktracks
    },
    sources: entry.sources
  };
}

function runSingleSearch(data, definition, reference, label, config, repeat) {
  const started = performance.now();
  const runs = [];
  const union = new Map();

  for (const width of WIDTHS) {
    const elapsed = performance.now() - started;
    const remaining = definition.timeBudgetMs - elapsed;
    if (remaining <= 0) break;
    const auditReserveMs = Math.min(2000, Math.max(0, remaining * 0.2));
    console.log(JSON.stringify({
      phase: "controlled-search",
      caseId: definition.id,
      focus: definition.focus,
      objective: label,
      repeat,
      width,
      remainingMs: Math.round(remaining)
    }));
    const raw = runControlledMultiobjectiveBeamCarry({
      data,
      reference,
      heroId: definition.hero,
      damageFocus: definition.focus,
      objectiveConfig: config,
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

    for (const entry of raw.front) {
      const candidate = candidateRecord(data, definition, entry, label, repeat, width);
      union.set(candidate.id, candidate);
    }

    runs.push({
      width,
      searchComplete: raw.telemetry.searchComplete,
      runtimeMs: raw.telemetry.runtimeMs,
      evaluations: raw.telemetry.evaluations,
      generatedStates: raw.telemetry.generatedStates,
      searchGeneratedStates: raw.telemetry.searchGeneratedStates,
      duplicateStates: raw.telemetry.duplicateStates,
      naturalSearchMaxReachedSouls: raw.telemetry.maxReachedSouls,
      terminalCandidates: raw.telemetry.terminalCandidates,
      finalFrontSize: raw.telemetry.finalFrontSize,
      steps: raw.telemetry.steps,
      maxCandidatePool: raw.telemetry.maxCandidatePool,
      maxFirstFrontSize: raw.telemetry.maxFirstFrontSize,
      objectiveConfigId: raw.telemetry.objectiveConfigId,
      referenceSource: raw.telemetry.referenceSource,
      referenceMs: raw.telemetry.referenceMs,
      terminalAudit: raw.telemetry.terminalAudit,
      terminalCompletion: raw.telemetry.terminalCompletion
    });
    if (!raw.telemetry.searchComplete) break;
  }

  const front = pathEndParetoFront([...union.values()]);
  const frontIds = new Set(front.map((entry) => entry.id));
  return {
    label,
    repeat,
    objectiveConfigId: config.id,
    runtimeMs: performance.now() - started,
    timeBudgetMs: definition.timeBudgetMs,
    widthsConfigured: WIDTHS,
    widthsStarted: runs.map((entry) => entry.width),
    widthsCompleted: runs.filter((entry) => entry.searchComplete).map((entry) => entry.width),
    itemCandidateSetHash: hashIds(caseItemIds(data, definition)),
    referenceAxisHash: hashIds(reference.axis.map(String)),
    evaluations: runs.reduce((sum, entry) => sum + entry.evaluations, 0),
    generatedStates: runs.reduce((sum, entry) => sum + entry.generatedStates, 0),
    searchGeneratedStates: runs.reduce((sum, entry) => sum + entry.searchGeneratedStates, 0),
    naturalSearchMaxReachedSouls: runs.length ? Math.max(...runs.map((entry) => entry.naturalSearchMaxReachedSouls)) : 0,
    runs,
    front: [...union.values()].filter((entry) => frontIds.has(entry.id))
  };
}

function compactCandidate(candidate) {
  const { state: _state, ...compact } = candidate;
  return compact;
}

function unionOwnFront(searches) {
  const union = new Map();
  for (const search of searches) {
    for (const candidate of search.front) {
      const existing = union.get(candidate.id);
      if (!existing) {
        union.set(candidate.id, { ...candidate, repeatsFound: [search.repeat] });
      } else if (!existing.repeatsFound.includes(search.repeat)) {
        existing.repeatsFound.push(search.repeat);
      }
    }
  }
  const front = pathEndParetoFront([...union.values()]);
  const ids = new Set(front.map((entry) => entry.id));
  return {
    discoveredCount: union.size,
    front: [...union.values()].filter((entry) => ids.has(entry.id))
  };
}

function crossRescore(definition, reference, aSearches, bSearches) {
  const union = new Map();
  const add = (candidate, label, repeat) => {
    const existing = union.get(candidate.id);
    if (!existing) {
      union.set(candidate.id, {
        candidate,
        discoveredBy: new Set([label]),
        discoveries: [{ objective: label, repeat }]
      });
    } else {
      existing.discoveredBy.add(label);
      if (!existing.discoveries.some((row) => row.objective === label && row.repeat === repeat)) {
        existing.discoveries.push({ objective: label, repeat });
      }
    }
  };

  for (const search of aSearches) for (const candidate of search.front) add(candidate, "A", search.repeat);
  for (const search of bSearches) for (const candidate of search.front) add(candidate, "B", search.repeat);

  const records = [...union.values()].map(({ candidate, discoveredBy, discoveries }) => {
    const sweet = measureState(candidate.state, reference, definition, OBJECTIVES.A);
    const aggressive = measureState(candidate.state, reference, definition, OBJECTIVES.B);
    return {
      id: candidate.id,
      discoveredBy: [...discoveredBy].sort(),
      discoveries,
      inventory: candidate.inventory,
      investments: candidate.investments,
      thresholds4800: candidate.thresholds4800,
      transactions: candidate.transactions,
      transactionTypes: candidate.transactionTypes,
      replacements: candidate.replacements,
      sells: candidate.sells,
      reacquisitionEvents: candidate.reacquisitionEvents,
      reacquisitions: candidate.reacquisitions,
      churn: candidate.churn,
      A: {
        pathScore: sweet.pathScore,
        endScore: sweet.endScore,
        pathDamage: sweet.pathDamage,
        endDamage: sweet.endDamage,
        pathSurvivability: sweet.pathSurvivability,
        endSurvivability: sweet.endSurvivability
      },
      B: {
        pathScore: aggressive.pathScore,
        endScore: aggressive.endScore,
        pathDamage: aggressive.pathDamage,
        endDamage: aggressive.endDamage,
        pathSurvivability: aggressive.pathSurvivability,
        endSurvivability: aggressive.endSurvivability
      }
    };
  });

  const frontFor = (key) => pathEndParetoFront(records.map((entry) => ({
    ...entry,
    pathScore: entry[key].pathScore,
    endScore: entry[key].endScore
  }))).map((entry) => entry.id);

  const frontA = frontFor("A");
  const frontB = frontFor("B");
  const aOnly = records.filter((entry) => entry.discoveredBy.length === 1 && entry.discoveredBy[0] === "A").map((entry) => entry.id);
  const bOnly = records.filter((entry) => entry.discoveredBy.length === 1 && entry.discoveredBy[0] === "B").map((entry) => entry.id);
  const both = records.filter((entry) => entry.discoveredBy.length === 2).map((entry) => entry.id);

  const aCandidatesDominatedUnderAByB = records.filter((entry) =>
    entry.discoveredBy.includes("A") &&
    records.some((other) => other.discoveredBy.includes("B") && other.id !== entry.id &&
      pathEndDominates(other.A, entry.A))
  ).map((entry) => entry.id);

  const aCandidatesDominatedUnderBByB = records.filter((entry) =>
    entry.discoveredBy.includes("A") &&
    records.some((other) => other.discoveredBy.includes("B") && other.id !== entry.id &&
      pathEndDominates(other.B, entry.B))
  ).map((entry) => entry.id);

  const bCandidatesDominatedUnderAByA = records.filter((entry) =>
    entry.discoveredBy.includes("B") &&
    records.some((other) => other.discoveredBy.includes("A") && other.id !== entry.id &&
      pathEndDominates(other.A, entry.A))
  ).map((entry) => entry.id);

  const bCandidatesDominatedUnderBByA = records.filter((entry) =>
    entry.discoveredBy.includes("B") &&
    records.some((other) => other.discoveredBy.includes("A") && other.id !== entry.id &&
      pathEndDominates(other.B, entry.B))
  ).map((entry) => entry.id);

  return {
    unionCount: records.length,
    discoveredOnlyA: aOnly,
    discoveredOnlyB: bOnly,
    discoveredBoth: both,
    paretoFrontUnderA: frontA,
    paretoFrontUnderB: frontB,
    aCandidatesDominatedUnderAByB,
    aCandidatesDominatedUnderBByB,
    bCandidatesDominatedUnderAByA,
    bCandidatesDominatedUnderBByA,
    records
  };
}

function numbers(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return { min: null, median: null, max: null };
  const middle = Math.floor(sorted.length / 2);
  return {
    min: sorted[0],
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    max: sorted.at(-1)
  };
}

function summarizeFront(front) {
  const thresholds = {};
  for (const category of ["weapon", "vitality", "spirit"]) {
    const values = front.map((entry) => entry.thresholds4800[category].souls).filter((value) => value !== null);
    thresholds[category] = { ...numbers(values), nullCount: front.length - values.length };
  }
  return {
    count: front.length,
    pathScore: numbers(front.map((entry) => entry.pathScore)),
    endScore: numbers(front.map((entry) => entry.endScore)),
    pathDamage: numbers(front.map((entry) => entry.pathDamage)),
    endDamage: numbers(front.map((entry) => entry.endDamage)),
    pathSurvivability: numbers(front.map((entry) => entry.pathSurvivability)),
    endSurvivability: numbers(front.map((entry) => entry.endSurvivability)),
    investments: {
      weapon: numbers(front.map((entry) => entry.investments.weapon)),
      vitality: numbers(front.map((entry) => entry.investments.vitality)),
      spirit: numbers(front.map((entry) => entry.investments.spirit))
    },
    thresholds4800: thresholds,
    transactions: numbers(front.map((entry) => entry.transactions)),
    replacements: numbers(front.map((entry) => entry.replacements)),
    sells: numbers(front.map((entry) => entry.sells)),
    reacquisitionEvents: numbers(front.map((entry) => entry.reacquisitionEvents))
  };
}

function aggregateObjective(searches) {
  const union = unionOwnFront(searches);
  return {
    repeatCount: searches.length,
    repeats: searches.map((search) => ({
      repeat: search.repeat,
      runtimeMs: search.runtimeMs,
      widthsStarted: search.widthsStarted,
      widthsCompleted: search.widthsCompleted,
      evaluations: search.evaluations,
      generatedStates: search.generatedStates,
      searchGeneratedStates: search.searchGeneratedStates,
      naturalSearchMaxReachedSouls: search.naturalSearchMaxReachedSouls,
      frontSize: search.front.length,
      frontIds: search.front.map((entry) => entry.id),
      front: search.front.map(compactCandidate)
    })),
    discoveredFrontCandidatesAcrossRepeats: union.discoveredCount,
    unionFront: union.front.map(compactCandidate),
    unionFrontSummary: summarizeFront(union.front)
  };
}

function runCase(data, references, focus) {
  const definition = caseDefinition(focus);
  const referenceEntry = references.references[definition.id];
  if (!referenceEntry?.reference) throw new Error(definition.id + ": frozen reference missing");
  const reference = referenceEntry.reference;

  const aSearches = [];
  const bSearches = [];
  for (let repeat = 1; repeat <= REPEATS; repeat += 1) {
    const a = runSingleSearch(data, definition, reference, "A", OBJECTIVES.A, repeat);
    const b = runSingleSearch(data, definition, reference, "B", OBJECTIVES.B, repeat);
    if (a.itemCandidateSetHash !== b.itemCandidateSetHash || a.referenceAxisHash !== b.referenceAxisHash) {
      throw new Error(definition.id + ": A/B controls diverged in repeat " + repeat);
    }
    aSearches.push(a);
    bSearches.push(b);
  }

  const crossScoredUnion = crossRescore(definition, reference, aSearches, bSearches);
  return {
    caseId: definition.id,
    focus,
    controls: {
      hero: definition.hero,
      budget: definition.budget,
      timeBudgetMsPerObjectiveRepeat: definition.timeBudgetMs,
      repeatCount: REPEATS,
      widths: WIDTHS,
      auditReservePolicy: "min(2000ms, 20% of remaining width budget)",
      itemCandidateSetHash: aSearches[0].itemCandidateSetHash,
      referenceVersion: referenceEntry.version,
      referenceAxisHash: aSearches[0].referenceAxisHash,
      referenceIdenticalAcrossAAndB: true,
      referenceSource: "frozen supplied baseline-v0",
      scalarizationUsed: false,
      searchOrder: "A then B within each repeat"
    },
    A: aggregateObjective(aSearches),
    B: aggregateObjective(bSearches),
    crossScoredUnion
  };
}

function main() {
  const data = loadData();
  const references = JSON.parse(readFileSync(REFERENCE_FILE, "utf8"));
  const cases = FOCUSES.map((focus) => runCase(data, references, focus));

  const result = {
    schemaVersion: "optimizer-carry-objective-search-validation-v1",
    experiment: "sweet-70-30-77_5-vs-aggressive-75-25-85-controlled-search",
    sourceCommit: process.env.GITHUB_SHA || process.env.SOURCE_COMMIT || "unknown",
    generatedAt: new Date().toISOString(),
    productionChanged: false,
    uiChanged: false,
    searchAlgorithmChanged: false,
    objectiveA: {
      id: OBJECTIVES.A.id,
      damageSurvival: { damage: 0.70, survival: 0.30 },
      focus: OBJECTIVES.A.damageFocusWeights,
      effective: {
        weapon: { bullet: 0.5425, spirit: 0.1575, survival: 0.30 },
        spirit: { bullet: 0.1575, spirit: 0.5425, survival: 0.30 },
        hybrid: { bullet: 0.35, spirit: 0.35, survival: 0.30 }
      }
    },
    objectiveB: {
      id: OBJECTIVES.B.id,
      damageSurvival: { damage: 0.75, survival: 0.25 },
      focus: OBJECTIVES.B.damageFocusWeights,
      effective: {
        weapon: { bullet: 0.6375, spirit: 0.1125, survival: 0.25 },
        spirit: { bullet: 0.1125, spirit: 0.6375, survival: 0.25 },
        hybrid: { bullet: 0.375, spirit: 0.375, survival: 0.25 }
      }
    },
    unchanged: [
      "controlled multiobjective search algorithm",
      "Path-AUC and Endbuild Pareto objectives",
      "beam width schedule 4/8/16/32",
      "Lazy Pareto retention",
      "future-path-history dedupe",
      "existing diversity selection",
      "Save-to-40k and terminalization",
      "40k horizon",
      "candidate item space",
      "canonical item/evaluator/threshold data",
      "slot logic",
      "frozen reference methodology",
      "per-repeat 60s benchmark budget",
      "audit reserve policy",
      "known duplicate 10s damage metrics",
      "churn semantics"
    ],
    caveats: [
      "Wallclock cutoff makes repeated runs machine- and timing-sensitive even with deterministic search ordering.",
      "Absolute A/B utility scores use different objective weights and are not directly comparable as performance values.",
      "Cross-rescoring is the primary control for separating search discovery from score scaling."
    ],
    cases
  };

  const target = outputPath();
  const summaryTarget = resolve(dirname(target), "summary.json");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(result, null, 2) + "\n");
  writeFileSync(summaryTarget, JSON.stringify(result, (key, value) => key === "records" ? undefined : value, 2) + "\n");
  console.log(JSON.stringify({
    status: "COMPLETE",
    output: target,
    summaryOutput: summaryTarget,
    repeats: REPEATS,
    cases: cases.map((entry) => ({
      focus: entry.focus,
      AFront: entry.A.unionFront.map((candidate) => candidate.id),
      BFront: entry.B.unionFront.map((candidate) => candidate.id),
      crossA: entry.crossScoredUnion.paretoFrontUnderA,
      crossB: entry.crossScoredUnion.paretoFrontUnderB
    }))
  }));
}

try {
  main();
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
}

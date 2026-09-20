import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseCsv } from "../app/lib.mjs";
import { buildOptimizerData, heroCanPurchaseItem } from "../app/optimizer.mjs";
import { createDeadlockDomain } from "../app/deadlock-domain.mjs";
import { evaluateCarryPerformance } from "../app/warden-search.mjs";
import {
  CARRY_OBJECTIVE_BASELINE_A,
  CARRY_OBJECTIVE_DAMAGE_PRIMARY_B,
  measureSoulAxisPath
} from "../app/search-objective-v1.mjs";
import { runControlledMultiobjectiveBeamCarry } from "../app/multiobjective-search.mjs";
import { pathEndDominates, pathEndParetoFront, pathEventObservables } from "../app/path-end-pareto.mjs";
import { validateSearchPath } from "../app/validate-search-path.mjs";
import { benchmarkCases } from "../benchmarks/optimizer-v1/cases.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const REFERENCE_FILE = resolve(ROOT, "benchmarks/optimizer-v1/references/baseline-v0.json");
const STORED_PATHS_FILE = resolve(ROOT, "benchmarks/optimizer-v1/experiments/40k-multiobjective-shadow/results.json");
const DEFAULT_OUTPUT = resolve(ROOT, "artifacts/carry-objective-ab/results.json");
const WIDTHS = Object.freeze([4, 8, 16, 32]);
const FOCUSES = Object.freeze(["weapon", "spirit", "hybrid"]);
const OBJECTIVES = Object.freeze({
  A: CARRY_OBJECTIVE_BASELINE_A,
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

function hashIds(ids) {
  return createHash("sha256").update([...ids].sort().join("\n")).digest("hex");
}

function eventMatches(actual, expected) {
  if (actual?.type !== expected?.type) return false;
  if ((actual.item || null) !== (expected.item || null)) return false;
  if ((actual.from || null) !== (expected.from || null)) return false;
  if (Number.isFinite(expected.payment) && Math.abs(Number(actual.payment) - Number(expected.payment)) > 1e-9) return false;
  return true;
}

function replayStoredPath(data, definition, reference, stored) {
  const itemIds = caseItemIds(data, definition);
  const domain = createDeadlockDomain({
    data,
    itemIds,
    budget: definition.budget,
    soulAxis: reference.axis,
    slotUnlocks: slotUnlocks(data),
    metrics: metricsFor(data, definition)
  });
  let state = domain.initial;
  const timeline = stored.pathObservables?.timeline;
  if (!Array.isArray(timeline)) throw new Error(stored.id + ": stored path has no transaction timeline");

  for (const expected of timeline) {
    while (state.earnedSouls < expected.earnedSouls) {
      const saves = domain.transitions(state).filter((candidate) => candidate.events.at(-1)?.type === "save");
      if (saves.length !== 1) throw new Error(stored.id + ": replay save transition is not unique");
      state = saves[0];
    }
    if (state.earnedSouls !== expected.earnedSouls) {
      throw new Error(stored.id + ": replay overshot transaction Souls");
    }
    const matches = domain.transitions(state).filter((candidate) => eventMatches(candidate.events.at(-1), expected));
    if (matches.length !== 1) {
      throw new Error(stored.id + ": expected transaction did not replay uniquely: " + JSON.stringify(expected));
    }
    state = matches[0];
  }

  while (state.earnedSouls < definition.budget) {
    const saves = domain.transitions(state).filter((candidate) => candidate.events.at(-1)?.type === "save");
    if (saves.length !== 1) throw new Error(stored.id + ": terminal replay save transition is not unique");
    state = saves[0];
  }

  const validation = validateSearchPath({
    data,
    itemIds,
    budget: definition.budget,
    soulAxis: reference.axis,
    slotUnlocks: slotUnlocks(data),
    state
  });
  if (validation.valid !== true) throw new Error(stored.id + ": replayed path is illegal");
  if (pathId(state.events) !== stored.id) {
    throw new Error(stored.id + ": replayed event hash differs from stored path id");
  }
  if (JSON.stringify([...state.inventory].sort()) !== JSON.stringify([...(stored.inventory || [])].sort())) {
    throw new Error(stored.id + ": replayed final inventory differs");
  }
  return state;
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

function candidateRecord(data, definition, stored, state) {
  const a = measureState(state, definition.reference, definition, OBJECTIVES.A);
  const b = measureState(state, definition.reference, definition, OBJECTIVES.B);
  const observables = pathEventObservables(
    state.events,
    definition.budget,
    new Map(data.items.map((item) => [item.item_id, Number(item.total_cost)]))
  );
  return {
    id: stored.id,
    source: stored.source || "stored",
    inventory: [...state.inventory],
    investments: categoryInvestments(data, state.inventory),
    thresholds4800: thresholdTiming(data, state.events),
    transactions: observables.transactionCount,
    reacquisitions: observables.reacquiredItems,
    churn: {
      sameSoulTransactionGroups: observables.sameSoulTransactionGroups,
      sellRebuys: observables.sellRebuys,
      replacementRebuys: observables.replacementRebuys,
      upgradeBacktracks: observables.upgradeBacktracks
    },
    A: {
      pathScore: a.pathScore,
      endScore: a.endScore,
      pathDamage: a.pathDamage,
      endDamage: a.endDamage,
      pathSurvivability: a.pathSurvivability,
      endSurvivability: a.endSurvivability
    },
    B: {
      pathScore: b.pathScore,
      endScore: b.endScore,
      pathDamage: b.pathDamage,
      endDamage: b.endDamage,
      pathSurvivability: b.pathSurvivability,
      endSurvivability: b.endSurvivability
    }
  };
}

function paretoLayers(candidates, key) {
  const remaining = [...candidates];
  const layers = [];
  while (remaining.length) {
    const front = remaining.filter((candidate, index) =>
      !remaining.some((other, otherIndex) =>
        otherIndex !== index && pathEndDominates(
          { pathScore: other[key].pathScore, endScore: other[key].endScore },
          { pathScore: candidate[key].pathScore, endScore: candidate[key].endScore }
        )
      )
    );
    if (!front.length) throw new Error("Pareto layering made no progress");
    layers.push(front.map((entry) => entry.id).sort());
    const ids = new Set(front.map((entry) => entry.id));
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      if (ids.has(remaining[index].id)) remaining.splice(index, 1);
    }
  }
  return layers;
}

function dominanceRelationChanges(candidates) {
  let changed = 0;
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      const aLR = pathEndDominates(
        { pathScore: candidates[left].A.pathScore, endScore: candidates[left].A.endScore },
        { pathScore: candidates[right].A.pathScore, endScore: candidates[right].A.endScore }
      );
      const aRL = pathEndDominates(
        { pathScore: candidates[right].A.pathScore, endScore: candidates[right].A.endScore },
        { pathScore: candidates[left].A.pathScore, endScore: candidates[left].A.endScore }
      );
      const bLR = pathEndDominates(
        { pathScore: candidates[left].B.pathScore, endScore: candidates[left].B.endScore },
        { pathScore: candidates[right].B.pathScore, endScore: candidates[right].B.endScore }
      );
      const bRL = pathEndDominates(
        { pathScore: candidates[right].B.pathScore, endScore: candidates[right].B.endScore },
        { pathScore: candidates[left].B.pathScore, endScore: candidates[left].B.endScore }
      );
      if (aLR !== bLR || aRL !== bRL) changed += 1;
    }
  }
  return changed;
}

function stageOne(data, references, storedResults) {
  const cases = [];
  for (const focus of FOCUSES) {
    const baseDefinition = caseDefinition(focus);
    const referenceEntry = references.references[baseDefinition.id];
    const storedCase = storedResults.cases.find((entry) => entry.caseId === baseDefinition.id);
    if (!referenceEntry?.reference || !storedCase) throw new Error(baseDefinition.id + ": fixed-candidate inputs missing");
    const definition = { ...baseDefinition, reference: referenceEntry.reference };
    const storedCandidates = [storedCase.production.path, ...(storedCase.shadow?.front || [])];
    const unique = new Map(storedCandidates.filter(Boolean).map((entry) => [entry.id, entry]));
    const candidates = [...unique.values()].map((stored) => {
      const state = replayStoredPath(data, definition, referenceEntry.reference, stored);
      return candidateRecord(data, definition, stored, state);
    });
    const layersA = paretoLayers(candidates, "A");
    const layersB = paretoLayers(candidates, "B");
    const layerOf = (layers, id) => layers.findIndex((layer) => layer.includes(id)) + 1;
    for (const candidate of candidates) {
      candidate.paretoLayerA = layerOf(layersA, candidate.id);
      candidate.paretoLayerB = layerOf(layersB, candidate.id);
    }
    const maxShift = Math.max(...candidates.flatMap((candidate) => [
      Math.abs(candidate.A.pathScore - candidate.B.pathScore),
      Math.abs(candidate.A.endScore - candidate.B.endScore)
    ]));
    const relationChanges = dominanceRelationChanges(candidates);
    cases.push({
      caseId: baseDefinition.id,
      focus,
      candidateCount: candidates.length,
      candidateIdsHash: hashIds(candidates.map((entry) => entry.id)),
      referenceVersion: referenceEntry.version,
      maxObjectiveScoreShift: maxShift,
      dominanceRelationChanges: relationChanges,
      paretoFrontChanged: JSON.stringify(layersA[0]) !== JSON.stringify(layersB[0]),
      paretoLayersA: layersA,
      paretoLayersB: layersB,
      candidates
    });
  }

  const allReplayable = cases.every((entry) => entry.candidateCount > 0);
  const objectiveMoves = cases.every((entry) => entry.maxObjectiveScoreShift > 1e-6);
  const orderingSignal = cases.some((entry) => entry.dominanceRelationChanges > 0 || entry.paretoFrontChanged);
  return {
    source: "stored 40k multiobjective-shadow paths; no new search",
    allReplayable,
    objectiveMoves,
    orderingSignal,
    plausibleForControlledSearch: allReplayable && objectiveMoves && orderingSignal,
    gate: {
      rule: "Run Stage 2 only when all three stored Warden focus sets replay, B materially changes Path/End utility in every focus, and at least one Pareto-front or pairwise-dominance relation changes.",
      allReplayable,
      objectiveMoves,
      orderingSignal
    },
    cases
  };
}

function searchCandidate(data, definition, entry, source) {
  const observables = pathEventObservables(
    entry.state.events,
    definition.budget,
    new Map(data.items.map((item) => [item.item_id, Number(item.total_cost)]))
  );
  const investments = categoryInvestments(data, entry.state.inventory);
  const thresholds4800 = thresholdTiming(data, entry.state.events);
  for (const category of Object.keys(investments)) {
    if (investments[category] >= 4800 && thresholds4800[category].souls === null) {
      throw new Error(definition.id + ": missing 4.8k threshold timing for " + category);
    }
  }
  return {
    id: pathId(entry.state.events),
    source,
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
    transactions: entry.transactions,
    reacquisitions: observables.reacquiredItems,
    churn: {
      sameSoulTransactionGroups: observables.sameSoulTransactionGroups.length,
      sellRebuys: observables.sellRebuys.length,
      replacementRebuys: observables.replacementRebuys.length,
      upgradeBacktracks: observables.upgradeBacktracks.length
    }
  };
}

function runSearchConfig(data, definition, reference, label, config) {
  const started = performance.now();
  const runs = [];
  const union = new Map();
  for (const width of WIDTHS) {
    const elapsed = performance.now() - started;
    const remaining = definition.timeBudgetMs - elapsed;
    if (remaining <= 0) break;
    const auditReserveMs = Math.min(2000, Math.max(0, remaining * 0.2));
    console.log(JSON.stringify({ phase: "stage2", caseId: definition.id, objective: label, width, remainingMs: Math.round(remaining) }));
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
      const candidate = searchCandidate(data, definition, entry, label);
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
      maxNaturalReachedSouls: raw.telemetry.maxReachedSouls,
      terminalCandidates: raw.telemetry.terminalCandidates,
      finalFrontSize: raw.telemetry.finalFrontSize,
      objectiveConfigId: raw.telemetry.objectiveConfigId
    });
    if (!raw.telemetry.searchComplete) break;
  }
  const front = pathEndParetoFront([...union.values()].map((candidate) => ({
    ...candidate,
    pathScore: candidate.pathScore,
    endScore: candidate.endScore
  })));
  const ids = new Set(front.map((entry) => entry.id));
  return {
    label,
    objectiveConfigId: config.id,
    runtimeMs: performance.now() - started,
    timeBudgetMs: definition.timeBudgetMs,
    widthsStarted: runs.map((entry) => entry.width),
    widthsCompleted: runs.filter((entry) => entry.searchComplete).map((entry) => entry.width),
    itemCandidateSetHash: hashIds(caseItemIds(data, definition)),
    referenceAxisHash: hashIds(reference.axis.map(String)),
    evaluations: runs.reduce((sum, entry) => sum + entry.evaluations, 0),
    generatedStates: runs.reduce((sum, entry) => sum + entry.generatedStates, 0),
    searchGeneratedStates: runs.reduce((sum, entry) => sum + entry.searchGeneratedStates, 0),
    maxNaturalReachedSouls: runs.length ? Math.max(...runs.map((entry) => entry.maxNaturalReachedSouls)) : 0,
    runs,
    front: [...union.values()].filter((entry) => ids.has(entry.id))
  };
}

function compactCandidate(candidate) {
  const { state: _state, ...compact } = candidate;
  return compact;
}

function rescoreSearchUnion(definition, reference, a, b) {
  const union = new Map();
  for (const candidate of a.front) union.set(candidate.id, { ...candidate, discoveredBy: new Set(["A"]) });
  for (const candidate of b.front) {
    const existing = union.get(candidate.id);
    if (existing) existing.discoveredBy.add("B");
    else union.set(candidate.id, { ...candidate, discoveredBy: new Set(["B"]) });
  }

  const records = [...union.values()].map((candidate) => {
    const A = measureState(candidate.state, reference, definition, OBJECTIVES.A);
    const B = measureState(candidate.state, reference, definition, OBJECTIVES.B);
    return {
      id: candidate.id,
      discoveredBy: [...candidate.discoveredBy].sort(),
      investments: candidate.investments,
      thresholds4800: candidate.thresholds4800,
      transactions: candidate.transactions,
      reacquisitions: candidate.reacquisitions,
      A: {
        pathScore: A.pathScore,
        endScore: A.endScore,
        pathDamage: A.pathDamage,
        endDamage: A.endDamage,
        pathSurvivability: A.pathSurvivability,
        endSurvivability: A.endSurvivability
      },
      B: {
        pathScore: B.pathScore,
        endScore: B.endScore,
        pathDamage: B.pathDamage,
        endDamage: B.endDamage,
        pathSurvivability: B.pathSurvivability,
        endSurvivability: B.endSurvivability
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
  const bFrontSet = new Set(frontB);
  const bGuidedIds = new Set(b.front.map((entry) => entry.id));
  const aOnlyOnBFront = records.filter((entry) =>
    bFrontSet.has(entry.id) && entry.discoveredBy.includes("A") && !entry.discoveredBy.includes("B")
  ).map((entry) => entry.id);
  const bGuidedDominatedUnderB = b.front.filter((candidate) =>
    records.some((other) =>
      other.id !== candidate.id &&
      pathEndDominates(
        { pathScore: other.B.pathScore, endScore: other.B.endScore },
        records.find((entry) => entry.id === candidate.id).B
      )
    )
  ).map((entry) => entry.id);
  return {
    unionCount: records.length,
    discoveredOnlyA: records.filter((entry) => entry.discoveredBy.length === 1 && entry.discoveredBy[0] === "A").map((entry) => entry.id),
    discoveredOnlyB: records.filter((entry) => entry.discoveredBy.length === 1 && entry.discoveredBy[0] === "B").map((entry) => entry.id),
    discoveredBoth: records.filter((entry) => entry.discoveredBy.length === 2).map((entry) => entry.id),
    paretoFrontUnderA: frontA,
    paretoFrontUnderB: frontB,
    aDiscoveredOnlyCandidatesOnBFront: aOnlyOnBFront,
    bGuidedCandidatesDominatedUnderBByUnion: bGuidedDominatedUnderB,
    bGuidedFrontCoverageOfUnionBFront: frontB.filter((id) => bGuidedIds.has(id)).length + "/" + frontB.length,
    records
  };
}

function numbers(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return { min: null, median: null, max: null };
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return { min: sorted[0], median, max: sorted.at(-1) };
}

function frontSummary(front) {
  const thresholdSummary = {};
  for (const category of ["weapon", "vitality", "spirit"]) {
    const values = front.map((entry) => entry.thresholds4800[category].souls).filter((value) => value !== null);
    thresholdSummary[category] = { ...numbers(values), nullCount: front.length - values.length };
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
    thresholds4800: thresholdSummary,
    transactions: numbers(front.map((entry) => entry.transactions)),
    reacquisitionCounts: numbers(front.map((entry) => entry.reacquisitions.length))
  };
}

function stageTwo(data, references) {
  const cases = [];
  for (const focus of FOCUSES) {
    const definition = caseDefinition(focus);
    const referenceEntry = references.references[definition.id];
    if (!referenceEntry?.reference) throw new Error(definition.id + ": frozen reference missing");
    const reference = referenceEntry.reference;
    const a = runSearchConfig(data, definition, reference, "A", OBJECTIVES.A);
    const b = runSearchConfig(data, definition, reference, "B", OBJECTIVES.B);
    if (a.itemCandidateSetHash !== b.itemCandidateSetHash || a.referenceAxisHash !== b.referenceAxisHash) {
      throw new Error(definition.id + ": A/B search controls diverged");
    }
    const crossScoredUnion = rescoreSearchUnion(definition, reference, a, b);
    cases.push({
      caseId: definition.id,
      focus,
      controls: {
        budget: definition.budget,
        timeBudgetMs: definition.timeBudgetMs,
        widths: WIDTHS,
        itemCandidateSetHash: a.itemCandidateSetHash,
        referenceVersion: referenceEntry.version,
        referenceAxisHash: a.referenceAxisHash,
        scalarizationUsed: false
      },
      A: { ...a, summary: frontSummary(a.front), front: a.front.map(compactCandidate) },
      B: { ...b, summary: frontSummary(b.front), front: b.front.map(compactCandidate) },
      crossScoredUnion
    });
  }
  return { executed: true, cases };
}

function main() {
  const data = loadData();
  const references = JSON.parse(readFileSync(REFERENCE_FILE, "utf8"));
  const storedResults = JSON.parse(readFileSync(STORED_PATHS_FILE, "utf8"));
  const stage1 = stageOne(data, references, storedResults);
  const stage2 = stage1.plausibleForControlledSearch
    ? stageTwo(data, references)
    : { executed: false, reason: "Stage-1 plausibility gate not met.", cases: [] };

  const result = {
    schemaVersion: "optimizer-carry-objective-ab-v1",
    experiment: "carry-50-50-vs-75-25",
    sourceCommit: process.env.GITHUB_SHA || process.env.SOURCE_COMMIT || "unknown",
    generatedAt: new Date().toISOString(),
    productionChanged: false,
    uiChanged: false,
    baselineA: {
      id: OBJECTIVES.A.id,
      damageSurvival: { damage: 0.5, survival: 0.5 },
      focus: {
        weapon: { bullet: 0.7, spirit: 0.3 },
        spirit: { bullet: 0.3, spirit: 0.7 },
        hybrid: { bullet: 0.5, spirit: 0.5 }
      },
      effective: {
        weapon: { bullet: 0.35, spirit: 0.15, survival: 0.5 },
        spirit: { bullet: 0.15, spirit: 0.35, survival: 0.5 },
        hybrid: { bullet: 0.25, spirit: 0.25, survival: 0.5 }
      }
    },
    experimentB: {
      id: OBJECTIVES.B.id,
      damageSurvival: { damage: 0.75, survival: 0.25 },
      focus: {
        weapon: { bullet: 0.85, spirit: 0.15 },
        spirit: { bullet: 0.15, spirit: 0.85 },
        hybrid: { bullet: 0.5, spirit: 0.5 }
      },
      effective: {
        weapon: { bullet: 0.6375, spirit: 0.1125, survival: 0.25 },
        spirit: { bullet: 0.1125, spirit: 0.6375, survival: 0.25 },
        hybrid: { bullet: 0.375, spirit: 0.375, survival: 0.25 }
      }
    },
    unchanged: [
      "Path-AUC definition",
      "Endbuild as separate Pareto objective",
      "Multiobjective Pareto semantics",
      "Beam widths",
      "Lazy Pareto",
      "Dedupe",
      "Diversity",
      "Save-to-40k",
      "Terminalization",
      "60s product budget",
      "Reference methodology and frozen references",
      "Canonical item and threshold data",
      "Evaluator and Afterburn",
      "Damage metric set including known duplicate 10s damage metrics"
    ],
    stage1,
    stage2
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
    stage1Plausible: stage1.plausibleForControlledSearch,
    stage2Executed: stage2.executed
  }));
}

try {
  main();
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
}

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseCsv } from "../app/lib.mjs";
import { buildOptimizerData, heroCanPurchaseItem } from "../app/optimizer.mjs";
import { carryResourceAxis, evaluateCarryPerformance } from "../app/warden-search.mjs";
import { createDeadlockDomain } from "../app/deadlock-domain.mjs";
import { normalizeMilestones } from "../app/search-milestones.mjs";
import { measureSoulAxisPath } from "../app/search-objective-v1.mjs";
import {
  completeNodeBySaving,
  dedupeFuturePathHistory,
  selectPathEndParetoBeam
} from "../app/multiobjective-search.mjs";
import {
  pathEndDominates,
  pathEndParetoFront,
  pathEventObservables
} from "../app/path-end-pareto.mjs";
import { benchmarkCases } from "../benchmarks/optimizer-v1/cases.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const REFERENCE_FILE = resolve(ROOT, "benchmarks/optimizer-v1/references/baseline-v0.json");
const DIVERGENCE_FILE = resolve(ROOT, "benchmarks/optimizer-v1/experiments/search-divergence-diagnosis/results.json");
const DEFAULT_OUTPUT = resolve(ROOT, "artifacts/value-to-go-diagnosis/results.json");
const WIDTH = 4;
const CONTINUATION_STEPS = 160;

const SWEET = Object.freeze({
  id: "carry-sweet-70-30-spec-77_5-22_5",
  damageWeight: 0.70,
  survivalWeight: 0.30,
  damageFocusWeights: Object.freeze({
    weapon: Object.freeze({ bullet: 0.775, spirit: 0.225 }),
    spirit: Object.freeze({ bullet: 0.225, spirit: 0.775 }),
    hybrid: Object.freeze({ bullet: 0.5, spirit: 0.5 })
  })
});

function outputPath() {
  const args = process.argv.slice(2);
  const index = args.indexOf("--output");
  return resolve(index >= 0 ? args[index + 1] : DEFAULT_OUTPUT);
}

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

function pathId(events) {
  return createHash("sha256").update(JSON.stringify(events)).digest("hex").slice(0, 16);
}

function eventChain(node) {
  const chain = [];
  for (let current = node; current?.parent; current = current.parent) chain.push(current.event);
  return chain.reverse();
}

function nodeChain(node) {
  const chain = [];
  for (let current = node; current; current = current.parent) chain.push(current);
  return chain.reverse();
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

function sameEvent(actual, expected) {
  if (actual?.type !== expected?.type) return false;
  for (const key of ["earnedSouls", "item", "from", "payment", "saleProceeds"]) {
    if (Object.hasOwn(expected, key) && Number.isFinite(expected[key])) {
      if (Number(actual?.[key]) !== Number(expected[key])) return false;
    } else if (Object.hasOwn(expected, key) && actual?.[key] !== expected[key]) {
      return false;
    }
  }
  return true;
}

function createRuntime(data, definition, reference) {
  const requested = definition.itemIds ? [...definition.itemIds] : data.items.map((item) => item.item_id);
  const legalItemIds = requested.filter((id) => heroCanPurchaseItem(data.itemsById.get(id), data, definition.hero));
  const checkpoints = normalizeMilestones(definition.milestones, definition.budget);
  const compressed = carryResourceAxis(data, legalItemIds, definition.budget);
  const axis = [...new Set([...compressed.axis, ...checkpoints])].sort((a, b) => a - b);
  if (JSON.stringify(reference.axis) !== JSON.stringify(axis)) throw new Error("Frozen reference axis mismatch.");

  const slotUnlocks = [{
    earnedSouls: 0,
    slots: Number(data.slots.item_limit) - Number(data.slots.starting_slots.universal)
  }];
  const domain = createDeadlockDomain({
    data,
    itemIds: legalItemIds,
    budget: definition.budget,
    slotUnlocks,
    soulAxis: axis,
    metrics: () => ({ value: 0 })
  });
  const clean = (state) => ({ ...state, events: [], snapshots: [] });
  const request = {
    heroId: definition.hero,
    damageFocus: definition.focus,
    budget: definition.budget,
    cacheProfiles: false,
    metricsOnly: true,
    opponentBulletResist: definition.opponentBulletResist,
    opponentSpiritResist: definition.opponentSpiritResist
  };

  const counters = {
    transitionCalls: 0,
    generatedStates: 0,
    evaluations: 0
  };
  const metricCache = new Map();
  const metrics = (state) => {
    const key = [...state.inventory].sort().join("|");
    if (!metricCache.has(key)) {
      const result = evaluateCarryPerformance(state, request, data);
      if (!result.valid) throw new Error(result.reason);
      metricCache.set(key, result.metrics);
      counters.evaluations += 1;
    }
    return metricCache.get(key);
  };

  const root = { state: clean(domain.initial), parent: null, event: null, serial: "" };
  const makeNode = (parent, nextState) => {
    const event = nextState.events[0];
    return {
      state: clean(nextState),
      parent,
      event,
      serial: `${parent.serial}|${JSON.stringify(event)}`
    };
  };
  const transitions = (node) => {
    counters.transitionCalls += 1;
    const states = domain.transitions(node.state);
    counters.generatedStates += states.length;
    return states.map((state) => makeNode(node, state));
  };

  const pointsCache = new WeakMap();
  const vectorCache = new WeakMap();
  const nodePoints = (node) => {
    if (!pointsCache.has(node)) {
      pointsCache.set(node, nodeChain(node).map((entry) => ({
        earnedSouls: entry.state.earnedSouls,
        metrics: metrics(entry.state)
      })));
    }
    return pointsCache.get(node);
  };
  const vectorFor = (node) => {
    if (!vectorCache.has(node)) {
      const measurement = measureSoulAxisPath(
        nodePoints(node),
        reference,
        checkpoints,
        definition.budget,
        definition.focus,
        null,
        SWEET
      );
      vectorCache.set(node, {
        pathScore: measurement.pathScore,
        endScore: measurement.endScore,
        measurement
      });
    }
    return vectorCache.get(node);
  };

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

  return {
    root,
    transitions,
    futureKey: (node) => domain.futureKey(node.state),
    diversityKey,
    vectorFor,
    counters,
    legalItemIds,
    checkpoints
  };
}

function replayHistory(rt, history) {
  let node = rt.root;
  for (let index = 0; index < history.length; index += 1) {
    const expected = history[index];
    const successors = rt.transitions(node);
    const next = successors.find((candidate) => sameEvent(candidate.event, expected));
    if (!next) {
      throw new Error(`Cannot replay seed event ${index + 1}: ${JSON.stringify(expected)}`);
    }
    node = next;
  }
  if (pathId(eventChain(node)) !== pathId(history)) throw new Error("Replayed seed history hash mismatch.");
  return node;
}

function continuationSearch(rt, seed, budget) {
  const countersAtStart = { ...rt.counters };
  const terminals = new Map();
  const terminalSources = new Map();
  const observeTerminal = (node, source) => {
    if (node.state.earnedSouls !== budget) return;
    terminals.set(node.serial, node);
    const sources = terminalSources.get(node.serial) || new Set();
    sources.add(source);
    terminalSources.set(node.serial, sources);
  };
  const saveComplete = (nodes, source) => {
    for (const node of nodes) {
      if (node.state.earnedSouls === budget) {
        observeTerminal(node, "retained-terminal");
        continue;
      }
      const completed = completeNodeBySaving(node, budget, rt.transitions, Infinity);
      if (!completed) throw new Error("Deterministic save-to-40k completion failed without deadline.");
      observeTerminal(completed, source);
    }
  };

  let beam = [seed];
  let steps = 0;
  let duplicateStates = 0;
  let maxCandidatePool = 0;
  let maxReachedSouls = seed.state.earnedSouls;
  let earlySaveCompletionMaterialized = false;

  while (beam.length && steps < CONTINUATION_STEPS) {
    const candidates = [];
    for (const node of beam) {
      if (node.state.earnedSouls === budget) {
        observeTerminal(node, "retained-terminal");
        continue;
      }
      const successors = rt.transitions(node);
      for (const successor of successors) observeTerminal(successor, "generated-terminal");
      candidates.push(...successors);
    }
    if (!candidates.length) {
      beam = [];
      break;
    }
    maxCandidatePool = Math.max(maxCandidatePool, candidates.length);
    maxReachedSouls = Math.max(maxReachedSouls, ...candidates.map((node) => node.state.earnedSouls));
    const unique = dedupeFuturePathHistory(candidates, rt.futureKey, rt.vectorFor);
    duplicateStates += candidates.length - unique.length;
    beam = selectPathEndParetoBeam(unique, WIDTH, rt.vectorFor, rt.diversityKey).selected;
    steps += 1;

    if (!earlySaveCompletionMaterialized && beam.length) {
      saveComplete(beam, "retained-save-completion-early");
      earlySaveCompletionMaterialized = true;
    }
  }

  if (beam.length) saveComplete(beam, "retained-save-completion-final");

  const entries = [...terminals.values()].map((node) => {
    const vector = rt.vectorFor(node);
    return {
      id: pathId(eventChain(node)),
      node,
      pathScore: vector.pathScore,
      endScore: vector.endScore
    };
  });
  const front = pathEndParetoFront(entries);
  const used = {
    transitionCalls: rt.counters.transitionCalls - countersAtStart.transitionCalls,
    generatedStates: rt.counters.generatedStates - countersAtStart.generatedStates,
    evaluations: rt.counters.evaluations - countersAtStart.evaluations
  };
  return {
    steps,
    stepBudget: CONTINUATION_STEPS,
    stoppedByStepBudget: Boolean(beam.length && steps >= CONTINUATION_STEPS),
    searchExhausted: beam.length === 0,
    maxReachedSouls,
    maxCandidatePool,
    duplicateStates,
    terminalCandidates: terminals.size,
    counters: used,
    front: front.map((entry) => ({
      ...entry,
      sources: [...(terminalSources.get(entry.node.serial) || [])].sort()
    }))
  };
}

function candidateRecord(entry, data, budget) {
  const vector = entry.node ? null : null;
  const events = eventChain(entry.node);
  const itemCosts = new Map(data.items.map((item) => [item.item_id, Number(item.total_cost)]));
  const observables = pathEventObservables(events, budget, itemCosts);
  return {
    id: entry.id,
    earnedSouls: entry.node.state.earnedSouls,
    cash: entry.node.state.cash,
    inventory: [...entry.node.state.inventory],
    pathScore: entry.pathScore,
    endScore: entry.endScore,
    pathDamage: entry.nodeVector.measurement.pathDamage,
    endDamage: entry.nodeVector.measurement.endDamage,
    pathSurvival: entry.nodeVector.measurement.pathSurvivability,
    endSurvival: entry.nodeVector.measurement.endSurvivability,
    transactions: observables.transactionCount,
    replacements: observables.counts.replacement,
    reacquisitionEvents: observables.reacquiredItems.reduce((sum, row) => sum + row.count, 0),
    sources: entry.sources,
    history: events
  };
}

function enrichFront(front, rt, data, budget) {
  return front.map((entry) => ({
    ...entry,
    nodeVector: rt.vectorFor(entry.node)
  })).map((entry) => candidateRecord(entry, data, budget));
}

function compareFronts(targetFront, otherFront) {
  const targetDominatesAllOther = otherFront.length > 0 && otherFront.every((other) =>
    targetFront.some((target) => pathEndDominates(target, other))
  );
  const otherDominatesAllTarget = targetFront.length > 0 && targetFront.every((target) =>
    otherFront.some((other) => pathEndDominates(other, target))
  );
  const union = pathEndParetoFront([
    ...targetFront.map((entry) => ({ ...entry, sourceSeed: "target" })),
    ...otherFront.map((entry) => ({ ...entry, sourceSeed: "competitor" }))
  ]);
  return {
    targetDominatesAllCompetitorFront: targetDominatesAllOther,
    competitorDominatesAllTargetFront: otherDominatesAllTarget,
    unionFront: union.map((entry) => ({
      id: entry.id,
      sourceSeed: entry.sourceSeed,
      pathScore: entry.pathScore,
      endScore: entry.endScore
    })),
    targetUnionFrontCount: union.filter((entry) => entry.sourceSeed === "target").length,
    competitorUnionFrontCount: union.filter((entry) => entry.sourceSeed === "competitor").length
  };
}

function seedRecord(label, stored, node) {
  return {
    label,
    pathId: stored.pathId,
    earnedSouls: node.state.earnedSouls,
    cash: node.state.cash,
    inventory: [...node.state.inventory],
    history: eventChain(node)
  };
}

function main() {
  const data = loadData();
  const references = JSON.parse(readFileSync(REFERENCE_FILE, "utf8"));
  const divergence = JSON.parse(readFileSync(DIVERGENCE_FILE, "utf8"));
  const definition = benchmarkCases("production").find((entry) =>
    entry.hero === "warden" && entry.focus === "weapon"
  );
  if (!definition) throw new Error("Warden weapon production case missing.");
  const referenceEntry = references.references[definition.id];
  if (!referenceEntry?.reference) throw new Error("Frozen reference missing.");
  if (divergence.scope?.hero !== "warden" || divergence.scope?.focus !== "weapon" ||
      divergence.scope?.budget !== 40000 || divergence.scope?.beamWidth !== WIDTH) {
    throw new Error("Divergence diagnosis scope mismatch.");
  }

  const storedSeeds = [
    { label: "lost-high-velocity", stored: divergence.firstDivergence.target },
    ...divergence.firstDivergence.selectedInstead.map((stored, index) => ({
      label: `sweet-retained-${index + 1}`,
      stored
    }))
  ];
  if (storedSeeds.length !== 5) throw new Error(`Expected 5 seeds, got ${storedSeeds.length}.`);

  const runs = [];
  for (const seedSpec of storedSeeds) {
    const rt = createRuntime(data, definition, referenceEntry.reference);
    const seed = replayHistory(rt, seedSpec.stored.history);
    if (pathId(eventChain(seed)) !== seedSpec.stored.pathId) {
      throw new Error(`Stored pathId mismatch for ${seedSpec.label}.`);
    }
    const continuation = continuationSearch(rt, seed, definition.budget);
    const front = enrichFront(continuation.front, rt, data, definition.budget);
    runs.push({
      seed: seedRecord(seedSpec.label, seedSpec.stored, seed),
      continuation: {
        steps: continuation.steps,
        stepBudget: continuation.stepBudget,
        stoppedByStepBudget: continuation.stoppedByStepBudget,
        searchExhausted: continuation.searchExhausted,
        maxReachedSouls: continuation.maxReachedSouls,
        maxCandidatePool: continuation.maxCandidatePool,
        duplicateStates: continuation.duplicateStates,
        terminalCandidates: continuation.terminalCandidates,
        counters: continuation.counters,
        reached40k: front.some((entry) => entry.earnedSouls === definition.budget)
      },
      finalFront: front
    });
  }

  const targetRun = runs[0];
  const pairwise = runs.slice(1).map((run) => ({
    competitor: run.seed.label,
    ...compareFronts(targetRun.finalFront, run.finalFront)
  }));
  const globalUnion = [];
  for (const run of runs) {
    for (const entry of run.finalFront) globalUnion.push({ ...entry, sourceSeed: run.seed.label });
  }
  const globalFront = pathEndParetoFront(globalUnion).map((entry) => ({
    id: entry.id,
    sourceSeed: entry.sourceSeed,
    pathScore: entry.pathScore,
    endScore: entry.endScore,
    pathDamage: entry.pathDamage,
    endDamage: entry.endDamage,
    pathSurvival: entry.pathSurvival,
    endSurvival: entry.endSurvival
  }));
  const targetGlobalCount = globalFront.filter((entry) => entry.sourceSeed === targetRun.seed.label).length;
  const strongH1 = pairwise.every((row) =>
    row.targetDominatesAllCompetitorFront && !row.competitorDominatesAllTargetFront
  );
  const rejectedH1 = targetGlobalCount === 0 &&
    pairwise.some((row) => row.competitorDominatesAllTargetFront);

  const result = {
    schemaVersion: "optimizer-value-to-go-diagnosis-v1",
    sourceCommit: process.env.GITHUB_SHA || "unknown",
    caseId: definition.id,
    scope: {
      hero: "warden",
      focus: "weapon",
      budget: definition.budget,
      beamWidth: WIDTH,
      objective: SWEET,
      continuationStepBudget: CONTINUATION_STEPS,
      wallclockUsedAsBudget: false
    },
    reference: {
      version: referenceEntry.version,
      source: "frozen supplied baseline-v0"
    },
    sourceDiagnosis: {
      schemaVersion: divergence.schemaVersion,
      sourceCommit: divergence.sourceCommit,
      divergenceDepth: divergence.firstDivergence.depth,
      divergenceSouls: divergence.firstDivergence.earnedSouls
    },
    controls: {
      identicalContinuationSearch: true,
      prefixHistoryReplayedLegally: true,
      productionDedupeFunctionUsed: true,
      productionParetoRetentionFunctionUsed: true,
      deterministicStepBudget: true,
      noWallclockDeadline: true,
      saveTo40kMaterialized: true,
      continuationLookaheadApplicability: "Existing app/beam-search.mjs continuation lookahead is not part of this multiobjective path and only projects purchase->upgrade; the divergence event is replacement health->high_velocity_mag."
    },
    runs,
    pairwiseTargetVsSweetRetained: pairwise,
    globalUnionFront: globalFront,
    hypothesis: {
      H1: "The locally disfavored High Velocity branch has higher Sweet value-to-go than the four Sweet-retained seeds.",
      status: strongH1 ? "SUPPORTED_STRONGLY" : rejectedH1 ? "REJECTED" : "INCONCLUSIVE_OR_PARTIAL",
      rationale: strongH1
        ? "Target continuation front dominates every competitor front under identical deterministic Sweet continuation search."
        : rejectedH1
          ? "Target contributes no global Sweet Pareto candidate and at least one competitor front dominates all target-front candidates."
          : "Continuation fronts retain tradeoffs or mixed dominance; the experiment does not support a single higher-value ordering."
    }
  };

  const targetOut = outputPath();
  mkdirSync(dirname(targetOut), { recursive: true });
  writeFileSync(targetOut, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({
    status: "COMPLETE",
    output: targetOut,
    hypothesis: result.hypothesis.status,
    targetGlobalFrontCandidates: targetGlobalCount,
    globalFrontSize: globalFront.length,
    pairwise: pairwise.map((row) => ({
      competitor: row.competitor,
      targetDominatesAll: row.targetDominatesAllCompetitorFront,
      competitorDominatesAll: row.competitorDominatesAllTargetFront,
      targetUnionFrontCount: row.targetUnionFrontCount,
      competitorUnionFrontCount: row.competitorUnionFrontCount
    }))
  }));
}

try {
  main();
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
}

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
  pathEndNonDominatedLayers,
  selectPathEndParetoBeam
} from "../app/multiobjective-search.mjs";
import { pathEndDominates, pathEndParetoFront } from "../app/path-end-pareto.mjs";
import { benchmarkCases } from "../benchmarks/optimizer-v1/cases.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const REFERENCE_FILE = resolve(ROOT, "benchmarks/optimizer-v1/references/baseline-v0.json");
const VALUE_TO_GO_FILE = resolve(ROOT, "benchmarks/optimizer-v1/experiments/value-to-go-diagnosis/results.json");
const DEFAULT_OUTPUT = resolve(ROOT, "artifacts/crossover-horizon-test/results.json");
const WIDTH = 4;
const STEP_BUDGET = 160;
const INITIAL_HORIZONS = [4000, 4400, 5200, 6800];
const EXTENDED_HORIZONS = [10000, 16400, 22800, 29200, 35600, 40000];
const EPS = 1e-12;

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

function makeDiversityKey(data) {
  const rootFamily = buildFamilyRoots(data);
  return (node) => {
    const counts = { Weapon: 0, Vitality: 0, Spirit: 0, Other: 0 };
    const roots = [];
    for (const id of node.state.inventory) {
      const category = data.itemsById.get(id)?.category;
      counts[Object.hasOwn(counts, category) ? category : "Other"] += 1;
      roots.push(rootFamily(id));
    }
    return counts.Weapon + "/" + counts.Vitality + "/" + counts.Spirit + "/" + counts.Other + ":" +
      [...new Set(roots)].sort().join(",");
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

function createRuntime(data, definition, reference, diversityKey) {
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

  const counters = { transitionCalls: 0, generatedStates: 0, evaluations: 0 };
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
      serial: parent.serial + "|" + JSON.stringify(event)
    };
  };
  const transitions = (node) => {
    counters.transitionCalls += 1;
    const states = domain.transitions(node.state);
    counters.generatedStates += states.length;
    return states.map((state) => makeNode(node, state));
  };

  const pointsCache = new WeakMap();
  const horizonCaches = new Map();
  const nodePoints = (node) => {
    if (!pointsCache.has(node)) {
      pointsCache.set(node, nodeChain(node).map((entry) => ({
        earnedSouls: entry.state.earnedSouls,
        metrics: metrics(entry.state)
      })));
    }
    return pointsCache.get(node);
  };
  const vectorForHorizon = (node, horizon) => {
    if (!horizonCaches.has(horizon)) horizonCaches.set(horizon, new WeakMap());
    const cache = horizonCaches.get(horizon);
    if (!cache.has(node)) {
      const measurement = measureSoulAxisPath(
        nodePoints(node),
        reference,
        checkpoints,
        horizon,
        definition.focus,
        null,
        SWEET
      );
      cache.set(node, {
        pathScore: measurement.pathScore,
        endScore: measurement.endScore,
        measurement
      });
    }
    return cache.get(node);
  };

  return {
    root,
    transitions,
    futureKey: (node) => domain.futureKey(node.state),
    diversityKey,
    vectorForHorizon,
    counters
  };
}

function replayHistory(rt, history) {
  let node = rt.root;
  for (let index = 0; index < history.length; index += 1) {
    const expected = history[index];
    const successors = rt.transitions(node);
    const next = successors.find((candidate) => sameEvent(candidate.event, expected));
    if (!next) throw new Error("Cannot replay seed event " + (index + 1) + ": " + JSON.stringify(expected));
    node = next;
  }
  if (pathId(eventChain(node)) !== pathId(history)) throw new Error("Replayed seed history hash mismatch.");
  return node;
}

function continuationSearch(rt, seed, horizon) {
  const countersAtStart = { ...rt.counters };
  const terminals = new Map();
  const terminalSources = new Map();
  const vectorFor = (node) => rt.vectorForHorizon(node, horizon);

  const observeTerminal = (node, source) => {
    if (node.state.earnedSouls !== horizon) return;
    terminals.set(node.serial, node);
    const sources = terminalSources.get(node.serial) || new Set();
    sources.add(source);
    terminalSources.set(node.serial, sources);
  };

  const saveComplete = (nodes, source) => {
    for (const node of nodes) {
      if (node.state.earnedSouls === horizon) {
        observeTerminal(node, "retained-terminal");
        continue;
      }
      const completed = completeNodeBySaving(node, horizon, rt.transitions, Infinity);
      if (!completed) throw new Error("Deterministic save completion failed without deadline.");
      observeTerminal(completed, source);
    }
  };

  let beam = [seed];
  let steps = 0;
  let duplicateStates = 0;
  let maxCandidatePool = 0;
  let maxReachedSouls = seed.state.earnedSouls;
  let earlySaveCompletionMaterialized = false;

  while (beam.length && steps < STEP_BUDGET) {
    const candidates = [];
    for (const node of beam) {
      if (node.state.earnedSouls === horizon) {
        observeTerminal(node, "retained-terminal");
        continue;
      }
      const successors = rt.transitions(node).filter((candidate) => candidate.state.earnedSouls <= horizon);
      for (const successor of successors) {
        if (successor.state.earnedSouls === horizon) observeTerminal(successor, "generated-terminal");
      }
      candidates.push(...successors);
    }
    if (!candidates.length) {
      beam = [];
      break;
    }

    maxCandidatePool = Math.max(maxCandidatePool, candidates.length);
    maxReachedSouls = Math.max(maxReachedSouls, ...candidates.map((node) => node.state.earnedSouls));
    const unique = dedupeFuturePathHistory(candidates, rt.futureKey, vectorFor);
    duplicateStates += candidates.length - unique.length;
    beam = selectPathEndParetoBeam(unique, WIDTH, vectorFor, rt.diversityKey).selected;
    steps += 1;

    if (!earlySaveCompletionMaterialized && beam.length) {
      saveComplete(beam, "retained-save-completion-early");
      earlySaveCompletionMaterialized = true;
    }
  }

  const stoppedByStepBudget = Boolean(beam.length && steps >= STEP_BUDGET);
  if (stoppedByStepBudget) {
    throw new Error("Horizon continuation exceeded deterministic step budget " + STEP_BUDGET + " at " + horizon + " Souls.");
  }
  if (beam.length) saveComplete(beam, "retained-save-completion-final");

  const entries = [...terminals.values()].map((node) => {
    const vector = vectorFor(node);
    return {
      id: pathId(eventChain(node)),
      node,
      pathScore: vector.pathScore,
      endScore: vector.endScore,
      measurement: vector.measurement,
      sources: [...(terminalSources.get(node.serial) || [])].sort()
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
    stepBudget: STEP_BUDGET,
    stoppedByStepBudget,
    searchExhausted: beam.length === 0,
    maxReachedSouls,
    maxCandidatePool,
    duplicateStates,
    terminalCandidates: terminals.size,
    counters: used,
    front
  };
}

function recordCandidate(entry, seedHistoryLength) {
  const events = eventChain(entry.node);
  const continuationEvents = events.slice(seedHistoryLength);
  return {
    id: entry.id,
    earnedSouls: entry.node.state.earnedSouls,
    cash: entry.node.state.cash,
    inventory: [...entry.node.state.inventory],
    pathScore: entry.pathScore,
    endScore: entry.endScore,
    pathDamage: entry.measurement.pathDamage,
    endDamage: entry.measurement.endDamage,
    pathSurvival: entry.measurement.pathSurvivability,
    endSurvival: entry.measurement.endSurvivability,
    sources: entry.sources,
    continuationEvents,
    continuationTransactions: continuationEvents.filter((event) => event?.type !== "save")
  };
}

function comparePairwise(targetFront, sweetFront) {
  const union = pathEndParetoFront([
    ...targetFront.map((entry) => ({ ...entry, sourceSeed: "target" })),
    ...sweetFront.map((entry) => ({ ...entry, sourceSeed: "sweet-1" }))
  ]);
  const targetCount = union.filter((entry) => entry.sourceSeed === "target").length;
  const sweetCount = union.filter((entry) => entry.sourceSeed === "sweet-1").length;
  const targetDominatesAllSweet = sweetFront.length > 0 && sweetFront.every((sweet) =>
    targetFront.some((target) => pathEndDominates(target, sweet))
  );
  const sweetDominatesAllTarget = targetFront.length > 0 && targetFront.every((target) =>
    sweetFront.some((sweet) => pathEndDominates(sweet, target))
  );
  return {
    targetOnPairwiseFront: targetCount > 0,
    sweetOnPairwiseFront: sweetCount > 0,
    targetDominatesAllSweet,
    sweetDominatesAllTarget,
    relation: targetDominatesAllSweet
      ? "target-dominates-sweet-1"
      : sweetDominatesAllTarget
        ? "sweet-1-dominates-target"
        : targetCount > 0 && sweetCount > 0
          ? "same-pareto-front-tradeoff"
          : targetCount > 0
            ? "target-only-on-pairwise-front"
            : "sweet-1-only-on-pairwise-front"
  };
}

function analyzeHorizon(data, definition, reference, storedRuns, horizon, diversityKey) {
  const internalRuns = [];
  for (const storedRun of storedRuns) {
    const rt = createRuntime(data, definition, reference, diversityKey);
    const seed = replayHistory(rt, storedRun.seed.history);
    if (pathId(eventChain(seed)) !== storedRun.seed.pathId) {
      throw new Error("Stored pathId mismatch for " + storedRun.seed.label + ".");
    }
    const continuation = continuationSearch(rt, seed, horizon);
    if (!continuation.front.length) throw new Error("No horizon front for " + storedRun.seed.label + " at " + horizon + ".");
    internalRuns.push({
      label: storedRun.seed.label,
      seed,
      seedHistoryLength: storedRun.seed.history.length,
      continuation,
      front: continuation.front
    });
  }

  const pooled = [];
  const vectorByNode = new Map();
  for (const run of internalRuns) {
    for (const entry of run.front) {
      const pooledEntry = {
        id: run.label + ":" + entry.id,
        seedLabel: run.label,
        node: entry.node,
        pathScore: entry.pathScore,
        endScore: entry.endScore
      };
      pooled.push(pooledEntry);
      vectorByNode.set(entry.node, { pathScore: entry.pathScore, endScore: entry.endScore });
    }
  }

  const layers = pathEndNonDominatedLayers(pooled);
  const layerByNode = new Map();
  layers.forEach((layer, layerIndex) => {
    for (const entry of layer) layerByNode.set(entry.node, layerIndex);
  });
  const retained = selectPathEndParetoBeam(
    pooled.map((entry) => entry.node),
    WIDTH,
    (node) => vectorByNode.get(node),
    diversityKey
  ).selected;
  const retainedSet = new Set(retained);

  const representatives = internalRuns.map((run) => {
    const sorted = [...run.front].sort((a, b) =>
      a.pathScore - b.pathScore === 0
        ? (b.endScore - a.endScore || a.id.localeCompare(b.id))
        : b.pathScore - a.pathScore
    );
    const rep = sorted[0];
    return { label: run.label, entry: rep };
  });
  const pathRank = new Map(
    [...representatives]
      .sort((a, b) => b.entry.pathScore - a.entry.pathScore ||
        b.entry.endScore - a.entry.endScore ||
        a.label.localeCompare(b.label))
      .map((row, index) => [row.label, index + 1])
  );

  const sweet1 = internalRuns.find((run) => run.label === "sweet-retained-1");
  const target = internalRuns.find((run) => run.label === "lost-high-velocity");
  if (!sweet1 || !target) throw new Error("Central target/Sweet #1 seeds missing.");
  const targetRep = representatives.find((row) => row.label === target.label).entry;
  const sweetRep = representatives.find((row) => row.label === sweet1.label).entry;
  const pairwise = comparePairwise(target.front, sweet1.front);

  const runRecords = internalRuns.map((run) => {
    const rep = representatives.find((row) => row.label === run.label).entry;
    const seedLayers = run.front.map((entry) => layerByNode.get(entry.node));
    const retainedCandidates = run.front.filter((entry) => retainedSet.has(entry.node));
    return {
      seed: run.label,
      reachedSouls: Math.max(...run.front.map((entry) => entry.node.state.earnedSouls)),
      continuationComplete: !run.continuation.stoppedByStepBudget &&
        run.continuation.front.every((entry) => entry.node.state.earnedSouls === horizon),
      searchSteps: run.continuation.steps,
      stepBudget: run.continuation.stepBudget,
      searchExhausted: run.continuation.searchExhausted,
      generatedCandidates: run.continuation.counters.generatedStates,
      transitionCalls: run.continuation.counters.transitionCalls,
      evaluations: run.continuation.counters.evaluations,
      duplicateStates: run.continuation.duplicateStates,
      terminalCandidates: run.continuation.terminalCandidates,
      frontSize: run.front.length,
      paretoLayerRelativeToFiveSeeds: Math.min(...seedLayers),
      retainedAtWidth4: retainedCandidates.length > 0,
      retainedCandidateIds: retainedCandidates.map((entry) => entry.id),
      pathRankRelativeToFiveSeeds: pathRank.get(run.label),
      representative: recordCandidate(rep, run.seedHistoryLength),
      front: run.front.map((entry) => recordCandidate(entry, run.seedHistoryLength))
    };
  });

  const targetRunRecord = runRecords.find((run) => run.seed === target.label);
  const sweetRunRecord = runRecords.find((run) => run.seed === sweet1.label);
  const scoreCrossover = targetRep.pathScore + EPS >= sweetRep.pathScore;
  const paretoCrossover = pairwise.targetOnPairwiseFront;
  const retentionCrossover = targetRunRecord.retainedAtWidth4;

  return {
    horizon,
    additionalSouls: horizon - 3600,
    runs: runRecords,
    centralComparison: {
      target: target.label,
      competitor: sweet1.label,
      targetPathScore: targetRep.pathScore,
      sweet1PathScore: sweetRep.pathScore,
      pathScoreDelta: targetRep.pathScore - sweetRep.pathScore,
      targetEndScore: targetRep.endScore,
      sweet1EndScore: sweetRep.endScore,
      endScoreDelta: targetRep.endScore - sweetRep.endScore,
      scoreDefinition: "Sweet Path Score to the tested horizon",
      scoreCrossover,
      paretoCrossover,
      retentionCrossover,
      pairwise,
      targetParetoLayer: targetRunRecord.paretoLayerRelativeToFiveSeeds,
      sweet1ParetoLayer: sweetRunRecord.paretoLayerRelativeToFiveSeeds,
      targetRetainedAtWidth4: targetRunRecord.retainedAtWidth4,
      sweet1RetainedAtWidth4: sweetRunRecord.retainedAtWidth4
    },
    pooledParetoLayerSizes: layers.map((layer) => layer.length)
  };
}

function firstCrossover(results, key) {
  const row = results.find((entry) => entry.centralComparison[key]);
  return row ? { horizon: row.horizon, additionalSouls: row.additionalSouls } : null;
}

function main() {
  const data = loadData();
  const references = JSON.parse(readFileSync(REFERENCE_FILE, "utf8"));
  const valueToGo = JSON.parse(readFileSync(VALUE_TO_GO_FILE, "utf8"));
  const definition = benchmarkCases("production").find((entry) =>
    entry.hero === "warden" && entry.focus === "weapon"
  );
  if (!definition) throw new Error("Warden weapon production case missing.");
  const referenceEntry = references.references[definition.id];
  if (!referenceEntry?.reference) throw new Error("Frozen reference missing.");
  if (valueToGo.scope?.hero !== "warden" || valueToGo.scope?.focus !== "weapon" ||
      valueToGo.scope?.budget !== 40000 || valueToGo.scope?.beamWidth !== WIDTH) {
    throw new Error("Value-to-go diagnosis scope mismatch.");
  }
  if (valueToGo.runs?.length !== 5) throw new Error("Expected exactly five stored value-to-go seeds.");

  const diversityKey = makeDiversityKey(data);
  const results = [];

  for (const horizon of INITIAL_HORIZONS) {
    results.push(analyzeHorizon(
      data,
      definition,
      referenceEntry.reference,
      valueToGo.runs,
      horizon,
      diversityKey
    ));
  }

  let score = firstCrossover(results, "scoreCrossover");
  let pareto = firstCrossover(results, "paretoCrossover");
  let retention = firstCrossover(results, "retentionCrossover");
  let adaptiveStopReason = "initial-grid-sufficient";

  if (!score || !pareto || !retention) {
    for (const horizon of EXTENDED_HORIZONS) {
      results.push(analyzeHorizon(
        data,
        definition,
        referenceEntry.reference,
        valueToGo.runs,
        horizon,
        diversityKey
      ));
      score = score || firstCrossover(results, "scoreCrossover");
      pareto = pareto || firstCrossover(results, "paretoCrossover");
      retention = retention || firstCrossover(results, "retentionCrossover");

      if (score && pareto && retention) {
        adaptiveStopReason = "all-crossovers-found";
        break;
      }
      if (horizon === 10000 && !score && !pareto && !retention) {
        adaptiveStopReason = "no-crossover-through-plus-6400-long-horizon-established";
        break;
      }
      adaptiveStopReason = "extended-grid-required";
    }
  }

  const earliestAny = results.find((entry) =>
    entry.centralComparison.scoreCrossover ||
    entry.centralComparison.paretoCrossover ||
    entry.centralComparison.retentionCrossover
  ) || null;
  const firstRelevant = results.find((entry) =>
    entry.centralComparison.paretoCrossover || entry.centralComparison.retentionCrossover
  ) || earliestAny;

  const result = {
    schemaVersion: "optimizer-crossover-horizon-test-v1",
    sourceCommit: process.env.GITHUB_SHA || "unknown",
    caseId: definition.id,
    scope: {
      hero: "warden",
      role: "carry",
      focus: "weapon",
      divergenceSouls: 3600,
      beamWidth: WIDTH,
      objective: SWEET,
      deterministicStepBudget: STEP_BUDGET,
      wallclockUsedAsBudget: false
    },
    reference: {
      version: referenceEntry.version,
      source: "frozen supplied baseline-v0"
    },
    seedSource: {
      schemaVersion: valueToGo.schemaVersion,
      sourceCommit: valueToGo.sourceCommit,
      path: "benchmarks/optimizer-v1/experiments/value-to-go-diagnosis/results.json",
      labels: valueToGo.runs.map((run) => run.seed.label),
      pathIds: valueToGo.runs.map((run) => ({ label: run.seed.label, pathId: run.seed.pathId }))
    },
    method: {
      horizonMeaning: "Each tested horizon is the Sweet evaluation/search horizon. Path AUC and terminal utility are measured only through that Soul value.",
      searchSemantics: "Per-seed deterministic Width-4 continuation using production future+path-history dedupe and production Pareto retention primitives.",
      noWallclockDeadline: true,
      adaptiveRule: "4000/4400/5200/6800 first; 10000 if needed; then +6400 coarse steps only when some crossover has begun but not all requested crossover types are known.",
      scoreCrossoverDefinition: "lost-high-velocity representative Sweet Path Score >= sweet-retained-1 representative Sweet Path Score",
      paretoCrossoverDefinition: "at least one lost-high-velocity frontier candidate survives the pairwise Path/End Pareto union against sweet-retained-1",
      retentionCrossoverDefinition: "at least one lost-high-velocity frontier candidate survives actual Width-4 retention over the pooled five-seed frontier candidates"
    },
    horizons: results,
    crossovers: {
      score,
      pareto,
      retention,
      earliestAny: earliestAny ? { horizon: earliestAny.horizon, additionalSouls: earliestAny.additionalSouls } : null,
      firstRelevant: firstRelevant ? { horizon: firstRelevant.horizon, additionalSouls: firstRelevant.additionalSouls } : null
    },
    adaptiveStopReason,
    hypothesisClass: retention && retention.additionalSouls <= 800
      ? "H1_SHORT_LOOKAHEAD"
      : retention && retention.additionalSouls <= 3200
        ? "H2_MEDIUM_LOOKAHEAD"
        : retention
          ? "H3_LONG_HORIZON_VALUE"
          : "H3_LONG_HORIZON_VALUE_NO_RETENTION_CROSSOVER_IN_TESTED_RANGE"
  };

  const targetOut = outputPath();
  mkdirSync(dirname(targetOut), { recursive: true });
  writeFileSync(targetOut, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({
    status: "COMPLETE",
    output: targetOut,
    crossovers: result.crossovers,
    hypothesisClass: result.hypothesisClass,
    adaptiveStopReason
  }, null, 2));
}

main();

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCsv } from "../app/lib.mjs";
import { buildOptimizerData } from "../app/optimizer.mjs";
import { measureSoulAxisPath } from "../app/search-objective-v1.mjs";
import {
  completeNodeBySaving,
  createRetentionFirstLossObserverForTest,
  dedupeFuturePathHistory,
  pathEndLazyNonDominatedLayers,
  pathEndNonDominatedLayers,
  runControlledMultiobjectiveBeamCarry,
  selectPathEndParetoBeam,
  selectPathEndParetoBeamCommonHorizonShadow,
  selectPathEndParetoBeamCommonHorizonScoreOnlyShadow,
  selectPathEndParetoBeamFullReferenceForTest
} from "../benchmarks/optimizer-v1/controlled-multiobjective-beam.mjs";

function node(serial, pathScore, endScore, bucket = "x", transactions = 1) {
  return {
    serial,
    bucket,
    transactions,
    vector: { pathScore, endScore }
  };
}

test("multiobjective layering uses only Path-AUC and Endbuild dominance", () => {
  const entries = [
    { id: "a", pathScore: 0.6, endScore: 0.4 },
    { id: "b", pathScore: 0.5, endScore: 0.5 },
    { id: "c", pathScore: 0.4, endScore: 0.6 },
    { id: "d", pathScore: 0.4, endScore: 0.4 }
  ];
  const layers = pathEndNonDominatedLayers(entries);
  assert.deepEqual(layers[0].map((entry) => entry.id), ["a", "b", "c"]);
  assert.deepEqual(layers[1].map((entry) => entry.id), ["d"]);
});

test("beam retention keeps the full first Pareto front before dominated layers", () => {
  const nodes = [
    node("a", 0.6, 0.4),
    node("b", 0.5, 0.5),
    node("c", 0.4, 0.6),
    node("d", 0.3, 0.3)
  ];
  const result = selectPathEndParetoBeam(nodes, 3, (entry) => entry.vector, (entry) => entry.bucket);
  assert.deepEqual(result.selected.map((entry) => entry.serial).sort(), ["a", "b", "c"]);
  assert.equal(result.metadata.firstFrontFullyRetained, true);
  assert.equal(result.metadata.scalarizationUsed, false);
  assert.equal(result.selected.some((entry) => Object.hasOwn(entry, "score")), false);
});

test("frontier overflow preserves both objective extremes and is deterministic", () => {
  const nodes = [
    node("a", 0.8, 0.2, "weapon"),
    node("b", 0.7, 0.4, "vitality"),
    node("c", 0.5, 0.6, "spirit"),
    node("d", 0.2, 0.8, "other")
  ];
  const run = () => selectPathEndParetoBeam(nodes, 3, (entry) => entry.vector, (entry) => entry.bucket);
  const first = run();
  const second = run();
  const ids = first.selected.map((entry) => entry.serial);
  assert.ok(ids.includes("a"));
  assert.ok(ids.includes("d"));
  assert.deepEqual(second.selected.map((entry) => entry.serial), ids);
  assert.equal(first.metadata.frontierOverflow, true);
  assert.equal(first.metadata.truncatedLayerIndex, 0);
  assert.equal(first.metadata.scalarizationUsed, false);
});

test("future-safe dedupe keeps distinct Path-AUC histories for the same future state", () => {
  const nodes = [
    node("same-a", 0.40, 0.50, "x", 3),
    node("same-b", 0.40, 0.50, "x", 2),
    node("history-diff", 0.41, 0.50, "x", 4)
  ];
  const deduped = dedupeFuturePathHistory(
    nodes,
    () => "same-future",
    (entry) => entry.vector,
    (entry) => entry.transactions
  );
  assert.deepEqual(deduped.map((entry) => entry.serial).sort(), ["history-diff", "same-b"]);
});

test("diagnostic semantic provenance survives an equivalent dedupe representative swap", () => {
  const observer = createRetentionFirstLossObserverForTest();
  const origin = node("origin", 0.4, 0.5, "x", 2);
  observer.registerOrigin(origin, "pool:origin", { poolIndex: 0, originStep: 0, originSouls: 400 });
  const tagged = node("z-tagged", 0.5, 0.5, "x", 2);
  const representative = node("a-representative", 0.5, 0.5, "x", 1);
  observer.inherit(origin, tagged);
  const unique = dedupeFuturePathHistory(
    [tagged, representative],
    () => "same-future",
    (entry) => entry.vector,
    (entry) => entry.transactions,
    observer
  );
  assert.deepEqual(unique, [representative]);
  assert.deepEqual(observer.directKeys(representative), []);
  assert.deepEqual(observer.semanticKeys(representative), ["pool:origin"]);
});

test("diagnostic origin registration unions existing direct and semantic provenance", () => {
  const observer = createRetentionFirstLossObserverForTest();
  const sharedNode = node("shared", 0.5, 0.5);
  observer.registerOrigin(sharedNode, "pool:first", { poolIndex: 0, originStep: 0, originSouls: 400 });
  observer.registerOrigin(sharedNode, "pool:second", { poolIndex: 1, originStep: 1, originSouls: 800 });
  assert.deepEqual(observer.directKeys(sharedNode), ["pool:first", "pool:second"]);
  assert.deepEqual(observer.semanticKeys(sharedNode), ["pool:first", "pool:second"]);
});

test("diagnostic observer identifies a true semantic retention extinction", () => {
  const observer = createRetentionFirstLossObserverForTest();
  const origin = { ...node("origin", 0.5, 0.5), state: { earnedSouls: 400, inventory: [] } };
  const child = { ...node("child", 0.4, 0.4), state: { earnedSouls: 800, inventory: [] } };
  const winner = { ...node("winner", 0.5, 0.5), state: { earnedSouls: 800, inventory: [] } };
  observer.registerOrigin(origin, "pool:origin", { poolIndex: 0, originStep: 0, originSouls: 400 });
  observer.inherit(origin, child);
  observer.beginStep(1, [origin]);
  observer.observeGenerated(child);
  observer.observeDedupeGroup([child], child);
  observer.observeDedupeGroup([winner], winner);
  observer.observePostDedupe([child, winner]);
  const selection = selectPathEndParetoBeam([child, winner], 1, (entry) => entry.vector, () => "x");
  observer.observePostRetention(selection.selected);
  observer.endStep({
    unique: [child, winner],
    selection,
    width: 1,
    vectorFor: (entry) => entry.vector,
    diversityKey: () => "x",
    commonHorizon: { applied: true, horizon: 800, reason: "test" }
  });
  const result = observer.summary()[0];
  assert.deepEqual(result.firstSemanticOutcome, { step: 1, outcome: "true-retention-loss" });
  assert.equal(result.steps[0].retentionEvidence.candidates[0].paretoLayer, 1);
  assert.equal(result.steps[0].retentionEvidence.capacityFillLayerIndex, 0);
  assert.equal(result.steps[0].retentionEvidence.precedingLayerCount, 0);
});

test("diagnostic observer preserves a terminal recorded before the loss step", () => {
  const observer = createRetentionFirstLossObserverForTest();
  const origin = { ...node("origin", 0.5, 0.5), state: { earnedSouls: 400, inventory: [] } };
  const child = { ...node("child", 0.4, 0.4), state: { earnedSouls: 800, inventory: [] } };
  const winner = { ...node("winner", 0.5, 0.5), state: { earnedSouls: 800, inventory: [] } };
  observer.registerOrigin(origin, "pool:origin", { poolIndex: 0, originStep: 0, originSouls: 400 });
  observer.observeTerminal(origin);
  observer.inherit(origin, child);
  observer.beginStep(1, [origin]);
  observer.observeGenerated(child);
  observer.observeDedupeGroup([child], child);
  observer.observeDedupeGroup([winner], winner);
  observer.observePostDedupe([child, winner]);
  const selection = selectPathEndParetoBeam([child, winner], 1, (entry) => entry.vector, () => "x");
  observer.observePostRetention(selection.selected);
  observer.endStep({ unique: [child, winner], selection, width: 1, vectorFor: (entry) => entry.vector, diversityKey: () => "x", commonHorizon: null });
  assert.deepEqual(observer.summary()[0].firstSemanticOutcome, { step: 1, outcome: "termination" });
});

test("diagnostic origin registration is not classified in the active retention step", () => {
  const observer = createRetentionFirstLossObserverForTest();
  observer.beginStep(1, []);
  const late = { ...node("late", 0.5, 0.5), state: { earnedSouls: 400, inventory: [] } };
  observer.registerOrigin(late, "pool:late", { poolIndex: 0, originStep: 1, originSouls: 400 });
  observer.endStep({ unique: [], selection: { selected: [] }, width: 1, vectorFor: (entry) => entry.vector, diversityKey: () => "x", commonHorizon: null });
  const result = observer.summary()[0];
  assert.equal(result.firstDirectLoss, null);
  assert.equal(result.firstSemanticOutcome, null);
  assert.deepEqual(result.steps, []);
});

test("a dominated partial candidate can remain when capacity reaches a later Pareto layer", () => {
  const nodes = [
    node("front-1", 0.7, 0.5, "a"),
    node("front-2", 0.5, 0.7, "b"),
    node("later-state", 0.4, 0.4, "c")
  ];
  const result = selectPathEndParetoBeam(nodes, 3, (entry) => entry.vector, (entry) => entry.bucket);
  assert.deepEqual(result.selected.map((entry) => entry.serial).sort(), ["front-1", "front-2", "later-state"]);
  assert.deepEqual(result.metadata.layerSizes, [2, 1]);
});


test("lazy Pareto layers are the exact prefix needed to fill the requested capacity", () => {
  const entries = [
    { id: "a", pathScore: 0.9, endScore: 0.3 },
    { id: "b", pathScore: 0.7, endScore: 0.5 },
    { id: "c", pathScore: 0.5, endScore: 0.7 },
    { id: "d", pathScore: 0.3, endScore: 0.9 },
    { id: "e", pathScore: 0.6, endScore: 0.4 },
    { id: "f", pathScore: 0.4, endScore: 0.6 },
    { id: "g", pathScore: 0.2, endScore: 0.2 }
  ];
  const full = pathEndNonDominatedLayers(entries);
  const lazy = pathEndLazyNonDominatedLayers(entries, 5);
  assert.deepEqual(
    lazy.layers.map((layer) => layer.map((entry) => entry.id)),
    full.slice(0, lazy.layers.length).map((layer) => layer.map((entry) => entry.id))
  );
  assert.ok(lazy.layeredCount >= 5);
  assert.equal(lazy.layeredCount + lazy.unlayeredCount, entries.length);
  assert.equal(lazy.complete, lazy.unlayeredCount === 0);
});

test("lazy retention is semantically identical to full layering across pools, widths, ties and repeated runs", () => {
  const pools = [
    [node("solo", 0.5, 0.5, "a")],
    [
      node("a", 0.8, 0.2, "weapon"),
      node("b", 0.7, 0.4, "vitality"),
      node("c", 0.5, 0.6, "spirit"),
      node("d", 0.2, 0.8, "other"),
      node("e", 0.4, 0.3, "weapon"),
      node("f", 0.3, 0.2, "spirit")
    ],
    [
      node("tie-a", 0.6, 0.6, "weapon"),
      node("tie-b", 0.6, 0.6, "vitality"),
      node("path", 0.8, 0.3, "weapon"),
      node("end", 0.3, 0.8, "spirit"),
      node("mid", 0.5, 0.5, "other"),
      node("low-a", 0.4, 0.4, "weapon"),
      node("low-b", 0.4, 0.4, "spirit"),
      node("floor", 0.1, 0.1, "other")
    ],
    [
      node("n01", 0.91, 0.21, "a"),
      node("n02", 0.84, 0.35, "b"),
      node("n03", 0.75, 0.48, "c"),
      node("n04", 0.66, 0.58, "d"),
      node("n05", 0.58, 0.66, "a"),
      node("n06", 0.49, 0.75, "b"),
      node("n07", 0.35, 0.84, "c"),
      node("n08", 0.21, 0.91, "d"),
      node("n09", 0.70, 0.30, "a"),
      node("n10", 0.55, 0.44, "b"),
      node("n11", 0.44, 0.55, "c"),
      node("n12", 0.30, 0.70, "d")
    ]
  ];
  const widths = [1, 2, 3, 4, 5, 8, 12];
  const vectorFor = (entry) => entry.vector;
  const diversityKey = (entry) => entry.bucket;

  for (const nodes of pools) {
    for (const width of widths.filter((value) => value <= nodes.length)) {
      const full = selectPathEndParetoBeamFullReferenceForTest(nodes, width, vectorFor, diversityKey);
      const lazyA = selectPathEndParetoBeam(nodes, width, vectorFor, diversityKey);
      const lazyB = selectPathEndParetoBeam(nodes, width, vectorFor, diversityKey);
      const ids = (result) => result.selected.map((entry) => entry.serial);
      assert.deepEqual(ids(lazyA), ids(full), `pool=${nodes.length} width=${width}`);
      assert.deepEqual(ids(lazyB), ids(lazyA), `repeat pool=${nodes.length} width=${width}`);
      assert.equal(lazyA.metadata.firstFrontSize, full.metadata.firstFrontSize);
      assert.equal(lazyA.metadata.truncatedLayerIndex, full.metadata.truncatedLayerIndex);
    }
  }
});

test("lazy retention stops before unused later Pareto layers", () => {
  const nodes = [
    node("front", 1.0, 1.0, "a"),
    node("l2", 0.9, 0.9, "b"),
    node("l3", 0.8, 0.8, "c"),
    node("l4", 0.7, 0.7, "d"),
    node("l5", 0.6, 0.6, "e"),
    node("l6", 0.5, 0.5, "f")
  ];
  const result = selectPathEndParetoBeam(nodes, 2, (entry) => entry.vector, (entry) => entry.bucket);
  assert.deepEqual(result.selected.map((entry) => entry.serial), ["front", "l2"]);
  assert.deepEqual(result.metadata.layerSizes, [1, 1]);
  assert.equal(result.metadata.layeringComplete, false);
  assert.equal(result.metadata.layeredCandidates, 2);
  assert.equal(result.metadata.unlayeredCandidates, 4);
});


test("common-horizon shadow projects only lagging candidates and retains original nodes", () => {
  const make = (serial, earnedSouls, vector) => ({
    serial,
    state: { earnedSouls, cash: 0, inventory: [serial] },
    parent: null,
    event: null,
    vector
  });
  const lagging = make("lagging", 3600, { pathScore: 0.30, endScore: 0.30 });
  const peers = [
    make("peer-a", 4000, { pathScore: 0.70, endScore: 0.70 }),
    make("peer-b", 4000, { pathScore: 0.65, endScore: 0.65 }),
    make("peer-c", 4000, { pathScore: 0.60, endScore: 0.60 }),
    make("peer-d", 4000, { pathScore: 0.55, endScore: 0.55 })
  ];
  const nodes = [lagging, ...peers];
  const projectedVector = { pathScore: 0.80, endScore: 0.80 };
  let saveCalls = 0;
  const saveTransitions = (node) => {
    saveCalls += 1;
    if (node.state.earnedSouls !== 3600) return [];
    return [{
      serial: node.serial + "|save:4000",
      state: { ...node.state, earnedSouls: 4000, cash: node.state.cash + 400 },
      parent: node,
      event: { type: "save", earnedSouls: 4000 },
      vector: projectedVector
    }];
  };
  const vectorFor = (node) => node.vector;
  const vectorForHorizon = (node, horizon) => {
    assert.equal(horizon, 4000);
    return node.serial.startsWith("lagging|save") ? projectedVector : node.vector;
  };

  const baseline = selectPathEndParetoBeam(nodes, 4, vectorFor);
  assert.equal(baseline.selected.includes(lagging), false);

  const shadow = selectPathEndParetoBeamCommonHorizonShadow(
    nodes, 4, vectorFor, vectorForHorizon, saveTransitions
  );
  assert.equal(shadow.shadowProjection.applied, true);
  assert.equal(shadow.shadowProjection.commonHorizon, 4000);
  assert.equal(shadow.shadowProjection.projectedCandidates, 1);
  assert.equal(shadow.shadowProjection.saveTransitions, 1);
  assert.equal(shadow.shadowProjection.maxSaveStepsPerCandidate, 1);
  assert.equal(saveCalls, 1);
  assert.equal(shadow.selected.includes(lagging), true);
  assert.equal(shadow.selected.some((entry) => entry.serial === "lagging|save:4000"), false);
  assert.equal(shadow.projectionEntries[0].originalNode, lagging);
  assert.equal(shadow.projectionEntries[0].projectedNode.state.earnedSouls, 4000);
});

test("score-only common-horizon is vector/retention equivalent to materialized shadow without virtual nodes", () => {
  const make = (serial, earnedSouls, vector) => ({
    serial,
    state: { earnedSouls, cash: 0, inventory: [serial] },
    parent: null,
    event: null,
    vector
  });
  const lagging = make("lagging", 3600, { pathScore: 0.30, endScore: 0.30 });
  const nodes = [
    lagging,
    make("peer-a", 4000, { pathScore: 0.70, endScore: 0.70 }),
    make("peer-b", 4000, { pathScore: 0.65, endScore: 0.65 }),
    make("peer-c", 4000, { pathScore: 0.60, endScore: 0.60 }),
    make("peer-d", 4000, { pathScore: 0.55, endScore: 0.55 })
  ];
  const projectedVector = { pathScore: 0.80, endScore: 0.80 };
  let materializedSaveCalls = 0;
  const saveTransitions = (node) => {
    materializedSaveCalls += 1;
    return [{
      serial: node.serial + "|save:4000",
      state: { ...node.state, earnedSouls: 4000, cash: node.state.cash + 400 },
      parent: node,
      event: { type: "save", earnedSouls: 4000 },
      vector: projectedVector
    }];
  };
  const vectorFor = (node) => node.vector;
  const vectorForHorizon = (node, horizon) => {
    assert.equal(horizon, 4000);
    return node.serial.startsWith("lagging") ? projectedVector : node.vector;
  };

  const materialized = selectPathEndParetoBeamCommonHorizonShadow(
    nodes, 4, vectorFor, vectorForHorizon, saveTransitions
  );
  const scoreOnlyA = selectPathEndParetoBeamCommonHorizonScoreOnlyShadow(
    nodes, 4, vectorFor, vectorForHorizon
  );
  const scoreOnlyB = selectPathEndParetoBeamCommonHorizonScoreOnlyShadow(
    nodes, 4, vectorFor, vectorForHorizon
  );
  const ids = (result) => result.selected.map((entry) => entry.serial);

  assert.deepEqual(ids(scoreOnlyA), ids(materialized));
  assert.deepEqual(ids(scoreOnlyB), ids(scoreOnlyA));
  assert.equal(scoreOnlyA.selected.includes(lagging), true);
  assert.equal(scoreOnlyA.selected.every((entry) => nodes.includes(entry)), true);
  assert.equal(scoreOnlyA.projectionEntries.length, 0);
  assert.equal(scoreOnlyA.shadowProjection.materializedProjectedNodes, 0);
  assert.equal(scoreOnlyA.shadowProjection.saveTransitions, 0);
  assert.equal(scoreOnlyA.shadowProjection.scoreOnlyProjections, 1);
  assert.equal(materializedSaveCalls, 1);
});

test("piecewise-constant Path/End score is exactly unchanged by a duplicate-metrics save point at the horizon", () => {
  const metrics = (value) => ({
    sustainedBulletDps: value,
    sustainedSpiritDps: value,
    laneTradeBulletDps: value,
    laneTradeSpiritDps: value,
    farmBulletDps: value,
    farmSpiritDps: value,
    skirmishBulletDps: value,
    skirmishSpiritDps: value,
    teamfightBulletDps: value,
    teamfightSpiritDps: value,
    bulletEhp: value,
    spiritEhp: value
  });
  const original = [
    { earnedSouls: 0, metrics: metrics(10) },
    { earnedSouls: 3600, metrics: metrics(20) }
  ];
  const materialized = [...original, { earnedSouls: 4000, metrics: metrics(20) }];
  const reference = {
    axis: [0, 3600, 4000],
    values: [metrics(20), metrics(30), metrics(30)]
  };
  const a = measureSoulAxisPath(original, reference, [], 4000, "weapon");
  const b = measureSoulAxisPath(materialized, reference, [], 4000, "weapon");
  assert.equal(a.pathScore, b.pathScore);
  assert.equal(a.endScore, b.endScore);
  assert.equal(a.pathDamage, b.pathDamage);
  assert.equal(a.endDamage, b.endDamage);
  assert.equal(a.pathSurvivability, b.pathSurvivability);
  assert.equal(a.endSurvivability, b.endSurvivability);
});

test("common-horizon shadow refuses ambiguous pools spanning more than the next present horizon", () => {
  const nodes = [3600, 4000, 4400].map((earnedSouls, index) => ({
    serial: String(index),
    state: { earnedSouls, cash: 0, inventory: [] },
    vector: { pathScore: 1 - index * 0.1, endScore: 1 - index * 0.1 },
    parent: null,
    event: null
  }));
  let saveCalls = 0;
  const result = selectPathEndParetoBeamCommonHorizonShadow(
    nodes,
    2,
    (node) => node.vector,
    (node) => node.vector,
    () => { saveCalls += 1; return []; }
  );
  assert.equal(result.shadowProjection.applied, false);
  assert.equal(result.shadowProjection.reason, "pool-spans-beyond-next-economic-horizon");
  assert.equal(saveCalls, 0);
});

test("save-to-horizon completion follows only legal save successors and preserves inventory", () => {
  const makePartial = (serial, earnedSouls = 0, cash = 0, inventory = ["held"]) => ({
    state: { earnedSouls, cash, inventory: [...inventory] },
    parent: null,
    event: null,
    serial
  });
  const transitions = (current) => {
    const nextSouls = Math.min(4000, current.state.earnedSouls + 2000);
    const delta = nextSouls - current.state.earnedSouls;
    return [
      {
        state: {
          ...current.state,
          inventory: [...current.state.inventory, "illegal-choice-for-completion"]
        },
        parent: current,
        event: { type: "purchase", item: "illegal-choice-for-completion" },
        serial: current.serial + "|purchase"
      },
      {
        state: {
          ...current.state,
          earnedSouls: nextSouls,
          cash: current.state.cash + delta,
          inventory: [...current.state.inventory]
        },
        parent: current,
        event: { type: "save", earnedSouls: nextSouls },
        serial: current.serial + "|save:" + nextSouls
      }
    ];
  };

  const first = completeNodeBySaving(makePartial("a"), 4000, transitions);
  const second = completeNodeBySaving(makePartial("b", 2000, 500, ["other"]), 4000, transitions);

  assert.equal(first.state.earnedSouls, 4000);
  assert.equal(first.state.cash, 4000);
  assert.deepEqual(first.state.inventory, ["held"]);
  assert.equal(second.state.earnedSouls, 4000);
  assert.equal(second.state.cash, 2500);
  assert.deepEqual(second.state.inventory, ["other"]);

  const types = (terminal) => {
    const result = [];
    for (let current = terminal; current?.parent; current = current.parent) result.push(current.event.type);
    return result.reverse();
  };
  assert.deepEqual(types(first), ["save", "save"]);
  assert.deepEqual(types(second), ["save"]);

  const repeat = completeNodeBySaving(makePartial("a"), 4000, transitions);
  assert.equal(repeat.serial, first.serial);
});


test("save-to-horizon completion is a no-op for an already terminal retained node", () => {
  const terminal = {
    state: { earnedSouls: 4000, cash: 1234, inventory: ["held"] },
    parent: null,
    event: null,
    serial: "terminal"
  };
  let transitionCalls = 0;
  const completed = completeNodeBySaving(terminal, 4000, () => {
    transitionCalls += 1;
    return [];
  });
  assert.equal(completed, terminal);
  assert.equal(transitionCalls, 0);
});


function canonicalData() {
  const json = (path) => JSON.parse(readFileSync(path, "utf8"));
  const csv = (path) => parseCsv(readFileSync(path, "utf8"));
  return buildOptimizerData({
    coreManifest: json("data/core/manifest.json"),
    heroManifest: json("data/heroes/manifest.json"),
    items: csv("data/core/items.csv"),
    itemMechanics: csv("data/core/item_mechanics.csv"),
    upgrades: csv("data/core/item_upgrades.csv"),
    heroes: csv("data/heroes/heroes.csv"),
    abilities: csv("data/heroes/abilities.csv"),
    abilityMechanics: csv("data/heroes/ability_mechanics.csv"),
    interactions: csv("data/interactions/hero_interactions.csv"),
    progression: json("data/heroes/progression.json"),
    heroStats: csv("data/heroes/hero_stats.csv"),
    heroResources: csv("data/heroes/hero_resources.csv"),
    economy: json("data/core/economy.json"),
    slots: json("data/core/slots.json")
  });
}

test("baseline runner is unchanged when both common-horizon flags are omitted versus explicitly off", () => {
  const data = canonicalData();
  const slotUnlocks = [{ earnedSouls: 0, slots: data.slots.item_limit - data.slots.starting_slots.universal }];
  const args = {
    data,
    heroId: "warden",
    damageFocus: "weapon",
    itemIds: ["upgrade_rapid_rounds"],
    budget: 800,
    milestones: [800],
    slotUnlocks,
    beamWidth: 4,
    maxSteps: 10,
    timeMs: Infinity,
    referenceTimeMs: 100
  };
  const implicit = runControlledMultiobjectiveBeamCarry(args);
  const explicit = runControlledMultiobjectiveBeamCarry({
    ...args,
    commonHorizonShadow: false,
    commonHorizonScoreOnlyShadow: false
  });
  const compact = (result) => result.front.map((entry) => ({
    pathScore: entry.pathScore,
    endScore: entry.endScore,
    earnedSouls: entry.state.earnedSouls,
    inventory: entry.state.inventory,
    events: entry.state.events
  }));
  assert.deepEqual(compact(implicit), compact(explicit));
  assert.equal(Object.hasOwn(implicit.telemetry, "commonHorizonShadow"), false);
  assert.equal(Object.hasOwn(explicit.telemetry, "commonHorizonShadow"), false);
});

test("common-horizon retention audit is restricted to score-only unlimited-time diagnostics", () => {
  const data = canonicalData();
  const slotUnlocks = [{ earnedSouls: 0, slots: data.slots.item_limit - data.slots.starting_slots.universal }];
  const args = {
    data,
    heroId: "warden",
    damageFocus: "weapon",
    itemIds: ["upgrade_rapid_rounds"],
    budget: 800,
    milestones: [800],
    slotUnlocks,
    beamWidth: 4,
    maxSteps: 10,
    timeMs: Infinity,
    referenceTimeMs: 100
  };
  assert.throws(
    () => runControlledMultiobjectiveBeamCarry({ ...args, commonHorizonRetentionAudit: true }),
    /benötigt den Score-only Shadow/
  );
  assert.throws(
    () => runControlledMultiobjectiveBeamCarry({
      ...args,
      commonHorizonScoreOnlyShadow: true,
      commonHorizonRetentionAudit: true,
      timeMs: 1000
    }),
    /benötigt timeMs=Infinity/
  );
  assert.throws(
    () => runControlledMultiobjectiveBeamCarry({
      ...args,
      commonHorizonScoreOnlyShadow: true,
      commonHorizonRetentionFirstLossAudit: true
    }),
    /benötigt den Retention Audit/
  );
});

test("first-loss observer leaves retained trace, front and search work unchanged", () => {
  const data = canonicalData();
  const slotUnlocks = [{ earnedSouls: 0, slots: data.slots.item_limit - data.slots.starting_slots.universal }];
  const args = {
    data,
    heroId: "warden",
    damageFocus: "weapon",
    itemIds: ["upgrade_rapid_rounds"],
    budget: 800,
    milestones: [800],
    slotUnlocks,
    beamWidth: 4,
    maxSteps: 10,
    timeMs: Infinity,
    referenceTimeMs: 100,
    commonHorizonScoreOnlyShadow: true,
    commonHorizonRetentionAudit: true
  };
  const control = runControlledMultiobjectiveBeamCarry(args);
  const observed = runControlledMultiobjectiveBeamCarry({ ...args, commonHorizonRetentionFirstLossAudit: true });
  const ids = (result) => result.front.map((entry) => entry.state.events);
  assert.deepEqual(observed.telemetry.selectionTrace, control.telemetry.selectionTrace);
  assert.deepEqual(ids(observed), ids(control));
  assert.equal(observed.telemetry.generatedStates, control.telemetry.generatedStates);
  assert.equal(observed.telemetry.transitionCalls, control.telemetry.transitionCalls);
});

test("guarded diagnostic snapshot stops after one completed selection without terminalization", () => {
  const data = canonicalData();
  const result = runControlledMultiobjectiveBeamCarry({
    data,
    heroId: "warden",
    damageFocus: "weapon",
    itemIds: ["upgrade_rapid_rounds"],
    budget: 800,
    milestones: [800],
    slotUnlocks: [{ earnedSouls: 0, slots: data.slots.item_limit - data.slots.starting_slots.universal }],
    beamWidth: 4,
    maxSteps: 10,
    timeMs: Infinity,
    referenceTimeMs: 100,
    diagnosticSnapshotAfterSelectionStep: 0
  });
  assert.equal(result.front.length, 0);
  assert.equal(result.telemetry.diagnosticStoppedAfterSelectionStep, 0);
  assert.equal(result.telemetry.searchComplete, false);
  assert.equal(result.telemetry.diagnosticSnapshot.generated.length > 0, true);
  assert.equal(result.telemetry.diagnosticSnapshot.retained.length, result.telemetry.selectionTrace[0].retained);
});

test("shared browser-safe Multiobjective kernel reaches 40k for Warden focuses and Venator Weapon", () => {
  const data = canonicalData();
  const slotUnlocks = [{ earnedSouls: 0, slots: data.slots.item_limit - data.slots.starting_slots.universal }];
  const cases = [
    { heroId: "warden", damageFocus: "weapon" },
    { heroId: "warden", damageFocus: "spirit" },
    { heroId: "warden", damageFocus: "hybrid" },
    { heroId: "venator", damageFocus: "weapon" }
  ];
  for (const { heroId, damageFocus } of cases) {
    const result = runControlledMultiobjectiveBeamCarry({
      data,
      heroId,
      damageFocus,
      itemIds: ["upgrade_rapid_rounds"],
      budget: 40000,
      milestones: [],
      slotUnlocks,
      beamWidth: 4,
      timeMs: 1000,
      auditReserveMs: 100,
      referenceTimeMs: 100
    });
    assert.ok(result.front.length >= 1, `${heroId}/${damageFocus}`);
    assert.ok(result.front.every((entry) => entry.state.earnedSouls === 40000), `${heroId}/${damageFocus}`);
    assert.ok(result.front.every((entry) => entry.validation.valid === true), `${heroId}/${damageFocus}`);
    assert.equal(result.telemetry.scalarizationUsed, false, `${heroId}/${damageFocus}`);
    assert.equal(result.telemetry.referenceSource, "sampled", `${heroId}/${damageFocus}`);
    assert.equal(result.telemetry.timeBudgetMs, 1000, `${heroId}/${damageFocus}`);
  }
});

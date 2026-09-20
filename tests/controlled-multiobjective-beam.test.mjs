import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCsv } from "../app/lib.mjs";
import { buildOptimizerData } from "../app/optimizer.mjs";
import {
  completeNodeBySaving,
  dedupeFuturePathHistory,
  pathEndLazyNonDominatedLayers,
  pathEndNonDominatedLayers,
  runControlledMultiobjectiveBeamCarry,
  selectPathEndParetoBeam,
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

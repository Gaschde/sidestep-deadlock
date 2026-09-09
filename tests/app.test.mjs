import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTestBuild, manifestsAreCompatible, parseCsv } from "../app/lib.mjs";
import { enumerateReference } from "../app/reference-search.mjs";
import { searchLabels } from "../app/search-core.mjs";
import { createSmallDomain } from "../app/small-domain.mjs";
import { calculateTrajectoryObjectives } from "../app/trajectory-objectives.mjs";
import { createDeadlockDomain } from "../app/deadlock-domain.mjs";
import { buildOptimizerData } from "../app/optimizer.mjs";

test("parseCsv verarbeitet Kommas und Zeilenumbrüche in Anführungszeichen", () => {
  const rows = parseCsv('id,name,notes\n1,"Alpha, Beta","Zeile 1\nZeile 2"\n');
  assert.deepEqual(rows, [{ id: "1", name: "Alpha, Beta", notes: "Zeile 1\nZeile 2" }]);
});

test("Manifest-Kompatibilität verlangt gleichen Patch und Modus", () => {
  assert.equal(manifestsAreCompatible({ patch: "p1", mode: "standard" }, { patch: "p1", mode: "standard" }), true);
  assert.equal(manifestsAreCompatible({ patch: "p1", mode: "standard" }, { patch: "p2", mode: "standard" }), false);
});

test("Unabhängige Referenz enumeriert alle legalen Zustände und entfernt nur dominierte Labels", () => {
  const result = enumerateReference({
    initialState: { id: "start", spent: 0 },
    expand: (state) => ({ start: [{ id: "weak", spent: 1 }, { id: "strong", spent: 1 }], weak: [{ id: "goal", spent: 2 }], strong: [], goal: [] }[state.id]),
    stateKey: (state) => `${state.id}@${state.spent}`,
    label: (state) => ({ score: { weak: 1, strong: 2, goal: 4, start: 0 }[state.id] })
  });
  assert.deepEqual(result.states.map(({ state }) => state.id), ["start", "weak", "strong", "goal"]);
  assert.deepEqual(result.pareto.map(({ state }) => state.id), ["goal"]);
});

test("Referenz dedupliziert kostenlose Zyklen über den vollständigen Zustands-Key", () => {
  const result = enumerateReference({
    initialState: { id: "a", spent: 0 },
    expand: (state) => state.id === "a" ? [{ id: "b", spent: 0 }] : [{ id: "a", spent: 0 }],
    stateKey: (state) => `${state.id}@${state.spent}`,
    label: () => ({ score: 1 })
  });
  assert.equal(result.states.length, 2);
});

test("Label-Correcting pruned nur zukunftsäquivalente Labels", () => {
  const result = searchLabels({
    initialState: { id: "start", spent: 0, inventory: "" },
    expand: (state) => ({
      start: [{ id: "a", spent: 1, inventory: "a" }, { id: "b", spent: 1, inventory: "b" }],
      a: [],
      b: [{ id: "c", spent: 2, inventory: "c" }],
      c: []
    }[state.id]),
    stateKey: (state) => `${state.id}@${state.spent}`,
    futureKey: (state) => `${state.spent}:${state.inventory}`,
    label: (state) => ({ score: { start: 0, a: 10, b: 1, c: 100 }[state.id] })
  });
  assert.deepEqual(result.labels.map(({ state }) => state.id).sort(), ["a", "b", "c", "start"]);
  assert.equal(result.prunedLabels, 0);
});

test("Label-Correcting entfernt ein klar schwächeres Label am gleichen Zukunftszustand", () => {
  const result = searchLabels({
    initialState: { id: "start", variant: "start" },
    expand: (state) => state.id === "start" ? [
      { id: "weak", variant: "same" },
      { id: "strong", variant: "same" }
    ] : [],
    stateKey: (state) => state.id,
    futureKey: (state) => state.variant,
    label: (state) => ({ score: state.id === "strong" ? 2 : 1 }),
  });
  assert.deepEqual(result.labels.map(({ state }) => state.id).sort(), ["start", "strong"]);
  assert.equal(result.prunedLabels, 1);
});

test("Label-Correcting beendet wachsende kostenlose Historien über identische Labels, nicht über visited-State", () => {
  const result = searchLabels({
    initialState: { id: "a", step: 0 },
    expand: (state) => state.step >= 3 ? [] : [{ id: "a", step: state.step + 1, improved: state.step === 0 }],
    stateKey: (state) => `${state.id}:${state.step}`,
    futureKey: () => "same-future",
    label: (state) => ({ score: state.improved ? 2 : 1 })
  });
  assert.equal(result.expandedStates, 2);
  assert.equal(result.visitedStates, 2);
  assert.equal(result.labels.length, 1);
  assert.equal(result.prunedLabels, 2);
});

test("Kleiner Domänenadapter trennt earnedSouls und Guthaben und prüft legale Ressourcenaktionen", () => {
  const domain = createSmallDomain({
    items: [{ id: "a", cost: 100, power: 2 }, { id: "b", cost: 200, power: 5 }],
    upgrades: [{ from: "a", to: "b", cost: 100 }],
    unlocks: [{ earnedSouls: 200, slots: 1 }],
    incomeStep: 100,
    horizon: 300
  });
  const saved = domain.transitions(domain.initial).find((state) => state.events[0].type === "save");
  const bought = domain.transitions(saved).find((state) => state.events[1].type === "purchase");
  assert.equal(saved.earnedSouls, 100);
  assert.equal(saved.cash, 100);
  assert.equal(bought.earnedSouls, 100);
  assert.equal(bought.cash, 0);
  const later = domain.transitions(domain.transitions(saved).find((state) => state.events[1].type === "save"));
  assert.ok(later.some((state) => state.unlockedSlots === 1));
  assert.ok(bought.events.some((event) => event.type === "purchase"));
});

test("Worst Regret und Integrated Regret verwenden die verdiente-Souls-Achse", () => {
  const objectives = calculateTrajectoryObjectives({
    points: [{ earnedSouls: 0, metrics: { power: 0 } }, { earnedSouls: 100, metrics: { power: 1 } }, { earnedSouls: 200, metrics: { power: 3 } }],
    references: [{ earnedSouls: 0, metrics: { power: 0 } }, { earnedSouls: 100, metrics: { power: 2 } }, { earnedSouls: 200, metrics: { power: 3 } }],
    metric: "power",
    horizon: 200
  });
  assert.equal(objectives.worstRegret, 0.5);
  assert.equal(objectives.integratedRegret, 0.25);
  assert.equal(objectives.endPerformance, 3);
});

test("Sprunghafte Käufe wirken nicht vor dem Ereignis und behalten Transaktionen bei gleichem Soul-Stand", () => {
  const result = calculateTrajectoryObjectives({
    points: [
      { earnedSouls: 0, kind: "resource", metrics: { power: 0 } },
      { earnedSouls: 100, kind: "transaction", sequence: 1, metrics: { power: 5 } }
    ],
    references: [
      { earnedSouls: 0, kind: "resource", metrics: { power: 0 } },
      { earnedSouls: 50, kind: "resource", metrics: { power: 5 } },
      { earnedSouls: 100, kind: "transaction", sequence: 1, metrics: { power: 5 } }
    ],
    metric: "power",
    horizon: 100
  });
  assert.equal(result.curve.find((point) => point.earnedSouls === 50).actual, 0);
  assert.equal(result.curve.find((point) => point.earnedSouls === 100).actual, 5);
});

test("Label-Correcting und unabhängige Enumeration liefern im kleinen Domänenfall dieselbe Pareto-Menge", () => {
  const domain = createSmallDomain({
    items: [{ id: "a", cost: 100, power: 2 }, { id: "b", cost: 200, power: 5 }],
    upgrades: [{ from: "a", to: "b", cost: 100 }],
    incomeStep: 100,
    horizon: 300
  });
  const reference = domain.enumerate();
  const search = domain.search();
  const key = (entry) => `${entry.state.earnedSouls}:${entry.state.cash}:${entry.state.inventory.join("|")}:${entry.label.power}`;
  const referenceKeys = new Set(reference.pareto.map(key));
  const searchKeys = new Set(search.pareto.map(key));
  assert.deepEqual(searchKeys, referenceKeys);
});

test("Kanonischer Deadlock-Adapter bindet Warden-Slots ohne erfundene Souls-Freischaltung an", () => {
  const json = (path) => JSON.parse(readFileSync(path, "utf8"));
  const csv = (path) => parseCsv(readFileSync(path, "utf8"));
  const raw = {
    coreManifest: json("data/core/manifest.json"),
    heroManifest: json("data/heroes/manifest.json"),
    items: csv("data/core/items.csv"),
    itemMechanics: csv("data/core/item_mechanics.csv"),
    upgrades: csv("data/core/item_upgrades.csv"),
    economy: json("data/core/economy.json"),
    slots: json("data/core/slots.json")
  };
  const data = buildOptimizerData(raw);
  const domain = createDeadlockDomain({ data, itemIds: ["upgrade_extra_charge", "upgrade_improved_spirit"], soulAxis: [0, 800, 1600], budget: 1600, slotUnlocks: [] });
  const saved = domain.transitions(domain.initial).find((state) => state.events[0].type === "save");
  assert.equal(saved.earnedSouls, 800);
  assert.equal(saved.cash, 800);
  assert.equal(saved.unlockedSlots, 0);
  assert.equal(data.slots.starting_slots.universal, 9);
  assert.equal(domain.initial.snapshots.length, 1);
  assert.ok(domain.enumerate().pareto.length > 0);
  assert.ok(domain.search().labels.length > 0);
});

test("Testpfad respektiert Budget, Slots und Upgrade-Zahlung", () => {
  const items = [
    { item_id: "w1", name: "Weapon One", category: "Weapon", tier: "1", total_cost: "800", is_public_shop_item: "true", active_type: "", confidence: "high" },
    { item_id: "v1", name: "Vitality One", category: "Vitality", tier: "1", total_cost: "800", is_public_shop_item: "true", active_type: "", confidence: "high" },
    { item_id: "s1", name: "Spirit One", category: "Spirit", tier: "1", total_cost: "800", is_public_shop_item: "true", active_type: "", confidence: "high" },
    { item_id: "w2", name: "Weapon Two", category: "Weapon", tier: "2", total_cost: "1600", is_public_shop_item: "true", active_type: "", confidence: "high" }
  ];
  const edges = [{ from_item_id: "w1", to_item_id: "w2", additional_cost: "800", notes: "", confidence: "medium" }];
  const build = createTestBuild(items, edges, "weapon", 4000);
  assert.ok(build.spent <= 4000);
  assert.ok(build.inventory.length <= 9);
  assert.ok(build.events.some((event) => event.upgradeFrom?.item_id === "w1" && event.payment === 800));
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyPurchase,
  applyReplacement,
  applyUpgrade,
  assessWeaponItem,
  assessWeaponCarryItem,
  buildOptimizerData,
  buildPathTrajectory,
  createInitialBuildState,
  createCarryScenarioPlan,
  evaluateCarryDecision,
  evaluateCarryScenarios,
  evaluateWeaponMechanics,
  evaluateWeaponState,
  optimizeWeaponCarry,
  optimizeWeaponCarryFullBuild,
  rankedCarryStates,
  retainDistinctPurchaseHistories
} from "../app/optimizer.mjs";
import { buildHeroCapabilityProfile, evaluateItemCapabilities } from "../app/capabilities.mjs";
import { parseCsv } from "../app/lib.mjs";

function fixture() {
  const items = [
    { item_id: "component", name: "Komponente", category: "Weapon", tier: "1", total_cost: "800", is_public_shop_item: "true", active_type: "", confidence: "high" },
    { item_id: "damage", name: "Schaden", category: "Weapon", tier: "2", total_cost: "1600", is_public_shop_item: "true", active_type: "", confidence: "high" },
    { item_id: "burst", name: "Burst", category: "Weapon", tier: "2", total_cost: "1600", is_public_shop_item: "false", active_type: "", confidence: "high" },
    { item_id: "sustained", name: "Sustain", category: "Weapon", tier: "2", total_cost: "1600", is_public_shop_item: "false", active_type: "", confidence: "high" },
    { item_id: "superior", name: "Überlegen", category: "Weapon", tier: "2", total_cost: "1600", is_public_shop_item: "false", active_type: "", confidence: "high" },
    { item_id: "active", name: "Aktiv", category: "Weapon", tier: "1", total_cost: "800", is_public_shop_item: "true", active_type: "InstantCast", confidence: "high" },
    { item_id: "irrelevant", name: "Ohne Weapon-Wert", category: "Vitality", tier: "1", total_cost: "800", is_public_shop_item: "true", active_type: "", confidence: "high" },
    { item_id: "spirit", name: "Spirit", category: "Spirit", tier: "1", total_cost: "800", is_public_shop_item: "true", active_type: "", confidence: "high" },
    { item_id: "bullet_resist_a", name: "Bullet Resist A", category: "Vitality", tier: "1", total_cost: "800", is_public_shop_item: "true", active_type: "", confidence: "high" },
    { item_id: "bullet_resist_b", name: "Bullet Resist B", category: "Vitality", tier: "1", total_cost: "800", is_public_shop_item: "true", active_type: "", confidence: "high" },
    { item_id: "regen", name: "Regeneration", category: "Other", tier: "1", total_cost: "800", is_public_shop_item: "true", active_type: "", confidence: "high" },
    { item_id: "lifesteal", name: "Lifesteal", category: "Other", tier: "1", total_cost: "800", is_public_shop_item: "true", active_type: "", confidence: "high" }
  ];
  return buildOptimizerData({
    coreManifest: { patch: "p", mode: "m" },
    heroManifest: { patch: "p", mode: "m" },
    items,
    itemMechanics: [
      { item_id: "damage", effect_id: "damage_pct", mechanic: "base_attack_damage_percent", value: "20", unit: "percent", condition: "Immer, solange das Item gehalten wird.", confidence: "high" },
      { item_id: "damage", effect_id: "fire_rate", mechanic: "bonus_fire_rate", value: "10", unit: "percent", condition: "Immer, solange das Item gehalten wird.", confidence: "high" },
      { item_id: "burst", effect_id: "burst_damage", mechanic: "base_attack_damage_percent", value: "50", unit: "percent", condition: "Immer, solange das Item gehalten wird.", confidence: "high" },
      { item_id: "burst", effect_id: "burst_rate", mechanic: "bonus_fire_rate", value: "100", unit: "percent", condition: "Immer, solange das Item gehalten wird.", confidence: "high" },
      { item_id: "sustained", effect_id: "sustained_damage", mechanic: "base_attack_damage_percent", value: "25", unit: "percent", condition: "Immer, solange das Item gehalten wird.", confidence: "high" },
      { item_id: "sustained", effect_id: "sustained_clip", mechanic: "bonus_clip_size_percent", value: "700", unit: "percent", condition: "Immer, solange das Item gehalten wird.", confidence: "high" },
      { item_id: "superior", effect_id: "superior_damage", mechanic: "base_attack_damage_percent", value: "100", unit: "percent", condition: "Immer, solange das Item gehalten wird.", confidence: "high" },
      { item_id: "superior", effect_id: "superior_rate", mechanic: "bonus_fire_rate", value: "100", unit: "percent", condition: "Immer, solange das Item gehalten wird.", confidence: "high" },
      { item_id: "superior", effect_id: "superior_clip", mechanic: "bonus_clip_size_percent", value: "100", unit: "percent", condition: "Immer, solange das Item gehalten wird.", confidence: "high" },
      { item_id: "active", effect_id: "active_rate", mechanic: "bonus_fire_rate", value: "5", unit: "percent", condition: "Beim Aktivieren.", trigger: "item_activation", confidence: "high" },
      { item_id: "irrelevant", effect_id: "health", mechanic: "bonus_health", value: "300", unit: "hp", condition: "Immer, solange das Item gehalten wird.", confidence: "high" },
      { item_id: "spirit", effect_id: "spirit_power", mechanic: "tech_power", value: "10", unit: "spirit_power", condition: "Immer, solange das Item gehalten wird.", confidence: "high" },
      { item_id: "bullet_resist_a", effect_id: "resist_a", mechanic: "bullet_resist", value: "20", unit: "percent", condition: "Immer, solange das Item gehalten wird.", confidence: "high" },
      { item_id: "bullet_resist_b", effect_id: "resist_b", mechanic: "bullet_resist", value: "30", unit: "percent", condition: "Immer, solange das Item gehalten wird.", confidence: "high" },
      { item_id: "regen", effect_id: "regen_per_second", mechanic: "bonus_health_regen", value: "10", unit: "hp/s", condition: "Immer, solange das Item gehalten wird.", confidence: "high" },
      { item_id: "lifesteal", effect_id: "bullet_lifesteal", mechanic: "bullet_lifesteal_percent", value: "10", unit: "percent", condition: "Immer, solange das Item gehalten wird.", confidence: "high" }
    ],
    upgrades: [{ from_item_id: "component", to_item_id: "damage", additional_cost: "800", notes: "", confidence: "high" }],
    heroStats: [
      { hero_id: "hero", stat_group: "weapon", mechanic: "dps", base_value: "100", confidence: "high" },
      { hero_id: "hero", stat_group: "weapon", mechanic: "bullet_damage", base_value: "20", confidence: "high" },
      { hero_id: "hero", stat_group: "weapon", mechanic: "rounds_per_second", base_value: "4", confidence: "high" },
      { hero_id: "hero", stat_group: "ammo", mechanic: "clip_size", base_value: "8", confidence: "high" },
      { hero_id: "hero", stat_group: "reload", mechanic: "reload_time", base_value: "2", confidence: "high" },
      { hero_id: "hero", stat_group: "health", mechanic: "max_health", base_value: "800", confidence: "high" },
      { hero_id: "hero", stat_group: "health", mechanic: "base_health_regen", base_value: "0", confidence: "high" },
      { hero_id: "hero", stat_group: "weapon", mechanic: "rounds_per_second_spirit_scaling", base_value: "0.1", confidence: "high" },
      { hero_id: "hero", stat_group: "weapon", mechanic: "sustained_dps_spirit_scaling", base_value: "20", confidence: "high" }
    ],
    economy: {
      investment_thresholds: [{ category_investment: 800, bonuses: { weapon: { cumulative_bonus: 9 }, vitality: { cumulative_bonus: 9 }, spirit: { cumulative_bonus: 7 } } }]
    },
    slots: { starting_slots: { universal: 1 }, unlocks: [], active_item_limit: 1 }
  });
}

const request = {
  heroId: "hero",
  objective: "weapon_magazine_dps",
  budget: 1600,
  unlockedExtraSlots: 0,
  maxActiveItems: 1,
  activeItemPreference: "any",
  maxTransactions: 3
};

test("Kaufzustand trennt Zahlung, Investment, Schwelle und Slotlimit", () => {
  const data = fixture();
  const first = applyPurchase(createInitialBuildState(), data.itemsById.get("component"), request, data);
  assert.equal(first.ok, true);
  assert.equal(first.state.events[0].cash_cost, 800);
  assert.equal(first.state.events[0].weapon_investment, 800);
  assert.deepEqual(first.state.events[0].thresholds_crossed, ["weapon:800"]);
  const second = applyPurchase(first.state, data.itemsById.get("irrelevant"), request, data);
  assert.deepEqual(second, { ok: false, reason: "SLOT_CAPACITY_EXCEEDED" });
});

test("Upgrade ersetzt die Komponente, rechnet nur die Differenz und zählt nicht doppelt", () => {
  const data = fixture();
  const bought = applyPurchase(createInitialBuildState(), data.itemsById.get("component"), request, data);
  const upgraded = applyUpgrade(bought.state, data.upgrades[0], request, data);
  assert.equal(upgraded.ok, true);
  assert.equal(upgraded.state.spent, 1600);
  assert.deepEqual(upgraded.state.inventory.map((item) => item.item_id), ["damage"]);
  assert.equal(upgraded.state.events[1].weapon_investment, 1600);
  assert.equal(upgraded.state.events[1].component_used, "component");
  assert.equal(upgraded.warning, "UNC-0004");
});

test("Ersetzung rechnet den verifizierten Verkaufserlös und entfernt die alte Investition", () => {
  const data = fixture();
  data.economy.sellback = { rate: 0.5 };
  data.slots.starting_slots.universal = 1;
  const bought = applyPurchase(createInitialBuildState(), data.itemsById.get("component"), request, data);
  const replaced = applyReplacement(bought.state, data.itemsById.get("component"), data.itemsById.get("damage"), { ...request, budget: 2400 }, data);
  assert.equal(replaced.ok, true);
  assert.equal(replaced.state.spent, 2000);
  assert.equal(replaced.state.events[1].sale_proceeds, 400);
  assert.deepEqual(replaced.state.inventory.map((item) => item.item_id), ["damage"]);
  assert.equal(replaced.state.events[1].weapon_investment, 1600);
});

test("Szenariomodell dokumentiert Annahmen und trennt Reload-DPS von bedingten Effekten", () => {
  const data = fixture();
  const state = applyPurchase(createInitialBuildState(), data.itemsById.get("damage"), request, data).state;
  const scenarios = evaluateCarryScenarios(state, request, data);
  assert.equal(scenarios.valid, true);
  assert.equal(scenarios.plan.scenarios.length, 4);
  assert.equal(scenarios.plan.scenarios[0].origin, "model_assumption");
  assert.ok(scenarios.common.sustained_weapon_dps < scenarios.common.damage_per_bullet * scenarios.common.rounds_per_second);
  assert.notEqual(scenarios.scenarios.find((scenario) => scenario.id === "skirmish").window_dps, scenarios.scenarios.find((scenario) => scenario.id === "teamfight").window_dps);
  const teamfight = scenarios.scenarios.find((scenario) => scenario.id === "teamfight");
  assert.ok(Number.isFinite(teamfight.survival_capacity_bullet));
  assert.ok(Number.isFinite(teamfight.survival_capacity_spirit));
  assert.equal(scenarios.common.recovery_model.short_fight_seconds, 4);
  assert.equal(scenarios.common.recovery_model.long_fight_seconds, 10);
  assert.equal(scenarios.common.recovery_model.ability_lifesteal_percent_excluded, 0);
  assert.ok(createCarryScenarioPlan().planning_budgets.some((entry) => entry.souls === 40000));
});

test("Schutz, Regeneration und Bullet-Lifesteal folgen dem offenen Kampfszenario ohne Doppelzählung", () => {
  const data = fixture();
  const evaluate = (ids) => evaluateCarryScenarios({ inventory: ids.map((id) => data.itemsById.get(id)) }, request, data);
  const baseline = evaluate([]).scenarios.find((scenario) => scenario.id === "skirmish");
  const oneResist = evaluate(["bullet_resist_a"]).scenarios.find((scenario) => scenario.id === "skirmish");
  const twoResists = evaluate(["bullet_resist_a", "bullet_resist_b"]).scenarios.find((scenario) => scenario.id === "skirmish");
  assert.equal(baseline.incoming_damage.raw, 400);
  assert.equal(oneResist.incoming_damage.bullet_after_resist, 320);
  assert.ok(Math.abs(twoResists.incoming_damage.bullet_after_resist - 224) < 1e-9);
  assert.equal(oneResist.resistance_sources.bullet.damageMultiplier, 0.8);
  assert.ok(Math.abs(twoResists.resistance_sources.bullet.damageMultiplier - 0.56) < 1e-12);

  const regen = evaluate(["regen"]);
  const regenShort = regen.scenarios.find((scenario) => scenario.id === "skirmish");
  const regenLong = regen.scenarios.find((scenario) => scenario.id === "teamfight");
  assert.equal(regenShort.recovery_health, 40);
  assert.equal(regenLong.recovery_health, 100);

  const lifesteal = evaluate(["lifesteal"]);
  const lifeShort = lifesteal.scenarios.find((scenario) => scenario.id === "skirmish");
  assert.equal(lifeShort.window_damage, 160);
  assert.equal(lifeShort.recovery_health, 16);
  assert.equal(lifeShort.survival_capacity_bullet, 816);
});

test("Einheitliche Weapon-Mechanik bildet Feuern und Reload über weaponDamage(t) ab", () => {
  const data = fixture();
  const mechanics = evaluateWeaponMechanics(createInitialBuildState(), request, data);
  assert.equal(mechanics.valid, true);
  assert.equal(mechanics.damage_per_bullet, 20);
  assert.equal(mechanics.rounds_per_second, 4);
  assert.equal(mechanics.clip_size, 8);
  assert.equal(mechanics.reload_time, 2);
  assert.equal(mechanics.damage_per_full_magazine, 160);
  assert.equal(mechanics.time_to_empty_clip, 2);
  assert.equal(mechanics.sustained_cycle_dps, 40);
  assert.equal(mechanics.firing_uptime, 0.5);
  assert.equal(mechanics.weaponDamageAt(0), 0);
  assert.equal(mechanics.weaponDamageAt(1), 80);
  assert.equal(mechanics.weaponDamageAt(2), 160);
  assert.equal(mechanics.weaponDamageAt(3), 160);
  assert.equal(mechanics.weaponDamageAt(4), 160);
  assert.equal(mechanics.weaponDamageAt(4.5), 200);
});

test("Weapon-Mechanik unterscheidet Magazin- und Reload-Charakteristiken", () => {
  const fastReloadData = fixture();
  fastReloadData.heroStats.find((entry) => entry.mechanic === "clip_size").base_value = "4";
  fastReloadData.heroStats.find((entry) => entry.mechanic === "reload_time").base_value = "1";
  const slowReloadData = fixture();
  slowReloadData.heroStats.find((entry) => entry.mechanic === "clip_size").base_value = "8";
  slowReloadData.heroStats.find((entry) => entry.mechanic === "reload_time").base_value = "3";
  const fastReload = evaluateWeaponMechanics(createInitialBuildState(), request, fastReloadData);
  const slowReload = evaluateWeaponMechanics(createInitialBuildState(), request, slowReloadData);
  assert.equal(fastReload.damage_per_full_magazine, 80);
  assert.equal(slowReload.damage_per_full_magazine, 160);
  assert.equal(fastReload.sustained_cycle_dps, 40);
  assert.equal(slowReload.sustained_cycle_dps, 32);
  assert.ok(fastReload.weaponDamageAt(1.5) < slowReload.weaponDamageAt(1.5));
});

test("Bedingte Weapon-Effekte gelangen nicht in die permanente Weapon-Baseline", () => {
  const data = fixture();
  const base = evaluateWeaponMechanics(
    { inventory: [data.itemsById.get("component")], spent: 800, activeItems: 0, events: [] },
    request,
    data
  );
  const conditional = evaluateWeaponMechanics(
    { inventory: [data.itemsById.get("active")], spent: 800, activeItems: 1, events: [] },
    request,
    data
  );
  assert.equal(conditional.rounds_per_second, base.rounds_per_second);
  assert.equal(conditional.sustained_cycle_dps, base.sustained_cycle_dps);
  assert.deepEqual(conditional.effects.evidence, []);
});

function oneItemState(item) {
  return { inventory: [item], spent: 1600, grossSpent: 1600, activeItems: 0, events: [] };
}

function crossInventoryUpgradeFixture() {
  return buildOptimizerData({
    coreManifest: { patch: "p", mode: "m" },
    heroManifest: { patch: "p", mode: "m" },
    items: [
      { item_id: "a", name: "A", category: "Weapon", tier: "1", total_cost: "800", is_public_shop_item: "true", active_type: "", confidence: "high" },
      { item_id: "b", name: "B", category: "Weapon", tier: "1", total_cost: "800", is_public_shop_item: "true", active_type: "", confidence: "high" },
      { item_id: "c", name: "C", category: "Weapon", tier: "2", total_cost: "2400", is_public_shop_item: "true", active_type: "", confidence: "high" }
    ],
    itemMechanics: [
      { item_id: "a", effect_id: "a_damage", mechanic: "base_attack_damage_percent", value: "20", unit: "percent", condition: "Immer, solange das Item gehalten wird.", confidence: "high" },
      { item_id: "b", effect_id: "b_damage", mechanic: "base_attack_damage_percent", value: "10", unit: "percent", condition: "Immer, solange das Item gehalten wird.", confidence: "high" },
      { item_id: "c", effect_id: "c_damage", mechanic: "base_attack_damage_percent", value: "200", unit: "percent", condition: "Immer, solange das Item gehalten wird.", confidence: "high" }
    ],
    upgrades: [{ from_item_id: "b", to_item_id: "c", additional_cost: "800", notes: "", confidence: "high" }],
    heroStats: [
      { hero_id: "hero", stat_group: "weapon", mechanic: "dps", base_value: "100", confidence: "high" },
      { hero_id: "hero", stat_group: "weapon", mechanic: "bullet_damage", base_value: "20", confidence: "high" },
      { hero_id: "hero", stat_group: "weapon", mechanic: "rounds_per_second", base_value: "4", confidence: "high" },
      { hero_id: "hero", stat_group: "ammo", mechanic: "clip_size", base_value: "8", confidence: "high" },
      { hero_id: "hero", stat_group: "reload", mechanic: "reload_time", base_value: "2", confidence: "high" },
      { hero_id: "hero", stat_group: "health", mechanic: "max_health", base_value: "800", confidence: "high" }
    ],
    economy: { investment_thresholds: [], sellback: { rate: 0.5 } },
    slots: { starting_slots: { universal: 1 }, unlocks: [], active_item_limit: 1 }
  });
}

test("Weapon-Frontier behält kurzfristig stärkeren und nachhaltig stärkeren Pfad", () => {
  const data = fixture();
  const burst = oneItemState(data.itemsById.get("burst"));
  const sustained = oneItemState(data.itemsById.get("sustained"));
  const burstMechanics = evaluateWeaponMechanics(burst, request, data);
  const sustainedMechanics = evaluateWeaponMechanics(sustained, request, data);
  assert.ok(burstMechanics.weaponDamageAt(0.5) > sustainedMechanics.weaponDamageAt(0.5));
  assert.ok(sustainedMechanics.sustained_cycle_dps > burstMechanics.sustained_cycle_dps);
  const retained = rankedCarryStates([burst, sustained], request, data, 2);
  assert.deepEqual(new Set(retained.map((candidate) => candidate.state.inventory[0].item_id)), new Set(["burst", "sustained"]));
});

test("Weapon-Frontier behält unterschiedliche Inventare trotz eindeutiger momentaner Überlegenheit", () => {
  const data = fixture();
  const burst = oneItemState(data.itemsById.get("burst"));
  const superior = oneItemState(data.itemsById.get("superior"));
  const retained = rankedCarryStates([burst, superior], request, data, 2);
  assert.deepEqual(new Set(retained.map((candidate) => candidate.state.inventory[0].item_id)), new Set(["burst", "superior"]));
});

test("Sustained Cycle DPS allein eliminiert keinen echten Weapon-Trade-off", () => {
  const data = fixture();
  const burst = oneItemState(data.itemsById.get("burst"));
  const sustained = oneItemState(data.itemsById.get("sustained"));
  const retained = rankedCarryStates([burst, sustained], request, data, 2);
  const byId = new Map(retained.map((candidate) => [candidate.state.inventory[0].item_id, candidate]));
  assert.ok(byId.get("sustained").evaluation.scenarios.common.sustained_weapon_dps > byId.get("burst").evaluation.scenarios.common.sustained_weapon_dps);
  assert.equal(byId.size, 2);
});

test("Nicht dominierte vollständige Pfade erhalten Replacement-Suche unabhängig vom Präferenzscore", () => {
  const data = fixture();
  for (const item of data.items) item.is_public_shop_item = "false";
  for (const itemId of ["burst", "sustained", "superior"]) data.itemsById.get(itemId).is_public_shop_item = "true";
  const sustained = oneItemState(data.itemsById.get("sustained"));
  const superior = oneItemState(data.itemsById.get("superior"));
  const sustainedDecision = evaluateCarryDecision({
    state: sustained,
    evaluation: { scenarios: evaluateCarryScenarios(sustained, request, data), foundations: { checkpoints: [] } }
  }, request, data);
  const superiorDecision = evaluateCarryDecision({
    state: superior,
    evaluation: { scenarios: evaluateCarryScenarios(superior, request, data), foundations: { checkpoints: [] } }
  }, request, data);
  assert.ok(sustainedDecision.robust_score < superiorDecision.robust_score);

  const result = optimizeWeaponCarryFullBuild({ ...request, budget: 1600, maxTransactions: 1 }, data);
  assert.equal(result.searchLimits.replacement_seed_paths, 3);
  assert.ok(result.searchLimits.replacement_seed_path_keys.some((key) => key.includes("sustained")));
  assert.ok(result.searchLimits.replacement_seed_path_keys.some((key) => key.includes("superior")));
  assert.ok(result.searchLimits.replacement_seed_path_keys.some((key) => key.includes("burst")));
});

test("Cross-Inventory-Pareto bewahrt den einzigen späteren Upgrade-Pfad in der vollständigen Weapon-Carry-Suche", () => {
  const data = crossInventoryUpgradeFixture();
  const searchRequest = { heroId: "hero", objective: "weapon_magazine_dps", budget: 1600 };
  const initial = createInitialBuildState();
  const a = applyPurchase(initial, data.itemsById.get("a"), searchRequest, data).state;
  const b = applyPurchase(initial, data.itemsById.get("b"), searchRequest, data).state;

  const c = applyUpgrade(b, data.upgrades[0], searchRequest, data);
  assert.equal(c.ok, true, "B besitzt die einzige legale Fortsetzung zu C");
  assert.equal(c.state.spent, 1600);
  assert.ok(
    evaluateCarryScenarios(c.state, searchRequest, data).common.sustained_weapon_dps >
      evaluateCarryScenarios(a, searchRequest, data).common.sustained_weapon_dps,
    "C ist bei dem späteren Budget besser als A"
  );

  const firstFrontier = rankedCarryStates([a, b], searchRequest, data, 30);
  assert.deepEqual(new Set(firstFrontier.map((candidate) => candidate.state.inventory[0].item_id)), new Set(["a", "b"]));

  const result = optimizeWeaponCarryFullBuild(searchRequest, data);
  const returnedPaths = [result.winner, ...result.alternatives]
    .map((candidate) => candidate.state.inventory.map((item) => item.item_id).join("|"));
  assert.equal(result.status, "PASS_WITH_WARNINGS");
  assert.ok(returnedPaths.includes("c"));
  assert.equal(result.winner.state.inventory[0].item_id, "c");
});

test("Wirkungsmodell zählt Spirit-Feuerrate nicht zusätzlich als unabhängigen DPS", () => {
  const data = fixture();
  const state = { inventory: [data.itemsById.get("spirit")], spent: 800, activeItems: 0, events: [] };
  const scenarios = evaluateCarryScenarios(state, request, data);
  const expectedRoundsPerSecond = 4 + (10 + 7) * 0.1;
  const expectedDps = (8 * 20) / (8 / expectedRoundsPerSecond + 2);
  assert.equal(scenarios.common.rounds_per_second, expectedRoundsPerSecond);
  assert.equal(scenarios.common.sustained_weapon_dps, expectedDps);
  assert.ok(!JSON.stringify(scenarios.common).includes("sustained_dps_spirit_scaling"));
  assert.equal(evaluateWeaponState(state, request, data).finalDps, expectedDps);
});

test("Wirkungsmodell stapelt permanente Resistenzen multiplikativ", () => {
  const data = fixture();
  const state = {
    inventory: [data.itemsById.get("bullet_resist_a"), data.itemsById.get("bullet_resist_b")],
    spent: 1600,
    activeItems: 0,
    events: []
  };
  const scenarios = evaluateCarryScenarios(state, request, data);
  assert.ok(Math.abs(scenarios.common.bullet_resist - 44) < 1e-9);
  assert.ok(Math.abs(scenarios.common.effective_health_bullet - 872 / 0.56) < 1e-9);
  assert.equal(scenarios.common.resistance_sources.bullet.stacking_rule.rule_id, "RES-002");
});

test("Gleiches Inventar behält unterschiedliche Kaufgeschichten", () => {
  const data = fixture();
  const direct = {
    state: {
      inventory: [data.itemsById.get("damage")], spent: 1600, activeItems: 0,
      events: [{ purchase_type: "purchase", item_id: "damage", item: data.itemsById.get("damage"), total_spent: 1600 }]
    }
  };
  const viaComponent = {
    state: {
      inventory: [data.itemsById.get("damage")], spent: 1600, activeItems: 0,
      events: [
        { purchase_type: "purchase", item_id: "component", item: data.itemsById.get("component"), total_spent: 800 },
        { purchase_type: "upgrade", item_id: "damage", item: data.itemsById.get("damage"), total_spent: 1600 }
      ]
    }
  };
  const retained = retainDistinctPurchaseHistories([direct, viaComponent]);
  assert.equal(retained.length, 2);
  assert.deepEqual(retained.map((candidate) => candidate.state.inventory.map((item) => item.item_id)), [["damage"], ["damage"]]);
  assert.notEqual(retained[0].state.events.length, retained[1].state.events.length);
});

test("Trajektorien-Cache trennt Kauf- und Replacement-Historie bei gleichem Item und Soul-Stand", () => {
  const data = fixture();
  const spirit = data.itemsById.get("spirit");
  const damage = data.itemsById.get("damage");
  const purchasePath = {
    inventory: [spirit, damage], spent: 3200, activeItems: 0,
    events: [
      { purchase_type: "purchase", item_id: "spirit", item: spirit, total_spent: 800 },
      { purchase_type: "purchase", item_id: "damage", item: damage, total_spent: 3200 }
    ]
  };
  const replacementPath = {
    inventory: [damage], spent: 3200, activeItems: 0,
    events: [
      { purchase_type: "purchase", item_id: "spirit", item: spirit, total_spent: 800 },
      { purchase_type: "replacement", item_id: "damage", item: damage, total_spent: 3200, upgradeFrom: spirit, replaces_item_id: "spirit" }
    ]
  };
  const trajectoryRequest = { ...request, budget: 3200 };
  const purchaseTrajectory = buildPathTrajectory(purchasePath, trajectoryRequest, data);
  const replacementTrajectory = buildPathTrajectory(replacementPath, trajectoryRequest, data);

  assert.notStrictEqual(purchaseTrajectory, replacementTrajectory);
  assert.deepEqual(purchaseTrajectory.checkpoints[0].inventory, ["spirit", "damage"]);
  assert.deepEqual(replacementTrajectory.checkpoints[0].inventory, ["damage"]);
  assert.strictEqual(buildPathTrajectory(purchasePath, trajectoryRequest, data), purchaseTrajectory);
});

test("Fehlende Frühbasis verwirft einen sonst legalen Suchzustand nicht automatisch", () => {
  const data = fixture();
  const weakState = {
    inventory: [data.itemsById.get("damage")], spent: 7200, activeItems: 0,
    events: [{ purchase_type: "purchase", item_id: "damage", item: data.itemsById.get("damage"), total_spent: 7200, thresholds_crossed: [] }]
  };
  const retained = rankedCarryStates([weakState], { ...request, budget: 7200, robustStandard: true }, data, 3);
  assert.equal(retained.length, 1);
  assert.equal(retained[0].evaluation.foundations.passed, false);
});

test("Carry-Auswahl lässt marginalen Schaden nicht automatisch über deutlich höhere EHP gewinnen", () => {
  const data = fixture();
  const damageState = { inventory: [data.itemsById.get("damage")], spent: 1600, activeItems: 0, events: [] };
  const saferState = {
    inventory: [data.itemsById.get("bullet_resist_a"), data.itemsById.get("bullet_resist_b")],
    spent: 1600, activeItems: 0, events: []
  };
  const damageScenario = evaluateCarryScenarios(damageState, request, data);
  const saferScenario = evaluateCarryScenarios(saferState, request, data);
  const damageDecision = evaluateCarryDecision({ state: damageState, evaluation: { scenarios: damageScenario, foundations: { checkpoints: [] } } }, request, data);
  const saferDecision = evaluateCarryDecision({ state: saferState, evaluation: { scenarios: saferScenario, foundations: { checkpoints: [] } } }, request, data);
  assert.ok(damageScenario.common.sustained_weapon_dps > saferScenario.common.sustained_weapon_dps);
  assert.ok(saferScenario.common.effective_health_bullet > damageScenario.common.effective_health_bullet);
  assert.ok(saferDecision.robust_score > damageDecision.robust_score);
  assert.equal(damageDecision.profiles.length, 3);
});

test("Eignungsfilter verwirft irrelevante Items und respektiert die Active-Vorgabe", () => {
  const data = fixture();
  assert.deepEqual(assessWeaponItem(data.itemsById.get("irrelevant"), data, request), { eligible: false, reason: "NO_SUPPORTED_WEAPON_CONTRIBUTION" });
  assert.equal(assessWeaponItem(data.itemsById.get("component"), data, request).componentOnly, true);
  assert.deepEqual(assessWeaponItem(data.itemsById.get("active"), data, { ...request, activeItemPreference: "none" }), { eligible: false, reason: "ACTIVE_ITEMS_DISABLED" });
});

test("Weapon-Slice bewertet nur dauerhaft verfügbare, belegte Weapon-Effekte", () => {
  const data = fixture();
  const state = applyPurchase(createInitialBuildState(), data.itemsById.get("damage"), request, data).state;
  const evaluation = evaluateWeaponState(state, request, data);
  assert.equal(evaluation.valid, true);
  assert.ok(Math.abs(evaluation.finalDps - (206.4 / (8 / 4.4 + 2))) < 1e-9);
  const result = optimizeWeaponCarry(request, data);
  assert.equal(result.resultLabel, "best_evaluated");
  assert.ok(Math.abs(result.winner.evaluation.finalDps - (206.4 / (8 / 4.4 + 2))) < 1e-9);
  assert.equal(result.winner.state.inventory[0].item_id, "damage");
});

test("Warden-Standardpfad endet mit 12 legalen, ausgewogenen Slots", () => {
  const json = (path) => JSON.parse(readFileSync(path, "utf8"));
  const csv = (path) => parseCsv(readFileSync(path, "utf8"));
  const data = buildOptimizerData({
    coreManifest: json("data/core/manifest.json"),
    heroManifest: json("data/heroes/manifest.json"),
    items: csv("data/core/items.csv"),
    itemMechanics: csv("data/core/item_mechanics.csv"),
    upgrades: csv("data/core/item_upgrades.csv"),
    abilities: csv("data/heroes/abilities.csv"),
    abilityMechanics: csv("data/heroes/ability_mechanics.csv"),
    heroStats: csv("data/heroes/hero_stats.csv"),
    economy: json("data/core/economy.json"),
    slots: json("data/core/slots.json")
  });
  const result = optimizeWeaponCarryFullBuild({ heroId: "warden", objective: "weapon_magazine_dps", maxTransactions: 28 }, data);
  assert.equal(result.status, "PASS_WITH_WARNINGS");
  assert.deepEqual(result.budgetSensitivity.map((entry) => entry.budget), [35000, 40000, 45000, 60000]);
  assert.equal(result.searchLimits.replacement_depth, 1);
  assert.ok(result.searchLimits.replacement_seed_paths >= 1);
  assert.ok(result.searchLimits.final_non_dominated_paths >= 1);
  assert.equal(result.winner.state.inventory.length, 12);
  assert.equal(result.winner.evaluation.heroProfile.reviewStatus, "reviewed_first_slice");
  assert.equal(buildHeroCapabilityProfile("warden", data).hasSpiritWeaponScaling, true);
  assert.equal(buildHeroCapabilityProfile("warden", data).hasChargedAbility, false);
  assert.equal(buildHeroCapabilityProfile("warden", data).weaponGeometry.projectileSpeed, 290);
  assert.ok(buildHeroCapabilityProfile("warden", data).kitCoverage.control.some((entry) => entry.ability_id === "warden_binding_word"));
  assert.ok(result.winner.evaluation.capabilities.coverageCount >= 3);
  assert.ok(result.winner.evaluation.pathMilestones.majorThreshold !== null);
  assert.ok(result.winner.evaluation.pathMilestones.primaryItem !== null);
  assert.ok(result.winner.evaluation.pathMilestones.primaryMajorThreshold !== null);
  assert.equal(result.winner.evaluation.calculationScope, "identisch_mit_carry_scenarios");
  assert.equal(result.winner.evaluation.capabilities.riskCount, 0);
  assert.equal(result.winner.evaluation.upgradeFamilyOverlapCount, 0);
  assert.ok(result.winner.evaluation.pathMilestones.majorThresholds.weapon === null || result.winner.evaluation.pathMilestones.majorThresholdSouls.weapon !== null);
  assert.ok(result.winner.evaluation.pathMilestones.majorThresholds.vitality === null || result.winner.evaluation.pathMilestones.majorThresholdSouls.vitality !== null);
  assert.deepEqual(result.winner.evaluation.combatCheckpoints.map((checkpoint) => checkpoint.budget), [3200, 4800]);
  assert.equal(result.winner.evaluation.combatCheckpoints[0].weaponOperation, true);
  assert.ok(Number.isFinite(result.winner.evaluation.combatCheckpoints[0].finalDps));
  assert.equal(result.winner.evaluation.scenarios.valid, true);
  assert.equal(result.winner.evaluation.scenarios.plan.conditional_effect_policy.value, "excluded_from_baseline");
  assert.ok(result.winner.evaluation.scenarios.common.hero_active_effects.some((effect) => effect.ability_id === "warden_binding_word"));
  assert.ok(result.winner.evaluation.scenarios.common.recovery_model.treatment.includes("permanente"));
  assert.deepEqual(result.winner.evaluation.trajectory.checkpoints.slice(0, 5).map((entry) => entry.budget), [3200, 4800, 7200, 12000, 20000]);
  assert.ok(result.winner.evaluation.trajectory.checkpoints.every((entry) => entry.budget <= result.winner.state.spent));
  assert.equal(typeof result.winner.evaluation.foundations.passed, "boolean");
  assert.equal(result.winner.evaluation.carryDecision.method, "dimensionsloser_gewichteter_geometrischer_vergleich");
  assert.equal(
    assessWeaponCarryItem(data.itemsById.get("upgrade_rechargingbullets"), data, { heroId: "warden", objective: "weapon_magazine_dps" }).reason,
    "HERO_HAS_NO_CHARGED_ABILITY"
  );

  const glassCannon = evaluateItemCapabilities(data.itemsById.get("upgrade_glass_cannon"), data, result.winner.evaluation.heroProfile);
  const slowingHex = evaluateItemCapabilities(data.itemsById.get("upgrade_containment"), data, result.winner.evaluation.heroProfile);
  const restorativeShot = evaluateItemCapabilities(data.itemsById.get("upgrade_medic_bullets"), data, result.winner.evaluation.heroProfile);
  const sprintBoots = evaluateItemCapabilities(data.itemsById.get("upgrade_sprint_booster"), data, result.winner.evaluation.heroProfile);
  const activeReload = evaluateItemCapabilities(data.itemsById.get("upgrade_active_reload"), data, result.winner.evaluation.heroProfile);
  const kineticDash = evaluateItemCapabilities(data.itemsById.get("upgrade_kinetic_sash"), data, result.winner.evaluation.heroProfile);
  const healingTempo = evaluateItemCapabilities(data.itemsById.get("upgrade_healbuff"), data, result.winner.evaluation.heroProfile);
  const boundlessSpirit = evaluateItemCapabilities(data.itemsById.get("upgrade_boundless_spirit"), data, result.winner.evaluation.heroProfile);
  const sharpshooter = evaluateItemCapabilities(data.itemsById.get("upgrade_sharpshooter"), data, result.winner.evaluation.heroProfile);
  assert.ok(glassCannon.risks.some((risk) => risk.mechanic === "max_health_loss_percent"));
  assert.equal(slowingHex.directAccess, true);
  assert.equal(restorativeShot.coverageByAvailability.sustain.conditional, true);
  assert.deepEqual(restorativeShot.sustain.laneHealing, { heroHit: 0, npcHit: 0 });
  assert.deepEqual(restorativeShot.sustainByAvailability.conditional.laneHealing, { heroHit: 50, npcHit: 20 });
  assert.equal(sprintBoots.sustain.regeneration.outOfCombatHealthPerSecond, 2);
  assert.equal(sprintBoots.mobility.sprintSpeed, 2);
  assert.equal(activeReload.permanent.bulletLifesteal, 0);
  assert.equal(activeReload.permanent.moveSpeed, 0);
  assert.equal(activeReload.sources.find((source) => source.mechanic === "bonus_fire_rate").availability, "conditional");
  assert.equal(kineticDash.sources.find((source) => source.mechanic === "bonus_fire_rate").availability, "conditional");
  assert.equal(kineticDash.sources.find((source) => source.mechanic === "bonus_clip_size").availability, "conditional");
  assert.equal(healingTempo.permanent.moveSpeed, 0);
  assert.equal(healingTempo.mobility.combatMoveSpeed, 0);
  assert.equal(healingTempo.sources.find((source) => source.mechanic === "bonus_fire_rate").availability, "conditional");
  assert.equal(healingTempo.sources.find((source) => source.mechanic === "bonus_move_speed").availability, "conditional");
  assert.ok(boundlessSpirit.synergies.some((entry) => entry.kind === "spirit_weapon_scaling" && entry.treatment === "included_in_weapon_calculation"));
  assert.ok(sharpshooter.synergies.some((entry) => entry.kind === "weapon_or_ability_range"));
  assert.ok(sharpshooter.synergies.some((entry) => entry.kind === "distance_conditional_weapon_effect" && entry.treatment === "documented_without_position_assumption"));
});

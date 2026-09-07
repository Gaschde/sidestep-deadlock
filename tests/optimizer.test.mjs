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
  createInitialBuildState,
  createCarryScenarioPlan,
  evaluateCarryDecision,
  evaluateCarryScenarios,
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
    { item_id: "active", name: "Aktiv", category: "Weapon", tier: "1", total_cost: "800", is_public_shop_item: "true", active_type: "InstantCast", confidence: "high" },
    { item_id: "irrelevant", name: "Ohne Weapon-Wert", category: "Vitality", tier: "1", total_cost: "800", is_public_shop_item: "true", active_type: "", confidence: "high" },
    { item_id: "spirit", name: "Spirit", category: "Spirit", tier: "1", total_cost: "800", is_public_shop_item: "true", active_type: "", confidence: "high" },
    { item_id: "bullet_resist_a", name: "Bullet Resist A", category: "Vitality", tier: "1", total_cost: "800", is_public_shop_item: "true", active_type: "", confidence: "high" },
    { item_id: "bullet_resist_b", name: "Bullet Resist B", category: "Vitality", tier: "1", total_cost: "800", is_public_shop_item: "true", active_type: "", confidence: "high" }
  ];
  return buildOptimizerData({
    coreManifest: { patch: "p", mode: "m" },
    heroManifest: { patch: "p", mode: "m" },
    items,
    itemMechanics: [
      { item_id: "damage", effect_id: "damage_pct", mechanic: "base_attack_damage_percent", value: "20", unit: "percent", condition: "Immer, solange das Item gehalten wird.", confidence: "high" },
      { item_id: "damage", effect_id: "fire_rate", mechanic: "bonus_fire_rate", value: "10", unit: "percent", condition: "Immer, solange das Item gehalten wird.", confidence: "high" },
      { item_id: "active", effect_id: "active_rate", mechanic: "bonus_fire_rate", value: "5", unit: "percent", condition: "Immer, solange das Item gehalten wird.", confidence: "high" },
      { item_id: "irrelevant", effect_id: "health", mechanic: "bonus_health", value: "300", unit: "hp", condition: "Immer, solange das Item gehalten wird.", confidence: "high" },
      { item_id: "spirit", effect_id: "spirit_power", mechanic: "tech_power", value: "10", unit: "spirit_power", condition: "Immer, solange das Item gehalten wird.", confidence: "high" },
      { item_id: "bullet_resist_a", effect_id: "resist_a", mechanic: "bullet_resist", value: "20", unit: "percent", condition: "Immer, solange das Item gehalten wird.", confidence: "high" },
      { item_id: "bullet_resist_b", effect_id: "resist_b", mechanic: "bullet_resist", value: "30", unit: "percent", condition: "Immer, solange das Item gehalten wird.", confidence: "high" }
    ],
    upgrades: [{ from_item_id: "component", to_item_id: "damage", additional_cost: "800", notes: "", confidence: "high" }],
    heroStats: [
      { hero_id: "hero", stat_group: "weapon", mechanic: "dps", base_value: "100", confidence: "high" },
      { hero_id: "hero", stat_group: "weapon", mechanic: "bullet_damage", base_value: "20", confidence: "high" },
      { hero_id: "hero", stat_group: "weapon", mechanic: "rounds_per_second", base_value: "4", confidence: "high" },
      { hero_id: "hero", stat_group: "ammo", mechanic: "clip_size", base_value: "8", confidence: "high" },
      { hero_id: "hero", stat_group: "reload", mechanic: "reload_time", base_value: "2", confidence: "high" },
      { hero_id: "hero", stat_group: "health", mechanic: "max_health", base_value: "800", confidence: "high" },
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
  assert.ok(createCarryScenarioPlan().planning_budgets.some((entry) => entry.souls === 40000));
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

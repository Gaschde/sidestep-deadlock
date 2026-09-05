import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyPurchase,
  applyUpgrade,
  assessWeaponItem,
  buildOptimizerData,
  createInitialBuildState,
  evaluateWeaponState,
  optimizeWeaponCarry,
  optimizeWeaponCarryFullBuild
} from "../app/optimizer.mjs";
import { buildHeroCapabilityProfile, evaluateItemCapabilities } from "../app/capabilities.mjs";
import { parseCsv } from "../app/lib.mjs";

function fixture() {
  const items = [
    { item_id: "component", name: "Komponente", category: "Weapon", tier: "1", total_cost: "800", is_public_shop_item: "true", active_type: "", confidence: "high" },
    { item_id: "damage", name: "Schaden", category: "Weapon", tier: "2", total_cost: "1600", is_public_shop_item: "true", active_type: "", confidence: "high" },
    { item_id: "active", name: "Aktiv", category: "Weapon", tier: "1", total_cost: "800", is_public_shop_item: "true", active_type: "InstantCast", confidence: "high" },
    { item_id: "irrelevant", name: "Ohne Weapon-Wert", category: "Vitality", tier: "1", total_cost: "800", is_public_shop_item: "true", active_type: "", confidence: "high" }
  ];
  return buildOptimizerData({
    coreManifest: { patch: "p", mode: "m" },
    heroManifest: { patch: "p", mode: "m" },
    items,
    itemMechanics: [
      { item_id: "damage", effect_id: "damage_pct", mechanic: "base_attack_damage_percent", value: "20", unit: "percent", condition: "Immer, solange das Item gehalten wird.", confidence: "high" },
      { item_id: "damage", effect_id: "fire_rate", mechanic: "bonus_fire_rate", value: "10", unit: "percent", condition: "Immer, solange das Item gehalten wird.", confidence: "high" },
      { item_id: "active", effect_id: "active_rate", mechanic: "bonus_fire_rate", value: "5", unit: "percent", condition: "Immer, solange das Item gehalten wird.", confidence: "high" },
      { item_id: "irrelevant", effect_id: "health", mechanic: "bonus_health", value: "300", unit: "hp", condition: "Immer, solange das Item gehalten wird.", confidence: "high" }
    ],
    upgrades: [{ from_item_id: "component", to_item_id: "damage", additional_cost: "800", notes: "", confidence: "high" }],
    heroStats: [{ hero_id: "hero", stat_group: "weapon", mechanic: "dps", base_value: "100" }],
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
  assert.equal(evaluation.finalDps, 141.9);
  const result = optimizeWeaponCarry(request, data);
  assert.equal(result.resultLabel, "best_evaluated");
  assert.equal(result.winner.evaluation.finalDps, 141.9);
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
  const result = optimizeWeaponCarryFullBuild({ heroId: "warden", objective: "weapon_magazine_dps", maxTransactions: 20 }, data);
  assert.equal(result.status, "PASS_WITH_WARNINGS");
  assert.equal(result.winner.state.inventory.length, 12);
  assert.equal(result.winner.evaluation.heroProfile.reviewStatus, "reviewed_first_slice");
  assert.equal(buildHeroCapabilityProfile("warden", data).hasSpiritWeaponScaling, true);
  assert.ok(result.winner.evaluation.capabilities.coverageCount >= 3);
  assert.ok(result.winner.evaluation.pathMilestones.majorThreshold !== null);
  assert.ok(result.winner.evaluation.pathMilestones.primaryItem !== null);
  assert.ok(result.winner.evaluation.pathMilestones.primaryMajorThreshold !== null);
  assert.ok(result.winner.evaluation.spiritDpsBonus > 0);
  assert.equal(result.winner.evaluation.capabilities.riskCount, 0);
  assert.equal(result.winner.evaluation.upgradeFamilyOverlapCount, 0);
  assert.notEqual(result.winner.evaluation.pathMilestones.majorThresholdSouls.weapon, null);
  assert.notEqual(result.winner.evaluation.pathMilestones.majorThresholdSouls.vitality, null);
  assert.deepEqual(result.winner.evaluation.combatCheckpoints.map((checkpoint) => checkpoint.budget), [3200, 4800]);
  assert.equal(result.winner.evaluation.combatCheckpoints[0].weaponOperation, true);
  assert.equal(result.winner.evaluation.combatCheckpoints[0].protectionPresent, true);
  assert.ok(result.winner.evaluation.combatCheckpoints[0].reliableSustainSources >= 1);

  const glassCannon = evaluateItemCapabilities(data.itemsById.get("upgrade_glass_cannon"), data, result.winner.evaluation.heroProfile);
  const slowingHex = evaluateItemCapabilities(data.itemsById.get("upgrade_containment"), data, result.winner.evaluation.heroProfile);
  const restorativeShot = evaluateItemCapabilities(data.itemsById.get("upgrade_medic_bullets"), data, result.winner.evaluation.heroProfile);
  const sprintBoots = evaluateItemCapabilities(data.itemsById.get("upgrade_sprint_booster"), data, result.winner.evaluation.heroProfile);
  const activeReload = evaluateItemCapabilities(data.itemsById.get("upgrade_active_reload"), data, result.winner.evaluation.heroProfile);
  const kineticDash = evaluateItemCapabilities(data.itemsById.get("upgrade_kinetic_sash"), data, result.winner.evaluation.heroProfile);
  const healingTempo = evaluateItemCapabilities(data.itemsById.get("upgrade_healbuff"), data, result.winner.evaluation.heroProfile);
  assert.ok(glassCannon.risks.some((risk) => risk.mechanic === "max_health_loss_percent"));
  assert.equal(slowingHex.directAccess, true);
  assert.equal(restorativeShot.coverageByAvailability.sustain.conditional, true);
  assert.deepEqual(restorativeShot.sustain.laneHealing, { heroHit: 50, npcHit: 20 });
  assert.equal(sprintBoots.sustain.regeneration.outOfCombatHealthPerSecond, 2);
  assert.equal(sprintBoots.mobility.sprintSpeed, 2);
  assert.equal(activeReload.permanent.bulletLifesteal, 0);
  assert.equal(activeReload.permanent.moveSpeed, 0);
  assert.equal(activeReload.sources.find((source) => source.mechanic === "bonus_fire_rate").availability, "conditional");
  assert.equal(kineticDash.sources.find((source) => source.mechanic === "bonus_fire_rate").availability, "conditional");
  assert.equal(kineticDash.sources.find((source) => source.mechanic === "bonus_clip_size").availability, "conditional");
  assert.equal(healingTempo.permanent.moveSpeed, 0);
  assert.equal(healingTempo.sources.find((source) => source.mechanic === "bonus_fire_rate").availability, "conditional");
  assert.equal(healingTempo.sources.find((source) => source.mechanic === "bonus_move_speed").availability, "conditional");
});

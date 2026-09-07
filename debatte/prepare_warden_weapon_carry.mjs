import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseCsv } from "../app/lib.mjs";
import { buildOptimizerData, optimizeWeaponCarryFullBuild } from "../app/optimizer.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const json = async (path) => JSON.parse(await readFile(resolve(ROOT, path), "utf8"));
const csv = async (path) => parseCsv(await readFile(resolve(ROOT, path), "utf8"));

function compactEvent(event) {
  return {
    step: event.step,
    item_id: event.item_id,
    item_name: event.item_name,
    purchase_type: event.purchase_type,
    component_used: event.component_used,
    cash_cost: event.cash_cost,
    total_spent: event.total_spent,
    weapon_investment: event.weapon_investment,
    vitality_investment: event.vitality_investment,
    spirit_investment: event.spirit_investment,
    normal_slots_used: event.normal_slots_used,
    active_slots_used: event.active_slots_used,
    replaces_item_id: event.replaces_item_id
  };
}

function pick(row, fields) {
  return Object.fromEntries(fields
    .filter((field) => row[field] !== undefined && row[field] !== "")
    .map((field) => [field, typeof row[field] === "string" && row[field].length > 240 ? `${row[field].slice(0, 237)}...` : row[field]]));
}

const [coreManifest, heroManifest, economy, slots, items, itemMechanics, upgrades, heroes, heroStats, abilities, abilityMechanics, interactions] = await Promise.all([
  json("data/core/manifest.json"),
  json("data/heroes/manifest.json"),
  json("data/core/economy.json"),
  json("data/core/slots.json"),
  csv("data/core/items.csv"),
  csv("data/core/item_mechanics.csv"),
  csv("data/core/item_upgrades.csv"),
  csv("data/heroes/heroes.csv"),
  csv("data/heroes/hero_stats.csv"),
  csv("data/heroes/abilities.csv"),
  csv("data/heroes/ability_mechanics.csv"),
  csv("data/interactions/hero_interactions.csv")
]);

const data = buildOptimizerData({
  coreManifest,
  heroManifest,
  economy,
  slots,
  items,
  itemMechanics,
  upgrades,
  heroStats,
  abilities,
  abilityMechanics
});
const result = optimizeWeaponCarryFullBuild({ heroId: "warden", objective: "weapon_magazine_dps", maxTransactions: 28 }, data);
if (result.status === "FAIL") throw new Error(result.reason);

const candidatePaths = [result.winner, ...result.alternatives].map((candidate) => candidate.state.events);
const candidateIds = new Set(candidatePaths.flat().map((event) => event.item_id));
const input = {
  buildRequest: {
    hero_id: "warden",
    objective: "weapon_magazine_dps mit robustem, legalem Kaufpfad bis 60000 Souls",
    budget: result.request.budget,
    budget_checkpoints: [3200, 4800, 60000],
    risk_preference: "robust",
    minimum_requirements: {
      final_weapon_slots: 5,
      final_vitality_slots: 3,
      reliable_sustain_source: 1,
      direct_access_support: 1
    },
    constraints: [
      "Nur die mitgelieferten IDs, Kosten, Mechaniken und Interaktionen verwenden.",
      "Bedingte Effekte ohne verifizierte Uptime nicht als dauerhaft bewerten.",
      "Kosten, Investment und Upgradezahlung getrennt halten.",
      "Das Ergebnis darf nur bester_gepruefter_build heißen; der Suchraum ist begrenzt."
    ]
  },
  verifiedData: {
    manifests: { core: coreManifest, heroes: heroManifest },
    economy_and_slots: { economy, slots },
    hero: {
      record: heroes.filter((row) => row.hero_id === "warden").map((row) => pick(row, ["hero_id", "name", "confidence"])),
      stats: heroStats.filter((row) => row.hero_id === "warden").map((row) => pick(row, ["hero_id", "stat_group", "mechanic", "base_value", "growth_per_level", "unit", "condition", "formula", "confidence"])),
      abilities_out_of_scope: abilities.filter((row) => row.hero_id === "warden").map((row) => pick(row, ["ability_id", "name", "confidence"])),
      note: "Skills und bedingte Fähigkeits-Uptime sind nicht Teil dieses Kaufpfad-Slices."
    },
    candidate_items: items.filter((row) => candidateIds.has(row.item_id)).map((row) => pick(row, ["item_id", "name", "category", "tier", "total_cost", "active_type", "active_cooldown", "confidence"])),
    candidate_item_mechanics: itemMechanics.filter((row) => candidateIds.has(row.item_id)).map((row) => pick(row, ["item_id", "effect_id", "mechanic", "value", "unit", "condition", "trigger", "availability", "confidence"])),
    candidate_upgrades: upgrades.filter((row) => candidateIds.has(row.from_item_id) || candidateIds.has(row.to_item_id)).map((row) => pick(row, ["from_item_id", "to_item_id", "additional_cost", "confidence"])),
    warden_interactions: interactions.filter((row) => Object.values(row).some((value) => String(value).includes("warden"))).map((row) => pick(row, ["hero_id", "ability_id", "item_id", "interaction", "effect", "condition", "confidence"])),
    limitations: result.validation.warnings
  },
  candidateBuild: {
    summary: result.scope,
    validation: result.validation,
    purchaseOrder: result.winner.state.events.map(compactEvent),
    alternatives: result.alternatives.map((candidate) => {
      const finalEvent = candidate.state.events.at(-1);
      return {
        final_items: candidate.state.inventory.map((item) => item.item_id),
        total_spent: finalEvent.total_spent,
        weapon_investment: finalEvent.weapon_investment,
        vitality_investment: finalEvent.vitality_investment,
        spirit_investment: finalEvent.spirit_investment
      };
    })
  }
};

const output = resolve(import.meta.dirname, "warden-weapon-carry.json");
await writeFile(output, `${JSON.stringify(input, null, 2)}\n`);
console.log(`Erstellt: ${output}`);

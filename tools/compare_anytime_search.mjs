import { readFileSync } from "node:fs";
import { parseCsv } from "../app/lib.mjs";
import { buildOptimizerData } from "../app/optimizer.mjs";
import { runAnytimeWarden } from "../app/anytime-search.mjs";

const json = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const csv = (path) => parseCsv(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const data = buildOptimizerData({
  coreManifest: json("data/core/manifest.json"), heroManifest: json("data/heroes/manifest.json"),
  items: csv("data/core/items.csv"), itemMechanics: csv("data/core/item_mechanics.csv"),
  upgrades: csv("data/core/item_upgrades.csv"), economy: json("data/core/economy.json"), slots: json("data/core/slots.json"),
  heroStats: csv("data/heroes/hero_stats.csv"), abilities: csv("data/heroes/abilities.csv"),
  abilityMechanics: csv("data/heroes/ability_mechanics.csv"), heroResources: csv("data/heroes/hero_resources.csv")
});
const budget = 60000;
const timeMs = Number(process.argv[2] || 25000);
if (!Number.isFinite(timeMs) || timeMs <= 0) throw new Error("timeMs must be positive.");
const itemIds = data.items.map((item) => item.item_id);
const slotUnlocks = [{ earnedSouls: 0, slots: data.slots.item_limit - data.slots.starting_slots.universal }];

// The seed run freezes one reachable reference. Both implementations then use
// it unchanged with the same deterministic RNG and the same 25-second budget.
const seed = runAnytimeWarden({ data, itemIds, budget, slotUnlocks, timeMs: 3000, referenceTimeMs: 2000, maxRollouts: 1 });
if (!seed) throw new Error("Reference seed produced no legal path.");
console.log(JSON.stringify({ phase: "reference-frozen", firstResultMs: seed.telemetry.runtimeMs }));
const summarize = (result) => ({
  legal: result.validation.valid,
  firstResultMs: result.telemetry.runtimeMs,
  runtimeMs: result.searchTelemetry.runtimeMs,
  evaluations: result.searchTelemetry.evaluations,
  completedPaths: result.searchTelemetry.completedPaths,
  score: result.quality.score,
  endUtility: result.quality.endUtility,
  worstRegret: result.quality.worstRegret,
  integratedRegret: result.quality.integratedRegret,
  inventory: result.state.inventory,
  profile: result.searchTelemetry.profile
});
const common = { data, itemIds, budget, slotUnlocks, reference: seed.reference, timeMs, maxRollouts: Infinity, profile: true };
const fullProfile = runAnytimeWarden({ ...common, compactMetrics: false });
console.log(JSON.stringify({ phase: "full-profile", result: summarize(fullProfile) }));
const compactProfile = runAnytimeWarden({ ...common, compactMetrics: true });
console.log(JSON.stringify({ referencePoints: seed.reference.axis.length, fullProfile: summarize(fullProfile), compactProfile: summarize(compactProfile) }, null, 2));

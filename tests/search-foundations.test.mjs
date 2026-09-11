import test from "node:test";
import assert from "node:assert/strict";
import { calculateTrajectoryObjectives } from "../app/trajectory-objectives.mjs";
import { createDeadlockDomain } from "../app/deadlock-domain.mjs";
import { searchLabels } from "../app/search-core.mjs";
import { paretoFilter } from "../app/reference-search.mjs";
import { runWardenWeaponPareto, runWardenCarryVectorPareto, runWardenCarryPareto, evaluateWardenWeaponPerformance, evaluateWardenCarryPerformance, evaluateCarryPerformance, computeWardenReference } from "../app/warden-search.mjs";
import { directReference } from "../app/direct-reference.mjs";
import { validateSearchPath } from "../app/validate-search-path.mjs";
import { runAnytimeWarden, scoreAnytimePath, ANYTIME_POLICY, ANYTIME_METRIC_GROUPS } from "../app/anytime-search.mjs";
import { buildOptimizerData, evaluateAfterburnMechanics, evaluateSpiritMechanics, evaluateWeaponMechanics, heroCanPurchaseItem } from "../app/optimizer.mjs";
import { parseCsv } from "../app/lib.mjs";
import { readFileSync } from "node:fs";

const point = (earnedSouls, power, kind = "transaction") => ({ earnedSouls, kind, metrics: { power } });
const objectives = (points, references, horizon, extra = {}) => calculateTrajectoryObjectives({ points, references, horizon, metric: "power", ...extra });

test("Anytime-Normalisierung hält Schaden und Überleben als gleich gewichtete Gruppen getrennt", () => {
  assert.equal(ANYTIME_METRIC_GROUPS.damage.weight, 0.5);
  assert.equal(ANYTIME_METRIC_GROUPS.survival.weight, 0.5);
  assert.equal(ANYTIME_METRIC_GROUPS.damage.metrics.length, 5);
  assert.equal(ANYTIME_METRIC_GROUPS.survival.metrics.length, 2);
  assert.equal(ANYTIME_POLICY.end + ANYTIME_POLICY.worst + ANYTIME_POLICY.integrated, 1);
});

test("Slowing Hex erhält nur seinen belegbaren Zusatznutzen gegenüber Binding Word", () => {
  const data = canonicalWardenData();
  const withHex = evaluateWardenCarryPerformance({ inventory: ["upgrade_containment"] }, { heroId: "warden", budget: 60000 }, data);
  const withoutHex = evaluateWardenCarryPerformance({ inventory: [] }, { heroId: "warden", budget: 60000 }, data);
  const combo = withHex.scenarios.scenarios.find((scenario) => scenario.id === "skirmish").active_combo;
  assert.equal(combo.available, true);
  assert.equal(combo.outcome, "success_branch");
  assert.equal(combo.required_initial_range_meters, 15);
  assert.equal(combo.sequence_delay_seconds, 0.25);
  assert.equal(combo.locked_seconds, 1.75);
  assert.equal(combo.cooldown_limited_uses, 1);
  assert.ok(combo.binding_word_alone.value > 0);
  assert.equal(combo.hex_incremental_value, 0);
  assert.equal(combo.value, 0);
  assert.ok(!Object.hasOwn(withHex.metrics, "slowingHexBindingWordComboDps"));
  assert.equal(withHex.scenarios.scenarios.find((scenario) => scenario.id === "skirmish").combo_failure.value, 0);
});

function fixture() {
  const items = [
    { item_id: "a", total_cost: "2", active_type: "", is_public_shop_item: "true" },
    { item_id: "b", total_cost: "3", active_type: "", is_public_shop_item: "true" }
  ];
  return { items, itemsById: new Map(items.map((item) => [item.item_id, item])),
    upgrades: [{ from_item_id: "a", to_item_id: "b", additional_cost: "1" }],
    economy: { sellback: { rate: 0.5 } }, slots: { starting_slots: { universal: 1 }, active_item_limit: 1 } };
}

test("Output validation replays legal actions and rejects fabricated terminal cash", () => {
  const data = fixture();
  const options = { data, itemIds: ["a", "b"], budget: 4, soulAxis: [0, 2, 4] };
  const domain = createDeadlockDomain(options);
  let state = domain.transitions(domain.initial).find((s) => s.earnedSouls === 2);
  state = domain.transitions(state).find((s) => s.events.at(-1).type === "purchase");
  state = domain.transitions(state).find((s) => s.earnedSouls === 4);
  assert.equal(validateSearchPath({ ...options, state }).valid, true);
  assert.throws(() => validateSearchPath({ ...options, state: { ...state, cash: state.cash + 1 } }), /terminal state/);
  assert.throws(() => validateSearchPath({ ...options, state: { ...state, events: [{ type: "purchase", item: "b", payment: 3 }] } }), /Illegal build action/);
});

test("Regret integrates held states, not trapezoids across purchases or reference jumps", () => {
  const actual = [point(0, 0), point(100, 10)];
  const references = [point(0, 10)];
  const result = objectives(actual, references, 100);
  assert.equal(result.worstRegret, 1);
  assert.equal(result.integratedRegret, 1); // zero power for the entire [0,100)
  assert.equal(result.endPerformance, 10);
  const changedReference = objectives([point(0, 5)], [point(0, 5), point(50, 10)], 100);
  assert.equal(changedReference.integratedRegret, 0.25); // 50 * 0 + 50 * .5
});

test("Sell then purchase and atomic replacement have identical trajectory objectives", () => {
  const before = [point(0, 10), point(100, 10, "resource")];
  const references = [point(0, 10)];
  const atomic = objectives([...before, point(100, 20)], references, 200);
  const split = objectives([...before, point(100, 0), point(100, 20)], references, 200);
  assert.deepEqual(split, atomic);
  const pendingSale = objectives([...before, point(100, 0)], references, 100);
  assert.equal(pendingSale.worstRegret, 1);
  assert.equal(pendingSale.settledWorstRegret, 0); // pending endpoint is not a past deficit
});

test("Trajectory clips the horizon, carries held values, and normalizes by horizon minus start", () => {
  const result = objectives([point(0, 5), point(100, 10), point(300, 0)], [point(0, 10)], 200, { start: 50 });
  assert.equal(result.regretIntegral, 25);
  assert.equal(result.integratedRegret, 25 / 150);
  assert.equal(result.endPerformance, 10);
  assert.equal(result.worstRegret, 0.5);
  const zeroWidth = objectives([point(0, 5)], [point(0, 10)], 0);
  assert.equal(zeroWidth.integratedRegret, 0);
  assert.equal(zeroWidth.worstRegret, 0.5);
});

test("Invalid and undefined relative objectives fail explicitly instead of dominating as zero", () => {
  assert.throws(() => objectives([point(0, 1)], [point(0, 0)], 10, { direction: "minimize" }), /Nullreferenz/);
  assert.throws(() => objectives([point(0, NaN)], [point(0, 1)], 10), /Metriken/);
  assert.throws(() => objectives([point(1, 1)], [point(0, 1)], 10), /Start/);
  assert.throws(() => objectives([point(0, 1)], [point(0, 1)], 10, { direction: "unknown" }), /Bewertungsrichtung/);
});

test("Infinite repeated free histories terminate without a depth cap; trade-off labels survive", () => {
  const result = searchLabels({
    initialState: { depth: 0, quality: 0 },
    stateKey: (s) => `${s.depth}:${s.quality}`,
    futureKey: () => "same",
    label: (s) => s.quality ? { x: 2, y: 1 } : { x: 1, y: 2 },
    expand: (s) => [{ depth: s.depth + 1, quality: s.quality }, { depth: s.depth + 1, quality: 1 }]
  });
  assert.equal(result.expandedStates, 2);
  assert.equal(result.labels.length, 2);
});

test("Superseded queued labels are not expanded; non-finite and inconsistent labels are rejected", () => {
  const expanded = [];
  const config = {
    initialState: { id: "start", q: 0 }, stateKey: (s) => s.id,
    futureKey: (s) => s.id === "start" ? "start" : "same",
    label: (s) => ({ q: s.q }),
    expand: (s) => { expanded.push(s.id); return s.id === "start" ? [{ id: "weak", q: 1 }, { id: "strong", q: 2 }] : []; }
  };
  searchLabels(config);
  assert.deepEqual(expanded, ["start", "strong"]);
  assert.throws(() => searchLabels({ ...config, label: () => ({ q: NaN }) }), /endlichen/);
  assert.throws(() => searchLabels({ ...config, label: (s) => s.id === "start" ? { q: 0 } : { other: 1 } }), /Dimensionen/);
});

test("Default resource model reaches every integer including non-price points and the horizon", () => {
  const domain = createDeadlockDomain({ data: fixture(), budget: 5, slotUnlocks: [{ earnedSouls: 1, slots: 1 }] });
  let state = domain.initial;
  const axis = [0];
  while (state.earnedSouls < 5) {
    state = domain.transitions(state).find((s) => s.events.at(-1).type === "save");
    axis.push(state.earnedSouls);
  }
  assert.deepEqual(axis, [0, 1, 2, 3, 4, 5]);
  assert.equal(state.unlockedSlots, 1);
  assert.equal(domain.resourceEvents.earnedSoulsSource, "exhaustive_integer_souls");
  assert.equal(domain.resourceEvents.completeWithoutEarnedSoulEvents, true);
  assert.equal(createDeadlockDomain({ data: fixture(), budget: 5, soulAxis: [0, 5] }).resourceEvents.completeWithoutEarnedSoulEvents, false);
  assert.throws(() => createDeadlockDomain({ data: fixture(), budget: 5, soulAxis: [0, 3] }), /budget/);
  assert.throws(() => createDeadlockDomain({ data: fixture(), budget: 5.5 }), /ganze/);
});

test("Domain rejects full refunds but isolates unsupported upgrade payments", () => {
  const data = fixture();
  data.economy.sellback.rate = 1;
  assert.throws(() => createDeadlockDomain({ data, budget: 4 }), /Rückgaben/);
  data.economy.sellback.rate = 0.5;
  data.upgrades[0].additional_cost = "0";
  const domain = createDeadlockDomain({ data, budget: 4 });
  assert.equal(domain.resourceEvents.unsupportedUpgrades.length, 1);
  assert.equal(domain.resourceEvents.unsupportedUpgrades[0].from_item_id, "a");
});

// Independent tiny world: no adapter transitions, reference-search, trajectory
// evaluator or production dominance used to construct expected terminal vectors.
test("Integer resource search matches an independent exhaustive trajectory oracle", () => {
  const horizon = 4;
  const power = (id) => id === "a" ? 3 : id === "b" ? 5 : 0;
  const cost = (id) => id === "a" ? 2 : 3;
  const best = [0, 0, 3, 5, 5];
  const gap = (s, item) => best[s] ? Math.max(0, 1 - power(item) / best[s]) : 0;
  const terminal = [];
  function walk(s, cash, item, worst, area) {
    if (s === horizon) terminal.push([power(item), -Math.max(worst, gap(s, item)), -area / horizon]);
    if (s < horizon) walk(s + 1, cash + 1, item, Math.max(worst, gap(s, item)), area + gap(s, item));
    if (item === null) {
      for (const id of ["a", "b"]) if (cash >= cost(id)) walk(s, cash - cost(id), id, worst, area);
    } else {
      walk(s, cash + cost(item) / 2, null, worst, area);
    }
  }
  walk(0, 0, null, 0, 0);
  const expected = new Set(terminal.filter((a) => !terminal.some((b) =>
    b.every((v, i) => v >= a[i]) && b.some((v, i) => v > a[i]))).map(JSON.stringify));
  const refs = best.map((value, s) => point(s, value));
  const data = fixture();
  data.upgrades = [];
  const domain = createDeadlockDomain({
    data, budget: horizon,
    metrics: (s) => ({ power: power(s.inventory[0]) }),
    label: (s) => {
      const result = objectives(s.snapshots, refs, s.earnedSouls);
      return { negativeWorst: -result.settledWorstRegret, negativeArea: -result.regretIntegral };
    }
  });
  const actual = domain.search().labels.filter(({ state }) => state.earnedSouls === horizon).map(({ state }) => {
    const result = objectives(state.snapshots, refs, horizon);
    return [result.endPerformance, -result.worstRegret, -result.integratedRegret];
  });
  const actualPareto = new Set(actual.filter((a) => !actual.some((b) =>
    b.every((v, i) => v >= a[i]) && b.some((v, i) => v > a[i]))).map(JSON.stringify));
  assert.deepEqual(actualPareto, expected);
  assert.ok(expected.size > 0);
});

function canonicalWardenData() {
  const json = (path) => JSON.parse(readFileSync(path, "utf8"));
  const csv = (path) => parseCsv(readFileSync(path, "utf8"));
  return buildOptimizerData({
    coreManifest: json("data/core/manifest.json"), heroManifest: json("data/heroes/manifest.json"),
    items: csv("data/core/items.csv"), itemMechanics: csv("data/core/item_mechanics.csv"), heroes: csv("data/heroes/heroes.csv"),
    upgrades: csv("data/core/item_upgrades.csv"), economy: json("data/core/economy.json"), slots: json("data/core/slots.json"),
    heroStats: csv("data/heroes/hero_stats.csv"), abilities: csv("data/heroes/abilities.csv"),
    abilityMechanics: csv("data/heroes/ability_mechanics.csv"), heroResources: csv("data/heroes/hero_resources.csv")
  });
}

test("Kompakte Suchmetriken entsprechen dem vollständigen Warden-Szenarioprofil", () => {
  const data = canonicalWardenData();
  const request = { heroId: "warden", budget: 60000 };
  for (const inventory of [
    ["upgrade_rapid_rounds"],
    ["upgrade_health", "upgrade_titan_round", "upgrade_bullet_lifesteal"],
    ["upgrade_titan_round", "upgrade_weighted_shots", "upgrade_improved_bullet_armor", "upgrade_soaring_spirit"]
  ]) {
    const full = evaluateWardenCarryPerformance({ inventory }, request, data);
    const compact = evaluateWardenCarryPerformance({ inventory }, { ...request, metricsOnly: true }, data);
    assert.equal(full.valid, true);
    assert.equal(compact.valid, true);
    assert.deepEqual(compact.metrics, full.metrics);
  }
});

test("Weapon, Spirit und Hybrid verwenden für Warden und Infernus eigene belegte Kampfwerte", () => {
  const data = canonicalWardenData();
  for (const heroId of ["warden", "infernus"]) {
    const weapon = evaluateCarryPerformance({ inventory: ["upgrade_extra_spirit"] }, { heroId, damageFocus: "weapon", budget: 60000 }, data);
    const spirit = evaluateCarryPerformance({ inventory: ["upgrade_extra_spirit"] }, { heroId, damageFocus: "spirit", budget: 60000 }, data);
    const hybrid = evaluateCarryPerformance({ inventory: ["upgrade_extra_spirit"] }, { heroId, damageFocus: "hybrid", budget: 60000 }, data);
    for (const result of [weapon, spirit, hybrid]) assert.equal(result.valid, true);
    assert.equal(spirit.scenarios.common.damage_focus, "spirit");
    assert.ok(spirit.scenarios.common.spirit_mechanics.abilities.some((ability) => ability.included));
    assert.ok(hybrid.metrics.teamfightWindowDps >= spirit.metrics.teamfightWindowDps);
    assert.notEqual(weapon.metrics.teamfightWindowDps, spirit.metrics.teamfightWindowDps);
  }
});

test("Globale Ability-Cooldown-Reduktion und Wardens Last Stand folgen den belegten Zeitgrenzen", () => {
  const data = canonicalWardenData();
  const spirit = (inventory = []) => evaluateSpiritMechanics({ inventory: inventory.map((id) => data.itemsById.get(id)) }, { heroId: "warden" }, data);
  const base = spirit();
  const superior = spirit(["upgrade_cooldown_reduction"]);
  const transcendent = spirit(["upgrade_cooldown_reduction", "upgrade_transcendent_cooldown"]);
  const imbued = spirit(["upgrade_magic_tempo"]);
  const baseBinding = base.abilities.find((ability) => ability.abilityId === "warden_binding_word");
  const superiorBinding = superior.abilities.find((ability) => ability.abilityId === "warden_binding_word");
  const lastStand = base.abilities.find((ability) => ability.abilityId === "warden_last_stand");
  assert.equal(superior.cooldownReduction.multiplier, 0.8);
  assert.ok(Math.abs(transcendent.cooldownReduction.multiplier - 0.6) < 1e-12);
  assert.equal(imbued.cooldownReduction.multiplier, 1);
  assert.equal(imbued.cooldownReduction.excluded.length, 1);
  assert.equal(baseBinding.cooldown, 34);
  assert.ok(Math.abs(superiorBinding.cooldown - 27.2) < 1e-12);
  const bindingCastDamage = baseBinding.damageAt(1);
  const superiorBindingCastDamage = superiorBinding.damageAt(1);
  assert.equal(baseBinding.damageAt(33.999), bindingCastDamage);
  assert.equal(baseBinding.damageAt(34), 2 * bindingCastDamage);
  assert.equal(superiorBinding.damageAt(superiorBinding.cooldown - 0.001), superiorBindingCastDamage);
  assert.equal(superiorBinding.damageAt(superiorBinding.cooldown), 2 * superiorBindingCastDamage);
  assert.equal(lastStand.baseCooldown, 180);
  assert.equal(lastStand.cooldown, 180);
  assert.equal(lastStand.pulseDamage, 35);
  assert.equal(lastStand.pulseCount, 12);
  assert.equal(lastStand.damageAt(2.49), 0);
  assert.equal(lastStand.damageAt(2.5), 35);
  assert.equal(lastStand.damageAt(4), 140);
  assert.equal(lastStand.damageAt(8), 420);
  assert.equal(lastStand.damageAt(8.01), 420);
  assert.equal(base.castTimeAt(4), 2.25);

  const fullSpirit = evaluateCarryPerformance({ inventory: [] }, { heroId: "warden", damageFocus: "spirit", budget: 60000 }, data);
  const fullHybrid = evaluateCarryPerformance({ inventory: [] }, { heroId: "warden", damageFocus: "hybrid", budget: 60000 }, data);
  const compactSpirit = evaluateCarryPerformance({ inventory: [] }, { heroId: "warden", damageFocus: "spirit", budget: 60000, metricsOnly: true }, data);
  const compactHybrid = evaluateCarryPerformance({ inventory: [] }, { heroId: "warden", damageFocus: "hybrid", budget: 60000, metricsOnly: true }, data);
  assert.equal(fullSpirit.scenarios.scenarios.find((entry) => entry.id === "skirmish").window_damage, 310);
  assert.equal(fullSpirit.scenarios.scenarios.find((entry) => entry.id === "teamfight").window_damage, 590);
  assert.equal(fullHybrid.scenarios.scenarios.find((entry) => entry.id === "skirmish").window_damage,
    310 + fullHybrid.scenarios.weaponMechanics.weaponDamageAt(4 - base.castTimeAt(4)));
  assert.deepEqual(compactSpirit.metrics, fullSpirit.metrics);
  assert.deepEqual(compactHybrid.metrics, fullHybrid.metrics);
});

test("Infernus Afterburn benötigt Weapon-Hits, tickt nach Build-up und bleibt in Suchmetriken gleich", () => {
  const data = canonicalWardenData();
  const request = { heroId: "infernus", damageFocus: "weapon", budget: 60000 };
  const weapon = evaluateWeaponMechanics({ inventory: [] }, request, data);
  const afterburn = evaluateAfterburnMechanics({ inventory: [] }, request, data, weapon);
  const scaledState = { inventory: [data.itemsById.get("upgrade_improved_spirit")] };
  const scaled = evaluateAfterburnMechanics(scaledState, request, data, evaluateWeaponMechanics(scaledState, request, data));
  const triggerAt = weapon.weaponHitTime(13);
  const noFurtherHits = (time) => Math.min(time, triggerAt);
  assert.equal(afterburn.applicable, true);
  assert.equal(afterburn.included, true);
  assert.equal(afterburn.triggerHits, 13);
  assert.equal(afterburn.buildupPerHit, 8.1);
  assert.equal(afterburn.tickDamage, 7);
  assert.equal(afterburn.damageAt(triggerAt + afterburn.tickInterval - 0.001), 0);
  assert.equal(afterburn.damageAt(triggerAt + afterburn.tickInterval), 7);
  assert.equal(afterburn.damageAt(4), 35);
  assert.equal(afterburn.damageAt(10), 119);
  assert.equal(afterburn.damageAt(triggerAt + afterburn.baseDuration, noFurtherHits), 42);
  assert.equal(afterburn.damageAt(triggerAt + afterburn.baseDuration + 2, noFurtherHits), 42);
  assert.equal(scaled.tickDamage, (14 + 0.66 * scaled.spiritPower) * 0.5);
  assert.ok(scaled.tickDamage > afterburn.tickDamage);

  const weaponProfile = evaluateCarryPerformance({ inventory: [] }, request, data);
  const spiritProfile = evaluateCarryPerformance({ inventory: [] }, { ...request, damageFocus: "spirit" }, data);
  const hybridProfile = evaluateCarryPerformance({ inventory: [] }, { ...request, damageFocus: "hybrid" }, data);
  const compactWeapon = evaluateCarryPerformance({ inventory: [] }, { ...request, metricsOnly: true }, data);
  const compactHybrid = evaluateCarryPerformance({ inventory: [] }, { ...request, damageFocus: "hybrid", metricsOnly: true }, data);
  const weaponTeamfight = weaponProfile.scenarios.scenarios.find((scenario) => scenario.id === "teamfight");
  const spiritTeamfight = spiritProfile.scenarios.scenarios.find((scenario) => scenario.id === "teamfight");
  const hybridTeamfight = hybridProfile.scenarios.scenarios.find((scenario) => scenario.id === "teamfight");
  assert.equal(weaponTeamfight.afterburn_damage, 119);
  assert.equal(spiritTeamfight.afterburn_damage, 0);
  assert.ok(hybridTeamfight.afterburn_damage > 0);
  assert.deepEqual(compactWeapon.metrics, weaponProfile.metrics);
  assert.deepEqual(compactHybrid.metrics, hybridProfile.metrics);
});

test("Jeder kanonische Held liefert pro Carry-Fokus endliche Werte oder eine konkrete Basisdatenlücke", () => {
  const data = canonicalWardenData();
  const missing = new Set();
  for (const hero of data.heroes) for (const damageFocus of ["weapon", "spirit", "hybrid"]) {
    const result = evaluateCarryPerformance({ inventory: [] }, { heroId: hero.hero_id, damageFocus, budget: 60000 }, data);
    if (result.valid) {
      assert.ok(Object.values(result.metrics).every(Number.isFinite), `${hero.hero_id}/${damageFocus}`);
    } else {
      assert.match(result.reason, /^HERO_(WEAPON_STAT_MISSING|COMBAT_STAT_MISSING): /);
      missing.add(hero.hero_id);
    }
  }
  assert.equal(data.heroes.length, 60);
  assert.deepEqual([...missing].sort(), ["boho", "bomber", "cadence", "fathom", "fortuna", "generic_person", "graf", "gunslinger", "kali", "raven", "rutger", "shield_guy", "silver_transformed", "skyrunner", "swan", "targetdummy", "the_boss", "thumper", "tokamak", "trapper", "vandal", "wrecker"]);
});

test("Unvollständige Fähigkeitsdaten behaupten keine Charge-Kaufunfähigkeit", () => {
  const data = canonicalWardenData();
  const extraCharge = data.itemsById.get("upgrade_extra_charge");
  assert.equal(heroCanPurchaseItem(extraCharge, data, "warden"), false);
  assert.equal(heroCanPurchaseItem(extraCharge, data, "boho"), true);
});

test("Anytime output is legal, improves monotonically and compares with an exact small oracle", () => {
  const data = canonicalWardenData();
  const itemIds = ["upgrade_rapid_rounds", "upgrade_health"];
  for (const budget of [800, 1600]) for (const slotUnlocks of [[], [{ earnedSouls: 0, slots: 3 }]]) {
    const ref = computeWardenReference({ data, itemIds, budget, slotUnlocks });
    const axis = ref.byMetric.sustainedWeaponDps.map((p) => p.earnedSouls);
    const names = Object.keys(ref.byMetric);
    const reference = { axis, values: axis.map((_, i) => Object.fromEntries(names.map((m) => [m, ref.byMetric[m][i].metrics[m]]))) };
    const options = { data, itemIds, budget, slotUnlocks, soulAxis: axis, metrics: (state) => evaluateWardenCarryPerformance(state, { heroId: "warden", budget }, data).metrics };
    const oracle = createDeadlockDomain(options).enumerate().states.filter((e) => e.state.earnedSouls === budget);
    const exact = Math.max(...oracle.map((e) => scoreAnytimePath(e.state.snapshots, reference, budget).score));
    const outputs = [];
    const result = runAnytimeWarden({ data, itemIds, budget, slotUnlocks, reference, timeMs: 2000, maxRollouts: 5, onResult: (r) => outputs.push(r) });
    assert.ok(result.validation.valid);
    assert.ok(result.searchTelemetry.completedPaths >= 1);
    assert.equal(result.searchTelemetry.localRefinementRan, true);
    assert.ok(result.searchTelemetry.localAlternativesTried > 0);
    assert.equal(result.searchTelemetry.localBaselineScore <= result.quality.score, true);
    assert.ok(result.searchTelemetry.evaluations >= result.telemetry.evaluations);
    assert.equal(result.slotLimit, 9 + (slotUnlocks[0]?.slots || 0));
    assert.ok(Math.abs(exact - result.quality.score) < 1e-12, `small-case score gap: ${exact - result.quality.score}`);
    for (let i = 1; i < outputs.length; i++) assert.ok(outputs[i].quality.score > outputs[i - 1].quality.score);
    assert.equal(result.policy.end, 0.7);
    assert.equal(ANYTIME_POLICY.worst + ANYTIME_POLICY.integrated, 0.3);
    assert.deepEqual(result.reference, reference);
  }
});

test("Endinventar-Seed berücksichtigt Komponenten und erhält ihren früheren Nutzen", () => {
  const data = canonicalWardenData();
  const result = runAnytimeWarden({ data, itemIds: ["upgrade_clip_size", "upgrade_titan_round"], budget: 1600,
    timeMs: 1000, maxRollouts: 2, slotUnlocks: [{ earnedSouls: 0, slots: 3 }] });
  assert.ok(result.validation.valid);
  assert.deepEqual(result.state.events.filter((event) => event.type !== "save").map((event) => [event.type, event.item, event.from || null]), [
    ["purchase", "upgrade_clip_size", null],
    ["upgrade", "upgrade_titan_round", "upgrade_clip_size"]
  ]);
});

test("Schnelle Warden-Suche übergibt nicht kaufbare Charge-Items nicht an die Domäne", () => {
  const result = runAnytimeWarden({ data: canonicalWardenData(), itemIds: ["upgrade_rapid_rounds", "upgrade_rechargingbullets"],
    budget: 800, timeMs: 1000, maxRollouts: 2, slotUnlocks: [{ earnedSouls: 0, slots: 3 }] });
  assert.ok(result.validation.valid);
  assert.deepEqual(result.unavailableItemIds, ["upgrade_rechargingbullets"]);
  assert.ok(!result.state.inventory.includes("upgrade_rechargingbullets"));
});

test("Lokale Gegenprobe behält einen besseren realen Komponentenpfad bis zum Upgrade", () => {
  const data = canonicalWardenData();
  // Real item data, deliberately one slot: a component competes with an
  // early defensive purchase and makes sell/replacement actions legal.
  data.slots = { ...data.slots, starting_slots: { ...data.slots.starting_slots, universal: 1 } };
  const itemIds = ["upgrade_rapid_rounds", "upgrade_health", "upgrade_clip_size", "upgrade_titan_round"];
  const budget = 1600, slotUnlocks = [];
  const ref = computeWardenReference({ data, itemIds, budget, slotUnlocks });
  const axis = ref.byMetric.sustainedWeaponDps.map((point) => point.earnedSouls);
  const names = Object.keys(ref.byMetric);
  const reference = { axis, values: axis.map((_, index) =>
    Object.fromEntries(names.map((metric) => [metric, ref.byMetric[metric][index].metrics[metric]]))) };
  const oracle = createDeadlockDomain({ data, itemIds, budget, soulAxis: axis, slotUnlocks,
    metrics: (state) => evaluateWardenCarryPerformance(state, { heroId: "warden", budget }, data).metrics }).enumerate()
    .states.filter((entry) => entry.state.earnedSouls === budget);
  const exact = Math.max(...oracle.map((entry) => scoreAnytimePath(entry.state.snapshots, reference, budget).score));
  const before = runAnytimeWarden({ data, itemIds, budget, slotUnlocks, reference, timeMs: 1000, maxRollouts: 1, localRefinement: false });
  const after = runAnytimeWarden({ data, itemIds, budget, slotUnlocks, reference, timeMs: 1000, maxRollouts: 1 });

  assert.ok(exact > before.quality.score, "der frühere Suchlauf verpasst den Komponentenpfad");
  assert.ok(Math.abs(after.quality.score - exact) < 1e-12);
  assert.deepEqual(after.state.events.filter((event) => event.type !== "save").map((event) => [event.type, event.item, event.from || null]), [
    ["purchase", "upgrade_clip_size", null],
    ["upgrade", "upgrade_titan_round", "upgrade_clip_size"]
  ]);
  assert.equal(after.validation.valid, true);
  assert.ok(after.searchTelemetry.localImprovements > 0);
});

test("Direct reference matches every maximum of complete small transition graphs", () => {
  for (const slots of [0, 1, 2]) for (const rate of [0, 0.5]) for (const unlock of [false, true]) {
    const data = fixture();
    data.slots.starting_slots.universal = slots;
    data.economy.sellback.rate = rate;
    const slotUnlocks = unlock ? [{ earnedSouls: 3, slots: 1 }] : [];
    const axis = [0, 1, 2, 3, 4];
    const metrics = ({ inventory }) => ({ attack: inventory.includes("a") ? 7 : inventory.includes("b") ? 3 : 0,
      defense: inventory.includes("b") ? 9 : 1 });
    const options = { data, itemIds: ["a", "b"], budget: 4, soulAxis: axis, slotUnlocks, metrics };
    const exhaustive = createDeadlockDomain(options).enumerate();
    const direct = directReference({ ...options, metricSet: ["attack", "defense"] });
    for (const m of ["attack", "defense"]) for (const p of direct.byMetric[m]) {
      assert.equal(p.metrics[m], Math.max(...exhaustive.states.filter((e) => e.state.earnedSouls === p.earnedSouls).map((e) => metrics(e.state)[m])));
    }
  }
});

test("Direct Warden reference exactly matches legacy curves including active limits and unlocks", () => {
  const data = canonicalWardenData();
  const itemIds = ["upgrade_rapid_rounds", "upgrade_headshot_booster", "upgrade_health", "upgrade_health_stimpak"];
  for (const budget of [800, 1600, 2400]) {
    for (const slots of [1, 2]) {
      const configured = { ...data, slots: { ...data.slots, starting_slots: { universal: slots }, active_item_limit: slots - 1 } };
      const options = { data: configured, itemIds, budget, slotUnlocks: [{ earnedSouls: 800, slots: 1 }] };
      assert.deepEqual(computeWardenReference(options).byMetric, computeWardenReference({ ...options, method: "legacy" }).byMetric);
    }
  }
});

test("Reference profiling leaves exact curves and enumeration unchanged", () => {
  const data = canonicalWardenData();
  const options = { data, itemIds: ["upgrade_rapid_rounds", "upgrade_headshot_booster", "upgrade_health", "upgrade_health_stimpak"], budget: 2400 };
  const normal = computeWardenReference(options);
  const messages = [];
  const measured = computeWardenReference({ ...options, profile: true, onProgress: (message) => messages.push(message) });
  assert.deepEqual(measured.byMetric, normal.byMetric);
  assert.deepEqual(measured.byMetric, computeWardenReference({ ...options, method: "legacy" }).byMetric);
  assert.equal(measured.telemetry.evaluatedInventories, normal.telemetry.evaluatedInventories);
  const p = measured.telemetry.profiling;
  for (const key of ["setupMs", "combinationMs", "legalityMs", "evaluationMs", "aggregationMs"]) assert.ok(Number.isFinite(p[key]) && p[key] >= 0);
  assert.equal(p.candidateExtensions - p.illegalExtensions, measured.telemetry.evaluatedInventories - 1);
  assert.ok(p.combinationMs + p.legalityMs + p.evaluationMs + p.aggregationMs <= measured.telemetry.runtimeMs);
  assert.equal(messages.at(-1).telemetry.evaluatedInventories, measured.telemetry.evaluatedInventories);
  assert.equal(normal.telemetry.profiling, undefined);
});

test("One-pass reference evaluation has exactly the same values without retained profiles", () => {
  const data = canonicalWardenData();
  const request = { heroId: "warden", budget: 2400 };
  for (const inventory of [[], ["upgrade_rapid_rounds"], ["upgrade_rapid_rounds", "upgrade_health", "upgrade_headshot_booster"]]) {
    const cached = evaluateWardenCarryPerformance({ inventory }, request, data);
    const streamed = evaluateWardenCarryPerformance({ inventory }, { ...request, cacheProfiles: false }, data);
    assert.deepEqual(streamed.metrics, cached.metrics);
  }
});

test("Warden real evaluation preserves the complete small Pareto set without Walker slots", () => {
  const data = canonicalWardenData();
  const result = runWardenWeaponPareto({
    data, itemIds: ["upgrade_rapid_rounds", "upgrade_headshot_booster"], budget: 800, slotUnlocks: []
  });
  assert.equal(result.request.heroId, "warden");
  assert.equal(result.reference.points.at(-1).earnedSouls, 800);
  assert.ok(result.pareto.length > 0);
  assert.ok(result.pareto.every(({ state }) => state.inventory.length <= 9 && state.unlockedSlots === 0));
  assert.ok(result.pareto.every(({ objectives }) => Number.isFinite(objectives.worstRegret) && Number.isFinite(objectives.integratedRegret)));
  assert.equal(result.resource.step, 400);
  assert.deepEqual(result.pareto.map(({ state }) => state.inventory), [["upgrade_rapid_rounds"]]);
  assert.deepEqual(result.pareto.map(({ objectives }) => [objectives.worstRegret, objectives.integratedRegret]), [[0, 0]]);

  // Independent exhaustive state enumeration: it does not use the
  // label-correcting core.  It validates the same real two-item world against
  // the already constructed pointwise reference.
  const request = { heroId: "warden", objective: "weapon_magazine_dps", budget: 800 };
  const metrics = (state) => ({ sustainedWeaponDps: evaluateWardenWeaponPerformance(state, request, data) });
  const label = (state) => {
    const objective = calculateTrajectoryObjectives({ points: state.snapshots, references: result.reference.points,
      metric: "sustainedWeaponDps", horizon: 800 });
    return { endPerformance: objective.endPerformance, negativeWorstRegret: -objective.worstRegret,
      negativeIntegratedRegret: -objective.integratedRegret };
  };
  const oracle = createDeadlockDomain({ data, itemIds: ["upgrade_rapid_rounds", "upgrade_headshot_booster"],
    soulAxis: result.resource.axis, budget: 800, slotUnlocks: [], metrics, label }).enumerate();
  const expected = paretoFilter(oracle.states.filter(({ state }) => state.earnedSouls === 800));
  const key = (entry) => `${entry.state.inventory.slice().sort().join("|")}:${JSON.stringify(entry.label)}`;
  assert.deepEqual(new Set(result.pareto.map(key)), new Set(expected.map(key)));
});

test("Warden resource model reaches 60k without Walker slots or a search cap", () => {
  const result = runWardenWeaponPareto({
    data: canonicalWardenData(), itemIds: ["upgrade_rapid_rounds"], budget: 60000, slotUnlocks: []
  });
  assert.equal(result.resource.axis.at(-1), 60000);
  assert.equal(result.resource.axis.length, 151);
  assert.ok(result.search.expandedStates > 0);
  assert.ok(result.search.generatedStates > result.search.expandedStates);
  assert.ok(result.pareto.length > 0);
  assert.ok(Number.isFinite(result.telemetry.runtimeMs) && result.telemetry.runtimeMs >= 0);
  assert.equal(result.telemetry.retainedLabels, result.search.labels.length);
  assert.equal(result.telemetry.prunedLabels, result.search.prunedLabels);
  assert.equal(result.telemetry.referenceExpandedStates, 0);
  assert.equal(result.telemetry.referenceInventories, 2);
  assert.equal(typeof result.telemetry.heapUsedBytesBefore, "number");
  assert.equal(typeof result.telemetry.heapUsedBytesAfter, "number");
  assert.ok(result.pareto.every(({ state }) => state.inventory.length <= 9 && state.unlockedSlots === 0));
});

test("Warden Carry-Slice hält Szenarien und EHP als getrennte Pareto-/Regret-Dimensionen", () => {
  const data = canonicalWardenData();
  const itemIds = ["upgrade_rapid_rounds", "upgrade_headshot_booster"];
  const result = runWardenCarryVectorPareto({
    data, itemIds, budget: 800, slotUnlocks: []
  });
  assert.deepEqual(result.metrics, [
    "sustainedWeaponDps", "laneTradeWindowDps", "farmWindowDps", "skirmishWindowDps",
    "teamfightWindowDps", "bulletEhp", "spiritEhp"
  ]);
  assert.ok(result.reference.byMetric.teamfightWindowDps);
  assert.ok(result.pareto.length > 0);
  assert.ok(result.pareto.every((entry) => Object.keys(entry.paretoLabel).length === 21));
  assert.ok(result.pareto.every((entry) => entry.objectivesByMetric.bulletEhp.worstRegret >= 0));
  assert.equal(result.pareto[0].state.inventory[0], "upgrade_rapid_rounds");

  // Separate exhaustive traversal: it does not use searchLabels or the
  // production Pareto result, and compares the complete terminal vector.
  const domain = createDeadlockDomain({ data, itemIds, soulAxis: result.resource.axis, budget: 800, slotUnlocks: [],
    metrics: (state) => evaluateWardenCarryPerformance(state, { heroId: "warden", objective: "weapon_magazine_dps", budget: 800 }, data).metrics,
    label: (state) => Object.fromEntries(result.metrics.flatMap((metric) => {
      const objective = calculateTrajectoryObjectives({ points: state.snapshots, references: result.reference.byMetric[metric], metric, horizon: state.earnedSouls });
      return [[`${metric}End`, objective.endPerformance],
        [`${metric}NegativeWorstRegret`, -objective.worstRegret],
        [`${metric}NegativeIntegratedRegret`, -objective.integratedRegret]];
    }))
  });
  const oracleTerminal = domain.enumerate().states.filter(({ state }) => state.earnedSouls === 800);
  const expected = paretoFilter(oracleTerminal.map((entry) => ({ ...entry, label: entry.label })));
  const key = (entry) => `${entry.state.inventory.slice().sort().join("|")}:${JSON.stringify(entry.label)}`;
  assert.deepEqual(new Set(result.pareto.map((entry) => key({ state: entry.state, label: entry.paretoLabel }))), new Set(expected.map(key)));
});

test("Warden Carry optimiert den gemeinsamen Zielvektor ohne versteckten Gesamtscore", () => {
  const result = runWardenCarryPareto({ data: canonicalWardenData(), itemIds: ["upgrade_rapid_rounds", "upgrade_headshot_booster"], budget: 800, slotUnlocks: [] });
  assert.deepEqual(result.metrics, ["sustainedWeaponDps", "laneTradeWindowDps", "farmWindowDps", "skirmishWindowDps", "teamfightWindowDps", "bulletEhp", "spiritEhp"]);
  for (const metric of result.metrics) {
    assert.ok(result.byMetric[metric].reference.points.length > 0);
    assert.ok(result.byMetric[metric].pareto.every((entry) => Object.keys(entry.paretoLabel).length === 21));
  }
});

test("Kanonische vollständige Itemmenge isoliert mehrkomponentige Upgrade-Kanten statt den Lauf abzubrechen", () => {
  const data = canonicalWardenData();
  const domain = createDeadlockDomain({ data, itemIds: data.items.map((item) => item.item_id), budget: 0, slotUnlocks: [] });
  assert.ok(domain.resourceEvents.unsupportedUpgrades.some((edge) =>
    edge.from_item_id === "upgrade_health_stealing_magic" && edge.to_item_id === "upgrade_damage_recycler"
  ));
  assert.equal(domain.initial.earnedSouls, 0);
});

test("Public Carry search preserves a compromise lost by separate scalar searches", () => {
  const data = canonicalWardenData();
  data.items = ["attack", "defense", "compromise"].map((id) => ({
    item_id: id, name: id, category: "Weapon", total_cost: "800", tier: "1", active_type: "", is_public_shop_item: "true"
  }));
  data.itemsById = new Map(data.items.map((item) => [item.item_id, item]));
  data.upgrades = [];
  data.upgradesByFrom = new Map();
  data.upgradesByTo = new Map();
  data.slots = { starting_slots: { universal: 1 }, active_item_limit: 4, unlocks: [] };
  data.economy = { sellback: { rate: 0.5 }, investment_thresholds: [] };
  const effect = (id, mechanic, value) => ({ item_id: id, effect_id: `${id}:${mechanic}`,
    mechanic, value: String(value), condition: "Immer, solange das Item gehalten wird.", confidence: "high" });
  data.mechanicsByItem = new Map([
    ["attack", [effect("attack", "base_attack_damage_percent", 100)]],
    ["defense", [effect("defense", "bonus_health", 600)]],
    ["compromise", [effect("compromise", "base_attack_damage_percent", 40), effect("compromise", "bonus_health", 200)]]
  ]);
  const messages = [];
  const result = runWardenCarryPareto({ data, itemIds: data.items.map((i) => i.item_id), budget: 800,
    onProgress: (p) => messages.push(p) });
  assert.deepEqual(new Set(result.pareto.map((entry) => entry.state.inventory[0])), new Set(["attack", "defense", "compromise"]));
  assert.equal(messages.filter((p) => p.phase === "metric-start").length, 1);
  assert.ok(result.pareto.every((entry) => Object.keys(entry.paretoLabel).length === 21));
  assert.ok(result.metrics.every((metric) => result.byMetric[metric].pareto === result.pareto));
});

test("Equal terminal vectors are represented once without sell-rebuy noise", () => {
  const result = runWardenWeaponPareto({ data: canonicalWardenData(), itemIds: ["upgrade_rapid_rounds"], budget: 2400 });
  assert.equal(result.pareto.length, 1);
  assert.equal(result.telemetry.distinctParetoVectors, 1);
  assert.deepEqual(result.pareto[0].state.events.filter((event) => event.type !== "save").map((event) => event.type), ["purchase"]);
  assert.equal(result.resource.integerAxisCompletenessProven, false);
});

test("History-free reference traversal preserves reachable configurations and snapshot metrics", () => {
  const data = fixture();
  const regular = createDeadlockDomain({ data, budget: 4 });
  const lean = createDeadlockDomain({ data, budget: 4, recordHistory: false });
  const left = regular.search();
  const right = lean.search({ labelDependsOnlyOnFuture: true });
  const keys = (domain, result) => new Set(result.labels.map(({ state, label }) => `${domain.futureKey(state)}:${JSON.stringify(label)}`));
  assert.deepEqual(keys(regular, left), keys(lean, right));
  assert.ok(right.labels.every(({ state }) => state.events.length === 0 && state.snapshots.length === 0));
});

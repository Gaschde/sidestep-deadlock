import {
  buildHeroCapabilityProfile,
  buildPathMilestones,
  evaluateBuildCapabilities,
  evaluateItemCapabilities,
  itemEffectAvailability
} from "./capabilities.mjs";

const SUPPORTED_WEAPON_MECHANICS = new Set([
  "base_attack_damage_percent",
  "bonus_fire_rate",
  "bonus_clip_size_percent",
  "bonus_clip_size"
]);

const CARRY_SURVIVAL_MECHANICS = new Set([
  "bonus_health",
  "bonus_base_health",
  "bullet_resist",
  "spirit_resist",
  "bullet_lifesteal_percent",
  "bonus_health_regen",
  "out_of_combat_health_regen",
  "bonus_sprint_speed"
]);

const ALWAYS_AVAILABLE = /^(immer|base hero state)/i;
const CHECKPOINT_PROFILE_CACHE = new WeakMap();
const WEAPON_MECHANICS_CACHE = new WeakMap();
const SCENARIO_PROFILE_CACHE = new WeakMap();
const TRAJECTORY_PROFILE_CACHE = new WeakMap();
const TRAJECTORY_CHECKPOINT_INDEX_CACHE = new WeakMap();
const TRAJECTORY_BUDGETS = [3200, 4800, 7200, 12000, 20000, 30000, 40000];
const COMPLETE_REPLACEMENT_SEED_LIMIT = 9;

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cloneState(state) {
  return {
    inventory: [...state.inventory],
    spent: state.spent,
    activeItems: state.activeItems,
    grossSpent: state.grossSpent || state.spent,
    events: [...state.events]
  };
}

function thresholdSnapshot(inventory, economy) {
  const investment = { weapon: 0, vitality: 0, spirit: 0 };
  for (const item of inventory) investment[item.category.toLowerCase()] += number(item.total_cost);

  const bonuses = { weaponDamagePercent: 0, vitalityHealthPercent: 0, spiritPower: 0 };
  const crossed = [];
  for (const threshold of economy.investment_thresholds || []) {
    for (const category of ["weapon", "vitality", "spirit"]) {
      if (investment[category] < threshold.category_investment) continue;
      const bonus = threshold.bonuses?.[category]?.cumulative_bonus;
      if (category === "weapon") bonuses.weaponDamagePercent = number(bonus);
      if (category === "vitality") bonuses.vitalityHealthPercent = number(bonus);
      if (category === "spirit") bonuses.spiritPower = number(bonus);
      crossed.push(`${category}:${threshold.category_investment}`);
    }
  }
  return { investment, bonuses, crossed };
}

function slotCapacity(request, slots) {
  const unlocked = Math.max(0, Math.min(number(request.unlockedExtraSlots), (slots.unlocks || []).length));
  return number(slots.starting_slots?.universal) + unlocked;
}

function isActive(item) {
  return Boolean(item.active_type);
}

function buildEvent(state, item, payment, type, replacedItem = null, economy = null) {
  const snapshot = thresholdSnapshot(state.inventory, economy);
  return {
    item,
    upgradeFrom: replacedItem,
    step: state.events.length + 1,
    item_id: item.item_id,
    item_name: item.name,
    purchase_type: type,
    component_used: replacedItem?.item_id || "",
    cash_cost: payment,
    total_spent: state.spent,
    weapon_investment: snapshot.investment.weapon,
    vitality_investment: snapshot.investment.vitality,
    spirit_investment: snapshot.investment.spirit,
    thresholds_crossed: snapshot.crossed,
    normal_slots_used: state.inventory.length,
    active_slots_used: state.activeItems,
    replaces_item_id: replacedItem?.item_id || ""
  };
}

export function createInitialBuildState() {
  return { inventory: [], spent: 0, grossSpent: 0, activeItems: 0, events: [] };
}

export function applyPurchase(state, item, request, data) {
  const next = cloneState(state);
  const payment = number(item.total_cost);
  if (next.spent + payment > number(request.budget)) return { ok: false, reason: "BUDGET_EXCEEDED" };
  if (next.inventory.some((owned) => owned.item_id === item.item_id)) return { ok: false, reason: "ITEM_ALREADY_OWNED" };
  const ancestors = upgradeAncestors(item.item_id, data);
  if (next.inventory.some((owned) => ancestors.has(owned.item_id) || upgradeAncestors(owned.item_id, data).has(item.item_id))) {
    return { ok: false, reason: "UPGRADE_FAMILY_ALREADY_OWNED" };
  }
  if (next.inventory.length >= slotCapacity(request, data.slots)) return { ok: false, reason: "SLOT_CAPACITY_EXCEEDED" };
  if (isActive(item) && next.activeItems >= Math.min(number(data.slots.active_item_limit), number(request.maxActiveItems))) {
    return { ok: false, reason: "ACTIVE_ITEM_LIMIT_EXCEEDED" };
  }
  next.inventory.push(item);
  next.spent += payment;
  next.grossSpent += payment;
  if (isActive(item)) next.activeItems += 1;
  next.events.push(buildEvent(next, item, payment, "purchase", null, data.economy));
  return { ok: true, state: next };
}

export function applyUpgrade(state, edge, request, data) {
  if (/mehrere Komponenten/i.test(edge.notes || "")) return { ok: false, reason: "MULTI_COMPONENT_PAYMENT_UNRESOLVED" };
  const target = data.itemsById.get(edge.to_item_id);
  const componentIndex = state.inventory.findIndex((item) => item.item_id === edge.from_item_id);
  if (!target || componentIndex < 0) return { ok: false, reason: "UPGRADE_COMPONENT_MISSING" };
  const next = cloneState(state);
  const payment = number(edge.additional_cost);
  if (next.spent + payment > number(request.budget)) return { ok: false, reason: "BUDGET_EXCEEDED" };
  if (next.inventory.some((owned) => owned.item_id === target.item_id)) return { ok: false, reason: "ITEM_ALREADY_OWNED" };
  const replaced = next.inventory[componentIndex];
  const activeAfter = next.activeItems - Number(isActive(replaced)) + Number(isActive(target));
  if (activeAfter > Math.min(number(data.slots.active_item_limit), number(request.maxActiveItems))) {
    return { ok: false, reason: "ACTIVE_ITEM_LIMIT_EXCEEDED" };
  }
  next.inventory.splice(componentIndex, 1, target);
  next.activeItems = activeAfter;
  next.spent += payment;
  next.grossSpent += payment;
  next.events.push(buildEvent(next, target, payment, "upgrade", replaced, data.economy));
  return { ok: true, state: next, warning: "UNC-0004" };
}

export function applyReplacement(state, soldItem, item, request, data) {
  const componentIndex = state.inventory.findIndex((owned) => owned.item_id === soldItem.item_id);
  if (componentIndex < 0) return { ok: false, reason: "REPLACED_ITEM_MISSING" };
  if (soldItem.item_id === item.item_id || state.inventory.some((owned) => owned.item_id === item.item_id)) {
    return { ok: false, reason: "ITEM_ALREADY_OWNED" };
  }
  const next = cloneState(state);
  const proceeds = number(soldItem.total_cost) * number(data.economy.sellback?.rate);
  const payment = number(item.total_cost) - proceeds;
  if (next.spent + payment > number(request.budget)) return { ok: false, reason: "BUDGET_EXCEEDED" };
  const activeAfter = next.activeItems - Number(isActive(soldItem)) + Number(isActive(item));
  if (activeAfter > Math.min(number(data.slots.active_item_limit), number(request.maxActiveItems))) {
    return { ok: false, reason: "ACTIVE_ITEM_LIMIT_EXCEEDED" };
  }
  next.inventory.splice(componentIndex, 1, item);
  next.activeItems = activeAfter;
  next.spent += payment;
  next.grossSpent += number(item.total_cost);
  const event = buildEvent(next, item, payment, "replacement", soldItem, data.economy);
  event.sale_proceeds = proceeds;
  event.gross_purchase_cost = number(item.total_cost);
  next.events.push(event);
  return { ok: true, state: next };
}

function relevantEffects(item, mechanicsByItem) {
  return (mechanicsByItem.get(item.item_id) || []).filter((effect) =>
    SUPPORTED_WEAPON_MECHANICS.has(effect.mechanic) && itemEffectAvailability(item, effect) === "permanent" && effect.confidence !== "low"
  );
}

function carryEffects(item, mechanicsByItem) {
  return (mechanicsByItem.get(item.item_id) || []).filter((effect) =>
    (SUPPORTED_WEAPON_MECHANICS.has(effect.mechanic) || CARRY_SURVIVAL_MECHANICS.has(effect.mechanic)) &&
    itemEffectAvailability(item, effect) === "permanent" && effect.confidence !== "low"
  );
}

export function assessWeaponItem(item, data, request) {
  if (item.is_public_shop_item !== "true") return { eligible: false, reason: "NOT_PUBLIC_SHOP_ITEM" };
  if (request.activeItemPreference === "none" && isActive(item)) return { eligible: false, reason: "ACTIVE_ITEMS_DISABLED" };
  const effects = relevantEffects(item, data.mechanicsByItem);
  if (effects.length) return { eligible: true, effects };
  const enablesSupportedUpgrade = (data.upgradesByFrom.get(item.item_id) || []).some((edge) => {
    const target = data.itemsById.get(edge.to_item_id);
    return target && relevantEffects(target, data.mechanicsByItem).length;
  });
  return enablesSupportedUpgrade
    ? { eligible: true, effects: [], componentOnly: true }
    : { eligible: false, reason: "NO_SUPPORTED_WEAPON_CONTRIBUTION" };
}

export function assessWeaponCarryItem(item, data, request) {
  if (item.is_public_shop_item !== "true") return { eligible: false, reason: "NOT_PUBLIC_SHOP_ITEM" };
  if (request.activeItemPreference === "none" && isActive(item)) return { eligible: false, reason: "ACTIVE_ITEMS_DISABLED" };
  const heroProfile = buildHeroCapabilityProfile(request.heroId, data);
  if (!heroCanPurchaseItem(item, data, request.heroId)) {
    return { eligible: false, reason: "HERO_HAS_NO_CHARGED_ABILITY" };
  }
  const capabilityProfile = evaluateItemCapabilities(item, data, heroProfile);
  const contributes = Object.values(capabilityProfile.coverage).some(Boolean);
  if (contributes) return { eligible: true, capabilityProfile };
  const enablesSupportedUpgrade = (data.upgradesByFrom.get(item.item_id) || []).some((edge) => {
    const target = data.itemsById.get(edge.to_item_id);
    if (!target) return false;
    return Object.values(evaluateItemCapabilities(target, data, heroProfile).coverage).some(Boolean);
  });
  return enablesSupportedUpgrade
    ? { eligible: true, capabilityProfile, componentOnly: true }
    : { eligible: false, reason: "NO_VERIFIED_CARRY_CONTRIBUTION" };
}

export function itemRequiresChargedAbility(item, data) {
  return (data.mechanicsByItem.get(item.item_id) || []).some((effect) =>
    /charged abilities/i.test(effect.condition || "") ||
    ["bonus_ability_charges", "cooldown_between_charge_reduction"].includes(effect.mechanic)
  );
}

function heroWeaponDps(heroStats, heroId) {
  const stat = heroStats.find((entry) => entry.hero_id === heroId && entry.mechanic === "dps" && entry.stat_group === "weapon");
  return stat ? number(stat.base_value) : null;
}

function heroStat(heroStats, heroId, mechanic) {
  const stat = heroStats.find((entry) => entry.hero_id === heroId && entry.mechanic === mechanic && entry.confidence !== "low");
  return stat ? number(stat.base_value || stat.scaling_value) : null;
}

function permanentWeaponEffects(state, data) {
  const totals = { damageBonus: 0, fireRateBonus: 0, clipFlat: 0, clipPercent: 0, evidence: [] };
  for (const item of state.inventory) {
    for (const effect of relevantEffects(item, data.mechanicsByItem)) {
      if (effect.mechanic === "base_attack_damage_percent") totals.damageBonus += number(effect.value);
      if (effect.mechanic === "bonus_fire_rate") totals.fireRateBonus += number(effect.value);
      if (effect.mechanic === "bonus_clip_size") totals.clipFlat += number(effect.value);
      if (effect.mechanic === "bonus_clip_size_percent") totals.clipPercent += number(effect.value);
      totals.evidence.push(effect.effect_id);
    }
  }
  return totals;
}

function combinedResistance(state, data, mechanics) {
  const sources = [];
  let damageMultiplier = 1;
  for (const item of state.inventory) {
    for (const effect of data.mechanicsByItem.get(item.item_id) || []) {
      if (!mechanics.has(effect.mechanic) || itemEffectAvailability(item, effect) !== "permanent" || effect.confidence === "low") continue;
      const resist = number(effect.value);
      damageMultiplier *= 1 - resist / 100;
      sources.push({ item_id: item.item_id, effect_id: effect.effect_id, resist_percent: resist, origin: "game_data" });
    }
  }
  return {
    percent: (1 - damageMultiplier) * 100,
    damageMultiplier,
    sources,
    stacking_rule: { rule_id: "RES-002", formula: "total_resist=1-product(1-R_i)", origin: "game_data" }
  };
}

function availabilitySummary(profile) {
  return {
    permanent: profile.permanent,
    active: profile.active,
    conditional: profile.conditional,
    treatment: "Werte bleiben nach Verfügbarkeit getrennt; ohne Trigger- und Uptime-Annahme werden sie nicht summiert.",
    origin: "game_data"
  };
}

// In-game purchase legality: charge-only items are unavailable to heroes
// without an ability that uses charges. This is distinct from merely giving a
// zero score to an otherwise purchasable conditional effect.
export function heroCanPurchaseItem(item, data, heroId) {
  return !itemRequiresChargedAbility(item, data) || buildHeroCapabilityProfile(heroId, data).hasChargedAbility;
}

export function evaluateWeaponMechanics(state, request, data) {
  const cached = (request.cacheProfiles === false ? null : WEAPON_MECHANICS_CACHE.get(data)) || new Map();
  const cacheKey = `${request.heroId}:${request.damageFocus || "weapon"}:${state.inventory.map((item) => item.item_id).sort().join("|")}`;
  if (cached.has(cacheKey)) return cached.get(cacheKey);
  const baseBulletDamage = heroStat(data.heroStats, request.heroId, "bullet_damage");
  const baseRoundsPerSecond = heroStat(data.heroStats, request.heroId, "rounds_per_second");
  const baseClip = heroStat(data.heroStats, request.heroId, "clip_size");
  const reloadTime = heroStat(data.heroStats, request.heroId, "reload_time");
  if ([baseBulletDamage, baseRoundsPerSecond, baseClip, reloadTime].some((value) => value === null)) {
    const missing = { valid: false, reason: "HERO_WEAPON_STAT_MISSING" };
    cached.set(cacheKey, missing);
    if (request.cacheProfiles !== false) WEAPON_MECHANICS_CACHE.set(data, cached);
    return missing;
  }
  const effects = permanentWeaponEffects(state, data);
  const thresholds = thresholdSnapshot(state.inventory, data.economy);
  const spiritPower = permanentSpiritPower(state, data) + thresholds.bonuses.spiritPower;
  const spiritRpsScaling = heroStat(data.heroStats, request.heroId, "rounds_per_second_spirit_scaling") || 0;
  const damageBonus = effects.damageBonus + thresholds.bonuses.weaponDamagePercent;
  const roundsPerSecond = (baseRoundsPerSecond + spiritPower * spiritRpsScaling) * (1 + effects.fireRateBonus / 100);
  const clipSize = Math.ceil((baseClip + effects.clipFlat) * (1 + effects.clipPercent / 100));
  const damagePerBullet = baseBulletDamage * (1 + damageBonus / 100);
  const timeToEmptyClip = clipSize / roundsPerSecond;
  const magazineDamage = clipSize * damagePerBullet;
  const cycleTime = timeToEmptyClip + reloadTime;
  const weaponDamageAt = (seconds) => {
    const elapsed = Math.max(0, number(seconds));
    const fullCycles = Math.floor(elapsed / cycleTime);
    const remaining = elapsed - fullCycles * cycleTime;
    const remainingShots = Math.min(clipSize, remaining * roundsPerSecond);
    return (fullCycles * clipSize + remainingShots) * damagePerBullet;
  };
  const profile = {
    valid: true,
    damage_per_bullet: damagePerBullet,
    rounds_per_second: roundsPerSecond,
    clip_size: clipSize,
    reload_time: reloadTime,
    damage_per_full_magazine: magazineDamage,
    time_to_empty_clip: timeToEmptyClip,
    sustained_cycle_dps: magazineDamage / cycleTime,
    firing_uptime: timeToEmptyClip / cycleTime,
    weaponDamageAt,
    formula: "weaponDamage(t)=(vollständige Zyklen×Magazinschaden+min(Magazingröße, Restzeit×Schüsse/s)×Schaden/Schuss); während Reload bleibt der Schaden konstant.",
    inputs: {
      base_bullet_damage: { value: baseBulletDamage, origin: "game_data" },
      base_rounds_per_second: { value: baseRoundsPerSecond, origin: "game_data" },
      base_clip_size: { value: baseClip, origin: "game_data" },
      reload_time: { value: reloadTime, origin: "game_data" },
      permanent_effects: { origin: "game_data", effect_ids: effects.evidence }
    },
    thresholds,
    effects
  };
  cached.set(cacheKey, profile);
  if (request.cacheProfiles !== false) WEAPON_MECHANICS_CACHE.set(data, cached);
  return profile;
}

// Ability damage is intentionally conservative: a `damage` row is one
// source-backed hit per cast; a `dps` row contributes only for an explicitly
// recorded duration. Unknown trigger, tick semantics and skill upgrades stay
// outside the baseline instead of becoming assumed damage.
export function evaluateSpiritMechanics(state, request, data) {
  const spiritPower = permanentSpiritPower(state, data) + thresholdSnapshot(state.inventory, data.economy).bonuses.spiritPower;
  const abilities = data.abilities.filter((ability) => ability.hero_id === request.heroId && ability.is_active === "true");
  const rows = abilities.map((ability) => {
    const effects = data.abilityMechanics.filter((effect) => effect.ability_id === ability.ability_id && effect.confidence !== "low");
    const cooldown = number(effects.find((effect) => effect.mechanic === "ability_cooldown")?.value || ability.base_cooldown);
    const castDelay = number(effects.find((effect) => effect.mechanic === "ability_cast_delay")?.value);
    const duration = number(effects.find((effect) => ["ability_duration", "debuff_duration", "burn_duration"].includes(effect.mechanic))?.value);
    let perCast = 0;
    for (const effect of effects) {
      const scaled = number(effect.value) + (effect.scaling_attribute === "spirit" ? number(effect.scaling_coefficient) * spiritPower : 0);
      if (effect.effect_type === "damage" && effect.unit === "damage") perCast += scaled;
      if (effect.mechanic === "dps" && effect.unit === "damage_per_second" && duration > 0) perCast += scaled * duration;
    }
    return { abilityId: ability.ability_id, cooldown, castDelay, duration, perCast,
      included: perCast > 0 && cooldown > 0,
      excluded: perCast === 0 ? "Kein eindeutig berechenbarer Schaden mit Dauer/Cooldown." : null };
  });
  const damageAt = (seconds) => rows.reduce((total, row) => {
    if (!row.included || seconds <= 0) return total;
    return total + (1 + Math.floor(Math.max(0, seconds - Number.EPSILON) / row.cooldown)) * row.perCast;
  }, 0);
  const castTimeAt = (seconds) => rows.reduce((total, row) => row.included
    ? total + (1 + Math.floor(Math.max(0, seconds - Number.EPSILON) / row.cooldown)) * row.castDelay : total, 0);
  return { spiritPower, abilities: rows, damageAt, castTimeAt,
    sustainedDps: damageAt(60) / 60,
    treatment: "Nur belegter Basisschaden, Spirit-Skalierung, Cooldown und Cast-Delay aktiver Fähigkeiten; unbekannte Treffer-, Tick- und Skillzustände bleiben ausgeschlossen." };
}

function focusDamageModel(weapon, spirit, focus) {
  const weaponDamageAt = (seconds) => weapon.weaponDamageAt(seconds);
  const abilityDamageAt = (seconds) => spirit.damageAt(seconds);
  if (focus === "spirit") return { damageAt: abilityDamageAt, weaponDamageAt: () => 0, abilityDamageAt, label: "Spirit" };
  if (focus === "hybrid") return {
    // Cast delays are source-backed and remove the same time from weapon fire;
    // this prevents counting concurrent weapon fire during a cast.
    damageAt: (seconds) => abilityDamageAt(seconds) + weaponDamageAt(Math.max(0, seconds - spirit.castTimeAt(seconds))),
    weaponDamageAt: (seconds) => weaponDamageAt(Math.max(0, seconds - spirit.castTimeAt(seconds))), abilityDamageAt, label: "Hybrid"
  };
  return { damageAt: weaponDamageAt, weaponDamageAt, abilityDamageAt: () => 0, label: "Weapon" };
}

export function createCarryScenarioPlan() {
  const model = (id, label, seconds, range) => ({
    id,
    label,
    duration_seconds: seconds,
    duration_variation_seconds: range,
    origin: "model_assumption",
    reason: "Offen ausgewiesenes Vergleichsfenster; Gegnerresistenzen, Trefferquote und Ablauf werden nicht erfunden."
  });
  return {
    incoming_damage_model: {
      raw_damage_per_second: 100,
      unit: "normalisierter Rohschaden/s",
      origin: "model_assumption",
      reason: "Fester Vergleichsmaßstab für Schutz und Heilung, keine Behauptung über gegnerischen Schaden."
    },
    incoming_damage_sensitivity: [0.5, 1, 2].map((multiplier) => ({
      id: `relative_${multiplier}x`,
      raw_damage_per_second: 100 * multiplier,
      unit: "normalisierter Rohschaden/s",
      origin: "model_assumption",
      reason: "Sensitivität um denselben Vergleichsmaßstab; keine Aussage über ein konkretes Gegnerprofil."
    })),
    conditional_effect_policy: {
      value: "excluded_from_baseline",
      origin: "model_assumption",
      reason: "Für Trigger, Uptime und Zielbedingungen gibt es keine allgemeine, verifizierte Annahme."
    },
    scenarios: [
      model("lane_trade", "Lane: wiederholter Trade", 10, [6, 14]),
      model("farm", "Farmen", 10, [6, 14]),
      model("skirmish", "Kurzer Heldenkampf", 4, [3, 6]),
      model("teamfight", "Längerer Teamkampf", 10, [8, 14])
    ],
    planning_budgets: [35000, 40000, 45000, 60000].map((souls) => ({
      souls,
      origin: "model_assumption",
      reason: "Vom Nutzer gewünschter Planungspunkt, keine behauptete Matchphase."
    }))
  };
}

export function evaluateCarryScenarios(state, request, data) {
  const cached = (request.cacheProfiles === false ? null : SCENARIO_PROFILE_CACHE.get(data)) || new Map();
  const cacheKey = `${request.heroId}:${request.damageFocus || "weapon"}:${state.inventory.map((item) => item.item_id).sort().join("|")}`;
  if (cached.has(cacheKey)) return cached.get(cacheKey);
  const plan = createCarryScenarioPlan();
  const weapon = evaluateWeaponMechanics(state, request, data);
  const spirit = evaluateSpiritMechanics(state, request, data);
  const focus = request.damageFocus || "weapon";
  if (!["weapon", "spirit", "hybrid"].includes(focus)) return { valid: false, reason: "UNSUPPORTED_DAMAGE_FOCUS", plan };
  const damageModel = weapon.valid ? focusDamageModel(weapon, spirit, focus) : null;
  const baseHealth = heroStat(data.heroStats, request.heroId, "max_health");
  const baseRegen = heroStat(data.heroStats, request.heroId, "base_health_regen");
  if (!weapon.valid || baseHealth === null) {
    const missing = { valid: false, reason: "HERO_COMBAT_STAT_MISSING", plan };
    cached.set(cacheKey, missing);
    if (request.cacheProfiles !== false) SCENARIO_PROFILE_CACHE.set(data, cached);
    return missing;
  }
  const thresholds = thresholdSnapshot(state.inventory, data.economy);
  const heroProfile = buildHeroCapabilityProfile(request.heroId, data);
  const capabilities = evaluateBuildCapabilities(state, data, heroProfile);
  const health = (baseHealth + capabilities.permanent.bonusHealth) * (1 + thresholds.bonuses.vitalityHealthPercent / 100);
  const effectiveHealth = (resist) => resist >= 100 ? null : health / (1 - resist / 100);
  const bulletResistance = combinedResistance(state, data, new Set(["bullet_resist"]));
  const spiritResistance = combinedResistance(state, data, new Set(["spirit_resist", "tech_resist"]));
  const permanentBulletLifesteal = capabilities.sustain.combatHealing.bulletLifestealPercent / 100;
  const permanentRegen = (baseRegen || 0) + capabilities.sustain.regeneration.alwaysHealthPerSecond;
  const survivalCapacity = (resist, duration, weaponDamage, includeBulletLifesteal) => {
    const recovery = permanentRegen * duration + (includeBulletLifesteal ? weaponDamage * permanentBulletLifesteal : 0);
    const rawCapacity = health + recovery;
    return resist >= 100 ? null : rawCapacity / (1 - resist / 100);
  };
  const common = {
    sustained_weapon_dps: focus === "weapon" ? weapon.sustained_cycle_dps : focus === "spirit" ? spirit.sustainedDps : damageModel.damageAt(60) / 60,
    damage_per_bullet: weapon.damage_per_bullet,
    rounds_per_second: weapon.rounds_per_second,
    clip_size: weapon.clip_size,
    reload_time: weapon.reload_time,
    damage_per_full_magazine: weapon.damage_per_full_magazine,
    time_to_empty_clip: weapon.time_to_empty_clip,
    firing_uptime: weapon.firing_uptime,
    health,
    effective_health_bullet: effectiveHealth(bulletResistance.percent),
    effective_health_spirit: effectiveHealth(spiritResistance.percent),
    bullet_resist: bulletResistance.percent,
    spirit_resist: spiritResistance.percent,
    resistance_sources: { bullet: bulletResistance, spirit: spiritResistance },
    combat_healing: capabilities.sustain.combatHealing,
    sustain_by_availability: availabilitySummary(capabilities.sustainByAvailability),
    mobility_by_availability: availabilitySummary(capabilities.mobilityByAvailability),
    out_of_combat_regen: (baseRegen || 0) + capabilities.sustain.regeneration.outOfCombatHealthPerSecond,
    permanent_regen: permanentRegen,
    recovery_model: {
      short_fight_seconds: 4,
      long_fight_seconds: 10,
      bullet_lifesteal_percent: capabilities.sustain.combatHealing.bulletLifestealPercent,
      ability_lifesteal_percent_excluded: capabilities.sustain.combatHealing.abilityLifestealPercent,
      on_kill_heal_excluded: capabilities.sustain.combatHealing.onKillHeal,
      treatment: "Nur permanente Regeneration und permanenter Bullet-Lifesteal werden gegen belegte Weapon-Damage verrechnet; Treffer, Kills und Ability-Schaden werden nicht erfunden."
    },
    access: { direct: capabilities.directAccess, conditional: capabilities.conditionalAccess },
    mobility: capabilities.mobility,
    weapon_geometry: heroProfile.weaponGeometry,
    kit_coverage: heroProfile.kitCoverage,
    item_kit_synergies: capabilities.synergies,
    damage_focus: focus,
    spirit_mechanics: spirit,
    active_effects: capabilities.sources.filter((source) => source.availability === "active")
      .map((source) => ({ ...source, treatment: "sichtbar, aber ohne angenommene Uptime oder Trefferwirkung" })),
    hero_active_effects: heroProfile.sources.filter((source) => source.availability !== "permanent")
      .map((source) => ({ ...source, treatment: "Heldenmechanik belegt; ohne Ability-Level-, Treffer- oder Uptime-Annahme nicht in DPS/EHP eingerechnet" })),
    item_hero_interactions: capabilities.synergies,
    conditional_effects_excluded: capabilities.sources.filter((source) => source.availability !== "permanent")
      .map((source) => ({ effect_id: source.effect_id, item_id: source.item_id, trigger: source.trigger, cooldown: source.cooldown, duration: source.duration, origin: "game_data" }))
  };
  const profile = {
    valid: true,
    plan,
    weaponMechanics: weapon,
    inputs: {
      ...weapon.inputs,
      base_health: { value: baseHealth, origin: "game_data" },
      hero_level: request.heroLevel === undefined || request.heroLevel === null
        ? { value: null, origin: "unknown", treatment: "Nur kanonische Basiswerte; Level-/Boon-Wachstum wird nicht ergänzt." }
        : { value: request.heroLevel, origin: "model_input", treatment: "Der Wert wird ausgewiesen, aber ohne verifizierte Level→Boon-Zuordnung nicht in Werte übersetzt." },
      ability_levels: request.abilityLevels
        ? { value: request.abilityLevels, origin: "model_input", treatment: "Nicht in Item- oder Kampfwerte übersetzt; gemeinsame Skill-/Item-Suche ist noch offen." }
        : { value: null, origin: "unknown", treatment: "Fähigkeitszustand ist nicht modelliert und liefert keine stillschweigenden Kampfboni." },
      formulas: [
        { value: "final_ammo=ceil((base_ammo+flat_bonuses)*(1+sum(percent_bonuses)))", origin: "game_data", source: "AMMO-001" },
        { value: "cycle_dps=(clip*damage_per_bullet)/(clip/rounds_per_second+reload_time)", origin: "model_assumption", reason: "Vergleichsformel für kontinuierliches Feuern ohne Trefferquote, Falloff oder Zielresistenzen." },
        { value: "effective_health=health/(1-resist)", origin: "model_assumption", reason: "Resistenzanwendung für getrennten Bullet-/Spirit-Vergleich; Kappung ist nicht ergänzt." },
        { value: "spirit→weapon_dps wird ausschließlich über verifizierte rounds_per_second_spirit_scaling hergeleitet; sustained_dps_spirit_scaling wird als abgeleitete Kennzahl nicht zusätzlich addiert.", origin: "game_data", source: "warden:rounds_per_second_spirit_scaling" }
      ]
    },
    common,
    scenarios: plan.scenarios.map((scenario) => {
      const damage = damageModel.damageAt(scenario.duration_seconds);
      const weaponDamage = damageModel.weaponDamageAt(scenario.duration_seconds);
      const combo = request.heroId === "warden" ? wardenSlowingHexBindingWordCombo(state, data, weapon, scenario) : null;
      const incomingRawDamage = plan.incoming_damage_model.raw_damage_per_second * scenario.duration_seconds;
      const bulletRecovery = permanentRegen * scenario.duration_seconds + weaponDamage * permanentBulletLifesteal;
      const spiritRecovery = permanentRegen * scenario.duration_seconds;
      return {
        ...scenario,
        ...common,
        window_damage: damage,
        window_dps: damage / scenario.duration_seconds,
        survival_capacity_bullet: survivalCapacity(bulletResistance.percent, scenario.duration_seconds, weaponDamage, true),
        survival_capacity_spirit: survivalCapacity(spiritResistance.percent, scenario.duration_seconds, damage, false),
        recovery_health: bulletRecovery,
        incoming_damage: {
          raw: incomingRawDamage,
          bullet_after_resist: incomingRawDamage * bulletResistance.damageMultiplier,
          spirit_after_resist: incomingRawDamage * spiritResistance.damageMultiplier,
          bullet_remaining_health: health + bulletRecovery - incomingRawDamage * bulletResistance.damageMultiplier,
          spirit_remaining_health: health + spiritRecovery - incomingRawDamage * spiritResistance.damageMultiplier,
          origin: "model_assumption",
          treatment: "Vergleich gegen den offen ausgewiesenen normalisierten Rohschadenstrom; kein Gegnerprofil."
        },
        incoming_damage_sensitivity: plan.incoming_damage_sensitivity.map((assumption) => {
          const raw = assumption.raw_damage_per_second * scenario.duration_seconds;
          return { ...assumption,
            bullet_remaining_health: health + bulletRecovery - raw * bulletResistance.damageMultiplier,
            spirit_remaining_health: health + spiritRecovery - raw * spiritResistance.damageMultiplier };
        }),
        active_combo: combo,
        combo_failure: combo?.available ? { value: 0, outcome: "failure_branch", treatment: "Bei verfehlter oder nicht ausführbarer Combo wird kein aktiver Bonus angerechnet." } : null
      };
    })
  };
  cached.set(cacheKey, profile);
  if (request.cacheProfiles !== false) SCENARIO_PROFILE_CACHE.set(data, cached);
  return profile;
}

// Search ranking needs only the seven numeric metrics.  Keeping this separate
// from the audit-rich scenario profile avoids recreating sources, plans and
// interaction display rows for every transient inventory the search visits.
export function evaluateCarrySearchMetrics(state, request, data) {
  const weapon = evaluateWeaponMechanics(state, request, data);
  const spirit = evaluateSpiritMechanics(state, request, data);
  const focus = request.damageFocus || "weapon";
  if (!["weapon", "spirit", "hybrid"].includes(focus)) return { valid: false, reason: "UNSUPPORTED_DAMAGE_FOCUS" };
  const damageModel = weapon.valid ? focusDamageModel(weapon, spirit, focus) : null;
  const baseHealth = heroStat(data.heroStats, request.heroId, "max_health");
  const baseRegen = heroStat(data.heroStats, request.heroId, "base_health_regen");
  if (!weapon.valid || baseHealth === null) return { valid: false, reason: "HERO_COMBAT_STAT_MISSING" };
  const thresholds = thresholdSnapshot(state.inventory, data.economy);
  const heroProfile = buildHeroCapabilityProfile(request.heroId, data);
  let bonusHealth = 0, bulletLifestealPercent = 0, regen = baseRegen || 0;
  for (const item of state.inventory) {
    const profile = evaluateItemCapabilities(item, data, heroProfile);
    bonusHealth += profile.permanent.bonusHealth;
    bulletLifestealPercent += profile.sustainByAvailability.permanent.combatHealing.bulletLifestealPercent;
    regen += profile.sustainByAvailability.permanent.regeneration.alwaysHealthPerSecond;
  }
  const resistance = (mechanics) => {
    let multiplier = 1;
    for (const item of state.inventory) for (const effect of data.mechanicsByItem.get(item.item_id) || []) {
      if (mechanics.has(effect.mechanic) && itemEffectAvailability(item, effect) === "permanent" && effect.confidence !== "low") {
        multiplier *= 1 - number(effect.value) / 100;
      }
    }
    return multiplier;
  };
  const bulletMultiplier = resistance(new Set(["bullet_resist"]));
  const spiritMultiplier = resistance(new Set(["spirit_resist", "tech_resist"]));
  if (bulletMultiplier <= 0 || spiritMultiplier <= 0) return { valid: false, reason: "UNBOUNDED_SURVIVAL_CAPACITY" };
  const health = (baseHealth + bonusHealth) * (1 + thresholds.bonuses.vitalityHealthPercent / 100);
  const damageAt = (seconds) => damageModel.damageAt(seconds);
  const weaponDamageAt = (seconds) => damageModel.weaponDamageAt(seconds);
  const teamfightDamage = damageAt(10);
  const metrics = {
    valid: true,
    metrics: {
      sustainedWeaponDps: focus === "weapon" ? weapon.sustained_cycle_dps : focus === "spirit" ? spirit.sustainedDps : damageAt(60) / 60,
      laneTradeWindowDps: damageAt(10) / 10,
      farmWindowDps: damageAt(10) / 10,
      skirmishWindowDps: damageAt(4) / 4,
      teamfightWindowDps: teamfightDamage / 10,
      bulletEhp: (health + regen * 10 + weaponDamageAt(10) * (bulletLifestealPercent / 100)) / bulletMultiplier,
      spiritEhp: (health + regen * 10) / spiritMultiplier
    }
  };
  if (Object.values(metrics.metrics).some((value) => !Number.isFinite(value) || value < 0)) {
    return { valid: false, reason: "INVALID_SEARCH_METRICS" };
  }
  return metrics;
}

function permanentSpiritPower(state, data) {
  let total = 0;
  for (const item of state.inventory) {
    for (const effect of data.mechanicsByItem.get(item.item_id) || []) {
      if (!["spirit_power", "tech_power"].includes(effect.mechanic)) continue;
      if (!ALWAYS_AVAILABLE.test(effect.condition || "") || effect.confidence === "low") continue;
      total += number(effect.value);
    }
  }
  return total;
}

export function evaluateWeaponState(state, request, data) {
  const scenarios = evaluateCarryScenarios(state, request, data);
  if (!scenarios.valid) return { valid: false, reason: scenarios.reason };
  const thresholds = thresholdSnapshot(state.inventory, data.economy);
  const effects = permanentWeaponEffects(state, data);
  return {
    valid: true,
    baseDps: heroWeaponDps(data.heroStats, request.heroId),
    damageBonus: effects.damageBonus + thresholds.bonuses.weaponDamagePercent,
    fireRateBonus: effects.fireRateBonus,
    spiritPower: permanentSpiritPower(state, data) + thresholds.bonuses.spiritPower,
    finalDps: scenarios.common.sustained_weapon_dps,
    evidence: effects.evidence,
    thresholds,
    scenarios,
    calculationScope: "identisch_mit_carry_scenarios"
  };
}

export function evaluateWeaponCarryProfile(state, request, data, options = {}) {
  const weapon = evaluateWeaponState(state, request, data);
  if (!weapon.valid) return weapon;
  const heroProfile = buildHeroCapabilityProfile(request.heroId, data);
  const capabilities = evaluateBuildCapabilities(state, data, heroProfile);
  capabilities.permanent.spiritPower += weapon.thresholds.bonuses.spiritPower;
  const pathMilestones = buildPathMilestones(state, data, heroProfile, "weapon");
  const foundations = buildRobustFoundationStatus(state, request, data, heroProfile);
  const practical = {
    bonusHealth: 0,
    bulletResist: 0,
    spiritResist: 0,
    bulletLifesteal: 0,
    healthRegen: 0,
    sprintSpeed: 0
  };
  for (const item of state.inventory) {
    for (const effect of carryEffects(item, data.mechanicsByItem)) {
      if (effect.mechanic === "bonus_health" || effect.mechanic === "bonus_base_health") practical.bonusHealth += number(effect.value);
      if (effect.mechanic === "bullet_resist") practical.bulletResist += number(effect.value);
      if (effect.mechanic === "spirit_resist" || effect.mechanic === "tech_resist") practical.spiritResist += number(effect.value);
      if (effect.mechanic === "bullet_lifesteal_percent") practical.bulletLifesteal += number(effect.value);
      if (effect.mechanic === "bonus_health_regen" || effect.mechanic === "out_of_combat_health_regen") practical.healthRegen += number(effect.value);
      if (effect.mechanic === "bonus_sprint_speed") practical.sprintSpeed += number(effect.value);
    }
  }
  practical.bulletResist = weapon.scenarios.common.bullet_resist;
  practical.spiritResist = weapon.scenarios.common.spirit_resist;
  const categoryCounts = Object.fromEntries(["Weapon", "Vitality", "Spirit"].map((category) => [category.toLowerCase(), state.inventory.filter((item) => item.category === category).length]));
  const sustainEntries = capabilities.sources.filter((entry) => entry.dimension === "sustain");
  const sustainSources = new Set(sustainEntries.map((entry) => entry.item_id)).size;
  const reliableSustainSources = new Set(sustainEntries.filter((entry) =>
    entry.mechanic !== "heal_on_kill" &&
    !["heal_amp_receive_penalty_percent", "heal_amp_regen_penalty_percent"].includes(entry.mechanic) &&
    (["heal_from_hero", "heal_from_npc"].includes(entry.mechanic) || entry.availability === "permanent")
  ).map((entry) => entry.item_id)).size;
  const permanentSustainSources = new Set(sustainEntries.filter((entry) =>
    entry.availability === "permanent"
  ).map((entry) => entry.item_id)).size;
  const sustainModeCount = [
    capabilities.sustain.laneHealing.heroHit > 0 || capabilities.sustain.laneHealing.npcHit > 0,
    capabilities.sustain.combatHealing.bulletLifestealPercent > 0 || capabilities.sustain.combatHealing.abilityLifestealPercent > 0,
    capabilities.sustain.regeneration.alwaysHealthPerSecond > 0,
    capabilities.sustain.regeneration.outOfCombatHealthPerSecond > 0
  ].filter(Boolean).length;
  const combatCheckpoints = options.includeCheckpoints ? buildCombatCheckpoints(state, request, data, heroProfile) : [];
  return {
    ...weapon,
    practical,
    categoryCounts,
    sustainSources,
    reliableSustainSources,
    permanentSustainSources,
    sustainModeCount,
    combatCheckpoints,
    heroProfile,
    capabilities,
    pathMilestones,
    foundations,
  };
}

function reliableSustainCount(capabilities) {
  return new Set(capabilities.sources.filter((entry) =>
    entry.dimension === "sustain" &&
    entry.mechanic !== "heal_on_kill" &&
    !["heal_amp_receive_penalty_percent", "heal_amp_regen_penalty_percent"].includes(entry.mechanic) &&
    (["heal_from_hero", "heal_from_npc"].includes(entry.mechanic) || entry.availability === "permanent")
  ).map((entry) => entry.item_id)).size;
}

function checkpointBudgets(request, economy) {
  const available = new Set((economy.investment_thresholds || []).map((entry) => number(entry.category_investment)));
  return [3200, 4800].filter((budget) => budget <= number(request.budget) && available.has(budget));
}

function buildCombatCheckpoints(state, request, data, heroProfile) {
  const inventory = [];
  let eventIndex = 0;
  return checkpointBudgets(request, data.economy).map((budget) => {
    while (eventIndex < state.events.length && state.events[eventIndex].total_spent <= budget) {
      const event = state.events[eventIndex];
      if (event.purchase_type === "upgrade") {
        const componentIndex = inventory.findIndex((item) => item.item_id === event.upgradeFrom?.item_id);
        if (componentIndex >= 0) inventory.splice(componentIndex, 1, event.item);
      } else {
        inventory.push(event.item);
      }
      eventIndex += 1;
    }
    const cache = CHECKPOINT_PROFILE_CACHE.get(data) || new Map();
    const cacheKey = `${request.heroId}:${inventory.map((item) => item.item_id).sort().join("|")}`;
    let profile = cache.get(cacheKey);
    if (!profile) {
      const checkpointState = { inventory: [...inventory], events: [], spent: budget, activeItems: 0 };
      const capabilities = evaluateBuildCapabilities(checkpointState, data, heroProfile);
      const weapon = evaluateWeaponState(checkpointState, request, data);
      const common = weapon.scenarios?.common;
      profile = {
        weaponOperation: capabilities.weaponOperation,
        reliableSustainSources: reliableSustainCount(capabilities),
        protectionPresent: capabilities.permanent.bonusHealth > 0 ||
          (common?.bullet_resist || 0) > 0 || (common?.spirit_resist || 0) > 0,
        bonusHealth: capabilities.permanent.bonusHealth,
        bulletResist: common?.bullet_resist || 0,
        spiritResist: common?.spirit_resist || 0,
        finalDps: weapon.finalDps
      };
      cache.set(cacheKey, profile);
      CHECKPOINT_PROFILE_CACHE.set(data, cache);
    }
    return {
      budget,
      unspentSouls: budget - (state.events[eventIndex - 1]?.total_spent || 0),
      ...profile
    };
  });
}

function stateAtSpentBudget(state, budget) {
  const snapshot = createInitialBuildState();
  for (const event of state.events) {
    if (event.total_spent > budget) break;
    const replacedIndex = event.upgradeFrom
      ? snapshot.inventory.findIndex((item) => item.item_id === event.upgradeFrom.item_id)
      : -1;
    if (replacedIndex >= 0) snapshot.inventory.splice(replacedIndex, 1, event.item);
    else snapshot.inventory.push(event.item);
    snapshot.spent = event.total_spent;
    snapshot.grossSpent += number(event.gross_purchase_cost || event.cash_cost);
    snapshot.activeItems = snapshot.inventory.filter(isActive).length;
    snapshot.events.push(event);
  }
  return snapshot;
}

function buildRobustFoundationStatus(state, request, data, heroProfile) {
  const checkpoints = [4800, 7200]
    .filter((budget) => budget <= state.spent && budget <= number(request.budget))
    .map((budget) => {
      const snapshot = stateAtSpentBudget(state, budget);
      const capabilities = evaluateBuildCapabilities(snapshot, data, heroProfile);
      const weaponOperation = capabilities.weaponOperation;
      const protection = snapshot.inventory.some((item) => {
        const profile = evaluateItemCapabilities(item, data, heroProfile);
        return profile.permanent.bulletResist > 0 || profile.permanent.spiritResist > 0 ||
          (item.category === "Vitality" && (
            profile.permanent.bonusHealth > 0 ||
            profile.coverageByAvailability.protection.active ||
            profile.coverageByAvailability.protection.permanent
          ));
      });
      const sustain = snapshot.inventory.some((item) => {
        const itemSustain = evaluateItemCapabilities(item, data, heroProfile).sustainByAvailability;
        return [itemSustain.permanent, itemSustain.conditional].some((profile) =>
          profile.laneHealing.heroHit > 0 ||
          profile.laneHealing.npcHit > 0 ||
          profile.combatHealing.bulletLifestealPercent > 0 ||
          profile.combatHealing.abilityLifestealPercent > 0 ||
          profile.regeneration.alwaysHealthPerSecond > 0 ||
          profile.regeneration.outOfCombatHealthPerSecond > 0
        );
      });
      return {
        budget,
        spent: snapshot.spent,
        weaponOperation,
        protection,
        sustain,
        fulfilled: budget === 4800
          ? weaponOperation && (protection || sustain)
          : weaponOperation && protection && sustain,
        origin: "model_assumption"
      };
    });
  const expected = [4800, 7200].filter((budget) => budget <= state.spent && budget <= number(request.budget));
  return {
    checkpoints,
    passed: checkpoints.length === expected.length && checkpoints.every((entry) => entry.fulfilled),
    rule: "Robuster Standardpfad: bei 4'800 Souls mindestens Weapon-Wirkung plus Schutz oder ein bereits gekauftes Sustain-Item; bei 7'200 Souls Weapon-Wirkung, Schutz und ein bereits gekauftes Sustain-Item. Schutz bedeutet hierfür ein Vitality-Schutzitem oder eine dauerhafte Bullet-/Spirit-Resistenz; kleine Neben-HP eines Utility-Items genügt nicht. Heldenfähigkeiten zählen nicht als früher Sustain-Ersatz, solange keine Skill- und Level-Reihenfolge modelliert ist. Das sind strukturelle Modellannahmen ohne erfundene HP-/DPS-Schwelle.",
    origin: "model_assumption"
  };
}

function buildBudgetSensitivity(state, request, data) {
  return createCarryScenarioPlan().planning_budgets
    .filter((entry) => entry.souls <= number(request.budget))
    .map((entry) => {
      const snapshot = stateAtSpentBudget(state, entry.souls);
      const scenarios = evaluateCarryScenarios(snapshot, request, data);
      return {
        budget: entry.souls,
        origin: entry.origin,
        spent: snapshot.spent,
        unspent_souls: entry.souls - snapshot.spent,
        inventory: snapshot.inventory.map((item) => item.item_id),
        scenarios: scenarios.valid ? scenarios.common : { valid: false, reason: scenarios.reason }
      };
    });
}

function trajectoryMetrics(scenarios) {
  const common = scenarios.common;
  const laneHealing = common.sustain_by_availability;
  return {
    ...weaponFrontierMetrics(scenarios.weaponMechanics),
    bulletEffectiveHealth: common.effective_health_bullet ?? -Infinity,
    spiritEffectiveHealth: common.effective_health_spirit ?? -Infinity,
    laneHealingPermanentHeroHit: laneHealing.permanent.laneHealing.heroHit,
    laneHealingPermanentNpcHit: laneHealing.permanent.laneHealing.npcHit,
    laneHealingConditionalHeroHit: laneHealing.conditional.laneHealing.heroHit,
    laneHealingConditionalNpcHit: laneHealing.conditional.laneHealing.npcHit,
    combatLifestealPercent: common.combat_healing.bulletLifestealPercent + common.combat_healing.abilityLifestealPercent,
    outOfCombatRegen: common.out_of_combat_regen,
    directAccess: Number(common.access.direct),
    combatMobility: common.mobility.combatMoveSpeed + common.mobility.activeMoveSpeed,
    firingUptime: common.firing_uptime
  };
}

function knownEffect(data, itemId, mechanic) {
  const effect = (data.mechanicsByItem.get(itemId) || []).find((entry) => entry.mechanic === mechanic && entry.confidence !== "low");
  return effect ? number(effect.value) : null;
}

function knownAbilityEffect(data, abilityId, mechanic) {
  const effect = (data.abilityMechanics || []).find((entry) => entry.ability_id === abilityId && entry.mechanic === mechanic && entry.confidence !== "low");
  return effect ? number(effect.value) : null;
}

function wardenSlowingHexBindingWordCombo(state, data, weapon, scenario) {
  const binding = {
    cooldown: knownAbilityEffect(data, "warden_binding_word", "ability_cooldown"), range: knownAbilityEffect(data, "warden_binding_word", "ability_cast_range"),
    castDelay: knownAbilityEffect(data, "warden_binding_word", "ability_cast_delay"), immobilizeDuration: knownAbilityEffect(data, "warden_binding_word", "immobilize_duration")
  };
  const bindingPossible = Object.values(binding).every(Number.isFinite) && scenario.duration_seconds >= binding.castDelay && binding.range > 0 && binding.immobilizeDuration > 0;
  const bindingLockedSeconds = bindingPossible ? Math.min(binding.immobilizeDuration, scenario.duration_seconds - binding.castDelay) : 0;
  const bindingWordAlone = {
    available: bindingPossible,
    locked_seconds: bindingLockedSeconds,
    locked_weapon_damage: bindingPossible ? weapon.weaponDamageAt(bindingLockedSeconds) : 0,
    value: bindingPossible ? weapon.weaponDamageAt(bindingLockedSeconds) / scenario.duration_seconds : 0,
    binding
  };
  const itemId = "upgrade_containment";
  if (!state.inventory.some((item) => item.item_id === itemId)) {
    return { available: false, outcome: "not_available", value: 0, binding_word_alone: bindingWordAlone, reason: "Slowing Hex ist nicht im Inventar." };
  }
  const hex = {
    cooldown: knownEffect(data, itemId, "ability_cooldown"), duration: knownEffect(data, itemId, "ability_duration"),
    range: knownEffect(data, itemId, "ability_cast_range"), castDelay: knownEffect(data, itemId, "ability_cast_delay")
  };
  if (Object.values(hex).some((value) => !Number.isFinite(value)) || Object.values(binding).some((value) => !Number.isFinite(value))) {
    return { available: false, outcome: "missing_data", value: 0, hex, binding, binding_word_alone: bindingWordAlone, reason: "Für die Combo fehlen belegte Timing- oder Reichweitenwerte." };
  }
  const sequenceDelay = hex.castDelay + binding.castDelay;
  const range = Math.min(hex.range, binding.range);
  const possible = scenario.duration_seconds >= sequenceDelay && hex.duration >= sequenceDelay && range > 0 && binding.immobilizeDuration > 0;
  const lockedSeconds = possible ? Math.min(binding.immobilizeDuration, Math.max(0, scenario.duration_seconds - sequenceDelay)) : 0;
  return {
    available: possible,
    outcome: possible ? "success_branch" : "not_available_in_window",
    value: 0,
    binding_word_alone: bindingWordAlone,
    hex_incremental_value: 0,
    locked_weapon_damage: possible ? weapon.weaponDamageAt(lockedSeconds) : 0,
    locked_seconds: lockedSeconds,
    hex, binding, sequence_delay_seconds: sequenceDelay, required_initial_range_meters: range,
    cooldown_limited_uses: Math.min(1, Math.floor(scenario.duration_seconds / Math.max(hex.cooldown, binding.cooldown)) + 1),
    assumptions: [
      "Erfolgszweig: Ziel startet innerhalb der kleineren Reichweite und beide gezielten Aktivierungen treffen.",
      "Kein Trefferanteil, kein automatisches Heranziehen und keine garantierte Combo-Erfolgsquote werden angenommen.",
      "Binding Words belegbarer Kontrollschaden wird getrennt ausgewiesen. Ohne Treffer-, Flucht- oder Skillzustandsdaten ist kein zusätzlicher Hex-Schaden berechenbar; daher 0 Zusatzwert und keine Suchwertung."
    ]
  };
}

/**
 * Zeitfensterfreie Weapon-Dimensionen für Pareto-Vergleiche. Sie verwenden
 * ausschließlich evaluateWeaponMechanics(): Die Suche erfindet damit weder
 * eine bevorzugte Kampfdauer noch eine neue Schadensformel.
 */
function weaponFrontierMetrics(weapon) {
  return {
    damagePerBullet: weapon.damage_per_bullet,
    roundsPerSecond: weapon.rounds_per_second,
    clipSize: weapon.clip_size,
    reloadEfficiency: -weapon.reload_time,
    damagePerFullMagazine: weapon.damage_per_full_magazine,
    sustainedWeaponDps: weapon.sustained_cycle_dps,
    firingUptime: weapon.firing_uptime
  };
}

function trajectoryEventKey(event) {
  return [
    event.purchase_type,
    event.item_id,
    event.total_spent,
    event.upgradeFrom?.item_id || "",
    event.replaces_item_id || ""
  ].join("@");
}

export function buildPathTrajectory(state, request, data) {
  const cachedProfiles = TRAJECTORY_PROFILE_CACHE.get(data) || new Map();
  const maximumTrajectoryBudget = Math.min(
    number(request.budget),
    state.spent,
    Math.max(...TRAJECTORY_BUDGETS.filter((budget) => budget <= number(request.budget) && budget <= state.spent), 0)
  );
  const trajectoryEvents = state.events.filter((event) => number(event.total_spent) <= maximumTrajectoryBudget);
  const cacheKey = `${request.heroId}:${number(request.budget)}:${maximumTrajectoryBudget}:${trajectoryEvents.map(trajectoryEventKey).join("|")}`;
  if (cachedProfiles.has(cacheKey)) return cachedProfiles.get(cacheKey);
  const entries = TRAJECTORY_BUDGETS
    .filter((budget) => budget <= number(request.budget) && budget <= state.spent)
    .map((budget) => {
      const snapshot = stateAtSpentBudget(state, budget);
      const scenarios = evaluateCarryScenarios(snapshot, request, data);
      if (!scenarios.valid) return { budget, valid: false, reason: scenarios.reason };
      return {
        budget,
        spent: snapshot.spent,
        unspentSouls: budget - snapshot.spent,
        inventory: snapshot.inventory.map((item) => item.item_id),
        metrics: trajectoryMetrics(scenarios),
        origin: "model_assumption"
      };
    });
  const trajectory = {
    checkpoints: entries,
    comparisonRule: "Ein Pfad ist nur klar unterlegen, wenn ein anderer an jedem gemeinsamen Planungspunkt in allen ausgewiesenen Wirkungsdimensionen mindestens gleich gut und in mindestens einer besser ist. Nicht dominierte Abwägungen bleiben erhalten.",
    planningBudgets: TRAJECTORY_BUDGETS.filter((budget) => budget <= number(request.budget)),
    origin: "model_assumption"
  };
  cachedProfiles.set(cacheKey, trajectory);
  TRAJECTORY_PROFILE_CACHE.set(data, cachedProfiles);
  return trajectory;
}

function trajectoryDominates(left, right) {
  const leftIndex = trajectoryCheckpointIndex(left.trajectory);
  const rightIndex = trajectoryCheckpointIndex(right.trajectory);
  let hasCommonBudget = false;
  let strictlyBetter = false;
  for (const leftEntry of leftIndex.entries) {
    const rightEntry = rightIndex.byBudget.get(leftEntry.budget);
    if (!rightEntry) continue;
    hasCommonBudget = true;
    for (const metric of leftEntry.metricKeys) {
      if (leftEntry.metrics[metric] < rightEntry.metrics[metric]) return false;
      if (leftEntry.metrics[metric] > rightEntry.metrics[metric]) strictlyBetter = true;
    }
  }
  return hasCommonBudget && strictlyBetter;
}

function trajectoryCheckpointIndex(trajectory) {
  let index = TRAJECTORY_CHECKPOINT_INDEX_CACHE.get(trajectory);
  if (!index) {
    const entries = trajectory.checkpoints
      .filter((entry) => entry.valid !== false)
      .map((entry) => {
        const metrics = { ...entry.metrics, unspentSouls: entry.unspentSouls };
        return { budget: entry.budget, metrics, metricKeys: Object.keys(metrics) };
      });
    index = { entries, byBudget: new Map(entries.map((entry) => [entry.budget, entry])) };
    TRAJECTORY_CHECKPOINT_INDEX_CACHE.set(trajectory, index);
  }
  return index;
}

function trajectoryPareto(candidates, request, data) {
  const withTrajectory = candidates.map((candidate) => ({
    ...candidate,
    trajectory: buildPathTrajectory(candidate.state, request, data)
  }));
  const groups = new Map();
  for (const candidate of withTrajectory) {
    const group = groups.get(candidate.trajectory) || [];
    group.push(candidate);
    groups.set(candidate.trajectory, group);
  }
  const groupEntries = [...groups.entries()];
  const dominatedTrajectories = new Set();
  for (const [trajectory, group] of groupEntries) {
    if (groupEntries.some(([otherTrajectory, otherGroup]) =>
      otherTrajectory !== trajectory && trajectoryDominates(otherGroup[0], group[0])
    )) {
      dominatedTrajectories.add(trajectory);
    }
  }
  return withTrajectory.filter((candidate) => !dominatedTrajectories.has(candidate.trajectory));
}

function inventoryKey(state) {
  return state.inventory.map((item) => item.item_id).sort().join("|");
}

export function purchaseHistoryKey(state) {
  return state.events.map((event) =>
    `${event.purchase_type}:${event.item_id}@${event.total_spent}`
  ).join(">");
}

function searchStateKey(state) {
  return `${inventoryKey(state)}::${purchaseHistoryKey(state)}`;
}

function rankedStates(states, request, data, limit) {
  const unique = new Map();
  for (const state of states) {
    const evaluation = evaluateWeaponState(state, request, data);
    if (!evaluation.valid) continue;
    const current = unique.get(searchStateKey(state));
    if (!current || evaluation.finalDps > current.evaluation.finalDps || (evaluation.finalDps === current.evaluation.finalDps && state.spent < current.state.spent)) {
      unique.set(searchStateKey(state), { state, evaluation });
    }
  }
  return [...unique.values()].sort((left, right) =>
    right.evaluation.finalDps - left.evaluation.finalDps || left.state.spent - right.state.spent || searchStateKey(left.state).localeCompare(searchStateKey(right.state))
  ).slice(0, limit);
}

export function optimizeWeaponCarry(request, data) {
  if (request.objective !== "weapon_magazine_dps") throw new Error("Dieses Optimizer-Slice unterstützt nur weapon_magazine_dps.");
  if (!data.coreManifest || !data.heroManifest || data.coreManifest.patch !== data.heroManifest.patch || data.coreManifest.mode !== data.heroManifest.mode) {
    throw new Error("Core- und Hero-Manifeste sind nicht kompatibel.");
  }
  if (heroWeaponDps(data.heroStats, request.heroId) === null) throw new Error("Für den gewählten Helden fehlt ein verifizierter Weapon-DPS-Basiswert.");

  const eligibleItems = data.items.filter((item) => assessWeaponItem(item, data, request).eligible);
  const eligibleIds = new Set(eligibleItems.map((item) => item.item_id));
  const beamWidth = 40;
  const maxTransactions = Math.max(1, Math.min(number(request.maxTransactions) || 12, 16));
  let frontier = [createInitialBuildState()];
  let allStates = [...frontier];

  for (let turn = 0; turn < maxTransactions; turn += 1) {
    const successors = [];
    for (const state of frontier) {
      for (const item of eligibleItems) {
        const result = applyPurchase(state, item, request, data);
        if (result.ok) successors.push(result.state);
      }
      for (const owned of state.inventory) {
        for (const edge of data.upgradesByFrom.get(owned.item_id) || []) {
          if (!eligibleIds.has(edge.to_item_id)) continue;
          const result = applyUpgrade(state, edge, request, data);
          if (result.ok) successors.push(result.state);
        }
      }
    }
    const ranked = rankedStates(successors, request, data, beamWidth);
    frontier = ranked.map(({ state }) => state);
    allStates.push(...frontier);
    if (!frontier.length) break;
  }

  const candidates = rankedStates(allStates.filter((state) => state.events.length), request, data, 3);
  const winner = candidates[0];
  if (!winner) return { status: "FAIL", reason: "NO_LEGAL_SUPPORTED_PATH" };
  return {
    status: "PASS_WITH_WARNINGS",
    resultLabel: "best_evaluated",
    scope: "Weapon Carry: Magazin-DPS ohne Headshots, Reichweitenfalloff, bedingte Procs oder nicht verifizierte Item×Ability-Interaktionen.",
    request,
    candidateCount: allStates.length,
    eligibleItemCount: eligibleItems.length,
    winner: { ...winner, itemAssessments: winner.state.inventory.map((item) => ({ item_id: item.item_id, ...assessWeaponItem(item, data, request) })) },
    alternatives: candidates.slice(1),
    validation: {
      manifests: "PASS",
      costs_and_upgrades: "PASS",
      investments_and_thresholds: "PASS",
      slots_and_active_limit: "PASS",
      warnings: ["UNC-0004: Temporärer Slotbedarf beim Upgrade ist nicht verifiziert."]
    }
  };
}

function carryPortfolioIsComplete(state, evaluation, request, data) {
  return state.inventory.length === slotCapacity(request, data.slots) &&
    evaluation.scenarios?.valid &&
    evaluation.upgradeFamilyOverlapCount === 0 &&
    evaluation.capabilities.riskCount === 0;
}

function upgradeAncestors(itemId, data) {
  const ancestors = new Set();
  const pending = [itemId];
  while (pending.length) {
    const current = pending.pop();
    for (const edge of data.upgradesByTo.get(current) || []) {
      if (ancestors.has(edge.from_item_id)) continue;
      ancestors.add(edge.from_item_id);
      pending.push(edge.from_item_id);
    }
  }
  return ancestors;
}

function upgradeFamilyOverlapCount(state, data) {
  const owned = new Set(state.inventory.map((item) => item.item_id));
  let overlaps = 0;
  for (const item of state.inventory) {
    for (const ancestor of upgradeAncestors(item.item_id, data)) {
      if (owned.has(ancestor)) overlaps += 1;
    }
  }
  return overlaps;
}

function paretoMetrics(candidate) {
  const { evaluation } = candidate;
  const scenario = evaluation.scenarios.common;
  const laneHealing = scenario.sustain_by_availability;
  return {
    ...weaponFrontierMetrics(evaluation.scenarios.weaponMechanics),
    bulletEffectiveHealth: scenario.effective_health_bullet ?? -Infinity,
    spiritEffectiveHealth: scenario.effective_health_spirit ?? -Infinity,
    health: scenario.health,
    laneHealingPermanentHeroHit: laneHealing.permanent.laneHealing.heroHit,
    laneHealingPermanentNpcHit: laneHealing.permanent.laneHealing.npcHit,
    laneHealingConditionalHeroHit: laneHealing.conditional.laneHealing.heroHit,
    laneHealingConditionalNpcHit: laneHealing.conditional.laneHealing.npcHit,
    combatLifesteal: scenario.combat_healing.bulletLifestealPercent + scenario.combat_healing.abilityLifestealPercent,
    outOfCombatRegen: scenario.out_of_combat_regen,
    directAccess: Number(scenario.access.direct),
    conditionalAccess: Number(scenario.access.conditional),
    combatMobility: scenario.mobility.combatMoveSpeed + scenario.mobility.activeMoveSpeed,
    sprintMobility: scenario.mobility.sprintSpeed,
    robustFoundationReadiness: evaluation.foundations.checkpoints.filter((entry) => entry.fulfilled).length,
    riskSafety: -evaluation.capabilities.riskCount,
    upgradeCoherence: -evaluation.upgradeFamilyOverlapCount
  };
}

function dominates(left, right) {
  if (left.state.spent !== right.state.spent || inventoryKey(left.state) !== inventoryKey(right.state)) return false;
  const leftMetrics = paretoMetrics(left);
  const rightMetrics = paretoMetrics(right);
  const keys = Object.keys(leftMetrics);
  return keys.every((key) => leftMetrics[key] >= rightMetrics[key]) &&
    (left.state.spent < right.state.spent || keys.some((key) => leftMetrics[key] > rightMetrics[key]));
}

const CARRY_SELECTION_PROFILES = [
  {
    id: "balanced_standard",
    label: "Ausgeglichener Carry-Standard",
    damage_weight: 0.45,
    bullet_survival_weight: 0.2,
    spirit_survival_weight: 0.2,
    path_foundation_weight: 0.15
  },
  {
    id: "offensive_variant",
    label: "Offensivere plausible Präferenz",
    damage_weight: 0.55,
    bullet_survival_weight: 0.15,
    spirit_survival_weight: 0.15,
    path_foundation_weight: 0.15
  },
  {
    id: "safer_variant",
    label: "Sicherere plausible Präferenz",
    damage_weight: 0.35,
    bullet_survival_weight: 0.25,
    spirit_survival_weight: 0.25,
    path_foundation_weight: 0.15
  }
];

function positiveRatio(value, baseline) {
  if (!Number.isFinite(value) || !Number.isFinite(baseline) || baseline <= 0) return 1;
  return Math.max(value / baseline, Number.EPSILON);
}

function weightedGeometricMean(parts) {
  return Math.exp(parts.reduce((sum, part) => sum + Math.log(part.value) * part.weight, 0));
}

/**
 * Offene Modellentscheidung für den Standardpfad. Sie ersetzt die Pareto-Prüfung
 * nicht: Sustain, Zugang, Mobilität und Pfadverlauf bleiben eigene Dimensionen.
 */
export function evaluateCarryDecision(candidate, request, data) {
  const baseline = evaluateCarryScenarios(createInitialBuildState(), request, data);
  const scenarios = candidate.evaluation.scenarios;
  if (!baseline.valid || !scenarios?.valid) return null;
  const short = scenarios.scenarios.find((scenario) => scenario.id === "skirmish");
  const long = scenarios.scenarios.find((scenario) => scenario.id === "teamfight");
  const baselineShort = baseline.scenarios.find((scenario) => scenario.id === "skirmish");
  const baselineLong = baseline.scenarios.find((scenario) => scenario.id === "teamfight");
  const foundationCheckpoints = candidate.evaluation.foundations.checkpoints;
  const metrics = {
    short_fight_damage_ratio: positiveRatio(short?.window_damage, baselineShort?.window_damage),
    long_fight_damage_ratio: positiveRatio(long?.window_damage, baselineLong?.window_damage),
    bullet_effective_health_ratio: positiveRatio(scenarios.common.effective_health_bullet, baseline.common.effective_health_bullet),
    spirit_effective_health_ratio: positiveRatio(scenarios.common.effective_health_spirit, baseline.common.effective_health_spirit),
    path_foundation_ratio: foundationCheckpoints.length
      ? foundationCheckpoints.filter((checkpoint) => checkpoint.fulfilled).length / foundationCheckpoints.length
      : 1
  };
  const profiles = CARRY_SELECTION_PROFILES.map((profile) => ({
    ...profile,
    score: weightedGeometricMean([
      { value: metrics.short_fight_damage_ratio, weight: profile.damage_weight / 2 },
      { value: metrics.long_fight_damage_ratio, weight: profile.damage_weight / 2 },
      { value: metrics.bullet_effective_health_ratio, weight: profile.bullet_survival_weight },
      { value: metrics.spirit_effective_health_ratio, weight: profile.spirit_survival_weight },
      { value: Math.max(metrics.path_foundation_ratio, Number.EPSILON), weight: profile.path_foundation_weight }
    ])
  }));
  return {
    method: "dimensionsloser_gewichteter_geometrischer_vergleich",
    origin: "model_assumption",
    rationale: "Der Standardpfad vergleicht anbringbaren Schaden im kurzen und längeren Kampf, getrennte Bullet-/Spirit-Überlebensfähigkeit und den Grad erfüllter, bereits erreichter Frühbasis-Checkpoints. Fehlende Frühbasis wird weich abgewertet, nicht ausgeschlossen. Gewichte und plausible Varianten sind sichtbar statt in einer Reihenfolge versteckt.",
    baseline: "Gleicher Held ohne Items, gleiche Basiswerte und Szenarioannahmen.",
    metrics,
    profiles,
    robust_score: Math.min(...profiles.map((profile) => profile.score)),
    balanced_score: profiles.find((profile) => profile.id === "balanced_standard").score,
    limits: [
      "Trefferquote, Gegnerresistenzen, Bedrohung und bedingte Uptime sind unbekannt und nicht im Score gerechnet.",
      "Sustain, Zugang und Mobilität bleiben ohne erfundene Umrechnung in Schaden eigene Pareto-/Pfaddimensionen. Die Frühbasis nutzt nur den Anteil erfüllter bereits erreichter Struktur-Checkpoints; sie ist kein harter Ausschluss."
    ]
  };
}

function representativeOrder(left, right) {
  const leftMetrics = paretoMetrics(left);
  const rightMetrics = paretoMetrics(right);
  const leftDecision = left.evaluation.carryDecision;
  const rightDecision = right.evaluation.carryDecision;
  return (rightDecision?.robust_score ?? -Infinity) - (leftDecision?.robust_score ?? -Infinity) ||
    (rightDecision?.balanced_score ?? -Infinity) - (leftDecision?.balanced_score ?? -Infinity) ||
    rightMetrics.sustainedWeaponDps - leftMetrics.sustainedWeaponDps ||
    rightMetrics.bulletEffectiveHealth - leftMetrics.bulletEffectiveHealth ||
    rightMetrics.spiritEffectiveHealth - leftMetrics.spiritEffectiveHealth ||
    left.state.spent - right.state.spent ||
    searchStateKey(left.state).localeCompare(searchStateKey(right.state));
}

function neutralSearchOrder(left, right) {
  return searchStateKey(left.state).localeCompare(searchStateKey(right.state));
}

function capabilitySignature(candidate) {
  const { evaluation, state } = candidate;
  const weaponSignature = Object.values(weaponFrontierMetrics(evaluation.scenarios.weaponMechanics)).join(",");
  return [
    state.spent,
    inventoryKey(state),
    weaponSignature,
    ...Object.values(evaluation.capabilities.coverage).map(Number),
    evaluation.foundations.checkpoints.map((entry) => Number(entry.fulfilled)).join(""),
    Math.min(evaluation.capabilities.riskCount, 1),
    Number(evaluation.pathMilestones.majorThresholds.weapon !== null),
    Number(evaluation.pathMilestones.majorThresholds.vitality !== null),
    Number(evaluation.pathMilestones.majorThresholds.spirit !== null)
  ].join(":");
}

export function retainDistinctPurchaseHistories(candidates, perInventory = 3) {
  const groups = new Map();
  for (const candidate of candidates) {
    const key = inventoryKey(candidate.state);
    const byHistory = groups.get(key) || new Map();
    byHistory.set(purchaseHistoryKey(candidate.state), candidate);
    groups.set(key, byHistory);
  }
  return [...groups.values()].flatMap((byHistory) =>
    [...byHistory.values()].slice(0, perInventory)
  );
}

function budgetBalancedSlice(candidates, limit) {
  const groups = new Map();
  for (const candidate of candidates) {
    const group = groups.get(candidate.state.spent) || [];
    group.push(candidate);
    groups.set(candidate.state.spent, group);
  }
  const queues = [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, group]) => group.sort(representativeOrder));
  const selected = [];
  for (let index = 0; selected.length < limit; index += 1) {
    let added = false;
    for (const queue of queues) {
      if (!queue[index]) continue;
      selected.push(queue[index]);
      added = true;
      if (selected.length >= limit) break;
    }
    if (!added) break;
  }
  return selected;
}

function paretoPool(candidates, perSignature = 4) {
  const groups = new Map();
  for (const candidate of candidates) {
    const key = capabilitySignature(candidate);
    const group = groups.get(key) || [];
    group.push(candidate);
    groups.set(key, group);
  }
  return [...groups.values()].flatMap((group) => group.sort(representativeOrder).slice(0, perSignature));
}

export function rankedCarryStates(states, request, data, limit, requireCompletePortfolio = false, options = {}) {
  const unique = new Map();
  for (const state of states) {
    const key = searchStateKey(state);
    const evaluation = evaluateWeaponCarryProfile(state, request, data);
    if (!evaluation.valid) continue;
    evaluation.scenarios = evaluateCarryScenarios(state, request, data);
    if (!evaluation.scenarios.valid) continue;
    evaluation.upgradeFamilyOverlapCount = upgradeFamilyOverlapCount(state, data);
    evaluation.carryDecision = options.includeDecision === false
      ? null
      : evaluateCarryDecision({ state, evaluation }, request, data);
    if (requireCompletePortfolio && !carryPortfolioIsComplete(state, evaluation, request, data)) continue;
    const candidate = { state, evaluation };
    const current = unique.get(key);
    if (!current || representativeOrder(candidate, current) < 0) unique.set(key, candidate);
  }
  const candidates = paretoPool(retainDistinctPurchaseHistories([...unique.values()]));
  const comparisonGroups = new Map();
  for (const [index, candidate] of candidates.entries()) {
    const key = `${candidate.state.spent}:${inventoryKey(candidate.state)}`;
    const group = comparisonGroups.get(key) || [];
    group.push({ candidate, index });
    comparisonGroups.set(key, group);
  }
  const dominated = new Set();
  for (const group of comparisonGroups.values()) {
    for (const { candidate, index } of group) {
      if (group.some(({ candidate: other, index: otherIndex }) => otherIndex !== index && dominates(other, candidate))) {
        dominated.add(index);
      }
    }
  }
  const pareto = candidates.filter((candidate, index) => !dominated.has(index));
  if (!requireCompletePortfolio) return budgetBalancedSlice(pareto, limit);
  const order = options.neutralOrder ? neutralSearchOrder : representativeOrder;
  return pareto.sort(order).slice(0, limit);
}

function oneStepReplacementStates(candidates, eligibleItems, request, data) {
  const states = candidates.map((candidate) => candidate.state);
  for (const candidate of candidates) {
    for (const owned of candidate.state.inventory) {
      for (const item of eligibleItems) {
        const replacement = applyReplacement(candidate.state, owned, item, request, data);
        if (replacement.ok) states.push(replacement.state);
      }
    }
  }
  return states;
}

export function optimizeWeaponCarryFullBuild(request, data) {
  if (request.objective !== "weapon_magazine_dps") throw new Error("Dieses Optimizer-Slice unterstützt nur weapon_magazine_dps.");
  if (!data.coreManifest || !data.heroManifest || data.coreManifest.patch !== data.heroManifest.patch || data.coreManifest.mode !== data.heroManifest.mode) {
    throw new Error("Core- und Hero-Manifeste sind nicht kompatibel.");
  }
  if (heroWeaponDps(data.heroStats, request.heroId) === null) throw new Error("Für den gewählten Helden fehlt ein verifizierter Weapon-DPS-Basiswert.");

  const assumedEndBudget = number(request.budget) || 60000;
  const normalizedRequest = {
    ...request,
    budget: assumedEndBudget,
    unlockedExtraSlots: (data.slots.unlocks || []).length,
    maxActiveItems: 2,
    activeItemPreference: "any",
    robustStandard: true,
    maxTransactions: Math.max(16, number(request.maxTransactions) || 28)
  };
  const eligibleItems = data.items.filter((item) => assessWeaponCarryItem(item, data, normalizedRequest).eligible);
  const eligibleIds = new Set(eligibleItems.map((item) => item.item_id));
  const beamWidth = 30;
  let frontier = [createInitialBuildState()];
  let allStates = [];
  for (let turn = 0; turn < normalizedRequest.maxTransactions; turn += 1) {
    const successors = [];
    for (const state of frontier) {
      for (const item of eligibleItems) {
        const result = applyPurchase(state, item, normalizedRequest, data);
        if (result.ok) successors.push(result.state);
      }
      for (const owned of state.inventory) {
        for (const edge of data.upgradesByFrom.get(owned.item_id) || []) {
          if (!eligibleIds.has(edge.to_item_id)) continue;
          const result = applyUpgrade(state, edge, normalizedRequest, data);
          if (result.ok) successors.push(result.state);
        }
      }
    }
    frontier = rankedCarryStates(successors, normalizedRequest, data, beamWidth).map(({ state }) => state);
    allStates.push(...frontier);
    if (!frontier.length) break;
  }
  const finalPool = rankedCarryStates(
    allStates,
    normalizedRequest,
    data,
    COMPLETE_REPLACEMENT_SEED_LIMIT,
    true,
    { includeDecision: false, neutralOrder: true }
  );
  const seedCandidates = trajectoryPareto(finalPool, normalizedRequest, data);
  const replacementCandidates = rankedCarryStates(
    oneStepReplacementStates(seedCandidates, eligibleItems, normalizedRequest, data),
    normalizedRequest,
    data,
    Number.POSITIVE_INFINITY,
    true,
    { includeDecision: false }
  );
  const finalNonDominated = trajectoryPareto(replacementCandidates, normalizedRequest, data)
    .map((candidate) => {
      const evaluation = evaluateWeaponCarryProfile(candidate.state, normalizedRequest, data, { includeCheckpoints: true });
      evaluation.scenarios = evaluateCarryScenarios(candidate.state, normalizedRequest, data);
      evaluation.upgradeFamilyOverlapCount = upgradeFamilyOverlapCount(candidate.state, data);
      evaluation.carryDecision = evaluateCarryDecision({ state: candidate.state, evaluation }, normalizedRequest, data);
      evaluation.trajectory = candidate.trajectory;
      return { ...candidate, evaluation };
    });
  const candidates = [...finalNonDominated].sort(representativeOrder).slice(0, 3);
  const winner = candidates[0];
  if (!winner) return { status: "FAIL", reason: "NO_COMPLETE_BALANCED_CARRY_PATH" };
  return {
    status: "PASS_WITH_WARNINGS",
    resultLabel: "best_evaluated",
    scope: `Warden Weapon Carry bis ${assumedEndBudget.toLocaleString("de-CH")} Souls: begrenzte Vorwärtssuche mit legalen Käufen, Upgrades und Ersetzungen. Zustände mit gleichem Inventar behalten bis zu drei unterschiedliche Kaufgeschichten; erst danach begrenzt die Suche sie über die offen ausgewiesenen Wirkungs- und Pfaddimensionen. Die Frühbasis bei 4'800/7'200 Souls ist eine sichtbare Bewertungsdimension, kein Ausschlussfilter. Vollständige Pfade werden zusätzlich an 3'200, 4'800, 7'200, 12'000, 20'000, 30'000 und 40'000 Souls verglichen. Für den robusten Standardpfad werden verifizierte Selbst-Risiken ausgeschlossen; sie bleiben ein späterer, separat auszuweisender Risiko-Modus. Die repräsentative Auswahl nutzt einen offen ausgewiesenen Carry-Vergleich aus kurzem/längerem anbringbarem Waffenschaden sowie Bullet-/Spirit-EHP relativ zum gleichen Helden ohne Items und maximiert den schlechtesten Wert aus ausgeglichener, offensiver und sicherer Präferenz. Bedingte Effekte werden mit Trigger, Dauer und Cooldown dokumentiert, aber ohne erfundene Uptime nicht als Dauerbonus gerechnet. Die drei Walker-Slots sind für die 60'000-Souls-Planung als Modellannahme freigeschaltet; die Daten enthalten keine Zuordnung von Walker-Fortschritt zu Souls.`,
    request: normalizedRequest,
    candidateCount: allStates.length,
    eligibleItemCount: eligibleItems.length,
    budgetSensitivity: buildBudgetSensitivity(winner.state, normalizedRequest, data),
    selectionModel: {
      ...winner.evaluation.carryDecision,
      standard_preference: "Maximiere den schlechtesten Score über die drei offengelegten Präferenzprofile; bei Gleichstand zählt die ausgeglichene Präferenz.",
      sensitivity: CARRY_SELECTION_PROFILES.map((profile) => {
        const ordered = [...candidates].sort((left, right) =>
          right.evaluation.carryDecision.profiles.find((entry) => entry.id === profile.id).score -
          left.evaluation.carryDecision.profiles.find((entry) => entry.id === profile.id).score
        );
        return { profile_id: profile.id, preferred_path: searchStateKey(ordered[0].state) };
      })
    },
    searchLimits: {
      beam_width: beamWidth,
      max_transactions: normalizedRequest.maxTransactions,
      replacement_search: "Alle relevanten Shop-Items werden für jeden Slot von bis zu drei innerhalb der bestehenden Suchgrenzen nicht dominierten vollständigen Vorwärtspfaden als einzelne Ersetzung geprüft. Die bestehende Begrenzung ist deterministisch nach Zustands-/Kaufhistorie-Schlüssel, nicht nach einer Modellpräferenz. Tieferketten aus mehreren Verkäufen bleiben außerhalb der ersten schnellen Suche.",
      replacement_depth: 1,
      replacement_seed_limit: COMPLETE_REPLACEMENT_SEED_LIMIT,
      replacement_seed_paths: seedCandidates.length,
      replacement_seed_path_keys: seedCandidates.map((candidate) => searchStateKey(candidate.state)),
      final_non_dominated_paths: finalNonDominated.length
    },
    winner: { ...winner, itemAssessments: winner.state.inventory.map((item) => ({ item_id: item.item_id, ...assessWeaponCarryItem(item, data, normalizedRequest) })) },
    alternatives: candidates.slice(1),
    validation: {
      manifests: "PASS",
      costs_and_upgrades: "PASS",
      investments_and_thresholds: "PASS",
      slots_and_active_limit: "PASS",
      profile_rules: "PASS: geprüfter Warden-Slice; Sustain-, Schutz-, Bewegungs- und Zugangsarten bleiben getrennt. Es gibt keine starre 5-Weapon-/3-Vitality-Endbedingung.",
      path_rules: "PASS: begrenzte Vorwärtssuche, bis zu drei unterschiedliche Kaufgeschichten je Inventar, Pareto-Vergleich bei identischen Soul-Ausgaben und an gemeinsamen Soul-Planungspunkten, Ersetzungen zum verifizierten Sellback-Satz, keine Upgrade-Anzahl als Qualitätsbonus und keine parallelen Vor- und Endstufen derselben Upgrade-Linie.",
      warnings: [
        "UNC-0004: Temporärer Slotbedarf beim Upgrade ist nicht verifiziert.",
        "Die Walker-Slot-Freischaltungen sind als 60'000-Souls-Planungsannahme modelliert; ihre tatsächliche zeitliche Zuordnung ist in den Daten unbekannt.",
        "Die Kaufhistorien-Erhaltung ist technisch auf drei nicht identische Verläufe pro aktuellem Inventar begrenzt; darüber hinaus gilt die Suchbegrenzung, nicht eine Spielregel.",
        "Skill-Reihenfolge und Item×Ability-Uptimes sind noch keine gemeinsam durchsuchte, verifizierte Ebene.",
        `Ersetzungen werden als ein einzelner letzter Schritt über bis zu ${COMPLETE_REPLACEMENT_SEED_LIMIT} nicht dominierte vollständige Vorwärtspfade geprüft. Die bestehende Suchgrenze ist nur deterministisch nach Zustands-/Kaufhistorie-Schlüssel geordnet, nicht nach einer Modellpräferenz; Ketten aus mehreren Verkäufen sind noch nicht Teil der schnellen Suche.`,
        ...(request.budget ? [] : [`Kein Endbudget angegeben; ${assumedEndBudget.toLocaleString("de-CH")} Souls werden als offengelegte Analyseannahme verwendet.`]),
        "Die Skill-Reihenfolge wird in diesem Slice noch nicht gemeinsam mit den Käufen optimiert."
      ]
    }
  };
}

export function buildOptimizerData(raw) {
  const itemsById = new Map(raw.items.map((item) => [item.item_id, item]));
  const mechanicsByItem = new Map();
  for (const mechanic of raw.itemMechanics) {
    const list = mechanicsByItem.get(mechanic.item_id) || [];
    list.push(mechanic);
    mechanicsByItem.set(mechanic.item_id, list);
  }
  const upgradesByFrom = new Map();
  const upgradesByTo = new Map();
  for (const edge of raw.upgrades) {
    const list = upgradesByFrom.get(edge.from_item_id) || [];
    list.push(edge);
    upgradesByFrom.set(edge.from_item_id, list);
    const targetList = upgradesByTo.get(edge.to_item_id) || [];
    targetList.push(edge);
    upgradesByTo.set(edge.to_item_id, targetList);
  }
  return { ...raw, itemsById, mechanicsByItem, upgradesByFrom, upgradesByTo };
}

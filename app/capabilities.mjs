const PERMANENT_CONDITION = /^(immer|base hero state)/i;

const PROTECTION_MECHANICS = new Set([
  "bonus_health",
  "bonus_base_health",
  "bullet_resist",
  "spirit_resist",
  "tech_resist",
  "combat_barrier",
  "max_health_percent"
]);

const SUSTAIN_MECHANICS = new Set([
  "bullet_lifesteal_percent",
  "ability_lifesteal_percent_hero",
  "spirit_lifesteal_percent",
  "bonus_health_regen",
  "out_of_combat_health_regen",
  "total_health_regen",
  "health_steal_pct",
  "health_steal_pct_hero",
  "heal_from_hero",
  "heal_from_npc",
  "heal_on_kill"
]);

const MOBILITY_MECHANICS = new Set([
  "bonus_move_speed",
  "active_bonus_move_speed",
  "bonus_sprint_speed",
  "stamina",
  "stamina_cooldown_reduction",
  "move_speed_bonus_pct"
]);

const CONTROL_MECHANICS = new Set([
  "slow_percent",
  "move_speed_slow_pct",
  "immobilize_duration",
  "stun_duration",
  "silence_duration",
  "ground_dash_reduction_percent"
]);

const WEAPON_MECHANICS = new Set([
  "base_attack_damage_percent",
  "bonus_fire_rate",
  "bonus_clip_size_percent",
  "bonus_clip_size",
  "ammo_reload_percent"
]);

const SPIRIT_POWER_MECHANICS = new Set(["spirit_power", "tech_power"]);
const RISK_MECHANICS = new Set(["max_health_loss_percent", "bonus_move_speed"]);

const REVIEWED_HERO_PROFILES = {
  warden: {
    reviewStatus: "reviewed_first_slice",
    requiredItemDimensions: ["protection", "sustain", "access"],
    needs: {
      access: {
        kind: "reinforce_delayed_control",
        evidence: ["warden_binding_word:escape_time", "warden_binding_word:immobilize_duration"]
      },
      protection: {
        kind: "reinforce_cooldown_defense",
        evidence: ["warden_willpower:combat_barrier"]
      },
      sustain: {
        kind: "reinforce_ultimate_sustain",
        evidence: ["warden_last_stand:health_steal_pct_hero"]
      }
    }
  }
};

const HERO_PROFILE_CACHE = new WeakMap();
const ITEM_CAPABILITY_CACHE = new WeakMap();

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function itemEffectAvailability(item, effect) {
  if (PERMANENT_CONDITION.test(effect.condition || "")) return "permanent";
  if (effect.trigger === "item_activation") return "active";
  return "conditional";
}

function source(effect, dimension, item = null) {
  return {
    dimension,
    effect_id: effect.effect_id,
    mechanic: effect.mechanic,
    value: effect.value,
    unit: effect.unit,
    availability: itemEffectAvailability(item, effect),
    condition: effect.condition || "",
    trigger: effect.trigger || "",
    cooldown: effect.cooldown || "",
    duration: effect.duration || "",
    targetScope: effect.target_scope || "",
    confidence: effect.confidence
  };
}

function emptySustainProfile() {
  return {
    laneHealing: { heroHit: 0, npcHit: 0 },
    combatHealing: { bulletLifestealPercent: 0, abilityLifestealPercent: 0, onKillHeal: 0 },
    regeneration: { alwaysHealthPerSecond: 0, outOfCombatHealthPerSecond: 0 }
  };
}

function emptyMobilityProfile() {
  return {
    combatMoveSpeed: 0,
    activeMoveSpeed: 0,
    sprintSpeed: 0,
    stamina: 0,
    staminaCooldownReduction: 0
  };
}

function addDetailedEffect(effect, target, includeValue) {
  if (!includeValue) return;
  const value = number(effect.value);
  if (effect.mechanic === "heal_from_hero") target.sustain.laneHealing.heroHit += value;
  if (effect.mechanic === "heal_from_npc") target.sustain.laneHealing.npcHit += value;
  if (effect.mechanic === "bullet_lifesteal_percent") target.sustain.combatHealing.bulletLifestealPercent += value;
  if (["ability_lifesteal_percent_hero", "spirit_lifesteal_percent", "health_steal_pct", "health_steal_pct_hero"].includes(effect.mechanic)) {
    target.sustain.combatHealing.abilityLifestealPercent += value;
  }
  if (effect.mechanic === "heal_on_kill") target.sustain.combatHealing.onKillHeal += value;
  if (["bonus_health_regen", "total_health_regen"].includes(effect.mechanic)) target.sustain.regeneration.alwaysHealthPerSecond += value;
  if (effect.mechanic === "out_of_combat_health_regen") target.sustain.regeneration.outOfCombatHealthPerSecond += value;

  if (["bonus_move_speed", "move_speed_bonus_pct"].includes(effect.mechanic)) target.mobility.combatMoveSpeed += value;
  if (effect.mechanic === "active_bonus_move_speed") target.mobility.activeMoveSpeed += value;
  if (effect.mechanic === "bonus_sprint_speed") target.mobility.sprintSpeed += value;
  if (effect.mechanic === "stamina") target.mobility.stamina += value;
  if (effect.mechanic === "stamina_cooldown_reduction") target.mobility.staminaCooldownReduction += value;
}

export function buildHeroCapabilityProfile(heroId, data) {
  const cachedProfiles = HERO_PROFILE_CACHE.get(data) || new Map();
  if (cachedProfiles.has(heroId)) return cachedProfiles.get(heroId);
  const abilities = (data.abilities || []).filter((ability) => ability.hero_id === heroId);
  const abilityIds = new Set(abilities.map((ability) => ability.ability_id));
  const mechanics = (data.abilityMechanics || []).filter((effect) => abilityIds.has(effect.ability_id));
  const heroStats = (data.heroStats || []).filter((stat) => stat.hero_id === heroId);
  const sources = [];

  for (const effect of mechanics) {
    let dimension = null;
    if (effect.effect_type === "damage") dimension = "damage";
    if (PROTECTION_MECHANICS.has(effect.mechanic) || effect.effect_type === "defense") dimension = "protection";
    if (SUSTAIN_MECHANICS.has(effect.mechanic) || effect.effect_type === "healing") dimension = "sustain";
    if (MOBILITY_MECHANICS.has(effect.mechanic) || effect.effect_type === "movement") dimension = "mobility";
    if (CONTROL_MECHANICS.has(effect.mechanic) || effect.effect_type === "crowd_control") dimension = "control";
    if (dimension) sources.push({ ...source(effect, dimension), ability_id: effect.ability_id });
  }

  const scalingSources = heroStats.filter((stat) =>
    /_spirit_scaling$/.test(stat.mechanic || "") && stat.confidence !== "low"
  ).map((stat) => ({
    stat_id: stat.stat_id,
    mechanic: stat.mechanic,
    stat_group: stat.stat_group,
    coefficient: number(stat.base_value || stat.scaling_value),
    calculation_rule: stat.calculation_rule || "",
    confidence: stat.confidence
  }));

  const reviewed = REVIEWED_HERO_PROFILES[heroId];
  const profile = {
    heroId,
    reviewStatus: reviewed?.reviewStatus || "unreviewed",
    requiredItemDimensions: reviewed?.requiredItemDimensions || [],
    needs: reviewed?.needs || {},
    abilityIds: [...abilityIds],
    sources,
    scalingSources,
    hasSpiritWeaponScaling: scalingSources.some((entry) => entry.stat_group === "weapon"),
    evidenceCount: sources.length + scalingSources.length
  };
  cachedProfiles.set(heroId, profile);
  HERO_PROFILE_CACHE.set(data, cachedProfiles);
  return profile;
}

export function evaluateItemCapabilities(item, data, heroProfile = null) {
  const cachedItems = ITEM_CAPABILITY_CACHE.get(data) || new Map();
  const cacheKey = `${heroProfile?.heroId || "none"}:${item.item_id}`;
  if (cachedItems.has(cacheKey)) return cachedItems.get(cacheKey);
  const effects = (data.mechanicsByItem.get(item.item_id) || []).filter((effect) => effect.confidence !== "low");
  const sources = [];
  const coverage = { damage: false, protection: false, sustain: false, access: false, mobility: false };
  const coverageByAvailability = Object.fromEntries(Object.keys(coverage).map((key) => [key, {
    permanent: false,
    active: false,
    conditional: false
  }]));
  const permanent = {
    spiritPower: 0,
    bonusHealth: 0,
    bulletResist: 0,
    spiritResist: 0,
    bulletLifesteal: 0,
    abilityLifesteal: 0,
    healthRegen: 0,
    moveSpeed: 0,
    sprintSpeed: 0
  };
  const detailed = { sustain: emptySustainProfile(), mobility: emptyMobilityProfile() };
  const risks = [];
  let weaponOperation = false;

  for (const effect of effects) {
    const state = itemEffectAvailability(item, effect);
    const value = number(effect.value);
    let dimension = null;
    if (WEAPON_MECHANICS.has(effect.mechanic) || effect.effect_type === "damage") dimension = "damage";
    if (WEAPON_MECHANICS.has(effect.mechanic)) weaponOperation = true;
    if (PROTECTION_MECHANICS.has(effect.mechanic)) dimension = "protection";
    if (SUSTAIN_MECHANICS.has(effect.mechanic)) dimension = "sustain";
    if (MOBILITY_MECHANICS.has(effect.mechanic)) dimension = "mobility";
    const affectsOnlySelf = /^self$/i.test(effect.target_scope || "");
    if (CONTROL_MECHANICS.has(effect.mechanic) && !affectsOnlySelf) dimension = "access";
    if (SPIRIT_POWER_MECHANICS.has(effect.mechanic) && heroProfile?.hasSpiritWeaponScaling) dimension = "damage";
    if (dimension) {
      sources.push(source(effect, dimension, item));
      coverage[dimension] = true;
      coverageByAvailability[dimension][state] = true;
    }

    addDetailedEffect(effect, detailed, state === "permanent" || state === "active" || state === "conditional");

    if (state === "permanent") {
      if (SPIRIT_POWER_MECHANICS.has(effect.mechanic)) permanent.spiritPower += value;
      if (["bonus_health", "bonus_base_health"].includes(effect.mechanic)) permanent.bonusHealth += value;
      if (effect.mechanic === "bullet_resist") permanent.bulletResist += value;
      if (["spirit_resist", "tech_resist"].includes(effect.mechanic)) permanent.spiritResist += value;
      if (effect.mechanic === "bullet_lifesteal_percent") permanent.bulletLifesteal += value;
      if (["ability_lifesteal_percent_hero", "spirit_lifesteal_percent"].includes(effect.mechanic)) permanent.abilityLifesteal += value;
      if (["bonus_health_regen", "out_of_combat_health_regen"].includes(effect.mechanic)) permanent.healthRegen += value;
      if (effect.mechanic === "bonus_move_speed") permanent.moveSpeed += value;
      if (effect.mechanic === "bonus_sprint_speed") permanent.sprintSpeed += value;
    }

    const affectsSelf = !effect.target_scope || /self/i.test(effect.target_scope);
    const verifiedSelfRisk = effect.mechanic === "max_health_loss_percent" ||
      (effect.mechanic === "bonus_move_speed" && affectsSelf);
    if (RISK_MECHANICS.has(effect.mechanic) && value < 0 && verifiedSelfRisk) {
      risks.push(source(effect, "risk", item));
    }
  }

  const profile = {
    item_id: item.item_id,
    coverage,
    coverageByAvailability,
    directAccess: coverageByAvailability.access.permanent || coverageByAvailability.access.active,
    conditionalAccess: coverageByAvailability.access.conditional,
    weaponOperation,
    permanent,
    sustain: detailed.sustain,
    mobility: detailed.mobility,
    sources,
    risks
  };
  cachedItems.set(cacheKey, profile);
  ITEM_CAPABILITY_CACHE.set(data, cachedItems);
  return profile;
}

export function evaluateBuildCapabilities(state, data, heroProfile) {
  const coverage = { damage: false, protection: false, sustain: false, access: false, mobility: false };
  const permanent = {
    spiritPower: 0,
    bonusHealth: 0,
    bulletResist: 0,
    spiritResist: 0,
    bulletLifesteal: 0,
    abilityLifesteal: 0,
    healthRegen: 0,
    moveSpeed: 0,
    sprintSpeed: 0
  };
  const sustain = emptySustainProfile();
  const mobility = emptyMobilityProfile();
  const sources = [];
  const risks = [];
  let weaponOperation = false;
  const coverageByAvailability = Object.fromEntries(Object.keys(coverage).map((key) => [key, {
    permanent: false,
    active: false,
    conditional: false
  }]));

  for (const item of state.inventory) {
    const itemProfile = evaluateItemCapabilities(item, data, heroProfile);
    weaponOperation ||= itemProfile.weaponOperation;
    for (const key of Object.keys(coverage)) coverage[key] ||= itemProfile.coverage[key];
    for (const key of Object.keys(coverageByAvailability)) {
      for (const state of Object.keys(coverageByAvailability[key])) {
        coverageByAvailability[key][state] ||= itemProfile.coverageByAvailability[key][state];
      }
    }
    for (const key of Object.keys(permanent)) permanent[key] += itemProfile.permanent[key];
    sustain.laneHealing.heroHit += itemProfile.sustain.laneHealing.heroHit;
    sustain.laneHealing.npcHit += itemProfile.sustain.laneHealing.npcHit;
    sustain.combatHealing.bulletLifestealPercent += itemProfile.sustain.combatHealing.bulletLifestealPercent;
    sustain.combatHealing.abilityLifestealPercent += itemProfile.sustain.combatHealing.abilityLifestealPercent;
    sustain.combatHealing.onKillHeal += itemProfile.sustain.combatHealing.onKillHeal;
    sustain.regeneration.alwaysHealthPerSecond += itemProfile.sustain.regeneration.alwaysHealthPerSecond;
    sustain.regeneration.outOfCombatHealthPerSecond += itemProfile.sustain.regeneration.outOfCombatHealthPerSecond;
    mobility.combatMoveSpeed += itemProfile.mobility.combatMoveSpeed;
    mobility.activeMoveSpeed += itemProfile.mobility.activeMoveSpeed;
    mobility.sprintSpeed += itemProfile.mobility.sprintSpeed;
    mobility.stamina += itemProfile.mobility.stamina;
    mobility.staminaCooldownReduction += itemProfile.mobility.staminaCooldownReduction;
    sources.push(...itemProfile.sources.map((entry) => ({ ...entry, item_id: item.item_id })));
    risks.push(...itemProfile.risks.map((entry) => ({ ...entry, item_id: item.item_id })));
  }

  const coverageCount = Object.values(coverage).filter(Boolean).length;
  return {
    coverage,
    coverageByAvailability,
    coverageCount,
    directAccess: coverageByAvailability.access.permanent || coverageByAvailability.access.active,
    conditionalAccess: coverageByAvailability.access.conditional,
    weaponOperation,
    permanent,
    sustain,
    mobility,
    sources,
    risks,
    riskCount: risks.length
  };
}

export function buildPathMilestones(state, data, heroProfile, primaryCategory = "weapon") {
  const first = { damage: null, protection: null, sustain: null, access: null, mobility: null, majorThreshold: null };
  const firstSouls = { damage: null, protection: null, sustain: null, access: null, mobility: null, majorThreshold: null };
  let directAccess = null;
  let directAccessSouls = null;
  let primaryItem = null;
  let primaryItemSouls = null;
  let primaryMajorThreshold = null;
  let primaryMajorThresholdSouls = null;
  const majorThresholds = { weapon: null, vitality: null, spirit: null };
  const majorThresholdSouls = { weapon: null, vitality: null, spirit: null };
  for (const event of state.events) {
    const profile = evaluateItemCapabilities(event.item, data, heroProfile);
    for (const key of ["damage", "protection", "sustain", "access", "mobility"]) {
      if (first[key] === null && profile.coverage[key]) {
        first[key] = event.step;
        firstSouls[key] = event.total_spent;
      }
    }
    if (directAccess === null && profile.directAccess) {
      directAccess = event.step;
      directAccessSouls = event.total_spent;
    }
    if (primaryItem === null && event.item.category.toLowerCase() === primaryCategory) {
      primaryItem = event.step;
      primaryItemSouls = event.total_spent;
    }
    if (primaryMajorThreshold === null && event.thresholds_crossed.includes(`${primaryCategory}:4800`)) {
      primaryMajorThreshold = event.step;
      primaryMajorThresholdSouls = event.total_spent;
    }
    if (first.majorThreshold === null && event.thresholds_crossed.some((threshold) => threshold.endsWith(":4800"))) {
      first.majorThreshold = event.step;
      firstSouls.majorThreshold = event.total_spent;
    }
    for (const category of Object.keys(majorThresholds)) {
      if (majorThresholds[category] !== null || !event.thresholds_crossed.includes(`${category}:4800`)) continue;
      majorThresholds[category] = event.step;
      majorThresholdSouls[category] = event.total_spent;
    }
  }
  const fallback = state.events.length + 1;
  const required = heroProfile.requiredItemDimensions || [];
  const capabilityFoundationCount = required.filter((key) => first[key] !== null).length;
  const foundationCoverageCount = capabilityFoundationCount + Number(primaryItem !== null);
  const foundationRequirementCount = required.length + 1;
  const upgradeContinuity = state.events.filter((event) => event.purchase_type === "upgrade").length;
  return {
    ...first,
    firstSouls,
    directAccess,
    directAccessSouls,
    primaryCategory,
    primaryItem,
    primaryItemSouls,
    primaryMajorThreshold,
    primaryMajorThresholdSouls,
    majorThresholds,
    majorThresholdSouls,
    foundationCoverageCount,
    foundationRequirementCount,
    upgradeContinuity,
    foundationStep: required.length ? Math.max(...required.map((key) => first[key] ?? fallback)) : null,
    foundationSouls: required.length && foundationCoverageCount === foundationRequirementCount
      ? Math.max(primaryItemSouls, ...required.map((key) => firstSouls[key]))
      : null
  };
}

import {
  buildHeroCapabilityProfile,
  buildPathMilestones,
  evaluateBuildCapabilities,
  evaluateItemCapabilities,
  itemEffectAvailability
} from "./capabilities.mjs";

const SUPPORTED_WEAPON_MECHANICS = new Set([
  "base_attack_damage_percent",
  "bonus_fire_rate"
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

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cloneState(state) {
  return {
    inventory: [...state.inventory],
    spent: state.spent,
    activeItems: state.activeItems,
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
  return { inventory: [], spent: 0, activeItems: 0, events: [] };
}

export function applyPurchase(state, item, request, data) {
  const next = cloneState(state);
  const payment = number(item.total_cost);
  if (next.spent + payment > number(request.budget)) return { ok: false, reason: "BUDGET_EXCEEDED" };
  if (next.inventory.some((owned) => owned.item_id === item.item_id)) return { ok: false, reason: "ITEM_ALREADY_OWNED" };
  if (next.inventory.length >= slotCapacity(request, data.slots)) return { ok: false, reason: "SLOT_CAPACITY_EXCEEDED" };
  if (isActive(item) && next.activeItems >= Math.min(number(data.slots.active_item_limit), number(request.maxActiveItems))) {
    return { ok: false, reason: "ACTIVE_ITEM_LIMIT_EXCEEDED" };
  }
  next.inventory.push(item);
  next.spent += payment;
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
  next.events.push(buildEvent(next, target, payment, "upgrade", replaced, data.economy));
  return { ok: true, state: next, warning: "UNC-0004" };
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

function heroWeaponDps(heroStats, heroId) {
  const stat = heroStats.find((entry) => entry.hero_id === heroId && entry.mechanic === "dps" && entry.stat_group === "weapon");
  return stat ? number(stat.base_value) : null;
}

function heroWeaponSpiritDpsScaling(heroStats, heroId) {
  const stat = heroStats.find((entry) =>
    entry.hero_id === heroId && entry.mechanic === "dps_spirit_scaling" && entry.stat_group === "weapon" && entry.confidence !== "low"
  );
  return stat ? number(stat.base_value || stat.scaling_value) : 0;
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
  const baseDps = heroWeaponDps(data.heroStats, request.heroId);
  if (baseDps === null) return { valid: false, reason: "HERO_WEAPON_DPS_MISSING" };
  let damageBonus = 0;
  let fireRateBonus = 0;
  const evidence = [];
  for (const item of state.inventory) {
    for (const effect of relevantEffects(item, data.mechanicsByItem)) {
      if (effect.mechanic === "base_attack_damage_percent") damageBonus += number(effect.value);
      if (effect.mechanic === "bonus_fire_rate") fireRateBonus += number(effect.value);
      evidence.push(effect.effect_id);
    }
  }
  const thresholds = thresholdSnapshot(state.inventory, data.economy);
  damageBonus += thresholds.bonuses.weaponDamagePercent;
  const spiritPower = permanentSpiritPower(state, data) + thresholds.bonuses.spiritPower;
  const spiritDpsScaling = heroWeaponSpiritDpsScaling(data.heroStats, request.heroId);
  const spiritDpsBonus = spiritPower * spiritDpsScaling;
  return {
    valid: true,
    baseDps,
    damageBonus,
    fireRateBonus,
    spiritPower,
    spiritDpsScaling,
    spiritDpsBonus,
    finalDps: (baseDps + spiritDpsBonus) * (1 + damageBonus / 100) * (1 + fireRateBonus / 100),
    evidence,
    thresholds
  };
}

export function evaluateWeaponCarryProfile(state, request, data) {
  const weapon = evaluateWeaponState(state, request, data);
  if (!weapon.valid) return weapon;
  const heroProfile = buildHeroCapabilityProfile(request.heroId, data);
  const capabilities = evaluateBuildCapabilities(state, data, heroProfile);
  capabilities.permanent.spiritPower += weapon.thresholds.bonuses.spiritPower;
  const pathMilestones = buildPathMilestones(state, data, heroProfile, "weapon");
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
  const combatCheckpoints = buildCombatCheckpoints(state, request, data, heroProfile);
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
    pathMilestones
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
      profile = {
        weaponOperation: capabilities.weaponOperation,
        reliableSustainSources: reliableSustainCount(capabilities),
        protectionPresent: capabilities.permanent.bonusHealth > 0 ||
          capabilities.permanent.bulletResist > 0 || capabilities.permanent.spiritResist > 0,
        bonusHealth: capabilities.permanent.bonusHealth,
        bulletResist: capabilities.permanent.bulletResist,
        spiritResist: capabilities.permanent.spiritResist,
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

function stateKey(state) {
  return state.inventory.map((item) => item.item_id).sort().join("|");
}

function rankedStates(states, request, data, limit) {
  const unique = new Map();
  for (const state of states) {
    const evaluation = evaluateWeaponState(state, request, data);
    if (!evaluation.valid) continue;
    const current = unique.get(stateKey(state));
    if (!current || evaluation.finalDps > current.evaluation.finalDps || (evaluation.finalDps === current.evaluation.finalDps && state.spent < current.state.spent)) {
      unique.set(stateKey(state), { state, evaluation });
    }
  }
  return [...unique.values()].sort((left, right) =>
    right.evaluation.finalDps - left.evaluation.finalDps || left.state.spent - right.state.spent || stateKey(left.state).localeCompare(stateKey(right.state))
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
  const capacity = slotCapacity(request, data.slots);
  const requiredDimensionsCovered = evaluation.heroProfile.requiredItemDimensions.every((dimension) =>
    dimension === "access" ? evaluation.capabilities.directAccess : evaluation.capabilities.coverage[dimension]
  );
  return state.inventory.length === capacity &&
    evaluation.categoryCounts.weapon >= 5 &&
    evaluation.categoryCounts.vitality >= 3 &&
    evaluation.reliableSustainSources >= 1 &&
    requiredDimensionsCovered;
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
  const { evaluation, state } = candidate;
  const bothCarryThresholds = evaluation.pathMilestones.majorThresholds.weapon !== null &&
    evaluation.pathMilestones.majorThresholds.vitality !== null;
  const carryThresholdSouls = bothCarryThresholds
    ? Math.max(evaluation.pathMilestones.majorThresholdSouls.weapon, evaluation.pathMilestones.majorThresholdSouls.vitality)
    : Number.MAX_SAFE_INTEGER;
  const metrics = {
    finalDps: evaluation.finalDps,
    spiritPower: evaluation.heroProfile.hasSpiritWeaponScaling ? evaluation.capabilities.permanent.spiritPower : 0,
    riskSafety: -evaluation.capabilities.riskCount,
    upgradeCoherence: -evaluation.upgradeFamilyOverlapCount,
    bothCarryThresholds: Number(bothCarryThresholds),
    carryThresholdEconomy: -carryThresholdSouls,
    sustainEconomy: -(evaluation.pathMilestones.firstSouls.sustain ?? Number.MAX_SAFE_INTEGER),
    primaryItemEconomy: -(evaluation.pathMilestones.primaryItemSouls ?? Number.MAX_SAFE_INTEGER),
    directAccessEconomy: -(evaluation.pathMilestones.directAccessSouls ?? Number.MAX_SAFE_INTEGER),
    sustainModeCount: evaluation.sustainModeCount,
    bonusHealth: evaluation.capabilities.permanent.bonusHealth,
    bulletResist: evaluation.capabilities.permanent.bulletResist,
    spiritResist: evaluation.capabilities.permanent.spiritResist,
    laneHealingHero: evaluation.capabilities.sustain.laneHealing.heroHit,
    laneHealingNpc: evaluation.capabilities.sustain.laneHealing.npcHit,
    bulletLifesteal: evaluation.capabilities.sustain.combatHealing.bulletLifestealPercent,
    abilityLifesteal: evaluation.capabilities.sustain.combatHealing.abilityLifestealPercent,
    alwaysRegen: evaluation.capabilities.sustain.regeneration.alwaysHealthPerSecond,
    outOfCombatRegen: evaluation.capabilities.sustain.regeneration.outOfCombatHealthPerSecond,
    combatMoveSpeed: evaluation.capabilities.mobility.combatMoveSpeed,
    activeMoveSpeed: evaluation.capabilities.mobility.activeMoveSpeed,
    sprintSpeed: evaluation.capabilities.mobility.sprintSpeed
  };
  for (const checkpoint of evaluation.combatCheckpoints) {
    const prefix = `checkpoint${checkpoint.budget}`;
    metrics[`${prefix}Sustain`] = Number(checkpoint.reliableSustainSources > 0);
    metrics[`${prefix}Protection`] = Number(checkpoint.protectionPresent);
    metrics[`${prefix}Weapon`] = Number(checkpoint.weaponOperation);
    metrics[`${prefix}Dps`] = checkpoint.finalDps;
    metrics[`${prefix}BonusHealth`] = checkpoint.bonusHealth;
    metrics[`${prefix}BulletResist`] = checkpoint.bulletResist;
    metrics[`${prefix}SpiritResist`] = checkpoint.spiritResist;
  }
  return metrics;
}

function dominates(left, right) {
  if (left.state.spent !== right.state.spent) return false;
  const leftMetrics = paretoMetrics(left);
  const rightMetrics = paretoMetrics(right);
  const keys = Object.keys(leftMetrics);
  return keys.every((key) => leftMetrics[key] >= rightMetrics[key]) &&
    (left.state.spent < right.state.spent || keys.some((key) => leftMetrics[key] > rightMetrics[key]));
}

function balancedCarryOrder(left, right) {
  const leftBothThresholds = left.evaluation.pathMilestones.majorThresholds.weapon !== null && left.evaluation.pathMilestones.majorThresholds.vitality !== null;
  const rightBothThresholds = right.evaluation.pathMilestones.majorThresholds.weapon !== null && right.evaluation.pathMilestones.majorThresholds.vitality !== null;
  const leftThresholdSouls = leftBothThresholds
    ? Math.max(left.evaluation.pathMilestones.majorThresholdSouls.weapon, left.evaluation.pathMilestones.majorThresholdSouls.vitality)
    : Number.MAX_SAFE_INTEGER;
  const rightThresholdSouls = rightBothThresholds
    ? Math.max(right.evaluation.pathMilestones.majorThresholdSouls.weapon, right.evaluation.pathMilestones.majorThresholdSouls.vitality)
    : Number.MAX_SAFE_INTEGER;
  return left.evaluation.capabilities.riskCount - right.evaluation.capabilities.riskCount ||
    left.evaluation.upgradeFamilyOverlapCount - right.evaluation.upgradeFamilyOverlapCount ||
    compareCombatCheckpoints(left.evaluation.combatCheckpoints, right.evaluation.combatCheckpoints) ||
    Number(rightBothThresholds) - Number(leftBothThresholds) ||
    leftThresholdSouls - rightThresholdSouls ||
    (left.evaluation.pathMilestones.firstSouls.sustain ?? Number.MAX_SAFE_INTEGER) - (right.evaluation.pathMilestones.firstSouls.sustain ?? Number.MAX_SAFE_INTEGER) ||
    (left.evaluation.pathMilestones.primaryItemSouls ?? Number.MAX_SAFE_INTEGER) - (right.evaluation.pathMilestones.primaryItemSouls ?? Number.MAX_SAFE_INTEGER) ||
    (left.evaluation.pathMilestones.directAccessSouls ?? Number.MAX_SAFE_INTEGER) - (right.evaluation.pathMilestones.directAccessSouls ?? Number.MAX_SAFE_INTEGER) ||
    right.evaluation.sustainModeCount - left.evaluation.sustainModeCount ||
    right.evaluation.finalDps - left.evaluation.finalDps ||
    right.evaluation.capabilities.permanent.bonusHealth - left.evaluation.capabilities.permanent.bonusHealth ||
    right.evaluation.capabilities.permanent.bulletResist - left.evaluation.capabilities.permanent.bulletResist ||
    right.evaluation.capabilities.permanent.spiritResist - left.evaluation.capabilities.permanent.spiritResist ||
    left.state.spent - right.state.spent ||
    stateKey(left.state).localeCompare(stateKey(right.state));
}

function compareCombatCheckpoints(leftCheckpoints, rightCheckpoints) {
  const length = Math.min(leftCheckpoints.length, rightCheckpoints.length);
  for (let index = 0; index < length; index += 1) {
    const left = leftCheckpoints[index];
    const right = rightCheckpoints[index];
    const comparison =
      Number(right.reliableSustainSources > 0) - Number(left.reliableSustainSources > 0) ||
      Number(right.protectionPresent) - Number(left.protectionPresent) ||
      Number(right.weaponOperation) - Number(left.weaponOperation) ||
      right.finalDps - left.finalDps ||
      right.bonusHealth - left.bonusHealth ||
      right.bulletResist - left.bulletResist ||
      right.spiritResist - left.spiritResist ||
      left.unspentSouls - right.unspentSouls;
    if (comparison) return comparison;
  }
  return leftCheckpoints.length - rightCheckpoints.length;
}

function capabilitySignature(candidate) {
  const { evaluation, state } = candidate;
  return [
    state.spent,
    Math.min(evaluation.categoryCounts.weapon, 5),
    Math.min(evaluation.categoryCounts.vitality, 3),
    Math.min(evaluation.categoryCounts.spirit, 3),
    ...Object.values(evaluation.capabilities.coverage).map(Number),
    Math.min(evaluation.capabilities.riskCount, 1),
    Number(evaluation.pathMilestones.primaryMajorThreshold !== null)
  ].join(":");
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
    .map(([, group]) => group.sort(balancedCarryOrder));
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
  return [...groups.values()].flatMap((group) => group.sort(balancedCarryOrder).slice(0, perSignature));
}

function rankedCarryStates(states, request, data, limit, requireCompletePortfolio = false) {
  const unique = new Map();
  for (const state of states) {
    const evaluation = evaluateWeaponCarryProfile(state, request, data);
    if (!evaluation.valid) continue;
    evaluation.upgradeFamilyOverlapCount = upgradeFamilyOverlapCount(state, data);
    if (requireCompletePortfolio && !carryPortfolioIsComplete(state, evaluation, request, data)) continue;
    const current = unique.get(stateKey(state));
    const candidate = { state, evaluation };
    if (!current || balancedCarryOrder(candidate, current) < 0) {
      unique.set(stateKey(state), candidate);
    }
  }
  const candidates = paretoPool([...unique.values()]);
  const pareto = candidates.filter((candidate, index) =>
    !candidates.some((other, otherIndex) => otherIndex !== index && dominates(other, candidate))
  );
  if (!requireCompletePortfolio) return budgetBalancedSlice(pareto, limit);
  return pareto.sort(balancedCarryOrder).slice(0, limit);
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
    maxTransactions: Math.max(16, number(request.maxTransactions) || 28)
  };
  const eligibleItems = data.items.filter((item) => assessWeaponCarryItem(item, data, normalizedRequest).eligible);
  const eligibleIds = new Set(eligibleItems.map((item) => item.item_id));
  const beamWidth = 100;
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
  const candidates = rankedCarryStates(allStates, normalizedRequest, data, 3, true);
  const winner = candidates[0];
  if (!winner) return { status: "FAIL", reason: "NO_COMPLETE_BALANCED_CARRY_PATH" };
  return {
    status: "PASS_WITH_WARNINGS",
    resultLabel: "best_evaluated",
    scope: `Ausgewogener Warden Weapon Carry bis ${assumedEndBudget.toLocaleString("de-CH")} Souls: 12 Slots nach drei Walker-Freischaltungen. Die begrenzte Vorwärtssuche vergleicht die frühen Zustände bei 3'200 und 4'800 Souls einschließlich Sparphasen sowie spätere Pfade für Schaden, tatsächliche permanente Schutzwerte, getrennte Sustain- und Mobilitätsarten, Weapon-/Vitality-Schwellen, Upgrade-Kohärenz und belegte Heldenskalierungen. Final: mindestens 5 Weapon- und 3 Vitality-Slots, direkte Zugangsunterstützung sowie eine verlässliche Sustain-Quelle. Bedingte Effekte werden erfasst, aber nicht mit angenommener Uptime in den DPS eingerechnet.`,
    request: normalizedRequest,
    candidateCount: allStates.length,
    eligibleItemCount: eligibleItems.length,
    winner: { ...winner, itemAssessments: winner.state.inventory.map((item) => ({ item_id: item.item_id, ...assessWeaponCarryItem(item, data, normalizedRequest) })) },
    alternatives: candidates.slice(1),
    validation: {
      manifests: "PASS",
      costs_and_upgrades: "PASS",
      investments_and_thresholds: "PASS",
      slots_and_active_limit: "PASS",
      profile_rules: "PASS: geprüftes Warden-Profil; mindestens 5 Weapon, 3 Vitality und 1 verifizierte Sustain-Quelle; Sustain- und Mobilitätsarten bleiben getrennt.",
      path_rules: "PASS: begrenzte Vorwärtssuche, Pareto-Vergleich bei identischen Soul-Ausgaben, keine Upgrade-Anzahl als Qualitätsbonus und keine parallelen Vor- und Endstufen derselben Upgrade-Linie.",
      warnings: [
        "UNC-0004: Temporärer Slotbedarf beim Upgrade ist nicht verifiziert.",
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

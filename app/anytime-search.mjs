import { createDeadlockDomain } from "./deadlock-domain.mjs";
import { evaluateCarryPerformance, CARRY_METRICS, carryResourceAxis } from "./warden-search.mjs";
import { validateSearchPath } from "./validate-search-path.mjs";
import { heroCanPurchaseItem } from "./optimizer.mjs";

export const ANYTIME_METRIC_GROUPS = {
  damage: { metrics: ["sustainedWeaponDps", "laneTradeWindowDps", "farmWindowDps", "skirmishWindowDps", "teamfightWindowDps"], weight: 0.5 },
  survival: { metrics: ["bulletEhp", "spiritEhp"], weight: 0.5 }
};

// Focus only changes the mixture inside the existing 50%-weighted damage
// group. It neither makes an action unavailable nor changes its raw damage.
export const DAMAGE_FOCUS_WEIGHTS = Object.freeze({
  weapon: Object.freeze({ bullet: 0.7, spirit: 0.3 }),
  spirit: Object.freeze({ bullet: 0.3, spirit: 0.7 }),
  hybrid: Object.freeze({ bullet: 0.5, spirit: 0.5 })
});

const DAMAGE_COMPONENTS = Object.freeze({
  sustainedWeaponDps: Object.freeze({ bullet: "sustainedBulletDps", spirit: "sustainedSpiritDps" }),
  laneTradeWindowDps: Object.freeze({ bullet: "laneTradeBulletDps", spirit: "laneTradeSpiritDps" }),
  farmWindowDps: Object.freeze({ bullet: "farmBulletDps", spirit: "farmSpiritDps" }),
  skirmishWindowDps: Object.freeze({ bullet: "skirmishBulletDps", spirit: "skirmishSpiritDps" }),
  teamfightWindowDps: Object.freeze({ bullet: "teamfightBulletDps", spirit: "teamfightSpiritDps" })
});

const COMPONENT_METRICS = Object.freeze(Object.values(DAMAGE_COMPONENTS).flatMap((entry) => [entry.bullet, entry.spirit]));
const SCORING_METRICS = Object.freeze([...CARRY_METRICS, ...COMPONENT_METRICS]);
const COMPONENT_PARENT = new Map(Object.entries(DAMAGE_COMPONENTS).flatMap(([metric, components]) => [
  [components.bullet, metric], [components.spirit, metric]
]));

const focusWeights = (damageFocus) => DAMAGE_FOCUS_WEIGHTS[damageFocus] || DAMAGE_FOCUS_WEIGHTS.hybrid;
const metricValue = (values, metric) => {
  if (Number.isFinite(values[metric])) return values[metric];
  const parent = COMPONENT_PARENT.get(metric);
  // Compatibility for explicit small references that predate component rows:
  // preserving the aggregate value makes their focus-neutral assertions exact.
  return parent && Number.isFinite(values[parent]) ? values[parent] : 0;
};

export const ANYTIME_POLICY = { end: 0.7, worst: 0.15, integrated: 0.15,
  metricWeights: "Damage-Gruppe und Überlebens-Gruppe je 50%; Weapon 70/30, Spirit 30/70, Hybrid 50/50 für vergleichbar normalisierte Bullet-/Spirit-Schadensbeiträge", endNormalization: "x / (x + Referenz am Horizont)",
  reference: "Eingefrorene erreichbare Stichprobenreferenz; keine exakten Regret-Werte" };

export function scoreAnytimePath(points, reference, budget, damageFocus = "hybrid") {
  const byMetric = new Map();
  const committed = new Map(points.map((p) => [p.earnedSouls, p.metrics]));
  const rows = SCORING_METRICS.map((metric) => ({ metric, values: points[0].metrics, worst: 0, area: 0 }));
  // All metrics share the same path and Soul axis. Advancing them in one pass
  // preserves the per-metric arithmetic while avoiding separate full
  // Map traversals for every ranked successor.
  for (let index = 0; index < reference.axis.length; index++) {
    const souls = reference.axis[index];
    const values = committed.get(souls);
    if (values) for (const row of rows) row.values = values;
    const width = index + 1 < reference.axis.length ? reference.axis[index + 1] - souls : 0;
    for (const row of rows) {
      const referenceValue = metricValue(reference.values[index], row.metric);
      const currentValue = metricValue(row.values, row.metric);
      const regret = referenceValue > 0 ? Math.max(0, 1 - currentValue / referenceValue) : 0;
      row.worst = Math.max(row.worst, regret);
      row.area += width * regret;
    }
  }
  for (const row of rows) {
    const scale = metricValue(reference.values.at(-1), row.metric);
    const value = metricValue(row.values, row.metric);
    byMetric.set(row.metric, { end: value + scale > 0 ? value / (value + scale) : 0,
      worst: row.worst, integrated: budget ? row.area / budget : 0 });
  }
  const group = (key) => {
    const definition = ANYTIME_METRIC_GROUPS[key];
    const rows = definition.metrics.map((m) => byMetric.get(m));
    return {
      end: rows.reduce((sum, row) => sum + row.end, 0) / rows.length,
      worst: rows.reduce((sum, row) => sum + row.worst, 0) / rows.length,
      integrated: rows.reduce((sum, row) => sum + row.integrated, 0) / rows.length
    };
  };
  const weights = focusWeights(damageFocus);
  const damage = Object.fromEntries(["end", "worst", "integrated"].map((field) => [field,
    ANYTIME_METRIC_GROUPS.damage.metrics.reduce((sum, metric) => {
      const components = DAMAGE_COMPONENTS[metric];
      return sum + weights.bullet * byMetric.get(components.bullet)[field] + weights.spirit * byMetric.get(components.spirit)[field];
    }, 0) / ANYTIME_METRIC_GROUPS.damage.metrics.length]));
  const survival = group("survival");
  const weighted = (field) => ANYTIME_METRIC_GROUPS.damage.weight * damage[field] + ANYTIME_METRIC_GROUPS.survival.weight * survival[field];
  const endUtility = weighted("end");
  const worstRegret = weighted("worst");
  const integratedRegret = weighted("integrated");
  return { score: 0.7 * endUtility + 0.15 * (1 - worstRegret) + 0.15 * (1 - integratedRegret),
    endUtility, worstRegret, integratedRegret,
    metricGroups: { damage: { ...damage, focus: damageFocus, weights }, survival } };
}

// Transaction count is a publication tie-breaker only. Keeping it separate
// from score protects a genuinely stronger, more involved legal path.
export function preferPublishedCandidate(candidate, incumbent) {
  if (!incumbent) return true;
  return candidate.score > incumbent.score ||
    (candidate.score === incumbent.score && candidate.transactions < incumbent.transactions);
}

// Repeated legal rollouts, first greedy, later with reproducible exploration.
// Deadline is an explicit approximation budget, not an optimality certificate.
export function runAnytimeCarry({ data, heroId = "warden", damageFocus = "weapon", itemIds = data.items.map((i) => i.item_id), budget = 60000,
  timeMs = 30000, referenceTimeMs = 2000, onResult, onProgress, maxRollouts = Infinity, reference: suppliedReference, slotUnlocks = [],
  localRefinement = true, pathSimplification = true, profile = false, compactMetrics = true }) {
  if (!Number.isFinite(timeMs) || timeMs <= 0 || !Number.isSafeInteger(budget) || budget <= 0) throw new Error("Invalid search budget");
  const started = performance.now(), deadline = started + timeMs;
  const unavailableItemIds = itemIds.filter((id) => !heroCanPurchaseItem(data.itemsById.get(id), data, heroId));
  const legalItemIds = itemIds.filter((id) => !unavailableItemIds.includes(id));
  const resource = carryResourceAxis(data, legalItemIds, budget);
  const domain = createDeadlockDomain({ data, itemIds: legalItemIds, budget, slotUnlocks, soulAxis: resource.axis, metrics: () => ({ value: 0 }) });
  const profileData = { referencePreparationMs: 0, inventoryEvaluationMs: 0, actionGenerationMs: 0, scoringMs: 0,
    upgradeCounterprobeMs: 0, pathContinuationMs: 0, outputValidationMs: 0,
    variants: { seedsStarted: 0, seedsCompleted: 0, seedsInterrupted: 0, rolloutsStarted: 0, rolloutsCompleted: 0,
      rolloutsInterrupted: 0, localStarted: 0, localCompleted: 0, localInterrupted: 0 } };
  const accounted = () => profileData.referencePreparationMs + profileData.inventoryEvaluationMs + profileData.actionGenerationMs +
    profileData.scoringMs + profileData.upgradeCounterprobeMs + profileData.pathContinuationMs + profileData.outputValidationMs;
  const timed = (key, work) => {
    if (!profile) return work();
    const began = performance.now();
    try { return work(); } finally { profileData[key] += performance.now() - began; }
  };
  const exclusive = (key, work) => {
    if (!profile) return work();
    const began = performance.now(), before = accounted();
    try { return work(); } finally { profileData[key] += Math.max(0, performance.now() - began - (accounted() - before)); }
  };
  const transitions = (state) => timed("actionGenerationMs", () => domain.transitions(state));
  const clean = (s) => ({ ...s, events: [], snapshots: [] });
  const cache = new Map();
  let evaluations = 0;
  const metrics = (s) => {
    const key = [...s.inventory].sort().join("|");
    if (!cache.has(key)) {
      const result = timed("inventoryEvaluationMs", () => evaluateCarryPerformance(s, { heroId, damageFocus, budget, cacheProfiles: false, metricsOnly: compactMetrics }, data));
      if (!result.valid) throw new Error(result.reason);
      cache.set(key, result.metrics); evaluations++;
    }
    return cache.get(key);
  };
  const initial = clean(domain.initial), baseline = metrics(initial);
  const seedInventories = [];
  const reference = suppliedReference || { axis: resource.axis, values: resource.axis.map(() => ({ ...baseline })) };
  if (!suppliedReference) {
    exclusive("referencePreparationMs", () => {
    const until = Math.min(deadline, started + referenceTimeMs);
    // Sampling does not remove candidates from the actual trajectory search.
    for (const m of CARRY_METRICS) {
      let state = { ...initial, cash: budget, earnedSouls: budget };
      while (performance.now() < until) {
        let best;
        for (const next of transitions(state)) {
          if (next.events[0]?.type !== "purchase") continue;
          const values = metrics(next);
          const cost = budget - next.cash;
          const first = resource.axis.findIndex((s) => s >= cost);
          for (let i = first; i < reference.values.length; i++) for (const k of SCORING_METRICS) reference.values[i][k] = Math.max(reference.values[i][k] ?? 0, values[k] ?? 0);
          if (!best || values[m] > metrics(best)[m]) best = next;
          if (performance.now() >= until) break;
        }
        if (!best) break;
        state = clean(best);
      }
      if (state.inventory.length) seedInventories.push(state.inventory);
    }
    });
  }
  if (JSON.stringify(reference.axis) !== JSON.stringify(resource.axis)) throw new Error("Reference axis mismatch");
  let winner = null, winningNode = null, rollouts = 0, completedPaths = 0, publishedImprovements = 0, rng = 123456789;
  let localRefinementRan = false, localAlternativesTried = 0, localImprovements = 0, localBaselineScore = null;
  let pathSimplificationsTried = 0, pathSimplificationsAccepted = 0;
  const referenceIndex = new Map(reference.axis.map((souls, index) => [souls, index]));
  const pointsCache = new WeakMap(), rankCache = new WeakMap(), preferenceCache = new WeakMap(), trajectoryCache = new WeakMap();
  const random = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296; };
  const buildPoints = (node) => {
    if (pointsCache.has(node)) return pointsCache.get(node);
    const chain = [];
    for (let n = node; n; n = n.parent) chain.push(n);
    const points = chain.reverse().map((n) => ({ earnedSouls: n.state.earnedSouls, metrics: metrics(n.state) }));
    pointsCache.set(node, points);
    return points;
  };
  const trajectory = (node) => {
    if (trajectoryCache.has(node)) return trajectoryCache.get(node);
    const values = metrics(node.state);
    const index = referenceIndex.get(node.state.earnedSouls);
    if (index === undefined) throw new Error("State außerhalb der eingefrorenen Soul-Achse.");
    const prior = node.parent ? trajectory(node.parent) : null;
    const area = prior ? [...prior.area] : Array(SCORING_METRICS.length).fill(0);
    const worstBefore = prior ? [...prior.worstBefore] : Array(SCORING_METRICS.length).fill(0);
    if (prior && node.state.earnedSouls > prior.souls) {
      const width = node.state.earnedSouls - prior.souls;
      for (let metricIndex = 0; metricIndex < SCORING_METRICS.length; metricIndex++) {
        area[metricIndex] += width * prior.currentRegret[metricIndex];
        worstBefore[metricIndex] = Math.max(worstBefore[metricIndex], prior.currentRegret[metricIndex]);
      }
    }
    const currentRegret = SCORING_METRICS.map((metric) => {
      const referenceValue = metricValue(reference.values[index], metric);
      const value = metricValue(values, metric);
      return referenceValue > 0 ? Math.max(0, 1 - value / referenceValue) : 0;
    });
    const result = { souls: node.state.earnedSouls, values, area, worstBefore, currentRegret };
    trajectoryCache.set(node, result);
    return result;
  };
  const projectedQuality = (node) => {
    const state = trajectory(node);
    const byMetric = new Map();
    for (let metricIndex = 0; metricIndex < SCORING_METRICS.length; metricIndex++) {
      const metric = SCORING_METRICS[metricIndex];
      const scale = metricValue(reference.values.at(-1), metric);
      const value = metricValue(state.values, metric);
      const end = value + scale > 0 ? value / (value + scale) : 0;
      const worst = Math.max(state.worstBefore[metricIndex], state.currentRegret[metricIndex]);
      const integrated = budget ? (state.area[metricIndex] + (budget - state.souls) * state.currentRegret[metricIndex]) / budget : 0;
      byMetric.set(metric, { end, worst, integrated });
    }
    const group = (key) => {
      const rows = ANYTIME_METRIC_GROUPS[key].metrics.map((metric) => byMetric.get(metric));
      return Object.fromEntries(["end", "worst", "integrated"].map((field) => [field, rows.reduce((sum, row) => sum + row[field], 0) / rows.length]));
    };
    const weights = focusWeights(damageFocus);
    const damage = Object.fromEntries(["end", "worst", "integrated"].map((field) => [field,
      ANYTIME_METRIC_GROUPS.damage.metrics.reduce((sum, metric) => {
        const components = DAMAGE_COMPONENTS[metric];
        return sum + weights.bullet * byMetric.get(components.bullet)[field] + weights.spirit * byMetric.get(components.spirit)[field];
      }, 0) / ANYTIME_METRIC_GROUPS.damage.metrics.length]));
    const survival = group("survival");
    const weighted = (field) => ANYTIME_METRIC_GROUPS.damage.weight * damage[field] + ANYTIME_METRIC_GROUPS.survival.weight * survival[field];
    const endUtility = weighted("end"), worstRegret = weighted("worst"), integratedRegret = weighted("integrated");
    return { score: 0.7 * endUtility + 0.15 * (1 - worstRegret) + 0.15 * (1 - integratedRegret), endUtility, worstRegret, integratedRegret,
      metricGroups: { damage: { ...damage, focus: damageFocus, weights }, survival } };
  };
  const rank = (node) => {
    if (rankCache.has(node)) return rankCache.get(node);
    const value = timed("scoringMs", () => projectedQuality(node).score);
    rankCache.set(node, value);
    return value;
  };
  // A component can be weaker than a direct end item at the instant it is
  // bought, although both cost the same once its legal upgrade completes.
  // Look one supported upgrade ahead, preserving every save and component
  // snapshot in the trajectory. This is a ranking aid only: all normal shop
  // transitions, including sales and replacements, remain available.
  const upgradeContinuationRank = (node) => {
    return exclusive("upgradeCounterprobeMs", () => {
    if (node.event?.type !== "purchase") return null;
    const edges = domain.supportedUpgradesByFrom.get(node.event.item) || [];
    let best = null;
    for (const edge of edges) {
      let projected = node;
      while (performance.now() < deadline) {
        const upgrade = transitions(projected.state).find((state) => state.events[0]?.type === "upgrade" && state.events[0].from === edge.from_item_id && state.events[0].item === edge.to_item_id);
        if (upgrade) {
          best = Math.max(best ?? -Infinity, rank({ state: clean(upgrade), event: upgrade.events[0], parent: projected }));
          break;
        }
        if (projected.state.earnedSouls === budget) break;
        const save = transitions(projected.state).find((state) => state.events[0]?.type === "save");
        if (!save) break;
        projected = { state: clean(save), event: save.events[0], parent: projected };
      }
    }
    return best;
    });
  };
  const preferenceFor = (node) => {
    if (preferenceCache.has(node)) return preferenceCache.get(node);
    const value = Math.max(rank(node), upgradeContinuationRank(node) ?? -Infinity);
    preferenceCache.set(node, value);
    return value;
  };
  const transactionCount = (events) => events.reduce((count, event) => count + Number(event.type !== "save"), 0);
  const publish = (node) => {
    const chain = [];
    for (let n = node; n.parent; n = n.parent) chain.push(n);
    chain.reverse();
    const points = buildPoints(node);
    const quality = scoreAnytimePath(points, reference, budget, damageFocus);
    completedPaths++;
    const candidateTransactions = transactionCount(chain.map((n) => n.event));
    // A shorter path is only preferable when every scored value is exactly
    // unchanged. It is deliberately not a score term: a longer legal path
    // with even a marginally higher path score remains the winner.
    if (!preferPublishedCandidate({ score: quality.score, transactions: candidateTransactions }, winner && {
      score: winner.quality.score, transactions: transactionCount(winner.state.events)
    })) return false;
    const state = { ...node.state, events: chain.map((n) => n.event), snapshots: points };
    const validation = timed("outputValidationMs", () => validateSearchPath({ data, itemIds: legalItemIds, budget, soulAxis: resource.axis, slotUnlocks, state }));
    winner = { state, slotUnlocks, slotLimit: Number(data.slots.starting_slots.universal) + node.state.unlockedSlots, quality, validation, reference, policy: ANYTIME_POLICY, resource,
      unsupportedUpgrades: domain.resourceEvents.unsupportedUpgrades,
      unavailableItemIds,
      telemetry: { runtimeMs: performance.now() - started, evaluations, rollouts, completedPaths, publishedImprovements: publishedImprovements + 1,
        localRefinementRan, localAlternativesTried, localImprovements, localBaselineScore,
        pathSimplificationsTried, pathSimplificationsAccepted, profile: profile ? profileData : undefined }, approximate: true };
    winningNode = node;
    publishedImprovements++;
    onResult?.(winner);
    return true;
  };
  // Keep the sampled reference fixed and try every legal first deviation from
  // the current best path. Each suffix is then completed with the same score.
  // This explicitly covers alternate items, order, components and replacements
  // without treating a single random rollout as evidence of improvement.
  const refineCurrentWinner = () => {
    if (!localRefinement || localRefinementRan || !winningNode || performance.now() >= deadline) return;
    localRefinementRan = true;
    localBaselineScore = winner.quality.score;
    const baseline = [];
    for (let node = winningNode; node; node = node.parent) baseline.push(node);
    baseline.reverse();
    const eventKey = (event) => JSON.stringify(event);
    // General counterpath for a sell/rebuy episode: keep an item instead of
    // replacing or selling it, then omit its later ordinary repurchase. The
    // original actions between both points are replayed through the domain;
    // therefore the candidate is discarded if a slot, item source, cash or
    // any later action would cease to be legal. This is not an item rule and
    // does not prohibit legitimate replacements or rebuys.
    const replayWithout = (skip, replacements = new Map()) => {
      let replayed = { state: initial, parent: null };
      for (let index = 0; index < baseline.length - 1; index++) {
        if (skip.has(index)) continue;
        const original = baseline[index + 1].event;
        const replacement = replacements.get(index);
        const next = transitions(replayed.state).find((state) => replacement
          ? replacement(state.events[0])
          : eventKey(state.events[0]) === eventKey(original));
        if (!next) return null;
        replayed = { state: clean(next), event: next.events[0], parent: replayed };
      }
      return replayed.state.earnedSouls === budget ? replayed : null;
    };
    const simplifySellRebuys = () => {
      for (let soldAt = 0; soldAt + 1 < baseline.length && performance.now() < deadline; soldAt++) {
        const sold = baseline[soldAt + 1].event;
        if (!sold || (sold.type !== "sell" && sold.type !== "replacement")) continue;
        const itemId = sold.from;
        for (let reboughtAt = soldAt + 1; reboughtAt + 1 < baseline.length && performance.now() < deadline; reboughtAt++) {
          const rebought = baseline[reboughtAt + 1].event;
          // An ordinary purchase is the unambiguous inverse: keeping the old
          // item and omitting both actions restores the same item afterwards.
          if (rebought?.type !== "purchase" || rebought.item !== itemId) continue;
          pathSimplificationsTried++;
          const candidate = replayWithout(new Set([soldAt, reboughtAt]));
          if (!candidate) continue;
          const before = winner?.quality.score;
          const beforeTransactions = winner ? transactionCount(winner.state.events) : Infinity;
          if (publish(candidate) && (winner.quality.score > before || transactionCount(winner.state.events) < beforeTransactions)) {
            pathSimplificationsAccepted++;
          }
        }
      }
    };
    const simplifyTemporaryPurchases = () => {
      for (let boughtAt = 0; boughtAt + 1 < baseline.length && performance.now() < deadline; boughtAt++) {
        const bought = baseline[boughtAt + 1].event;
        if (bought?.type !== "purchase") continue;
        for (let removedAt = boughtAt + 1; removedAt + 1 < baseline.length && performance.now() < deadline; removedAt++) {
          const removed = baseline[removedAt + 1].event;
          if (!removed || (removed.type !== "sell" && removed.type !== "replacement") || removed.from !== bought.item) continue;
          pathSimplificationsTried++;
          const replacements = new Map();
          // Purchasing the replacement target directly is the legal inverse
          // of purchase X followed by replacement X→Y. The extra cash from
          // omitting X makes this no less affordable; replay still verifies
          // every subsequent action and its concrete slot state.
          if (removed.type === "replacement") {
            replacements.set(removedAt, (event) => event?.type === "purchase" && event.item === removed.item);
          }
          const candidate = replayWithout(new Set([boughtAt, ...(removed.type === "sell" ? [removedAt] : [])]), replacements);
          if (!candidate) continue;
          const before = winner?.quality.score;
          const beforeTransactions = winner ? transactionCount(winner.state.events) : Infinity;
          if (publish(candidate) && (winner.quality.score > before || transactionCount(winner.state.events) < beforeTransactions)) {
            pathSimplificationsAccepted++;
          }
        }
      }
    };
    if (pathSimplification) simplifySellRebuys();
    if (pathSimplification) simplifyTemporaryPurchases();
    // A successful simplification becomes the new baseline for all further
    // first-deviation checks in this refinement pass.
    if (winningNode) {
      baseline.length = 0;
      for (let node = winningNode; node; node = node.parent) baseline.push(node);
      baseline.reverse();
    }
    const completeGreedily = (start) => exclusive("pathContinuationMs", () => {
      if (profile) profileData.variants.localStarted++;
      let node = start;
      while (node.state.earnedSouls < budget && performance.now() < deadline) {
        const successors = transitions(node.state);
        const currentScore = rank(node);
        let best = null, bestScore = -Infinity;
        for (const state of successors) {
          const candidate = { state: clean(state), event: state.events[0], parent: node };
          const score = preferenceFor(candidate);
          if (score > bestScore) { best = candidate; bestScore = score; }
        }
        if (!best) return;
        if (best.event.type !== "save" && bestScore <= currentScore) {
          const save = successors.find((state) => state.events[0]?.type === "save");
          if (!save) return;
          best = { state: clean(save), event: save.events[0], parent: node };
        }
        node = best;
      }
      if (node.state.earnedSouls === budget) {
        const before = winner?.quality.score ?? -Infinity;
        publish(node);
        if ((winner?.quality.score ?? -Infinity) > before) localImprovements++;
        if (profile) profileData.variants.localCompleted++;
      } else if (profile) {
        profileData.variants.localInterrupted++;
      }
    });
    const completePlannedUpgrades = (start) => {
      if (start.event?.type !== "purchase") return;
      for (const edge of domain.supportedUpgradesByFrom.get(start.event.item) || []) {
        let planned = start;
        while (performance.now() < deadline) {
          const upgrade = transitions(planned.state).find((state) =>
            state.events[0]?.type === "upgrade" && state.events[0].from === edge.from_item_id && state.events[0].item === edge.to_item_id);
          if (upgrade) {
            localAlternativesTried++;
            completeGreedily({ state: clean(upgrade), event: upgrade.events[0], parent: planned });
            break;
          }
          if (planned.state.earnedSouls === budget) break;
          const save = transitions(planned.state).find((state) => state.events[0]?.type === "save");
          if (!save) break;
          planned = { state: clean(save), event: save.events[0], parent: planned };
        }
      }
    };
    for (let index = 0; index + 1 < baseline.length && performance.now() < deadline; index++) {
      const prefix = baseline[index];
      // The baseline itself may already hold a component whose greedy suffix
      // sold or replaced it. Preserve that component's concrete upgrade path
      // as an independently completed alternative as well.
      completePlannedUpgrades(prefix);
      const originalNext = baseline[index + 1].event;
      for (const state of transitions(prefix.state)) {
        if (eventKey(state.events[0]) === eventKey(originalNext)) continue;
        localAlternativesTried++;
        const alternative = { state: clean(state), event: state.events[0], parent: prefix };
        completeGreedily(alternative);
        // A projected upgrade must also be completed as a real candidate. A
        // greedy suffix alone may abandon the component before its upgrade is
        // affordable, even though the full component path has the better
        // 70/30 trajectory score.
        completePlannedUpgrades(alternative);
        if (performance.now() >= deadline) break;
      }
    }
  };
  // End-oriented seeds complement the greedy rollout's early-spending bias.
  // They restrict only their own construction, never the subsequent action set.
  for (const target of seedInventories) {
    if (profile) profileData.variants.seedsStarted++;
    const targetOrComponentIds = new Set(target);
    for (let changed = true; changed;) {
      changed = false;
      for (const edge of data.upgrades) {
        if (targetOrComponentIds.has(edge.to_item_id) && domain.supportedUpgradesByFrom.has(edge.from_item_id) && !targetOrComponentIds.has(edge.from_item_id)) {
          targetOrComponentIds.add(edge.from_item_id);
          changed = true;
        }
      }
    }
    let node = { state: initial, parent: null };
    while (performance.now() < deadline) {
      const successors = transitions(node.state);
      let best = null, value = -Infinity;
      for (const s of successors) {
        const event = s.events[0];
        const isSeedPurchase = event?.type === "purchase" && targetOrComponentIds.has(event.item);
        const isSeedUpgrade = event?.type === "upgrade" && targetOrComponentIds.has(event.from) && targetOrComponentIds.has(event.item);
        if (!isSeedPurchase && !isSeedUpgrade) continue;
        const candidate = { state: clean(s), event: s.events[0], parent: node };
        const score = preferenceFor(candidate);
        if (score > value) { best = candidate; value = score; }
      }
      if (!best) {
        const save = successors.find((s) => s.events[0]?.type === "save");
        if (!save) break;
        best = { state: clean(save), event: save.events[0], parent: node };
      }
      node = best;
    }
    if (node.state.earnedSouls === budget) {
      publish(node);
      if (profile) profileData.variants.seedsCompleted++;
    } else if (profile) {
      profileData.variants.seedsInterrupted++;
    }
  }
  while (performance.now() < deadline && rollouts < maxRollouts) {
    if (profile) profileData.variants.rolloutsStarted++;
    let node = { state: initial, parent: null };
    if (winningNode && rollouts) {
      const prefixes = [];
      for (let n = winningNode; n.parent; n = n.parent) prefixes.push(n.parent);
      node = prefixes[Math.floor(random() * prefixes.length)] || node;
    }
    while (true) {
      const successors = transitions(node.state);
      let best = null, bestScore = -Infinity;
      const currentScore = rank(node);
      for (const state of successors) {
        const candidate = { state: clean(state), event: state.events[0], parent: node };
        const score = preferenceFor(candidate);
        // Local perturbations diversify subsequent suffix rollouts.
        const exploration = rollouts ? -0.002 * Math.log(-Math.log(Math.max(1e-12, random()))) : 0;
        const preference = score + exploration;
        if (preference > bestScore) { best = candidate; bestScore = preference; }
        if (performance.now() >= deadline) break;
      }
      if (rollouts && successors.length && random() < 0.1) {
        const state = successors[Math.floor(random() * successors.length)];
        best = { state: clean(state), event: state.events[0], parent: node };
        bestScore = preferenceFor(best);
      }
      if (node.state.earnedSouls === budget) {
        publish(node);
        if (profile) profileData.variants.rolloutsCompleted++;
        if (!best || bestScore <= currentScore || performance.now() >= deadline) break;
      }
      if (!best) break;
      if (!rollouts && best.event.type !== "save" && bestScore <= currentScore) {
        const save = successors.find((s) => s.events[0]?.type === "save");
        if (!save) break;
        best = { state: clean(save), event: save.events[0], parent: node };
      }
      node = best;
      if (performance.now() >= deadline) {
        // Finish the candidate by legally holding its inventory to the horizon.
        while (node.state.earnedSouls < budget) {
          const save = transitions(node.state).find((s) => s.events[0]?.type === "save");
          node = { state: clean(save), event: save.events[0], parent: node };
        }
        publish(node); break;
      }
    }
    if (profile && node.state.earnedSouls !== budget) profileData.variants.rolloutsInterrupted++;
    rollouts++;
    // The first non-seed rollout establishes the baseline purchase path before
    // variants are compared. Later rollouts retain the existing exploration.
    if (rollouts === 1 && localRefinement) refineCurrentWinner();
    onProgress?.({ phase: "anytime", runtimeMs: performance.now() - started, evaluations, rollouts, completedPaths, publishedImprovements, bestScore: winner?.quality.score });
  }
  return winner ? { ...winner, searchTelemetry: { runtimeMs: performance.now() - started, evaluations, rollouts, completedPaths, publishedImprovements,
    localRefinementRan, localAlternativesTried, localImprovements, localBaselineScore,
    pathSimplificationsTried, pathSimplificationsAccepted, profile: profile ? profileData : undefined } } : null;
}

export const runAnytimeWarden = runAnytimeCarry;

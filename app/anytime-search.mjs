import { createDeadlockDomain } from "./deadlock-domain.mjs";
import { evaluateWardenCarryPerformance, WARDEN_METRICS, wardenResourceAxis } from "./warden-search.mjs";
import { validateSearchPath } from "./validate-search-path.mjs";
import { heroCanPurchaseItem } from "./optimizer.mjs";

export const ANYTIME_METRIC_GROUPS = {
  damage: { metrics: ["sustainedWeaponDps", "laneTradeWindowDps", "farmWindowDps", "skirmishWindowDps", "teamfightWindowDps"], weight: 0.5 },
  survival: { metrics: ["bulletEhp", "spiritEhp"], weight: 0.5 }
};

export const ANYTIME_POLICY = { end: 0.7, worst: 0.15, integrated: 0.15,
  metricWeights: "Damage-Gruppe und Überlebens-Gruppe je 50%; innerhalb der Gruppe gleich gewichtet", endNormalization: "x / (x + Referenz am Horizont)",
  reference: "Eingefrorene erreichbare Stichprobenreferenz; keine exakten Regret-Werte" };

export function scoreAnytimePath(points, reference, budget) {
  const byMetric = new Map();
  const committed = new Map(points.map((p) => [p.earnedSouls, p.metrics]));
  let values = points[0].metrics;
  for (const m of WARDEN_METRICS) {
    let w = 0, area = 0;
    values = points[0].metrics;
    for (let i = 0; i < reference.axis.length; i++) {
      const s = reference.axis[i];
      if (committed.has(s)) values = committed.get(s);
      const r = reference.values[i][m];
      const regret = r > 0 ? Math.max(0, 1 - values[m] / r) : 0;
      w = Math.max(w, regret);
      if (i + 1 < reference.axis.length) area += (reference.axis[i + 1] - s) * regret;
    }
    const scale = reference.values.at(-1)[m];
    byMetric.set(m, { end: values[m] + scale > 0 ? values[m] / (values[m] + scale) : 0,
      worst: w, integrated: budget ? area / budget : 0 });
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
  const damage = group("damage");
  const survival = group("survival");
  const weighted = (field) => ANYTIME_METRIC_GROUPS.damage.weight * damage[field] + ANYTIME_METRIC_GROUPS.survival.weight * survival[field];
  const endUtility = weighted("end");
  const worstRegret = weighted("worst");
  const integratedRegret = weighted("integrated");
  return { score: 0.7 * endUtility + 0.15 * (1 - worstRegret) + 0.15 * (1 - integratedRegret),
    endUtility, worstRegret, integratedRegret,
    metricGroups: { damage, survival } };
}

// Repeated legal rollouts, first greedy, later with reproducible exploration.
// Deadline is an explicit approximation budget, not an optimality certificate.
export function runAnytimeWarden({ data, itemIds = data.items.map((i) => i.item_id), budget = 60000,
  timeMs = 30000, referenceTimeMs = 2000, onResult, onProgress, maxRollouts = Infinity, reference: suppliedReference, slotUnlocks = [],
  localRefinement = true }) {
  if (!Number.isFinite(timeMs) || timeMs <= 0 || !Number.isSafeInteger(budget) || budget <= 0) throw new Error("Invalid search budget");
  const started = performance.now(), deadline = started + timeMs;
  const unavailableItemIds = itemIds.filter((id) => !heroCanPurchaseItem(data.itemsById.get(id), data, "warden"));
  const legalItemIds = itemIds.filter((id) => !unavailableItemIds.includes(id));
  const resource = wardenResourceAxis(data, legalItemIds, budget);
  const domain = createDeadlockDomain({ data, itemIds: legalItemIds, budget, slotUnlocks, soulAxis: resource.axis, metrics: () => ({ value: 0 }) });
  const clean = (s) => ({ ...s, events: [], snapshots: [] });
  const cache = new Map();
  let evaluations = 0;
  const metrics = (s) => {
    const key = [...s.inventory].sort().join("|");
    if (!cache.has(key)) {
      const result = evaluateWardenCarryPerformance(s, { heroId: "warden", budget, cacheProfiles: false }, data);
      if (!result.valid) throw new Error(result.reason);
      cache.set(key, result.metrics); evaluations++;
    }
    return cache.get(key);
  };
  const initial = clean(domain.initial), baseline = metrics(initial);
  const seedInventories = [];
  const reference = suppliedReference || { axis: resource.axis, values: resource.axis.map(() => ({ ...baseline })) };
  if (!suppliedReference) {
    const until = Math.min(deadline, started + referenceTimeMs);
    // Sampling does not remove candidates from the actual trajectory search.
    for (const m of WARDEN_METRICS) {
      let state = { ...initial, cash: budget, earnedSouls: budget };
      while (performance.now() < until) {
        let best;
        for (const next of domain.transitions(state)) {
          if (next.events[0]?.type !== "purchase") continue;
          const values = metrics(next);
          const cost = budget - next.cash;
          const first = resource.axis.findIndex((s) => s >= cost);
          for (let i = first; i < reference.values.length; i++) for (const k of WARDEN_METRICS) reference.values[i][k] = Math.max(reference.values[i][k], values[k]);
          if (!best || values[m] > metrics(best)[m]) best = next;
          if (performance.now() >= until) break;
        }
        if (!best) break;
        state = clean(best);
      }
      if (state.inventory.length) seedInventories.push(state.inventory);
    }
  }
  if (JSON.stringify(reference.axis) !== JSON.stringify(resource.axis)) throw new Error("Reference axis mismatch");
  let winner = null, winningNode = null, rollouts = 0, completedPaths = 0, publishedImprovements = 0, rng = 123456789;
  let localRefinementRan = false, localAlternativesTried = 0, localImprovements = 0, localBaselineScore = null;
  const random = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296; };
  const buildPoints = (node) => {
    const chain = [];
    for (let n = node; n; n = n.parent) chain.push(n);
    return chain.reverse().map((n) => ({ earnedSouls: n.state.earnedSouls, metrics: metrics(n.state) }));
  };
  const rank = (node) => scoreAnytimePath([...buildPoints(node), { earnedSouls: budget, metrics: metrics(node.state) }], reference, budget).score;
  // A component can be weaker than a direct end item at the instant it is
  // bought, although both cost the same once its legal upgrade completes.
  // Look one supported upgrade ahead, preserving every save and component
  // snapshot in the trajectory. This is a ranking aid only: all normal shop
  // transitions, including sales and replacements, remain available.
  const upgradeContinuationRank = (node) => {
    if (node.event?.type !== "purchase") return null;
    const edges = domain.supportedUpgradesByFrom.get(node.event.item) || [];
    let best = null;
    for (const edge of edges) {
      let projected = node;
      while (performance.now() < deadline) {
        const upgrade = domain.transitions(projected.state).find((state) => state.events[0]?.type === "upgrade" && state.events[0].from === edge.from_item_id && state.events[0].item === edge.to_item_id);
        if (upgrade) {
          best = Math.max(best ?? -Infinity, rank({ state: clean(upgrade), event: upgrade.events[0], parent: projected }));
          break;
        }
        if (projected.state.earnedSouls === budget) break;
        const save = domain.transitions(projected.state).find((state) => state.events[0]?.type === "save");
        if (!save) break;
        projected = { state: clean(save), event: save.events[0], parent: projected };
      }
    }
    return best;
  };
  const preferenceFor = (node) => Math.max(rank(node), upgradeContinuationRank(node) ?? -Infinity);
  const publish = (node) => {
    const chain = [];
    for (let n = node; n.parent; n = n.parent) chain.push(n);
    chain.reverse();
    const points = buildPoints(node);
    const quality = scoreAnytimePath(points, reference, budget);
    completedPaths++;
    if (winner && quality.score <= winner.quality.score) return;
    const state = { ...node.state, events: chain.map((n) => n.event), snapshots: points };
    const validation = validateSearchPath({ data, itemIds: legalItemIds, budget, soulAxis: resource.axis, slotUnlocks, state });
    winner = { state, slotUnlocks, slotLimit: Number(data.slots.starting_slots.universal) + node.state.unlockedSlots, quality, validation, reference, policy: ANYTIME_POLICY, resource,
      unsupportedUpgrades: domain.resourceEvents.unsupportedUpgrades,
      unavailableItemIds,
      telemetry: { runtimeMs: performance.now() - started, evaluations, rollouts, completedPaths, publishedImprovements: publishedImprovements + 1,
        localRefinementRan, localAlternativesTried, localImprovements, localBaselineScore }, approximate: true };
    winningNode = node;
    publishedImprovements++;
    onResult?.(winner);
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
    const completeGreedily = (start) => {
      let node = start;
      while (node.state.earnedSouls < budget && performance.now() < deadline) {
        const successors = domain.transitions(node.state);
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
      }
    };
    const completePlannedUpgrades = (start) => {
      if (start.event?.type !== "purchase") return;
      for (const edge of domain.supportedUpgradesByFrom.get(start.event.item) || []) {
        let planned = start;
        while (performance.now() < deadline) {
          const upgrade = domain.transitions(planned.state).find((state) =>
            state.events[0]?.type === "upgrade" && state.events[0].from === edge.from_item_id && state.events[0].item === edge.to_item_id);
          if (upgrade) {
            localAlternativesTried++;
            completeGreedily({ state: clean(upgrade), event: upgrade.events[0], parent: planned });
            break;
          }
          if (planned.state.earnedSouls === budget) break;
          const save = domain.transitions(planned.state).find((state) => state.events[0]?.type === "save");
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
      for (const state of domain.transitions(prefix.state)) {
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
      const successors = domain.transitions(node.state);
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
    }
  }
  while (performance.now() < deadline && rollouts < maxRollouts) {
    let node = { state: initial, parent: null };
    if (winningNode && rollouts) {
      const prefixes = [];
      for (let n = winningNode; n.parent; n = n.parent) prefixes.push(n.parent);
      node = prefixes[Math.floor(random() * prefixes.length)] || node;
    }
    while (true) {
      const successors = domain.transitions(node.state);
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
          const save = domain.transitions(node.state).find((s) => s.events[0]?.type === "save");
          node = { state: clean(save), event: save.events[0], parent: node };
        }
        publish(node); break;
      }
    }
    rollouts++;
    // The first non-seed rollout establishes the baseline purchase path before
    // variants are compared. Later rollouts retain the existing exploration.
    if (rollouts === 1 && localRefinement) refineCurrentWinner();
    onProgress?.({ phase: "anytime", runtimeMs: performance.now() - started, evaluations, rollouts, completedPaths, publishedImprovements, bestScore: winner?.quality.score });
  }
  return winner ? { ...winner, searchTelemetry: { runtimeMs: performance.now() - started, evaluations, rollouts, completedPaths, publishedImprovements,
    localRefinementRan, localAlternativesTried, localImprovements, localBaselineScore } } : null;
}

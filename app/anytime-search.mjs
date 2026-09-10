import { createDeadlockDomain } from "./deadlock-domain.mjs";
import { evaluateWardenCarryPerformance, WARDEN_METRICS, wardenResourceAxis } from "./warden-search.mjs";
import { validateSearchPath } from "./validate-search-path.mjs";

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
export function runAnytimeWarden({ data, itemIds = data.items.map((i) => i.item_id), budget = 40000,
  timeMs = 30000, referenceTimeMs = 2000, onResult, onProgress, maxRollouts = Infinity, reference: suppliedReference, slotUnlocks = [] }) {
  if (!Number.isFinite(timeMs) || timeMs <= 0 || !Number.isSafeInteger(budget) || budget <= 0) throw new Error("Invalid search budget");
  const started = performance.now(), deadline = started + timeMs;
  const resource = wardenResourceAxis(data, itemIds, budget);
  const domain = createDeadlockDomain({ data, itemIds, budget, slotUnlocks, soulAxis: resource.axis, metrics: () => ({ value: 0 }) });
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
  let winner = null, winningNode = null, rollouts = 0, rng = 123456789;
  const random = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296; };
  const buildPoints = (node) => {
    const chain = [];
    for (let n = node; n; n = n.parent) chain.push(n);
    return chain.reverse().map((n) => ({ earnedSouls: n.state.earnedSouls, metrics: metrics(n.state) }));
  };
  const rank = (node) => scoreAnytimePath([...buildPoints(node), { earnedSouls: budget, metrics: metrics(node.state) }], reference, budget).score;
  const publish = (node) => {
    const chain = [];
    for (let n = node; n.parent; n = n.parent) chain.push(n);
    chain.reverse();
    const points = buildPoints(node);
    const quality = scoreAnytimePath(points, reference, budget);
    if (winner && quality.score <= winner.quality.score) return;
    const state = { ...node.state, events: chain.map((n) => n.event), snapshots: points };
    const validation = validateSearchPath({ data, itemIds, budget, soulAxis: resource.axis, slotUnlocks, state });
    winner = { state, slotUnlocks, slotLimit: Number(data.slots.starting_slots.universal) + node.state.unlockedSlots, quality, validation, reference, policy: ANYTIME_POLICY, resource,
      unsupportedUpgrades: domain.resourceEvents.unsupportedUpgrades,
      telemetry: { runtimeMs: performance.now() - started, evaluations, rollouts }, approximate: true };
    winningNode = node;
    onResult?.(winner);
  };
  // End-oriented seeds complement the greedy rollout's early-spending bias.
  // They restrict only their own construction, never the subsequent action set.
  for (const target of seedInventories) {
    let node = { state: initial, parent: null };
    while (performance.now() < deadline) {
      const successors = domain.transitions(node.state);
      let best = null, value = -Infinity;
      for (const s of successors) {
        if (s.events[0]?.type !== "purchase" || !target.includes(s.events[0].item)) continue;
        const candidate = { state: clean(s), event: s.events[0], parent: node };
        const score = rank(candidate);
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
        const score = rank(candidate);
        // Local perturbations diversify subsequent suffix rollouts.
        const exploration = rollouts ? -0.002 * Math.log(-Math.log(Math.max(1e-12, random()))) : 0;
        const preference = score + exploration;
        if (preference > bestScore) { best = candidate; bestScore = preference; }
        if (performance.now() >= deadline) break;
      }
      if (rollouts && successors.length && random() < 0.1) {
        const state = successors[Math.floor(random() * successors.length)];
        best = { state: clean(state), event: state.events[0], parent: node };
        bestScore = rank(best);
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
    onProgress?.({ phase: "anytime", runtimeMs: performance.now() - started, evaluations, rollouts, bestScore: winner?.quality.score });
  }
  return winner ? { ...winner, searchTelemetry: { runtimeMs: performance.now() - started, evaluations, rollouts } } : null;
}

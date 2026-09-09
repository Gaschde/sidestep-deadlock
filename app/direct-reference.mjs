import { createDeadlockDomain } from "./deadlock-domain.mjs";

// Exact only for this domain: every candidate can be bought directly at total_cost;
// upgrades conserve inventory cost; sales lose value; slots only increase.
// See docs/search_specification.md for both directions of reachability proof.
export function directReference({ data, itemIds, budget, soulAxis, slotUnlocks = [], metrics, metricSet, onProgress, profile = false }) {
  const setupStarted = performance.now();
  const domain = createDeadlockDomain({ data, itemIds, budget, soulAxis, slotUnlocks, recordHistory: false });
  if (new Set(itemIds).size !== itemIds.length || itemIds.some((id) => !data.itemsById.has(id))) throw new Error("Invalid reference candidates");
  const items = itemIds.map((id) => data.itemsById.get(id));
  const baseSlots = Number(data.slots.starting_slots.universal);
  const activeLimit = Number(data.slots.active_item_limit);
  if (![baseSlots, activeLimit].every((n) => Number.isSafeInteger(n) && n >= 0)) throw new Error("Invalid reference slots");
  const axis = soulAxis || Array.from({ length: budget + 1 }, (_, i) => i);
  const capacities = axis.map((s) => baseSlots + slotUnlocks.filter((u) => u.earnedSouls <= s).reduce((n, u) => n + u.slots, 0));
  const ancestors = (id, seen = new Set()) => {
    for (const edge of data.upgrades) if (edge.to_item_id === id && !seen.has(edge.from_item_id)) {
      seen.add(edge.from_item_id); ancestors(edge.from_item_id, seen);
    }
    return seen;
  };
  const ancestry = items.map((item) => ancestors(item.item_id));
  const conflicts = items.map((item, i) => items.map((other, j) => ancestry[i].has(other.item_id) || ancestry[j].has(item.item_id)));
  const maxima = axis.map(() => Object.fromEntries(metricSet.map((m) => [m, -Infinity])));
  const chosen = [];
  let evaluatedInventories = 0;
  const started = performance.now();
  const timing = { setupMs: started - setupStarted, combinationMs: 0, legalityMs: 0, evaluationMs: 0, aggregationMs: 0 };
  let candidateExtensions = 0;
  let illegalExtensions = 0;
  const timingSnapshot = () => profile ? { ...timing, candidateExtensions, illegalExtensions } : undefined;
  let reported = started;
  const report = (force = false) => {
    const now = performance.now();
    if (onProgress && (force || now - reported >= 1000)) {
      reported = now;
      onProgress({ phase: "direct-reference", telemetry: { runtimeMs: now - started, evaluatedInventories, profiling: timingSnapshot(),
        sampledHeapBytes: typeof process !== "undefined" && process.memoryUsage ? process.memoryUsage().heapUsed : null } });
    }
  };
  const visit = (start, cost, active) => {
    let tick = profile ? performance.now() : 0;
    const first = axis.findIndex((s, i) => s >= cost && capacities[i] >= chosen.length);
    if (profile) { timing.legalityMs += performance.now() - tick; tick = performance.now(); }
    if (first < 0) return;
    const inventory = chosen.map((i) => items[i].item_id);
    if (profile) { timing.combinationMs += performance.now() - tick; tick = performance.now(); }
    const values = metrics({ inventory });
    if (profile) { timing.evaluationMs += performance.now() - tick; tick = performance.now(); }
    for (const m of metricSet) {
      if (!Number.isFinite(values[m]) || values[m] < 0) throw new Error(`Invalid reference metric: ${m}`);
      maxima[first][m] = Math.max(maxima[first][m], values[m]);
    }
    if (profile) timing.aggregationMs += performance.now() - tick;
    evaluatedInventories++;
    report();
    if (chosen.length === capacities.at(-1)) return;
    for (let i = start; i < items.length; i++) {
      tick = profile ? performance.now() : 0;
      const nextCost = cost + Number(items[i].total_cost);
      const nextActive = active + Number(Boolean(items[i].active_type));
      if (profile) { candidateExtensions++; timing.combinationMs += performance.now() - tick; tick = performance.now(); }
      const illegal = nextCost > budget || nextActive > activeLimit || chosen.some((j) => conflicts[i][j]);
      if (profile) { timing.legalityMs += performance.now() - tick; if (illegal) illegalExtensions++; }
      if (illegal) continue;
      tick = profile ? performance.now() : 0;
      chosen.push(i);
      if (profile) timing.combinationMs += performance.now() - tick;
      visit(i + 1, nextCost, nextActive);
      tick = profile ? performance.now() : 0;
      chosen.pop();
      if (profile) timing.combinationMs += performance.now() - tick;
    }
  };
  visit(0, 0, 0);
  for (let i = 1; i < axis.length; i++) for (const m of metricSet) maxima[i][m] = Math.max(maxima[i][m], maxima[i - 1][m]);
  report(true);
  return { byMetric: Object.fromEntries(metricSet.map((m) => [m, axis.map((earnedSouls, i) => ({ earnedSouls, kind: "resource", metrics: { [m]: maxima[i][m] } }))])),
    unsupportedUpgrades: domain.resourceEvents.unsupportedUpgrades,
    telemetry: { evaluatedInventories, runtimeMs: performance.now() - started, profiling: timingSnapshot() } };
}

const VECTOR_KEYS = Object.freeze(["pathScore", "endScore"]);

export function pathEndVector(entry) {
  const vector = { pathScore: entry?.pathScore, endScore: entry?.endScore };
  for (const key of VECTOR_KEYS) {
    if (!Number.isFinite(vector[key])) throw new TypeError(`Pareto-${key} muss endlich sein.`);
  }
  return vector;
}

export function pathEndDominates(left, right) {
  const a = pathEndVector(left);
  const b = pathEndVector(right);
  return a.pathScore >= b.pathScore && a.endScore >= b.endScore &&
    (a.pathScore > b.pathScore || a.endScore > b.endScore);
}

export function pathEndParetoFront(entries) {
  if (!Array.isArray(entries)) throw new TypeError("entries muss ein Array sein.");
  const front = entries.filter((candidate, index) =>
    !entries.some((other, otherIndex) => otherIndex !== index && pathEndDominates(other, candidate))
  );
  return [...front].sort((a, b) =>
    b.pathScore - a.pathScore ||
    b.endScore - a.endScore ||
    String(a.id ?? "").localeCompare(String(b.id ?? ""))
  );
}

export function classifyBaseline(candidates, baseline) {
  if (!Array.isArray(candidates)) throw new TypeError("candidates muss ein Array sein.");
  pathEndVector(baseline);
  const dominators = candidates.filter((candidate) => pathEndDominates(candidate, baseline));
  const dominated = candidates.filter((candidate) => pathEndDominates(baseline, candidate));
  const betterPathNoEndLoss = candidates.filter((candidate) =>
    candidate.pathScore > baseline.pathScore && candidate.endScore >= baseline.endScore
  );
  const betterEndNoPathLoss = candidates.filter((candidate) =>
    candidate.endScore > baseline.endScore && candidate.pathScore >= baseline.pathScore
  );
  return {
    nondominatedRelativeToCandidateSet: dominators.length === 0,
    dominatedBy: dominators.map((candidate) => candidate.id),
    dominates: dominated.map((candidate) => candidate.id),
    betterPathNoEndLoss: betterPathNoEndLoss.map((candidate) => candidate.id),
    betterEndNoPathLoss: betterEndNoPathLoss.map((candidate) => candidate.id)
  };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarizeTradeoffs(front) {
  if (!Array.isArray(front)) throw new TypeError("front muss ein Array sein.");
  if (!front.length) return {
    pathRange: null,
    endRange: null,
    adjacentTradeoffs: [],
    medianPathGain: null,
    medianEndLoss: null
  };
  const sorted = [...front].sort((a, b) =>
    a.pathScore - b.pathScore ||
    b.endScore - a.endScore ||
    String(a.id ?? "").localeCompare(String(b.id ?? ""))
  );
  const adjacentTradeoffs = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const from = sorted[index - 1];
    const to = sorted[index];
    const pathGain = to.pathScore - from.pathScore;
    const endChange = to.endScore - from.endScore;
    if (pathGain <= 0) continue;
    adjacentTradeoffs.push({
      from: from.id,
      to: to.id,
      pathGain,
      endChange,
      endLoss: Math.max(0, -endChange)
    });
  }
  return {
    pathRange: {
      min: Math.min(...front.map((entry) => entry.pathScore)),
      max: Math.max(...front.map((entry) => entry.pathScore))
    },
    endRange: {
      min: Math.min(...front.map((entry) => entry.endScore)),
      max: Math.max(...front.map((entry) => entry.endScore))
    },
    adjacentTradeoffs,
    medianPathGain: median(adjacentTradeoffs.map((entry) => entry.pathGain)),
    medianEndLoss: median(adjacentTradeoffs.map((entry) => entry.endLoss))
  };
}

export function pathEventObservables(events, budget, itemCosts = new Map()) {
  if (!Array.isArray(events)) throw new TypeError("events muss ein Array sein.");
  if (!Number.isFinite(budget) || budget < 0) throw new RangeError("budget ist ungültig.");

  let earnedSouls = 0;
  const timeline = [];
  const counts = { purchase: 0, upgrade: 0, replacement: 0, sell: 0 };
  const held = new Set();
  const everHeld = new Set();
  const soldAway = new Set();
  const replacedAway = new Set();
  const upgradedAway = new Set();
  const reacquisitions = new Map();
  const sellRebuys = new Map();
  const replacementRebuys = new Map();
  const upgradeBacktracks = new Map();

  const increment = (map, key) => map.set(key, (map.get(key) || 0) + 1);
  const acquire = (item) => {
    if (!item) return;
    if (everHeld.has(item) && !held.has(item)) increment(reacquisitions, item);
    if (soldAway.has(item)) increment(sellRebuys, item);
    if (replacedAway.has(item)) increment(replacementRebuys, item);
    if (upgradedAway.has(item)) increment(upgradeBacktracks, item);
    held.add(item);
    everHeld.add(item);
  };

  for (const event of events) {
    if (event.type === "save") {
      earnedSouls = Number(event.earnedSouls);
      continue;
    }
    if (!Object.hasOwn(counts, event.type)) continue;
    counts[event.type] += 1;
    const row = {
      type: event.type,
      earnedSouls,
      item: event.item ?? null,
      from: event.from ?? null,
      payment: Number(event.payment ?? 0)
    };
    timeline.push(row);

    if (event.type === "sell") {
      if (event.from) {
        held.delete(event.from);
        soldAway.add(event.from);
      }
      continue;
    }
    if (event.type === "replacement") {
      if (event.from) {
        held.delete(event.from);
        replacedAway.add(event.from);
      }
      acquire(event.item);
      continue;
    }
    if (event.type === "upgrade") {
      if (event.from) {
        held.delete(event.from);
        upgradedAway.add(event.from);
      }
      acquire(event.item);
      continue;
    }
    acquire(event.item);
  }

  const bySoul = new Map();
  for (const event of timeline) {
    const list = bySoul.get(event.earnedSouls) || [];
    list.push(event);
    bySoul.set(event.earnedSouls, list);
  }
  const sameSoulTransactionGroups = [...bySoul.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([souls, rows]) => ({
      earnedSouls: souls,
      transactionCount: rows.length,
      types: rows.map((row) => row.type),
      items: rows.map((row) => row.item ?? row.from)
    }));

  const anchors = [0, ...timeline.map((event) => event.earnedSouls), budget].sort((a, b) => a - b);
  let longestNoShopSoulSpan = 0;
  for (let index = 1; index < anchors.length; index += 1) {
    longestNoShopSoulSpan = Math.max(longestNoShopSoulSpan, anchors[index] - anchors[index - 1]);
  }

  const repeated = (map) => [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([item, count]) => ({
      item,
      count,
      totalCost: Number.isFinite(Number(itemCosts.get(item))) ? Number(itemCosts.get(item)) : null
    }));

  return {
    counts,
    transactionCount: timeline.length,
    firstTransactionSouls: timeline[0]?.earnedSouls ?? null,
    lastTransactionSouls: timeline.at(-1)?.earnedSouls ?? null,
    longestNoShopSoulSpan,
    sameSoulTransactionGroups,
    reacquiredItems: repeated(reacquisitions),
    sellRebuys: repeated(sellRebuys),
    replacementRebuys: repeated(replacementRebuys),
    upgradeBacktracks: repeated(upgradeBacktracks),
    timeline
  };
}

export function counterexampleObservables(candidates, baseline) {
  if (!Array.isArray(candidates)) throw new TypeError("candidates muss ein Array sein.");
  if (!candidates.length) return {
    highestTransactionCounts: [],
    longestSavingSpans: [],
    sameSoulTransactions: [],
    reacquisitionCandidates: [],
    pathGainEndLossCandidates: []
  };
  const pick = (sorter, count = 5) => [...candidates].sort(sorter).slice(0, count).map((entry) => entry.id);
  return {
    highestTransactionCounts: pick((a, b) =>
      b.pathObservables.transactionCount - a.pathObservables.transactionCount || String(a.id).localeCompare(String(b.id))
    ),
    longestSavingSpans: pick((a, b) =>
      b.pathObservables.longestNoShopSoulSpan - a.pathObservables.longestNoShopSoulSpan || String(a.id).localeCompare(String(b.id))
    ),
    sameSoulTransactions: candidates
      .filter((entry) => entry.pathObservables.sameSoulTransactionGroups.length)
      .map((entry) => entry.id),
    reacquisitionCandidates: candidates
      .filter((entry) => entry.pathObservables.reacquiredItems.length)
      .map((entry) => entry.id),
    pathGainEndLossCandidates: baseline ? candidates
      .filter((entry) => entry.pathScore > baseline.pathScore && entry.endScore < baseline.endScore)
      .sort((a, b) => (b.pathScore - baseline.pathScore) - (a.pathScore - baseline.pathScore))
      .map((entry) => entry.id) : []
  };
}

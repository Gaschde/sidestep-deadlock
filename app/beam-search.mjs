import { createDeadlockDomain } from "./deadlock-domain.mjs";
import { evaluateCarryPerformance, CARRY_METRICS, carryResourceAxis } from "./warden-search.mjs";
import { validateSearchPath } from "./validate-search-path.mjs";
import { heroCanPurchaseItem } from "./optimizer.mjs";
import { normalizeMilestones, milestoneSnapshots } from "./search-milestones.mjs";
import {
  COMPONENT_METRICS,
  metricValue,
  scoreMilestonePath
} from "./search-objective.mjs";
import { normalizeOpponentScenario } from "./search-scenarios.mjs";
import { paretoFront } from "./pareto.mjs";
import { FAST_SEARCH_BUDGET } from "./search-config.mjs";
import { createBeamProfiler } from "./search-telemetry.mjs";

const REFERENCE_METRICS = Object.freeze([...CARRY_METRICS, ...COMPONENT_METRICS]);
export { scoreMilestonePath };

function transactionCount(node) {
  let count = 0;
  for (let current = node; current?.parent; current = current.parent) count += Number(current.event?.type !== "save");
  return count;
}

function eventChain(node) {
  const chain = [];
  for (let current = node; current?.parent; current = current.parent) chain.push(current.event);
  return chain.reverse();
}

function buildFamilyRoots(data) {
  const parent = new Map(data.upgrades.map((edge) => [edge.to_item_id, edge.from_item_id]));
  const cache = new Map();
  return (id) => {
    if (cache.has(id)) return cache.get(id);
    let current = id;
    const seen = new Set();
    while (parent.has(current) && !seen.has(current)) {
      seen.add(current);
      current = parent.get(current);
    }
    cache.set(id, current);
    return current;
  };
}

function better(candidate, incumbent) {
  if (!incumbent) return true;
  if (candidate.quality.score !== incumbent.quality.score) return candidate.quality.score > incumbent.quality.score;
  return candidate.transactions < incumbent.transactions ||
    (candidate.transactions === incumbent.transactions && candidate.node.serial < incumbent.node.serial);
}

export function runIterativeDiverseBeamCarry({
  data,
  heroId = "warden",
  damageFocus = "weapon",
  itemIds = data.items.map((item) => item.item_id),
  budget = FAST_SEARCH_BUDGET,
  milestones,
  opponentBulletResist = 0,
  opponentSpiritResist = 0,
  timeMs = 25000,
  referenceTimeMs = 1500,
  reference: suppliedReference,
  slotUnlocks = [],
  initialBeamWidth = 4,
  maxBeamWidth = 32,
  widenFactor = 2,
  scorePath = scoreMilestonePath,
  profile = false,
  onResult,
  onProgress
}) {
  if (!Number.isFinite(timeMs) || timeMs <= 0 || !Number.isSafeInteger(budget) || budget <= 0) throw new Error("Invalid search budget");
  for (const [name, value] of [["initialBeamWidth", initialBeamWidth], ["maxBeamWidth", maxBeamWidth], ["widenFactor", widenFactor]]) {
    if (!Number.isSafeInteger(value) || value < (name === "widenFactor" ? 2 : 1)) throw new RangeError(`${name} ist ungültig.`);
  }
  if (initialBeamWidth > maxBeamWidth) throw new RangeError("initialBeamWidth darf maxBeamWidth nicht überschreiten.");
  if (typeof scorePath !== "function") throw new TypeError("scorePath muss eine Funktion sein.");

  const scenario = normalizeOpponentScenario({ opponentBulletResist, opponentSpiritResist });
  const checkpoints = normalizeMilestones(milestones, budget);
  const started = performance.now();
  const profiler = createBeamProfiler(profile);
  const terminalAuditReserveMs = Math.min(2000, Math.max(0, timeMs * 0.2));
  const searchDeadline = started + timeMs - terminalAuditReserveMs;
  const finalDeadline = started + timeMs;
  const unavailableItemIds = itemIds.filter((id) => !heroCanPurchaseItem(data.itemsById.get(id), data, heroId));
  const legalItemIds = itemIds.filter((id) => !unavailableItemIds.includes(id));
  const compressed = carryResourceAxis(data, legalItemIds, budget);
  const axis = [...new Set([...compressed.axis, ...checkpoints])].sort((a, b) => a - b);
  const resource = { ...compressed, axis, configuredMilestones: checkpoints };
  const domain = createDeadlockDomain({ data, itemIds: legalItemIds, budget, slotUnlocks, soulAxis: axis, metrics: () => ({ value: 0 }),
    telemetry: profiler.enabled ? profiler : null });
  const clean = (state) => ({ ...state, events: [], snapshots: [] });
  const request = { heroId, damageFocus, budget, cacheProfiles: false, metricsOnly: true, ...scenario };
  const metricCache = new Map();
  let evaluations = 0;
  const metrics = (state) => {
    const key = [...state.inventory].sort().join("|");
    if (!metricCache.has(key)) {
      profiler.count("metricCacheMisses");
      const result = profiler.time("evaluationMs", () => evaluateCarryPerformance(state, request, data));
      if (!result.valid) throw new Error(result.reason);
      metricCache.set(key, result.metrics);
      evaluations++;
      profiler.count("evaluatedInventories");
    } else profiler.count("metricCacheHits");
    return metricCache.get(key);
  };
  const root = { state: clean(domain.initial), parent: null, event: null, serial: "" };
  const pointsCache = new WeakMap();
  const qualityCache = new WeakMap();
  const continuationCache = new WeakMap();
  const nodePoints = (node) => {
    if (pointsCache.has(node)) return pointsCache.get(node);
    const chain = [];
    for (let current = node; current; current = current.parent) chain.push(current);
    const points = chain.reverse().map((entry) => ({ earnedSouls: entry.state.earnedSouls, metrics: metrics(entry.state) }));
    pointsCache.set(node, points);
    return points;
  };
  const nodeQuality = (node) => {
    if (!qualityCache.has(node)) qualityCache.set(node, profiler.time("trajectoryScoreMs",
      () => scorePath(nodePoints(node), reference, checkpoints, budget, damageFocus)));
    return qualityCache.get(node);
  };
  const makeNode = (parent, nextState) => {
    const event = nextState.events[0];
    return { state: clean(nextState), parent, event, serial: `${parent.serial}|${JSON.stringify(event)}` };
  };
  const domainTransitions = (state) => profiler.time("transitionMs", () => {
    profiler.count("transitionCalls");
    const states = domain.transitions(state);
    profiler.count("generatedStates", states.length);
    return states;
  });
  const transitions = (node) => domainTransitions(node.state).map((state) => makeNode(node, state));

  const referenceStartedAt = profiler.enabled ? performance.now() : 0;
  const baseline = metrics(root.state);
  let reference = suppliedReference;
  if (reference) {
    if (JSON.stringify(reference.axis) !== JSON.stringify(axis)) throw new Error("Reference axis mismatch");
  } else {
    reference = { axis, values: axis.map(() => ({ ...baseline })) };
    const referenceDeadline = Math.min(searchDeadline, started + Math.min(referenceTimeMs, timeMs * 0.2));
    for (const objective of CARRY_METRICS) {
      let state = { ...root.state, cash: budget, earnedSouls: budget };
      while (performance.now() < referenceDeadline) {
        const currentMetrics = metrics(state);
        let best = null;
        let bestValue = metricValue(currentMetrics, objective);
        for (const next of domainTransitions(state)) {
          const type = next.events[0]?.type;
          if (!["purchase", "upgrade", "replacement"].includes(type)) continue;
          const values = metrics(next);
          const spent = budget - next.cash;
          const first = axis.findIndex((souls) => souls >= spent);
          if (first >= 0) for (let index = first; index < reference.values.length; index++) {
            for (const metric of REFERENCE_METRICS) {
              reference.values[index][metric] = Math.max(metricValue(reference.values[index], metric), metricValue(values, metric));
            }
          }
          const value = metricValue(values, objective);
          if (value > bestValue) { best = next; bestValue = value; }
          if (performance.now() >= referenceDeadline) break;
        }
        if (!best) break;
        state = clean(best);
      }
    }
    // Every reference row is an attainable sampled envelope, so enforce only
    // monotone carry-forward, never a claimed upper bound.
    for (let index = 1; index < reference.values.length; index++) {
      for (const metric of REFERENCE_METRICS) {
        reference.values[index][metric] = Math.max(metricValue(reference.values[index - 1], metric), metricValue(reference.values[index], metric));
      }
    }
  }
  if (profiler.enabled) profiler.add("referenceMs", performance.now() - referenceStartedAt);

  const rootFamily = buildFamilyRoots(data);
  const diversityKey = (node) => {
    const counts = { Weapon: 0, Vitality: 0, Spirit: 0, Other: 0 };
    const roots = [];
    for (const id of node.state.inventory) {
      const category = data.itemsById.get(id)?.category;
      counts[Object.hasOwn(counts, category) ? category : "Other"]++;
      roots.push(rootFamily(id));
    }
    return `${counts.Weapon}/${counts.Vitality}/${counts.Spirit}/${counts.Other}:${[...new Set(roots)].sort().join(",")}`;
  };

  const continuationScore = (node) => {
    if (continuationCache.has(node)) return continuationCache.get(node);
    profiler.count("continuationLookaheadCalls");
    const continuationStartedAt = profiler.enabled ? performance.now() : 0;
    let best = nodeQuality(node).score;
    if (node.event?.type === "purchase") {
      for (const edge of domain.supportedUpgradesByFrom.get(node.event.item) || []) {
        let projected = node;
        while (projected.state.earnedSouls < budget && performance.now() < searchDeadline) {
          const successors = transitions(projected);
          const upgrade = successors.find((candidate) =>
            candidate.event?.type === "upgrade" && candidate.event.from === edge.from_item_id && candidate.event.item === edge.to_item_id);
          if (upgrade) {
            best = Math.max(best, nodeQuality(upgrade).score);
            break;
          }
          const save = successors.find((candidate) => candidate.event?.type === "save");
          if (!save) break;
          projected = save;
        }
      }
    }
    continuationCache.set(node, best);
    if (profiler.enabled) profiler.add("continuationLookaheadMs", performance.now() - continuationStartedAt);
    return best;
  };

  const completedHistorySignature = (node) => {
    const quality = nodeQuality(node);
    return JSON.stringify(quality.milestones
      .filter((row) => row.earnedSouls <= node.state.earnedSouls)
      .map((row) => [row.earnedSouls, row.damage, row.survivability]));
  };
  const safeDedupe = (nodes) => {
    const dedupeStartedAt = profiler.enabled ? performance.now() : 0;
    const unique = new Map();
    for (const node of nodes) {
      const key = `${domain.futureKey(node.state)}::${completedHistorySignature(node)}`;
      const prior = unique.get(key);
      if (!prior || transactionCount(node) < transactionCount(prior) ||
          (transactionCount(node) === transactionCount(prior) && node.serial < prior.serial)) unique.set(key, node);
    }
    const result = [...unique.values()];
    if (profiler.enabled) profiler.add("dedupeMs", performance.now() - dedupeStartedAt);
    return result;
  };

  const compareNodes = (left, right) => {
    const score = continuationScore(right) - continuationScore(left);
    if (score) return score;
    const quality = nodeQuality(right).score - nodeQuality(left).score;
    return quality || left.serial.localeCompare(right.serial);
  };

  const timedSort = (array, compare) => profiler.time("sortingMs", () => array.sort(compare));
  const timedPareto = (entries, vector) => profiler.time("paretoMs", () => paretoFront(entries, vector));
  const selectDiverse = (nodes, width) => profiler.time("diversityMs", () => {
    const deduped = safeDedupe(nodes);
    if (deduped.length <= width) return timedSort(deduped, compareNodes);
    const front = timedPareto(deduped, (node) => {
      const quality = nodeQuality(node);
      return { damage: quality.damage, survivability: quality.survivability };
    });
    timedSort(front, compareNodes);
    const selected = [];
    const selectedSet = new Set();
    const add = (node) => {
      if (node && selected.length < width && !selectedSet.has(node)) {
        selected.push(node);
        selectedSet.add(node);
      }
    };
    const ranked = timedSort([...deduped], compareNodes);
    add(ranked[0]);
    add(timedSort([...deduped], (a, b) => nodeQuality(b).damage - nodeQuality(a).damage || compareNodes(a, b))[0]);
    add(timedSort([...deduped], (a, b) => nodeQuality(b).survivability - nodeQuality(a).survivability || compareNodes(a, b))[0]);
    for (const node of front) add(node);

    const buckets = new Map();
    for (const node of ranked) {
      const key = diversityKey(node);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(node);
    }
    const keys = [...buckets.keys()].sort();
    let progressed = true;
    while (selected.length < width && progressed) {
      progressed = false;
      for (const key of keys) {
        const bucket = buckets.get(key);
        while (bucket.length && selectedSet.has(bucket[0])) bucket.shift();
        if (bucket.length) { add(bucket.shift()); progressed = true; }
        if (selected.length >= width) break;
      }
    }
    for (const node of ranked) add(node);
    return selected;
  });

  const completeBySaving = (node) => {
    let current = node;
    while (current.state.earnedSouls < budget) {
      const save = transitions(current).find((candidate) => candidate.event?.type === "save");
      if (!save) throw new Error("Legal save completion unavailable.");
      current = save;
    }
    return current;
  };

  let winner = null;
  let publishedImprovements = 0;
  let generatedStates = 0;
  let duplicateStates = 0;
  let maxCandidatePool = 0;
  const widthsStarted = [];
  const widthsCompleted = [];
  const publish = (node, locallyVerified = false) => {
    const quality = nodeQuality(node);
    const candidate = { node, quality, transactions: transactionCount(node) };
    if (!better(candidate, winner)) return false;
    const reconstructed = profiler.time("pathReconstructionMs", () => {
      const points = nodePoints(node);
      return { points, state: { ...node.state, events: eventChain(node), snapshots: points } };
    });
    const { points, state } = reconstructed;
    const validation = profiler.time("validationMs", () =>
      validateSearchPath({ data, itemIds: legalItemIds, budget, soulAxis: axis, slotUnlocks, state }));
    const milestonesResult = milestoneSnapshots(points, checkpoints, budget);
    winner = {
      ...candidate,
      state,
      slotUnlocks,
      slotLimit: Number(data.slots.starting_slots.universal) + node.state.unlockedSlots,
      validation,
      milestones: { configured: checkpoints, snapshots: milestonesResult },
      scenario,
      reference,
      resource,
      backend: "iterative-diverse-beam",
      approximate: true,
      unsupportedUpgrades: domain.resourceEvents.unsupportedUpgrades,
      unavailableItemIds,
      semantics: {
        legallyPathVerified: validation.valid === true,
        bestFound: true,
        locallyVerified,
        bounded: false,
        optimal: false
      },
      certification: {
        bound: null,
        status: "not_run",
        branchAndBound: "shadow_disabled_pending_outward_rounded_bounds"
      },
      telemetry: { runtimeMs: performance.now() - started, evaluations, generatedStates, publishedImprovements: publishedImprovements + 1 }
    };
    publishedImprovements++;
    onResult?.(winner);
    return true;
  };

  let width = initialBeamWidth;
  const beamSearchStartedAt = profiler.enabled ? performance.now() : 0;
  while (performance.now() < searchDeadline) {
    widthsStarted.push(width);
    const widthStartedAt = profiler.enabled ? performance.now() : 0;
    const widthGeneratedAtStart = generatedStates;
    let beam = [root];
    let completed = true;
    let firstCompletionPublished = false;
    while (beam.length && performance.now() < searchDeadline) {
      const candidates = [];
      let interrupted = false;
      for (const node of beam) {
        if (node.state.earnedSouls === budget) {
          publish(node);
          continue;
        }
        const successors = transitions(node);
        generatedStates += successors.length;
        candidates.push(...successors);
        if (performance.now() >= searchDeadline) { interrupted = true; break; }
      }
      if (!candidates.length) break;
      maxCandidatePool = Math.max(maxCandidatePool, candidates.length);
      profiler.pushCandidatePool({ width, size: candidates.length, runtimeMs: performance.now() - started });
      const unique = safeDedupe(candidates);
      duplicateStates += candidates.length - unique.length;
      profiler.count("uniqueStates", unique.length);
      profiler.count("duplicateStates", candidates.length - unique.length);
      beam = selectDiverse(unique, width);
      if (!firstCompletionPublished && beam.length) {
        publish(completeBySaving(beam[0]));
        firstCompletionPublished = true;
      }
      for (const node of beam) if (node.state.earnedSouls === budget) publish(node);
      onProgress?.({ phase: "beam", width, runtimeMs: performance.now() - started, evaluations, generatedStates,
        retained: beam.length, bestScore: winner?.quality.score, paretoCount: timedPareto(beam, (node) => {
          const q = nodeQuality(node); return { damage: q.damage, survivability: q.survivability };
        }).length });
      if (interrupted) { completed = false; break; }
    }
    if (completed) widthsCompleted.push(width);
    profiler.pushWidth({ width, generatedStates: generatedStates - widthGeneratedAtStart,
      runtimeMs: profiler.enabled ? performance.now() - widthStartedAt : 0, completed });
    if (!completed || width >= maxBeamWidth || performance.now() >= searchDeadline) break;
    width = Math.min(maxBeamWidth, width * widenFactor);
  }
  if (profiler.enabled) profiler.add("beamSearchMs", performance.now() - beamSearchStartedAt);

  // Reuse the existing terminal-audit idea: repeatedly inspect the complete
  // direct purchase/upgrade/replacement neighbourhood under the same domain.
  const terminalAudit = { complete: false, rounds: 0, legalActions: 0, checkedActions: 0, improvements: 0,
    neighbourhood: "purchase|upgrade|replacement", incumbentScore: winner?.quality.score ?? null };
  const terminalAuditStartedAt = profiler.enabled ? performance.now() : 0;
  if (winner) {
    let current = winner.node;
    while (performance.now() < finalDeadline) {
      terminalAudit.rounds++;
      const actions = transitions(current).filter((node) => ["purchase", "upgrade", "replacement"].includes(node.event?.type));
      terminalAudit.legalActions += actions.length;
      let best = null;
      let interrupted = false;
      for (const candidate of actions) {
        if (performance.now() >= finalDeadline) { interrupted = true; break; }
        terminalAudit.checkedActions++;
        const q = nodeQuality(candidate);
        if (!best || q.score > best.quality.score) best = { node: candidate, quality: q };
      }
      if (best && best.quality.score > nodeQuality(current).score) {
        current = best.node;
        terminalAudit.improvements++;
        publish(current);
      } else if (!interrupted) {
        terminalAudit.complete = true;
        break;
      }
      if (interrupted) break;
    }
    winner.semantics = { ...winner.semantics, locallyVerified: terminalAudit.complete };
  }
  if (profiler.enabled) profiler.add("terminalAuditMs", performance.now() - terminalAuditStartedAt);

  if (!winner) {
    // A valid empty-build incumbent is preferable to returning no result when
    // the evaluation/reference phase consumed an unusually small time budget.
    publish(completeBySaving(root));
  }
  const telemetry = {
    runtimeMs: performance.now() - started,
    evaluations,
    generatedStates,
    duplicateStates,
    maxCandidatePool,
    widthsStarted,
    widthsCompleted,
    publishedImprovements,
    terminalAudit,
    pruning: {
      exactFutureHistoryDedupe: true,
      paretoDominancePruning: false,
      beamTruncation: "heuristic_budgeted"
    },
    profile: profiler.snapshot({ widthsStarted: [...widthsStarted], widthsCompleted: [...widthsCompleted] })
  };
  return { ...winner, telemetry, searchTelemetry: telemetry };
}

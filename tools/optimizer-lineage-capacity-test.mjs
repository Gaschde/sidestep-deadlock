import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "../app/lib.mjs";
import { buildOptimizerData, heroCanPurchaseItem } from "../app/optimizer.mjs";
import { carryResourceAxis, evaluateCarryPerformance } from "../app/warden-search.mjs";
import { createDeadlockDomain } from "../app/deadlock-domain.mjs";
import { normalizeMilestones } from "../app/search-milestones.mjs";
import { measureSoulAxisPath } from "../app/search-objective-v1.mjs";
import { dedupeFuturePathHistory, selectPathEndParetoBeam } from "../app/multiobjective-search.mjs";
import { pathEndParetoFront } from "../app/path-end-pareto.mjs";
import { benchmarkCases } from "../benchmarks/optimizer-v1/cases.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SOURCE = resolve(ROOT, "benchmarks/optimizer-v1/experiments/retention-loss-counterfactual/results.json");
const REFERENCE = resolve(ROOT, "benchmarks/optimizer-v1/references/baseline-v0.json");
const DEFAULT_OUTPUT = resolve(ROOT, "benchmarks/optimizer-v1/experiments/lineage-vs-lineage-capacity/results.json");
const TARGET = "93260772842f0c27";
const STATE_CAP = 500000;
const SWEET = Object.freeze({ id: "carry-sweet-70-30-spec-77_5-22_5", damageWeight: 0.70, survivalWeight: 0.30, damageFocusWeights: Object.freeze({ weapon: Object.freeze({ bullet: 0.775, spirit: 0.225 }), spirit: Object.freeze({ bullet: 0.225, spirit: 0.775 }), hybrid: Object.freeze({ bullet: 0.5, spirit: 0.5 }) }) });

const hash = (events) => createHash("sha256").update(JSON.stringify(events)).digest("hex").slice(0, 16);
const eventsFromPath = (path) => String(path).split("|").slice(1).map((entry) => JSON.parse(entry));
const same = (a, b) => a?.type === b?.type && ["earnedSouls", "item", "from", "payment", "saleProceeds"].every((key) => !Object.hasOwn(b, key) || a?.[key] === b[key]);
const dominates = (a, b) => a.pathScore >= b.pathScore && a.endScore >= b.endScore && (a.pathScore > b.pathScore || a.endScore > b.endScore);

function loadData() {
  const json = (path) => JSON.parse(readFileSync(resolve(ROOT, path), "utf8"));
  const csv = (path) => parseCsv(readFileSync(resolve(ROOT, path), "utf8"));
  return buildOptimizerData({ coreManifest: json("data/core/manifest.json"), heroManifest: json("data/heroes/manifest.json"), items: csv("data/core/items.csv"), itemMechanics: csv("data/core/item_mechanics.csv"), upgrades: csv("data/core/item_upgrades.csv"), economy: json("data/core/economy.json"), slots: json("data/core/slots.json"), heroes: csv("data/heroes/heroes.csv"), heroStats: csv("data/heroes/hero_stats.csv"), abilities: csv("data/heroes/abilities.csv"), abilityMechanics: csv("data/heroes/ability_mechanics.csv"), heroResources: csv("data/heroes/hero_resources.csv") });
}
function familyKey(data) {
  const parent = new Map(data.upgrades.map((edge) => [edge.to_item_id, edge.from_item_id]));
  const root = (id) => { const seen = new Set(); let cur = id; while (parent.has(cur) && !seen.has(cur)) { seen.add(cur); cur = parent.get(cur); } return cur; };
  return (node) => { const counts = { Weapon: 0, Vitality: 0, Spirit: 0, Other: 0 }; const roots = []; for (const id of node.state.inventory) { const c = data.itemsById.get(id)?.category; counts[Object.hasOwn(counts, c) ? c : "Other"] += 1; roots.push(root(id)); } return `${counts.Weapon}/${counts.Vitality}/${counts.Spirit}/${counts.Other}:${[...new Set(roots)].sort().join(",")}`; };
}
function runtime(data, definition, reference) {
  const itemIds = (definition.itemIds || data.items.map((item) => item.item_id)).filter((id) => heroCanPurchaseItem(data.itemsById.get(id), data, definition.hero));
  const checkpoints = normalizeMilestones(definition.milestones, definition.budget);
  const axis = [...new Set([...carryResourceAxis(data, itemIds, definition.budget).axis, ...checkpoints])].sort((a, b) => a - b);
  if (JSON.stringify(axis) !== JSON.stringify(reference.axis)) throw new Error("Frozen reference axis mismatch.");
  const domain = createDeadlockDomain({ data, itemIds, budget: definition.budget, slotUnlocks: [{ earnedSouls: 0, slots: Number(data.slots.item_limit) - Number(data.slots.starting_slots.universal) }], soulAxis: axis, metrics: () => ({ value: 0 }) });
  const clean = (state) => ({ ...state, events: [], snapshots: [] });
  const counters = { transitionCalls: 0, generatedStates: 0, evaluations: 0 };
  const metricCache = new Map();
  const metrics = (state) => { const key = [...state.inventory].sort().join("|"); if (!metricCache.has(key)) { const value = evaluateCarryPerformance(state, { heroId: definition.hero, damageFocus: definition.focus, budget: definition.budget, cacheProfiles: false, metricsOnly: true, opponentBulletResist: definition.opponentBulletResist, opponentSpiritResist: definition.opponentSpiritResist }, data); if (!value.valid) throw new Error(value.reason); metricCache.set(key, value.metrics); counters.evaluations += 1; } return metricCache.get(key); };
  const root = { state: clean(domain.initial), parent: null, event: null, serial: "", depth: 0 };
  const transitions = (node) => { counters.transitionCalls += 1; const states = domain.transitions(node.state); counters.generatedStates += states.length; return states.map((state) => ({ state: clean(state), parent: node, event: state.events[0], serial: `${node.serial}|${JSON.stringify(state.events[0])}`, depth: node.depth + 1 })); };
  const pointCache = new WeakMap(); const vectors = new Map();
  const points = (node) => { if (!pointCache.has(node)) { const chain = []; for (let cur = node; cur; cur = cur.parent) chain.push(cur); pointCache.set(node, chain.reverse().map((entry) => ({ earnedSouls: entry.state.earnedSouls, metrics: metrics(entry.state) }))); } return pointCache.get(node); };
  const vector = (node, horizon) => { if (!vectors.has(horizon)) vectors.set(horizon, new WeakMap()); const cache = vectors.get(horizon); if (!cache.has(node)) { const measurement = measureSoulAxisPath(points(node), reference, checkpoints, horizon, definition.focus, null, SWEET); cache.set(node, { pathScore: measurement.pathScore, endScore: measurement.endScore, measurement }); } return cache.get(node); };
  const replay = (path) => { let node = root; for (const event of eventsFromPath(path)) { const next = transitions(node).find((candidate) => same(candidate.event, event)); if (!next) throw new Error(`Cannot replay ${JSON.stringify(event)}.`); node = next; } return node; };
  return { transitions, vector, replay, futureKey: (node) => domain.futureKey(node.state), diversityKey: familyKey(data), counters };
}
function frontRecord(entry) {
  return { id: hash(eventsFromPath(entry.node.serial)), pathScore: entry.pathScore, endScore: entry.endScore, pathDamage: entry.measurement.pathDamage, endDamage: entry.measurement.endDamage, pathSurvival: entry.measurement.pathSurvivability, endSurvival: entry.measurement.endSurvivability };
}
function relation(target, winner) {
  const undominated = target.filter((point) => !winner.some((other) => dominates(other, point)));
  const dominatedWinners = winner.filter((point) => target.some((other) => dominates(other, point)));
  return { targetUndominatedByWinnerCount: undominated.length, targetUndominatedByWinnerIds: undominated.map((point) => point.id), winnerPointsDominatedByTargetCount: dominatedWinners.length, winnerPointsDominatedByTargetIds: dominatedWinners.map((point) => point.id), entireTargetFrontDominated: target.length > 0 && undominated.length === 0, relation: undominated.length === 0 ? "winner-front-dominates-target-front" : dominatedWinners.length ? "target-has-undominated-and-dominating-points" : "tradeoff-no-target-dominance" };
}
function runGroup(rt, seedPaths, width, horizon) {
  let beam = seedPaths.map(rt.replay); const before = { ...rt.counters }; let used = 0; let cap = false; let retentions = 0; let maxDepth = Math.max(...beam.map((node) => node.depth)); let reached = false; const terminals = new Map(); const vector = (node) => rt.vector(node, horizon);
  const expand = (node, predicate) => { if (cap) return []; const prior = rt.counters.generatedStates; const all = rt.transitions(node); const made = rt.counters.generatedStates - prior; const left = STATE_CAP - used; if (made <= left) { used += made; return all.filter(predicate); } used = STATE_CAP; cap = true; return all.slice(0, Math.max(0, left)).filter(predicate); };
  while (beam.length && !cap) {
    const candidates = [];
    for (const node of beam) { if (node.state.earnedSouls === horizon) { reached = true; terminals.set(node.serial, node); continue; } for (const candidate of expand(node, (x) => x.state.earnedSouls <= horizon)) { maxDepth = Math.max(maxDepth, candidate.depth); if (candidate.state.earnedSouls === horizon) { reached = true; terminals.set(candidate.serial, candidate); } candidates.push(candidate); } if (cap) break; }
    if (!candidates.length) break;
    const unique = dedupeFuturePathHistory(candidates, rt.futureKey, vector); retentions += 1; beam = selectPathEndParetoBeam(unique, width, vector, rt.diversityKey).selected;
    if (beam.every((node) => node.state.earnedSouls === horizon)) break;
  }
  const closure = new Map([...terminals.values(), ...beam.filter((node) => node.state.earnedSouls === horizon)].map((node) => [node.serial, node])); let queue = [...closure.values()]; let closureComplete = false;
  while (reached && queue.length && !cap) { const next = []; for (const node of queue) { for (const candidate of expand(node, (x) => x.state.earnedSouls === horizon && x.event?.type !== "save")) { maxDepth = Math.max(maxDepth, candidate.depth); if (!closure.has(candidate.serial)) { closure.set(candidate.serial, candidate); next.push(candidate); } } if (cap) break; } if (!next.length) { closureComplete = !cap; break; } queue = dedupeFuturePathHistory(next, rt.futureKey, vector); for (const node of queue) closure.set(node.serial, node); }
  const nodes = [...closure.values()]; const front = pathEndParetoFront(nodes.map((node) => ({ node, ...vector(node) }))).map(frontRecord); const after = rt.counters;
  return { generatedStates: used, evaluatedStates: after.evaluations - before.evaluations, transitionCalls: after.transitionCalls - before.transitionCalls, retentionCalls: retentions, maxDepth, stateCapReached: cap, horizonReached: reached, sameSoulClosureComplete: closureComplete, frontierSize: front.length, front };
}
function main() {
  const source = JSON.parse(readFileSync(SOURCE, "utf8")); const saved = source.directionB?.horizons?.[0]?.runs || []; const targetSeeds = saved.filter((run) => run.group === "target-child"); const winnerSeeds = saved.filter((run) => run.group === "actual-winner");
  if (source.scope?.targetPathId !== TARGET || source.reconstructedPool?.targetChildCount !== 24 || targetSeeds.length !== 24 || winnerSeeds.length !== 4) throw new Error("Stored step-14 reconstruction is not the expected 24-vs-4 pool.");
  if (new Set(targetSeeds.map((run) => run.id)).size !== 24 || new Set(winnerSeeds.map((run) => run.id)).size !== 4) throw new Error("Stored lineage seed IDs are not unique.");
  const data = loadData(); const definition = benchmarkCases("production").find((entry) => entry.hero === "warden" && entry.focus === "weapon"); const reference = JSON.parse(readFileSync(REFERENCE, "utf8")).references[definition?.id]?.reference; if (!definition || !reference) throw new Error("Warden Weapon reference missing.");
  const conditions = [];
  for (const horizon of [5200, 6800]) for (const width of [4, 16]) { const target = runGroup(runtime(data, definition, reference), targetSeeds.map((run) => run.path), width, horizon); const winner = runGroup(runtime(data, definition, reference), winnerSeeds.map((run) => run.path), width, horizon); conditions.push({ horizon, width, stateCap: STATE_CAP, target, winner, paretoRelation: relation(target.front, winner.front), interpretable: !target.stateCapReached && !winner.stateCapReached && target.horizonReached && winner.horizonReached && target.sameSoulClosureComplete && winner.sameSoulClosureComplete }); }
  const result = { schemaVersion: "optimizer-lineage-vs-lineage-capacity-v1", sourceArtifact: "benchmarks/optimizer-v1/experiments/retention-loss-counterfactual/results.json", scope: { hero: "warden", focus: "weapon", objective: SWEET.id, targetPathId: TARGET, selectionStep: 14, targetSeedCount: 24, winnerSeedCount: 4, stateCapPerLineageGroup: STATE_CAP, productionChanged: false }, reconstructedPool: { exactStoredStep14ReconstructionReused: true, storedSampleMatches: source.reconstructedPool?.storedSampleMatches === true, storedWinnerIdsMatch: source.reconstructedPool?.storedWinnerIdsMatch === true, targetChildIds: targetSeeds.map((run) => run.id).sort(), winnerSeedIds: winnerSeeds.map((run) => run.id).sort() }, fairness: { targetSeedsCompeteJointly: true, winnerSeedsCompeteJointly: true, perSeedBudgets: false, identicalStateCapPerLineageGroup: true, width16GetsNoAdditionalStateCap: true, sameCandidateGenerationObjectiveReferenceRetentionEconomySlots: true, sameSoulClosure: "unpruned same-horizon purchase/upgrade/replacement expansion bounded only by the common state cap" }, conditions, qualitativeWidthChange: [5200, 6800].map((horizon) => { const w4 = conditions.find((row) => row.horizon === horizon && row.width === 4); const w16 = conditions.find((row) => row.horizon === horizon && row.width === 16); return { horizon, width4: w4.paretoRelation.relation, width16: w16.paretoRelation.relation, changed: w4.paretoRelation.relation !== w16.paretoRelation.relation }; }) };
  const outputArg = process.argv.indexOf("--output"); const output = resolve(outputArg >= 0 ? process.argv[outputArg + 1] : DEFAULT_OUTPUT); mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(result, null, 2) + "\n"); console.log(JSON.stringify({ output, conditions: conditions.map((row) => ({ horizon: row.horizon, width: row.width, relation: row.paretoRelation.relation, interpretable: row.interpretable, targetCap: row.target.stateCapReached, winnerCap: row.winner.stateCapReached })) }));
}
try { main(); } catch (error) { console.error(error?.stack || error?.message || String(error)); process.exitCode = 1; }

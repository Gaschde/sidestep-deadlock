import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "../app/lib.mjs";
import { buildOptimizerData, heroCanPurchaseItem } from "../app/optimizer.mjs";
import { carryResourceAxis, evaluateCarryPerformance } from "../app/warden-search.mjs";
import { createDeadlockDomain } from "../app/deadlock-domain.mjs";
import { normalizeMilestones } from "../app/search-milestones.mjs";
import { measureSoulAxisPath } from "../app/search-objective-v1.mjs";
import { completeNodeBySaving, dedupeFuturePathHistory, pathEndNonDominatedLayers, runControlledMultiobjectiveBeamCarry, selectPathEndParetoBeam } from "../app/multiobjective-search.mjs";
import { pathEndDominates, pathEndParetoFront } from "../app/path-end-pareto.mjs";
import { benchmarkCases } from "../benchmarks/optimizer-v1/cases.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SOURCE = resolve(ROOT, "benchmarks/optimizer-v1/experiments/retention-first-loss/results.json");
const REFERENCE = resolve(ROOT, "benchmarks/optimizer-v1/references/baseline-v0.json");
const OUTPUT = resolve(ROOT, "benchmarks/optimizer-v1/experiments/retention-loss-counterfactual/results.json");
const NOTE = resolve(ROOT, "benchmarks/optimizer-v1/experiments/retention-loss-counterfactual/research-note.md");
const TARGET = "93260772842f0c27";
const WIDTH = 4;
const STEP_CAP = 32;
const TOTAL_WALL_CAP_MS = 110000;
const HORIZONS = [4400, 5200, 6800];
const SWEET = Object.freeze({ id: "carry-sweet-70-30-spec-77_5-22_5", damageWeight: 0.70, survivalWeight: 0.30, damageFocusWeights: Object.freeze({ weapon: Object.freeze({ bullet: 0.775, spirit: 0.225 }), spirit: Object.freeze({ bullet: 0.225, spirit: 0.775 }), hybrid: Object.freeze({ bullet: 0.5, spirit: 0.5 }) }) });

function hash(events) { return createHash("sha256").update(JSON.stringify(events)).digest("hex").slice(0, 16); }
function eventsFromPath(path) { return String(path).split("|").slice(1).map((entry) => JSON.parse(entry)); }
function loadData() {
  const json = (path) => JSON.parse(readFileSync(resolve(ROOT, path), "utf8"));
  const csv = (path) => parseCsv(readFileSync(resolve(ROOT, path), "utf8"));
  return buildOptimizerData({ coreManifest: json("data/core/manifest.json"), heroManifest: json("data/heroes/manifest.json"), items: csv("data/core/items.csv"), itemMechanics: csv("data/core/item_mechanics.csv"), upgrades: csv("data/core/item_upgrades.csv"), economy: json("data/core/economy.json"), slots: json("data/core/slots.json"), heroes: csv("data/heroes/heroes.csv"), heroStats: csv("data/heroes/hero_stats.csv"), abilities: csv("data/heroes/abilities.csv"), abilityMechanics: csv("data/heroes/ability_mechanics.csv"), heroResources: csv("data/heroes/hero_resources.csv") });
}
function sameEvent(actual, expected) {
  if (actual?.type !== expected?.type) return false;
  for (const key of ["earnedSouls", "item", "from", "payment", "saleProceeds"]) if (Object.hasOwn(expected, key) && actual?.[key] !== expected[key]) return false;
  return true;
}
function familyKey(data) {
  const parent = new Map(data.upgrades.map((edge) => [edge.to_item_id, edge.from_item_id]));
  const root = (id) => { const seen = new Set(); let current = id; while (parent.has(current) && !seen.has(current)) { seen.add(current); current = parent.get(current); } return current; };
  return (node) => {
    const counts = { Weapon: 0, Vitality: 0, Spirit: 0, Other: 0 }; const roots = [];
    for (const id of node.state.inventory) { const category = data.itemsById.get(id)?.category; counts[Object.hasOwn(counts, category) ? category : "Other"] += 1; roots.push(root(id)); }
    return `${counts.Weapon}/${counts.Vitality}/${counts.Spirit}/${counts.Other}:${[...new Set(roots)].sort().join(",")}`;
  };
}
function runtime(data, definition, reference) {
  const itemIds = (definition.itemIds || data.items.map((item) => item.item_id)).filter((id) => heroCanPurchaseItem(data.itemsById.get(id), data, definition.hero));
  const checkpoints = normalizeMilestones(definition.milestones, definition.budget);
  const axis = [...new Set([...carryResourceAxis(data, itemIds, definition.budget).axis, ...checkpoints])].sort((a, b) => a - b);
  if (JSON.stringify(axis) !== JSON.stringify(reference.axis)) throw new Error("Frozen reference axis mismatch.");
  const domain = createDeadlockDomain({ data, itemIds, budget: definition.budget, slotUnlocks: [{ earnedSouls: 0, slots: Number(data.slots.item_limit) - Number(data.slots.starting_slots.universal) }], soulAxis: axis, metrics: () => ({ value: 0 }) });
  const clean = (state) => ({ ...state, events: [], snapshots: [] });
  const counters = { transitionCalls: 0, generatedStates: 0, evaluations: 0 };
  const metricsCache = new Map();
  const metrics = (state) => { const key = [...state.inventory].sort().join("|"); if (!metricsCache.has(key)) { const value = evaluateCarryPerformance(state, { heroId: definition.hero, damageFocus: definition.focus, budget: definition.budget, cacheProfiles: false, metricsOnly: true, opponentBulletResist: definition.opponentBulletResist, opponentSpiritResist: definition.opponentSpiritResist }, data); if (!value.valid) throw new Error(value.reason); metricsCache.set(key, value.metrics); counters.evaluations += 1; } return metricsCache.get(key); };
  const root = { state: clean(domain.initial), parent: null, event: null, serial: "" };
  const transitions = (node) => { counters.transitionCalls += 1; const states = domain.transitions(node.state); counters.generatedStates += states.length; return states.map((state) => ({ state: clean(state), parent: node, event: state.events[0], serial: `${node.serial}|${JSON.stringify(state.events[0])}` })); };
  const pointsCache = new WeakMap(); const vectorCaches = new Map();
  const points = (node) => { if (!pointsCache.has(node)) { const chain = []; for (let current = node; current; current = current.parent) chain.push(current); pointsCache.set(node, chain.reverse().map((entry) => ({ earnedSouls: entry.state.earnedSouls, metrics: metrics(entry.state) }))); } return pointsCache.get(node); };
  const vector = (node, horizon) => { if (!vectorCaches.has(horizon)) vectorCaches.set(horizon, new WeakMap()); const cache = vectorCaches.get(horizon); if (!cache.has(node)) { const measurement = measureSoulAxisPath(points(node), reference, checkpoints, horizon, definition.focus, null, SWEET); cache.set(node, { pathScore: measurement.pathScore, endScore: measurement.endScore, measurement }); } return cache.get(node); };
  const replay = (path) => { let node = root; for (const event of eventsFromPath(path)) { const next = transitions(node).find((candidate) => sameEvent(candidate.event, event)); if (!next) throw new Error(`Cannot replay ${JSON.stringify(event)}.`); node = next; } if (hash(eventsFromPath(path)) !== hash(eventsFromPath(node.serial))) throw new Error("Replay hash mismatch."); return node; };
  return { root, transitions, vector, replay, futureKey: (node) => domain.futureKey(node.state), diversityKey: familyKey(data), counters };
}
function prefix(data, definition, reference, observed) {
  return runControlledMultiobjectiveBeamCarry({ data, reference, heroId: definition.hero, damageFocus: definition.focus, objectiveConfig: SWEET, itemIds: definition.itemIds, budget: definition.budget, milestones: definition.milestones, opponentBulletResist: definition.opponentBulletResist, opponentSpiritResist: definition.opponentSpiritResist, slotUnlocks: [{ earnedSouls: 0, slots: Number(data.slots.item_limit) - Number(data.slots.starting_slots.universal) }], beamWidth: WIDTH, maxSteps: 1000, timeMs: Infinity, commonHorizonScoreOnlyShadow: true, ...(observed ? { commonHorizonRetentionAudit: true, commonHorizonRetentionFirstLossAudit: true } : {}), diagnosticSnapshotAfterSelectionStep: 14 });
}
function rowsEqual(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function frontRecord(entry) { return { id: hash(eventsFromPath(entry.node.serial)), pathScore: entry.pathScore, endScore: entry.endScore, pathDamage: entry.measurement.pathDamage, endDamage: entry.measurement.endDamage, pathSurvival: entry.measurement.pathSurvivability, endSurvival: entry.measurement.endSurvivability }; }
function continueSeed(rt, seed, horizon) {
  const before = { ...rt.counters }; const terminals = new Map(); let beam = [seed]; let steps = 0; let duplicates = 0; let early = false;
  const observe = (node) => { if (node.state.earnedSouls === horizon) terminals.set(node.serial, node); };
  const saveComplete = (nodes) => { for (const node of nodes) { const terminal = node.state.earnedSouls === horizon ? node : completeNodeBySaving(node, horizon, rt.transitions, Infinity); if (!terminal) throw new Error("Save completion failed."); observe(terminal); } };
  while (beam.length && steps < STEP_CAP) {
    const candidates = []; for (const node of beam) { if (node.state.earnedSouls === horizon) { observe(node); continue; } const next = rt.transitions(node).filter((candidate) => candidate.state.earnedSouls <= horizon); next.forEach(observe); candidates.push(...next); }
    if (!candidates.length) { beam = []; break; }
    const vector = (node) => rt.vector(node, horizon); const unique = dedupeFuturePathHistory(candidates, rt.futureKey, vector); duplicates += candidates.length - unique.length; beam = selectPathEndParetoBeam(unique, WIDTH, vector, rt.diversityKey).selected; steps += 1;
    if (!early) { saveComplete(beam); early = true; }
  }
  if (beam.length) saveComplete(beam);
  const front = pathEndParetoFront([...terminals.values()].map((node) => ({ id: hash(eventsFromPath(node.serial)), node, ...rt.vector(node, horizon) })));
  return { complete: !beam.length && steps < STEP_CAP, censored: Boolean(beam.length && steps >= STEP_CAP), steps, stepCap: STEP_CAP, duplicateStates: duplicates, counters: Object.fromEntries(Object.keys(before).map((key) => [key, rt.counters[key] - before[key]])), front };
}
function pairwise(target, winner) {
  const union = pathEndParetoFront([...target.map((entry) => ({ ...entry, owner: "target" })), ...winner.map((entry) => ({ ...entry, owner: "winner" }))]);
  const targetOnFront = union.some((entry) => entry.owner === "target"); const winnerOnFront = union.some((entry) => entry.owner === "winner");
  const targetDominates = winner.length > 0 && winner.every((entry) => target.some((candidate) => pathEndDominates(candidate, entry)));
  const winnerDominates = target.length > 0 && target.every((entry) => winner.some((candidate) => pathEndDominates(candidate, entry)));
  return { targetOnFront, winnerOnFront, targetDominates, winnerDominates, relation: targetDominates ? "target-dominates-winner" : winnerDominates ? "winner-dominates-target" : targetOnFront && winnerOnFront ? "tradeoff" : targetOnFront ? "target-only" : "winner-only" };
}
function pathRepresentative(front) {
  return [...front].sort((a, b) => b.pathScore - a.pathScore || b.endScore - a.endScore || a.id.localeCompare(b.id))[0] || null;
}
function recordDominates(left, right) {
  return left.pathScore >= right.pathScore && left.endScore >= right.endScore &&
    (left.pathScore > right.pathScore || left.endScore > right.endScore);
}
function writeStableResult(result) {
  result.artifacts ||= {};
  result.artifacts.resultsJson = "benchmarks/optimizer-v1/experiments/retention-loss-counterfactual/results.json";
  result.artifacts.researchNote = "benchmarks/optimizer-v1/experiments/retention-loss-counterfactual/research-note.md";
  result.artifacts.resultsBytes = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) { writeFileSync(OUTPUT, JSON.stringify(result, null, 2) + "\n"); result.artifacts.resultsBytes = statSync(OUTPUT).size; }
  writeFileSync(OUTPUT, JSON.stringify(result, null, 2) + "\n");
}
function reanalyzeExisting() {
  const result = JSON.parse(readFileSync(OUTPUT, "utf8"));
  const pooled = result.directionB?.horizons?.map((horizon) => {
    const winnerPoints = horizon.runs.filter((run) => run.group === "actual-winner").flatMap((run) => run.front);
    const targetRuns = horizon.runs.filter((run) => run.group === "target-child");
    const targetPoints = targetRuns.flatMap((run) => run.front);
    const dominatedPoints = targetPoints.filter((point) => winnerPoints.some((winner) => recordDominates(winner, point)));
    const fullyDominatedRuns = targetRuns.filter((run) => run.front.every((point) => winnerPoints.some((winner) => recordDominates(winner, point))));
    return {
      horizon: horizon.horizon,
      quantifier: "every target-front point is dominated by some point in the pooled four-winner frontier candidates",
      pooledWinnerPointCount: winnerPoints.length,
      targetFrontPointCount: targetPoints.length,
      dominatedTargetFrontPointCount: dominatedPoints.length,
      targetRunsFullyDominated: fullyDominatedRuns.length,
      targetRunCount: targetRuns.length,
      allTargetFrontPointsDominated: dominatedPoints.length === targetPoints.length,
      allTargetRunsFullyDominated: fullyDominatedRuns.length === targetRuns.length
    };
  }) || [];
  if (!pooled.length || !pooled.every((row) => row.allTargetFrontPointsDominated && row.allTargetRunsFullyDominated)) {
    throw new Error("Pooled-winner reanalysis did not establish the required all-target dominance.");
  }
  for (const horizon of result.directionB.horizons) {
    horizon.individualMaxPathWinnerComparison = horizon.targetVsStrongestWinner;
    delete horizon.targetVsStrongestWinner;
  }
  result.directionB.pooledWinnerDominance = pooled;
  result.directionB.method = {
    completeness: "complete=true means this bounded per-seed run reached its tested horizon before the fixed cap; it is not an exact-search claim.",
    search: "Width-4 heuristic retention at each continuation step; same-Soul purchase successors at the tested horizon are not expanded.",
    comparison: "24 target children and four winner seeds received separate equal per-seed caps; this is not an equal-total-budget architecture comparison."
  };
  result.reanalysis = { mode: "postprocess-saved-fronts", reranContinuations: false, correction: "The prior two 5,200 tradeoffs were only against one max-Path winner seed. Against pooled fronts from all four actual winners, every target-front point is dominated." };
  writeStableResult(result);
  writeFileSync(NOTE, `# Retention-loss counterfactual\n\nThe step-14 snapshot is a new deterministic reconstruction crosschecked against stored compact evidence, not an independent prior oracle.\n\n- A @4,400: complete captured-pool rerank; target retained at Width-4=false, best target layer=8.\n- B pooled-winner quantifier: 4,400 = 24/24 target runs fully dominated; 5,200 = 24/24; 6,800 = 24/24. Every target-front point is dominated by some point among the pooled four actual-winner fronts.\n- The earlier two 5,200 tradeoffs were against only one max-Path winner and do **not** justify a full-pool rerank.\n\nB \`complete\` only means reached tested horizon before the cap; Width-4 remains heuristic, same-Soul horizon purchases were not expanded, and 24-versus-4 uses separate per-seed budgets. No 40k, final-build, or production-policy claim follows.\n\nNext unrun question: under one equal total-state budget, do lineage-vs-lineage Width-4 and Width-16 continuations at 5,200/6,800 with same-Soul closure change the pooled relation?\n`);
  console.log(JSON.stringify({ status: "REANALYZED", output: OUTPUT, pooled }));
}
function main() {
  const started = performance.now(); const source = JSON.parse(readFileSync(SOURCE, "utf8")); const pool = source.changedPoolTable?.find((entry) => entry.poolIndex === 8); const origin = pool?.origins?.find((entry) => entry.pathId === TARGET); const storedLoss = origin?.steps?.find((entry) => entry.semanticOutcome === "true-retention-loss");
  if (!origin || !storedLoss?.retentionEvidence) throw new Error("Known loss record missing.");
  const targetOriginAtStep13 = pool?.step === 13 && origin.originSouls === 3600 && origin.pathId === TARGET; if (!targetOriginAtStep13) throw new Error("Stored target origin is not the expected 3.6k step-13 origin.");
  const data = loadData(); const definition = benchmarkCases("production").find((entry) => entry.hero === "warden" && entry.focus === "weapon"); const reference = JSON.parse(readFileSync(REFERENCE, "utf8")).references[definition?.id]?.reference;
  if (!definition || !reference) throw new Error("Production Warden reference missing.");
  const control = prefix(data, definition, reference, false); const observed = prefix(data, definition, reference, true);
  const controlSnapshot = control.telemetry.diagnosticSnapshot; const snapshot = observed.telemetry.diagnosticSnapshot;
  if (!snapshot || snapshot.selectionStep !== 14 || !rowsEqual(control.telemetry.selectionTrace, observed.telemetry.selectionTrace)) throw new Error("Prefix snapshot/neutrality check failed.");
  const workKeys = ["evaluations", "generatedStates", "transitionCalls", "duplicateStates", "retentionCalls"];
  const workNeutral = workKeys.every((key) => control.telemetry[key] === observed.telemetry[key]); if (!workNeutral) throw new Error("Observer changed prefix search work.");
  const targetChildren = snapshot.generated.filter((row) => row.parentPath === origin.nodeId); const targetChildPaths = new Set(targetChildren.map((row) => row.path));
  const storedSample = storedLoss.retentionEvidence.relevantCandidateSample || []; const storedWinners = storedLoss.retentionEvidence.selected || [];
  const winnerPaths = new Set(storedWinners.map((row) => row.nodeId));
  const sampleMismatches = storedSample.map((row) => {
    const candidate = targetChildren.find((entry) => entry.path === row.nodeId);
    return candidate && candidate.earnedSouls === row.earnedSouls ? null : { pathPresent: Boolean(candidate), stored: { souls: row.earnedSouls }, reconstructed: candidate ? { souls: candidate.earnedSouls, path: candidate.pathScore, end: candidate.endScore } : null };
  }).filter(Boolean);
  const sampleMatches = sampleMismatches.length === 0;
  const winnerMatches = rowsEqual([...winnerPaths].sort(), snapshot.retained.map((row) => row.path).sort());
  if (targetChildren.length !== 24 || storedLoss.direct.postDedupeRepresentatives !== 24 || storedLoss.semantic.postDedupeRepresentatives !== 24 || storedLoss.semantic.postRetentionRepresentatives !== 0 || !sampleMatches || !winnerMatches) throw new Error(`Reconstructed step-14 crosschecks failed: ${JSON.stringify({ targetChildren: targetChildren.length, direct: storedLoss.direct.postDedupeRepresentatives, semantic: storedLoss.semantic.postDedupeRepresentatives, retained: storedLoss.semantic.postRetentionRepresentatives, sampleMatches, sampleMismatches: sampleMismatches.slice(0, 2), winnerMatches, snapshotGenerated: snapshot.generated.length, snapshotDeduped: snapshot.deduped.length, snapshotRetained: snapshot.retained.length })}`);
  const maxPresent = Math.max(...snapshot.generated.map((row) => row.earnedSouls)); if (maxPresent !== 4400) throw new Error(`Expected max present horizon 4400, got ${maxPresent}.`);
  const rtA = runtime(data, definition, reference); const dedupedNodes = snapshot.deduped.map((row) => rtA.replay(row.path)); const aVector = (node) => rtA.vector(node, maxPresent); const aSelection = selectPathEndParetoBeam(dedupedNodes, WIDTH, aVector, rtA.diversityKey); const aLayers = pathEndNonDominatedLayers(dedupedNodes.map((node) => ({ node, id: node.serial, ...aVector(node) }))); const layerByPath = new Map(); aLayers.forEach((layer, index) => layer.forEach((entry) => layerByPath.set(entry.node.serial, index)));
  const aTarget = dedupedNodes.filter((node) => targetChildPaths.has(node.serial)); const aRetained = aSelection.selected.filter((node) => targetChildPaths.has(node.serial));
  const directionA = { horizon: maxPresent, fullCapturedDedupedPoolSize: dedupedNodes.length, completeCapturedPoolRerank: true, targetChildrenInPool: aTarget.length, targetBestParetoLayer: Math.min(...aTarget.map((node) => layerByPath.get(node.serial))), targetRetainedAtWidth4: aRetained.map((node) => hash(eventsFromPath(node.serial))), retainedIds: aSelection.selected.map((node) => hash(eventsFromPath(node.serial)),), work: { ...rtA.counters, wallMs: performance.now() - started } };
  const seeds = [...targetChildren.map((row) => ({ group: "target-child", id: hash(eventsFromPath(row.path)), path: row.path })), ...snapshot.retained.map((row) => ({ group: "actual-winner", id: hash(eventsFromPath(row.path)), path: row.path }))];
  const b = []; let globalCensored = false;
  for (const horizon of HORIZONS) {
    const runs = [];
    for (const seed of seeds) {
      if (performance.now() - started >= TOTAL_WALL_CAP_MS) { globalCensored = true; break; }
      const rt = runtime(data, definition, reference); const run = continueSeed(rt, rt.replay(seed.path), horizon); runs.push({ ...seed, ...run, front: run.front.map(frontRecord) });
    }
    const winnerRuns = runs.filter((run) => run.group === "actual-winner" && !run.censored); const strongestWinner = [...winnerRuns].sort((a, b) => (pathRepresentative(b.front)?.pathScore || -Infinity) - (pathRepresentative(a.front)?.pathScore || -Infinity))[0] || null; const winnerRepresentative = strongestWinner ? pathRepresentative(strongestWinner.front) : null;
    b.push({ horizon, attemptedSeeds: runs.length, expectedSeeds: seeds.length, globalWallCapReached: globalCensored, strongestWinner: strongestWinner?.id || null, strongestWinnerPathRepresentative: winnerRepresentative || null, runs, targetVsStrongestWinner: strongestWinner ? runs.filter((run) => run.group === "target-child" && !run.censored).map((run) => { const targetRepresentative = pathRepresentative(run.front); return { targetId: run.id, relation: pairwise(run.front, strongestWinner.front), pathRepresentative: targetRepresentative || null, pathRepresentativePathDelta: targetRepresentative ? targetRepresentative.pathScore - winnerRepresentative.pathScore : null, pathRepresentativeEndDelta: targetRepresentative ? targetRepresentative.endScore - winnerRepresentative.endScore : null }; }) : [] });
    if (globalCensored) break;
  }
  const result = { schemaVersion: "optimizer-retention-loss-counterfactual-v2", sourceArtifact: "benchmarks/optimizer-v1/experiments/retention-first-loss/results.json", scope: { hero: "warden", focus: "weapon", budget: 40000, beamWidth: WIDTH, targetPathId: TARGET, selectionStep: 14, productionChanged: false }, reconstructedPool: { label: "NEW deterministic same-code/data prefix reconstruction; crosschecked against stored compact evidence, not an independent prior oracle", controlObserverTraceEqual: true, workNeutral, workKeys, generatedCount: snapshot.generated.length, dedupedCount: snapshot.deduped.length, retainedCount: snapshot.retained.length, targetOriginAtStep13, targetChildCount: targetChildren.length, targetChildIds: [...targetChildPaths].map((path) => hash(eventsFromPath(path))).sort(), storedSampleMatches: sampleMatches, storedWinnerIdsMatch: winnerMatches, retainedWinnerIds: snapshot.retained.map((row) => hash(eventsFromPath(row.path))).sort(), maxPresentHorizon: maxPresent }, directionA, directionB: { label: "Per-seed bounded attainable-front diagnostic only; no pooled Width-4 retention claim", horizons: b, perSeedStepCap: STEP_CAP, totalWallCapMs: TOTAL_WALL_CAP_MS, globalCensored }, limitations: ["A is a full rerank only of the reconstructed captured step-14 deduped pool, not a production-policy change.", "B compares per-seed attainable fronts; 24 target children versus four winners is not an equal-opportunity aggregate architecture score.", "No horizon is extrapolated to 40k and no final-build superiority is claimed."] };
  mkdirSync(dirname(OUTPUT), { recursive: true }); result.artifacts = { resultsJson: "benchmarks/optimizer-v1/experiments/retention-loss-counterfactual/results.json", resultsBytes: 0, researchNote: "benchmarks/optimizer-v1/experiments/retention-loss-counterfactual/research-note.md" };
  for (let attempt = 0; attempt < 3; attempt += 1) { writeFileSync(OUTPUT, JSON.stringify(result, null, 2) + "\n"); result.artifacts.resultsBytes = statSync(OUTPUT).size; }
  writeFileSync(OUTPUT, JSON.stringify(result, null, 2) + "\n");
  writeFileSync(NOTE, `# Retention-loss counterfactual\n\nA new deterministic prefix reconstructed the complete step-14 pool and crosschecked the stored compact snapshot; it is not an independent historical oracle. Direction A reranks that complete captured pool only at 4,400 Souls. Direction B is per-seed bounded continuation only, never a pooled Width-4 claim.\n\n- Prefix: generated=${snapshot.generated.length}, deduped=${snapshot.deduped.length}, retained=${snapshot.retained.length}; target children=${targetChildren.length}; stored sample/winners match=${sampleMatches}/${winnerMatches}.\n- A: target retained at Width-4=${directionA.targetRetainedAtWidth4.length > 0}; best target layer=${directionA.targetBestParetoLayer}.\n- B: horizons=${b.map((row) => `${row.horizon}:${row.attemptedSeeds}/${row.expectedSeeds}`).join(", ")}; global censored=${globalCensored}; cap=${STEP_CAP} steps/seed, ${TOTAL_WALL_CAP_MS} ms total.\n\nNo result asserts a 40k outcome, a better final build, or a production retention policy.\n`);
  console.log(JSON.stringify({ status: "COMPLETE", output: OUTPUT, prefix: result.reconstructedPool, directionA: { retained: directionA.targetRetainedAtWidth4.length, layer: directionA.targetBestParetoLayer }, directionB: b.map((row) => ({ horizon: row.horizon, attempted: row.attemptedSeeds, expected: row.expectedSeeds })), wallMs: performance.now() - started }));
}
try { if (process.argv.includes("--reanalyze-existing")) reanalyzeExisting(); else main(); } catch (error) { console.error(error?.stack || error?.message || String(error)); process.exitCode = 1; }

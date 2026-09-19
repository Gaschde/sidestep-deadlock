import test from "node:test";
import assert from "node:assert/strict";
import { measureSoulAxisPath, PATH_END_MEASUREMENT_VERSION } from "../app/search-objective-v1.mjs";
import {
  classifyBaseline,
  pathEndDominates,
  pathEndParetoFront,
  pathEndVector,
  pathEventObservables,
  summarizeTradeoffs
} from "../benchmarks/optimizer-v1/path-end-pareto-lib.mjs";

function metrics(value) {
  return {
    sustainedWeaponDps: value,
    laneTradeWindowDps: value,
    farmWindowDps: value,
    skirmishWindowDps: value,
    teamfightWindowDps: value,
    sustainedBulletDps: value,
    sustainedSpiritDps: value,
    laneTradeBulletDps: value,
    laneTradeSpiritDps: value,
    farmBulletDps: value,
    farmSpiritDps: value,
    skirmishBulletDps: value,
    skirmishSpiritDps: value,
    teamfightBulletDps: value,
    teamfightSpiritDps: value,
    bulletEhp: value,
    spiritEhp: value
  };
}

test("Path/End dominance requires no loss in either dimension and one strict gain", () => {
  assert.equal(pathEndDominates({ pathScore: 2, endScore: 3 }, { pathScore: 2, endScore: 2 }), true);
  assert.equal(pathEndDominates({ pathScore: 2, endScore: 3 }, { pathScore: 2, endScore: 3 }), false);
  assert.equal(pathEndDominates({ pathScore: 3, endScore: 2 }, { pathScore: 2, endScore: 3 }), false);
});

test("Pareto evaluation preserves the fixed candidate set and uses only Path/End", () => {
  const candidates = [
    { id: "a", pathScore: 1, endScore: 3 },
    { id: "b", pathScore: 2, endScore: 2 },
    { id: "c", pathScore: 3, endScore: 1 },
    { id: "d", pathScore: 1, endScore: 1 }
  ];
  const before = structuredClone(candidates);
  const front = pathEndParetoFront(candidates);
  assert.deepEqual(candidates, before);
  assert.deepEqual(front.map((entry) => entry.id), ["c", "b", "a"]);
  assert.deepEqual(Object.keys(pathEndVector(front[0])).sort(), ["endScore", "pathScore"]);
});

test("baseline-v0 classification detects Pareto improvements in either requested direction", () => {
  const baseline = { id: "baseline", pathScore: 2, endScore: 2 };
  const candidates = [
    { id: "same-end-better-path", pathScore: 3, endScore: 2 },
    { id: "same-path-better-end", pathScore: 2, endScore: 3 },
    { id: "tradeoff", pathScore: 4, endScore: 1 }
  ];
  const position = classifyBaseline(candidates, baseline);
  assert.equal(position.nondominatedRelativeToCandidateSet, false);
  assert.deepEqual(position.betterPathNoEndLoss, ["same-end-better-path"]);
  assert.deepEqual(position.betterEndNoPathLoss, ["same-path-better-end"]);
  assert.deepEqual(position.dominatedBy.sort(), ["same-end-better-path", "same-path-better-end"]);
});

test("Path/End measurement has no scalar aggregation", () => {
  const reference = { axis: [0, 400, 800], values: [metrics(100), metrics(100), metrics(100)] };
  const measured = measureSoulAxisPath([
    { earnedSouls: 0, metrics: metrics(0) },
    { earnedSouls: 400, metrics: metrics(100) },
    { earnedSouls: 800, metrics: metrics(80) }
  ], reference, [800], 800, "hybrid");
  assert.equal(measured.policy.version, PATH_END_MEASUREMENT_VERSION);
  assert.equal(measured.policy.aggregation, "none");
  assert.equal(Object.hasOwn(measured, "score"), false);
  assert.ok(Number.isFinite(measured.pathScore));
  assert.ok(Number.isFinite(measured.endScore));
});

test("path observables expose same-Soul churn and sell/rebuy without judging it by a score", () => {
  const events = [
    { type: "save", earnedSouls: 800 },
    { type: "purchase", item: "cheap", payment: 800 },
    { type: "sell", from: "cheap", payment: -400 },
    { type: "purchase", item: "cheap", payment: 800 },
    { type: "save", earnedSouls: 1600 }
  ];
  const observed = pathEventObservables(events, 1600, new Map([["cheap", 800]]));
  assert.equal(observed.transactionCount, 3);
  assert.equal(observed.sameSoulTransactionGroups.length, 1);
  assert.deepEqual(observed.reacquiredItems, [{ item: "cheap", count: 1, totalCost: 800 }]);
  assert.deepEqual(observed.sellRebuys, [{ item: "cheap", count: 1, totalCost: 800 }]);
  assert.equal(observed.longestNoShopSoulSpan, 800);
});

test("trade-off summary is deterministic and does not invent a weighted winner", () => {
  const front = [
    { id: "high-end", pathScore: 0.4, endScore: 0.6 },
    { id: "middle", pathScore: 0.5, endScore: 0.5 },
    { id: "high-path", pathScore: 0.6, endScore: 0.4 }
  ];
  const summary = summarizeTradeoffs(front);
  assert.equal(summary.adjacentTradeoffs.length, 2);
  assert.ok(Math.abs(summary.medianPathGain - 0.1) < 1e-12);
  assert.ok(Math.abs(summary.medianEndLoss - 0.1) < 1e-12);
  assert.equal(Object.hasOwn(summary, "winner"), false);
});

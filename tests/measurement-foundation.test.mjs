import test from "node:test";
import assert from "node:assert/strict";
import { BENCHMARK_CASES, benchmarkCases } from "../benchmarks/optimizer-v1/cases.mjs";
import { calculateGap, compareBenchmarkRecords, comparisonKey } from "../benchmarks/optimizer-v1/benchmark-lib.mjs";

test("Optimizer V1 benchmark matrix contains exact, controlled and all six production Carry cases", () => {
  assert.equal(benchmarkCases("small").length, 1);
  assert.equal(benchmarkCases("controlled").length, 2);
  const production = benchmarkCases("production");
  assert.equal(production.length, 6);
  assert.deepEqual(new Set(production.map((entry) => entry.hero)), new Set(["warden", "infernus"]));
  assert.deepEqual(new Set(production.map((entry) => entry.focus)), new Set(["weapon", "spirit", "hybrid"]));
  assert.ok(BENCHMARK_CASES.every((entry) => entry.role === "carry" && entry.backend === "beam"));
  assert.ok(production.every((entry) => entry.budget === 40000 && entry.timeBudgetMs === 25000));
});

test("Exact benchmark gap is absolute and relative to the exact score", () => {
  assert.deepEqual(calculateGap(0.8, 0.6), { exactScore: 0.8, candidateScore: 0.6, absoluteGap: 0.20000000000000007, relativeGap: 0.25000000000000006 });
  assert.deepEqual(calculateGap(0, 0), { exactScore: 0, candidateScore: 0, absoluteGap: 0, relativeGap: 0 });
});

test("Benchmark comparison refuses a score verdict when conditions differ", () => {
  const baseMetadata = {
    schemaVersion: "optimizer-benchmark-v1",
    dataset: { patch: "x" }, caseId: "case", hero: "warden", role: "carry", focus: "weapon",
    backend: "iterative-diverse-beam", budget: 40000, slots: 12, itemIds: ["a"], timeBudgetMs: 25000,
    milestones: [40000], opponentResistances: { bullet: 0, spirit: 0 }, objectiveVersion: "baseline-v0",
    referenceVersion: "ref-v0", searchBudget: { timeMs: 25000 }, hardware: { cpuModel: "same" }
  };
  const left = { metadata: { ...baseMetadata, comparisonKey: comparisonKey(baseMetadata) }, resultScore: 0.5 };
  const right = { metadata: { ...baseMetadata, comparisonKey: comparisonKey(baseMetadata) }, resultScore: 0.6 };
  assert.deepEqual(compareBenchmarkRecords(left, right), { comparable: true, verdict: "higher-score", scoreDelta: 0.09999999999999998 });
  const changed = { ...right, metadata: { ...right.metadata, referenceVersion: "other" } };
  const comparison = compareBenchmarkRecords(left, changed);
  assert.equal(comparison.comparable, false);
  assert.equal(comparison.verdict, null);
});

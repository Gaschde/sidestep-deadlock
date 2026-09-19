import { createHash } from "node:crypto";

export const BENCHMARK_SCHEMA_VERSION = "optimizer-benchmark-v1";
export const REFERENCE_SCHEMA_VERSION = "optimizer-benchmark-reference-v1";
export const BASELINE_ID = "baseline-v0";

export function calculateGap(exactScore, candidateScore) {
  if (![exactScore, candidateScore].every(Number.isFinite)) throw new TypeError("Scores must be finite.");
  const absoluteGap = Math.max(0, exactScore - candidateScore);
  return {
    exactScore,
    candidateScore,
    absoluteGap,
    relativeGap: exactScore === 0 ? (absoluteGap === 0 ? 0 : null) : absoluteGap / Math.abs(exactScore)
  };
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function comparisonConditions(metadata) {
  return {
    schemaVersion: metadata.schemaVersion,
    dataset: metadata.dataset,
    caseId: metadata.caseId,
    hero: metadata.hero,
    role: metadata.role,
    focus: metadata.focus,
    backend: metadata.backend,
    budget: metadata.budget,
    slots: metadata.slots,
    itemIds: metadata.itemIds,
    timeBudgetMs: metadata.timeBudgetMs,
    milestones: metadata.milestones,
    opponentResistances: metadata.opponentResistances,
    objectiveVersion: metadata.objectiveVersion,
    referenceVersion: metadata.referenceVersion,
    searchBudget: metadata.searchBudget,
    hardware: metadata.hardware
  };
}

export function comparisonKey(metadata) {
  return createHash("sha256").update(stableJson(comparisonConditions(metadata))).digest("hex");
}

export function compareBenchmarkRecords(left, right) {
  const leftConditions = comparisonConditions(left.metadata);
  const rightConditions = comparisonConditions(right.metadata);
  const comparable = stableJson(leftConditions) === stableJson(rightConditions);
  if (!comparable) return { comparable: false, verdict: null, reason: "Benchmark conditions differ.", leftConditions, rightConditions };
  const delta = right.resultScore - left.resultScore;
  return { comparable: true, verdict: delta > 0 ? "higher-score" : delta < 0 ? "lower-score" : "equal-score", scoreDelta: delta };
}

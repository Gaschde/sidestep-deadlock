import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [leftArg, rightArg, outputArg] = process.argv.slice(2);
if (!leftArg || !rightArg) {
  throw new Error("Usage: node tools/optimizer-objective-compare.mjs <baseline.json> <objective-v1.json> [output.json]");
}

const read = (path) => JSON.parse(readFileSync(resolve(path), "utf8"));
const left = read(leftArg);
const right = read(rightArg);
const byId = new Map(right.records.map((record) => [record.metadata.caseId, record]));

function conditions(record) {
  const m = record.metadata;
  return {
    caseId: m.caseId,
    level: m.level,
    hero: m.hero,
    role: m.role,
    focus: m.focus,
    backend: m.backend,
    budget: m.budget,
    slots: m.slots,
    itemIds: m.itemIds,
    timeBudgetMs: m.timeBudgetMs,
    milestones: m.milestones,
    opponentResistances: m.opponentResistances,
    referenceVersion: m.referenceVersion,
    searchBudget: m.searchBudget,
    dataset: m.dataset,
    hardware: m.hardware
  };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

const stable = (value) => JSON.stringify(canonical(value));
const delta = (a, b) => Number(b) - Number(a);
const comparisons = left.records.map((baseline) => {
  const candidate = byId.get(baseline.metadata.caseId);
  if (!candidate) return { caseId: baseline.metadata.caseId, comparable: false, reason: "missing candidate case" };
  const comparable = stable(conditions(baseline)) === stable(conditions(candidate));
  if (!comparable) return {
    caseId: baseline.metadata.caseId,
    comparable: false,
    reason: "A/B conditions differ",
    baselineConditions: conditions(baseline),
    candidateConditions: conditions(candidate)
  };
  const b = baseline.commonPathMetrics;
  const v = candidate.commonPathMetrics;
  const endDelta = delta(b.endScore, v.endScore);
  const pathDelta = delta(b.pathScore, v.pathScore);
  return {
    caseId: baseline.metadata.caseId,
    comparable: true,
    commonMetrics: {
      pathScore: { baseline: b.pathScore, objectiveV1: v.pathScore, delta: pathDelta },
      endScore: { baseline: b.endScore, objectiveV1: v.endScore, delta: endDelta },
      combinedScore: { baseline: b.combinedScore, objectiveV1: v.combinedScore, delta: delta(b.combinedScore, v.combinedScore) }
    },
    gates: {
      pathImproved: pathDelta > 1e-12,
      terminalNonRegression: endDelta >= -1e-12,
      legal: baseline.legallyPathVerified && candidate.legallyPathVerified
    },
    path: {
      baseline: baseline.pathObservables,
      objectiveV1: candidate.pathObservables
    },
    endbuild: {
      baselineInventory: baseline.inventory,
      objectiveV1Inventory: candidate.inventory,
      baselineCash: baseline.cash,
      objectiveV1Cash: candidate.cash
    },
    search: {
      baselineRuntimeMs: baseline.searchTelemetry.runtimeMs,
      objectiveV1RuntimeMs: candidate.searchTelemetry.runtimeMs,
      baselineWidthsCompleted: baseline.searchTelemetry.widthsCompleted,
      objectiveV1WidthsCompleted: candidate.searchTelemetry.widthsCompleted
    },
    exact: {
      baseline: baseline.exact,
      objectiveV1: candidate.exact
    }
  };
});

const comparable = comparisons.filter((entry) => entry.comparable);
const summary = {
  baselineObjective: left.objectiveVersion || left.records[0]?.metadata.objectiveVersion,
  candidateObjective: right.objectiveVersion || right.records[0]?.metadata.objectiveVersion,
  comparableCases: comparable.length,
  pathImprovedCases: comparable.filter((entry) => entry.gates.pathImproved).length,
  terminalNonRegressionCases: comparable.filter((entry) => entry.gates.terminalNonRegression).length,
  pathImprovedAndTerminalNonRegressionCases: comparable.filter((entry) =>
    entry.gates.pathImproved && entry.gates.terminalNonRegression && entry.gates.legal).length,
  comparisons
};

const json = JSON.stringify(summary, null, 2) + "\n";
if (outputArg) writeFileSync(resolve(outputArg), json);
console.log(json);

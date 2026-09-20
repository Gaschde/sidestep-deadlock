import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseCsv } from "../app/lib.mjs";
import { buildOptimizerData, heroCanPurchaseItem } from "../app/optimizer.mjs";
import { runControlledMultiobjectiveBeamCarry } from "../app/multiobjective-search.mjs";
import { benchmarkCases } from "../benchmarks/optimizer-v1/cases.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const REFERENCE_FILE = resolve(ROOT, "benchmarks/optimizer-v1/references/baseline-v0.json");
const STORED_SCORE_ONLY_FILE = resolve(
  ROOT,
  "benchmarks/optimizer-v1/experiments/common-horizon-score-only-shadow/results.json"
);
const DEFAULT_OUTPUT = resolve(ROOT, "artifacts/common-horizon-retention-audit/results.json");
const WIDTH = 4;
const TARGET_PATH_ID = "93260772842f0c27";

const SWEET = Object.freeze({
  id: "carry-sweet-70-30-spec-77_5-22_5",
  damageWeight: 0.70,
  survivalWeight: 0.30,
  damageFocusWeights: Object.freeze({
    weapon: Object.freeze({ bullet: 0.775, spirit: 0.225 }),
    spirit: Object.freeze({ bullet: 0.225, spirit: 0.775 }),
    hybrid: Object.freeze({ bullet: 0.5, spirit: 0.5 })
  })
});

function outputPath() {
  const args = process.argv.slice(2);
  const index = args.indexOf("--output");
  return resolve(index >= 0 ? args[index + 1] : DEFAULT_OUTPUT);
}

function loadData() {
  const json = (path) => JSON.parse(readFileSync(resolve(ROOT, path), "utf8"));
  const csv = (path) => parseCsv(readFileSync(resolve(ROOT, path), "utf8"));
  return buildOptimizerData({
    coreManifest: json("data/core/manifest.json"),
    heroManifest: json("data/heroes/manifest.json"),
    items: csv("data/core/items.csv"),
    itemMechanics: csv("data/core/item_mechanics.csv"),
    upgrades: csv("data/core/item_upgrades.csv"),
    economy: json("data/core/economy.json"),
    slots: json("data/core/slots.json"),
    heroes: csv("data/heroes/heroes.csv"),
    heroStats: csv("data/heroes/hero_stats.csv"),
    abilities: csv("data/heroes/abilities.csv"),
    abilityMechanics: csv("data/heroes/ability_mechanics.csv"),
    heroResources: csv("data/heroes/hero_resources.csv")
  });
}

function pathId(events) {
  return createHash("sha256").update(JSON.stringify(events)).digest("hex").slice(0, 16);
}

function eventsFromSerial(serial) {
  if (!serial) return [];
  return serial.split("|").slice(1).map((entry) => JSON.parse(entry));
}

function pathIdFromSerial(serial) {
  return pathId(eventsFromSerial(serial));
}

function compactFront(result) {
  return result.front.map((entry) => ({
    id: pathId(entry.state.events),
    pathScore: entry.pathScore,
    endScore: entry.endScore,
    earnedSouls: entry.state.earnedSouls,
    inventory: [...entry.state.inventory],
    transactions: entry.transactions
  })).sort((a, b) => a.id.localeCompare(b.id));
}

function compactRun(result) {
  const t = result.telemetry;
  const p = t.profile;
  return {
    runtimeMs: t.runtimeMs,
    evaluations: t.evaluations,
    generatedStates: t.generatedStates,
    searchGeneratedStates: t.searchGeneratedStates,
    transitionCalls: t.transitionCalls,
    retentionCalls: t.retentionCalls,
    paretoCandidates: p?.counters?.paretoCandidates ?? null,
    retentionRuntimeMs: p?.timers?.retentionMs ?? null,
    trajectoryScoreRuntimeMs: p?.timers?.trajectoryScoreMs ?? null,
    searchComplete: t.searchComplete,
    finalFront: compactFront(result),
    commonHorizon: t.commonHorizonShadow || null
  };
}

function normalizeNodeRecord(record) {
  return {
    ...record,
    nodeId: pathIdFromSerial(record.nodeId)
  };
}

function normalizePool(pool) {
  const added = pool.nodesAddedByCommonHorizon.map(normalizeNodeRecord);
  const removed = pool.nodesRemovedByCommonHorizon.map(normalizeNodeRecord);
  const baselineRetainedNodeIds = pool.baselineRetainedNodeIds.map(pathIdFromSerial);
  const commonHorizonRetainedNodeIds = pool.commonHorizonRetainedNodeIds.map(pathIdFromSerial);
  const exchangePairs = added.map((entry, index) => {
    const displaced = removed[index] || null;
    if (!displaced) return { commonHorizonAdded: entry.nodeId, baselineRemoved: null };
    return {
      commonHorizonAdded: entry.nodeId,
      baselineRemoved: displaced.nodeId,
      baselineVectorDeltaAddedMinusRemoved: {
        pathScore: entry.baselineVector.pathScore - displaced.baselineVector.pathScore,
        endScore: entry.baselineVector.endScore - displaced.baselineVector.endScore
      },
      commonHorizonVectorDeltaAddedMinusRemoved: {
        pathScore: entry.commonHorizonVector.pathScore - displaced.commonHorizonVector.pathScore,
        endScore: entry.commonHorizonVector.endScore - displaced.commonHorizonVector.endScore
      }
    };
  });
  return {
    ...pool,
    baselineRetainedNodeIds,
    commonHorizonRetainedNodeIds,
    nodesAddedByCommonHorizon: added,
    nodesRemovedByCommonHorizon: removed,
    exchangePairs,
    exchangePairingSemantics:
      "Added/removed nodes are paired deterministically by their respective retention order for inspection only; the pairing is not a causal slot assignment."
  };
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function range(values) {
  return values.length ? { min: Math.min(...values), max: Math.max(...values), median: median(values) } : null;
}

function classAggregate(pools, type) {
  const members = pools.filter((pool) => pool.type === type);
  const descendantAttributions = members.flatMap((pool) =>
    pool.nodesAddedByCommonHorizon.map((node) => node.downstream?.generatedDescendantCount || 0)
  );
  return {
    poolCount: members.length,
    horizonScoringRuntimeMs: members.reduce((sum, pool) => sum + pool.horizonScoringRuntimeMs, 0),
    horizonVectorEvaluations: members.reduce((sum, pool) => sum + pool.horizonVectorEvaluations, 0),
    commonHorizonRetentionRuntimeMs: members.reduce((sum, pool) => sum + pool.retentionRuntimeMs, 0),
    auditBaselineRetentionRuntimeMs: members.reduce((sum, pool) => sum + pool.baselineAuditRetentionRuntimeMs, 0),
    auditExactLayerRuntimeMs: members.reduce((sum, pool) => sum + pool.exactLayerRuntimeMs, 0),
    averageCandidateCount: average(members.map((pool) => pool.candidateCount)),
    averageExchangedBeamSlots: average(members.map((pool) => pool.exchangedBeamSlots)),
    attributedGeneratedDescendants: descendantAttributions.reduce((sum, value) => sum + value, 0),
    attributionWarning:
      "Descendant counts are ancestry attributions and can overlap across rescued origins/pools; do not sum them as causal unique generated states."
  };
}

function signalSummary(pools) {
  const changed = pools.filter((pool) => pool.selectionChanged);
  const valuable = changed.filter((pool) => pool.type >= 3);
  const nonFinal = changed.filter((pool) => pool.type < 3);
  const summarize = (set) => {
    const added = set.flatMap((pool) => pool.nodesAddedByCommonHorizon);
    return {
      poolCount: set.length,
      soulGap: range(set.map((pool) => pool.soulGap)),
      candidateCount: range(set.map((pool) => pool.candidateCount)),
      soulLevelCount: range(set.map((pool) => pool.soulLevels.length)),
      exchangedBeamSlots: range(set.map((pool) => pool.exchangedBeamSlots)),
      searchDepth: range(set.map((pool) => pool.step)),
      minSouls: range(set.map((pool) => pool.minEarnedSouls)),
      rescuedBaselineParetoLayer: range(added.map((node) => node.baselineParetoLayer)),
      rescuedCommonParetoLayer: range(added.map((node) => node.commonHorizonParetoLayer)),
      rescuedPathShiftToHorizon: range(added.map(
        (node) => node.commonHorizonVector.pathScore - node.baselineVector.pathScore
      )),
      rescuedEndShiftToHorizon: range(added.map(
        (node) => node.commonHorizonVector.endScore - node.baselineVector.endScore
      )),
      diversityKeys: [...new Set(added.map((node) => node.diversityKey))].sort()
    };
  };
  const valuableGaps = new Set(valuable.map((pool) => pool.soulGap));
  const nonFinalGaps = new Set(nonFinal.map((pool) => pool.soulGap));
  return {
    valuableTypes3to4: summarize(valuable),
    changedButNotFinalTypes1to2: summarize(nonFinal),
    sharedSoulGaps: [...valuableGaps].filter((gap) => nonFinalGaps.has(gap)).sort((a, b) => a - b),
    simpleSoulGapSeparationObserved:
      valuable.length > 0 &&
      nonFinal.length > 0 &&
      [...valuableGaps].every((gap) => !nonFinalGaps.has(gap))
  };
}

function normalizeTrace(telemetry) {
  return telemetry.selectionTrace;
}

function main() {
  const data = loadData();
  const references = JSON.parse(readFileSync(REFERENCE_FILE, "utf8"));
  const storedScoreOnly = JSON.parse(readFileSync(STORED_SCORE_ONLY_FILE, "utf8"));
  const definition = benchmarkCases("production").find((entry) =>
    entry.hero === "warden" && entry.focus === "weapon"
  );
  if (!definition) throw new Error("Warden weapon production case missing.");
  const referenceEntry = references.references[definition.id];
  if (!referenceEntry?.reference) throw new Error("Frozen baseline-v0 reference missing.");

  const requested = definition.itemIds ? [...definition.itemIds] : data.items.map((item) => item.item_id);
  const legalItemIds = requested.filter((id) => heroCanPurchaseItem(data.itemsById.get(id), data, definition.hero));
  const slotUnlocks = [{
    earnedSouls: 0,
    slots: Number(data.slots.item_limit) - Number(data.slots.starting_slots.universal)
  }];
  const args = {
    data,
    reference: referenceEntry.reference,
    heroId: definition.hero,
    damageFocus: definition.focus,
    objectiveConfig: SWEET,
    itemIds: legalItemIds,
    budget: definition.budget,
    milestones: definition.milestones,
    opponentBulletResist: definition.opponentBulletResist,
    opponentSpiritResist: definition.opponentSpiritResist,
    slotUnlocks,
    beamWidth: WIDTH,
    maxSteps: 1000,
    timeMs: Infinity,
    auditReserveMs: 0,
    profile: true,
    commonHorizonScoreOnlyShadow: true
  };

  console.log(JSON.stringify({ phase: "score-only-control-a" }));
  const controlA = runControlledMultiobjectiveBeamCarry(args);
  console.log(JSON.stringify({ phase: "score-only-retention-audit" }));
  const audited = runControlledMultiobjectiveBeamCarry({ ...args, commonHorizonRetentionAudit: true });
  console.log(JSON.stringify({ phase: "score-only-control-b" }));
  const controlB = runControlledMultiobjectiveBeamCarry(args);

  const rawAudit = audited.telemetry.commonHorizonRetentionAudit;
  if (!rawAudit?.enabled) throw new Error("Retention audit telemetry missing.");
  const pools = rawAudit.pools.map(normalizePool);
  const appliedPools = pools.length;
  const typeCounts = Object.fromEntries([0, 1, 2, 3, 4].map((type) => [
    type,
    pools.filter((pool) => pool.type === type).length
  ]));
  if (Object.values(typeCounts).reduce((sum, count) => sum + count, 0) !== appliedPools) {
    throw new Error("Pool classification count mismatch.");
  }

  const targetPools = pools.filter((pool) =>
    pool.nodesAddedByCommonHorizon.some((node) => node.nodeId === TARGET_PATH_ID)
  );
  if (!targetPools.length) {
    throw new Error("Known seed 93260772842f0c27 was not recognized as newly retained; audit instrumentation invalid.");
  }
  const targetBestType = Math.max(...targetPools.map((pool) => pool.type));
  if (targetBestType < 3) {
    throw new Error(
      `Known seed 93260772842f0c27 classified only as TYPE ${targetBestType}; stop and inspect instrumentation.`
    );
  }

  const frontA = compactFront(controlA);
  const frontAudited = compactFront(audited);
  const frontB = compactFront(controlB);
  const storedFront = storedScoreOnly.stage3?.scoreOnly?.finalFront || [];
  const retainedTraceEqualA = JSON.stringify(normalizeTrace(controlA.telemetry)) ===
    JSON.stringify(normalizeTrace(audited.telemetry));
  const retainedTraceEqualB = JSON.stringify(normalizeTrace(controlB.telemetry)) ===
    JSON.stringify(normalizeTrace(audited.telemetry));
  const finalFrontEqualControls = JSON.stringify(frontA) === JSON.stringify(frontAudited) &&
    JSON.stringify(frontB) === JSON.stringify(frontAudited);
  const storedFinalFrontEqual = JSON.stringify(storedFront) === JSON.stringify(frontAudited);
  if (!retainedTraceEqualA || !retainedTraceEqualB || !finalFrontEqualControls) {
    throw new Error("Audit changed retained-node trace or final Pareto front.");
  }

  const controlRuns = [compactRun(controlA), compactRun(controlB)];
  const auditedRun = compactRun(audited);
  const controlMeanRuntimeMs = average(controlRuns.map((run) => run.runtimeMs));
  const observerEffect = {
    controlARuntimeMs: controlRuns[0].runtimeMs,
    auditedRuntimeMs: auditedRun.runtimeMs,
    controlBRuntimeMs: controlRuns[1].runtimeMs,
    controlMeanRuntimeMs,
    auditedMinusControlMeanMs: auditedRun.runtimeMs - controlMeanRuntimeMs,
    internalComparisonRuntimeMs: rawAudit.comparisonRuntimeMs,
    internalClassificationRuntimeMs: rawAudit.classificationRuntimeMs,
    note:
      "Wall-clock delta is bracketed by two no-audit score-only runs to expose observer effect; it is not treated as exact causal decomposition."
  };

  const classCosts = Object.fromEntries([0, 1, 2, 3, 4].map((type) => [
    `TYPE ${type}`,
    classAggregate(pools, type)
  ]));
  const signals = signalSummary(pools);
  const selectionChangedPools = pools.filter((pool) => pool.selectionChanged).length;
  const finalRelevantPools = typeCounts[3] + typeCounts[4];

  const result = {
    schemaVersion: "optimizer-common-horizon-retention-pool-audit-v1",
    sourceCommit: process.env.GITHUB_SHA || "unknown",
    caseId: definition.id,
    scope: {
      hero: "warden",
      role: "carry",
      focus: "weapon",
      budget: definition.budget,
      beamWidth: WIDTH,
      objective: SWEET,
      reference: referenceEntry.version
    },
    productionChanged: false,
    uiChanged: false,
    canonicalDataChanged: false,
    searchSemanticsChanged: false,
    controls: {
      scoreOnlyControlA: controlRuns[0],
      scoreOnlyAudited: auditedRun,
      scoreOnlyControlB: controlRuns[1],
      retainedTraceEqualControlA: retainedTraceEqualA,
      retainedTraceEqualControlB: retainedTraceEqualB,
      finalFrontEqualControls,
      storedPriorScoreOnlyFinalFrontEqual: storedFinalFrontEqual,
      storedPriorSourceCommit: storedScoreOnly.sourceCommit || null
    },
    observerEffect,
    poolDistribution: {
      appliedPools,
      type0: typeCounts[0],
      type1: typeCounts[1],
      type2: typeCounts[2],
      type3: typeCounts[3],
      type4: typeCounts[4],
      type0Percent: appliedPools ? typeCounts[0] / appliedPools * 100 : null,
      selectionChangedPools,
      selectionChangedPercent: appliedPools ? selectionChangedPools / appliedPools * 100 : null,
      finalRelevantPools,
      finalRelevantPercentOfChanged: selectionChangedPools ? finalRelevantPools / selectionChangedPools * 100 : null,
      type4Distinguishable: rawAudit.type4Distinguishable,
      finalFrontSize: rawAudit.finalFrontSize
    },
    knownTarget: {
      pathId: TARGET_PATH_ID,
      recognized: true,
      bestType: targetBestType,
      pools: targetPools.map((pool) => ({
        poolIndex: pool.poolIndex,
        step: pool.step,
        minEarnedSouls: pool.minEarnedSouls,
        maxEarnedSouls: pool.maxEarnedSouls,
        commonHorizon: pool.commonHorizon,
        type: pool.type,
        rescuedNode: pool.nodesAddedByCommonHorizon.find((node) => node.nodeId === TARGET_PATH_ID)
      }))
    },
    classCosts,
    signals,
    hypothesisChecks: {
      h1MostPoolsDoNothing: {
        type0Pools: typeCounts[0],
        appliedPools,
        type0Percent: appliedPools ? typeCounts[0] / appliedPools * 100 : null
      },
      h2SelectionChangeAutomaticallyValuable: {
        selectionChangedPools,
        type1to2Pools: typeCounts[1] + typeCounts[2],
        type3to4Pools: finalRelevantPools
      },
      h3Known36kCaseRepresentative: {
        targetSoulGaps: [...new Set(targetPools.map((pool) => pool.soulGap))],
        valuableSoulGapRange: signals.valuableTypes3to4.soulGap,
        valuableCandidateCountRange: signals.valuableTypes3to4.candidateCount,
        targetCandidateCounts: targetPools.map((pool) => pool.candidateCount)
      },
      h4SimpleSoulGapThresholdWouldSuffice: {
        sharedSoulGapsBetweenFinalRelevantAndOtherChangedPools: signals.sharedSoulGaps,
        cleanSeparationObserved: signals.simpleSoulGapSeparationObserved
      }
    },
    classificationSemantics: rawAudit.classificationSemantics,
    pools
  };

  const target = outputPath();
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({
    status: "COMPLETE",
    output: target,
    poolDistribution: result.poolDistribution,
    knownTarget: result.knownTarget,
    observerEffect,
    controls: {
      retainedTraceEqualControlA: retainedTraceEqualA,
      retainedTraceEqualControlB: retainedTraceEqualB,
      finalFrontEqualControls,
      storedPriorScoreOnlyFinalFrontEqual: storedFinalFrontEqual
    }
  }));
}

try {
  main();
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
}

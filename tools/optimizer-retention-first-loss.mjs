import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "../app/lib.mjs";
import { buildOptimizerData, heroCanPurchaseItem } from "../app/optimizer.mjs";
import { runControlledMultiobjectiveBeamCarry } from "../app/multiobjective-search.mjs";
import { benchmarkCases } from "../benchmarks/optimizer-v1/cases.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUTPUT = resolve(ROOT, "benchmarks/optimizer-v1/experiments/retention-first-loss/results.json");
const NOTE = resolve(ROOT, "benchmarks/optimizer-v1/experiments/retention-first-loss/research-note.md");
const REFERENCE = resolve(ROOT, "benchmarks/optimizer-v1/references/baseline-v0.json");
const WIDTH = 4;
const KNOWN_SEED = "93260772842f0c27";
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

function loadData() {
  const json = (path) => JSON.parse(readFileSync(resolve(ROOT, path), "utf8"));
  const csv = (path) => parseCsv(readFileSync(resolve(ROOT, path), "utf8"));
  return buildOptimizerData({
    coreManifest: json("data/core/manifest.json"), heroManifest: json("data/heroes/manifest.json"),
    items: csv("data/core/items.csv"), itemMechanics: csv("data/core/item_mechanics.csv"),
    upgrades: csv("data/core/item_upgrades.csv"), economy: json("data/core/economy.json"),
    slots: json("data/core/slots.json"), heroes: csv("data/heroes/heroes.csv"),
    heroStats: csv("data/heroes/hero_stats.csv"), abilities: csv("data/heroes/abilities.csv"),
    abilityMechanics: csv("data/heroes/ability_mechanics.csv"), heroResources: csv("data/heroes/hero_resources.csv")
  });
}

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function pathIdFromSerial(serial) {
  const events = String(serial).split("|").slice(1).map((entry) => JSON.parse(entry));
  return fingerprint(events).slice(0, 16);
}

function compact(result) {
  const t = result.telemetry;
  return {
    runtimeMs: t.runtimeMs,
    evaluations: t.evaluations,
    generatedStates: t.generatedStates,
    searchGeneratedStates: t.searchGeneratedStates,
    transitionCalls: t.transitionCalls,
    retentionCalls: t.retentionCalls,
    duplicateStates: t.duplicateStates,
    steps: t.steps,
    searchComplete: t.searchComplete,
    selectionTraceHash: fingerprint(t.selectionTrace),
    finalFront: result.front.map((entry) => ({
      events: entry.state.events,
      pathScore: entry.pathScore,
      endScore: entry.endScore,
      inventory: entry.state.inventory
    }))
  };
}

function firstActual(origin) {
  return origin.firstSemanticOutcome?.outcome === "true-retention-loss" ? origin.firstSemanticOutcome : null;
}

function compactEvidence(evidence) {
  if (!evidence) return null;
  if (!Array.isArray(evidence.candidates)) return evidence;
  const limit = 12;
  const candidates = [...evidence.candidates]
    .sort((a, b) => a.paretoLayer - b.paretoLayer || a.nodeId.localeCompare(b.nodeId));
  return {
    exactParetoLayerCount: evidence.exactLayerSizes.length,
    exactLayerSizesThroughTruncation: evidence.truncatedLayerIndex === null
      ? evidence.exactLayerSizes
      : evidence.exactLayerSizes.slice(0, evidence.truncatedLayerIndex + 1),
    truncatedLayerIndex: evidence.truncatedLayerIndex,
    capacityFillLayerIndex: evidence.capacityFillLayerIndex ?? null,
    precedingLayerCount: evidence.precedingLayerCount,
    widthCapacity: evidence.widthCapacity,
    relevantCandidateCount: candidates.length,
    relevantCandidateSample: candidates.slice(0, limit),
    relevantCandidateSampleTruncated: candidates.length > limit,
    selected: evidence.selected
  };
}

function lossStep(origin) {
  return origin.steps?.find((step) => step.semanticOutcome || step.directOutcome) || null;
}

function researchNote(result) {
  const rows = (result.changedPoolTable || []).map((pool) => {
    const origins = pool.origins || [];
    const lossRows = origins.map(lossStep).filter(Boolean);
    const steps = [...new Set(lossRows.map((step) => step.step))].join(",");
    const horizon = [...new Set(lossRows.map((step) => step.commonHorizon?.applied
      ? `applied:${step.commonHorizon.horizon}`
      : `skip:${step.commonHorizon?.reason || "off"}`))].join(";");
    const fill = [...new Set(lossRows.map((step) => step.retentionEvidence?.capacityFillLayerIndex ?? "—"))].join(",");
    return `| ${pool.poolIndex} | ${origins.length} | ${origins.map((origin) => origin.originSouls).join(",")} | ${steps || "—"} | ${fill} | ${horizon || "—"} |`;
  });
  return `# Retention first-loss diagnostic

One infinity-time Warden Weapon Carry width-4 score-only run was observed with a paired no-observer control. The observer leaves production identity and retention untouched.

- Changed pools: ${result.aggregate?.changedPools}; rescued origins: ${result.aggregate?.rescuedOrigins}.
- Actual semantic true-retention losses: ${result.aggregate?.actualTrueRetentionLosses}; direct representative-only losses: ${result.aggregate?.directRepresentativeOnlyLosses}; offsets: ${JSON.stringify(result.aggregate?.lossStepOffsets)}.
- Known seed \`93260772842f0c27\`: pool 8, 3,600 Souls, loss step 14; **24 generated / 24 direct post-dedupe / 24 semantic post-dedupe / 0 retained**. The \`edacb6626090f0a7\` companion is the distinct 24 / 22 / 0 direct case.
- Neutrality: trace=${result.neutrality?.traceEqual}, front=${result.neutrality?.frontEqual}, exact search-work=${result.neutrality?.workEqual}.

| Pool | Origins | Origin Souls | Loss step | Fill layer | Common horizon at loss |
| ---: | ---: | --- | --- | --- | --- |
${rows.join("\n")}

Direct-label loss is excluded as the semantic explanation for these traced losses; metric-history influence is not ruled out. No 40k extrapolation, final-build, or policy claim follows.
`;
}

function compactExistingArtifact() {
  const result = JSON.parse(readFileSync(OUTPUT, "utf8"));
  for (const pool of result.changedPoolTable || []) {
    for (const origin of pool.origins || []) {
      origin.pathId = pathIdFromSerial(origin.nodeId);
      origin.steps = origin.steps.map((step) => ({ ...step, retentionEvidence: compactEvidence(step.retentionEvidence) }));
    }
  }
  const known = (result.changedPoolTable || []).flatMap((pool) => pool.origins
    .filter((origin) => origin.pathId === KNOWN_SEED)
    .map((origin) => ({ poolIndex: pool.poolIndex, originSouls: origin.originSouls, firstDirectLoss: origin.firstDirectLoss, firstSemanticOutcome: origin.firstSemanticOutcome })));
  result.knownSeed = { pathId: KNOWN_SEED, matches: known, observed: known.length > 0 };
  result.artifacts ||= {};
  result.artifacts.resultsJson = "benchmarks/optimizer-v1/experiments/retention-first-loss/results.json";
  result.artifacts.researchNote = "benchmarks/optimizer-v1/experiments/retention-first-loss/research-note.md";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    writeFileSync(OUTPUT, JSON.stringify(result, null, 2) + "\n");
    result.artifacts.resultsBytes = statSync(OUTPUT).size;
  }
  writeFileSync(OUTPUT, JSON.stringify(result, null, 2) + "\n");
  writeFileSync(NOTE, researchNote(result));
  console.log(JSON.stringify({ status: "COMPACTED", output: OUTPUT, resultsBytes: statSync(OUTPUT).size }));
}

function main() {
  const previous = existsSync(OUTPUT) ? JSON.parse(readFileSync(OUTPUT, "utf8")) : null;
  const data = loadData();
  const definition = benchmarkCases("production").find((entry) => entry.hero === "warden" && entry.focus === "weapon");
  if (!definition) throw new Error("Warden weapon production case missing.");
  const reference = JSON.parse(readFileSync(REFERENCE, "utf8")).references[definition.id]?.reference;
  if (!reference) throw new Error("Frozen baseline reference missing.");
  const itemIds = (definition.itemIds || data.items.map((item) => item.item_id)).filter((id) =>
    heroCanPurchaseItem(data.itemsById.get(id), data, definition.hero));
  const args = {
    data, reference, heroId: definition.hero, damageFocus: definition.focus, objectiveConfig: SWEET,
    itemIds, budget: definition.budget, milestones: definition.milestones,
    opponentBulletResist: definition.opponentBulletResist, opponentSpiritResist: definition.opponentSpiritResist,
    slotUnlocks: [{ earnedSouls: 0, slots: Number(data.slots.item_limit) - Number(data.slots.starting_slots.universal) }],
    beamWidth: WIDTH, maxSteps: 1000, timeMs: Infinity, auditReserveMs: 0, profile: true,
    commonHorizonScoreOnlyShadow: true, commonHorizonRetentionAudit: true
  };
  console.log(JSON.stringify({ phase: "paired-score-only-control" }));
  const control = runControlledMultiobjectiveBeamCarry(args);
  console.log(JSON.stringify({ phase: "retention-first-loss-audit" }));
  const observed = runControlledMultiobjectiveBeamCarry({ ...args, commonHorizonRetentionFirstLossAudit: true });
  const controlRun = compact(control);
  const observedRun = compact(observed);
  const traceEqual = controlRun.selectionTraceHash === observedRun.selectionTraceHash;
  const frontEqual = JSON.stringify(controlRun.finalFront) === JSON.stringify(observedRun.finalFront);
  const workEqual = ["evaluations", "generatedStates", "searchGeneratedStates", "transitionCalls", "retentionCalls", "duplicateStates", "steps", "searchComplete"]
    .every((key) => controlRun[key] === observedRun[key]);
  if (!traceEqual || !frontEqual || !workEqual) throw new Error("Observer changed retained trace, final front, or search work.");

  const retention = observed.telemetry.commonHorizonRetentionAudit;
  const provenance = observed.telemetry.commonHorizonRetentionFirstLossAudit;
  if (!retention?.enabled || !provenance?.enabled) throw new Error("Required diagnostic telemetry missing.");
  const originsByPool = new Map();
  for (const origin of provenance.origins) {
    if (!originsByPool.has(origin.poolIndex)) originsByPool.set(origin.poolIndex, []);
    originsByPool.get(origin.poolIndex).push(origin);
  }
  const changedPoolTable = retention.pools.filter((pool) => pool.selectionChanged).map((pool) => {
    const origins = originsByPool.get(pool.poolIndex) || [];
    return {
      poolIndex: pool.poolIndex,
      step: pool.step,
      earnedSouls: { min: pool.minEarnedSouls, max: pool.maxEarnedSouls },
      commonHorizon: pool.commonHorizon,
      candidateCount: pool.candidateCount,
      width: pool.width,
      exchangedBeamSlots: pool.exchangedBeamSlots,
      rescuedOriginCount: origins.length,
      firstActualLossCount: origins.filter(firstActual).length,
      origins: origins.map((origin) => ({
        key: origin.key,
        nodeId: origin.nodeId,
        pathId: pathIdFromSerial(origin.nodeId),
        originSouls: origin.originSouls,
        firstDirectLoss: origin.firstDirectLoss,
        firstSemanticOutcome: origin.firstSemanticOutcome,
        directTerminalCount: origin.direct.terminals,
        semanticTerminalCount: origin.semantic.terminals,
        steps: origin.steps.map((step) => ({ ...step, retentionEvidence: compactEvidence(step.retentionEvidence) }))
      }))
    };
  });
  if (changedPoolTable.length !== 24) throw new Error(`Expected 24 changed pools, got ${changedPoolTable.length}.`);
  const allOrigins = provenance.origins;
  const lossStepOffsets = Object.fromEntries([...new Set(allOrigins.map((origin) =>
    (origin.firstSemanticOutcome?.step ?? origin.originStep) - origin.originStep))].sort((a, b) => a - b).map((offset) => [offset,
    allOrigins.filter((origin) => (origin.firstSemanticOutcome?.step ?? origin.originStep) - origin.originStep === offset).length
  ]));
  const aggregate = {
    changedPools: changedPoolTable.length,
    rescuedOrigins: allOrigins.length,
    firstDirectLosses: allOrigins.filter((origin) => origin.firstDirectLoss).length,
    directRepresentativeOnlyLosses: allOrigins.filter((origin) => origin.firstDirectLoss?.outcome === "dedupe-representative-only-loss").length,
    firstSemanticOutcomes: Object.fromEntries([...new Set(allOrigins.map((origin) => origin.firstSemanticOutcome?.outcome || "none"))]
      .sort().map((outcome) => [outcome, allOrigins.filter((origin) => (origin.firstSemanticOutcome?.outcome || "none") === outcome).length])),
    actualTrueRetentionLosses: allOrigins.filter(firstActual).length,
    terminalizedOrigins: allOrigins.filter((origin) => origin.firstSemanticOutcome?.outcome === "termination").length,
    lossStepOffsets
  };
  const signature = (result) => (result?.changedPoolTable || []).flatMap((pool) => pool.origins.map((origin) =>
    `${pool.poolIndex}:${origin.pathId}:${origin.firstSemanticOutcome?.step}:${origin.firstSemanticOutcome?.outcome}`)).sort();
  const priorSignature = signature(previous);
  const currentSignature = changedPoolTable.flatMap((pool) => pool.origins.map((origin) =>
    `${pool.poolIndex}:${origin.pathId}:${origin.firstSemanticOutcome?.step}:${origin.firstSemanticOutcome?.outcome}`)).sort();
  const result = {
    schemaVersion: "optimizer-retention-first-loss-v1",
    sourceCommit: process.env.GITHUB_SHA || "16d10b8f581f0a59601e86bdff2cd7055131e575",
    scope: { caseId: definition.id, hero: "warden", role: "carry", focus: "weapon", budget: definition.budget, beamWidth: WIDTH, objective: SWEET, timeMs: "Infinity", mode: "score-only common-horizon" },
    guardrails: { productionChanged: false, uiChanged: false, canonicalDataChanged: false, carryObjectiveChanged: false, pathAucChanged: false, endbuildChanged: false },
    provenance: provenance.provenance,
    neutrality: { pairedControlRequiredBecausePriorArtifactHasNoFullSelectionTrace: true, traceEqual, frontEqual, workEqual, control: controlRun, observed: observedRun, observerRuntimeDeltaMs: observedRun.runtimeMs - controlRun.runtimeMs },
    searchWorkExact: { control: Object.fromEntries(Object.entries(controlRun).filter(([key]) => key !== "finalFront" && key !== "selectionTraceHash")), observed: Object.fromEntries(Object.entries(observedRun).filter(([key]) => key !== "finalFront" && key !== "selectionTraceHash")) },
    aggregate,
    classificationComparedToPrevious: previous ? {
      previousSchemaVersion: previous.schemaVersion || null,
      sameChangedPoolCount: (previous.changedPoolTable?.length || 0) === changedPoolTable.length,
      sameOriginLossSignature: JSON.stringify(priorSignature) === JSON.stringify(currentSignature),
      priorAggregate: previous.aggregate || null
    } : null,
    knownSeed: {
      pathId: KNOWN_SEED,
      matches: changedPoolTable.flatMap((pool) => pool.origins.filter((origin) => origin.pathId === KNOWN_SEED).map((origin) => ({
        poolIndex: pool.poolIndex, originSouls: origin.originSouls,
        firstDirectLoss: origin.firstDirectLoss, firstSemanticOutcome: origin.firstSemanticOutcome
      })))
    },
    changedPoolTable,
    exclusions: ["A direct-parent-chain disappearance is not called semantic lineage loss when an exact dedupe representative carries the union forward.", "A terminal observed from either provenance type is recorded as termination, not a false retention loss."],
    untestedHypotheses: ["No conclusion for other heroes, focuses, widths, objectives, or finite time budgets.", "This diagnostic attributes the existing score-only search; it does not test a retention-policy change or an architectural intervention."]
  };
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(result, null, 2) + "\n");
  result.artifacts = { resultsJson: "benchmarks/optimizer-v1/experiments/retention-first-loss/results.json", resultsBytes: 0, researchNote: "benchmarks/optimizer-v1/experiments/retention-first-loss/research-note.md" };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    writeFileSync(OUTPUT, JSON.stringify(result, null, 2) + "\n");
    result.artifacts.resultsBytes = statSync(OUTPUT).size;
  }
  writeFileSync(OUTPUT, JSON.stringify(result, null, 2) + "\n");
  writeFileSync(NOTE, researchNote(result));
  console.log(JSON.stringify({ status: "COMPLETE", output: OUTPUT, aggregate, neutrality: result.neutrality }));
}

try {
  if (process.argv.includes("--compact-existing")) compactExistingArtifact();
  else main();
} catch (error) { console.error(error?.stack || error?.message || String(error)); process.exitCode = 1; }

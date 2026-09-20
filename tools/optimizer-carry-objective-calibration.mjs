import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathEndDominates } from "../app/path-end-pareto.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const ISOLATION_FILE = resolve(ROOT, "benchmarks/optimizer-v1/experiments/carry-objective-isolation/results.json");
const AB_FILE = resolve(ROOT, "benchmarks/optimizer-v1/experiments/carry-objective-ab/results.json");
const DEFAULT_OUTPUT = resolve(ROOT, "artifacts/carry-objective-calibration/results.json");

const DAMAGE_WEIGHTS = Object.freeze([0.60, 0.65, 0.70, 0.75]);
const SPECIALIZATIONS = Object.freeze([0.70, 0.775, 0.85]);
const FOCUSES = Object.freeze(["weapon", "spirit", "hybrid"]);
const EPS = 1e-12;

function outputPath() {
  const args = process.argv.slice(2);
  const index = args.indexOf("--output");
  return resolve(index >= 0 ? args[index + 1] : DEFAULT_OUTPUT);
}

function near(a, b, eps = EPS) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= eps;
}

function assertNear(actual, expected, label, eps = EPS) {
  if (!near(actual, expected, eps)) throw new Error(`${label}: ${actual} != ${expected}`);
}

function configId(focus, damageWeight, specialization) {
  const d = String(Math.round(damageWeight * 100)).padStart(2, "0");
  if (focus === "hybrid") return `d${d}-hybrid-50-50`;
  const s = String(specialization * 100).replace(".", "_");
  return `d${d}-${focus}-${s}`;
}

function configFor(focus, damageWeight, specialization) {
  const survivalWeight = 1 - damageWeight;
  const spec = focus === "hybrid" ? 0.5 : specialization;
  return {
    id: configId(focus, damageWeight, spec),
    damageWeight,
    survivalWeight,
    damageFocusWeights: focus === "weapon"
      ? { bullet: spec, spirit: 1 - spec }
      : focus === "spirit"
        ? { bullet: 1 - spec, spirit: spec }
        : { bullet: 0.5, spirit: 0.5 },
    effective: focus === "weapon"
      ? { bullet: damageWeight * spec, spirit: damageWeight * (1 - spec), survival: survivalWeight }
      : focus === "spirit"
        ? { bullet: damageWeight * (1 - spec), spirit: damageWeight * spec, survival: survivalWeight }
        : { bullet: damageWeight * 0.5, spirit: damageWeight * 0.5, survival: survivalWeight }
  };
}

function metricShape(source) {
  return {
    pathScore: Number(source.pathScore),
    endScore: Number(source.endScore),
    pathDamage: Number(source.pathDamage),
    endDamage: Number(source.endDamage),
    pathSurvivability: Number(source.pathSurvivability),
    endSurvivability: Number(source.endSurvivability)
  };
}

function addCandidate(map, raw) {
  const existing = map.get(raw.id);
  if (!existing) {
    map.set(raw.id, raw);
    return;
  }
  for (const key of ["pathDamage", "endDamage", "pathSurvivability", "endSurvivability"]) {
    assertNear(existing.baseline[key], raw.baseline[key], `${raw.id}/duplicate baseline ${key}`, 1e-10);
    assertNear(existing.specialized[key], raw.specialized[key], `${raw.id}/duplicate specialized ${key}`, 1e-10);
  }
  existing.origins = [...new Set([...existing.origins, ...raw.origins])].sort();
}

function loadCandidatePools(isolation, ab) {
  const pools = new Map();
  for (const focus of FOCUSES) pools.set(focus, new Map());

  for (const caseResult of isolation.cases) {
    const map = pools.get(caseResult.focus);
    for (const candidate of caseResult.candidates) {
      addCandidate(map, {
        id: candidate.id,
        origins: ["prior-fixed-isolation"],
        discoveredBy: [],
        investments: candidate.investments,
        thresholds4800: candidate.thresholds4800,
        transactions: candidate.transactions,
        reacquisitions: candidate.reacquisitions,
        baseline: metricShape(candidate.scores.A),
        specialized: metricShape(candidate.scores.B3)
      });
    }
  }

  for (const caseResult of ab.stage2.cases) {
    const map = pools.get(caseResult.focus);
    for (const candidate of caseResult.crossScoredUnion.records) {
      addCandidate(map, {
        id: candidate.id,
        origins: ["prior-controlled-search-union"],
        discoveredBy: candidate.discoveredBy || [],
        investments: candidate.investments,
        thresholds4800: candidate.thresholds4800,
        transactions: candidate.transactions,
        reacquisitions: candidate.reacquisitions,
        baseline: metricShape(candidate.A),
        specialized: metricShape(candidate.B)
      });
    }
  }
  return pools;
}

function verifyCandidate(candidate, focus) {
  assertNear(candidate.baseline.pathSurvivability, candidate.specialized.pathSurvivability, `${focus}/${candidate.id}/path survival`, 1e-10);
  assertNear(candidate.baseline.endSurvivability, candidate.specialized.endSurvivability, `${focus}/${candidate.id}/end survival`, 1e-10);
  if (focus === "hybrid") {
    assertNear(candidate.baseline.pathDamage, candidate.specialized.pathDamage, `${focus}/${candidate.id}/path hybrid damage`, 1e-10);
    assertNear(candidate.baseline.endDamage, candidate.specialized.endDamage, `${focus}/${candidate.id}/end hybrid damage`, 1e-10);
  }
  for (const category of ["weapon", "vitality", "spirit"]) {
    if (Number(candidate.investments?.[category]) >= 4800 && candidate.thresholds4800?.[category]?.souls == null) {
      throw new Error(`${focus}/${candidate.id}: missing verified 4.8k threshold for ${category}`);
    }
  }
}

function interpolateDamage(candidate, focus, specialization) {
  if (focus === "hybrid") {
    return {
      pathDamage: candidate.baseline.pathDamage,
      endDamage: candidate.baseline.endDamage
    };
  }
  const alpha = (specialization - 0.70) / 0.15;
  if (alpha < -EPS || alpha > 1 + EPS) throw new RangeError("specialization outside calibrated 70/30..85/15 interval");
  return {
    pathDamage: candidate.baseline.pathDamage + alpha * (candidate.specialized.pathDamage - candidate.baseline.pathDamage),
    endDamage: candidate.baseline.endDamage + alpha * (candidate.specialized.endDamage - candidate.baseline.endDamage)
  };
}

function rescore(candidate, focus, damageWeight, specialization) {
  const damage = interpolateDamage(candidate, focus, specialization);
  const survivalWeight = 1 - damageWeight;
  return {
    pathScore: damageWeight * damage.pathDamage + survivalWeight * candidate.baseline.pathSurvivability,
    endScore: damageWeight * damage.endDamage + survivalWeight * candidate.baseline.endSurvivability,
    pathDamage: damage.pathDamage,
    endDamage: damage.endDamage,
    pathSurvivability: candidate.baseline.pathSurvivability,
    endSurvivability: candidate.baseline.endSurvivability
  };
}

function paretoLayers(entries) {
  const remaining = [...entries];
  const layers = [];
  while (remaining.length) {
    const front = remaining.filter((candidate, index) =>
      !remaining.some((other, otherIndex) =>
        otherIndex !== index && pathEndDominates(other.score, candidate.score)
      )
    );
    if (!front.length) throw new Error("Pareto layering made no progress.");
    layers.push(front.map((entry) => entry.id).sort());
    const ids = new Set(front.map((entry) => entry.id));
    for (let i = remaining.length - 1; i >= 0; i -= 1) if (ids.has(remaining[i].id)) remaining.splice(i, 1);
  }
  return layers;
}

function relation(left, right) {
  if (pathEndDominates(left, right)) return "left-dominates";
  if (pathEndDominates(right, left)) return "right-dominates";
  return "tradeoff-or-equal";
}

function relationMap(entries) {
  const rows = [];
  for (let a = 0; a < entries.length; a += 1) {
    for (let b = a + 1; b < entries.length; b += 1) {
      rows.push({
        left: entries[a].id,
        right: entries[b].id,
        relation: relation(entries[a].score, entries[b].score)
      });
    }
  }
  return rows;
}

function relationChanges(base, next) {
  const before = new Map(base.map((row) => [`${row.left}|${row.right}`, row.relation]));
  return next.filter((row) => before.get(`${row.left}|${row.right}`) !== row.relation).map((row) => ({
    left: row.left,
    right: row.right,
    from: before.get(`${row.left}|${row.right}`),
    to: row.relation
  }));
}

function scorePool(pool, focus, damageWeight, specialization) {
  return [...pool.values()].map((candidate) => ({
    id: candidate.id,
    origins: candidate.origins,
    discoveredBy: candidate.discoveredBy,
    investments: candidate.investments,
    thresholds4800: candidate.thresholds4800,
    transactions: candidate.transactions,
    reacquisitions: candidate.reacquisitions,
    score: rescore(candidate, focus, damageWeight, specialization)
  }));
}

function stage2Ids(abCase, kind) {
  if (kind === "B") return new Set(abCase.crossScoredUnion.paretoFrontUnderB || []);
  if (kind === "A") return new Set(abCase.crossScoredUnion.paretoFrontUnderA || []);
  return new Set();
}

function evaluateConfig(pool, focus, damageWeight, specialization, baselineRelations, baselineFront, abCase) {
  const entries = scorePool(pool, focus, damageWeight, specialization);
  const layers = paretoLayers(entries);
  const front = layers[0];
  const relations = relationMap(entries);
  const desiredB3 = stage2Ids(abCase, "B");
  const baselineA = stage2Ids(abCase, "A");
  return {
    config: configFor(focus, damageWeight, specialization),
    paretoFront: front,
    paretoLayers: layers,
    uniquePreferredCandidate: front.length === 1 ? front[0] : null,
    frontChangedVsBaseline: JSON.stringify(front) !== JSON.stringify(baselineFront),
    dominanceChangesVsBaseline: relationChanges(baselineRelations, relations),
    target: {
      priorB3Front: [...desiredB3].sort(),
      priorAFront: [...baselineA].sort(),
      b3FrontCoverage: [...desiredB3].filter((id) => front.includes(id)).sort(),
      baselineFrontSurvivors: [...baselineA].filter((id) => front.includes(id)).sort(),
      reproducesPriorB3FrontExactly: front.length === desiredB3.size && front.every((id) => desiredB3.has(id))
    },
    candidates: entries
  };
}

function summarizeTransitions(configs, focus) {
  return configs.map((entry) => ({
    damageSurvival: `${Math.round(entry.config.damageWeight * 100)}/${Math.round(entry.config.survivalWeight * 100)}`,
    specialization: focus === "hybrid" ? "50/50" : `${entry.config.damageFocusWeights[focus === "weapon" ? "bullet" : "spirit"] * 100}/${entry.config.damageFocusWeights[focus === "weapon" ? "spirit" : "bullet"] * 100}`,
    paretoFront: entry.paretoFront,
    uniquePreferredCandidate: entry.uniquePreferredCandidate,
    reproducesPriorB3FrontExactly: entry.target.reproducesPriorB3FrontExactly,
    b3FrontCoverage: entry.target.b3FrontCoverage,
    baselineFrontSurvivors: entry.target.baselineFrontSurvivors,
    dominanceChangeCountVsBaseline: entry.dominanceChangesVsBaseline.length
  }));
}

function main() {
  const isolation = JSON.parse(readFileSync(ISOLATION_FILE, "utf8"));
  const ab = JSON.parse(readFileSync(AB_FILE, "utf8"));
  if (isolation.searchExecuted !== false) throw new Error("Isolation source unexpectedly executed search.");
  if (isolation.thresholdVerification?.valid !== true) throw new Error("Threshold verification from isolation is not valid.");

  const pools = loadCandidatePools(isolation, ab);
  const cases = [];

  for (const focus of FOCUSES) {
    const pool = pools.get(focus);
    for (const candidate of pool.values()) verifyCandidate(candidate, focus);
    const abCase = ab.stage2.cases.find((entry) => entry.focus === focus);
    if (!abCase) throw new Error("Missing prior Stage-2 case for " + focus);

    const baselineEntries = scorePool(pool, focus, 0.50, focus === "hybrid" ? 0.5 : 0.70);
    const baselineLayers = paretoLayers(baselineEntries);
    const baselineRelations = relationMap(baselineEntries);

    // Exact invariants against saved scores at the two endpoints.
    for (const candidate of pool.values()) {
      const baseline = rescore(candidate, focus, 0.50, focus === "hybrid" ? 0.5 : 0.70);
      assertNear(baseline.pathScore, candidate.baseline.pathScore, `${focus}/${candidate.id}/baseline path`, 1e-10);
      assertNear(baseline.endScore, candidate.baseline.endScore, `${focus}/${candidate.id}/baseline end`, 1e-10);
      const endpoint = rescore(candidate, focus, 0.75, focus === "hybrid" ? 0.5 : 0.85);
      assertNear(endpoint.pathScore, candidate.specialized.pathScore, `${focus}/${candidate.id}/B3 path`, 1e-10);
      assertNear(endpoint.endScore, candidate.specialized.endScore, `${focus}/${candidate.id}/B3 end`, 1e-10);
      if (focus !== "hybrid") {
        const middle = rescore(candidate, focus, 0.50, 0.775);
        assertNear(middle.pathDamage, (candidate.baseline.pathDamage + candidate.specialized.pathDamage) / 2, `${focus}/${candidate.id}/midpoint path damage`, 1e-10);
        assertNear(middle.endDamage, (candidate.baseline.endDamage + candidate.specialized.endDamage) / 2, `${focus}/${candidate.id}/midpoint end damage`, 1e-10);
      }
    }

    const grid = [];
    for (const damageWeight of DAMAGE_WEIGHTS) {
      const specs = focus === "hybrid" ? [0.5] : SPECIALIZATIONS;
      for (const specialization of specs) {
        grid.push(evaluateConfig(
          pool,
          focus,
          damageWeight,
          specialization,
          baselineRelations,
          baselineLayers[0],
          abCase
        ));
      }
    }

    cases.push({
      focus,
      referenceVersion: isolation.cases.find((entry) => entry.focus === focus)?.referenceVersion ?? null,
      candidateCount: pool.size,
      fixedCandidateIds: [...pool.keys()].sort(),
      priorIsolationCandidateIds: isolation.cases.find((entry) => entry.focus === focus)?.candidates.map((entry) => entry.id).sort() || [],
      priorControlledUnionCandidateIds: abCase.crossScoredUnion.records.map((entry) => entry.id).sort(),
      baseline: {
        config: configFor(focus, 0.50, focus === "hybrid" ? 0.5 : 0.70),
        paretoFront: baselineLayers[0],
        paretoLayers: baselineLayers,
        candidates: baselineEntries
      },
      grid,
      transitionTable: summarizeTransitions(grid, focus)
    });
  }

  const result = {
    schemaVersion: "optimizer-carry-objective-calibration-v1",
    experiment: "carry-objective-fixed-candidate-calibration-grid",
    sourceCommit: process.env.GITHUB_SHA || "unknown",
    generatedAt: new Date().toISOString(),
    productionChanged: false,
    uiChanged: false,
    searchExecuted: false,
    evaluatorChanged: false,
    referenceChanged: false,
    sourceArtifacts: {
      isolation: "benchmarks/optimizer-v1/experiments/carry-objective-isolation/results.json",
      carryAB: "benchmarks/optimizer-v1/experiments/carry-objective-ab/results.json"
    },
    thresholdVerification: isolation.thresholdVerification,
    method: "Fixed-candidate cross-rescoring. Uses the union of the prior legal isolation paths and the prior controlled A/B cross-scored Stage-2 paths. 70/30 and 85/15 damage components are saved endpoint measurements; 77.5/22.5 is their exact linear midpoint because the objective combines normalized Bullet/Spirit components linearly. Damage/Survival weighting is then recombined exactly. No search or path mutation occurs.",
    baselineOutsideGrid: {
      damage: 0.50,
      survival: 0.50,
      weapon: { bullet: 0.70, spirit: 0.30 },
      spirit: { bullet: 0.30, spirit: 0.70 },
      hybrid: { bullet: 0.50, spirit: 0.50 }
    },
    raster: {
      damageSurvival: DAMAGE_WEIGHTS.map((damage) => ({ damage, survival: 1 - damage })),
      specialization: SPECIALIZATIONS,
      hybrid: { bullet: 0.50, spirit: 0.50 }
    },
    unchanged: [
      "fixed legal purchase paths",
      "frozen baseline-v0 reference",
      "Path-AUC definition",
      "Endbuild as separate Pareto objective",
      "Search, Beam Width and runtime budget",
      "Pareto retention and Lazy Pareto",
      "Dedupe and diversity",
      "Save-to-40k and terminalization",
      "Evaluator",
      "canonical items and threshold data",
      "damage metrics including known duplicate 10s metrics",
      "churn semantics"
    ],
    cases
  };

  const target = outputPath();
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({
    status: "COMPLETE",
    output: target,
    searchExecuted: false,
    thresholdVerification: result.thresholdVerification,
    cases: cases.map((entry) => ({
      focus: entry.focus,
      candidateCount: entry.candidateCount,
      baselineFront: entry.baseline.paretoFront,
      transitions: entry.transitionTable
    }))
  }));
}

try {
  main();
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
}

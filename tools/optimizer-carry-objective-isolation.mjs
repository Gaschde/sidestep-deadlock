import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathEndDominates } from "../app/path-end-pareto.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const SOURCE_FILE = resolve(ROOT, "benchmarks/optimizer-v1/experiments/carry-objective-ab/results.json");
const DEFAULT_OUTPUT = resolve(ROOT, "artifacts/carry-objective-isolation/results.json");

const CONFIGS = Object.freeze({
  A: Object.freeze({
    id: "A-current-baseline",
    damageWeight: 0.5,
    survivalWeight: 0.5,
    damageProfile: "baseline-70-30"
  }),
  B1: Object.freeze({
    id: "B1-damage-primary-only",
    damageWeight: 0.75,
    survivalWeight: 0.25,
    damageProfile: "baseline-70-30"
  }),
  B2: Object.freeze({
    id: "B2-specialization-only",
    damageWeight: 0.5,
    survivalWeight: 0.5,
    damageProfile: "specialized-85-15"
  }),
  B3: Object.freeze({
    id: "B3-both",
    damageWeight: 0.75,
    survivalWeight: 0.25,
    damageProfile: "specialized-85-15"
  })
});

function outputPath() {
  const args = process.argv.slice(2);
  const index = args.indexOf("--output");
  return resolve(index >= 0 ? args[index + 1] : DEFAULT_OUTPUT);
}

function assertNear(actual, expected, label, epsilon = 1e-12) {
  if (!Number.isFinite(actual) || !Number.isFinite(expected) || Math.abs(actual - expected) > epsilon) {
    throw new Error(`${label}: ${actual} != ${expected}`);
  }
}

function score(damage, survival, config) {
  return config.damageWeight * damage + config.survivalWeight * survival;
}

function damageRows(candidate, profile) {
  const source = profile === "baseline-70-30" ? candidate.A : candidate.B;
  return {
    pathDamage: source.pathDamage,
    endDamage: source.endDamage
  };
}

function rescore(candidate, configKey) {
  const config = CONFIGS[configKey];
  const damage = damageRows(candidate, config.damageProfile);
  return {
    pathScore: score(damage.pathDamage, candidate.A.pathSurvivability, config),
    endScore: score(damage.endDamage, candidate.A.endSurvivability, config),
    pathDamage: damage.pathDamage,
    endDamage: damage.endDamage,
    pathSurvivability: candidate.A.pathSurvivability,
    endSurvivability: candidate.A.endSurvivability
  };
}

function validateStoredCandidate(candidate, focus) {
  assertNear(candidate.A.pathSurvivability, candidate.B.pathSurvivability, `${focus}/${candidate.id}/path survival invariant`);
  assertNear(candidate.A.endSurvivability, candidate.B.endSurvivability, `${focus}/${candidate.id}/end survival invariant`);
  const reconstructedA = rescore(candidate, "A");
  const reconstructedB3 = rescore(candidate, "B3");
  assertNear(reconstructedA.pathScore, candidate.A.pathScore, `${focus}/${candidate.id}/A path`);
  assertNear(reconstructedA.endScore, candidate.A.endScore, `${focus}/${candidate.id}/A end`);
  assertNear(reconstructedB3.pathScore, candidate.B.pathScore, `${focus}/${candidate.id}/B3 path`);
  assertNear(reconstructedB3.endScore, candidate.B.endScore, `${focus}/${candidate.id}/B3 end`);
}

function paretoLayers(candidates, configKey) {
  const remaining = [...candidates];
  const layers = [];
  while (remaining.length) {
    const front = remaining.filter((candidate, index) =>
      !remaining.some((other, otherIndex) =>
        otherIndex !== index && pathEndDominates(other.scores[configKey], candidate.scores[configKey])
      )
    );
    if (!front.length) throw new Error("Pareto layering made no progress.");
    layers.push(front.map((entry) => entry.id).sort());
    const ids = new Set(front.map((entry) => entry.id));
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      if (ids.has(remaining[index].id)) remaining.splice(index, 1);
    }
  }
  return layers;
}

function pairwiseRelations(candidates, configKey) {
  const relations = [];
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      const a = candidates[left];
      const b = candidates[right];
      const aDominates = pathEndDominates(a.scores[configKey], b.scores[configKey]);
      const bDominates = pathEndDominates(b.scores[configKey], a.scores[configKey]);
      relations.push({
        a: a.id,
        b: b.id,
        relation: aDominates ? "a-dominates" : bDominates ? "b-dominates" : "tradeoff-or-equal"
      });
    }
  }
  return relations;
}

function relationChanges(candidates, from, to) {
  const before = pairwiseRelations(candidates, from);
  const after = pairwiseRelations(candidates, to);
  return before.map((entry, index) => ({
    a: entry.a,
    b: entry.b,
    from: entry.relation,
    to: after[index].relation
  })).filter((entry) => entry.from !== entry.to);
}

function vectorDelta(left, right) {
  return {
    pathScore: left.pathScore - right.pathScore,
    endScore: left.endScore - right.endScore
  };
}

function marginalForCandidate(candidate) {
  const s = candidate.scores;
  return {
    damagePrimaryAtBaselineFocus_A_to_B1: vectorDelta(s.B1, s.A),
    damagePrimaryAtSpecializedFocus_B2_to_B3: vectorDelta(s.B3, s.B2),
    specializationAtBalancedUtility_A_to_B2: vectorDelta(s.B2, s.A),
    specializationAtDamagePrimaryUtility_B1_to_B3: vectorDelta(s.B3, s.B1),
    interaction_B3_minus_B2_minus_B1_plus_A: {
      pathScore: s.B3.pathScore - s.B2.pathScore - s.B1.pathScore + s.A.pathScore,
      endScore: s.B3.endScore - s.B2.endScore - s.B1.endScore + s.A.endScore
    }
  };
}

function configContract(label, damage, survival, weaponBullet, weaponSpirit, spiritBullet, spiritSpirit) {
  return {
    label,
    damageSurvival: { damage, survival },
    focus: {
      weapon: { bullet: weaponBullet, spirit: weaponSpirit },
      spirit: { bullet: spiritBullet, spirit: spiritSpirit },
      hybrid: { bullet: 0.5, spirit: 0.5 }
    },
    effective: {
      weapon: { bullet: damage * weaponBullet, spirit: damage * weaponSpirit, survival },
      spirit: { bullet: damage * spiritBullet, spirit: damage * spiritSpirit, survival },
      hybrid: { bullet: damage * 0.5, spirit: damage * 0.5, survival }
    }
  };
}

function verifyThresholds(source) {
  const violations = [];
  let checkedCandidates = 0;
  let checkedCategoryThresholds = 0;
  for (const caseResult of source.stage2?.cases || []) {
    for (const label of ["A", "B"]) {
      for (const candidate of caseResult[label]?.front || []) {
        checkedCandidates += 1;
        for (const category of ["weapon", "vitality", "spirit"]) {
          if (Number(candidate.investments?.[category]) < 4800) continue;
          checkedCategoryThresholds += 1;
          if (candidate.thresholds4800?.[category]?.souls == null) {
            violations.push({
              focus: caseResult.focus,
              objective: label,
              id: candidate.id,
              category,
              investment: candidate.investments?.[category] ?? null
            });
          }
        }
      }
    }
  }
  return {
    sourceCommit: source.sourceCommit,
    stage2Executed: source.stage2?.executed === true,
    checkedCandidates,
    checkedCategoryThresholds,
    violations,
    valid: source.stage2?.executed === true && checkedCandidates > 0 && violations.length === 0
  };
}

function main() {
  const source = JSON.parse(readFileSync(SOURCE_FILE, "utf8"));
  const thresholdVerification = verifyThresholds(source);
  if (!thresholdVerification.valid) {
    throw new Error("Previous Stage-2 threshold verification is incomplete or invalid.");
  }

  const cases = source.stage1.cases.map((caseResult) => {
    const candidates = caseResult.candidates.map((candidate) => {
      validateStoredCandidate(candidate, caseResult.focus);
      const scores = Object.fromEntries(Object.keys(CONFIGS).map((key) => [key, rescore(candidate, key)]));
      return {
        id: candidate.id,
        source: candidate.source,
        inventory: candidate.inventory,
        investments: candidate.investments,
        thresholds4800: candidate.thresholds4800,
        transactions: candidate.transactions,
        reacquisitions: candidate.reacquisitions,
        scores,
        marginal: null
      };
    });
    for (const candidate of candidates) candidate.marginal = marginalForCandidate(candidate);

    const paretoLayersByConfig = Object.fromEntries(
      Object.keys(CONFIGS).map((key) => [key, paretoLayers(candidates, key)])
    );
    return {
      caseId: caseResult.caseId,
      focus: caseResult.focus,
      candidateCount: candidates.length,
      candidateIdsHash: caseResult.candidateIdsHash,
      referenceVersion: caseResult.referenceVersion,
      pathInvariantAcrossConfigs: true,
      paretoLayers: paretoLayersByConfig,
      marginalDominanceChanges: {
        damagePrimary_A_to_B1: relationChanges(candidates, "A", "B1"),
        damagePrimary_B2_to_B3: relationChanges(candidates, "B2", "B3"),
        specialization_A_to_B2: relationChanges(candidates, "A", "B2"),
        specialization_B1_to_B3: relationChanges(candidates, "B1", "B3")
      },
      candidates
    };
  });

  const result = {
    schemaVersion: "optimizer-carry-objective-isolation-v1",
    experiment: "carry-objective-2x2-fixed-candidate-isolation",
    sourceCommit: process.env.GITHUB_SHA || "unknown",
    sourceArtifact: "benchmarks/optimizer-v1/experiments/carry-objective-ab/results.json",
    sourceArtifactCommit: source.sourceCommit,
    generatedAt: new Date().toISOString(),
    productionChanged: false,
    uiChanged: false,
    searchExecuted: false,
    evaluatorRerun: false,
    method: "Exact algebraic rescore of the stored fixed-candidate damage/survival components. A supplies 70/30 damage components, prior B supplies 85/15 damage components; outer 50/50 vs 75/25 weights are recombined exactly. Stored A and B3 scores are revalidated before derivation.",
    thresholdVerification,
    configs: {
      A: configContract("A — current baseline", 0.5, 0.5, 0.7, 0.3, 0.3, 0.7),
      B1: configContract("B1 — damage-primary only", 0.75, 0.25, 0.7, 0.3, 0.3, 0.7),
      B2: configContract("B2 — specialization only", 0.5, 0.5, 0.85, 0.15, 0.15, 0.85),
      B3: configContract("B3 — both", 0.75, 0.25, 0.85, 0.15, 0.15, 0.85)
    },
    unchanged: [
      "fixed candidates and purchase paths",
      "frozen reference and normalization",
      "Path-AUC definition",
      "Endbuild as separate Pareto objective",
      "Search and Beam Width",
      "Pareto retention, dedupe and diversity",
      "Terminalization and Save-to-40k",
      "Evaluator and canonical item/threshold data",
      "Damage metric set including known duplicate 10s rows"
    ],
    cases
  };

  const target = outputPath();
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({
    status: "COMPLETE",
    output: target,
    thresholdVerification: result.thresholdVerification,
    cases: result.cases.map((entry) => ({
      focus: entry.focus,
      candidates: entry.candidateCount,
      paretoLayers: entry.paretoLayers
    }))
  }));
}

try {
  main();
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
}

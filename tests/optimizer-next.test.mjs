import test from "node:test";
import assert from "node:assert/strict";
import { applyOpponentResistances, normalizeOpponentScenario, NEUTRAL_OPPONENT_SCENARIO } from "../app/search-scenarios.mjs";
import { normalizeMilestones, milestoneSnapshots } from "../app/search-milestones.mjs";
import { paretoDominates, paretoFront } from "../app/pareto.mjs";

test("Opponent scenario defaults are neutral and preserve negative resistance amplification", () => {
  assert.deepEqual(NEUTRAL_OPPONENT_SCENARIO, { opponentBulletResist: 0, opponentSpiritResist: 0 });
  assert.deepEqual(normalizeOpponentScenario({ opponentBulletResist: 25, opponentSpiritResist: -30 }), {
    opponentBulletResist: 25, opponentSpiritResist: -30, bulletDamageMultiplier: 0.75, spiritDamageMultiplier: 1.3
  });
  assert.deepEqual(applyOpponentResistances({ bulletDamage: 100, spiritDamage: 50 }, { opponentBulletResist: 25, opponentSpiritResist: 20 }), {
    bullet: 75, spirit: 40, total: 115,
    scenario: { opponentBulletResist: 25, opponentSpiritResist: 20, bulletDamageMultiplier: 0.75, spiritDamageMultiplier: 0.8 }
  });
  assert.throws(() => normalizeOpponentScenario({ opponentSpiritResist: 100.1 }), /100%/);
});

test("Milestones have no invented phase defaults and capture the committed path state", () => {
  assert.deepEqual(normalizeMilestones(undefined, 40000), [40000]);
  assert.deepEqual(normalizeMilestones([20000, 10000, 20000], 40000), [10000, 20000, 40000]);
  const snapshots = milestoneSnapshots([
    { earnedSouls: 0, metrics: { value: 0 } },
    { earnedSouls: 8000, metrics: { value: 1 } },
    { earnedSouls: 12000, metrics: { value: 2 } },
    { earnedSouls: 40000, metrics: { value: 3 } }
  ], [10000, 20000], 40000);
  assert.deepEqual(snapshots.map((entry) => [entry.earnedSouls, entry.sourceEarnedSouls, entry.metrics.value]), [
    [10000, 8000, 1], [20000, 12000, 2], [40000, 40000, 3]
  ]);
});

test("Two-dimensional Pareto representation preserves Damage/EHP trade-offs", () => {
  const entries = [
    { id: "damage", damage: 10, survivability: 4 },
    { id: "tank", damage: 4, survivability: 10 },
    { id: "balanced", damage: 7, survivability: 7 },
    { id: "dominated", damage: 6, survivability: 6 }
  ];
  assert.equal(paretoDominates(entries[2], entries[3]), true);
  assert.deepEqual(paretoFront(entries).map((entry) => entry.id), ["damage", "tank", "balanced"]);
});

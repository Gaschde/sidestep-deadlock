import test from "node:test";
import assert from "node:assert/strict";
import { scoreSoulAxisPath, EXPERIMENTAL_OBJECTIVE_VERSION } from "../app/search-objective-v1.mjs";

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

function reference(axis, value = 100) {
  return { axis, values: axis.map(() => metrics(value)) };
}

const p = (earnedSouls, value, sequence) => ({ earnedSouls, sequence, metrics: metrics(value) });

test("Objective V1A rewards a stronger path when the terminal build is identical", () => {
  const ref = reference([0, 400, 800]);
  const early = scoreSoulAxisPath([p(0, 0), p(400, 100), p(800, 100)], ref, [800], 800, "hybrid");
  const late = scoreSoulAxisPath([p(0, 0), p(800, 100)], ref, [800], 800, "hybrid");
  assert.equal(early.endScore, late.endScore);
  assert.ok(early.pathScore > late.pathScore);
  assert.ok(early.score > late.score);
  assert.equal(early.policy.version, EXPERIMENTAL_OBJECTIVE_VERSION);
});

test("Objective V1A keeps terminal quality separate from the path integral", () => {
  const ref = reference([0, 400, 800]);
  const strongEnd = scoreSoulAxisPath([p(0, 0), p(400, 100), p(800, 100)], ref, [800], 800, "hybrid");
  const weakEnd = scoreSoulAxisPath([p(0, 0), p(400, 100), p(800, 10)], ref, [800], 800, "hybrid");
  assert.equal(strongEnd.pathScore, weakEnd.pathScore, "the endpoint has zero integration width");
  assert.ok(strongEnd.endScore > weakEnd.endScore);
  assert.ok(strongEnd.score > weakEnd.score, "geometric aggregation must penalize the weak endbuild");
});

test("same-Soul intermediate shop states have zero width and only the committed state survives", () => {
  const ref = reference([0, 400, 800]);
  const clean = scoreSoulAxisPath([p(0, 0), p(400, 100), p(800, 100)], ref, [800], 800, "weapon");
  const noisy = scoreSoulAxisPath([
    p(0, 0, 0),
    p(400, 100, 1),
    p(400, 10, 2),
    p(400, 100, 3),
    p(800, 100, 4)
  ], ref, [800], 800, "weapon");
  assert.equal(noisy.pathScore, clean.pathScore);
  assert.equal(noisy.endScore, clean.endScore);
  assert.equal(noisy.score, clean.score);
});

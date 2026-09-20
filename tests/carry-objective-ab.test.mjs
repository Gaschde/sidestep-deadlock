import test from "node:test";
import assert from "node:assert/strict";
import {
  CARRY_OBJECTIVE_BASELINE_A,
  CARRY_OBJECTIVE_DAMAGE_PRIMARY_B,
  measureSoulAxisPath
} from "../app/search-objective-v1.mjs";

function metrics({ bullet = 0, spirit = 0, survival = 0 } = {}) {
  return {
    sustainedWeaponDps: bullet + spirit,
    laneTradeWindowDps: bullet + spirit,
    farmWindowDps: bullet + spirit,
    skirmishWindowDps: bullet + spirit,
    teamfightWindowDps: bullet + spirit,
    sustainedBulletDps: bullet,
    sustainedSpiritDps: spirit,
    laneTradeBulletDps: bullet,
    laneTradeSpiritDps: spirit,
    farmBulletDps: bullet,
    farmSpiritDps: spirit,
    skirmishBulletDps: bullet,
    skirmishSpiritDps: spirit,
    teamfightBulletDps: bullet,
    teamfightSpiritDps: spirit,
    bulletEhp: survival,
    spiritEhp: survival
  };
}

const reference = {
  axis: [0, 100],
  values: [metrics({ bullet: 100, spirit: 100, survival: 100 }), metrics({ bullet: 100, spirit: 100, survival: 100 })]
};

function measure(actual, focus, config) {
  return measureSoulAxisPath(
    [{ earnedSouls: 0, metrics: actual }, { earnedSouls: 100, metrics: actual }],
    reference,
    [],
    100,
    focus,
    null,
    config
  );
}

test("carry objective A remains exactly the default Path/End measurement contract", () => {
  const actual = metrics({ bullet: 80, spirit: 40, survival: 60 });
  for (const focus of ["weapon", "spirit", "hybrid"]) {
    const implicit = measureSoulAxisPath(
      [{ earnedSouls: 0, metrics: actual }, { earnedSouls: 100, metrics: actual }],
      reference,
      [],
      100,
      focus
    );
    const explicit = measure(actual, focus, CARRY_OBJECTIVE_BASELINE_A);
    assert.deepEqual(explicit, implicit, focus);
    assert.deepEqual(explicit.policy.damageSurvivabilityWeights, { damage: 0.5, survivability: 0.5 });
  }
});

test("carry objective B exposes the requested 75/25 and 85/15, 15/85, 50/50 contracts", () => {
  const expected = {
    weapon: { bullet: 0.85, spirit: 0.15 },
    spirit: { bullet: 0.15, spirit: 0.85 },
    hybrid: { bullet: 0.5, spirit: 0.5 }
  };
  for (const focus of Object.keys(expected)) {
    const measured = measure(metrics({ bullet: 50, spirit: 50, survival: 50 }), focus, CARRY_OBJECTIVE_DAMAGE_PRIMARY_B);
    assert.equal(measured.policy.objectiveConfigId, "carry-damage-primary-b-75-25");
    assert.deepEqual(measured.policy.damageSurvivabilityWeights, { damage: 0.75, survivability: 0.25 });
    assert.deepEqual(measured.policy.damageFocusWeights, expected[focus]);
  }
});

test("damage-primary B increases damage leverage and reduces pure-survival leverage without changing component metrics", () => {
  const weaponDamage = metrics({ bullet: 100, spirit: 0, survival: 0 });
  const survivalOnly = metrics({ bullet: 0, spirit: 0, survival: 100 });

  const aDamage = measure(weaponDamage, "weapon", CARRY_OBJECTIVE_BASELINE_A);
  const bDamage = measure(weaponDamage, "weapon", CARRY_OBJECTIVE_DAMAGE_PRIMARY_B);
  assert.equal(aDamage.pathDamage, bDamage.pathDamage);
  assert.equal(aDamage.pathSurvivability, bDamage.pathSurvivability);
  assert.ok(bDamage.pathScore > aDamage.pathScore);

  const aSurvival = measure(survivalOnly, "weapon", CARRY_OBJECTIVE_BASELINE_A);
  const bSurvival = measure(survivalOnly, "weapon", CARRY_OBJECTIVE_DAMAGE_PRIMARY_B);
  assert.equal(aSurvival.pathDamage, bSurvival.pathDamage);
  assert.equal(aSurvival.pathSurvivability, bSurvival.pathSurvivability);
  assert.ok(bSurvival.pathScore < aSurvival.pathScore);
});

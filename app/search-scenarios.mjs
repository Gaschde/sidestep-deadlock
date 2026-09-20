export const NEUTRAL_OPPONENT_SCENARIO = Object.freeze({
  opponentBulletResist: 0,
  opponentSpiritResist: 0
});

function normalizedResistance(value, name) {
  const numeric = value === undefined || value === null || value === "" ? 0 : Number(value);
  if (!Number.isFinite(numeric)) throw new TypeError(`${name} muss eine endliche Zahl sein.`);
  if (numeric > 100) throw new RangeError(`${name} darf 100% nicht überschreiten.`);
  return numeric;
}

export function normalizeOpponentScenario(input = {}) {
  const opponentBulletResist = normalizedResistance(input.opponentBulletResist, "opponentBulletResist");
  const opponentSpiritResist = normalizedResistance(input.opponentSpiritResist, "opponentSpiritResist");
  return Object.freeze({
    opponentBulletResist,
    opponentSpiritResist,
    bulletDamageMultiplier: 1 - opponentBulletResist / 100,
    spiritDamageMultiplier: 1 - opponentSpiritResist / 100
  });
}

export function applyOpponentResistances({ bulletDamage = 0, spiritDamage = 0 }, input = {}) {
  const scenario = normalizeOpponentScenario(input);
  if (![bulletDamage, spiritDamage].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new TypeError("Ausgehender Bullet- und Spirit-Schaden muss endlich und nichtnegativ sein.");
  }
  const bullet = bulletDamage * scenario.bulletDamageMultiplier;
  const spirit = spiritDamage * scenario.spiritDamageMultiplier;
  return { bullet, spirit, total: bullet + spirit, scenario };
}

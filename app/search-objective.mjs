import { normalizeMilestones, milestoneSnapshots } from "./search-milestones.mjs";

export const SEARCH_OBJECTIVE_VERSION = "baseline-v0";

export const SEARCH_METRIC_GROUPS = Object.freeze({
  damage: Object.freeze({
    metrics: Object.freeze(["sustainedWeaponDps", "laneTradeWindowDps", "farmWindowDps", "skirmishWindowDps", "teamfightWindowDps"]),
    weight: 0.5
  }),
  survival: Object.freeze({
    metrics: Object.freeze(["bulletEhp", "spiritEhp"]),
    weight: 0.5
  })
});

export const DAMAGE_FOCUS_WEIGHTS = Object.freeze({
  weapon: Object.freeze({ bullet: 0.7, spirit: 0.3 }),
  spirit: Object.freeze({ bullet: 0.3, spirit: 0.7 }),
  hybrid: Object.freeze({ bullet: 0.5, spirit: 0.5 })
});

export const DAMAGE_COMPONENTS = Object.freeze({
  sustainedWeaponDps: Object.freeze({ bullet: "sustainedBulletDps", spirit: "sustainedSpiritDps" }),
  laneTradeWindowDps: Object.freeze({ bullet: "laneTradeBulletDps", spirit: "laneTradeSpiritDps" }),
  farmWindowDps: Object.freeze({ bullet: "farmBulletDps", spirit: "farmSpiritDps" }),
  skirmishWindowDps: Object.freeze({ bullet: "skirmishBulletDps", spirit: "skirmishSpiritDps" }),
  teamfightWindowDps: Object.freeze({ bullet: "teamfightBulletDps", spirit: "teamfightSpiritDps" })
});

const COMPONENT_PARENT = new Map(Object.entries(DAMAGE_COMPONENTS).flatMap(([metric, parts]) => [
  [parts.bullet, metric],
  [parts.spirit, metric]
]));

export const COMPONENT_METRICS = Object.freeze(
  Object.values(DAMAGE_COMPONENTS).flatMap((parts) => [parts.bullet, parts.spirit])
);

export function metricValue(values, metric) {
  if (Number.isFinite(values?.[metric])) return values[metric];
  const parent = COMPONENT_PARENT.get(metric);
  return parent && Number.isFinite(values?.[parent]) ? values[parent] : 0;
}

function normalizedValue(value, reference) {
  return value + reference > 0 ? value / (value + reference) : 0;
}

export function scoreMilestonePath(points, reference, milestones, budget, damageFocus = "hybrid") {
  const checkpoints = normalizeMilestones(milestones, budget);
  if (!reference || !Array.isArray(reference.axis) || reference.axis.length === 0) {
    throw new TypeError("Milestone-Bewertung benötigt eine Referenz.");
  }
  const referenceIndex = new Map(reference.axis.map((souls, index) => [souls, index]));
  const snapshots = milestoneSnapshots(points, checkpoints, budget);
  const weights = DAMAGE_FOCUS_WEIGHTS[damageFocus] || DAMAGE_FOCUS_WEIGHTS.hybrid;
  const rows = snapshots.map((snapshot) => {
    const index = referenceIndex.get(snapshot.earnedSouls);
    if (index === undefined) throw new RangeError(`Milestone ${snapshot.earnedSouls} fehlt auf der Referenzachse.`);
    const ref = reference.values[index];
    const damage = SEARCH_METRIC_GROUPS.damage.metrics.reduce((sum, metric) => {
      const parts = DAMAGE_COMPONENTS[metric];
      const bullet = normalizedValue(metricValue(snapshot.metrics, parts.bullet), metricValue(ref, parts.bullet));
      const spirit = normalizedValue(metricValue(snapshot.metrics, parts.spirit), metricValue(ref, parts.spirit));
      return sum + weights.bullet * bullet + weights.spirit * spirit;
    }, 0) / SEARCH_METRIC_GROUPS.damage.metrics.length;
    const survivability = SEARCH_METRIC_GROUPS.survival.metrics.reduce((sum, metric) =>
      sum + normalizedValue(metricValue(snapshot.metrics, metric), metricValue(ref, metric)), 0
    ) / SEARCH_METRIC_GROUPS.survival.metrics.length;
    return { ...snapshot, damage, survivability, score: 0.5 * damage + 0.5 * survivability };
  });
  const average = (key) => rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
  return {
    score: average("score"),
    damage: average("damage"),
    survivability: average("survivability"),
    milestones: rows,
    policy: {
      milestoneWeights: "equal",
      damageSurvivabilityWeights: { damage: 0.5, survivability: 0.5 },
      damageFocus,
      damageFocusWeights: weights,
      normalization: "x/(x+reference)",
      reference: "attainable sampled reference; not an admissible bound"
    }
  };
}

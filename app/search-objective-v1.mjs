import {
  DAMAGE_COMPONENTS,
  DAMAGE_FOCUS_WEIGHTS,
  SEARCH_METRIC_GROUPS,
  metricValue
} from "./search-objective.mjs";

export const EXPERIMENTAL_OBJECTIVE_VERSION = "objective-v1a-soul-auc-terminal-gmean";

function normalizedValue(value, reference) {
  return value + reference > 0 ? value / (value + reference) : 0;
}

function stateQuality(metrics, referenceMetrics, damageFocus) {
  const weights = DAMAGE_FOCUS_WEIGHTS[damageFocus] || DAMAGE_FOCUS_WEIGHTS.hybrid;
  const damage = SEARCH_METRIC_GROUPS.damage.metrics.reduce((sum, metric) => {
    const parts = DAMAGE_COMPONENTS[metric];
    const bullet = normalizedValue(metricValue(metrics, parts.bullet), metricValue(referenceMetrics, parts.bullet));
    const spirit = normalizedValue(metricValue(metrics, parts.spirit), metricValue(referenceMetrics, parts.spirit));
    return sum + weights.bullet * bullet + weights.spirit * spirit;
  }, 0) / SEARCH_METRIC_GROUPS.damage.metrics.length;
  const survivability = SEARCH_METRIC_GROUPS.survival.metrics.reduce((sum, metric) =>
    sum + normalizedValue(metricValue(metrics, metric), metricValue(referenceMetrics, metric)), 0
  ) / SEARCH_METRIC_GROUPS.survival.metrics.length;
  return { damage, survivability, score: 0.5 * damage + 0.5 * survivability };
}

function committedActual(points) {
  if (!Array.isArray(points) || points.length === 0) throw new TypeError("Pfadpunkte fehlen.");
  const ordered = points.map((point, index) => {
    if (!Number.isFinite(point.earnedSouls) || point.earnedSouls < 0 || !point.metrics) {
      throw new TypeError("Pfadpunkte benötigen endliche, nichtnegative Souls und Metriken.");
    }
    return { ...point, order: Number.isFinite(point.sequence) ? point.sequence : index, index };
  }).sort((a, b) => a.earnedSouls - b.earnedSouls || a.order - b.order || a.index - b.index);
  if (ordered[0].earnedSouls > 0) throw new RangeError("Der Pfad muss 0 Souls abdecken.");
  const committed = new Map();
  for (const point of ordered) committed.set(point.earnedSouls, point);
  return [...committed.values()];
}

function referenceRows(reference) {
  if (!reference || !Array.isArray(reference.axis) || !Array.isArray(reference.values) ||
      reference.axis.length === 0 || reference.axis.length !== reference.values.length) {
    throw new TypeError("Soul-Axis-Bewertung benötigt eine vollständige Referenz.");
  }
  const rows = reference.axis.map((earnedSouls, index) => {
    if (!Number.isFinite(earnedSouls) || earnedSouls < 0 || !reference.values[index]) {
      throw new TypeError("Referenzachse ist ungültig.");
    }
    return { earnedSouls, metrics: reference.values[index], index };
  }).sort((a, b) => a.earnedSouls - b.earnedSouls || a.index - b.index);
  if (rows.some((row, index) => index > 0 && row.earnedSouls === rows[index - 1].earnedSouls)) {
    throw new RangeError("Referenzachse darf keine doppelten Soul-Koordinaten enthalten.");
  }
  return rows;
}

function rowAt(rows, souls) {
  let row;
  for (const candidate of rows) {
    if (candidate.earnedSouls > souls) break;
    row = candidate;
  }
  return row;
}

export function scoreSoulAxisPath(points, reference, _milestones, budget, damageFocus = "hybrid") {
  if (!Number.isSafeInteger(budget) || budget <= 0) throw new RangeError("budget muss eine positive ganze Soul-Zahl sein.");
  const actual = committedActual(points);
  const refs = referenceRows(reference);
  if (refs[0].earnedSouls > 0 || refs.at(-1).earnedSouls < budget) {
    throw new RangeError("Referenz muss den vollständigen Soul-Horizont abdecken.");
  }

  // Exact for the currently modelled piecewise-constant economic axis:
  // integrate on the union of reference changes and committed path changes.
  const axis = [...new Set([
    0,
    budget,
    ...actual.map((point) => point.earnedSouls),
    ...refs.map((point) => point.earnedSouls)
  ])].filter((souls) => souls >= 0 && souls <= budget).sort((a, b) => a - b);

  const rows = axis.map((earnedSouls) => {
    const actualRow = rowAt(actual, earnedSouls);
    const referenceRow = rowAt(refs, earnedSouls);
    if (!actualRow || !referenceRow) throw new RangeError("Soul-Achse ist am Auswertungspunkt nicht definiert.");
    const quality = stateQuality(actualRow.metrics, referenceRow.metrics, damageFocus);
    return {
      earnedSouls,
      sourceEarnedSouls: actualRow.earnedSouls,
      ...quality
    };
  });

  let scoreArea = 0;
  let damageArea = 0;
  let survivalArea = 0;
  for (let index = 0; index < rows.length - 1; index += 1) {
    const width = rows[index + 1].earnedSouls - rows[index].earnedSouls;
    scoreArea += width * rows[index].score;
    damageArea += width * rows[index].damage;
    survivalArea += width * rows[index].survivability;
  }

  const pathScore = scoreArea / budget;
  const pathDamage = damageArea / budget;
  const pathSurvivability = survivalArea / budget;
  const end = rows.at(-1);
  const endScore = end.score;
  const endDamage = end.damage;
  const endSurvivability = end.survivability;

  // No 70/30-style coefficient: path and terminal quality are separate,
  // dimensionless quantities on the same normalization and enter symmetrically.
  const score = Math.sqrt(pathScore * endScore);
  const damage = Math.sqrt(pathDamage * endDamage);
  const survivability = Math.sqrt(pathSurvivability * endSurvivability);

  return {
    score,
    damage,
    survivability,
    pathScore,
    endScore,
    pathDamage,
    endDamage,
    pathSurvivability,
    endSurvivability,
    milestones: rows,
    soulAxis: rows,
    policy: {
      version: EXPERIMENTAL_OBJECTIVE_VERSION,
      trajectory: "piecewise-constant integral over earned Souls",
      terminal: "separate horizon utility",
      aggregation: "geometric mean(path utility, terminal utility)",
      damageSurvivabilityWeights: { damage: 0.5, survivability: 0.5 },
      damageFocus,
      damageFocusWeights: DAMAGE_FOCUS_WEIGHTS[damageFocus] || DAMAGE_FOCUS_WEIGHTS.hybrid,
      normalization: "x/(x+reference)",
      reference: "fixed attainable sampled reference; not an admissible bound",
      duplicateDamageMetrics: "preserved from baseline-v0 for isolated A/B"
    }
  };
}

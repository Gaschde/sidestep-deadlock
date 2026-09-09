// Piecewise-constant performance on earned Souls. Immediate shop transactions
// form one zero-width visit; its last state is the committed performance.
function committedPoints(points, metric) {
  if (!Array.isArray(points) || !points.length) throw new TypeError("Snapshots fehlen.");
  const ordered = points.map((point, index) => {
    const value = point.metrics?.[metric];
    if (!Number.isFinite(point.earnedSouls) || point.earnedSouls < 0 ||
        !Number.isFinite(value) || value < 0 ||
        (point.sequence !== undefined && !Number.isFinite(point.sequence))) {
      throw new TypeError("Snapshots benötigen endliche, nichtnegative Souls und Metriken.");
    }
    return { ...point, value, order: point.sequence ?? index, index };
  }).sort((a, b) => a.earnedSouls - b.earnedSouls || a.order - b.order || a.index - b.index);
  const committed = new Map();
  for (const point of ordered) committed.set(point.earnedSouls, point);
  return [...committed.values()];
}

function valueAt(points, souls) {
  let value;
  for (const point of points) {
    if (point.earnedSouls > souls) break;
    value = point.value;
  }
  return value;
}

function regret(actual, reference, direction) {
  if (reference === 0) {
    if (direction === "minimize" && actual > 0) {
      throw new RangeError("Relative Kostenbewertung gegen Nullreferenz ist nicht definiert.");
    }
    return 0;
  }
  return Math.max(0, direction === "minimize"
    ? (actual - reference) / reference
    : (reference - actual) / reference);
}

export function calculateTrajectoryObjectives({ points, references, metric, direction = "maximize", horizon, start = 0 }) {
  if (!["maximize", "minimize"].includes(direction)) throw new TypeError("Ungültige Bewertungsrichtung.");
  if (!Number.isFinite(start) || !Number.isFinite(horizon) || start < 0 || horizon < start) {
    throw new RangeError("Ungültiger Bewertungshorizont.");
  }
  const actualPoints = committedPoints(points, metric);
  const referencePoints = committedPoints(references, metric);
  if (actualPoints[0].earnedSouls > start || referencePoints[0].earnedSouls > start) {
    throw new RangeError("Istwert und Referenz müssen den Start abdecken.");
  }
  const axis = [...new Set([start, horizon, ...actualPoints.map((p) => p.earnedSouls),
    ...referencePoints.map((p) => p.earnedSouls)])]
    .filter((souls) => souls >= start && souls <= horizon).sort((a, b) => a - b);
  const curve = axis.map((earnedSouls) => {
    const actual = valueAt(actualPoints, earnedSouls);
    const reference = valueAt(referencePoints, earnedSouls);
    return { earnedSouls, actual, reference, regret: regret(actual, reference, direction) };
  });
  let integral = 0;
  for (let index = 1; index < curve.length; index += 1) {
    integral += (curve[index].earnedSouls - curve[index - 1].earnedSouls) * curve[index - 1].regret;
  }
  return {
    curve,
    endPerformance: curve.at(-1).actual,
    worstRegret: Math.max(...curve.map((point) => point.regret)),
    // Search labels must not commit the pending endpoint of an open shop visit.
    settledWorstRegret: Math.max(0, ...curve.slice(0, -1).map((point) => point.regret)),
    regretIntegral: integral,
    integratedRegret: horizon > start ? integral / (horizon - start) : 0
  };
}

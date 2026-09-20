export function normalizeMilestones(milestones, budget) {
  if (!Number.isSafeInteger(budget) || budget <= 0) throw new RangeError("budget muss eine positive ganze Soul-Zahl sein.");
  const supplied = milestones === undefined || milestones === null ? [] : milestones;
  if (!Array.isArray(supplied)) throw new TypeError("milestones muss ein Array sein.");
  const values = supplied.map(Number);
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0 || value > budget)) {
    throw new RangeError("Milestones müssen ganzzahlig zwischen 0 und budget liegen.");
  }
  // No invented match-phase defaults: the horizon is the only neutral default.
  return [...new Set([...values, budget])].sort((a, b) => a - b);
}

export function milestoneSnapshots(points, milestones, budget) {
  if (!Array.isArray(points) || !points.length) throw new TypeError("Pfadpunkte fehlen.");
  const checkpoints = normalizeMilestones(milestones, budget);
  const ordered = [...points].sort((a, b) => a.earnedSouls - b.earnedSouls);
  if (!Number.isFinite(ordered[0].earnedSouls) || ordered[0].earnedSouls > 0) {
    throw new RangeError("Der Pfad muss bei 0 Souls beginnen.");
  }
  return checkpoints.map((earnedSouls) => {
    let committed = ordered[0];
    for (const point of ordered) {
      if (!Number.isFinite(point.earnedSouls) || point.earnedSouls < 0) throw new TypeError("Ungültiger Pfadpunkt.");
      if (point.earnedSouls > earnedSouls) break;
      committed = point;
    }
    return { earnedSouls, sourceEarnedSouls: committed.earnedSouls, metrics: committed.metrics };
  });
}

export function paretoDominates(left, right) {
  for (const key of ["damage", "survivability"]) {
    if (!Number.isFinite(left?.[key]) || !Number.isFinite(right?.[key])) {
      throw new TypeError("Pareto-Werte müssen endliche damage-/survivability-Werte besitzen.");
    }
  }
  return left.damage >= right.damage && left.survivability >= right.survivability &&
    (left.damage > right.damage || left.survivability > right.survivability);
}

export function paretoFront(entries, vector = (entry) => entry) {
  if (!Array.isArray(entries)) throw new TypeError("entries muss ein Array sein.");
  return entries.filter((candidate, index) => {
    const candidateVector = vector(candidate);
    return !entries.some((other, otherIndex) =>
      otherIndex !== index && paretoDominates(vector(other), candidateVector)
    );
  });
}

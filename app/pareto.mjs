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
  const front = [];
  for (const candidate of entries) {
    const candidateVector = vector(candidate);
    if (front.some((other) => paretoDominates(vector(other), candidateVector))) continue;
    for (let index = front.length - 1; index >= 0; index--) {
      if (paretoDominates(candidateVector, vector(front[index]))) front.splice(index, 1);
    }
    front.push(candidate);
  }
  return front;
}

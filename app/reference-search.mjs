/**
 * Vollständig enumerierender Referenzkern für kleine synthetische Zustandsgraphen.
 * Der Kern kennt keine Spielregeln: Legalität, State-Key und Label-Dimensionen
 * werden vom aufrufenden Test/Regelmodell geliefert.
 */

function defaultDominates(left, right) {
  const leftValues = left.label;
  const rightValues = right.label;
  let strict = false;
  for (const key of Object.keys(rightValues)) {
    if (leftValues[key] < rightValues[key]) return false;
    if (leftValues[key] > rightValues[key]) strict = true;
  }
  return strict;
}

export function paretoFilter(entries, dominates = defaultDominates) {
  return entries.filter((candidate, index) =>
    !entries.some((other, otherIndex) => otherIndex !== index && dominates(other, candidate))
  );
}

export function enumerateReference({ initialState, expand, stateKey, label, dominates = defaultDominates }) {
  if (typeof expand !== "function" || typeof stateKey !== "function" || typeof label !== "function") {
    throw new TypeError("expand, stateKey und label sind erforderlich.");
  }
  const visited = new Set([stateKey(initialState)]);
  const states = [];
  const queue = [initialState];
  while (queue.length) {
    const state = queue.shift();
    const entry = { state, label: label(state) };
    states.push(entry);
    for (const successor of expand(state) || []) {
      const key = stateKey(successor);
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push(successor);
    }
  }
  const pareto = paretoFilter(states, dominates);
  return { states, pareto };
}

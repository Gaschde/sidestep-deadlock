/**
 * Generischer Multiobjective-Label-Correcting-Kern.
 * Die Domäne liefert Transitionen, vollständigen State-Key, Zukunfts-Key und Label.
 */

function defaultDominates(left, right) {
  let strict = false;
  for (const key of Object.keys(right.label)) {
    if (left.label[key] < right.label[key]) return false;
    if (left.label[key] > right.label[key]) strict = true;
  }
  return strict;
}

export function searchLabels({ initialState, expand, stateKey, futureKey, label, dominates = defaultDominates, onProgress, labelDependsOnlyOnFuture = false }) {
  for (const name of ["expand", "stateKey", "futureKey", "label"]) {
    if (typeof ({ expand, stateKey, futureKey, label })[name] !== "function") {
      throw new TypeError(`${name} ist erforderlich.`);
    }
  }
  const labelsByFutureState = new Map();
  const queue = [];
  const acceptedStateKeys = new Set();
  let prunedLabels = 0;
  let expandedStates = 0;
  let generatedStates = 0;
  let labelKeys;
  const startedAt = performance.now();
  let lastReport = startedAt;
  let expansionMs = 0;
  let labelMs = 0;
  let queueIndex = 0;
  const report = (force = false) => {
    if (!onProgress) return;
    const now = performance.now();
    if (!force && now - lastReport < 1000) return;
    lastReport = now;
    onProgress({ runtimeMs: now - startedAt, generatedStates, expandedStates, prunedLabels,
      futureStates: labelsByFutureState.size, queuedLabels: queue.length - queueIndex,
      expansionMs, labelMs,
      sampledHeapBytes: typeof process !== "undefined" && process.memoryUsage ? process.memoryUsage().heapUsed : null });
  };

  const accept = (state) => {
    generatedStates += 1;
    const key = futureKey(state);
    const labels = labelsByFutureState.get(key) || [];
    // Explicit caller contract, used only by history-free reference searches.
    if (labelDependsOnlyOnFuture && labels.length) return false;
    const fullKey = stateKey(state);
    const labelStarted = onProgress ? performance.now() : 0;
    const candidate = { state, label: label(state) };
    if (onProgress) labelMs += performance.now() - labelStarted;
    const keys = Object.keys(candidate.label).sort();
    if (!keys.length || keys.some((name) => !Number.isFinite(candidate.label[name])) ||
        (labelKeys && JSON.stringify(keys) !== JSON.stringify(labelKeys))) {
      throw new TypeError("Labels müssen dieselben endlichen numerischen Dimensionen besitzen.");
    }
    labelKeys = keys;
    candidate.signature = JSON.stringify(keys.map((name) => candidate.label[name]));
    if (labels.some((other) => other.signature === candidate.signature)) return false;
    if (labels.some((other) => dominates(other, candidate))) {
      prunedLabels += 1;
      return false;
    }
    const survivors = labels.filter((other) => !dominates(candidate, other));
    prunedLabels += labels.length - survivors.length;
    survivors.push(candidate);
    labelsByFutureState.set(key, survivors);
    acceptedStateKeys.add(fullKey);
    queue.push(candidate);
    return true;
  };

  accept(initialState);
  for (let index = 0; index < queue.length; index += 1) {
    queueIndex = index + 1;
    const current = queue[index];
    if (!labelsByFutureState.get(futureKey(current.state))?.includes(current)) continue;
    expandedStates += 1;
    const expansionStarted = onProgress ? performance.now() : 0;
    const successors = expand(current.state) || [];
    if (onProgress) expansionMs += performance.now() - expansionStarted;
    for (const successor of successors) accept(successor);
    report();
  }
  report(true);

  return {
    labels: [...labelsByFutureState.values()].flat(),
    generatedStates,
    expandedStates,
    prunedLabels,
    visitedStates: acceptedStateKeys.size
  };
}

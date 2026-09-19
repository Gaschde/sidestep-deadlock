const TIMER_KEYS = Object.freeze([
  "referenceMs", "beamSearchMs", "terminalAuditMs", "validationMs",
  "transitionMs", "purchaseGenerationMs", "upgradeGenerationMs", "replacementGenerationMs",
  "evaluationMs", "trajectoryScoreMs", "pathReconstructionMs", "continuationLookaheadMs",
  "dedupeMs", "paretoMs", "diversityMs", "sortingMs"
]);

const COUNTER_KEYS = Object.freeze([
  "transitionCalls", "generatedStates", "uniqueStates", "duplicateStates", "evaluatedInventories",
  "metricCacheHits", "metricCacheMisses", "purchaseChecks", "upgradeChecks", "replacementChecks",
  "familyConflictChecks", "continuationLookaheadCalls"
]);

export function createBeamProfiler(enabled = false) {
  const timers = Object.fromEntries(TIMER_KEYS.map((key) => [key, 0]));
  const counters = Object.fromEntries(COUNTER_KEYS.map((key) => [key, 0]));
  const candidatePoolSizes = [];
  const perWidth = [];
  const add = (key, value) => {
    if (!enabled) return;
    if (!Object.hasOwn(timers, key)) throw new Error(`Unknown profiler timer: ${key}`);
    timers[key] += value;
  };
  const count = (key, amount = 1) => {
    if (!enabled) return;
    if (!Object.hasOwn(counters, key)) throw new Error(`Unknown profiler counter: ${key}`);
    counters[key] += amount;
  };
  const time = (key, work) => {
    if (!enabled) return work();
    const started = performance.now();
    try { return work(); } finally { add(key, performance.now() - started); }
  };
  return {
    enabled, add, count, time,
    pushCandidatePool(entry) { if (enabled) candidatePoolSizes.push(entry); },
    pushWidth(entry) { if (enabled) perWidth.push(entry); },
    snapshot(extra = {}) {
      if (!enabled) return undefined;
      return {
        timers: { ...timers },
        counters: { ...counters },
        candidatePoolSizes: [...candidatePoolSizes],
        perWidth: [...perWidth],
        ...extra,
        timerSemantics: {
          phases: "referenceMs, beamSearchMs and terminalAuditMs describe top-level execution regions. validationMs is nested where publication validates a candidate.",
          operations: "Operation timers are diagnostic and may be nested inside phase timers and inside diversityMs. Do not sum phase and operation timers to infer total runtime.",
          generation: "purchaseGenerationMs, upgradeGenerationMs and replacementGenerationMs are nested inside transitionMs.",
          observerEffect: "Profiling does not change ranking, legality or objective code. Under a strict wall-clock deadline its measurement overhead can reduce completed work; compare work counters as well as time."
        }
      };
    }
  };
}

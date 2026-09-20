import { CARRY_METRICS } from "./warden-search.mjs";
import { COMPONENT_METRICS, metricValue } from "./search-objective.mjs";

export const SAMPLED_REFERENCE_METRICS = Object.freeze([...CARRY_METRICS, ...COMPONENT_METRICS]);

export function buildSampledCarryReference({
  axis,
  initialState,
  budget,
  metrics,
  transitions,
  clean = (state) => state,
  deadline = Infinity
}) {
  if (!Array.isArray(axis) || axis.length === 0) throw new TypeError("Reference axis is required.");
  if (!initialState) throw new TypeError("Initial state is required.");
  if (!Number.isSafeInteger(budget) || budget <= 0) throw new RangeError("Reference budget is invalid.");
  if (typeof metrics !== "function" || typeof transitions !== "function" || typeof clean !== "function") {
    throw new TypeError("Reference callbacks are required.");
  }

  const baseline = metrics(initialState);
  const reference = { axis: [...axis], values: axis.map(() => ({ ...baseline })) };

  for (const objective of CARRY_METRICS) {
    let state = { ...initialState, cash: budget, earnedSouls: budget };
    while (performance.now() < deadline) {
      const currentMetrics = metrics(state);
      let best = null;
      let bestValue = metricValue(currentMetrics, objective);
      for (const next of transitions(state)) {
        const type = next.events?.[0]?.type;
        if (!["purchase", "upgrade", "replacement"].includes(type)) continue;
        const values = metrics(next);
        const spent = budget - next.cash;
        const first = axis.findIndex((souls) => souls >= spent);
        if (first >= 0) {
          for (let index = first; index < reference.values.length; index++) {
            for (const metric of SAMPLED_REFERENCE_METRICS) {
              reference.values[index][metric] = Math.max(
                metricValue(reference.values[index], metric),
                metricValue(values, metric)
              );
            }
          }
        }
        const value = metricValue(values, objective);
        if (value > bestValue) {
          best = next;
          bestValue = value;
        }
        if (performance.now() >= deadline) break;
      }
      if (!best) break;
      state = clean(best);
    }
  }

  // Same attainable sampled-envelope semantics as the existing Product Beam:
  // carry values forward monotonically, never claim an upper bound.
  for (let index = 1; index < reference.values.length; index++) {
    for (const metric of SAMPLED_REFERENCE_METRICS) {
      reference.values[index][metric] = Math.max(
        metricValue(reference.values[index - 1], metric),
        metricValue(reference.values[index], metric)
      );
    }
  }

  return reference;
}

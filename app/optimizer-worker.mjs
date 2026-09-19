import { runControlledMultiobjectiveBeamCarry } from "./multiobjective-search.mjs";
import { FAST_SEARCH_BUDGET, PRODUCT_SEARCH_TIME_MS } from "./search-config.mjs";

const CURRENT_MULTI_OBJECTIVE_WIDTH = 4;
const AUDIT_RESERVE_MS = 2000;
const REFERENCE_TIME_MS = 1500;

self.onmessage = (event) => {
  const { data, itemIds } = event.data;
  try {
    self.postMessage({
      type: "started",
      mode: "multiobjective",
      itemCount: itemIds.length,
      budget: FAST_SEARCH_BUDGET,
      timeBudgetMs: PRODUCT_SEARCH_TIME_MS
    });

    const result = runControlledMultiobjectiveBeamCarry({
      data,
      itemIds,
      budget: FAST_SEARCH_BUDGET,
      heroId: event.data.heroId,
      damageFocus: event.data.damageFocus,
      slotUnlocks: [{ earnedSouls: 0, slots: data.slots.item_limit - data.slots.starting_slots.universal }],
      beamWidth: CURRENT_MULTI_OBJECTIVE_WIDTH,
      timeMs: PRODUCT_SEARCH_TIME_MS,
      auditReserveMs: AUDIT_RESERVE_MS,
      referenceTimeMs: REFERENCE_TIME_MS,
      onProgress: (progress) => self.postMessage({ type: "progress", ...progress })
    });

    if (!result.front.length) throw new Error("Kein terminaler Pareto-Build im Rechenbudget gefunden.");
    self.postMessage({ type: "search-complete", backend: "multiobjective", result, telemetry: result.telemetry });
  } catch (error) {
    self.postMessage({ type: "error", message: error?.stack || error?.message || String(error) });
  }
};

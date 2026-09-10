import { runWardenCarryPareto, cachedWardenReference } from "./warden-search.mjs";
import { indexedReferenceStorage } from "./reference-cache.mjs";
import { runAnytimeCarry } from "./anytime-search.mjs";

self.onmessage = async (event) => {
  const { data, itemIds, budget } = event.data;
  try {
    self.postMessage({ type: "started", itemCount: itemIds.length, budget });
    if (event.data.mode === "anytime") {
      const result = runAnytimeCarry({ data, itemIds, budget, heroId: event.data.heroId, damageFocus: event.data.damageFocus, timeMs: 25000, slotUnlocks: [{ earnedSouls: 0, slots: data.slots.item_limit - data.slots.starting_slots.universal }],
        onResult: (result) => self.postMessage({ type: "incumbent", result }),
        onProgress: (progress) => self.postMessage({ type: "progress", ...progress }) });
      if (!result) throw new Error("Kein vollständiger Pfad im Rechenbudget gefunden.");
      self.postMessage({ type: "anytime-complete", telemetry: result.searchTelemetry });
      return;
    }
    const onProgress = (progress) => self.postMessage({ type: "progress", ...progress });
    // Fingerprint the complete current module graph, including evaluator defaults.
    const sources = {};
    const collect = async (url) => {
      if (Object.hasOwn(sources, url)) return;
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error("Cannot fingerprint reference implementation");
      const source = await response.text();
      sources[url] = source;
      for (const match of source.matchAll(/(?:import|export)\s+(?:[^;]*?\s+from\s+)?["'](\.\.?\/[^"']+)["']/g)) await collect(new URL(match[1], url).href);
    };
    await collect(new URL("./warden-search.mjs", import.meta.url).href);
    const referenceResult = await cachedWardenReference({ data, itemIds, budget, storage: indexedReferenceStorage(), sourceIdentity: sources, onProgress });
    const result = runWardenCarryPareto({
      data,
      itemIds,
      budget,
      slotUnlocks: [],
      referenceResult,
      onProgress: (progress) => self.postMessage({ type: "progress", ...progress })
    });
    self.postMessage({ type: "complete", result });
  } catch (error) {
    self.postMessage({ type: "error", message: error?.stack || error?.message || String(error) });
  }
};

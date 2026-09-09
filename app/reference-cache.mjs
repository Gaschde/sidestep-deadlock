// Bump when the reference contract changes. Source identity additionally
// invalidates caches automatically for implementation changes.
export const REFERENCE_MODEL_VERSION = "direct-inventory-reference-v1";
function canonical(value) {
  if (value instanceof Map) return { $map: [...value].map(([k, v]) => [canonical(k), canonical(v)]) };
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint" || typeof value === "number" && !Number.isFinite(value)) throw new Error("Unsupported cache identity value");
  return value;
}
async function digest(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function cachedReference({ identity, storage, compute, axis, metricSet, onStatus }) {
  if (!identity.sourceIdentity) throw new Error("Reference cache requires implementation identity");
  const key = await digest({ model: REFERENCE_MODEL_VERSION, identity, axis, metricSet });
  const valid = (result) => result && metricSet.every((m) => {
    const points = result.byMetric?.[m];
    return points?.length === axis.length && points.every((p, i) => p.earnedSouls === axis[i] && p.kind === "resource" &&
      Number.isFinite(p.metrics?.[m]) && p.metrics[m] >= 0 && (!i || p.metrics[m] >= points[i - 1].metrics[m]));
  }) && Array.isArray(result.unsupportedUpgrades) && result.telemetry;
  let entry;
  try { entry = await storage.get(key); } catch { onStatus?.("unavailable"); }
  let intact = false;
  try { intact = entry?.complete === true && entry.key === key && valid(entry.result) && entry.checksum === await digest(entry.result); } catch { /* Corrupt cache: recompute. */ }
  if (intact) {
    onStatus?.("hit"); return entry.result;
  }
  onStatus?.("miss");
  const result = await compute();
  if (!valid(result)) throw new Error("Incomplete or invalid reference; not cached");
  const complete = { complete: true, key, result, checksum: await digest(result) };
  try { await storage.set(key, complete); onStatus?.("stored"); } catch { onStatus?.("write-failed"); }
  return result;
}

export function indexedReferenceStorage() {
  let connection;
  const open = () => connection ||= new Promise((resolve, reject) => {
    const request = indexedDB.open("sidestep-reference-cache", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("references");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const transaction = async (mode, key, value) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("references", mode);
      const store = tx.objectStore("references");
      const request = mode === "readonly" ? store.get(key) : store.put(value, key);
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };
  return { get: (key) => transaction("readonly", key), set: (key, value) => transaction("readwrite", key, value) };
}

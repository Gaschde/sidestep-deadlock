import { runAnytimeWarden } from "../app/anytime-search.mjs";
// Bounded diagnostic harness, not a search cutoff: watchdog termination always
// reports INCOMPLETE. No incomplete run is labelled a Pareto solution.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { parseCsv } from '../app/lib.mjs';
import { buildOptimizerData } from '../app/optimizer.mjs';
import { runWardenCarryVectorPareto, runWardenCarryPareto, computeWardenReference } from '../app/warden-search.mjs';

if (isMainThread) {
  const [budget = '40000', seconds = '20', mode = 'vector', ...itemIds] = process.argv.slice(2);
  if (![budget, seconds].every((s) => Number.isFinite(Number(s)) && Number(s) > 0) || !['vector', 'separate', 'reference', 'reference-profile', 'anytime'].includes(mode)) throw Error('budget seconds vector|separate|reference|reference-profile [itemIds...]');
  const started = performance.now();
  let latest = null;
  let peakSampledHeapBytes = 0;
  const worker = new Worker(new URL(import.meta.url), { workerData: { budget: Number(budget), seconds: Number(seconds), mode, itemIds } });
  const timer = setTimeout(async () => {
    await worker.terminate();
    console.log(JSON.stringify({ status: 'INCOMPLETE_WATCHDOG', elapsedMs: performance.now() - started, peakSampledHeapBytes, latest }));
  }, Number(seconds) * 1000);
  worker.on('message', (message) => {
    latest = message;
    peakSampledHeapBytes = Math.max(peakSampledHeapBytes, message.telemetry?.sampledHeapBytes || 0);
    console.log(JSON.stringify(message));
    if (message.status === 'COMPLETE' || message.status === 'ERROR') clearTimeout(timer);
  });
  worker.on('error', (error) => { clearTimeout(timer); console.log(JSON.stringify({ status: 'ERROR', message: error.message })); process.exitCode = 1; });
  worker.on('exit', () => clearTimeout(timer));
} else {
  const json = (path) => JSON.parse(readFileSync(new URL('../' + path, import.meta.url), 'utf8'));
  const csv = (path) => parseCsv(readFileSync(new URL('../' + path, import.meta.url), 'utf8'));
  const data = buildOptimizerData({
    coreManifest: json('data/core/manifest.json'), heroManifest: json('data/heroes/manifest.json'),
    items: csv('data/core/items.csv'), itemMechanics: csv('data/core/item_mechanics.csv'),
    upgrades: csv('data/core/item_upgrades.csv'), economy: json('data/core/economy.json'), slots: json('data/core/slots.json'),
    heroStats: csv('data/heroes/hero_stats.csv'), abilities: csv('data/heroes/abilities.csv'),
    abilityMechanics: csv('data/heroes/ability_mechanics.csv')
  });
  try {
    const run = workerData.mode === 'anytime' ? runAnytimeWarden : workerData.mode.startsWith('reference') ? computeWardenReference : workerData.mode === 'vector' ? runWardenCarryVectorPareto : runWardenCarryPareto;
    const itemIds = workerData.itemIds.length ? workerData.itemIds : data.items.map((i) => i.item_id);
    const result = run({ data, budget: workerData.budget, profile: workerData.mode === 'reference-profile' || workerData.mode === 'anytime', itemIds,
      timeMs: workerData.mode === 'anytime' ? Math.min(25000, workerData.seconds * 1000) : undefined,
      slotUnlocks: workerData.mode === 'anytime' ? [{ earnedSouls: 0, slots: data.slots.item_limit - data.slots.starting_slots.universal }] : undefined,
      onResult: (result) => parentPort.postMessage({ status: "BUILD", quality: result.quality, telemetry: result.telemetry, inventory: result.state.inventory, validation: result.validation }),
      onProgress: (progress) => parentPort.postMessage(progress) });
    parentPort.postMessage({ status: 'COMPLETE', paretoCount: result.pareto?.length, referencePoints: result.byMetric?.sustainedWeaponDps?.length, telemetry: result.searchTelemetry || result.telemetry });
  } catch (error) { parentPort.postMessage({ status: 'ERROR', message: error.stack }); }
}

import test from "node:test";
import assert from "node:assert/strict";
import { createBeamProfiler } from "../app/search-telemetry.mjs";
import { measureSoulAxisPath } from "../app/search-objective-v1.mjs";
import { selectPathEndParetoBeam } from "../benchmarks/optimizer-v1/controlled-multiobjective-beam.mjs";

function metrics(value) {
  return {
    sustainedBulletDps: value,
    sustainedSpiritDps: value,
    laneTradeBulletDps: value,
    laneTradeSpiritDps: value,
    farmBulletDps: value,
    farmSpiritDps: value,
    skirmishBulletDps: value,
    skirmishSpiritDps: value,
    teamfightBulletDps: value,
    teamfightSpiritDps: value,
    bulletEhp: value,
    spiritEhp: value
  };
}

test("Path/End profiling leaves measured values unchanged", () => {
  const points = [
    { earnedSouls: 0, metrics: metrics(10) },
    { earnedSouls: 100, metrics: metrics(20) }
  ];
  const reference = {
    axis: [0, 100],
    values: [metrics(20), metrics(40)]
  };
  const plain = measureSoulAxisPath(points, reference, [], 100, "hybrid");
  const profiler = createBeamProfiler(true);
  const profiled = measureSoulAxisPath(points, reference, [], 100, "hybrid", profiler);
  assert.deepEqual(profiled, plain);
  const snapshot = profiler.snapshot();
  assert.ok(snapshot.timers.pathAucScoreMs >= 0);
  assert.ok(snapshot.timers.endbuildScoreMs >= 0);
});

test("Pareto profiling leaves selected beam unchanged", () => {
  const nodes = [
    { serial: "a", vector: { pathScore: 0.7, endScore: 0.4 }, bucket: "a" },
    { serial: "b", vector: { pathScore: 0.5, endScore: 0.6 }, bucket: "b" },
    { serial: "c", vector: { pathScore: 0.4, endScore: 0.3 }, bucket: "c" }
  ];
  const args = [
    nodes,
    2,
    (entry) => entry.vector,
    (entry) => entry.bucket
  ];
  const plain = selectPathEndParetoBeam(...args);
  const profiler = createBeamProfiler(true);
  const profiled = selectPathEndParetoBeam(...args, profiler);
  assert.deepEqual(profiled, plain);
  const snapshot = profiler.snapshot();
  assert.equal(snapshot.counters.paretoCandidates, nodes.length);
  assert.ok(snapshot.timers.frontierMaintenanceMs >= 0);
  assert.ok(snapshot.timers.paretoMs >= 0);
  assert.ok(snapshot.timers.sortingMs >= 0);
});

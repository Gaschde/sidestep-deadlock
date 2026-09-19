import test from "node:test";
import assert from "node:assert/strict";
import {
  dedupeFuturePathHistory,
  pathEndNonDominatedLayers,
  selectPathEndParetoBeam
} from "../benchmarks/optimizer-v1/controlled-multiobjective-beam.mjs";

function node(serial, pathScore, endScore, bucket = "x", transactions = 1) {
  return {
    serial,
    bucket,
    transactions,
    vector: { pathScore, endScore }
  };
}

test("multiobjective layering uses only Path-AUC and Endbuild dominance", () => {
  const entries = [
    { id: "a", pathScore: 0.6, endScore: 0.4 },
    { id: "b", pathScore: 0.5, endScore: 0.5 },
    { id: "c", pathScore: 0.4, endScore: 0.6 },
    { id: "d", pathScore: 0.4, endScore: 0.4 }
  ];
  const layers = pathEndNonDominatedLayers(entries);
  assert.deepEqual(layers[0].map((entry) => entry.id), ["a", "b", "c"]);
  assert.deepEqual(layers[1].map((entry) => entry.id), ["d"]);
});

test("beam retention keeps the full first Pareto front before dominated layers", () => {
  const nodes = [
    node("a", 0.6, 0.4),
    node("b", 0.5, 0.5),
    node("c", 0.4, 0.6),
    node("d", 0.3, 0.3)
  ];
  const result = selectPathEndParetoBeam(nodes, 3, (entry) => entry.vector, (entry) => entry.bucket);
  assert.deepEqual(result.selected.map((entry) => entry.serial).sort(), ["a", "b", "c"]);
  assert.equal(result.metadata.firstFrontFullyRetained, true);
  assert.equal(result.metadata.scalarizationUsed, false);
  assert.equal(result.selected.some((entry) => Object.hasOwn(entry, "score")), false);
});

test("frontier overflow preserves both objective extremes and is deterministic", () => {
  const nodes = [
    node("a", 0.8, 0.2, "weapon"),
    node("b", 0.7, 0.4, "vitality"),
    node("c", 0.5, 0.6, "spirit"),
    node("d", 0.2, 0.8, "other")
  ];
  const run = () => selectPathEndParetoBeam(nodes, 3, (entry) => entry.vector, (entry) => entry.bucket);
  const first = run();
  const second = run();
  const ids = first.selected.map((entry) => entry.serial);
  assert.ok(ids.includes("a"));
  assert.ok(ids.includes("d"));
  assert.deepEqual(second.selected.map((entry) => entry.serial), ids);
  assert.equal(first.metadata.frontierOverflow, true);
  assert.equal(first.metadata.truncatedLayerIndex, 0);
  assert.equal(first.metadata.scalarizationUsed, false);
});

test("future-safe dedupe keeps distinct Path-AUC histories for the same future state", () => {
  const nodes = [
    node("same-a", 0.40, 0.50, "x", 3),
    node("same-b", 0.40, 0.50, "x", 2),
    node("history-diff", 0.41, 0.50, "x", 4)
  ];
  const deduped = dedupeFuturePathHistory(
    nodes,
    () => "same-future",
    (entry) => entry.vector,
    (entry) => entry.transactions
  );
  assert.deepEqual(deduped.map((entry) => entry.serial).sort(), ["history-diff", "same-b"]);
});

test("a dominated partial candidate can remain when capacity reaches a later Pareto layer", () => {
  const nodes = [
    node("front-1", 0.7, 0.5, "a"),
    node("front-2", 0.5, 0.7, "b"),
    node("later-state", 0.4, 0.4, "c")
  ];
  const result = selectPathEndParetoBeam(nodes, 3, (entry) => entry.vector, (entry) => entry.bucket);
  assert.deepEqual(result.selected.map((entry) => entry.serial).sort(), ["front-1", "front-2", "later-state"]);
  assert.deepEqual(result.metadata.layerSizes, [2, 1]);
});

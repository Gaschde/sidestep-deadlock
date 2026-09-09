import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cachedReference } from "../app/reference-cache.mjs";
import { fileReferenceStorage } from "../tools/reference-file-cache.mjs";

test("Reference cache survives storage restart and invalidates content, assumptions and implementation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sidestep-reference-test-"));
  try {
    let computations = 0;
    const statuses = [];
    const options = { axis: [0, 2], metricSet: ["power"],
      identity: { sourceIdentity: "source-v1", data: { patch: "p1", items: new Map([["a", { cost: 2 }]]) },
        hero: "warden", role: "carry", focus: "weapon", assumptions: { slots: 1 }, budget: 2 },
      compute: () => { computations++; return { byMetric: { power: [0, 2].map((earnedSouls) => ({ earnedSouls, kind: "resource", metrics: { power: earnedSouls } })) }, unsupportedUpgrades: [], telemetry: {} }; },
      onStatus: (s) => statuses.push(s) };
    const run = (extra = {}) => cachedReference({ ...options, storage: fileReferenceStorage(directory), ...extra });
    const first = await run();
    assert.deepEqual(await run(), first);
    assert.equal(computations, 1);
    assert.ok(statuses.includes("stored") && statuses.includes("hit"));
    for (const changed of [
      { sourceIdentity: "source-v2" }, { data: { patch: "p1", items: new Map([["a", { cost: 3 }]]) } },
      { assumptions: { slots: 2 } }, { hero: "other" }, { role: "tank" }, { focus: "spirit" }, { budget: 3 }
    ]) await run({ identity: { ...options.identity, ...changed } });
    assert.equal(computations, 8);
    // Corrupted records must never be accepted, even when valid JSON.
    for (const file of await readdir(directory)) await writeFile(join(directory, file), '{"complete":true}', "utf8");
    await run();
    assert.equal(computations, 9);
    await assert.rejects(run({ identity: { ...options.identity, sourceIdentity: "invalid-result" }, compute: () => ({ byMetric: {} }) }), /not cached/);
    await assert.rejects(run({ identity: { ...options.identity, sourceIdentity: "failed-computation" }, compute: () => { throw Error("interrupted"); } }), /interrupted/);
    assert.equal((await readdir(directory)).length, 8);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

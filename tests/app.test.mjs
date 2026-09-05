import test from "node:test";
import assert from "node:assert/strict";
import { createTestBuild, manifestsAreCompatible, parseCsv } from "../app/lib.mjs";

test("parseCsv verarbeitet Kommas und Zeilenumbrüche in Anführungszeichen", () => {
  const rows = parseCsv('id,name,notes\n1,"Alpha, Beta","Zeile 1\nZeile 2"\n');
  assert.deepEqual(rows, [{ id: "1", name: "Alpha, Beta", notes: "Zeile 1\nZeile 2" }]);
});

test("Manifest-Kompatibilität verlangt gleichen Patch und Modus", () => {
  assert.equal(manifestsAreCompatible({ patch: "p1", mode: "standard" }, { patch: "p1", mode: "standard" }), true);
  assert.equal(manifestsAreCompatible({ patch: "p1", mode: "standard" }, { patch: "p2", mode: "standard" }), false);
});

test("Testpfad respektiert Budget, Slots und Upgrade-Zahlung", () => {
  const items = [
    { item_id: "w1", name: "Weapon One", category: "Weapon", tier: "1", total_cost: "800", is_public_shop_item: "true", active_type: "", confidence: "high" },
    { item_id: "v1", name: "Vitality One", category: "Vitality", tier: "1", total_cost: "800", is_public_shop_item: "true", active_type: "", confidence: "high" },
    { item_id: "s1", name: "Spirit One", category: "Spirit", tier: "1", total_cost: "800", is_public_shop_item: "true", active_type: "", confidence: "high" },
    { item_id: "w2", name: "Weapon Two", category: "Weapon", tier: "2", total_cost: "1600", is_public_shop_item: "true", active_type: "", confidence: "high" }
  ];
  const edges = [{ from_item_id: "w1", to_item_id: "w2", additional_cost: "800", notes: "", confidence: "medium" }];
  const build = createTestBuild(items, edges, "weapon", 4000);
  assert.ok(build.spent <= 4000);
  assert.ok(build.inventory.length <= 9);
  assert.ok(build.events.some((event) => event.upgradeFrom?.item_id === "w1" && event.payment === 800));
});

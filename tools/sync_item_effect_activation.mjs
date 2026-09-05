import fs from "node:fs";
import { parseCsv } from "../app/lib.mjs";

const rawItemsPath = "data/api/versions/6684/raw/items.json";
const mechanicsPath = "data/core/item_mechanics.csv";

function stripMarkup(value = "") {
  return String(value)
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceField(row) {
  return /Rohfeld: ([^.]+)\./.exec(row.notes || "")?.[1] || "";
}

function sectionFor(item, field) {
  for (const section of item.tooltip_sections || []) {
    for (const attributes of section.section_attributes || []) {
      const fields = [
        ...(attributes.properties || []),
        ...(attributes.important_properties || []),
        ...(attributes.elevated_properties || [])
      ];
      if (fields.includes(field)) {
        // Some API records omit section_type for their sole proc block. In that
        // case the item's own activation mode still tells us whether the block
        // is a passive proc or a button-triggered active effect.
        const fallbackType = item.activation === "passive" ? "passive" : "active";
        return { type: section.section_type || fallbackType, description: stripMarkup(attributes.loc_string) };
      }
    }
  }
  return null;
}

function quote(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const rawItems = JSON.parse(fs.readFileSync(rawItemsPath, "utf8"));
const itemsById = new Map(rawItems.map((item) => [item.class_name, item]));
const original = fs.readFileSync(mechanicsPath, "utf8");
const headers = original.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0].split(",");
const rows = parseCsv(original);
let changed = 0;

for (const row of rows) {
  const item = itemsById.get(row.item_id);
  const field = sourceField(row);
  if (!item || !field) continue;

  const property = item.properties?.[field] || {};
  const section = sectionFor(item, field);
  const conditionallyApplied = (property.usage_flags || []).includes("ConditionallyApplied");
  let nextTrigger = row.trigger;

  if (section?.type === "innate") nextTrigger = "equipped";
  else if (section?.type === "active") nextTrigger = "item_activation";
  else if (section?.type === "passive" && row.trigger === "equipped") nextTrigger = "passive_item_rule";
  else if (conditionallyApplied && row.trigger === "equipped") nextTrigger = "passive_item_rule";

  if (nextTrigger === row.trigger) continue;
  row.trigger = nextTrigger;
  row.condition = nextTrigger === "equipped"
    ? "Immer, solange das Item ausgerüstet ist."
    : section?.description
    ? `Quellbedingung (englischer Tooltip): ${section.description}`
    : "Item-spezifische Bedingung ist im strukturierten Datensatz nicht als eigenes Feld dokumentiert.";
  changed += 1;
}

const output = [headers.join(","), ...rows.map((row) => headers.map((header) => quote(row[header])).join(",")), ""].join("\n");
fs.writeFileSync(mechanicsPath, output, "utf8");
console.log(`Updated ${changed} effect rows across ${new Set(rows.filter((row) => row.trigger !== "equipped").map((row) => row.item_id)).size} items with non-innate effects.`);

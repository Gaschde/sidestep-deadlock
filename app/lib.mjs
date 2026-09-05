export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (character === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const [headers = [], ...records] = rows;
  return records.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

export function formatSouls(value) {
  return `${new Intl.NumberFormat("de-CH").format(Number(value) || 0)} Souls`;
}

const categoryOrder = {
  weapon: ["Weapon", "Vitality", "Spirit"],
  spirit: ["Spirit", "Vitality", "Weapon"],
  tank: ["Vitality", "Spirit", "Weapon"],
  hybrid: ["Weapon", "Spirit", "Vitality"],
  support: ["Vitality", "Spirit", "Weapon"],
  mobility: ["Vitality", "Weapon", "Spirit"]
};

function sortForStyle(items, style) {
  const order = categoryOrder[style] || categoryOrder.hybrid;
  return [...items].sort((a, b) => {
    const categoryDifference = order.indexOf(a.category) - order.indexOf(b.category);
    return categoryDifference || Number(a.tier) - Number(b.tier) || a.name.localeCompare(b.name, "de");
  });
}

function takeBalanced(items, count, style) {
  const order = categoryOrder[style] || categoryOrder.hybrid;
  const grouped = Object.fromEntries(order.map((category) => [category, sortForStyle(items.filter((item) => item.category === category), style)]));
  const selected = [];
  let cursor = 0;
  while (selected.length < count && Object.values(grouped).some((group) => group.length)) {
    const category = order[cursor % order.length];
    if (grouped[category].length) selected.push(grouped[category].shift());
    cursor += 1;
  }
  return selected;
}

export function createTestBuild(items, upgradeEdges, style = "weapon", maxBudget = 30000) {
  const publicItems = items.filter((item) => item.is_public_shop_item === "true");
  const byId = new Map(publicItems.map((item) => [item.item_id, item]));
  const cleanEdges = upgradeEdges.filter((edge) => !edge.notes?.includes("mehrere Komponenten"));
  const inventory = [];
  const events = [];
  let spent = 0;

  const buy = (item, phase, edge = null) => {
    const payment = edge ? Number(edge.additional_cost) : Number(item.total_cost);
    if (!item || spent + payment > maxBudget) return false;
    if (edge) {
      const index = inventory.findIndex((candidate) => candidate.item_id === edge.from_item_id);
      if (index < 0) return false;
      inventory.splice(index, 1, item);
    } else if (inventory.length < 9) {
      inventory.push(item);
    } else {
      return false;
    }
    spent += payment;
    events.push({
      item,
      phase,
      payment,
      spent,
      upgradeFrom: edge ? byId.get(edge.from_item_id) : null,
      confidence: edge?.confidence || item.confidence
    });
    return true;
  };

  const earlyPool = publicItems.filter((item) => Number(item.tier) === 1 && !item.active_type);
  takeBalanced(earlyPool, 6, style).forEach((item) => buy(item, "early"));

  const attemptUpgrades = (phase, maximumTier, limit) => {
    let upgraded = 0;
    for (const owned of [...inventory]) {
      if (upgraded >= limit) break;
      const candidates = cleanEdges
        .filter((edge) => edge.from_item_id === owned.item_id)
        .map((edge) => ({ edge, item: byId.get(edge.to_item_id) }))
        .filter(({ item }) => item && Number(item.tier) <= maximumTier)
        .sort((a, b) => Number(a.item.tier) - Number(b.item.tier) || a.item.name.localeCompare(b.item.name, "de"));
      if (candidates[0] && buy(candidates[0].item, phase, candidates[0].edge)) upgraded += 1;
    }
  };

  attemptUpgrades("mid", 2, 3);
  const midPool = publicItems.filter((item) => Number(item.tier) === 2 && !inventory.some((owned) => owned.item_id === item.item_id));
  for (const item of takeBalanced(midPool, 6, style)) {
    if (inventory.length >= 9) break;
    buy(item, "mid");
  }

  attemptUpgrades("late", 4, 5);

  return {
    events,
    inventory: [...inventory],
    spent,
    phases: Object.fromEntries(["early", "mid", "late"].map((phase) => [phase, events.filter((event) => event.phase === phase)]))
  };
}

export function manifestsAreCompatible(core, heroes) {
  return Boolean(core && heroes && core.patch === heroes.patch && core.mode === heroes.mode);
}

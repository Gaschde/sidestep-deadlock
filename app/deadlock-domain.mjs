import { enumerateReference } from "./reference-search.mjs";
import { searchLabels } from "./search-core.mjs";

function ancestors(itemId, upgrades, seen = new Set()) {
  for (const edge of upgrades) {
    if (edge.to_item_id !== itemId || seen.has(edge.from_item_id)) continue;
    seen.add(edge.from_item_id);
    ancestors(edge.from_item_id, upgrades, seen);
  }
  return seen;
}

export function createDeadlockDomain({ data, itemIds, soulAxis, budget = 60000, slotUnlocks = [], metrics, label, recordHistory = true }) {
  if (!data?.itemsById || !data?.upgrades) throw new TypeError("Kanonische Optimizer-Daten sind erforderlich.");
  if (!Number.isSafeInteger(budget) || budget < 0) throw new RangeError("budget muss eine nichtnegative ganze Soul-Zahl sein.");
  // Explicit model: purchases are possible at every integer earned-Soul value.
  // This is exhaustive, not an affordability-threshold reduction. Sparse axes
  // remain available solely as explicitly restricted synthetic scenarios.
  const axis = soulAxis === undefined ? null : [...new Set(soulAxis)].sort((a, b) => a - b);
  if (axis && (!axis.length || axis[0] !== 0 || axis.at(-1) !== budget ||
      axis.some((souls) => !Number.isSafeInteger(souls) || souls < 0))) {
    throw new RangeError("soulAxis muss ganzzahlig von 0 bis einschließlich budget reichen.");
  }
  if (slotUnlocks.some((unlock) => !Number.isSafeInteger(unlock.earnedSouls) || unlock.earnedSouls < 0 ||
      unlock.earnedSouls > budget || !Number.isSafeInteger(unlock.slots) || unlock.slots < 0)) {
    throw new RangeError("Ungültige explizite Slotfreischaltung.");
  }
  const items = (itemIds || data.items.map((item) => item.item_id))
    .map((id) => data.itemsById.get(id))
    .filter(Boolean);
  const itemById = new Map(items.map((item) => [item.item_id, item]));
  const candidateUpgrades = data.upgrades.filter((edge) => itemById.has(edge.from_item_id) && itemById.has(edge.to_item_id));
  const sellbackRate = Number(data.economy?.sellback?.rate);
  if (!Number.isFinite(sellbackRate) || sellbackRate < 0 || sellbackRate >= 1 ||
      items.some((item) => !Number.isFinite(Number(item.total_cost)) || Number(item.total_cost) <= 0)) {
    throw new RangeError("Positive Itemkosten und ein belegter Sellback-Satz unter 1 sind erforderlich; volle Rückgaben sind nicht modelliert.");
  }
  const unsupportedUpgrades = [];
  const upgrades = candidateUpgrades.filter((edge) => {
    const payment = Number(edge.additional_cost);
    const difference = Number(itemById.get(edge.to_item_id).total_cost) - Number(itemById.get(edge.from_item_id).total_cost);
    if (!Number.isFinite(payment) || payment <= 0 || payment !== difference || /mehrere Komponenten/i.test(edge.notes || "")) {
      unsupportedUpgrades.push({
        from_item_id: edge.from_item_id,
        to_item_id: edge.to_item_id,
        additional_cost: edge.additional_cost,
        reason: "nicht konservierende oder mehrkomponentige Zahlung",
        notes: edge.notes || ""
      });
      return false;
    }
    return true;
  });
  const activeLimit = Number(data.slots?.active_item_limit ?? 0);
  const baseSlots = Number(data.slots?.starting_slots?.universal ?? 0);
  const initialUnlocks = slotUnlocks.filter((unlock) => unlock.earnedSouls === 0).reduce((sum, unlock) => sum + unlock.slots, 0);
  const initial = { earnedSouls: 0, cash: 0, inventory: [], unlockedSlots: initialUnlocks, events: [], snapshots: [] };
  const metric = metrics || ((state) => ({ power: state.inventory.reduce((sum, id) => sum + Number(itemById.get(id)?.total_cost || 0), 0) }));
  const objectiveLabel = label || metric;
  if (recordHistory) initial.snapshots.push({ earnedSouls: 0, cash: 0, inventory: [], unlockedSlots: initialUnlocks, kind: "resource", metrics: metric(initial) });

  const unlockCount = (earnedSouls) => slotUnlocks.filter((unlock) => earnedSouls >= unlock.earnedSouls).reduce((sum, unlock) => sum + unlock.slots, 0);
  const ancestorSets = new Map(items.map((item) => [item.item_id, ancestors(item.item_id, data.upgrades)]));
  const familyConflict = (state, itemId) => state.inventory.some((ownedId) => ownedId === itemId || ancestorSets.get(itemId).has(ownedId) || ancestorSets.get(ownedId).has(itemId));
  const activeCount = (inventory) => inventory.reduce((sum, id) => sum + Number(Boolean(itemById.get(id)?.active_type)), 0);
  const withEvent = (state, event, earnedSouls, cash, inventory) => {
    // Reference reachability uses only current configuration, never past reward.
    if (!recordHistory) return { earnedSouls, cash, inventory: [...inventory], unlockedSlots: unlockCount(earnedSouls), events: [], snapshots: [] };
    const next = { ...state, earnedSouls, cash, inventory: [...inventory], unlockedSlots: unlockCount(earnedSouls), events: [...state.events, event], snapshots: [...state.snapshots] };
    next.snapshots.push({ earnedSouls, cash, inventory: [...next.inventory], unlockedSlots: next.unlockedSlots, kind: event.type === "save" ? "resource" : "transaction", sequence: next.snapshots.length, metrics: metric(next) });
    return next;
  };

  const transitions = (state) => {
    const successors = [];
    const nextSoul = axis ? axis.find((souls) => souls > state.earnedSouls)
      : state.earnedSouls < budget ? state.earnedSouls + 1 : undefined;
    if (nextSoul !== undefined) successors.push(withEvent(state, { type: "save", earnedSouls: nextSoul }, nextSoul, state.cash + nextSoul - state.earnedSouls, state.inventory));
    for (const item of items) {
      const cost = Number(item.total_cost);
      if (state.cash < cost || state.inventory.length >= baseSlots + state.unlockedSlots || familyConflict(state, item.item_id)) continue;
      const inventory = [...state.inventory, item.item_id];
      if (activeCount(inventory) > activeLimit) continue;
      successors.push(withEvent(state, { type: "purchase", item: item.item_id, payment: cost }, state.earnedSouls, state.cash - cost, inventory));
    }
    for (const edge of upgrades) {
      const index = state.inventory.indexOf(edge.from_item_id);
      const payment = Number(edge.additional_cost);
      if (index < 0 || state.cash < payment || familyConflict({ inventory: state.inventory.filter((_, i) => i !== index) }, edge.to_item_id)) continue;
      const inventory = [...state.inventory];
      inventory.splice(index, 1, edge.to_item_id);
      if (activeCount(inventory) > activeLimit) continue;
      successors.push(withEvent(state, { type: "upgrade", from: edge.from_item_id, item: edge.to_item_id, payment }, state.earnedSouls, state.cash - payment, inventory));
    }
    for (const ownedId of state.inventory) {
      const owned = itemById.get(ownedId);
      if (!owned) continue;
      const proceeds = Number(owned.total_cost) * sellbackRate;
      for (const item of items) {
        const payment = Number(item.total_cost) - proceeds;
        const inventory = state.inventory.map((id) => id === ownedId ? item.item_id : id);
        if (item.item_id === ownedId || state.inventory.includes(item.item_id) || state.cash < payment || activeCount(inventory) > activeLimit || familyConflict({ inventory: state.inventory.filter((id) => id !== ownedId) }, item.item_id)) continue;
        successors.push(withEvent(state, { type: "replacement", from: ownedId, item: item.item_id, payment, saleProceeds: proceeds }, state.earnedSouls, state.cash - payment, inventory));
      }
      successors.push(withEvent(state, { type: "sell", from: ownedId, payment: -proceeds }, state.earnedSouls, state.cash + proceeds, state.inventory.filter((id) => id !== ownedId)));
    }
    return successors;
  };

  const stateKey = (state) => `${state.earnedSouls}:${state.cash}:${state.unlockedSlots}:${[...state.inventory].sort().join("|")}:${state.events.map((event) => `${event.type}:${event.item || ""}:${event.from || ""}:${event.payment}`).join(">")}`;
  const futureKey = (state) => `${state.earnedSouls}:${state.cash}:${state.unlockedSlots}:${[...state.inventory].sort().join("|")}`;
  const resourceEvents = {
    purchaseCosts: [...new Set(items.map((item) => Number(item.total_cost)))].sort((a, b) => a - b),
    upgradePayments: [...new Set(upgrades.map((edge) => Number(edge.additional_cost)))].sort((a, b) => a - b),
    unsupportedUpgrades,
    sellbackProceeds: [...new Set(items.map((item) => Number(item.total_cost) * sellbackRate))].sort((a, b) => a - b),
    replacementPayments: [...new Set(items.flatMap((item) => items.map((target) => Number(target.total_cost) - Number(item.total_cost) * sellbackRate)))].sort((a, b) => a - b),
    earnedSoulsSource: axis ? "explicit_synthetic_axis" : "exhaustive_integer_souls",
    completeWithoutEarnedSoulEvents: axis === null,
    completenessReason: axis
      ? "Explizit eingeschränkte Testachse; keine Vollständigkeit zwischen ihren Punkten."
      : "Modellannahme: Entscheidungen bei jedem ganzzahligen earnedSouls-Wert. Jeder Wert von 0 bis budget und sämtliche Shoptransitionen dort werden angeboten; keine Schwellenreduktion und kein zeitliches Einkommensmodell.",
    performanceWarning: "Die vollständige Ressourcenachse ist keine Zusage für praktikable 60k-Laufzeit oder vollständige Bewertungslabels."
  };
  return {
    initial,
    transitions,
    supportedUpgradesByFrom: new Map(upgrades.reduce((groups, edge) => {
      const entries = groups.get(edge.from_item_id) || [];
      entries.push(edge);
      groups.set(edge.from_item_id, entries);
      return groups;
    }, new Map())),
    stateKey,
    futureKey,
    resourceEvents,
    enumerate: () => enumerateReference({ initialState: initial, expand: transitions, stateKey, label: objectiveLabel }),
    search: (options = {}) => searchLabels({ ...options, initialState: initial, expand: transitions, stateKey, futureKey, label: objectiveLabel })
  };
}

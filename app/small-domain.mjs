import { searchLabels } from "./search-core.mjs";
import { enumerateReference, paretoFilter } from "./reference-search.mjs";

function cloneState(state) {
  return {
    ...state,
    inventory: [...state.inventory],
    events: [...state.events],
    snapshots: [...state.snapshots]
  };
}

function unlocksAt(earnedSouls, unlocks) {
  return unlocks.filter((unlock) => earnedSouls >= unlock.earnedSouls).reduce((sum, unlock) => sum + unlock.slots, 0);
}

function snapshot(state, label) {
  return {
    earnedSouls: state.earnedSouls,
    cash: state.cash,
    inventory: [...state.inventory],
    unlockedSlots: state.unlockedSlots,
    label: { ...label }
  };
}

export function createSmallDomain({ items, upgrades = [], unlocks = [], incomeStep = 100, horizon = 400, sellbackRate = 0.5 }) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const upgradeByFrom = new Map(upgrades.map((edge) => [edge.from, edge]));
  const initial = {
    earnedSouls: 0,
    cash: 0,
    inventory: [],
    unlockedSlots: 0,
    events: [],
    snapshots: []
  };

  const label = (state) => ({
    power: state.inventory.reduce((sum, id) => sum + byId.get(id).power, 0),
    // The generic kernel maximizes every label dimension; costs are negated.
    spent: -state.events.reduce((sum, event) => sum + Math.max(0, event.payment ?? 0), 0)
  });
  initial.snapshots.push(snapshot(initial, label(initial)));

  function withEvent(state, event, earnedSouls = state.earnedSouls, cash = state.cash, inventory = state.inventory) {
    const next = cloneState(state);
    next.earnedSouls = earnedSouls;
    next.cash = cash;
    next.inventory = [...inventory];
    next.unlockedSlots = unlocksAt(earnedSouls, unlocks);
    next.events.push(event);
    next.snapshots.push(snapshot(next, label(next)));
    return next;
  }

  function transitions(state) {
    const successors = [];
    if (state.earnedSouls + incomeStep <= horizon) {
      const earnedSouls = state.earnedSouls + incomeStep;
      successors.push(withEvent(state, { type: "save", amount: incomeStep }, earnedSouls, state.cash + incomeStep));
    }
    for (const item of items) {
      if (state.cash < item.cost || state.inventory.includes(item.id) || state.inventory.length >= 1 + state.unlockedSlots) continue;
      successors.push(withEvent(state, { type: "purchase", item: item.id, payment: item.cost }, state.earnedSouls, state.cash - item.cost, [...state.inventory, item.id]));
    }
    for (const edge of upgrades) {
      const index = state.inventory.indexOf(edge.from);
      if (index < 0 || state.cash < edge.cost) continue;
      const inventory = [...state.inventory];
      inventory.splice(index, 1, edge.to);
      successors.push(withEvent(state, { type: "upgrade", from: edge.from, item: edge.to, payment: edge.cost }, state.earnedSouls, state.cash - edge.cost, inventory));
    }
    for (const ownedId of state.inventory) {
      const owned = byId.get(ownedId);
      for (const item of items) {
        if (item.id === ownedId || state.inventory.includes(item.id)) continue;
        const payment = item.cost - owned.cost * sellbackRate;
        if (state.cash + owned.cost * sellbackRate < item.cost) continue;
        const inventory = state.inventory.map((id) => id === ownedId ? item.id : id);
        successors.push(withEvent(state, { type: "replacement", from: ownedId, item: item.id, payment }, state.earnedSouls, state.cash - payment, inventory));
      }
      successors.push(withEvent(state, { type: "sell", from: ownedId, payment: -owned.cost * sellbackRate }, state.earnedSouls, state.cash + owned.cost * sellbackRate, state.inventory.filter((id) => id !== ownedId)));
    }
    return successors;
  }

  const stateKey = (state) => `${state.earnedSouls}:${state.cash}:${state.unlockedSlots}:${[...state.inventory].sort().join("|")}:${state.events.map((event) => `${event.type}:${event.item || ""}:${event.from || ""}:${event.payment || 0}`).join(">")}`;
  const futureKey = (state) => `${state.earnedSouls}:${state.cash}:${state.unlockedSlots}:${[...state.inventory].sort().join("|")}`;

  return {
    initial,
    transitions,
    label,
    stateKey,
    futureKey,
    enumerate() {
      return enumerateReference({ initialState: initial, expand: transitions, stateKey, label });
    },
    search() {
      const result = searchLabels({ initialState: initial, expand: transitions, stateKey, futureKey, label });
      return { ...result, pareto: paretoFilter(result.labels) };
    }
  };
}

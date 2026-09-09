import { createDeadlockDomain } from "./deadlock-domain.mjs";

// Replays through the legal domain, independently of candidate ranking.
export function validateSearchPath({ data, itemIds, budget, soulAxis, state }) {
  const domain = createDeadlockDomain({ data, itemIds, budget, soulAxis, recordHistory: true, metrics: () => ({ value: 0 }) });
  let current = domain.initial;
  for (const event of state.events) {
    const next = domain.transitions(current).find((candidate) => JSON.stringify(candidate.events.at(-1)) === JSON.stringify(event));
    if (!next) throw new Error(`Illegal build action: ${event.type}`);
    current = next;
  }
  if (current.earnedSouls !== budget || domain.futureKey(current) !== domain.futureKey(state)) throw new Error("Build does not match its legal terminal state");
  return { valid: true, transactions: state.events.filter((event) => event.type !== "save").length, cash: current.cash, slots: current.inventory.length };
}

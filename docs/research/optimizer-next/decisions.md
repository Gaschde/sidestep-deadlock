# Optimizer Next — Architecture Decisions

Status: **Accepted implementation direction**
Date: **2026-09-19**
Base commit: `b0001472fbbcc2c3becc42582043d82caa547e88`

This file is the implementation handoff. The three reports in this directory are research inputs, not authority. If a report conflicts with current code, current code wins. If a proposed change conflicts with a verified game rule, the verified game rule wins.

## Keep

- Existing Deadlock shop/domain legality model.
- `validateSearchPath()` / replay validation.
- `search-core.mjs` as the exact diagnostic/reference solver for bounded subproblems.
- Verified deterministic damage/EHP mechanics.
- Existing anytime principles that remain useful: bounded runtime, incumbents, reproducibility, local refinement/terminal audit where valid.
- Explicit handling of unknown mechanics; do not invent values.

## Build next

1. **Configurable Soul milestones**
   - Evaluate the actual purchase path at multiple budget checkpoints, not only the final horizon.
   - Do not hard-code “realistic” milestone values without verified data; keep the mechanism configurable.

2. **Opponent resistance scenarios**
   - Introduce explicit numeric opponent parameters at minimum for Bullet Resistance and Spirit Resistance.
   - Do not invent “low/medium/high” thresholds. Presets require verified data or must be clearly user-defined scenarios.

3. **Small internal Pareto layer**
   - Primary candidate: Damage vs Survivability/EHP.
   - Preserve non-dominated alternatives internally.
   - The UI may still select one simple default recommendation using user focus/preferences.
   - Any pruning/dominance rule must be future-safe with respect to inventory, upgrades, slots, synergies, trajectory, milestones, and scenarios.

4. **Iterative Diverse Beam Search as the target production search**
   - Keep multiple strategically different promising prefixes alive.
   - Retain an anytime behavior: start with a small beam and widen/refine while budget remains.
   - Avoid a beam full of near-duplicate builds; use a justified diversity strategy.
   - Keep the current search backend initially as a comparison/fallback. Do not delete it before the new backend is integrated and reviewed.
   - Reuse useful existing components such as seed generation, controlled exploration, local refinement, terminal audit, and path validation when they remain sound.

5. **Result semantics / guarantees**
   Keep these concepts distinct:
   - `legally path-verified`: replay proves the transaction path is legal.
   - `best found`: best candidate found by the heuristic search under the stated run/configuration.
   - `locally verified`: no checked local neighbor improves it.
   - `bounded`: a valid bound establishes a maximum remaining optimality gap.
   - `optimal`: only when the defined model/search space is mathematically certified.

## Later / verification layer

- Evaluate the existing admissible Branch-and-Bound work as a shadow/certification layer.
- Long-term goal: report a valid optimality gap when possible.
- Do not claim a bound until its admissibility and integration are verified.

## Do not build now

- Full MDP / complete purchase policy over the complete live match state.
- Full opponent AI.
- Full digital match simulator.
- Invented time/income/farm-rate model.
- Unverified Deadlock values.
- MOMA, graph contraction, or other research proposals as production architecture without project-specific evidence.

## Architecture separation

Keep these concerns separate:

1. **Domain** — what transactions/states are legal?
2. **Evaluation** — how good is a state/build under an explicit scenario?
3. **Trajectory** — how good is the purchase path across milestones?
4. **Scenarios** — under which opponent assumptions is it evaluated?
5. **Search** — how are promising paths discovered?
6. **Certification** — what can actually be proven about solution quality?

Search must not hard-code the evaluation contract unnecessarily.

## Key unresolved choices to settle from current code

These are implementation questions, not a reason to restart the research phase:

- Exact milestone API and defaults.
- Exact opponent-scenario API.
- Pareto vector and future-safe dominance relation.
- Beam state identity / duplicate detection / diversity.
- Which parts of the current anytime search should remain after Beam Search.
- Whether the documented Branch-and-Bound bound is compatible with the new evaluation contract.

For genuine mathematical/architectural uncertainty, inspect code first, run the smallest decisive check second, and only then escalate to a deeper review.

## Direction in one sentence

**Keep the verified legality/exact-subsolver foundation, improve the model with milestones and explicit opponent scenarios, preserve multiple Damage/EHP trade-offs internally, and move the production search toward an iterative diverse Beam Search, with Branch-and-Bound later providing certification where valid.**

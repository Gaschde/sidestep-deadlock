# Optimizer Next — Implementation Status

Status: **Review candidate**
Branch: `feature/optimizer-next`
Date: **2026-09-19**

This file records what is actually implemented after applying `decisions.md`. The code remains authoritative.

## Product path

```
UI (app.js / index.html)
  -> optimizer-worker.mjs
  -> iterative-diverse-beam (default) | anytime (fallback)
  -> deadlock-domain.mjs
  -> optimizer.mjs evaluation under explicit opponent scenario
  -> milestone trajectory scoring
  -> internal Damage/EHP Pareto retention
  -> terminal audit
  -> validateSearchPath()
  -> result semantics + UI
```

The exact `search-core.mjs` path remains a diagnostic/reference solver for bounded small spaces.

## Layer contract

- **Domain:** `deadlock-domain.mjs` owns legal purchases, upgrades, replacements, sells, slots and resource transitions.
- **Evaluation:** `optimizer.mjs` evaluates deterministic build performance. Opponent resistance is passed as scenario input; search does not encode resistance formulas.
- **Trajectory:** `search-milestones.mjs` maps a legal path to committed snapshots at configured Soul checkpoints.
- **Scenarios:** `search-scenarios.mjs` normalizes explicit `opponentBulletResist` and `opponentSpiritResist`.
- **Search:** `beam-search.mjs` is the production heuristic; `anytime-search.mjs` remains available as a fallback.
- **Certification:** path replay is active; mathematical bounding is not.

## Milestones

Milestones are configurable integers in `[0, budget]`.

There are no invented Early/Mid/Late defaults. If no milestone is supplied, the only checkpoint is the configured horizon itself. The horizon is always included even when omitted from the supplied list.

The Beam objective evaluates the committed path state at every configured checkpoint. Checkpoints are equally weighted as a neutral product default; this is an optimizer preference, not a Deadlock game fact.

## Opponent scenarios

The minimum scenario is:

```js
{
  opponentBulletResist: 0,
  opponentSpiritResist: 0
}
```

Zero/zero is the neutral default. Explicit numeric values alter outgoing Bullet/Spirit damage independently. Negative resistance remains representable as damage amplification. Values above 100% are rejected to avoid negative outgoing damage.

Target resistance does **not** alter the optimizer's own EHP or lifesteal recovery calculations.

## Internal Pareto layer

`pareto.mjs` implements a two-dimensional non-dominance relation:

- Damage
- Survivability / EHP

For the production Beam, Pareto membership is used to retain strategic trade-offs and improve diversity.

It is deliberately **not** used as a proof-producing global pruning rule. A path is only safely deduplicated when both are true:

1. its future configuration is identical under `deadlock-domain.futureKey()`; and
2. its already committed milestone Damage/EHP history is identical.

Beam truncation remains heuristic and is reported as such.

## Iterative Diverse Beam Search

The production backend starts with a small beam and widens while budget remains.

Current search mechanics:

- deterministic ordering for reproducibility;
- exact future/history duplicate detection as described above;
- Damage and Survivability extremes explicitly retained;
- current Pareto candidates retained before ordinary fill;
- diversity buckets based on category composition and upgrade-family roots;
- one-upgrade continuation lookahead to reduce immediate pruning of threshold/upgrade candidates;
- early valid incumbent by legal save-completion;
- complete path replay before publication;
- final direct purchase/upgrade/replacement terminal audit;
- fixed wall-clock search budget with a reserved terminal-audit portion.

The sampled reference is an attainable comparison envelope. It is **not** an admissible upper bound.

## Existing Anytime backend

`anytime-search.mjs` is not deleted. It keeps its existing sampled-reference objective, seed builds, deterministic RNG, Gumbel/random exploration, prefix/suffix variation, local refinement, path simplification and terminal audit.

It now accepts the same explicit opponent scenario and reports the same milestone/result-semantics envelope.

These components were not copied wholesale into Beam Search because their old scalar trajectory objective is different from the new milestone/Pareto retention contract. Beam reuses the useful concepts of bounded runtime, early incumbents, upgrade counter-probing, terminal audit and replay validation.

## Result semantics

Production results expose these concepts separately:

- **legallyPathVerified** — `validateSearchPath()` replay succeeded.
- **bestFound** — best candidate found by the selected heuristic in this run.
- **locallyVerified** — the configured direct terminal shop neighbourhood was completely audited without a better checked neighbour remaining.
- **bounded** — currently always false in production.
- **optimal** — currently always false in production.

Legal replay is never presented as an optimality proof.

## Branch-and-Bound compatibility

`docs/reference_branch_bound_review.md` remains relevant, but its bound is not activated.

Current certification status is:

`shadow_disabled_pending_outward_rounded_bounds`

The new architecture keeps Domain, Evaluation, Trajectory, Search and Certification separated so a future shadow checker can consume the same explicit scenario/objective contract. No pruning or optimality gap is reported until floating-point outward-rounding/admissibility is proven.

## Research reconciliation

Still valid from the reports:

- keep the verified domain/replay foundation;
- exact Label-Correcting remains useful on bounded small spaces;
- production-scale search is heuristic without a valid bound;
- explicit opponent scenarios and intermediate checkpoints are useful;
- Damage/EHP trade-offs should not be destroyed by an unjustified single global dominance rule;
- a fabricated time/income model would create false precision.

Now outdated:

- production path is no longer Anytime-only;
- opponent Bullet/Spirit resistance is no longer absent;
- configurable Soul milestones are no longer absent;
- production search now has an internal 2D Pareto retention layer.

Intentionally not adopted:

- report-suggested fixed milestone values such as 3k/12k/30k or 6k/15k/30k: not verified project defaults;
- naive item-stat dominance preprocessing: not proven future-safe under upgrades, ancestors, synergies, slots and trajectory history;
- MOMA / contraction hierarchies: no project-specific evidence sufficient for production;
- Branch-and-Bound pruning: documented bound is not yet safe enough for certification.

## Verification contract

The JavaScript suite covers, among other existing regressions:

- Domain legality and resource behavior;
- compact/full evaluator agreement;
- existing Anytime legality and small exact comparisons;
- milestone normalization/snapshots;
- explicit opponent resistance behavior;
- Damage/EHP Pareto behavior;
- Beam legal path replay;
- Beam vs. exact `search-core` oracle in a small canonical Warden space;
- Anytime fallback scenario/milestone contract;
- production Beam default and 40k fast-search horizon.

The Python engine is a parallel implementation untouched by optimizer-next. Its current test baseline contains pre-existing failures against current data/expectations, so CI runs it as advisory rather than making unrelated Python debt a blocker for the browser optimizer branch.

## Known remaining risks

- Full 40k/all-items Beam quality is still heuristic and benchmark quality has not been converted into an optimality gap.
- Beam ranking/reference work can consume a meaningful fraction of the 25 s budget on large candidate pools.
- The current internal Pareto layer is intentionally small; the UI still selects one default build instead of exposing a visual Pareto frontier.
- Terminal local verification covers the direct purchase/upgrade/replacement neighbourhood, not an arbitrary multi-step neighbourhood.
- B&B certification is disabled until admissibility is implementation-safe.
- Existing Python-engine regressions remain separate technical debt.

## Review target

The branch is intended for external review of:

1. scenario correctness;
2. milestone objective semantics;
3. future-safe duplicate identity;
4. Beam diversity/truncation behavior;
5. full-scale runtime/memory behavior;
6. result wording and guarantee boundaries;
7. eventual shadow B&B integration.

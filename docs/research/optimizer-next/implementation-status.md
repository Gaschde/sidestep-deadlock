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
- **Trajectory:** `search-milestones.mjs` maps a legal path to committed snapshots at configured Soul checkpoints; `search-objective.mjs` owns the shared milestone scoring contract used by Beam and Anytime.
- **Scenarios:** `search-scenarios.mjs` normalizes explicit `opponentBulletResist` and `opponentSpiritResist`.
- **Search:** `beam-search.mjs` is the production heuristic; `anytime-search.mjs` remains available as a fallback.
- **Certification:** path replay is active; mathematical bounding is not.

## Milestones

Milestones are configurable integers in `[0, budget]`.

There are no invented Early/Mid/Late defaults. If no milestone is supplied, the only checkpoint is the configured horizon itself. The horizon is always included even when omitted from the supplied list.

The Beam objective and the Anytime fallback both evaluate the committed path state at every configured checkpoint. Checkpoints are equally weighted as a neutral product default; this is an optimizer preference, not a Deadlock game fact.

## Opponent scenarios

The minimum scenario is:

```js
{
  opponentBulletResist: 0,
  opponentSpiritResist: 0
}
```

Zero/zero is the neutral default. Explicit numeric values alter outgoing Bullet/Spirit damage independently. Negative resistance remains representable as damage amplification. Values above 100% are rejected to avoid negative outgoing damage.

Target resistance does **not** alter the optimizer's native defensive EHP. Bullet resistance does reduce dealt Weapon damage, and permanent Bullet Lifesteal recovery is calculated from that post-resistance Weapon damage.

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

`anytime-search.mjs` is not deleted. It keeps its seed builds, deterministic RNG, Gumbel/random exploration, prefix/suffix variation, local refinement, path simplification and terminal audit.

It now accepts the same explicit opponent scenario and uses the same equally weighted milestone objective for ranking and publication. The previous 70/15/15 continuous-trajectory score remains available as diagnostic code/metadata, not as the fallback selection objective.

Beam and Anytime still differ in search strategy and retention: Beam uses iterative widening, Pareto/diversity retention and future-safe duplicate handling; Anytime keeps rollout/local-refinement behavior.

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
- explicit opponent resistance behavior, including post-resistance Bullet Lifesteal recovery and Bullet-vs-Spirit routing for typed ability damage;
- Damage/EHP Pareto behavior;
- Beam legal path replay;
- Beam vs. exact `search-core` oracle in a small canonical Warden space;
- Anytime fallback scenario/milestone contract;
- production Beam default and 40k fast-search horizon.

The Python engine is a parallel implementation untouched by optimizer-next. Its current test baseline contains pre-existing failures against current data/expectations, so CI runs it as advisory rather than making unrelated Python debt a blocker for the browser optimizer branch.

## Known remaining risks

- Full 40k/all-items Beam quality is still heuristic and benchmark quality has not been converted into an optimality gap.
- Beam ranking/reference work can consume a meaningful fraction of the current 60 s product budget on large candidate pools.
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


## Optimizer V1 Measurement & Objective Foundation

The branch now has an orthogonal measurement layer for the production Beam. `profile=false` remains the default; instrumentation does not alter the objective, legality rules, Beam widths, diversity rules, milestone defaults or opponent scenario contract.

The benchmark matrix is defined in `benchmarks/optimizer-v1/cases.mjs` and covers a bounded SMALL/EXACT Warden case, two CONTROLLED/MEDIUM cases, and the six 40k production Carry combinations Warden/Infernus × Weapon/Spirit/Hybrid.

Benchmark comparisons can freeze and reuse the existing sampled Beam reference through `suppliedReference`. This reference remains heuristic and non-admissible; freezing it is solely a reproducibility control.

The current objective has been named `baseline-v0`. Its existing three 10-second Damage rows (lane trade, farm, teamfight) are explicitly regression-locked as mathematically identical in the compact evaluator. They are not changed by this phase.

See:
- `docs/research/optimizer-next/baseline-contract-v0.md`
- `docs/research/optimizer-next/measurement-foundation.md`
- `docs/research/optimizer-next/objective-contract-v1.md`


### BASELINE V0 recorded

Source commit: `371a22e3bda9c015a7b1c5e19947db06c6fb7045`.
Data commit: `0f84bd091ac8c7d33d6ed18d3590ed2af690370f`.

The bounded SMALL/EXACT case reaches the exact score with zero gap. All six 40k production cases are legally path-verified, but every one completes only Beam Width 4 within the fixed-reference 25 s contract. Infernus evaluation is measured at roughly 32–36× the Warden per-inventory cost on the baseline runner, and all three Infernus 40k terminal audits remain incomplete.

These are now measurement facts to investigate before changing search heuristics or the production objective. Inclusive profiler timers overlap and are not bottleneck percentages.

The `baseline-v0` files remain a historical **25 s** measurement contract. The current Product wall-clock budget is **60 s**; new measurements are recorded separately rather than rewriting `baseline-v0`.


## Objective / Buildpath Investigation — V1A

The experimental objective `objective-v1a-soul-auc-terminal-gmean` exists behind explicit scorer injection only. Production still defaults to `baseline-v0`.

V1A keeps the existing normalized Damage/Survival state utility unchanged, integrates it piecewise-constantly over the modeled earned-Souls axis, keeps terminal utility separate, and combines Path/End symmetrically with a geometric mean for the experiment.

The fixed-reference A/B matrix completed successfully across SMALL/EXACT, both CONTROLLED cases and all six 40k Production cases. SMALL/EXACT has zero gap for both objective definitions and all A/B paths replay legally.

The experiment does **not** justify activation: only two of nine cases improve Path utility, both lose terminal utility, and no case both improves Path and preserves terminal quality. Every V1A 40k Production result still makes its first transaction at 40k. Warden Hybrid additionally exposes an Objective/Search compatibility failure: the baseline-guided run found a path that cross-scores better under V1A than the V1A-guided winner.

Decision: **revise V1A; Production remains baseline-v0**.

Full evidence: `docs/research/optimizer-next/objective-v1-investigation.md` and `benchmarks/optimizer-v1/experiments/objective-v1a/`.


## Path vs End Pareto Experiment

The V1A geometric-mean scalar remains rejected and Production still defaults to `baseline-v0`.

A dedicated experiment now evaluates Path-AUC and Endbuild as separate Pareto dimensions with no scalarization. SMALL uses the existing exact bounded search. CONTROLLED uses a fixed candidate union from fully completed standard Beam Width 8→16 runs and complete terminal-audit neighbourhoods under the already-existing baseline-v0 and V1A scorers. Terminal observation is materialized only after Search/Audit decisions, so the diagnostic observer does not consume their time budget or change ranking/retention.

Final reproducible candidate sets:

- SMALL Warden Weapon: 5 legal candidates, Pareto count 1.
- CONTROLLED Warden Hybrid: 322 legal candidates, Pareto count 2.
- CONTROLLED Infernus Hybrid: 361 legal candidates, Pareto count 2.

Two consecutive runs produced identical candidate-set hashes and identical Pareto results. The final run passed 101/101 JavaScript tests.

In both CONTROLLED cases, `baseline-v0` is Pareto-optimal. The second Pareto point improves Path-AUC but loses Endbuild quality; no observed candidate improves Path without Endbuild loss, and none improves Endbuild without Path loss.

Decision: **continue with Multiobjective experimentally; do not change Production yet**.

Exactly one next step: run a CONTROLLED-only experimental Beam that preserves non-dominated `(Path-AUC, Endbuild)` alternatives during search and compare it against these frozen fronts.

Full evidence: `docs/research/optimizer-next/path-end-pareto-experiment.md` and `benchmarks/optimizer-v1/experiments/path-end-pareto/`.


## Controlled Multiobjective Beam Experiment

A CONTROLLED-only experimental search now retains candidates by the two separate dimensions `(Path-AUC, Endbuild)` with no Path/End scalarization. The experiment is isolated in `benchmarks/optimizer-v1/controlled-multiobjective-beam.mjs`; the Production Beam remains unchanged.

Search retention uses Pareto layers. Dominance across different future configurations is not treated as a proof-safe global prune: later Pareto layers remain eligible while Beam capacity exists. Future-safe dedupe includes the future configuration plus the exact unrounded Path/End save-completion vector, so objective-distinct Path-AUC histories are not merged.

Two identical runs across fixed Widths 8/16/32/64 produced identical front hashes for both CONTROLLED Warden Hybrid and CONTROLLED Infernus Hybrid. The first Pareto front remained small (maximum 6 for Warden, 3 for Infernus) and never overflowed Width 8.

The frozen two-point reference fronts were not recovered exactly. Instead:

- Warden: by Width 8, both frozen points are dominated by newly found candidates. Width 32 stabilizes at `(0.449185, 0.427123)`.
- Infernus: Width 8 still misses the frozen End-side baseline, but Width 16 dominates both frozen points. Width 32 stabilizes at `(0.455859, 0.441198)`.
- Width 64 improves neither final front.

The stable Width-32 candidates each use seven purchases with no replacements, sells, reacquisitions or same-Soul transaction groups. Lower widths still show limited replacement/reacquisition behavior, but no Sell/Rebuy or Same-Soul pathology was observed on the experiment fronts.

Cost relative to the existing same-runner CONTROLLED baseline:

- cumulative Width 8+16: Warden 2.15× runtime / 0.95× generated Search States; Infernus 1.80× / 0.89×;
- cumulative through Width 32: Warden 5.31× runtime / 2.41× Search States; Infernus 3.27× / 2.25×;
- Width 64 adds substantial work without an observed front improvement.

Workflow `35463184096` completed successfully with 106/106 JavaScript tests and stored the benchmark data. Existing optimizer-next workflow `35463184126` also completed successfully.

Decision: **A — the Multiobjective Beam works well enough in CONTROLLED to justify a 40k shadow experiment; Production remains unchanged.**

Exactly one next step: run a **40k Shadow experiment** without changing Production selection or UI.

Full evidence: `docs/research/optimizer-next/controlled-multiobjective-beam-experiment.md` and `benchmarks/optimizer-v1/experiments/controlled-multiobjective-beam/`.


## 60s Product Budget + 40k Multiobjective Shadow

The current Product wall-clock budget is now **60 seconds**. Historical `baseline-v0` benchmark files remain the original 25 s measurement contract and were not rewritten.

The 60 s Production rerun changes search reach asymmetrically:

- all three Warden 40k cases report Width 4 and Width 8 completed;
- all three Infernus 40k cases report only Width 4 completed;
- Warden terminal audits complete; Infernus terminal audits remain incomplete.

The later Width-4 profiler qualifies the Infernus wording: `widthsCompleted:[4]` is not evidence that the normal Infernus Beam traversed to 40k. Production materializes an early legal save-to-horizon incumbent, and the width-completion flag can remain true when the outer wall-clock condition ends the loop between iterations. The profiled Infernus Hybrid Beam itself reached only 11.2k Souls before the deadline while still returning a legal terminal build.

The experimental 40k Multiobjective Shadow uses the same 60 s wall-clock budget per case and keeps `(Path-AUC, Endbuild)` separate with no Path/End scalarization.

Observed across Warden/Infernus × Weapon/Spirit/Hybrid:

- all six Shadow runs start Width 4;
- none completes Width 4 within 60 s;
- none reaches a terminal candidate;
- therefore no terminal 40k Pareto front is produced;
- repeated runs reproduce the same empty terminal front and identical State/Evaluation counts.

Partial first fronts remain small (maximum 6), so the measured blocker is not a terminal frontier explosion. The current experimental 40k search simply does not progress far enough within the Product budget.

The 60 s Production paths also expose path-quality problems that are measured but not repaired here:

- Warden Weapon: 46 transactions / 26 replacements;
- Warden Spirit: 44 / 24;
- Warden Hybrid: 79 / 62, including heavy repeated Grit ↔ Health Stimpak reacquisition;
- all three Infernus cases still make their first transaction only at 40k.

No anti-churn rule, Search heuristic, Objective, Afterburn evaluator, item data or Production selection was changed.

Workflow `35464300745` succeeded with 106/106 JavaScript tests and stored:

- `benchmarks/optimizer-v1/experiments/40k-multiobjective-shadow/results.json`
- `benchmarks/optimizer-v1/experiments/40k-multiobjective-shadow/summary.json`

Decision: **C — the CONTROLLED success does not transfer sufficiently to 40k. Production remains unchanged.**

Exactly one next step: profile the 40k Multiobjective Width-4 run to locate the lost Search progress before changing any Search heuristic.

Full evidence: `docs/research/optimizer-next/40k-multiobjective-shadow-experiment.md`.


## 40k Multiobjective Width-4 Profiling

The diagnostic Width-4 phase is complete. Search semantics, Objective, Beam Width, item data and Production selection were not changed.

The core Production-vs-Multiobjective terminal difference is now explicit: Production calls a legal save-to-horizon completion early, while Multiobjective only uses that same save-to-horizon idea implicitly inside its partial Path/End vector and does not materialize a terminal node. This is decisive for Infernus: the profiled Production Beam naturally reached only 11.2k Souls, while Multiobjective reached 17.2k, yet Production returned a terminal build and Multiobjective returned none.

Runtime attribution is engine-specific:

- **Warden Hybrid Multiobjective:** 58.12 s Search; 22.52 s future-safe dedupe followed by 35.38 s frontier maintenance. Full Pareto-layer construction accounts for 35.35 s. The first front is small; the cost is constructing all later layers for large unique pools even though Width is only 4.
- **Infernus Hybrid Multiobjective:** 58.18 s Search; 47.51 s future-safe dedupe followed by 10.60 s frontier maintenance. Evaluation occupies 42.54 s inside Vector/Dedupe work; Pareto layering adds 10.59 s.
- Multiobjective dedupe removes only 1.24% of Warden and 0.10% of Infernus generated Search candidates.
- Direct transition/action generation, Diversity, Endbuild scoring and terminal audit are not the measured blockers.
- Warden Production naturally reaches 40k at about 10.5 s in the profiled Width-4 run; Warden Multiobjective reaches only 32.0k profiled / 32.4k control.
- Infernus Multiobjective progresses farther than the normal Production Beam, so its zero-terminal result is not caused by worse Soul reach.

Timer values are inclusive/nested unless the profiling document explicitly identifies sequential loop sections; child timers must not be summed as runtime percentages.

Verification:

- 108/108 JavaScript tests pass.
- optimizer-next workflow `35466351173`: success.
- profiling workflow `35466351196`: success.
- Python baseline remains advisory with the same six pre-existing failures.

Exactly one next step: optimize the experimental Multiobjective Pareto retention **without changing selected nodes** by extracting Pareto layers lazily only until Beam capacity is filled, prove retained-node equivalence against the current full-layer implementation, then rerun the same 40k Width-4 Warden/Infernus measurement.

Full evidence: `docs/research/optimizer-next/40k-multiobjective-width4-profiling.md` and `benchmarks/optimizer-v1/experiments/40k-multiobjective-width4-profile/`.


## Lazy Multiobjective Pareto Retention

The experimental Multiobjective Beam now extracts Pareto layers lazily: it stops as soon as the extracted complete layer prefix contains enough candidates to fill the current Beam width. Dominance, dedupe identity, Width, partial-layer Path/End extremes, Diversity and ordering are unchanged.

The former full-layer behavior remains only as a regression-test oracle. Full and Lazy share the same single-layer extraction, and 111/111 JavaScript tests pass, including exact retained-node order comparisons across multiple pool sizes, widths, Pareto layers, equal Path/End vectors and repeated runs.

The repeated 40k Width-4 profile confirms the hotspot removal:

- Warden Hybrid Multiobjective Pareto time: 35.35 s -> 1.68 s (-95.3%); control Soul reach: 32.4k -> 37.2k.
- Infernus Hybrid Multiobjective Pareto time: 10.59 s -> 0.12 s (-98.9%); remaining runtime is dominated by evaluation/vector-dedupe work.
- Across the new profiled runs, 99.58% of Warden and 99.05% of Infernus unique candidate-layer assignments were unnecessary for filling Width 4 and are now skipped.
- Neither Multiobjective case completes the natural Width-4 search or produces a terminal candidate inside the wall-clock budget. The known separate Save-to-40k materialization asymmetry remains unchanged.
- Production behavior was not modified. Warden Production performs the same deterministic 88,760 states / 16,791 evaluations; cross-run wall-clock differences confirm GitHub-runner variance.

Workflow `35467808600` and optimizer-next tests `35467808611` succeeded. Python retains the same six advisory failures.

Exactly one next step: add **Multiobjective Save-to-40k terminal materialization parity** as a separate change, without modifying Objective or Pareto retention, so wall-clock-limited Multiobjective runs can expose legal terminal Pareto candidates comparable to Production.

Full evidence: `docs/research/optimizer-next/lazy-multiobjective-pareto-retention.md` and `benchmarks/optimizer-v1/experiments/40k-multiobjective-width4-profile/`.

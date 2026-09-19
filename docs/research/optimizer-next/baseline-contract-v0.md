# Optimizer V1 — Baseline Contract V0

Status: **Measurement contract**
Branch: `feature/optimizer-next`
Foundation start HEAD: `c36e541f87dfab27a968d0e806248d665b6bee0f`
Objective version: `baseline-v0`

This document freezes the current production semantics so later changes can be measured against a named baseline. It does not change the search or objective.

## Dataset

Both canonical manifests currently describe **Minor Update - 08-22-2026**, data as of **2026-08-22**, schema `0.1.0-research`.

- Core: 156 items, verified 2026-09-02.
- Heroes: 60 registered / 38 publicly playable, verified 2026-09-02.
- Mode: Standard Match, 6v6, three lanes.
- Canonical data remains unchanged by this foundation.

## Production request contract

The fast Carry optimizer currently uses:

- Hero: request-selected; Warden and Infernus are the benchmarked V0 production cases.
- Role: Carry.
- Focus: Weapon, Spirit or Hybrid.
- Backend: `iterative-diverse-beam` through the production `beam` selector.
- Budget: 40,000 earned Souls.
- Slots: 12 available from 0 Souls (9 base plus 3 explicit initial unlocks).
- Item input: all 156 canonical items; hero/shop legality can exclude unavailable items before search.
- Opponent scenario default: 0% Bullet Resistance / 0% Spirit Resistance.
- Wall-clock budget: 25,000 ms.
- Beam widths: 4 → 8 → 16 → 32 while budget remains.
- Reference sampling allowance: 1,500 ms inside the production run.
- Terminal-audit reserve: min(2,000 ms, 20% of total budget), therefore 2,000 ms at the 25 s product budget.

These are search-budget/implementation settings, not Deadlock game rules.

## Milestones and what the default actually optimizes

`normalizeMilestones(undefined, 40000)` returns only `[40000]`.

Therefore a default production request with no explicit milestones scores only the held build at the **40,000-Soul horizon**. There are no implicit Early/Mid/Late checkpoints.

When explicit milestones are supplied, the horizon is always included and all checkpoints currently receive equal weight.

## Objective V0

The current scalar selection score is:

- Damage group: 50%.
- Survival group: 50%.
- Damage focus inside every damage metric:
  - Weapon: 70% Bullet / 30% Spirit.
  - Spirit: 30% Bullet / 70% Spirit.
  - Hybrid: 50% Bullet / 50% Spirit.
- Per component normalization: `x / (x + reference)`.
- Milestone aggregation: arithmetic mean over configured checkpoints.

The five public Damage metrics are:

1. `sustainedWeaponDps` — `damageAt(60) / 60`.
2. `laneTradeWindowDps` — `damageAt(10) / 10`.
3. `farmWindowDps` — `damageAt(10) / 10`.
4. `skirmishWindowDps` — `damageAt(4) / 4`.
5. `teamfightWindowDps` — `damageAt(10) / 10`.

The compact evaluator therefore makes **lane trade, farm and teamfight damage mathematically identical today**, including their Bullet and Spirit component rows. This is deliberately preserved in Baseline V0. It must not be silently “fixed” before an objective A/B benchmark.

The Survival metrics are `bulletEhp` and `spiritEhp`. They include the current verified permanent resistance/recovery treatment; Bullet EHP additionally includes permanent Bullet Lifesteal recovery from post-opponent-resistance Weapon fire over the common 10 s window.

## Reference contract

Production currently builds a time-limited, attainable sampled comparison envelope. It is:

- heuristic;
- frozen once generated for that run;
- not an admissible upper bound;
- not a proof of optimum.

The benchmark harness reuses the already supported `suppliedReference` path. For a benchmark case, V0 first captures the current production reference logic and stores it under a versioned case ID. Subsequent benchmark comparisons use exactly that stored reference. Search versions therefore cannot receive different scores merely because separate heuristic reference runs happened to be stronger or weaker.

A fixed benchmark reference is a **comparison control**, not a new mathematical reference and not a production-objective change.

## Benchmark contract

Three levels exist:

- **SMALL / EXACT:** bounded small spaces; `search-core` is used as an exact oracle for the stated case. The record contains exact score, candidate score, absolute gap and relative gap.
- **CONTROLLED / MEDIUM:** reproducible larger subsets for cheaper search comparisons.
- **PRODUCTION 40K:** Warden and Infernus × Weapon/Spirit/Hybrid, Carry, 40k, 12 slots, neutral opponent resistances.

Every result records dataset identity, commit, case, hero/role/focus, backend, budget, slots, item set, time budget, normalized milestones, opponent resistances, objective version, reference source/version, search-budget settings, hardware, score, endbuild metrics, trajectory metrics and guarantee flags.

Two records are not labelled higher/lower/equal by the comparison helper unless their comparison conditions match. Commit and timestamp are intentionally not part of that equality key so two code versions can be compared; hardware, objective and fixed reference are part of it.

## Profiling contract

The Beam profiler is opt-in. Baseline V0 separates:

1. an **unprofiled result run**, which defines the benchmark score; and
2. a **profiled diagnostic run** against the same fixed reference and search contract.

This separation avoids making the baseline score itself depend on instrumentation overhead under a wall-clock deadline.

Top-level phase timers:

- `referenceMs`
- `beamSearchMs`
- `terminalAuditMs`
- `validationMs` (nested in publication)

Operation timers:

- `transitionMs`
- `purchaseGenerationMs`
- `upgradeGenerationMs`
- `replacementGenerationMs`
- `evaluationMs`
- `trajectoryScoreMs`
- `pathReconstructionMs`
- `continuationLookaheadMs`
- `dedupeMs`
- `paretoMs`
- `diversityMs`
- `sortingMs`

Counters include transition/generation volume, unique/duplicate states, evaluation/cache activity, purchase/upgrade/replacement/family checks, continuation lookahead, candidate-pool samples, and per-width work/runtime.

Timers are **not all additive**. Purchase/upgrade/replacement generation is nested inside transition time; sorting/Pareto/dedupe can be nested inside diversity; operation timers are nested inside search phases. The profiler output carries this warning structurally.

## Result semantics

Production and benchmark records keep these concepts separate:

- `legallyPathVerified`: domain replay succeeded.
- `bestFound`: best candidate found by the configured heuristic run.
- `locallyVerified`: configured direct terminal shop neighbourhood was fully audited with no checked improvement remaining.
- `bounded`: false for production heuristic runs. May be true only for an explicitly exact bounded benchmark case.
- `optimal`: false for production heuristic runs. In SMALL/EXACT it applies only to that stated bounded case when candidate and exact score match.

No global game optimality is implied.


## Recorded execution

BASELINE V0 was captured from `371a22e3bda9c015a7b1c5e19947db06c6fb7045` and stored by data commit `0f84bd091ac8c7d33d6ed18d3590ed2af690370f`.

Structured records:

- `benchmarks/optimizer-v1/references/baseline-v0.json`
- `benchmarks/optimizer-v1/baselines/baseline-v0.json`

The recorded 40k fixed-reference runs all completed only Width 4. The bounded SMALL/EXACT case has zero candidate-to-oracle gap. See `measurement-foundation.md` for the measured results and profiler caveats.

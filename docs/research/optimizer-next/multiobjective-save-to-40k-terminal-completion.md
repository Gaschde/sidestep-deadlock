# Multiobjective Save-to-40k Terminal Completion

Date: 2026-09-19

## Scope

This phase only aligns terminal materialization semantics for the experimental Multiobjective Beam with Production's legal save-to-horizon behavior.

Source implementation commit: `ce30bc2c0b74c406af578fd529054c13db7e2f55`

Measurement workflow: `35469715009`

Stored measurement commit: `03dd2e6faa03040bb908baa97a59db758871102f`

No Objective, Path-AUC, Endbuild evaluation, Pareto retention, dedupe identity, Beam Width, Diversity, search heuristic, evaluator, Afterburn model, item data, Product Search Budget or Production Beam behavior was changed in this phase.

## Verification

Workflow `35469715009` completed successfully.

Successful steps include:

- JavaScript tests
- 60 s 40k Multiobjective shadow experiment
- experiment artifact upload
- result storage on `feature/optimizer-next`

The workflow artifact is `optimizer-40k-multiobjective-shadow`.

The stored result files are:

- `benchmarks/optimizer-v1/experiments/40k-multiobjective-shadow/results.json`
- `benchmarks/optimizer-v1/experiments/40k-multiobjective-shadow/summary.json`

The result files identify `ce30bc2c0b74c406af578fd529054c13db7e2f55` as their source commit.

## Terminal semantics result

The former zero-terminal deadline failure is fixed for this experiment.

Across all six cases and both repeats:

- every Shadow repeat produced a non-empty terminal Pareto front;
- every reported terminal front is legal;
- scalarization remained disabled;
- the early Production-parity fallback was materialized;
- natural search and save-to-40k completion remain separately reported.

Therefore: 12/12 Shadow repeats now expose at least one legal terminal 40k candidate.

The fix is a terminal-availability fix, not proof that the latest retained partial nodes can always be materialized before the deadline. Infernus still frequently reaches the wall-clock boundary during the final retained-node refresh.

## 60 s measurement

| Case | Production Path / End | Shadow R1 Path / End | R1 front | Natural reach R1 / R2 | Search states R1 / R2 | Evaluations R1 / R2 | Save states R1 / R2 | R1 / R2 legal | Same final front hash |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Warden Weapon | 0.432077 / 0.476983 | 0.465214 / 0.486486 | 1 | 36.8k / 37.2k | 134,784 / 137,344 | 23,558 / 23,980 | 43,787 / 38,027 | yes / yes | no |
| Warden Spirit | 0.450626 / 0.502647 | 0.490137 / 0.522245 and 0.490135 / 0.522326 | 2 | 38.4k / 38.0k | 131,222 / 128,438 | 33,465 / 33,137 | 26,013 / 35,851 | yes / yes | no |
| Warden Hybrid | 0.440517 / 0.404127 | 0.475960 / 0.495847 | 1 | 37.2k / 37.2k | 131,218 / 133,738 | 31,275 / 31,506 | 43,467 / 40,049 | yes / yes | yes |
| Infernus Weapon | 0.344288 / 0.460321 | 0.499950 / 0.508418 | 1 | 12.0k / 12.0k | 14,084 / 14,084 | 4,046 / 4,046 | 306,631 / 343,577 | yes / yes | yes |
| Infernus Spirit | 0.326649 / 0.407173 | 0.496809 / 0.507230 | 1 | 13.2k / 13.2k | 17,074 / 17,074 | 4,406 / 4,406 | 239,748 / 43,986 | yes / yes | no |
| Infernus Hybrid | 0.335469 / 0.323753 | 0.335469 / 0.323753 | 1 | 14.0k / 13.6k | 21,929 / 20,477 | 4,267 / 3,898 | 14,409 / 357,153 | yes / yes | no |

The compact stored schema keeps the full Path/End contents for repeat 1 and hashes/telemetry for repeat 2. Repeat-2 quality can therefore be compared exactly only when the final-front hash matches repeat 1; otherwise the stored evidence proves a different legal front but does not preserve its full score vector.

## Production versus Multiobjective

Using the fully stored repeat-1 fronts:

- Warden Weapon: Shadow dominates Production on both Path-AUC and Endbuild.
- Warden Spirit: both terminal Shadow Pareto points dominate Production on both dimensions.
- Warden Hybrid: Shadow dominates Production on both dimensions.
- Infernus Weapon: Shadow dominates Production on both dimensions.
- Infernus Spirit: Shadow dominates Production on both dimensions.
- Infernus Hybrid: Shadow repeat 1 equals Production; it does not improve either dimension.

Production is absent from the combined front in five of six repeat-1 comparisons. It remains on the combined front only for Infernus Hybrid.

Approximate repeat-1 relative gains versus Production:

- Warden Weapon: Path +7.7%, End +2.0%.
- Warden Spirit: Path +8.8%, End +3.9%.
- Warden Hybrid: Path +8.0%, End +22.7%.
- Infernus Weapon: Path +45.2%, End +10.4%.
- Infernus Spirit: Path +52.1%, End +24.6%.
- Infernus Hybrid: no gain in repeat 1.

These are bounded 60 s search observations, not global-optimality claims.

## Natural reach and deadline behavior

Warden naturally reaches approximately 36.8k-38.4k Souls in repeat 1 and 37.2k-38.0k in repeat 2.

Infernus naturally reaches only approximately 12.0k-14.0k.

The early save-to-40k fallback begins from 400 Souls in every case. Final retained-node refreshes are cheap enough to complete for both Warden repeats, but remain deadline-sensitive for Infernus:

- Infernus Weapon R1: 4 final nodes attempted, 3 completed; deadline reached during final refresh.
- Infernus Weapon R2: 4/4 final nodes completed.
- Infernus Spirit R1: 3 final nodes attempted, 2 completed; deadline reached.
- Infernus Spirit R2: 1 attempted, 0 completed; only the early fallback survives.
- Infernus Hybrid R1: no final refresh could start; only the early fallback survives.
- Infernus Hybrid R2: 4/4 final nodes completed.

This is the remaining principal pathology. Legal terminal availability is now robust, but the quality of the terminal front can still depend strongly on whether the final retained-node refresh fits inside the wall-clock boundary.

## States and evaluations

The terminal save pass is small enough for Warden relative to the total run, but very large for Infernus because legal save completion traverses domain transitions repeatedly.

Representative save-completion state counts:

- Warden: roughly 26k-44k states per repeat.
- Infernus: from 14k when only the early fallback survives up to 357k when final retained nodes are fully completed.

Natural-search evaluations remain approximately:

- Warden: 23.6k-33.5k.
- Infernus: 3.9k-4.4k.

This phase does not alter that cost.

## Reproducibility

Width behavior is consistent: every Shadow repeat starts Width 4 and none naturally completes Width 4 inside 60 s.

Exact final-front hashes match between repeats in only 2/6 cases:

- Warden Hybrid
- Infernus Weapon

They differ in:

- Warden Weapon
- Warden Spirit
- Infernus Spirit
- Infernus Hybrid

The differing hashes correlate with wall-clock-sensitive natural reach and/or whether the final save refresh completes. This prevents treating the 60 s terminal front as fully stable yet.

## Pathologies

Confirmed remaining issues:

1. Infernus evaluation remains the natural-search bottleneck.
2. Legal save-to-40k completion can generate hundreds of thousands of transition states for Infernus.
3. Final terminal refresh is deadline-sensitive on Infernus.
4. Infernus Hybrid repeat 1 demonstrates the practical consequence: the run has a legal terminal front, but it is only the early fallback and is equal to Production.
5. Final-front hashes are not repeat-stable in four of six cases.
6. Warden path churn is materially lower in the measured Shadow winners than in Production, but this phase did not introduce any anti-churn rule.

## Decision

**B — terminalization works, but 40k search/terminal-front quality is not sufficiently stable yet.**

Why not A:

- the zero-terminal failure is fixed;
- five of six repeat-1 cases are already very encouraging;
- however, Infernus final completion remains deadline-sensitive and four of six cases do not reproduce the exact terminal front hash.

Why not C:

- there is no evidence that Save-to-40k terminal parity exposes a deeper semantic failure;
- all 12 repeats return legal terminal fronts;
- five of six fully stored repeat-1 comparisons dominate Production on both objectives.

Production remains unchanged and Multiobjective remains experimental.

Exactly one next step: investigate the remaining Infernus wall-clock bottleneck with measurement only before changing any search, evaluator or terminal-completion behavior.

# Optimizer V1 — Measurement Foundation

Status: **Implemented; BASELINE V0 recorded**
Branch: `feature/optimizer-next`

## Components

- Opt-in production Beam telemetry in `app/search-telemetry.mjs`.
- Version marker `SEARCH_OBJECTIVE_VERSION = "baseline-v0"`.
- Reproducible benchmark cases in `benchmarks/optimizer-v1/cases.mjs`.
- Comparison/gap helpers in `benchmarks/optimizer-v1/benchmark-lib.mjs`.
- CLI harness: `npm run benchmark:optimizer-v1`.
- Fixed benchmark references through the existing `suppliedReference` contract.
- SMALL/EXACT oracle through existing `search-core.mjs`.
- CI workflow that can capture BASELINE V0 on this branch when deliberately triggered with `[baseline]`.
- Production search remains Beam with its existing heuristics and defaults.

## Benchmark files

The baseline workflow stores structured outputs as:

- `benchmarks/optimizer-v1/references/baseline-v0.json`
- `benchmarks/optimizer-v1/baselines/baseline-v0.json`

The first file freezes the per-case reference. The second contains unprofiled benchmark results plus a separate profiling run.

## Non-goals preserved

This foundation does not:

- change Beam widths or retention rules;
- add phases or automatic milestones;
- change Damage/Survival weights;
- remove duplicate metrics;
- activate Branch-and-Bound;
- introduce a new solver;
- change canonical Deadlock data;
- claim global optimality.


## BASELINE V0 execution

Recorded from source commit `371a22e3bda9c015a7b1c5e19947db06c6fb7045`.
Structured data commit: `0f84bd091ac8c7d33d6ed18d3590ed2af690370f`.
Runner: Linux x64, Node v22.23.2, AMD EPYC 7763, 4 visible CPUs.

The benchmark score is always the unprofiled fixed-reference run. The separately profiled run is diagnostic only.

| Case | Score | Transactions | Cash | Local audit | Completed widths |
| --- | ---: | ---: | ---: | --- | --- |
| SMALL exact Warden Weapon | 0.485863 | 1 | 0 | yes | 64 |
| CONTROLLED Warden Hybrid | 0.417532 | 9 | 400 | yes | 8, 16 |
| CONTROLLED Infernus Hybrid | 0.436432 | 8 | 0 | yes | 8, 16 |
| 40k Warden Weapon | 0.517065 | 8 | 0 | no | 4 |
| 40k Warden Spirit | 0.543516 | 8 | 0 | yes | 4 |
| 40k Warden Hybrid | 0.404127 | 79 | 400 | yes | 4 |
| 40k Infernus Weapon | 0.418984 | 1 | 33,600 | no | 4 |
| 40k Infernus Spirit | 0.441490 | 2 | 32,800 | no | 4 |
| 40k Infernus Hybrid | 0.472851 | 2 | 27,200 | no | 4 |

The SMALL/EXACT candidate equals the exact oracle: absolute gap 0, relative gap 0, 7 expanded oracle states and 5 terminal states. This is an exact statement only for that bounded case.

All nine benchmark paths are legally replay-verified.

## Profiling observations

All six 40k production cases started and completed only Beam Width 4 before the search budget was exhausted. No production case reached Width 8 in BASELINE V0. Therefore “iterative widening” exists architecturally but does not yet provide a wider production pass under this runner/budget.

Measured evaluator cost per cache miss in the profiled 40k runs:

| Case | evaluation ms | evaluated inventories | ms / inventory |
| --- | ---: | ---: | ---: |
| Warden Weapon | 11,044 | 32,094 | 0.344 |
| Warden Spirit | 11,445 | 33,004 | 0.347 |
| Warden Hybrid | 5,705 | 16,117 | 0.354 |
| Infernus Weapon | 24,361 | 1,993 | 12.223 |
| Infernus Spirit | 24,132 | 2,117 | 11.399 |
| Infernus Hybrid | 24,212 | 2,105 | 11.502 |

On this runner, Infernus inventory evaluation is therefore roughly 32–36× slower per evaluated inventory than Warden. This is a measured implementation-performance fact for these cases, not a claim about hero/game complexity.

The profiler also reports large inclusive `trajectoryScoreMs`, `dedupeMs`, continuation and sorting times. These timers overlap: dedupe can trigger history scoring, scoring can trigger cached/evaluated metrics, and sorting/diversity can call scoring. They must not be added or interpreted as exclusive bottleneck shares without a follow-up exclusive profile.

Direct replacement-generation timing is also nested inside transitions. BASELINE V0 does **not** justify a claim that replacement generation is the dominant bottleneck.

## Observer effect

The profiled and unprofiled fixed-reference result matched in four of the six production cases. It differed in Warden Hybrid and Infernus Spirit. This does not indicate changed score semantics: instrumentation consumes wall-clock time and can change which states are reached before a fixed deadline.

This is why the authoritative BASELINE V0 score comes from the unprofiled run and profiler data is stored under `profilingRun`.

## Runtime caveat

BASELINE V0 is one wall-clock sample per case on one GitHub-hosted runner. Hardware is recorded, but no median/distribution is claimed. Repeated-run distributions can be added later without changing the benchmark contract.

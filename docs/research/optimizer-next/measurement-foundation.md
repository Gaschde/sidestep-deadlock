# Optimizer V1 — Measurement Foundation

Status: **Implemented; BASELINE V0 execution pending**
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

# Optimizer V1 — Objective / Buildpath Investigation

Status: **Experiment completed — revise, do not activate in Production**  
Branch: `feature/optimizer-next`  
Investigation start HEAD: `f1b318f945e2797208df95252c560e3dd19fdbff`  
A/B data commit: `3c0728acbeb0c7eb99fd6537d7c0805378d08b94`  
Objective candidate: `objective-v1a-soul-auc-terminal-gmean`

## 1. Confirmed starting state

The Production default remains `baseline-v0`.

Without explicit milestones, `normalizeMilestones(undefined, 40000)` yields only `[40000]`. The active scalar selection objective therefore primarily selects a held build at the 40k horizon rather than a full build path.

The existing code already contained two relevant foundations that were reused rather than rebuilt:

- `search-objective.mjs`: the current normalized Damage/Survival state utility;
- `trajectory-objectives.mjs`: older piecewise-constant Soul-axis and regret machinery, including the rule that same-Soul shop transactions have zero width and only the committed state matters.

The fixed benchmark references already contain a Soul axis: 400-Soul spacing for the current SMALL/CONTROLLED/40k benchmark contracts. They remain heuristic attainable sampled envelopes, not bounds or optima.

No canonical item/hero data, Afterburn mechanics, Beam widths, Beam retention/diversity rules, solver, opponent scenario or Production default was changed by this investigation.

## 2. Objective alternatives

| Variant | Meaning | Strength | Main problem |
| --- | --- | --- | --- |
| A. Milestones | Mean utility at configured checkpoints | Simple and already implemented | Checkpoint locations become implicit weights; neutral default collapses to 40k |
| B. Uniform Soul samples | Mean utility on an evenly spaced Soul grid | Approximates path quality without named phases | Still grid-dependent and is only an approximation to the underlying area |
| C. Piecewise-constant AUC | Integral of held-state utility over earned Souls | No Early/Mid/Late phases; exact on the modeled step function | Terminal point has zero measure and can be sacrificed |
| D. Regret vs reference | Integrated or worst relative shortfall from reference | Interpretable as distance to an envelope | Current reference is heuristic, not an optimum; clipped regret discards gains above reference and amplifies reference bias |
| E. Path/End multiobjective | Preserve trajectory and terminal quality as separate dimensions | Mathematically cleanest representation; no scalar trade-off required | Integrating it into current Beam selection/retention would be a Search change, which this experiment intentionally forbids |
| F. AUC + separate terminal, symmetric scalar | Path AUC and 40k utility combined without a 70/30 coefficient | Isolates trajectory change while remaining compatible with current scalar Beam API | The geometric mean still encodes a product preference and can interact badly with heuristic search |

A terminal constraint was also considered. It avoids a weighted sum but requires an externally justified minimum terminal threshold. Without such a threshold it merely moves the arbitrary choice from a weight into a constraint.

A lexicographic rule similarly avoids a numeric weight but makes one dimension categorically primary. That is a stronger product preference, not a neutral mathematical consequence.

## 3. Experimental V1A formula

The state utility is deliberately unchanged from `baseline-v0` so the A/B test isolates trajectory aggregation.

For a held state at Soul coordinate (s), let (U(s)) be the existing normalized scalar state utility:

- Damage group: 50%;
- Survival group: 50%;
- current Weapon/Spirit/Hybrid component weights unchanged;
- per-component normalization unchanged: (x/(x+r));
- current duplicate 10-second Damage rows intentionally preserved.

The path utility is

[
P = \frac{1}{H}\int_0^H U(s)\,ds
]

using the exact union of modeled path/reference breakpoints and piecewise-constant held states.

The terminal utility is kept separately:

[
E = U(H)
]

The experimental scalar used only for V1A search is

[
V = \sqrt{P E}
]

The geometric mean was chosen because it is symmetric and introduces no 70/30-style coefficient: either a weak path or a weak terminal build suppresses the result. This symmetry is still a conscious model/product choice, not a game law.

Same-Soul purchase/upgrade/replacement chains have zero integration width. Only the final committed held state at that Soul coordinate contributes to the following interval.

## 4. Why V1A was the experimental candidate

Pure AUC is insufficient because 40k is a measure-zero endpoint. A path can therefore have good area while ending badly.

Pure terminal scoring is the current product problem.

Integrated regret was not selected because the frozen reference is an experimental comparison control, not a proven optimum. Using clipped regret as the primary score would give that heuristic envelope stronger semantic authority than it has.

A two-dimensional Path/End Pareto objective is mathematically cleaner, but changing Beam retention/ranking to use it would mix an Objective experiment with a Search-Heuristic change. V1A was therefore the strongest isolated scalar experiment compatible with the current Beam API.

## 5. Implementation

Commit `1527122d990b2e0eb3dbdbf8cc0b9dde52a915f9`:

- adds `app/search-objective-v1.mjs`;
- adds explicit scorer injection to Beam while keeping `scoreMilestonePath` as the default;
- adds Objective V1A unit tests.

Commit `89fdc2e77821699bc259454c2c730bee91facbf2`:

- extends the existing benchmark harness with explicit objective selection;
- keeps the same frozen `baseline-v0` references;
- records common Path/End observables instead of comparing raw scores across objective scales;
- records purchase timing, transaction counts and longest no-shop Soul span;
- adds the dedicated A/B workflow.

The Production caller does not pass an experimental scorer, so its default objective remains `baseline-v0`.

## 6. A/B benchmark results

Workflow run `35459284864` completed successfully. Both sides ran on the same GitHub-hosted runner, same code state, data, cases, item sets, opponent resistances, slots, wall-clock budgets, Beam settings and frozen references. Profiling was disabled for both result runs.

Raw objective scores are not compared because the objectives have different semantics. The table uses shared V1A Path and End observables to cross-evaluate both resulting paths.

| Case | Δ Path | Δ 40k/End | Transactions V0→V1A | First buy V0→V1A | Completed widths V0→V1A |
| --- | ---: | ---: | ---: | ---: | --- |
| SMALL Warden Weapon | 0 | 0 | 1→1 | 800→800 | 64→64 |
| CONTROLLED Warden Hybrid | +0.004538 | -0.002971 | 9→8 | 1600→800 | 8,16→8,16 |
| CONTROLLED Infernus Hybrid | +0.005160 | -0.006643 | 8→9 | 1600→1600 | 8,16→8,16 |
| 40k Warden Weapon | 0 | -0.002024 | 9→8 | 40000→40000 | 4→4 |
| 40k Warden Spirit | 0 | 0 | 8→8 | 40000→40000 | 4→4 |
| 40k Warden Hybrid | **-0.159690** | **+0.118825** | **79→8** | **800→40000** | **4,8→4** |
| 40k Infernus Weapon | 0 | -0.046031 | 3→2 | 40000→40000 | 4→4 |
| 40k Infernus Spirit | 0 | -0.051254 | 3→2 | 40000→40000 | 4→4 |
| 40k Infernus Hybrid | 0 | +0.163199 | 0→3 | none→40000 | 4→4 |

Summary:

- 9/9 resulting paths are legally replay-verified.
- 2/9 improve shared Path utility.
- 4/9 do not regress terminal utility.
- **0/9 both improve Path utility and preserve terminal utility.**
- SMALL/EXACT has zero exact gap under both V0 and V1A for its own objective.
- Both CONTROLLED cases improve Path utility under V1A but lose terminal utility.
- In full 40k Production cases, V1A does not produce an actual early build path: every V1A Production result makes its first transaction at 40k.

The result therefore fails the central product goal.

## 7. Buildpath differences

CONTROLLED Warden demonstrates that the new objective can change behavior in the intended direction: first purchase moves from 1600 to 800 Souls and the longest no-shop interval falls from 1600 to 1200 Souls.

However, the full-space behavior does not generalize. All six V1A 40k results save to the terminal coordinate before shopping.

The strongest counterexample is Warden Hybrid:

- V0 found a 79-transaction path beginning at 800 Souls;
- V1A found only eight terminal purchases at 40k;
- the V0 path, when cross-scored under the V1A formula, is also better than the V1A-found path.

Therefore the failure cannot be explained as “V1A intentionally prefers the 40k-saving path”. The current V1A-guided heuristic search failed to recover a path that another objective-guided run already demonstrated to be superior under V1A itself.

## 8. Endbuild differences

The separate terminal term does influence selection, but it does not guarantee non-regression.

Examples:

- CONTROLLED Warden: Path improves, End regresses by 0.002971.
- CONTROLLED Infernus: Path improves, End regresses by 0.006643.
- 40k Infernus Weapon/Spirit: no Path gain, but End regresses materially.
- 40k Warden Hybrid and Infernus Hybrid produce stronger terminal utility, but without an actual pre-40k purchase path.

A geometric mean therefore does not provide the product guarantee “improve the path without legitimizing a worse endbuild”. It merely prices the trade-off symmetrically.

## 9. Falsification / counterexamples

### Unnecessarily early purchases

CONTROLLED Warden buys at 800 instead of 1600 and gains Path utility, so earlier buying can be rewarded as intended. The experiment does not prove that every early purchase is useful in game terms; it only proves higher modeled held-state utility.

### Meaningful saving

V1A does not mechanically force constant spending: controlled paths retain gaps. But at Production scale it fails in the opposite direction and still allows complete 0→40k saving.

### Cheap intermediate churn

There is evidence of a potential new bias:

- CONTROLLED Warden repeatedly uses `upgrade_health_stimpak` as a bridge, replaces it, repurchases it, replaces it again, then repurchases it.
- CONTROLLED Infernus sells `upgrade_headshot_booster` and later buys it again.

These paths are legal, but they show that AUC can make cheap temporary utility attractive enough to create churn. This must be treated as a counterexample risk, not automatically as desirable buildpath behavior.

### Endbuild sacrifice

Observed directly in both CONTROLLED cases and several 40k cases. V1A does not satisfy a hard terminal-quality guarantee.

### Low-vs-high Soul dominance

The integral gives equal measure to equal Soul intervals; there are no named Early/Mid/Late weights. An early improvement contributes longer only because it is held longer across the Soul axis. That is the intended mathematical meaning of AUC, but it also creates legitimate pressure toward cheap early utility.

### Upgrades / Sell / Replace

No V1A benchmark winner used a formal upgrade event, so this run does not establish upgrade neutrality. Sell/replacement churn does appear in CONTROLLED cases, so this concern remains active.

### Reference bias

Both A/B sides use the same frozen reference, so the observed differences are not caused by reference drift. Nevertheless V1A consumes the reference along the full Soul axis rather than only at the terminal point, so any shape bias in the heuristic reference matters more to V1A. It must still never be described as an optimum or admissible bound.

### Soul-axis discretization

A regression test verifies that inserting redundant Soul-axis subdivisions does not change V1A when the underlying actual/reference step functions do not change. Therefore the integral itself is not a simple sample-count artifact.

The Production search still operates on the project's modeled economic axis. Changing that axis can expose different legal decision coordinates and is therefore a separate domain/search-model experiment; this investigation does not claim invariance to changing decision opportunities.

### Objective/Search compatibility

This is the most important falsification result.

V1A scoring is richer than terminal-only scoring. Under the same wall-clock budget it can reduce search coverage. In 40k Warden Hybrid, V0 completed widths 4 and 8 while V1A completed only width 4. More importantly, V0 found a path that scores better under V1A than V1A's own winner.

This means Production failure cannot be fixed by declaring the mathematical formula correct. Objective semantics and heuristic discoverability must be evaluated together.

## 10. Damage / Survival findings

The three 10-second Damage rows remain mathematically identical in the compact evaluator. They therefore still create accidental metric-count weighting inside the Damage group.

They were intentionally **not** changed in V1A. Removing/collapsing them in the same experiment would have made it impossible to attribute path differences to Soul-axis aggregation.

The same is true for the existing 50/50 Damage/Survival split, focus weights and (x/(x+r)) normalization: they remain explicit product/model preferences and were held constant.

A future duplicate-metric experiment should be a separate hypothesis, not folded into the Buildpath A/B.

## 11. Tests / CI

Verified:

- Objective V1A unit tests pass.
- Same-Soul transactions contribute zero integration width.
- A stronger earlier path beats a later path when terminal utility is equal.
- A weak terminal state is separately penalized while leaving the AUC endpoint contribution at zero width.
- Redundant Soul-axis subdivisions leave the exact step-function integral unchanged.
- SMALL/EXACT candidate-to-oracle gap is zero for both objectives.
- All nine A/B paths are legally replay-verified.
- Dedicated A/B workflow `35459284864`: success.

The A/B benchmark data is stored under:

`benchmarks/optimizer-v1/experiments/objective-v1a/`

## 12. Decision

**B — Objective V1A must be revised.**

What survives the experiment:

- piecewise-constant Soul-axis AUC is a better-founded Path measurement than invented match phases or arbitrary milestone defaults;
- terminal quality must remain a separate concept;
- frozen shared references and common cross-objective observables are the correct A/B method.

What does not survive:

- the geometric-mean scalar has not demonstrated the required Path/End behavior;
- changing only the scalar objective does not make the current full-scale heuristic produce a useful build path;
- V1A must not replace `baseline-v0` in Production.

## One next step

Build an **objective-isolation Path-vs-End Pareto experiment** on bounded SMALL/CONTROLLED legal candidate sets: retain ((P,E)) as two separate dimensions, enumerate or reuse a fixed candidate set, and measure whether V1A's scalarization is discarding desirable non-dominated paths **before making any Beam/Search change**.

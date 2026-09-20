# Objective Contract V1 — Questions Before a Production Objective Change

Status: **Specification only — not activated**
Baseline objective: `baseline-v0`

The next objective must be justified against BASELINE V0. This document defines the questions and evidence gates; it does not select or implement a new production score.

## 1. Endbuild vs Buildpath

Before changing the objective, define which product question is primary:

- strongest held build at the terminal budget;
- strongest purchase trajectory over the Soul axis;
- or an explicit combination of both.

The same contribution must not be counted twice merely because it appears in both terminal and trajectory summaries. A path objective must evaluate legal held states, not invented match phases.

## 2. Independent Damage dimensions

For every proposed Damage dimension, document its formula and show whether it adds independent information.

Baseline V0 has five named Damage rows, but the compact evaluator currently defines:

- lane trade = `damageAt(10)/10`;
- farm = `damageAt(10)/10`;
- teamfight = `damageAt(10)/10`.

Those three are mathematically identical, including Bullet/Spirit components. Their presence in V0 is a baseline fact, not evidence that three independent dimensions exist.

A V1 proposal must explicitly choose how redundancy is treated and benchmark the consequence. Do not simply delete rows because their names look redundant.

## 3. Independent Survival dimensions

Baseline V0 separates Bullet and Spirit survival capacity. V1 must state:

- which incoming damage types are genuinely distinct;
- which recovery terms belong in each dimension;
- the comparison window;
- whether a survival metric is raw EHP, recoverable capacity, or another defined quantity;
- whether two proposed rows are algebraically or empirically redundant.

No opponent behaviour, hit rate or proc uptime may be invented to create extra dimensions.

## 4. Redundant metrics

For every duplicate/highly dependent metric, V1 must choose an explicit policy such as:

- keep it intentionally with a declared weight;
- collapse it into one basis dimension;
- or replace it with a genuinely different, documented window/mechanic.

The choice is a product/model decision and needs A/B evidence. Metric count must not accidentally become weight.

## 5. Normalization

Baseline uses `x/(x+reference)`. Any V1 normalization must specify:

- mathematical range and monotonicity;
- behaviour at zero;
- scaling sensitivity;
- how improvements above/below reference behave;
- whether different metric units become comparable for the intended reason;
- numerical stability.

A reference-normalized score is not meaningful unless the reference contract is fixed at comparison time.

## 6. Reference

Separate two questions:

- What reference is mathematically appropriate for the objective?
- How is that reference obtained reproducibly within product constraints?

Baseline production uses a heuristic attainable sampled envelope, not a bound. Benchmark V0 can freeze that existing reference through `suppliedReference`.

V1 must not call a heuristic reference an optimum or admissible upper bound. If the reference algorithm changes, that is a separate experiment from changing the objective whenever possible.

## 7. Damage-vs-Survival policy

The current 50/50 split and Weapon/Spirit/Hybrid focus weights are conscious product preferences, not game laws.

V1 must identify:

- which weights are mathematical necessities, if any;
- which are product preferences;
- whether user focus changes dimensions, weights, constraints, or only presentation;
- how sensitivity to reasonable weight changes is measured.

No weight should be changed because one benchmark “looks better”.

## 8. Trajectory evaluation

If buildpath quality matters, V1 must define:

- the held-state function along Souls;
- treatment of purchases/replacements at the same Soul coordinate;
- whether terminal value is separately weighted;
- whether trajectory uses checkpoints, integral/area, worst regret, or another functional;
- how reference values between recorded points are defined.

The evaluator must remain compatible with legal path replay.

## 9. Soul axis

Baseline with no milestones effectively samples only 40k for the active selection objective.

A future **Soul-axis integration / area-under-curve** objective is a serious alternative to invented Early/Mid/Late phases because it can evaluate the whole economic axis without naming arbitrary match stages.

Before adopting it, establish:

- exact integration semantics (for example piecewise-constant held state);
- reference semantics along the same axis;
- whether all Soul coordinates or a proven equivalent event grid are needed;
- runtime cost;
- how sells/replacements at equal Souls are represented;
- whether early improvements become unintentionally over-weighted merely because they persist longer.

This is an experiment target, not part of this foundation.

## 10. Reproducibility

Every objective comparison must pin:

- commit;
- dataset/patch;
- case;
- item set;
- hero/role/focus;
- budget/slots;
- opponent scenario;
- milestones or Soul-axis contract;
- time/work budget;
- objective version;
- reference version;
- hardware when wall-clock search is involved.

If these differ, the harness must not make a direct “better” claim.

## 11. Mathematical vs product choices

Examples of mathematical/model-contract questions:

- metric algebra and redundancy;
- monotonicity/normalization formula;
- integration semantics;
- legal-state/path consistency;
- exact-oracle gap in bounded cases.

Examples of conscious product preferences:

- Damage-vs-Survival weighting;
- Weapon/Spirit/Hybrid emphasis;
- whether terminal strength or path quality matters more;
- acceptable runtime/search budget;
- which user-facing trade-off is selected from non-dominated candidates.

Both must be explicit; product preferences must not be disguised as mathematical truths.

## 12. Gate for Objective V1

Do not switch production until a candidate Objective V1 has:

- a named/versioned formula;
- fixed-reference A/B results on SMALL, CONTROLLED and all applicable PRODUCTION cases;
- exact-gap evidence on bounded cases;
- documented treatment of current duplicate 10 s metrics;
- sensitivity analysis for product weights;
- no legality regression;
- no unsupported game assumptions;
- reproducibility metadata sufficient to rerun the comparison.

Only after that evidence should the production objective change be considered.

# Sidestep Deadlock

> A data-driven, auditable build optimizer for Deadlock.

Sidestep turns a hero, budget, and gameplay objective into a reproducible build analysis. Instead of treating a build as a static list of popular items, it evaluates verified game data, legal purchase paths, upgrade costs, inventory limits, power spikes, and explicit combat assumptions.

## Why Sidestep is different

Most build lists answer **what to buy**. Sidestep is designed to answer **why this build wins under these exact conditions**.

- **Traceable conclusions:** Important values remain linked to canonical hero, item, effect, and source IDs.
- **Patch-safe analysis:** Core and hero manifests must agree on patch and game mode before a result is accepted.
- **Complete purchase paths:** The optimizer evaluates component consumption, upgrade payments, category investments, threshold bonuses, budget checkpoints, normal slots, Walker slots, and active-item limits—not just the final inventory.
- **Explicit assumptions:** Conditional effects and proc scenarios are opt-in. They are never silently treated as permanently active.
- **Safety around incomplete mechanics:** Unhandled effects, unresolved downsides, API conflicts, and missing interactions are surfaced as warnings instead of being hidden inside a score.
- **Transparent comparisons:** Score profiles expose their metrics and weights, hard minimum requirements remain separate, and Pareto results preserve meaningful damage-versus-survivability trade-offs.
- **Reproducible results:** The same data, constraints, candidate pool, and scenario produce the same output.
- **Conservative data updates:** API snapshots are versioned and reviewed; they cannot silently overwrite the canonical research dataset.

Sidestep does not claim to know what the data cannot prove. A missing interaction means **unknown**, not automatically “works” or “does not work.”

## Current status

The repository already contains:

- a verified, patch-specific dataset for items, heroes, abilities, progression, global mechanics, and documented special interactions;
- a deterministic calculator for evaluating a specified build;
- a bounded beam search for comparing builds within an explicit candidate space;
- legal purchase-path generation with component upgrades and budget checkpoints;
- target profiles, hard stat requirements, transparent score profiles, Pareto selection, and marginal item-value reporting;
- a versioned Deadlock Assets API import and review workflow;
- automated tests for the calculator, path generation, search, and API importer.

The optimizer is intentionally described as **best evaluated**, not globally optimal. Beam search can discard intermediate candidates, and several systems still require explicit assumptions or further implementation—including sales, objective timing, hit/headshot rates, and automatically estimated proc uptime.

## Quick start

Sidestep uses Python and the repository's local datasets. No installation step is required for the core command-line tools.

Evaluate a specific build:

```text
python tools/calculate_build.py warden --boon 35 --walker-slots 3 \
  --item upgrade_close_quarter_combat \
  --item upgrade_titan_round
```

Search a bounded public item pool:

```text
python tools/search_builds.py warden --boon 20 --budget 9600 \
  --items 6 --beam-width 250
```

Add explicit constraints or a target profile:

```text
python tools/search_builds.py warden --boon 35 --budget 56000 \
  --items 12 --walker-slots 3 \
  --minimum-budget-utilization 0.9 \
  --minimum-stat max_health=4500 \
  --minimum-stat move_speed=6.5 \
  --target-bullet-resist 30 \
  --target-spirit-resist 20
```

Command output is JSON so calculations, warnings, score components, purchase steps, checkpoints, and marginal values can be inspected or consumed by another interface.

See [the engine documentation](docs/engine.md) for the complete feature set, scenario controls, score profiles, and known limitations.

## Using Sidestep with Codex

The repository can also be opened as a Codex project. For example:

> Create a survivability-focused build for Abrams at a 16,000 Soul budget. Compare the strongest evaluated alternatives and explain every important assumption.

Codex follows the repository's analysis contract:

- [AGENTS.md](AGENTS.md) contains the binding project rules.
- [docs/prompts/build_optimizer.md](docs/prompts/build_optimizer.md) defines the complete analysis procedure.
- [docs/schemas/build_request_schema.md](docs/schemas/build_request_schema.md) defines inputs and assumptions.
- [docs/schemas/build_result_schema.md](docs/schemas/build_result_schema.md) defines a verifiable result.
- Results are saved under `builds/` only when explicitly requested.

A result may only be called **optimal** when the objective, constraints, and relevant search space are fully defined and covered. Otherwise, Sidestep uses **best evaluated build**.

## How the data is organized

```text
Verified research
  -> canonical data
  -> deterministic calculator and bounded search
  -> validated, explainable result
```

| Path | Purpose |
|---|---|
| `data/core/` | Items, costs, upgrades, investments, slots, objectives, and global mechanics |
| `data/heroes/` | Hero stats, abilities, upgrades, resources, progression, and summons |
| `data/interactions/` | Verified special interactions |
| `engine/` | Data loading, calculation, path validation, auditing, and bounded search |
| `docs/research/` | Source verification, dataset coverage, exclusions, and audit reports |
| `docs/schemas/` | Data, request, interaction, API import, and result contracts |
| `docs/prompts/` | Required build-analysis procedure and final validation checklist |
| `archive/api/` | Versioned API snapshots and review-only comparisons |
| `tests/` | Optimizer and importer tests plus offline API fixtures |

`data/core/`, `data/heroes/`, and `data/interactions/` are authoritative. Research records and API mappings provide evidence and review context, but they never silently replace missing canonical values.

## Calculation principles

Sidestep keeps concepts separate when combining them would create misleading results:

- cash paid versus current category investment;
- base stats versus level growth, ability upgrades, item stats, and investment bonuses;
- permanent effects versus conditional effects and theoretical maximum uptime;
- bullet resistance reduction, penetration, and damage amplification;
- ability cooldown, charge-up time, charge count, and charge restoration;
- final-build strength versus the quality and legality of the path used to reach it.

Every final recommendation must pass a second validation of costs, upgrade edges, investments, thresholds, slots, effects, references, and confidence warnings.

## Deadlock API comparison

`tools/sync_deadlock_api.py` stores technical snapshots by client version under `archive/api/`. A normal import does not modify `data/core/` or `data/heroes/`.

Run an offline comparison with the included fixtures:

```text
python tools/sync_deadlock_api.py \
  --fixture-dir tests/fixtures/deadlock_api \
  --dry-run
```

Fetch a current snapshot:

```text
python tools/sync_deadlock_api.py
```

New, conflicting, or missing records appear in `review_required.json`. Applying a change requires an explicit approval file containing exact `change_id` values from the same diff. Unknown fields remain preserved in the raw archive and schema observations.

See [archive/api/README.md](archive/api/README.md) and [docs/schemas/api_import_schema.md](docs/schemas/api_import_schema.md) for the full integrity contract.

## Guiding principle

Sidestep should never produce false precision. Its purpose is to make a build's assumptions, trade-offs, purchase path, calculations, and remaining uncertainty visible enough for another person to verify.

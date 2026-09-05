# Sidestep Deadlock

> A data-driven build assistant for Deadlock.

Sidestep is designed to turn a selected hero and gameplay objective into a transparent, explainable build. It uses verified, patch-specific data for items, costs, abilities, upgrades, slots, and special interactions.

## Project goal

The finished assistant should:

1. capture the hero, playstyle, and match context;
2. compare suitable and legally purchasable item paths;
3. calculate costs, upgrades, category investments, and slot usage;
4. account for relevant hero stats, abilities, and interactions;
5. return a justified purchase order with alternatives and clearly stated uncertainties.

Recommendations should not come from guesswork or unsupported model knowledge. Every important value must be traceable to the local data.

## What makes Sidestep different

Sidestep is intended to make the reasoning behind a build inspectable instead of only presenting a final item list:

- **Traceable:** Every recommendation includes its assumptions, calculations, and relevant data sources.
- **Patch-specific:** Core and hero data are checked for matching patches and game modes before analysis.
- **A purchase path, not just an item list:** Costs, component upgrades, power spikes, category investments, and available slots are considered at every step.
- **Honest about knowledge gaps:** Missing or conflicting interactions are identified instead of being replaced with guesses.
- **Tailored to the objective:** Builds are compared using the selected hero, budget, playstyle, and desired strengths rather than a generic list.
- **Tested against alternatives:** Core items should be compared with serious alternatives and concrete conditions under which another choice becomes better.

The goal is not merely to produce “a popular build,” but to answer: **Why does this build fit these conditions better?**

## Current status

Already available:

- verified core, hero, and interaction datasets;
- documented sources, patch states, and uncertainties;
- a defined procedure for build analysis;
- a conservative comparison workflow for the Deadlock Assets API;
- an initial local web interface for selecting and displaying data.

Not finished yet:

- The web interface does not contain a real optimization engine yet.
- Its purchase order uses simple **test logic** and is not a build recommendation.
- Complete damage, survivability, uptime, and marginal-value calculations are not integrated into the app.
- An optimized ability-point order is not calculated yet.

## Run the local web app

A current Node.js version is required. No additional npm packages are currently needed.

```text
npm start
```

The app is then available at `http://127.0.0.1:4173/app/`.

Run the tests with:

```text
npm test
```

## Build analysis with Codex

The repository can also be used directly as a Codex project. For example:

> Create a tank build for Abrams. I usually play with my team and want to survive on the front line for as long as possible.

The following files define how build requests are handled:

- `AGENTS.md` contains the binding project rules.
- `prompts/build_optimizer.md` defines the complete analysis procedure.
- `schemas/build_request_schema.md` defines inputs and assumptions.
- `schemas/build_result_schema.md` defines a verifiable result.
- Results are only saved under `builds/` when explicitly requested.

A build may only be called “optimal” when its objective, constraints, and search space are fully defined and evaluated. Otherwise, it is described as the “best evaluated build.”

## Data foundation

```text
Research
  → canonical data
  → build analysis
  → justified recommendation
```

| Path | Contents |
|---|---|
| `data/core/` | Items, costs, upgrades, investments, slots, objectives, and global mechanics |
| `data/heroes/` | Hero stats, abilities, upgrades, resources, and summons |
| `data/interactions/` | Verified special interactions |
| `research/` | Source verification, dataset coverage, and audit reports |
| `schemas/` | Data, request, and result contracts |
| `prompts/` | Build-analysis procedures |
| `data/api/` | Technical API snapshots and review-only comparisons |

`data/core/`, `data/heroes/`, and `data/interactions/` are the authoritative sources. Files under `research/` and `data/api/` must not silently replace missing canonical data. Missing or conflicting values remain explicitly uncertain.

For more detail, see:

- `PROJECT_CONTEXT.md` — current project state, decisions, and open questions;
- `PROJECT_STRUCTURE.md` — repository structure and explanations of important files.

## Compare data with the Deadlock API

The API importer stores technical snapshots under `data/api/`, separated by client version. A normal import does not modify the canonical datasets.

Run an offline test with the included fixtures:

```text
python tools/sync_deadlock_api.py --fixture-dir tests/fixtures/deadlock_api --dry-run
```

Fetch a current snapshot:

```text
python tools/sync_deadlock_api.py
```

New, conflicting, or missing values are written to `review_required.json`. Applying a change requires a separate approval file containing specific `change_id` values. See `data/api/README.md` and `schemas/api_import_schema.md` for details.

## Guiding principle

Sidestep should not only say **which** items to choose. It should make it possible to understand **why** a build performs better under the stated conditions and how confident that conclusion is.

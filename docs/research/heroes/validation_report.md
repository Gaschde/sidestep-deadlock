# Validation Report

Gesamtstatus: **PASS_WITH_WARNINGS**

| Prüfung | Status | Datei | Betroffene Datensätze | Erklärung | Unsicherheit |
|---|---|---|---:|---|---|
| Unique hero_id | PASS | `data/heroes/heroes.csv` | 0 | No duplicate hero IDs. | — |
| Unique ability_id | PASS | `data/heroes/abilities.csv` | 0 | No duplicate ability IDs. | — |
| Unique composite effect IDs | PASS | `data/heroes/ability_mechanics.csv` | 0 | Composite keys are unique. | — |
| Hero foreign keys | PASS | `data/heroes + data/interactions` | 0 | All hero references resolve. | — |
| Ability foreign keys | PASS | `data/heroes + data/interactions` | 0 | All ability references resolve. | — |
| Effect references | PASS | `ability_upgrades.csv; hero_interactions.csv` | 0 | All ability effect references resolve. | — |
| Summon references | PASS | `summon_mechanics.csv` | 0 | All summon references resolve. | — |
| Core entity references | PASS | `data/interactions/hero_interactions.csv` | 0 | All present Core references use exact registered IDs. | — |
| Exact Core item/effect ID usage | PASS | `data/interactions/hero_interactions.csv` | 0 | Every documented item interaction uses an exact Core item_id::effect_id reference. | HUNC-0004 |
| Source namespace union | PASS | `all datasets` | 0 | Every SRC-/HSRC-ID resolves in the union of both registries. | — |
| Units on numeric/effect values | PASS | `mechanics/upgrades/interactions` | 0 | Every populated value has a unit. | — |
| Scaling attribute/coefficient pairs | PASS | `ability_mechanics.csv; summon_mechanics.csv` | 0 | Every scaling coefficient has an attribute and vice versa. | — |
| Numeric values outside notes | PASS | `mechanics/upgrades/interactions` | 0 | No gameplay number exists only in notes. | — |
| Base cooldown consistency | PASS | `abilities.csv; ability_mechanics.csv` | 0 | Registry cooldowns match their atomic ability_cooldown effects. | — |
| Cooldown/charge/resource separation | PASS | `abilities.csv; hero_resources.csv` | 0 | Cooldown, charge restore, ability charges, and hero resources use separate fields/registers. | — |
| Confidence vocabulary | PASS | `all datasets` | 0 | Only high/medium/low are used. | — |
| Low confidence with uncertainty | PASS | `all gameplay datasets` | 0 | No low-confidence gameplay row lacks an uncertainty link. | — |
| Secondary-source-only rows | PASS | `all gameplay datasets` | 0 | No gameplay record relies solely on a secondary source. | — |
| Forbidden domain | PASS | `data/heroes/sources.csv` | 0 | No deadlockwiki.org URL is registered. | — |
| Public hero count | PASS | `data/heroes/heroes.csv` | 38 | 38 publicly playable heroes match the post-patch roster. | — |
| Ability count | PASS | `data/heroes/abilities.csv` | 159 | 152 base slots, three Silver transformation replacements, and four explicit Innates are registered. | — |
| Current-patch Celeste values | PASS | `ability_mechanics.csv; ability_upgrades.csv` | 0 | All eleven August 22 hero changes resolve to the current structured values. | — |
| Item interaction evidence | WARNING | `data/interactions/hero_interactions.csv` | 21 | Documented Melee/Heavy-Melee item interactions are included; the complete Item×Ability matrix remains open and no undocumented row was invented. | HUNC-0004 |
| Summon inheritance evidence | WARNING | `data/heroes/summons.csv` | 7 | Created-unit values are present, but inheritance/proc/objective behavior is not fully exposed. | HUNC-0005 |
| HeroData patch synchronization | WARNING | `docs/research/heroes/page_sync_audit.csv` | 1 | HeroData predates the latest patch; patch scope indicates no later base-stat edit, but full client sync remains unproven. | HUNC-0002 |
| Stale/non-synchronized pages | WARNING | `docs/research/heroes/page_sync_audit.csv` | 2 | HeroData and the rendered comparison table predate the latest patch; neither overrides the current AbilityData export. | HUNC-0002; HUNC-0007 |
| Objective/proc/summon evidence boundary | PASS | `ability_mechanics.csv; hero_interactions.csv` | 0 | Only explicit structured target-class fields are emitted; undocumented application is preserved as uncertainty. | HUNC-0004; HUNC-0005 |
| Model-knowledge substitution | PASS | `all generated datasets` | 0 | Values originate from cached deadlock.wiki primary data or explicit patch notes; exclusions are logged. | — |
| Core patch compatibility | PASS | `data/core/manifest.json` | 0 | Core patch is Minor Update - 08-22-2026; hero patch is Minor Update - 08-22-2026. | — |
| Manifest row-count agreement | PASS | `data/heroes/manifest.json` | 0 | Manifest counters are generated from actual in-memory row counts: {"hero_count":60,"publicly_playable_hero_count":38,"documented_nonpublic_hero_count":22,"ability_count":159,"ability_effect_count":3211,"ability_upgrade_count":896,"summon_count":7,"interaction_count":93,"source_count":15,"uncertainty_count":6}. | — |
| Build/meta recommendation exclusion | PASS | `all generated datasets` | 0 | No build, tier-list, matchup or skill-order recommendation fields were generated. | — |

Gezählt: 60 Heldenregisterzeilen, 159 Fähigkeiten, 3211 atomare Fähigkeitseffekte, 896 Upgrade-Änderungen, 7 Beschwörungen/erschaffene Einheiten und 93 verifizierbare Sonderinteraktionen.

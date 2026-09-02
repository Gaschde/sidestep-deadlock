# Hero-Datenschema

Alle CSV-Dateien sind UTF-8-kodiert und besitzen genau eine Kopfzeile. Leere CSV-Felder und JSON-`null` bedeuten „nicht verifiziert oder nicht anwendbar“, niemals einen bestätigten Nullwert. `source_ids` ist ein JSON-Array in einem korrekt maskierten CSV-Feld.

## Gemeinsame Typen und Namensräume

- IDs: UTF-8-Strings in `snake_case`; `hero_id`, `ability_id`, `summon_id` und `resource_id` sind in ihrem jeweiligen Register eindeutig.
- Zahlen: Ganzzahl oder Dezimalzahl mit Punkt. Prozentwerte verwenden `percent`, additive Prozentpunkte `percentage_points`, Faktoren `multiplier`.
- Zeit: Sekunden; Entfernungen: Meter; Geschwindigkeiten: `units_per_second`.
- `confidence`: exakt `high`, `medium` oder `low`. Low verlangt normalerweise einen Eintrag in `uncertainties.csv`.
- Quellen: Hero-Quellen `HSRC-*` verweisen auf `data/heroes/sources.csv`; Core-Quellen `SRC-*` auf `data/core/sources.csv`.
- Unsicherheiten: `HUNC-*` sind Hero-Fragen; `UNC-*` bleiben Core-Fragen.
- Effektverweis: `ability_id::effect_id`. Der zusammengesetzte Primärschlüssel in `ability_mechanics.csv` ist `(ability_id,effect_id)`.

## Tabellen

| Datei | Primärschlüssel | Fremdschlüssel | Nullfähige Felder |
|---|---|---|---|
| `heroes.csv` | `hero_id` | `source_ids` | `notes` |
| `hero_stats.csv` | `(hero_id,stat_id)` | `hero_id`, `source_ids` | `base_value`, `value_per_level`, `max_value`, `condition`, `calculation_rule`, `notes` |
| `abilities.csv` | `ability_id` | `hero_id`, `source_ids` | Cooldown-/Charge-Felder und `notes` |
| `ability_mechanics.csv` | `(ability_id,effect_id)` | `ability_id`, `source_ids` | Skalierung, Regeln, Bedingungen, Ziel-/Stack-/Zeitfelder, `notes` |
| `ability_upgrades.csv` | `(ability_id,upgrade_id,mechanic)` | `ability_id`, `effect_reference`, `source_ids` | `value`, `unit`, `condition`, `notes` |
| `summons.csv` | `summon_id` | `hero_id`, `ability_id`, `source_ids` | nicht verifizierte Lebensdauer-, Ziel-, Targetability- und Klassifikationsfelder |
| `summon_mechanics.csv` | `(summon_id,effect_id)` | `summon_id`, `source_ids` | Skalierung, Bedingungen, Stack-/Zeitfelder, `notes` |
| `hero_resources.csv` | `(hero_id,resource_id)` | `hero_id`, `source_ids` | Grenzen, Start-, Verfalls-, Verbrauchs- und Resetregeln |

`progression.json` ist ein Objekt. Es referenziert globale Regeln, trennt Ability Points strikt von Item-Investment und verweist für Wachstum auf `hero_stats.csv:value_per_level`.

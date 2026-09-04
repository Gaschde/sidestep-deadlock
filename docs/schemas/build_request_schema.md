# Build-Request-Schema

Dieses Schema beschreibt die normalisierte Eingabe einer Deadlock-Build-Analyse. Der Nutzer muss nicht alle Felder selbst angeben; fehlende optionale Felder werden als offene Annahmen dokumentiert.

| Feld | Erforderlich | Typ | Bedeutung |
|---|---|---|---|
| `hero_id` | ja | string | Exakte ID aus `data/heroes/heroes.csv`. |
| `objective` | ja | string | Messbares primäres Optimierungsziel. |
| `mode` | nein | string | Standardmäßig der kompatible Modus aus den Manifesten. |
| `budget` | nein | integer | Maximale tatsächlich ausgegebene Souls. |
| `budget_checkpoints` | nein | array<integer> | Gewünschte Zwischenstände; ohne Angabe aus Economy-Schwellen ableiten. |
| `hero_level` | nein | integer | Heldenlevel des Vergleichszustands. |
| `ability_levels` | nein | object | Fähigkeitspunkte beziehungsweise Upgradezustand je `ability_id`. |
| `focus_ability_ids` | nein | array<string> | Fähigkeiten, die besonders gewichtet werden. |
| `target_profile` | nein | object | Zieltyp, Leben, Bullet/Spirit Resistance und weitere vorgegebene Eigenschaften. |
| `combat_assumptions` | nein | object | Trefferquote, Headshotquote, Burstfenster, Kampfzeit und Proc-Uptime. |
| `minimum_requirements` | nein | object | Harte Anforderungen an Überleben, Mobilität, Kontrolle oder andere Werte. |
| `preferred_items` | nein | array<string> | Items, die geprüft werden sollen; keine automatische Pflichtauswahl. |
| `excluded_items` | nein | array<string> | Items, die ausgeschlossen werden. |
| `objective_focus` | nein | string | Optionaler Fokus auf Helden, Nicht-Helden oder Objectives. |
| `risk_preference` | nein | string | Zum Beispiel robust, ausgewogen oder theoretisches Maximum. |
| `output_destination` | nein | string | Standardmäßig Chat; Dateien nur auf ausdrücklichen Wunsch. |

## Mindestregeln

- `hero_id` muss auf einen existierenden Helden verweisen.
- `objective` muss messbar oder in getrennte messbare Ziele zerlegbar sein.
- Fehlende Angaben sind keine Spielwerte. Sie dürfen nur als klar bezeichnete Analyseannahmen oder Sensitivitätsszenarien behandelt werden.
- Alle Kandidaten eines Vergleichs müssen denselben normalisierten Request verwenden.


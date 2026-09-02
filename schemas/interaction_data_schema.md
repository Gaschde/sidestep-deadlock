# Interaktions-Datenschema

`data/interactions/hero_interactions.csv` ist UTF-8-kodiert. Primärschlüssel ist `interaction_id`.

| Feldgruppe | Typ / Regel |
|---|---|
| Hero/Fähigkeit | `hero_id` → `data/heroes/heroes.csv`; `ability_id` → `data/heroes/abilities.csv` |
| Fähigkeitseffekt | `ability_effect_reference` im Format `ability_id::effect_id` → `ability_mechanics.csv` |
| Item | `other_entity_id` muss exakt `data/core/items.csv:item_id` sein |
| Itemeffekt | Format `item_id::effect_id` → `data/core/item_mechanics.csv` |
| Objective | exakt `guardian`, `walker`, `shrines`, `patron` oder `midboss` aus `data/core/objectives.json` |
| Globale Mechanik | Root-Schlüssel aus `data/core/mechanics.json`, z. B. `cooldown_rules` oder `ability_charge_rules` |
| `value` | Zahl/String/Boolean; `unit` ist verpflichtend, wenn `value` gesetzt ist |
| `confidence` | `high`, `medium`, `low`; Low normalerweise mit `HUNC-*`/`UNC-*` |
| `source_ids` | JSON-Array; `HSRC-*` oder `SRC-*` gemäß vereinigtem Quellenregister |

Leere Felder bedeuten nicht verifiziert/nicht anwendbar. Allgemeine mathematische Skalierung ist keine Sonderinteraktion. Nicht belegte Item-, Proc-, Summon- oder Objective-Wirkung wird nicht erzeugt, sondern über Unsicherheiten erhalten.

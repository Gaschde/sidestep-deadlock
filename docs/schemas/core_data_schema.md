# Core-Datenschema

Dieses Dokument beschreibt die logischen Datentypen in `data/core/`. Die CSV-Dateien sind UTF-8-kodiert und besitzen genau eine Kopfzeile. Leere CSV-Felder und JSON-`null` bedeuten „noch nicht erfasst oder nicht anwendbar“; sie sind keine bestätigten Nullwerte.

## Gemeinsame Konventionen

- `string`: Text in UTF-8; IDs sind innerhalb ihres jeweiligen Namensraums eindeutig und stabil.
- `integer`: Ganzzahl. Kosten, Anzahlen und Grenzen sind nicht negativ.
- `number`: Dezimalzahl mit Punkt als Dezimaltrennzeichen.
- `boolean`: ausschließlich `true` oder `false`.
- `date`: ISO-8601-Kalenderdatum.
- `datetime`: ISO-8601-Zeitstempel mit Zeitzone.
- Zeitwerte in `active_cooldown`, `duration` und `cooldown` werden in Sekunden gespeichert; abweichende Dimensionen gehören in ein Feld mit expliziter `unit`.
- `confidence`: kategorischer Wert `high`, `medium` oder `low`. `high` bedeutet explizite und konsistente aktuelle Primärdaten; `medium` bedeutet primäre Evidenz mit Interpretation/Rekonstruktion; `low` bedeutet unvollständige, widersprüchliche oder testabhängige Evidenz. Low-Confidence-Daten erhalten grundsätzlich einen Verweis auf `uncertainties.csv`.
- `source_ids`: `array<string>`, als JSON-Array in einem einzelnen korrekt maskierten CSV-Feld serialisiert. Jeder Eintrag verweist auf `sources.source_id`.
- Freitextfelder dürfen keine zusätzlichen, impliziten Spalten oder nicht dokumentierten Trennzeichenlisten enthalten.

## `items.csv`

| Feld | Typ | Bedeutung |
|---|---|---|
| `item_id` | string | Eindeutige, stabile Item-ID; Primärschlüssel. |
| `name` | string | Anzeigename. |
| `category` | string | Kanonische Kategorie. |
| `tier` | integer | Kanonische Tier-Stufe. |
| `total_cost` | integer | Gesamtkosten. |
| `is_public_shop_item` | boolean | Kennzeichnet die reguläre Verfügbarkeit im öffentlichen Shop. |
| `active_type` | string | Typ einer aktiven Nutzung; leer, falls nicht anwendbar. |
| `active_cooldown` | number | Abklingzeit einer aktiven Nutzung; leer, falls nicht anwendbar. |
| `verified_patch` | string | Patch-Kennung der Verifikation. |
| `verified_date` | date | Datum der Verifikation. |
| `confidence` | string | Vertrauenswert gemäß gemeinsamer Konvention. |
| `source_ids` | array<string> | Quellenreferenzen gemäß gemeinsamer Konvention. |
| `notes` | string | Ergänzende Hinweise. |

## `item_upgrades.csv`

Jede Zeile beschreibt eine gerichtete Upgrade-Kante. `from_item_id` und `to_item_id` verweisen auf `items.item_id`.

| Feld | Typ | Bedeutung |
|---|---|---|
| `from_item_id` | string | Ausgangs-Item-ID; Teil des zusammengesetzten Schlüssels. |
| `to_item_id` | string | Ziel-Item-ID; Teil des zusammengesetzten Schlüssels. |
| `from_cost` | integer | Kosten des Ausgangs-Items zum verifizierten Stand. |
| `to_total_cost` | integer | Gesamtkosten des Ziel-Items. |
| `additional_cost` | integer | Zusätzliche Kosten der Upgrade-Kante. |
| `cross_category` | boolean | Kennzeichnet einen Kategorienwechsel. |
| `temporary_slot_requirement` | boolean \| null | Kennzeichnet einen vorübergehenden zusätzlichen Slotbedarf; `null`/leer bedeutet nicht verifiziert. |
| `confidence` | string | Vertrauenswert gemäß gemeinsamer Konvention. |
| `source_ids` | array<string> | Quellenreferenzen gemäß gemeinsamer Konvention. |
| `notes` | string | Ergänzende Hinweise. |

## `item_mechanics.csv`

Jede Zeile beschreibt einen atomaren Effekt eines Items. `(item_id, effect_id)` ist der zusammengesetzte Primärschlüssel; `item_id` verweist auf `items.item_id`.

| Feld | Typ | Bedeutung |
|---|---|---|
| `item_id` | string | Zugehörige Item-ID. |
| `effect_id` | string | Innerhalb des Items eindeutige Effekt-ID. |
| `effect_type` | string | Kanonischer Effekttyp. |
| `mechanic` | string | Kanonische Mechanik-ID oder -Bezeichnung. |
| `value` | number \| string \| boolean | Effektwert; der konkrete Typ richtet sich nach der Mechanik. |
| `unit` | string | Einheit oder Dimensionskennung des Werts. |
| `condition` | string | Bedingung für die Gültigkeit des Effekts. |
| `trigger` | string | Auslöser des Effekts. |
| `target_scope` | string | Zielbereich des Effekts. |
| `nonhero_behavior` | string | Abweichendes Verhalten gegenüber Nicht-Hero-Zielen. |
| `objective_behavior` | string | Abweichendes Verhalten gegenüber Objectives. |
| `stacking` | string | Kanonische Stapelregel. |
| `max_stacks` | integer | Maximale Stapelzahl; leer, falls nicht anwendbar. |
| `duration` | number | Effektdauer; leer, falls nicht anwendbar. |
| `cooldown` | number | Effekt-Abklingzeit; leer, falls nicht anwendbar. |
| `confidence` | string | Vertrauenswert gemäß gemeinsamer Konvention. |
| `source_ids` | array<string> | Quellenreferenzen gemäß gemeinsamer Konvention. |
| `notes` | string | Ergänzende Hinweise. |

## `sources.csv`

| Feld | Typ | Bedeutung |
|---|---|---|
| `source_id` | string | Eindeutige, stabile Quellen-ID; Primärschlüssel. |
| `source_type` | string | Kanonischer Quellentyp. |
| `title` | string | Titel oder kurze Bezeichnung. |
| `url` | string | Absolute Quellen-URL. |
| `published_at` | date \| datetime | Veröffentlichungszeitpunkt in der präzisesten belegten ISO-8601-Genauigkeit; leer, falls unbekannt. |
| `accessed_at` | datetime | Zeitpunkt des letzten Zugriffs. |
| `authority_level` | string | Kanonische Einstufung der Quellenautorität. |
| `client_sync_status` | string | Kanonischer Status des Abgleichs mit dem Client. |
| `notes` | string | Ergänzende Hinweise. |

## `uncertainties.csv`

| Feld | Typ | Bedeutung |
|---|---|---|
| `uncertainty_id` | string | Eindeutige, stabile Unsicherheits-ID; Primärschlüssel. |
| `entity_type` | string | Typ der betroffenen Entität. |
| `entity_id` | string | ID der betroffenen Entität im jeweiligen Namensraum. |
| `question` | string | Präzise offene Frage. |
| `importance` | string | Kanonische Prioritäts- oder Relevanzstufe. |
| `current_evidence` | string | Zusammenfassung des vorhandenen Belegstands. |
| `confidence` | string | Vertrauenswert gemäß gemeinsamer Konvention. |
| `source_ids` | array<string> | Quellenreferenzen gemäß gemeinsamer Konvention. |
| `resolution_needed` | string | Noch erforderlicher Verifikationsschritt. |

## `manifest.json`

Root-Typ: `object`.

| Feld | Typ | Bedeutung |
|---|---|---|
| `data_as_of` | date \| null | Fachlicher Datenstand. |
| `patch` | string \| null | Aktuelle Patch-Kennung. |
| `client_build` | string \| null | Verifizierter Client-Build. |
| `mode` | string \| null | Geltender Spielmodus oder Datenkontext. |
| `item_count` | integer \| null | Anzahl der kanonischen Items in `items.csv`. |
| `verified_at` | datetime \| null | Zeitpunkt der Gesamtverifikation. |
| `schema_version` | string \| null | Version dieses Datenschemas. |
| `research_date` | date | Forschungs-/Zugriffstag. |
| `item_mechanics_count` | integer | Anzahl atomarer Zeilen in `item_mechanics.csv`. |
| `upgrade_edge_count` | integer | Anzahl gerichteter Upgrade-Kanten. |
| `source_ids` | array<string> | Quellen für den globalen Datenstand und Modus. |
| `source_state` | object | Revisionen und Synchronitätsprüfungen des Forschungsstands. |

## `economy.json`

Root-Typ: `object`.

| Feld | Typ | Bedeutung |
|---|---|---|
| `tier_prices` | object<string, integer> | Abbildung kanonischer Tier-IDs auf Preise. |
| `sellback` | object | Strukturierte Sellback-Regeln. |
| `refund` | object | Strukturierte Refund-Regeln. |
| `investments` | object | Strukturierte Investment-Regeln. |
| `investment_thresholds` | array<object> | Geordnete Investment-Schwellen. |
| `special_rules` | array<object> | Sonstige, atomare Sonderregeln. |
| `source_ids` | array<string> | Quellen, die für die Root-Regeln gelten. |

## `slots.json`

Root-Typ: `object`.

| Feld | Typ | Bedeutung |
|---|---|---|
| `starting_slots` | object<string, integer> | Abbildung kanonischer Slottypen auf Startmengen. |
| `unlocks` | array<object> | Geordnete oder bedingte Slot-Freischaltungen. |
| `item_limit` | integer \| null | Globales Itemlimit. |
| `slot_types` | array<object> | Definitionen der kanonischen Slottypen. |
| `upgrade_behavior` | array<object> | Atomare Regeln zum Slotverhalten bei Upgrades. |
| `active_item_limit` | integer \| null | Maximale Zahl gleichzeitig gehaltener Active Items. |
| `source_ids` | array<string> | Quellen, die für die Root-Regeln gelten. |

## `objectives.json`

Root-Typ: `object`. Die Objective-Felder bleiben als Objekte offen, bis ihr gemeinsames Unterschema anhand verifizierter Forschung festgelegt werden kann.

| Feld | Typ | Bedeutung |
|---|---|---|
| `guardian` | object | Regeln und Eigenschaften für Guardian-Objectives. |
| `walker` | object | Regeln und Eigenschaften für Walker-Objectives. |
| `shrines` | object | Regeln und Eigenschaften für Shrine-Objectives. |
| `patron` | object | Regeln und Eigenschaften für Patron-Objectives. |
| `midboss` | object | Regeln und Eigenschaften für den Midboss. |
| `general_rules` | array<object> | Objective-übergreifende, atomare Regeln. |

## `mechanics.json`

Root-Typ: `object`. Jede Regelliste enthält atomare, später schematisierbare Regelobjekte.

| Feld | Typ |
|---|---|
| `damage_rules` | array<object> |
| `resistance_rules` | array<object> |
| `lifesteal_rules` | array<object> |
| `healing_rules` | array<object> |
| `cooldown_rules` | array<object> |
| `charge_up_rules` | array<object> |
| `ability_charge_rules` | array<object> |
| `duration_rules` | array<object> |
| `range_rules` | array<object> |
| `movement_rules` | array<object> |
| `stamina_rules` | array<object> |
| `fire_rate_rules` | array<object> |
| `ammo_reload_rules` | array<object> |
| `targeting_rules` | array<object> |
| `debuff_rules` | array<object> |
| `stacking_rules` | array<object> |
| `summon_rules` | array<object> |
| `nonhero_rules` | array<object> |
| `proc_rules` | array<object> |
| `damage_amplification_rules` | array<object> |

## `patches.json`

Root-Typ: `object`.

| Feld | Typ | Bedeutung |
|---|---|---|
| `changes` | array<object> | Nur historische Änderungen, die zur Herleitung des aktuellen Zustands erforderlich sind. |

## Referenz- und Validierungsregeln

- Alle referenzierten IDs müssen existieren; verwaiste Referenzen sind ungültig.
- `item_count` muss nach Befüllung der Anzahl der Datenzeilen in `items.csv` entsprechen.
- Eine Upgrade-Kante darf nicht auf dieselbe Item-ID zeigen.
- Ein atomarer Effekt oder eine atomare Regel belegt genau eine Zeile beziehungsweise ein Objekt.
- Forschungsnotizen sind keine Core-Daten. Sie werden erst nach Quellenprüfung und Auflösung relevanter Unsicherheiten in `data/core/` übernommen.

# API-Import-Schema

`tools/sync_deadlock_api.py` speichert API-Rohdaten nach Client-Version und erzeugt pro Lauf einen Manifest-/Diff-Vertrag.

## Endpunkte

Die standardmäßig abgerufenen Endpunkte sind:

- `/v1/assets/client-versions`
- `/v1/assets/items`
- `/v1/assets/heroes`
- `/v1/assets/generic-data`
- `/v1/assets/npc-units`
- `/v1/assets/misc-entities`
- `/v1/assets/loot-tables`
- `/v1/assets/map`
- `/v1/assets/ranked-seasons`

Alle Asset-Endpunkte außer der Versionsliste erhalten `client_version`. Fähigkeiten werden aus dem vollständigen Item-Datensatz als `type=ability` erkannt; dadurch wird keine zweite, potenziell abweichende Ability-Abfrage benötigt.

## Sicherheits- und Integritätsregeln

- `raw/<endpoint>.json` ist byte-identisch mit der API-Antwort.
- Jede Antwort erhält URL, Abrufzeitpunkt, Bytezahl und SHA-256 im Manifest.
- Abweichende Antworten derselben Version werden unter `revisions/` archiviert.
- `mapped/` ist nicht-kanonisch und darf unbekannte Felder nicht verwerfen.
- `diff.json` und `review_required.json` markieren neue, widersprüchliche oder fehlende Records als `review_required`.
- Automatisches Überschreiben bestehender kanonischer Records ist ausgeschlossen. Das Approval-Gate akzeptiert nur bestehende Konfliktfelder und prüft den bisherigen Wert erneut.

## Logische Zuordnung

| API | Bestehender Datenvertrag |
|---|---|
| Items vom Typ `upgrade`, `weapon`, `ability` | `items.csv`, `item_mechanics.csv` |
| Item-Komponenten | `item_upgrades.csv` |
| Heroes | `heroes.csv`, `hero_stats.csv` |
| Ability-Items und ihre Properties | `abilities.csv`, `ability_mechanics.csv` |
| Generic/NPC/Misc/Loot/Map/Seasons | versionierte JSON-Mappings ohne automatische Kanonisierung |

IDs werden zuerst über vorhandene interne IDs und `class_name` aufgelöst. Nicht auflösbare Records erhalten eine deterministische Snake-Case-Kandidaten-ID und bleiben prüfpflichtig. Unbekannte bzw. verschachtelte Felder werden in `schema_observations.json` und vollständig im Raw-Archiv erhalten.

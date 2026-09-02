# Sidestep Deadlock

Dieses Repository trennt Recherche, kanonische Masterdaten, hero-spezifische Ableitungen und Build-Ergebnisse, damit jeder Verarbeitungsschritt nachvollziehbar bleibt.

## Workflow

`Master Research` → `data/core/` → `Hero Research` → `data/heroes/` + `data/interactions/` → `Build Optimizer` → `builds/`

- `research/master/` sammelt und prüft Quellen für allgemeine Masterdaten.
- `data/core/` enthält ausschließlich verifizierte, kanonische Daten und das zugehörige Quellen- und Unsicherheitsregister.
- `research/heroes/` bereitet hero-spezifische Erkenntnisse vor; freigegebene Ergebnisse fließen getrennt nach `data/heroes/` und `data/interactions/`.
- `builds/` enthält ausschließlich abgeleitete Ausgaben des Build Optimizers.
- `prompts/` hält wiederverwendbare Arbeitsanweisungen, `schemas/` die Datenverträge und `archive/` nicht mehr aktive Stände.

Core-Felder und Serialisierungskonventionen sind in `schemas/core_data_schema.md` dokumentiert. Ungeprüfte Annahmen werden nicht als Masterdaten übernommen.

## KI-gestützte Build-Analyse

Neue Codex-Tasks im Projekt erhalten über `AGENTS.md` die dauerhaften Projektregeln. Bei Build-Anfragen wird `prompts/build_optimizer.md` als verbindliches Arbeitsverfahren verwendet.

- `schemas/build_request_schema.md` beschreibt die normalisierte Anfrage.
- `schemas/build_result_schema.md` beschreibt das überprüfbare Ergebnis.
- Build-Ergebnisse werden nur auf ausdrücklichen Wunsch unter `builds/` gespeichert.
- Kosten, Upgradepfade, Investments, sämtliche Schwellen, Slots, Cooldowns und Unsicherheiten müssen vor einer Empfehlung validiert werden.

## Deadlock-API-Importer

`tools/sync_deadlock_api.py` bindet die öffentliche, client-versionierte Deadlock Assets API als technische Vergleichsquelle ein. Die API-Dokumentation und OpenAPI-Spezifikation sind unter `https://api.deadlock-api.com/docs` bzw. `https://api.deadlock-api.com/openapi.json` verfügbar.

Ein Offline-Fixture-Lauf:

```text
python tools/sync_deadlock_api.py --fixture-dir tests/fixtures/deadlock_api --dry-run
```

Ein echter Snapshot-Lauf ermittelt standardmäßig die höchste verfügbare Client-Version und schreibt ausschließlich unter `data/api/`:

```text
python tools/sync_deadlock_api.py
```

Eine bestimmte Version kann mit `--client-version 6518` gewählt werden. Das Ergebnis liegt unter `data/api/versions/<client_version>/`: die Antworten stehen byte-identisch in `raw/`, ein Laufverzeichnis enthält `mapped/`, `diff.json`, `review_required.json`, `validation.json`, `schema_observations.json` und ein Manifest. Bereits gespeicherte Bytes werden nie überschrieben; abweichende Antworten derselben Version landen unter `revisions/<timestamp>/`. `data/core/` und `data/heroes/` werden durch einen normalen Lauf nicht verändert.

### Dry-Run, Prüfung und Freigabe

`--dry-run` ruft Daten ab, validiert sie und erzeugt den Diff nur im Speicher. Neue Datensätze, widersprüchliche Werte und im API-Snapshot fehlende kanonische Datensätze werden als `review_required` markiert. Die Mappings sind bewusst nicht-kanonisch: sie übernehmen nur direkt erkennbare IDs, Namen, Kosten, Tiers, Aktivierung, Cooldowns und flache Property-Werte. Semantische Einheiten, Skalierungen, Bedingungen, Procs, Targeting, Objective-Verhalten, Summon-Vererbung und Patchinterpretationen müssen manuell geprüft werden. Unbekannte Felder bleiben im Raw-Archiv und werden in `schema_observations.json` sichtbar; fehlende Pflichtidentitäten führen zur Validierungswarnung bzw. zum Abbruch bei strukturell ungültigen Antworten.

Kanonische Änderungen benötigen eine separat gepflegte Approval-Datei, die ausschließlich konkrete `change_id`-Werte aus demselben Diff enthält:

```json
{"change_ids": ["<change_id-aus-review_required.json>"]}
```

Danach kann der geprüfte Lauf mit `--apply-approved path/to/approval.json` wiederholt werden. Das Tool prüft dabei Version, Diff-ID und den unveränderten bisherigen Wert; neue Datensätze, Löschungen und ganze Record-Ersetzungen werden nicht automatisch übernommen.

### Netzwerk, Rate-Limits und API-Key

Der Importer nutzt nur Standardbibliothek, wartet standardmäßig `0.25` Sekunden zwischen Requests und wiederholt 429- sowie 5xx-/Netzwerkfehler mit Backoff. Das Verhalten kann mit `--request-delay` und `--retries` angepasst werden. Ein optionaler API-Key wird ausschließlich aus `DEADLOCK_API_KEY` (oder einer mit `--api-key-env` benannten Umgebungsvariable) gelesen und als `X-API-KEY` gesendet; der Secret-Wert wird nie in ein Manifest geschrieben. Der API-Key ist für diesen Asset-Import normalerweise nicht erforderlich, kann aber bei Dienst-/Kontingentregeln verwendet werden.

# Sidestep Deadlock

Sidestep Deadlock ist eine verlässliche Datengrundlage für nachvollziehbare Deadlock-Builds. Das Projekt sammelt Spielwerte nicht einfach an einem Ort, sondern trennt sauber zwischen Recherche, geprüften Daten und daraus berechneten Empfehlungen. So bleibt sichtbar, woher ein Wert kommt und wie ein Build zustande gekommen ist.

## Wie das Projekt aufgebaut ist

Der Weg von der Quelle bis zum fertigen Build sieht so aus:

`Master Research` → `data/core/` → `Helden-Recherche` → `data/heroes/` + `data/interactions/` → `Build Optimizer` → `builds/`

- In `research/master/` werden Quellen für allgemeine Spielmechaniken gesammelt und geprüft.
- `data/core/` enthält die verifizierten Kerndaten – zum Beispiel Items, Kosten, Slots und Objectives. Quellen und offene Unsicherheiten werden dort ebenfalls festgehalten.
- `research/heroes/` ist der Arbeitsbereich für heldenspezifische Recherche. Geprüfte Ergebnisse landen anschließend in `data/heroes/` oder `data/interactions/`.
- `builds/` ist für fertige, aus den Daten abgeleitete Build-Ergebnisse gedacht.
- In `prompts/` liegen wiederverwendbare Arbeitsanweisungen, in `schemas/` die vereinbarten Datenformate und in `archive/` ältere, nicht mehr aktive Stände.

Die Felder und Speicherformate der Kerndaten sind in `schemas/core_data_schema.md` beschrieben. Ungeprüfte Vermutungen werden bewusst nicht in die verbindlichen Daten übernommen.

## Build-Analysen mit Codex

Die Datei `AGENTS.md` gibt neuen Codex-Tasks automatisch die Regeln dieses Projekts mit. Bei einer Build-Anfrage folgt Codex dem Ablauf in `prompts/build_optimizer.md`.

Dabei gilt:

- `schemas/build_request_schema.md` beschreibt, wie eine Anfrage eingeordnet wird.
- `schemas/build_result_schema.md` legt fest, wie ein überprüfbares Ergebnis aussehen soll.
- Ergebnisse werden nur dann unter `builds/` gespeichert, wenn das ausdrücklich gewünscht ist.
- Vor einer Empfehlung werden unter anderem Kosten, Upgradepfade, Investments, Schwellenwerte, Slots, Cooldowns und bekannte Unsicherheiten geprüft.

Das Ziel ist keine scheinbare Präzision, sondern eine Empfehlung, deren Annahmen und Rechenweg verständlich bleiben.

## Daten mit der Deadlock API abgleichen

Mit `tools/sync_deadlock_api.py` lässt sich die öffentliche, nach Client-Versionen getrennte Deadlock Assets API als technische Vergleichsquelle einlesen. Die zugehörige [API-Dokumentation](https://api.deadlock-api.com/docs) und die [OpenAPI-Spezifikation](https://api.deadlock-api.com/openapi.json) sind öffentlich erreichbar.

Für einen lokalen Test ohne Netzwerkzugriff gibt es mitgelieferte Beispieldaten:

```text
python tools/sync_deadlock_api.py --fixture-dir tests/fixtures/deadlock_api --dry-run
```

Ein echter Snapshot-Lauf sucht standardmäßig die höchste verfügbare Client-Version und schreibt seine Ergebnisse ausschließlich nach `data/api/`:

```text
python tools/sync_deadlock_api.py
```

Mit `--client-version 6518` kann stattdessen gezielt eine bestimmte Version ausgewählt werden. Die Ergebnisse liegen anschließend unter `data/api/versions/<client_version>/`:

- `raw/` enthält die Antworten unverändert.
- Das jeweilige Laufverzeichnis enthält die aufbereiteten Daten in `mapped/` sowie `diff.json`, `review_required.json`, `validation.json`, `schema_observations.json` und ein Manifest.
- Bereits gespeicherte Originaldaten werden nicht überschrieben. Falls dieselbe Version später andere Antworten liefert, werden diese unter `revisions/<timestamp>/` abgelegt.

Ein normaler Import verändert weder `data/core/` noch `data/heroes/`.

### Erst prüfen, dann übernehmen

Mit `--dry-run` werden Daten abgerufen, geprüft und verglichen, ohne Dateien zu verändern. Neue Datensätze, widersprüchliche Werte und kanonische Einträge, die im API-Snapshot fehlen, erscheinen als `review_required`.

Die automatisch erzeugten Mappings sind absichtlich noch keine verbindlichen Projektdaten. Direkt erkennbare Informationen wie IDs, Namen, Kosten, Tiers, Aktivierung, Cooldowns und einfache Property-Werte können übernommen werden. Bedeutung und Einheit eines Werts, Skalierungen, Bedingungen, Procs, Targeting, Objective-Verhalten, die Vererbung von Beschwörungen und Patchinterpretationen brauchen dagegen eine manuelle Prüfung.

Unbekannte Felder bleiben im Raw-Archiv erhalten und werden in `schema_observations.json` sichtbar. Fehlen notwendige Identitäten, erzeugt die Validierung eine Warnung; strukturell ungültige Antworten führen zum Abbruch.

Für kanonische Änderungen braucht es eine separat gepflegte Freigabedatei. Sie darf nur konkrete `change_id`-Werte aus demselben Diff enthalten:

```json
{"change_ids": ["<change_id-aus-review_required.json>"]}
```

Anschließend kann der geprüfte Lauf mit `--apply-approved path/to/approval.json` wiederholt werden. Vor der Übernahme prüft das Tool die Version, die Diff-ID und den bisherigen Wert. Neue Datensätze, Löschungen und vollständige Ersetzungen eines Datensatzes werden nicht automatisch angewendet.

### Netzwerk und API-Key

Der Importer kommt ohne zusätzliche Python-Pakete aus. Zwischen Anfragen wartet er standardmäßig `0.25` Sekunden. Bei Rate-Limits, Serverfehlern oder Netzwerkproblemen versucht er es mit wachsender Wartezeit erneut. Dieses Verhalten lässt sich über `--request-delay` und `--retries` anpassen.

Für den normalen Asset-Import ist üblicherweise kein API-Key nötig. Falls doch einer verwendet werden soll, liest das Tool ihn aus der Umgebungsvariable `DEADLOCK_API_KEY` – oder aus einer anderen, mit `--api-key-env` angegebenen Variable – und sendet ihn als `X-API-KEY`. Der geheime Wert wird niemals in ein Manifest geschrieben.

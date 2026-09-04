# Sidestep Deadlock

> **Ein datenbasierter Build-Assistent für Deadlock:** Du nennst einen Helden und dein Ziel. Codex vergleicht geprüfte Spielwerte und erstellt daraus eine verständliche Item- und Kaufempfehlung.

Sidestep Deadlock ist kein eigenständiges Programm mit Benutzeroberfläche. Dieses Repository ist die Wissens- und Rechengrundlage, mit der Codex Deadlock-Builds analysiert. Statt Empfehlungen aus Bauchgefühl zu geben, arbeitet es mit hinterlegten Itemkosten, Heldenwerten, Upgrades, Slots und besonderen Interaktionen.

## Kurz gesagt

- **Eingabe:** Held, Spielstil, Match-Situation oder gewünschtes Ziel.
- **Analyse:** Codex prüft passende Items, Kosten, Upgradepfade, Schwellenwerte und verfügbare Slots.
- **Ergebnis:** ein begründeter Build mit Kaufreihenfolge, Alternativen und klar benannten Unsicherheiten.
- **Datengrundlage:** Spielwerte werden nach Quelle und Patch getrennt gespeichert. Ungeprüfte Annahmen gelten nicht als Fakten.

## So verwendest du es

Öffne das Repository als Codex-Projekt und stelle eine konkrete Build-Frage, zum Beispiel:

> Erstelle mir einen Tank-Build für Abrams. Ich spiele meistens im Team und möchte möglichst lange an der Front überleben.

Codex liest die Projektregeln und die benötigten Datensätze, rechnet die relevanten Werte nach und erklärt anschließend, warum die empfohlenen Items zum Ziel passen.

## Build-Analysen mit Codex

Die Datei `AGENTS.md` gibt neuen Codex-Tasks automatisch die Regeln dieses Projekts mit. Bei einer Build-Anfrage folgt Codex dem Ablauf in `prompts/build_optimizer.md`.

Dabei gilt:

- `schemas/build_request_schema.md` beschreibt, wie eine Anfrage eingeordnet wird.
- `schemas/build_result_schema.md` legt fest, wie ein überprüfbares Ergebnis aussehen soll.
- Ergebnisse werden nur dann unter `builds/` gespeichert, wenn das ausdrücklich gewünscht ist.
- Vor einer Empfehlung werden unter anderem Kosten, Upgradepfade, Investments, Schwellenwerte, Slots, Cooldowns und bekannte Unsicherheiten geprüft.

Das Ziel ist keine scheinbare Präzision, sondern eine Empfehlung, deren Annahmen und Rechenweg verständlich bleiben.

## Lokale Optimizer-Engine

Unter `optimizer/` liegt die erste ausführbare Ausbaustufe. Der Calculator lädt einen Helden, sein Boon-Level und einen vorgegebenen Itemsatz und berechnet daraus nachvollziehbare Endwerte. Bedingte Effekte bleiben standardmäßig ausgeschaltet und müssen für ein konkretes Szenario ausdrücklich aktiviert werden.

`optimizer/search.py` kann Builds innerhalb einer angegebenen Kandidatenmenge deterministisch vergleichen, harte Mindestwerte prüfen, ein gegnerisches Resistenzprofil berücksichtigen und legale Komponenten-/Upgrade-Kaufpfade an Budget-Checkpoints bewerten. Diese Suche ist noch kein globaler Optimierer; automatisch geschätzte Proc-Uptimes folgen in weiteren Ausbaustufen. Verwendung und Grenzen sind in `optimizer/README.md` dokumentiert.

## Wo die Daten liegen

Der Weg von der Recherche bis zum fertigen Build sieht so aus:

`Recherche` → `data/core/` + `data/heroes/` + `data/interactions/` → `Build Optimizer` → `builds/`

- `data/core/` enthält geprüfte Kerndaten wie Items, Kosten, Slots, Objectives und allgemeine Spielmechaniken.
- `data/heroes/` enthält Werte, Fähigkeiten, Upgrades und Ressourcen der Helden.
- `data/interactions/` hält verifizierte Sonderinteraktionen fest.
- `research/` dokumentiert die Recherche und Prüfung der Quellen.
- `builds/` ist für gespeicherte Build-Ergebnisse vorgesehen.
- `prompts/` enthält Arbeitsanweisungen, `schemas/` die Datenformate und `archive/` ältere Stände.

Die Felder und Speicherformate der Kerndaten sind in `schemas/core_data_schema.md` beschrieben.

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

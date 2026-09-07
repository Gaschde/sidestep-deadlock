# Sidestep Deadlock – Projektstruktur

Stand: 7. September 2026. Diese Datei erklärt die Ordnerstruktur und die wichtigsten Einstiegspunkte. Für den laufenden Projektstand, Entscheidungen und eine Übergabe siehe `.agent/CONTINUITY.md`.

## Struktur auf einen Blick

```text
sidestep-deadlock/
├── AGENTS.md
├── README.md
├── PROJECT_CONTEXT.md
├── PROJECT_STRUCTURE.md
├── package.json
├── server.mjs
│
├── app/
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── lib.mjs
│   ├── capabilities.mjs
│   └── optimizer.mjs
│
├── data/
│   ├── core/
│   ├── heroes/
│   ├── interactions/
│   └── api/
│
├── schemas/
├── prompts/
├── research/
│   ├── master/
│   └── heroes/
├── tools/
├── tests/
│   └── fixtures/deadlock_api/
├── builds/
├── archive/
├── inputs_ideas/
└── .superdesign/
```

## Dateien im Projektstamm

### `AGENTS.md`

Verbindliche Arbeitsregeln für Codex beziehungsweise ChatGPT im Projekt. Die Datei legt Sprache, zulässige Datenquellen, Recherchegrenzen und das Vorgehen bei Build-Anfragen fest.

Vor jeder Arbeit an Builds, Items oder Daten zuerst lesen.

### `README.md`

Allgemeine Einführung für Nutzer und Entwickler. Beschreibt Produktidee, Datenprinzipien, lokalen Start der Weboberfläche und den API-Abgleich.

### `PROJECT_CONTEXT.md`

Kompakte technische Übergabe mit Produktziel, verbindlichen Datenregeln, aktuellem Optimizer-Slice, Berechnungsstand und bekannten Grenzen. Den laufenden Status, Entscheidungen und offene Punkte führt ausschließlich `.agent/CONTINUITY.md`.

### `.agent/CONTINUITY.md`

Einzige laufend gepflegte Status- und Übergabedatei mit relevanten Projektänderungen, Entscheidungen und offenen Punkten.

### `PROJECT_STRUCTURE.md`

Diese Datei. Sie dient als schnelle Navigationshilfe durch das Repository.

### `package.json`

Minimale Node-Konfiguration für die lokale UI:

- `npm start` startet den lokalen Server.
- `npm test` führt die Node-Tests aus `tests/*.test.mjs` aus.

Es gibt derzeit keine npm-Paketabhängigkeiten und kein Lockfile.

### `server.mjs`

Kleiner statischer Node-HTTP-Server. Er stellt das Repository lokal auf `127.0.0.1:4173` bereit und leitet `/` auf `/app/` um. Das ist eine lokale Entwicklungs- und Vorschaufunktion, keine Produktions- oder Cloud-Hosting-Konfiguration.

### `.gitignore`

Ignoriert lokale Secrets, Python-Caches, virtuelle Umgebungen, Editor-/Betriebssystemdateien, temporäre Dateien und `.superdesign/tmp/`.

## `app/` – lokale Weboberfläche und erster Optimizer-Slice

Dieser Bereich lädt echte lokale Projektdaten und enthält einen begrenzten, nachvollziehbaren Warden-Weapon-Carry-Optimizer. Er ist kein globaler Optimalitätsbeweis und kein vollständiger Optimizer für alle Helden oder Spielstile.

### `app/index.html`

Grundstruktur der Einzelseite:

- Heldenauswahl
- Spielstilauswahl
- zwei optionale Lane-Gegner
- erweiterte Optionen
- Early-/Mid-/Late-/Final-Ansichten
- Fähigkeitenübersicht
- Datenabdeckung

Testdaten und nicht optimierte Ergebnisse sind in der Oberfläche ausdrücklich gekennzeichnet.

### `app/styles.css`

Responsives Design im grün-schwarzen Occult-Noir-Stil. Enthält Layout, Komponenten, semantische Itemfarben, mobile Anpassungen und Unterstützung für reduzierte Bewegung. Google Fonts werden extern geladen.

### `app/app.js`

Browserseitige UI-Steuerung. Die Datei:

- lädt Manifeste, CSV- und JSON-Dateien;
- filtert die öffentlich spielbaren Helden;
- verwaltet Helden-, Gegner-, Stil- und Phasenauswahl;
- zeigt Patchkompatibilität und Datenabdeckung;
- rendert den gewählten Warden-Kaufpfad, Basis-Metriken, Annahmen, Fähigkeiten und Interaktionskontext.

### `app/optimizer.mjs`

Der aktuelle Warden-Weapon-Carry-Slice:

- legale Vorwärtssuche mit Käufen, Upgrades und einzelnen Ersetzungen;
- Kosten, Investments, Schwellen, Slots und Active-Limit;
- gemeinsame Sustained-DPS-/EHP-Berechnung für Ergebnis und Pfadpunkte;
- begrenzte Pareto-/Trajektorienprüfung mit offen dokumentierten Suchgrenzen.

### `app/capabilities.mjs`

Ordnet belegte Item- und Heldenwirkungen den getrennten Dimensionen Schaden, Schutz, Sustain, Zugang und Mobilität zu. Permanente, aktive und bedingte Werte bleiben getrennt.

### `app/lib.mjs`

Kleine wiederverwendbare Logikschicht:

- CSV-Parser
- Souls-Formatierung
- Prüfung von Patch-/Moduskompatibilität
- Formatierung und Patch-/Moduskompatibilitätsprüfung

Die Build-Auswahl läuft in `optimizer.mjs`; `lib.mjs` enthält keine konkurrierende Test-Build-Logik mehr.

## `data/` – strukturierte Spieldaten

### `data/core/` – verbindliche globale Daten

Kanonische Quelle für Items, Wirtschaft, Slots, Objectives und globale Mechaniken.

Wichtige Dateien:

| Datei | Inhalt |
|---|---|
| `manifest.json` | Patch, Modus, Schema-Version, Prüfzeitpunkt, Umfang und Ausschlüsse |
| `items.csv` | Itemidentität, Kategorie, Tier, Kosten, Aktivtyp und Konfidenz |
| `item_upgrades.csv` | Komponenten- und Upgrade-Kanten samt zusätzlicher Zahlung |
| `item_mechanics.csv` | Atomare Itemeffekte mit Einheiten, Triggern und Bedingungen |
| `economy.json` | Tierpreise, Sellback, Refund, Kategorie-Investments und Schwellen |
| `slots.json` | Startslots, zusätzliche Slots, Itemlimit und Active-Limit |
| `mechanics.json` | Globale Rechenregeln für Schaden, Resistenzen, Cooldowns und weitere Systeme |
| `objectives.json` | Guardian-, Walker-, Shrine-, Patron- und Midboss-Regeln |
| `patches.json` | Strukturierte relevante Patchänderungen |
| `sources.csv` | Quellenregister mit stabilen `SRC-*`-IDs |
| `uncertainties.csv` | Offene Core-Fragen mit `UNC-*`-IDs |

### `data/heroes/` – verbindliche Heldendaten

Kanonische Quelle für Heldenwerte, Fähigkeiten, Upgrades, Ressourcen, Progression und Beschwörungen.

| Datei | Inhalt |
|---|---|
| `manifest.json` | Patch-/Modusbezug, Abdeckung, Kompatibilität und Validierungsstatus |
| `heroes.csv` | Heldenregister und öffentliche Verfügbarkeit |
| `hero_stats.csv` | Basiswerte, Wachstum pro Level und weitere Heldenwerte |
| `abilities.csv` | Fähigkeiten, Slots, Typen, Cooldowns und Charges |
| `ability_mechanics.csv` | Atomare Fähigkeitseffekte und Skalierungen |
| `ability_upgrades.csv` | Einzelne Änderungen je Fähigkeitsupgrade |
| `hero_resources.csv` | Heldenspezifische Ressourcen und deren Regeln |
| `summons.csv` | Beschwörungen und erschaffene Einheiten |
| `summon_mechanics.csv` | Atomare Werte und Effekte der Beschwörungen |
| `progression.json` | Fähigkeitsfreischaltungen, AP-Kosten und Sonderfälle |
| `patches.json` | Strukturierte relevante Heldenänderungen |
| `sources.csv` | Quellenregister mit `HSRC-*`-IDs |
| `uncertainties.csv` | Offene Hero-Fragen mit `HUNC-*`-IDs |

### `data/interactions/` – verifizierte Sonderinteraktionen

`hero_interactions.csv` verbindet Helden und Fähigkeiten mit Items, Itemeffekten, Objectives oder globalen Mechaniken. Nur belegte Sonderfälle werden eingetragen. Ein fehlender Eintrag bedeutet „unbekannt“ und nicht automatisch „funktioniert nicht“.

### `data/api/` – versionierte technische Vergleichsdaten

Kein kanonischer Datenbereich. Er wird von `tools/sync_deadlock_api.py` erzeugt und dient dem kontrollierten Abgleich mit der Deadlock Assets API.

```text
data/api/
├── README.md
├── manifest.json
└── versions/<client_version>/
    ├── manifest.json
    ├── raw/
    ├── revisions/
    └── runs/<timestamp>/
        ├── manifest.json
        ├── mapped/
        ├── diff.json
        ├── review_required.json
        ├── validation.json
        └── schema_observations.json
```

- `raw/` bewahrt API-Antworten unverändert.
- `mapped/` enthält nicht-kanonische Zuordnungen zum Projektschema.
- `diff.json` beschreibt Abweichungen.
- `review_required.json` enthält manuell zu prüfende Änderungen.
- Ein API-Lauf überschreibt `data/core/` oder `data/heroes/` nicht automatisch.

Der Bereich ist groß und sollte bei normalen Build-Anfragen nicht vollständig geladen werden.

## `schemas/` – Daten- und Ergebnisverträge

### `schemas/core_data_schema.md`

Definiert Felder, Typen, IDs, Einheiten, Konfidenzregeln und Referenzprüfungen für `data/core/`.

### `schemas/hero_data_schema.md`

Definiert Tabellen, Schlüssel und Nullwertregeln für Helden, Fähigkeiten, Upgrades, Ressourcen und Summons.

### `schemas/interaction_data_schema.md`

Definiert Referenzen und Regeln für verifizierte Hero-, Item-, Objective- und Mechanikinteraktionen.

### `schemas/api_import_schema.md`

Definiert Endpunkte, Archivstruktur, Integritätsregeln und das Approval-Gate des API-Imports.

### `schemas/build_request_schema.md`

Definiert die normalisierte Eingabe einer Build-Analyse. Mindestangaben sind eine gültige `hero_id` und ein messbares `objective`.

### `schemas/build_result_schema.md`

Definiert den verpflichtenden Aufbau eines Build-Ergebnisses: Status, Annahmen, Kaufpfad, finaler Build, Metriken, Fähigkeiten, Itemnutzen, Alternativen, Unsicherheiten und Validierung.

## `prompts/` – Arbeitsverfahren

### `prompts/build_optimizer.md`

Die zentrale fachliche Anleitung für Build-Anfragen. Sie beschreibt:

- zu ladende Daten;
- Normalisierung der Anfrage;
- Definition messbarer Ziele;
- legale Itempfade;
- Kosten, Investments, Schwellen und Slots;
- Helden- und Skillzustand;
- Berechnungsreihenfolge;
- offensive, defensive und praktische Metriken;
- Bedingungen, Procs und Interaktionen;
- Kandidatensuche und Alternativen;
- verpflichtende Schlusskontrolle;
- Ausgabeformat.

Diese Datei ist aktuell ein präziser Arbeitsvertrag, noch keine vollständig implementierte Software-Engine.

## `research/` – Audit und Quellenprüfung

Auditmaterial darf zur Nachvollziehbarkeit gelesen werden, ist aber kein stiller Ersatz für fehlende kanonische Werte.

### `research/master/`

Nachweise für die Core-Daten:

- `verification_summary.md`: verifizierter Patch und Quellenstand.
- `validation_report.md`: Ergebnisse der Datenprüfungen.
- `dataset_coverage.md`: Umfang der Core-Daten.
- `short_research_notes.md`: wichtige Erfassungs- und Ausschlussentscheidungen.
- `excluded_itemdata_fields.csv`: bewusst nicht als Live-Effekte übernommene Rohfelder.

### `research/heroes/`

Nachweise für Heldendaten:

- `verification_summary.md`
- `validation_report.md`
- `dataset_coverage.md`
- `short_research_notes.md`
- `page_sync_audit.csv`
- `excluded_fields.csv`
- `source_cache/`: geprüfte Wiki-JSON-Exporte als Input für den Heldengenerator.

## `tools/` – Datenpflege und sonstige Hilfen

### Kernwerkzeuge

- `generate_core_data.py`: erzeugt Core-Daten und Auditberichte aus `deadlock.wiki`; besitzt einen Patch-Guard.
- `generate_hero_data.py`: erzeugt Helden-, Summon- und Interaktionsdaten aus dem geprüften Source-Cache.
- `sync_deadlock_api.py`: lädt, archiviert, validiert und vergleicht API-Snapshots; unterstützt Offline-Fixtures und explizite Freigaben.

Diese Werkzeuge können große oder kanonische Datenbereiche schreiben. Sie sollten nur im Rahmen einer ausdrücklich gewünschten Datenpflege ausgeführt werden.

### Sonstige Hilfen

- `analyze_subtitles.py`
- `build_broadcast_assets.py`

Diese beiden Dateien gehören nicht zum Kern des Build-Optimizers und besitzen lokale Medienabhängigkeiten.

## `tests/` – Prüfungen

### `tests/test_sync_deadlock_api.py`

Python-Unittests für Versionsauswahl, Validierung, Dry-Run, unveränderte kanonische Daten und Archivierung abweichender Antworten.

### `tests/fixtures/deadlock_api/`

Kleine Offline-Antworten für die API-Endpunkte. Damit lässt sich der Importer ohne Netzwerk prüfen.

### `tests/app.test.mjs`

Node-Tests für CSV-Parsing, Manifestkompatibilität und die begrenzte UI-Testpfadlogik.

## Weitere Ordner

### `builds/`

Ziel für ausdrücklich angeforderte und gespeicherte Build-Ergebnisse. `builds/README.md` erklärt die Regeln. Normale Chat-Ergebnisse werden hier nicht automatisch abgelegt.

### `.superdesign/`

Lokale Designartefakte:

- `design-system.md`: visuelle und funktionale UX-Richtung.
- `item-ui-assets.md`: Zuordnung ausgewählter Item-/Heldenbilder.
- `resume.json`: Zustand und IDs der Designentwürfe.
- `sidestep-v10-1.html`: ausgewählte HTML-Designstudie.
- `tmp/`: frühere Varianten; von Git ignoriert.

Diese Dateien sind Designreferenzen, keine Spielwertquellen.

### `inputs_ideas/`

Ideenablage. `Loki.txt` und `french_dynamo.txt` sind derzeit leere Platzhalter.

### `archive/`

Vorgesehener Bereich für ältere Projektstände. Aktuell enthält er keine für den laufenden Stand relevante Dokumentation.

## Schnellnavigation nach Aufgabe

| Aufgabe | Zuerst lesen |
|---|---|
| Projekt übernehmen | `AGENTS.md`, `.agent/CONTINUITY.md`, `PROJECT_CONTEXT.md`, `README.md` |
| Build analysieren | `prompts/build_optimizer.md`, beide Manifeste, Build-Schemas |
| Itemwerte prüfen | `data/core/manifest.json`, `items.csv`, `item_mechanics.csv`, `uncertainties.csv` |
| Helden/Fähigkeiten prüfen | `data/heroes/manifest.json`, `heroes.csv`, `hero_stats.csv`, `abilities.csv`, `ability_mechanics.csv` |
| Sonderinteraktion prüfen | `data/interactions/hero_interactions.csv` und beide Unsicherheitsregister |
| Datenherkunft auditieren | passende Dateien unter `research/master/` oder `research/heroes/` |
| API-Abweichungen prüfen | `data/api/README.md`, letzter Run und `schemas/api_import_schema.md` |
| UI weiterentwickeln | `.superdesign/design-system.md`, `app/index.html`, `app/app.js`, `app/lib.mjs` |
| Tests ausführen | `package.json`, `tests/app.test.mjs`, `tests/test_sync_deadlock_api.py` |

## Wichtigste Abgrenzung

Die Datenbasis und die Regeln für belastbare Analysen sind vorhanden. Die aktuelle Weboberfläche visualisiert einen Teil davon, verwendet für die Kaufreihenfolge jedoch nur Testlogik. Designprototypen, API-Mappings und Research-Dateien dürfen nicht mit kanonischen Spielwerten oder einer fertigen Optimierungsengine verwechselt werden.

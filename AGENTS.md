# Sidestep Deadlock – Projektanweisungen

## Sprache und Zweck

- Antworte dem Nutzer standardmäßig auf Deutsch.
- Dieses Projekt nutzt verifizierte Deadlock-Daten, um nachvollziehbare Build-Analysen zu erstellen.
- Behandle „Champion" in Nutzeranfragen als „Held", ohne den Nutzer dafür zu korrigieren.

## Verbindliche Datenquellen

- `data/core/` ist die verbindliche Quelle für Items, Kosten, Upgrades, Investments, Slots, Objectives und globale Mechaniken.
- `data/heroes/` ist die verbindliche Quelle für Heldenwerte, Fähigkeiten, Skalierungen, Upgrades, Ressourcen und Beschwörungen.
- `data/interactions/` ist die verbindliche Quelle für verifizierte Sonderinteraktionen.
- `docs/research/` dient dem Audit, nicht als stillschweigende Ersatzquelle für fehlende Masterdaten.
- Ergänze keine Spielwerte aus Modellwissen. Fehlende oder widersprüchliche Werte bleiben unsicher.
- Verändere kanonische Daten nur, wenn der Nutzer ausdrücklich Datenpflege oder neue Recherche verlangt.

## Build-Anfragen

Bei jeder Anfrage nach einem Build, einer Kaufreihenfolge, einem Itemvergleich oder einer Build-Optimierung:

1. Lies `docs/prompts/build_optimizer.md` vollständig und befolge es als verbindliches Arbeitsverfahren.
2. Verwende `docs/schemas/build_request_schema.md` für Eingaben und Annahmen.
3. Verwende `docs/schemas/build_result_schema.md` für das Ergebnis.
4. Vergleiche zuerst `data/core/manifest.json` und `data/heroes/manifest.json` auf Patch- und Moduskompatibilität.
5. Lade nur die für den angefragten Helden, die Kandidaten und die betroffenen Mechaniken benötigten Datensätze.
6. Rechne Kosten, Investments, Schwellen, Upgrades, Slots und abgeleitete Werte deterministisch und nachvollziehbar.
7. Nenne ein Ergebnis nur dann „optimal", wenn der Suchraum und das Optimierungsziel klar definiert sind und die geprüften Kandidaten den behaupteten Suchraum abdecken. Sonst nenne es „bester geprüfter Build".
8. Führe die Schlusskontrolle aus `docs/prompts/build_optimizer.md` aus, bevor du eine Empfehlung abgibst.
9. Schreibe Ergebnisse nur auf ausdrücklichen Wunsch nach `builds/`; ansonsten gib sie im Chat aus.

## Recherchegrenze

- Starte bei normalen Build-Anfragen keine vollständige Webrecherche.
- Recherchiere nur, wenn der Nutzer es verlangt, die Manifeste widersprüchlich sind oder der Datenstand erkennbar nicht aktuell genug ist.
- `deadlock.wiki` bleibt bei neuer Spielrecherche die verpflichtende Primärquelle; `deadlockwiki.org` ist ausgeschlossen.

## Technischer Stand

### Architektur

Zwei parallele Engines:
- **Python (`engine/`)** für CLI, Tests, Audit und API-Import
- **JavaScript (`app/`)** als primärer Browser-Optimizer mit Web-Worker

### Browser-Optimizer

- Produktionssuche: **0–40.000 Souls** (nicht 60k; 60k ist historisch und unvollständig)
- 12 Startslots (3 Walker-Freischaltungen ab Beginn)
- Alle 156 kanonischen Items, 38 öffentlich spielbare Helden
- 60-Sekunden-Worker-Budget
- Approximative Bewertung: 70% Endstärke / 30% Verlauf, Schaden/Überleben 50/50
- Schwerpunktgewichte: Weapon 70/30 Bullet/Spirit, Spirit 30/70, Hybrid 50/50
- Suchkern: `app/search-core.mjs`, Domäne: `app/deadlock-domain.mjs`
- Anytime-Worker: `app/optimizer-worker.mjs`

### Testbefehle

```bash
npm test          # Vollständige Node-Testsuite (75+ Tests)
npm start         # Lokaler Server auf http://127.0.0.1:4173/app/
python tools/calculate_build.py warden --boon 35 --walker-slots 3 --item upgrade_close_quarter_combat
```

## Dokumentationsverweise

- `docs/prompts/build_optimizer.md` – Verbindliches Arbeitsverfahren für Build-Analysen
- `docs/schemas/build_request_schema.md` – Eingaben und Annahmen
- `docs/schemas/build_result_schema.md` – Verifizierbares Ergebnis
- `docs/search_specification.md` – Suchmodell, Metriken und Modellgrenzen
- `docs/engine.md` – Python-Engine: Feature-Set, Szenarien, Profile, Known Limitations
- `archive/api/README.md` – API-Import- und Integritätsvertrag

## Wichtige Regeln

1. Ergebnisse immer als „bester geprüfter Build" bezeichnen, es sei denn, Suchraum und Ziel sind formal definiert.
2. Keine unbewiesenenAnnahmen für Proc-Uptime, Skill-Level, Trefferquoten oder Zwischenstände.
3. Bedingte Effekte nur mit dokumentiertem Trigger und Dauer bewerten.
4. API-Snapshots werden versioniert importiert; `data/core/` und `data/heroes/` werden nicht direkt überschrieben.
5. `archive/api/` ist die verbindliche API-Snapshot-Ablage; `review_required.json` erfordert explizite Freigabe.

## Optimizer-Experiment-Historie

- Vor neuen Optimizer-Experimenten muss docs/research/optimizer-next/experiment-index.md geprüft werden.
- Bereits beantwortete Hypothesen dürfen nicht erneut getestet werden, außer neue Evidenz vorliegt, sich die relevante Search-/Objective-/State-Semantik geändert hat oder ausdrücklich eine Replikation verlangt wird.
- Nach jedem abgeschlossenen Optimizer-Experiment muss docs/research/optimizer-next/experiment-index.md aktualisiert werden.

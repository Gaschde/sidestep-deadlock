# Sidestep Deadlock – Projektanweisungen

## Sprache und Zweck

- Antworte dem Nutzer standardmäßig auf Deutsch.
- Dieses Projekt nutzt verifizierte Deadlock-Daten, um nachvollziehbare Build-Analysen zu erstellen.
- Behandle „Champion“ in Nutzeranfragen als „Held“, ohne den Nutzer dafür zu korrigieren.

## Verbindliche Datenquellen

- `data/core/` ist die verbindliche Quelle für Items, Kosten, Upgrades, Investments, Slots, Objectives und globale Mechaniken.
- `data/heroes/` ist die verbindliche Quelle für Heldenwerte, Fähigkeiten, Skalierungen, Upgrades, Ressourcen und Beschwörungen.
- `data/interactions/` ist die verbindliche Quelle für verifizierte Sonderinteraktionen.
- `research/` dient dem Audit, nicht als stillschweigende Ersatzquelle für fehlende Masterdaten.
- Ergänze keine Spielwerte aus Modellwissen. Fehlende oder widersprüchliche Werte bleiben unsicher.
- Verändere kanonische Daten nur, wenn der Nutzer ausdrücklich Datenpflege oder neue Recherche verlangt.

## Build-Anfragen

Bei jeder Anfrage nach einem Build, einer Kaufreihenfolge, einem Itemvergleich oder einer Build-Optimierung:

1. Lies `prompts/build_optimizer.md` vollständig und befolge es als verbindliches Arbeitsverfahren.
2. Verwende `schemas/build_request_schema.md` für Eingaben und Annahmen.
3. Verwende `schemas/build_result_schema.md` für das Ergebnis.
4. Vergleiche zuerst `data/core/manifest.json` und `data/heroes/manifest.json` auf Patch- und Moduskompatibilität.
5. Lade nur die für den angefragten Helden, die Kandidaten und die betroffenen Mechaniken benötigten Datensätze.
6. Rechne Kosten, Investments, Schwellen, Upgrades, Slots und abgeleitete Werte deterministisch und nachvollziehbar. Verwende für größere Filter-, Join-, Such- oder Rechenaufgaben ein lokales Hilfsskript statt Kopfrechnen.
7. Nenne ein Ergebnis nur dann „optimal“, wenn der Suchraum und das Optimierungsziel klar definiert sind und die geprüften Kandidaten den behaupteten Suchraum abdecken. Sonst nenne es „bester geprüfter Build“.
8. Führe die Schlusskontrolle aus `prompts/build_optimizer.md` aus, bevor du eine Empfehlung abgibst.
9. Schreibe Ergebnisse nur auf ausdrücklichen Wunsch nach `builds/`; ansonsten gib sie im Chat aus.

## Recherchegrenze

- Starte bei normalen Build-Anfragen keine vollständige Webrecherche.
- Recherchiere nur, wenn der Nutzer es verlangt, die Manifeste widersprüchlich sind oder der Datenstand erkennbar nicht aktuell genug ist.
- `deadlock.wiki` bleibt bei neuer Spielrecherche die verpflichtende Primärquelle; `deadlockwiki.org` ist ausgeschlossen.


# Sidestep Deadlock – Projektübergabe für ChatGPT Cloud

Stand dieser Übergabe: 4. September 2026. Dieses Dokument ist als Gesprächs- und Arbeitskontext für ein neues ChatGPT-Cloud-Projekt gedacht. Es fasst den aktuellen Wissensstand zusammen; es ist keine Spezifikation eines bereits fertigen Produkts und nimmt keine Implementierung vor.

## 1. Kurzfassung

Sidestep Deadlock soll aus verifizierten, patchgebundenen Deadlock-Daten nachvollziehbare Build-Analysen erzeugen. Der belastbare Teil des Projekts ist aktuell vor allem die Daten-, Quellen-, Schema- und Verfahrensbasis. Zusätzlich existiert lokal eine erste statische Weboberfläche, die echte Projektdaten lädt, aber **noch keinen echten Build-Optimizer** enthält.

Die wichtigste Trennung für jede weitere Arbeit ist:

- `data/core/`, `data/heroes/` und `data/interactions/` sind die verbindlichen Datenquellen.
- `research/` erklärt Herkunft, Abdeckung und Unsicherheiten, ersetzt aber keine fehlenden Masterdaten.
- `data/api/` ist ein technischer Vergleichs- und Reviewbereich, nicht automatisch kanonisch.
- `prompts/build_optimizer.md` und die Build-Schemas definieren, wie eine belastbare Analyse aussehen muss.
- `app/` ist zurzeit eine UI-Demo mit ausdrücklich markierter Testlogik, keine produktive Build-Empfehlung.

## 2. Produktziel und Qualitätsversprechen

Die Produktidee ist ein datenbasierter Deadlock-Build-Assistent:

1. Der Nutzer wählt einen Helden.
2. Er beschreibt Ziel, Spielstil und optional Matchkontext.
3. Das System vergleicht legale Itempfade, Kosten, Kategorie-Investments, Schwellen, Slots, Fähigkeiten und bekannte Sonderinteraktionen.
4. Das Ergebnis erklärt Kaufreihenfolge, Alternativen, Annahmen, Rechnungen und Unsicherheiten.

Das Projekt soll keine Meta-Empfehlungen aus Modellwissen, Popularität oder Bauchgefühl erzeugen. Spielwerte dürfen nur aus den lokalen, verifizierten Daten stammen. Fehlende oder widersprüchliche Informationen bleiben als Unsicherheit sichtbar.

Ein Ergebnis darf nur dann `optimal` heißen, wenn Ziel, Randbedingungen und Suchraum klar definiert und vollständig beziehungsweise reproduzierbar geprüft wurden. Ansonsten lautet die Kennzeichnung `best_evaluated` beziehungsweise im Nutzertext „bester geprüfter Build“.

## 3. Verbindliche Projektregeln

Die zentrale Arbeitsanweisung liegt in `AGENTS.md`:

- Standardsprache gegenüber dem Nutzer ist Deutsch.
- „Champion“ wird intern als „Held“ behandelt, ohne den Nutzer zu korrigieren.
- Kanonische Daten werden nur auf ausdrücklichen Auftrag zur Datenpflege oder Recherche verändert.
- Normale Build-Anfragen lösen keine vollständige Webrecherche aus.
- Wenn neue Spielrecherche nötig ist, ist `deadlock.wiki` die verpflichtende Primärquelle; `deadlockwiki.org` ist ausgeschlossen.
- Vor jeder Build-Analyse müssen Core- und Hero-Manifest auf Patch- und Moduskompatibilität geprüft werden.
- Kosten, Upgrades, Investments, Schwellen, Slots und abgeleitete Werte müssen deterministisch und nachvollziehbar berechnet werden.
- Build-Dateien unter `builds/` werden nur auf ausdrücklichen Wunsch erstellt.

Für Build-Arbeit sind außerdem zwingend:

- `prompts/build_optimizer.md` – vollständiges Arbeitsverfahren und Schlusskontrolle.
- `schemas/build_request_schema.md` – normalisierte Eingabe und Annahmen.
- `schemas/build_result_schema.md` – verpflichtender Ergebnisaufbau.

## 4. Aktueller Git- und Arbeitskopie-Stand

Repository:

- Remote: `https://github.com/Gaschde/sidestep-deadlock.git`
- Branch: `main`
- lokaler HEAD: `5717d2f179fab3976f0cacbcf7a2a4c4e49acbaf`
- letzter lokaler Commit: `README klarer und verständlicher formulieren`
- `main` ist **einen Commit vor `origin/main`**.
- `origin/main` stand bei der Prüfung auf `160211663db1fb2a516345c8c4add314444d0b42`.

Vor Erstellung dieser Übergabe gab es folgende nicht eingecheckte Änderungen:

- geändert: `.gitignore`
- geändert: `README.md`
- neu/untracked: `.superdesign/design-system.md`
- neu/untracked: `.superdesign/item-ui-assets.md`
- neu/untracked: `.superdesign/resume.json`
- neu/untracked: `.superdesign/sidestep-v10-1.html`
- neu/untracked: `app/app.js`, `app/index.html`, `app/lib.mjs`, `app/styles.css`
- neu/untracked: `package.json`, `server.mjs`, `tests/app.test.mjs`
- neu/untracked: `inputs_ideas/Loki.txt`, `inputs_ideas/french_dynamo.txt` (beide leer)

`.superdesign/tmp/` ist über `.gitignore` ausgeschlossen. `PROJECT_CONTEXT.md` kommt durch diese Übergabe als weitere neue Datei hinzu.

Wichtig für ChatGPT Cloud: Ein Projekt, das nur aus `origin/main` geladen wird, sieht weder den lokalen Commit noch die uncommitteten UI-/Design-Dateien und auch diese Übergabe nicht. Vor einer Git-basierten Cloud-Übergabe muss bewusst entschieden werden, welche lokalen Dateien eingecheckt und gepusht werden sollen.

## 5. Architektur auf einen Blick

```text
Nutzeranfrage
  -> AGENTS.md
  -> prompts/build_optimizer.md
  -> Build-Request nach schemas/build_request_schema.md
  -> Patch-/Modusprüfung der Manifeste
  -> gezieltes Laden aus data/core + data/heroes + data/interactions
  -> deterministische Suche und Berechnung (noch nicht als Produkt-Engine implementiert)
  -> Build-Result nach schemas/build_result_schema.md

deadlock.wiki / Patchquellen
  -> Generatoren und Audit
  -> kanonische Daten + research-Nachweise

Deadlock Assets API
  -> data/api/raw + mapped + diff + review_required
  -> manuelles Approval-Gate
  -> erst danach mögliche kanonische Änderung

Lokale Web-App
  -> lädt ausgewählte kanonische CSV-/JSON-Dateien direkt im Browser
  -> zeigt Auswahl, Datenstatus, Test-Kaufpfad, Fähigkeiten und Interaktionskontext
  -> enthält derzeit keine echte Optimierungsengine
```

Es gibt aktuell keinen Backend-Service, keine Datenbank, kein Benutzerkonto und keine produktive Deployment-Konfiguration. Die Web-App besteht aus statischen Dateien und einem kleinen lokalen Node-HTTP-Server.

## 6. Repository-Struktur und relevante Dateien

| Pfad | Rolle | Status |
|---|---|---|
| `AGENTS.md` | Verbindliche Projekt- und Datenregeln | kanonische Arbeitsanweisung |
| `README.md` | Nutzerorientierter Überblick und lokale Startanleitung | lokal geändert |
| `prompts/build_optimizer.md` | Detailliertes Build-Verfahren mit Pflichtkontrolle | vorhanden, noch nicht als Software-Engine umgesetzt |
| `schemas/` | Verträge für Core-, Hero-, Interaktions-, API- und Build-Daten | maßgeblich für Struktur |
| `data/core/` | Items, Kosten, Upgrades, Investments, Slots, Objectives, globale Mechaniken | verbindliche Quelle |
| `data/heroes/` | Helden, Stats, Fähigkeiten, Upgrades, Ressourcen, Summons, Progression | verbindliche Quelle |
| `data/interactions/` | Verifizierte Sonderinteraktionen | verbindliche Quelle |
| `data/api/` | Versionierte Deadlock-API-Snapshots und Diffs | Review-/Vergleichsdaten, nicht automatisch kanonisch |
| `research/master/` | Audit für Core-Daten | Nachweis, keine Ersatzquelle |
| `research/heroes/` | Audit und Source-Cache für Heldendaten | Nachweis und Generator-Input |
| `tools/` | Daten-Generatoren, API-Sync und zwei separate Medienhilfen | teilweise Kern, teilweise projektfremde Hilfen |
| `tests/` | API-Importer-Tests, Fixtures und neue UI-Logiktests | Python- und Node-Testbereiche |
| `builds/` | Zielordner für ausdrücklich gespeicherte Build-Ergebnisse | aktuell nur README |
| `app/` | lokale, statische UI-Demo | uncommitted, Testlogik |
| `.superdesign/` | Designsystem, Asset-Mapping und Prototypenstatus | uncommitted; `tmp/` ignoriert |
| `archive/` | Platz für ältere Stände | aktuell ohne relevante sichtbare Dateien |
| `inputs_ideas/` | Ideenablage | zwei leere Platzhalter |

## 7. Kanonischer Datenstand

Core und Heroes sind laut Manifest kompatibel:

- Patch: `Minor Update - 08-22-2026`
- Datenstand: `2026-08-22`
- Modus: `Standard Match (6v6, three lanes)`
- Schema-Version: `0.1.0-research`
- Forschungsdatum: `2026-09-02`
- Client-Build: nicht verifiziert (`null`)

### Core-Daten (`data/core/`)

- 156 öffentliche Standard-Shop-Items
- 64 Komponenten-zu-Upgrade-Kanten
- 836 atomare Item-Mechanikzeilen
- 42 Quellen
- 14 dokumentierte Unsicherheiten
- Kategorien: 53 Weapon, 54 Vitality, 49 Spirit
- alle 156 Items sind als öffentliche Shop-Items markiert
- Mechanik-Konfidenz: 729 `high`, 107 `medium`, keine still verwendeten `low`-Zeilen

Wichtige Dateien:

- `items.csv`: Identität, Kategorie, Tier, Gesamtkosten, Aktivtyp, Patch, Konfidenz.
- `item_upgrades.csv`: Komponentenpfade und zusätzliche Zahlung.
- `item_mechanics.csv`: atomare Effekte mit Einheit, Bedingungen, Triggern, Zielbereich, Dauer und Cooldown.
- `economy.json`: Tierpreise, Verkauf/Rückgabe, Kategorie-Investment, Schwellen und Upgrade-Kostenregeln.
- `slots.json`: 9 Startslots, bis zu 3 zusätzliche Slots, insgesamt 12 Items und höchstens 4 aktive Items.
- `mechanics.json`: globale Berechnungsregeln, unter anderem Schaden, Resistenzen, Lifesteal, Heilung, Cooldowns, Charges, Dauer, Reichweite, Bewegung, Ammo, Procs und Summons.
- `objectives.json`: Guardian, Walker, Shrines, Patron, Midboss und allgemeine Objective-Regeln.
- `patches.json`, `sources.csv`, `uncertainties.csv`, `manifest.json`: Provenienz und Auditvertrag.

Die Kategorie-Investments werden aus den `total_cost`-Werten der **aktuell besessenen** Items berechnet, getrennt von den tatsächlich bezahlten Souls. Die Schwellen liegen bei 800, 1.600, 2.400, 3.200, 4.800, 6.400, 8.000, 11.200, 16.000, 22.400 und 28.800. Die 4.800er-Schwelle ist ausdrücklich als großer Powerspike markiert und muss in jeder relevanten Analyse separat geprüft werden.

### Heldendaten (`data/heroes/`)

- 60 dokumentierte Helden-Datensätze
- 38 laut post-patch Heroes-Seite öffentlich spielbare Helden
- 22 dokumentierte nicht öffentliche Datensätze
- 2.027 Hero-Stat-Zeilen
- 159 Fähigkeiten
- 3.211 atomare Fähigkeitseffekte
- 896 Upgrade-Änderungen
- 5 Heldenressourcen
- 7 Beschwörungen/erschaffene Einheiten mit 66 Mechanikzeilen
- 15 Quellen
- 6 dokumentierte Unsicherheiten
- Validierungsstatus: `PASS_WITH_WARNINGS`

`progression.json` trennt Fähigkeitsfreischaltungen, Ability Points und Item-Investment. Freischaltschwellen sind 600, 1.100, 2.000 und 3.800 Souls; Fähigkeitsupgrades kosten 1, 2 und 5 AP. Vier explizite Innates sind registriert: Ivy, Billy, Rem und Celeste. Silver besitzt dokumentierte Transformations-Slots.

### Interaktionen (`data/interactions/`)

`hero_interactions.csv` enthält 93 verifizierte Sonderinteraktionen:

- 21 `triggers` mit `high` confidence
- 72 `special_case` mit `medium` confidence

Das ist **keine vollständige Item×Ability-, Summon- oder Objective-Matrix**. Ein fehlender Eintrag bedeutet „unbekannt“, nicht „funktioniert nicht“.

## 8. Recherche- und Datenentscheidungen

Bereits getroffene, wichtige Entscheidungen:

1. `deadlock.wiki` ist Primärquelle; die ähnlich benannte Domain `deadlockwiki.org` ist ausgeschlossen.
2. ItemData ist der Rohwertanker; Sprachdaten liefern Labels und Einheiten.
3. Nicht in der aktuellen Standard-Infobox sichtbare Rohfelder werden nicht still als Live-Mechaniken übernommen. 187 solcher Felder sind als `UNC-0014` erhalten.
4. `PropertyUpgrades` wird nicht pauschal als Basiseffekt importiert, weil es Varianten-/Override-Daten enthalten kann.
5. Nicht belegtes Objective-, Proc-, Summon- oder Targeting-Verhalten bleibt leer beziehungsweise unsicher.
6. Hero- und Itemdaten trennen Basiswerte, Wachstum, Skalierungsattribute, Skalierungskoeffizienten und einzelne Upgrade-Änderungen.
7. Build-, Rollen-, Meta-, Matchup- und Skillorder-Empfehlungen wurden bewusst nicht in die Forschungsdaten geschrieben.
8. API-Snapshots dürfen kanonische Daten nicht automatisch überschreiben.
9. Upgradezahlung und Kategorie-Investment sind verschiedene Größen: bezahlt wird nach Komponentenrabatt; als aktuelles Investment zählt der Gesamtwert des besessenen Ziel-Items.
10. Street Brawl, Legendary Items und Enhanced-Varianten liegen außerhalb des derzeitigen Core-Scope.

## 9. Deadlock-API-Snapshotbereich

`tools/sync_deadlock_api.py` liest die öffentliche Assets API konservativ und nach Client-Version getrennt ein. Der aktuell archivierte Stand:

- letzte Client-Version: `6684`
- vier erhaltene Läufe vom 2. September 2026
- letzter Lauf: `20260902T135031Z`
- strukturelle Validierung des letzten Laufs: `PASS`, keine Warnungen
- 9.918 Änderungen/Abweichungen im Review
- 9.918 davon weiterhin `review_required`
- `canonical_data_modified: false`

Das Verzeichnis enthält unveränderte Raw-Antworten, normalisierte Mappings, Diffs, Reviewlisten, Validierung, Schema-Beobachtungen und Manifeste. Bereits gespeicherte Antworten derselben Client-Version werden bei Abweichungen versioniert statt überschrieben. Änderungen an kanonischen Dateien benötigen konkrete `change_id`-Freigaben und eine erneute Prüfung des bisherigen Werts.

`data/api/` ist mit rund 153 MB und vielen großen JSON-Dateien der größte Teil der Arbeitskopie. Für eine Cloud-Nutzung sollte entschieden werden, ob alle historischen Läufe im aktiven Projektkontext bleiben müssen oder ob ein schlankerer Zugriff genügt. Nicht löschen oder umstrukturieren, ohne die Audit-/Archivanforderung bewusst neu zu entscheiden.

## 10. Generatoren und Hilfswerkzeuge

Kernwerkzeuge:

- `tools/generate_core_data.py`: lädt Core-Quellen von `deadlock.wiki`, erzeugt Core-Daten und Auditberichte. Der Generator bricht absichtlich ab, wenn sich der neueste Wiki-Updateeintrag gegenüber `August 22 2026` geändert hat. Ein Lauf ist daher Datenpflege, keine harmlose Routine.
- `tools/generate_hero_data.py`: erzeugt Hero-, Summon- und Interaktionsdaten überwiegend aus dem geprüften Cache unter `research/heroes/source_cache/` und validiert Referenzen gegen Core.
- `tools/sync_deadlock_api.py`: versionierter, konservativer API-Importer mit Dry-Run, Fixtures, Retry/Rate-Limit, Hashes, Diffs und Approval-Gate.

Tests und Fixtures:

- `tests/test_sync_deadlock_api.py`: fünf Unittests für Versionswahl, Validierungsfehler, Dry-Run, unveränderte kanonische Daten und Revisionen gleicher Client-Version.
- `tests/fixtures/deadlock_api/`: kleine Offline-Fixtures für alle importierten Endpunkte.
- `tests/app.test.mjs`: drei Node-Tests für CSV-Parsing, Manifest-Kompatibilität und begrenzte Testpfadlogik.

Sonstige Werkzeuge:

- `tools/analyze_subtitles.py` und `tools/build_broadcast_assets.py` gehören nicht zum Build-Optimizer-Kern. Sie nutzen lokale Medienabhängigkeiten (`numpy`, Pillow und einen hart codierten lokalen FFmpeg-Pfad) und sollten im Cloud-Projekt nicht als notwendige Produktarchitektur missverstanden werden.

## 11. Aktuelle lokale Weboberfläche

Die Weboberfläche ist uncommitted und besteht aus:

- `app/index.html`: deutsche, desktop-orientierte Einzelseite.
- `app/styles.css`: responsives Occult-Noir/Green-Black-Design; lädt Google Fonts extern.
- `app/app.js`: Datenladen, UI-State, Helden-/Gegnerauswahl und Rendering.
- `app/lib.mjs`: CSV-Parser, Formatierung, Manifestprüfung und Test-Build-Logik.
- `server.mjs`: kleiner Node-Static-Server auf `127.0.0.1:4173`.
- `package.json`: nur `npm start` und `npm test`, keine Paketabhängigkeiten und kein Lockfile.

Lokaler Start laut README:

```text
npm start
```

Danach liegt die UI unter `http://127.0.0.1:4173/app/`.

Die UI kann bereits:

- 38 öffentliche Helden aus `heroes.csv` laden und durchsuchen.
- einen Helden und zwei optionale Lane-Gegner auswählen.
- sechs grobe Spielstil-Presets und ein Budget auswählen.
- Patch-/Moduskompatibilität anzeigen.
- echte Itemnamen, Kosten, Kategorien und Upgrade-Kanten laden.
- einen deutlich als Testdaten markierten Early/Mid/Late/Final-Pfad anzeigen.
- die Fähigkeiten des gewählten Helden sowie Freischaltschwellen und AP-Kosten darstellen.
- passende verifizierte Interaktionszeilen als Kontext anzeigen.

Sie kann ausdrücklich **noch nicht**:

- das in `prompts/build_optimizer.md` beschriebene Optimierungsproblem lösen.
- Heldenwerte, Itemeffekte, Gegnerprofile und Ziele in eine echte Bewertungsfunktion einbeziehen.
- Kategorie-Investments und alle Schwellen korrekt pro Schritt ausweisen.
- alle Slotfreischaltungen und das Active-Limit über den vollständigen Pfad validieren.
- echte Schadens-, EHP-, Cooldown-, Uptime- oder Marginalnutzen-Rechnungen ausführen.
- einen vollständigen Suchraum, Pareto-Varianten oder Sensitivitäten berechnen.
- eine optimierte Fähigkeitsreihenfolge berechnen.

`createTestBuild()` sortiert derzeit im Wesentlichen nach Stil-Kategoriereihenfolge, Tier und Name, wählt einfache Kandidaten aus und versucht einzelne Upgrades. Der ausgewählte Held und die Lane-Gegner beeinflussen die Kaufreihenfolge nicht. Das Inventarlimit ist dort fest auf 9 gesetzt. Multi-Komponenten-Upgrades werden anhand eines Notes-Filters ausgelassen. Das ist bewusst Demo-Logik und wird in der UI mehrfach so gekennzeichnet.

Weitere UI-Grenzen:

- Die Advanced-Optionen `Power Spike`, `Risiko` und `Aktive Items` sind sichtbar, aber nicht mit der Testauswahl verbunden; nur Stil und Budget wirken.
- Originale Heldenbilder sind nur für Warden, Vyper und Abrams hinterlegt; sonst erscheinen Initialen.
- Itemdarstellung nutzt Initialen statt der im Design-Dokument vorgesehenen Originalicons.
- Google Fonts und die drei Bild-URLs sind externe Laufzeitabhängigkeiten.
- Es gibt keine Build-, Bundle- oder Deployment-Konfiguration.

## 12. Designstand und bisherige UX-Entscheidungen

Unter `.superdesign/` liegen ein Designsystem, ein Asset-Mapping, ein Resume/Prototypstatus und eine ausgewählte HTML-Studie. Der aktive Entwurf heißt laut Resume `Sidestep Version 10.1 — Focus Build Workspace`.

Wichtige Designentscheidungen:

- Produktidentität `SIDESTEP`, Untertitel `Deadlock Build Optimizer`.
- Occult Noir statt generischem SaaS-Look: grün-schwarze Flächen, Elfenbeintext, zurückhaltendes Messing und semantische Itemfarben.
- Hauptfluss: Held, Spielstil, optional genau zwei Lane-Gegner, Berechnung.
- Advanced Options standardmäßig eingeklappt.
- kompakte Kaufzeilen für lange Kaufpfade.
- getrennte Early/Mid/Late-Ansichten und ein kompakter Final Build.
- Lane-Counter nur als bedingter Kontext, nie still als Pflichtkauf.
- Fähigkeitspunkte als chronologische 16-Schritt-Darstellung mit getrennten Unlocks und 1/2/5-AP-Upgrades.
- keine erfundenen Winrates, Pickrates, Ränge oder Matchstatistiken.
- Demo-Werte und noch nicht berechnete Empfehlungen müssen klar markiert bleiben.

Es gibt einen kleinen Richtungswiderspruch: Der aktive Resume-Entwurf beschreibt eine „English-only“-Richtung, während `AGENTS.md`, das Designsystem und die implementierte UI Deutsch vorsehen. Für die nächste Phase sollte die Produktsprache ausdrücklich festgelegt werden; die derzeitige Projektregel ist Deutsch.

## 13. Build-Vertrag für zukünftige Implementierung oder Chat-Analyse

Ein normalisierter Request benötigt mindestens:

- exakte `hero_id`
- messbares `objective`

Optional sind unter anderem Budget/Checkpoints, Level, Skillstand, Fokusfähigkeiten, Zielprofil, Treffer-/Headshot-/Uptime-Annahmen, Mindestanforderungen, gewünschte/ausgeschlossene Items, Objective-Fokus und Risikopräferenz.

Jede ernsthafte Build-Auswertung muss:

- für alle Kandidaten identische Randbedingungen verwenden.
- jeden Kauf mit Zahlung, kumulativen Souls, aktuellem Inventar, Kategorie-Investments, Schwellen und Slots protokollieren.
- Komponenten beim Upgrade ersetzen und nicht doppelt zählen.
- Itemstats und Investmentboni getrennt halten.
- Basiswerte, Levelwachstum, Skill-Upgrades, flache Werte, additive und multiplikative Modifikatoren, Bedingungen, Procs und Zielresistenzen in dokumentierter Reihenfolge behandeln.
- Theorie-Maximum von realistischer Uptime trennen.
- Kernitems gegen ernsthafte Alternativen und deren Wechselbedingungen vergleichen.
- am Ende eine unabhängige Schlusskontrolle durchführen.

Das Ergebnis folgt `schemas/build_result_schema.md`: Status/Geltungsbereich, Annahmen, vollständiger Kaufpfad, finaler Build, berechnete Metriken, Fähigkeitentabelle, marginaler Itemnutzen, Alternativen/Unsicherheiten und Validierungsblock.

## 14. Wichtigste offene Datenfragen

Core:

- exakte Client-Build-ID des verifizierten Patches (`UNC-0001`)
- vollständige Patch-Synchronität von Objective-/NPC-/Convar-/Misc-Daten (`UNC-0002`)
- genaue Refund-Grenze (`UNC-0003`)
- temporärer Slotbedarf beim Upgrade eines vollen Inventars (`UNC-0004`)
- Itemwirkung auf Objectives (`UNC-0005`)
- Shrine-Bounty, Shrine-Resistenzhistorie, Walker-Stomp- und Patron-Explosion-Cooldown (`UNC-0006` bis `UNC-0009`)
- Damage-Reduction-Stacking und Slide-Schwelle (`UNC-0010`, `UNC-0011`)
- Multi-Komponenten-Zahlung bei Leech und Sharpshooter (`UNC-0013`)
- nicht sichtbare ItemData-Felder und prose-only Randfälle (`UNC-0014`, `UNC-0015`)

Heroes/Interaktionen:

- Client-Build und vollständige HeroData-Synchronität (`HUNC-0001`, `HUNC-0002`)
- fehlende vollständige Item×Ability-Matrix (`HUNC-0004`)
- Summon-Vererbung, Procs, Lifesteal und Objective-Regeln (`HUNC-0005`)
- widersprüchliche technische Auswählbarkeit nicht öffentlicher Helden (`HUNC-0006`)
- veraltete gerenderte Vergleichstabellen (`HUNC-0007`)

Diese Punkte sind keine automatischen Blocker für jede Analyse. Sie müssen aber berücksichtigt werden, wenn sie das konkrete Optimierungsziel beeinflussen.

## 15. Technischer Prüfstand

Beim Erstellen dieser Übergabe:

- Node.js: `v24.19.0`
- npm: `11.17.0`
- `npm test`: 3 von 3 Tests bestanden
- ein `python`/`py`-Befehl war in der aktuellen lokalen Shell nicht verfügbar; deshalb wurden die fünf vorhandenen Python-Unittests in dieser Sitzung nicht ausgeführt

Der Importer verwendet nur die Python-Standardbibliothek. Die beiden Medienwerkzeuge haben zusätzliche beziehungsweise lokale Abhängigkeiten. Für ChatGPT Cloud muss die verfügbare Laufzeit neu geprüft werden; die oben genannten lokalen Versionsnummern sind keine Cloud-Anforderung.

## 16. Offene Produkt- und Architekturentscheidungen

Die nächsten Gespräche sollten vor Implementierung mindestens diese Fragen klären:

1. Was ist der nächste Meilenstein: belastbare Chat-basierte Build-Analyse, echte lokale Web-App oder Cloud-Produkt?
2. Soll der Optimizer als wiederverwendbare Engine hinter der UI entstehen oder zunächst als deterministisches Analysewerkzeug für einzelne Anfragen?
3. Welche Metrik beziehungsweise welcher kleine erste Use Case soll Ende-zu-Ende korrekt funktionieren (zum Beispiel ein Held, ein messbares Ziel, ein Budget)?
4. Welche uncommitteten UI-/Design-Artefakte gehören in den offiziellen Repository-Stand?
5. Soll die Produktsprache Deutsch bleiben oder Englisch werden?
6. Wie werden Icons und Portraits langfristig bezogen, lizenziert, gecacht und offline/deploybar gemacht?
7. Müssen alle historischen API-Läufe im Cloud-Projekt liegen, oder reicht der letzte Snapshot plus Auditnachweis?
8. Wie und wo soll die Anwendung später gehostet werden? Der aktuelle Server ist nur lokal und bindet an Loopback.

## 17. Empfohlene nächste Schritte

Ohne jetzt etwas zu implementieren, ist die sinnvollste Reihenfolge:

1. Arbeitskopie prüfen und entscheiden, welche lokalen UI-, Design- und Übergabedateien übernommen werden.
2. Den gewünschten Stand committen und pushen, damit ChatGPT Cloud denselben Inhalt sieht.
3. Im Cloud-Projekt `AGENTS.md` und dieses Dokument als Startkontext verwenden.
4. Einen kleinen, überprüfbaren ersten Produkt-Slice festlegen.
5. Erst dann eine echte Optimierungsengine entwerfen, die Request-/Result-Schema und die Pflichtkontrolle direkt abbildet.
6. UI-Demo anschließend an echte Engine-Ergebnisse anbinden; bis dahin alle Testkennzeichnungen behalten.
7. Datenrefresh oder Client-Tests nur separat und mit bewusstem Datenpflegeauftrag durchführen.

## 18. Vorschlag für die erste Nachricht im Cloud-Projekt

```text
Lies zuerst AGENTS.md und PROJECT_CONTEXT.md. Behandle data/core/, data/heroes/ und data/interactions/ als verbindliche Quellen. Die lokale Weboberfläche ist aktuell nur eine deutlich markierte Demo und enthält keine echte Build-Optimierung. Hilf mir zunächst, den nächsten kleinen Meilenstein zu definieren und die offenen Produkt-/Architekturentscheidungen zu priorisieren. Verändere noch keine kanonischen Daten und implementiere erst, wenn wir den Scope ausdrücklich festgelegt haben.
```

## 19. Merksatz für die Übergabe

Der Daten- und Prüfvertrag ist deutlich weiter als die Anwendung: Die nächste Phase sollte nicht neue Spielwerte erfinden oder die Demo als Optimizer ausgeben, sondern einen kleinen Teil des vorhandenen, strengen Build-Verfahrens deterministisch und testbar in ein echtes Produktstück überführen.

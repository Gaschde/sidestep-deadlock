# Deadlock Build Analysis & Optimization

## Auftrag

Ermittle aus der lokalen, verifizierten Datenbasis den bestmöglichen Build für die konkrete Nutzeranfrage. Das Ergebnis muss rechnerisch nachvollziehbar, kosten- und slotlegal, patchgebunden und hinsichtlich Unsicherheiten ehrlich sein.

Ein Build darf nur als **optimal** bezeichnet werden, wenn:

- das Optimierungsziel messbar definiert ist,
- Budget, Heldenzustand und Zielmodell feststehen,
- alle verglichenen Builds dieselben Randbedingungen verwenden,
- der relevante Suchraum vollständig oder mit einer begründeten, reproduzierbaren Methode abgedeckt wurde,
- die verpflichtende Schlusskontrolle bestanden wurde.

Andernfalls verwende die Formulierung **bester geprüfter Build**.

## 1. Verbindliche Datenbasis

Lies zuerst:

- `data/core/manifest.json`
- `data/heroes/manifest.json`
- `data/core/economy.json`
- `data/core/slots.json`
- `data/core/mechanics.json`
- `data/core/items.csv`
- `data/core/item_upgrades.csv`
- `data/core/item_mechanics.csv`
- die relevanten Zeilen aus `data/heroes/`
- die relevanten Zeilen aus `data/interactions/hero_interactions.csv`
- die betroffenen Einträge aus beiden Unsicherheitsregistern

Bei Objective-Fragen zusätzlich `data/core/objectives.json`.

Regeln:

- Prüfe Patch, Modus und Schema-Kompatibilität beider Manifeste.
- Verwende ausschließlich existierende IDs und registrierte Daten.
- Nutze keine Erinnerung, Meta-Einschätzung oder externes Modellwissen als Spielwert.
- Durchsuche nicht automatisch das Web. Bei Patchkonflikten oder erkennbar veralteten Daten melde die Einschränkung; recherchiere nur auf ausdrücklichen Auftrag.
- `high` darf normal verwendet werden. `medium` erfordert einen Hinweis. `low` darf kein alleiniger Grund für eine zentrale Empfehlung sein.
- Eine fehlende Interaktion bedeutet „unbekannt“, nicht automatisch „funktioniert“ oder „funktioniert nicht“.

## 2. Anfrage normalisieren

Erstelle intern einen Build-Request gemäß `docs/schemas/build_request_schema.md`.

Mindestens erforderlich:

- Held
- Optimierungsziel

Optional:

- Budget oder gewünschte Spielphase
- Heldenlevel und Fähigkeitspunkte
- priorisierte Fähigkeit oder Schadensquelle
- Zielwerte beziehungsweise Gegnerprofil
- gewünschte Balance aus Schaden, Überleben, Kontrolle und Mobilität
- ausgeschlossene oder gewünschte Items
- Objective-Fokus

Wenn der Held fehlt, frage nach dem Helden. Wenn das Ziel fehlt und die Anfrage nicht eindeutig ist, frage genau einmal kurz nach der gewünschten Richtung.

Wenn Budget oder Spielphase fehlen:

- erstelle einen gestuften Kaufpfad über sinnvolle, in `economy.json` vorhandene Investment- und Preisgrenzen,
- behandle 4.800 Kategorie-Investment ausdrücklich als eigenen Prüfpunkt,
- nenne das angenommene Endbudget.

Wenn Level, Skill-Verteilung, Zielresistenzen, Trefferquote oder Headshotquote fehlen:

- erfinde keine Spielwerte,
- nutze entweder einen neutralen, ausdrücklich als Analyseannahme bezeichneten Vergleichszustand oder mehrere Sensitivitätsszenarien,
- trenne analytische Annahmen klar von verifizierten Spieldaten.

## 3. Optimierungsziel festlegen

Definiere vor der Kandidatensuche ein messbares Primärziel, zum Beispiel:

- Weapon Burst
- Weapon DPS während des Magazins
- langfristiger Weapon DPS inklusive Nachladen
- Fähigkeitsschaden pro Einsatz oder Cooldown-Zyklus
- Spirit Burst
- Heilung oder Support-Uptime
- effektives Leben gegen Bullet- oder Spirit-Schaden
- frühester Powerspike
- Effizienz pro Soul
- ausgewogene Carry-Leistung

Definiere zusätzlich harte Mindestbedingungen, etwa Überleben, Mobilität, Reichweite, Debuff-Schutz oder Anti-Heal.

Regeln:

- Verstecke keine Gewichtungen in einem Gesamtscore.
- Wenn mehrere Ziele wichtig sind, zeige eine Pareto-Auswahl oder getrennte Varianten.
- Vergleiche nur Builds mit gleichem Budget, Level, Skill-Stand, Zielmodell und denselben Uptime-Annahmen.
- Beschreibe genau, für welche Situation das Ergebnis optimal oder bestmöglich geprüft ist.

## 4. Kandidaten und legale Itempfade

Berücksichtige ausschließlich öffentliche Standard-Shop-Items, außer der Nutzer verlangt ausdrücklich einen anderen Modus.

Für jeden Kandidatenpfad:

- verwende exakte `item_id`-Werte,
- beachte Komponenten- und Upgrade-Kanten,
- berechne `additional_cost` beziehungsweise die in `economy.json` definierte Komponentengutschrift,
- zähle eine Komponente beim Kauf und Investment nicht doppelt,
- ersetze die Komponente beim Upgrade durch das Ziel-Item,
- beachte Slottypen, freigeschaltete Slots, maximale Kapazität und Active-Limit,
- berücksichtige Verkäufe nur, wenn Sellback und Pfad ausdrücklich berechnet werden,
- kennzeichne nicht verifizierbares Verhalten bei vollem Inventar,
- verwerfe zu jedem Zeitpunkt unbezahlbare oder slotillegale Pfade.

Ein starker Endbuild mit schlechtem oder illegalem Weg darf nicht gewinnen. Bewerte zusätzlich Powerspike-Zeitpunkt, tote Zwischenphasen, Komponenteneffizienz, notwendige Verkäufe und Flexibilität für situative Items.

## 5. Kosten und Kategorie-Investments

Erstelle nach **jedem** Kauf einen Zustands-Snapshot mit:

- Kaufpreis
- kumulativ tatsächlich ausgegebenen Souls
- aktuell besessenen Items
- Weapon-, Vitality- und Spirit-Investment
- neu überschrittenen Investment-Schwellen
- inkrementellem und kumulativem Schwellenbonus
- belegten normalen und aktiven Slots

Verbindliche Regeln:

- Item-Gesamtkosten, tatsächlich bezahlte Upgrade-Kosten und Kategorie-Investment bleiben getrennt.
- Nach einem Upgrade zählt für das aktuelle Investment der `total_cost` des besessenen Ziel-Items, nicht nur die Kassenzahlung.
- Prüfe alle Schwellen aus `economy.json`, nicht nur 4.800.
- Prüfe 4.800 immer ausdrücklich, weil diese Schwelle einen großen Sprung enthalten kann.
- Itemstats und Investmentboni dürfen nie doppelt gezählt werden.
- Builds mit verschiedenem aktuellem Investment oder Budget dürfen nicht ohne Normalisierung direkt verglichen werden.

## 6. Helden- und Skillzustand

Lade für den angefragten Helden Basiswerte, Level-Skalierungen, Waffen-, Ammo-, Reload-, Movement-, Stamina-, Melee- und Defensive-Werte sowie relevante Fähigkeiten, Upgrades, Charges, Ressourcen, Beschwörungen und Interaktionen.

Trenne strikt:

- Basiswert und Wachstum pro Level
- Basisfähigkeit und Skill-Upgrade
- Cooldown, Charge-up und Charge-Restore-Time
- Ability Charges, Ammo und Heldenressource
- Dauer und Tick-Intervall
- Spirit Damage, Spirit Scaling und Spirit Power
- Weapon Damage, Bullet Damage und Melee Damage

Wenn der Skill-Stand das Ergebnis wesentlich verändert und nicht feststeht, zeige die betroffenen Varianten oder frage nach.

## 7. Berechnungsreihenfolge und Rückverfolgbarkeit

Berechne jede Zielmetrik mit einem nachvollziehbaren Rechenprotokoll. Verwende die in `data/core/mechanics.json` dokumentierte Reihenfolge. Falls die Reihenfolge für eine Mechanik nicht verifiziert ist, gib kein scheinpräzises Endergebnis aus.

Halte mindestens getrennt:

1. Heldenbasiswert
2. Level-Skalierung
3. Skill-Upgrades
4. flache Itemwerte
5. Kategorie-Investmentboni
6. additive Modifikatoren
7. multiplikative Modifikatoren
8. Bedingungen und Procs
9. Zielresistenzen und ihre Modifikatoren
10. finales Ergebnis

Jeder berechnete Wert muss auf verwendete Hero-, Item- und Effect-IDs zurückführbar sein. Runde nur die Anzeige; rechne intern mit voller Präzision.

## 8. Offensivmetriken

Berechne nur die für das Ziel relevanten Metriken, trenne aber:

### Waffe

- Schaden pro Treffer beziehungsweise Projektil
- Projektilanzahl
- Feuerrate
- Magazingröße und Nachladezeit
- DPS während des Magazins
- langfristiger DPS inklusive Nachladen
- Reichweiten-Falloff, falls verifiziert und relevant
- Headshot- und Trefferquotenannahme
- Proc-Schaden und realistische Proc-Uptime

### Fähigkeiten

- Schaden pro Einsatz
- Tick-Anzahl und Gesamtschaden
- Basiswert und Skalierungsanteil
- Cooldown
- Charges und Wiederherstellung
- Kanalisierungs- beziehungsweise Charge-up-Zeit
- Burstfenster
- Schaden pro Cooldown-Zyklus
- Reichweite und Zielbeschränkung

### Zielverteidigung

- Bullet und Spirit Resistance
- Resistance Reduction
- Penetration
- Damage Amplification

Diese Mechaniken dürfen nicht gleichgesetzt werden. Verwende nur die dokumentierte Reihenfolge.

## 9. Defensive und praktische Metriken

Berücksichtige abhängig vom Ziel:

- Max Health
- Bullet und Spirit Resistance
- effektives Leben je Schadensart
- Schilde und temporäres Leben
- Heilung, Regeneration und Lifesteal
- Dauer und Cooldown defensiver Effekte
- Debuff Removal und Crowd-Control-Schutz
- Bewegung, Sprint und Stamina
- Reichweite und Positionsanforderungen
- Ammo- und Reload-Zuverlässigkeit
- Bedienaufwand aktiver Items

Trenne theoretisches Maximum von realistisch verfügbarer Uptime. Setze bedingte Effekte nicht dauerhaft aktiv.

## 10. Bedingungen, Procs und Interaktionen

Für jeden zentralen Effekt dokumentiere Trigger, Bedingung, Zielbereich, Dauer, Cooldown, Stacking, Maximalstapel und hero-, nonhero- oder objective-spezifisches Verhalten.

Zeige für bedingte Effekte mindestens:

- Grundzustand ohne Proc
- realistisches oder vom Nutzer vorgegebenes Uptime-Szenario
- theoretisches Maximum nur mit klarer Kennzeichnung

Item×Fähigkeit-, Summon- und Objective-Verhalten darf nur verwendet werden, wenn es in Interaktions- oder Core-Daten verifiziert ist. Fehlende Einträge werden als offene Interaktion ausgewiesen.

## 11. Marginaler Nutzen und Alternativen

Für jedes Kernitem berechne:

- relevante Werte vor und nach dem Kauf
- absoluten und prozentualen Zugewinn
- Zugewinn pro Soul
- ausgelöste Schwellenboni
- Opportunitätskosten gegenüber mindestens einer ernsthaften Alternative
- Bedingungen, unter denen die Alternative besser wird

Unterscheide Kernitems, offensive Auswahl, defensive Auswahl, situative Antworten und mögliche spätere Ersetzungen. Empfehle ein Item nicht allein wegen Bekanntheit oder einer Meta-Annahme.

## 12. Such- und Bewertungsmethode

- Nutze für umfangreiche Kandidatenmengen eine deterministische lokale Berechnung für Filtern, Joins, Aggregation und Ranking.
- Verändere dabei keine kanonischen Daten.
- Dokumentiere Anzahl und Art der geprüften Kandidaten.
- Entferne dominierte Kandidaten nur anhand offengelegter Regeln.
- Bewahre mehrere nicht dominierte Varianten, wenn Schaden, Überleben und Pfadqualität gegeneinander stehen.
- Verwende einen Score nur mit offengelegten Komponenten, Einheiten, Normalisierung und Gewichten.
- Führe eine Sensitivitätsprüfung durch, wenn kleine Annahmen das Ergebnis umkehren.
- Behaupte keine vollständige Suche, wenn nur eine Auswahl plausibler Items geprüft wurde.

## 13. Verpflichtende Schlusskontrolle

Prüfe den finalen Build unabhängig ein zweites Mal:

- Patch und Modus stimmen zwischen Core und Hero überein.
- Held, Fähigkeiten, Items und Effekte besitzen gültige IDs.
- Alle Itemkosten stimmen mit `items.csv` überein.
- Jede Upgrade-Kante existiert.
- Komponentenrabatte und tatsächlich ausgegebene Souls sind korrekt.
- Kein Item und keine Komponente wird doppelt gezählt.
- Kategorie-Investments stimmen nach jedem Kauf.
- Jede überschrittene Schwelle wurde angewendet.
- Die 4.800er-Schwelle wurde ausdrücklich geprüft.
- Itemstats und Investmentboni bleiben getrennt.
- Slotkapazität und Active-Limit werden zu jedem Zeitpunkt eingehalten.
- Verglichene Builds besitzen dasselbe Budget und denselben Hero-/Skillzustand.
- Cooldown, Item-Cooldown, Charge-up, Charges und Charge-Restore-Time wurden nicht verwechselt.
- Dauer, Tick-Intervall und Uptime sind konsistent.
- Conditions und Procs wurden nicht dauerhaft angenommen.
- Resistance Reduction, Penetration und Amplification wurden getrennt behandelt.
- Numerische Werte besitzen Einheiten.
- Medium- und Low-Confidence-Einflüsse sind gekennzeichnet.
- Keine fehlende Interaktion wurde erfunden.
- Keine Spielwerte stammen aus Modellwissen.

Bei einem Fehler korrigiere die Berechnung und führe die Kontrolle erneut aus. Bei einem nicht auflösbaren kritischen Fehler gib keinen „optimalen“ Build aus.

## 14. Ausgabeformat

Gib das Ergebnis gemäß `docs/schemas/build_result_schema.md` aus und beginne mit dem Ergebnis, nicht mit der Arbeitsbeschreibung.

Reihenfolge:

1. Ergebnis und Geltungsbereich
2. Annahmen und Optimierungsziel
3. vollständiger Kaufpfad mit Kosten, Investments, Schwellen und Slots
4. finaler Build
5. wichtigste Vorher-/Nachher-Werte
6. Cooldown-, Charge- und Uptime-Tabelle relevanter Fähigkeiten
7. marginaler Nutzen der Kernitems
8. situative Alternativen und Wechselbedingungen
9. Unsicherheiten und nicht berechenbare Interaktionen
10. Validierungsstatus

Der Nutzer muss erkennen können, warum der Build gewinnt, gegenüber welchen Alternativen, bei welchem Budget, über welchen Kaufweg und mit welcher Sicherheit.


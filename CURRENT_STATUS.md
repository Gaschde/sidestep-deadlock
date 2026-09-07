# Sidestep – aktueller Stand

Stand: 7. September 2026. Dieses Dokument beschreibt die lokale Arbeitskopie. GitHub kann abweichen, solange lokale Änderungen nicht committed und gepusht sind.

## Was das Projekt jetzt wirklich kann

- Verifizierte, patch-kompatible Daten für Items, Helden, Fähigkeiten, Kosten, Upgrades, Investments, Slots, globale Mechaniken und belegte Sonderinteraktionen.
- Lokale Web-App unter `http://127.0.0.1:4173/app/` nach `npm start`.
- Ein echter, begrenzter **Warden Weapon-Carry-Optimizer**:
  - legale Vorwärtssuche über Käufe und Upgrades;
  - Kosten, Komponentenrabatte, aktuelle Kategorie-Investments, Schwellen, Slots und Active-Limit;
  - einzelne Verkauf-/Ersetzungsschritte mit verifiziertem 50%-Sellback;
  - keine Preis-/Tier-Sperre, keine vorgeschriebenen Startitems, keine starre Weapon-/Vitality-Endquote und kein Upgrade-Anzahl-Bonus;
  - Kaufpfad-Messung bei 3'200, 4'800, 7'200, 12'000, 20'000, 30'000 und 40'000 Souls sowie getrennte 35k/40k/45k/60k-Sensitivitätsausgabe;
  - eine robuste Frühbasis als offene Modellannahme: bei 4'800 Weapon plus Schutz oder gekauftes Sustain; bei 7'200 Weapon, Schutz und gekauftes Sustain. Kleine Neben-HP und unmodellierte Heldenskills zählen nicht als Ersatz;
  - generische Kit-/Item-Bezüge für Spirit→Weapon, Reichweite, Projektilgeschwindigkeit und Distanzbedingungen. Ohne Positions-/Uptime-Annahme werden bedingte Vorteile nur dokumentiert, nicht eingerechnet;
  - Charged-Ability-Items werden für Helden ohne dokumentierte Charges ausgeschlossen; Warden erhält deshalb Recharging Rush nicht.

## Berechnung – aktueller Stand

- Sustained Weapon DPS rechnet Magazin, Feuerrate und Nachladen aus denselben Basiswerten für Ergebnis, Pfadmesspunkte und die bestehende Vorauswahl.
- Spirit erhöht Wardens Weapon-DPS nur über die verifizierte Rounds-per-Second-Skalierung. Die bereits abgeleitete `sustained_dps_spirit_scaling` wird nicht zusätzlich addiert.
- Permanente Resistenzen gleicher Art werden nach der kanonischen Regel `RES-002` multiplikativ kombiniert.
- Heilung pro Lane-Treffer, Heilung pro Zeit und Lifesteal-Prozente sind getrennte Werte.
- Heilungs- und Bewegungswerte bleiben nach permanent, aktiv und bedingt getrennt. Ohne Trigger-/Uptime-Modell werden sie nicht als gleichzeitig verfügbar behandelt.
- Ohne explizit eingegebenen und modellierten Heldenlevel/Skillzustand gelten nur kanonische Basiswerte. Skill- und Level-Boni werden nicht erfunden.
- Selbst-Risiken mit belegten Nachteilen bleiben im robusten Standardpfad ausgeschlossen.

## Was die App zeigt

- Den gesamten Kaufpfad mit Kaufreihenfolge, Kosten und Upgrade-/Ersetzungsereignissen.
- Baseline-Sustained-DPS, Bullet-/Spirit-EHP, dokumentierte Kit-/Item-Bezüge und die Frühbasis-Prüfung.
- Den offenen Vergleichszustand: unbekannter Level bedeutet Basiswerte; unbekannte Skillung bedeutet keine stillschweigend eingerechneten Fähigkeitseffekte.

## Was bewusst noch nicht gelöst ist

- Die repräsentative Auswahl ist noch DPS-lastig. Punkt 2 des laufenden Reviews soll erst danach die Auswahlentscheidung überarbeiten; diese Logik wurde bisher nicht geändert.
- Keine gemeinsame Suche über Kaufpfad, Heldenskillung und Heldenlevel.
- Keine verifizierte Treffer-, Headshot-, Positions-, Reichweitenfalloff- oder Proc-Uptime-Annahme.
- Keine echte Farm-Simulation und keine vollständige Gegner-/Teamfight-Simulation.
- Mehrstufige Verkaufsketten, reale Walker-Freischaltungszeitpunkte und Entscheidungen aus einem laufenden Match sind noch begrenzt.
- Die UI zeigt nur den repräsentativen Pfad; Alternativen, vollständige Begründungen und das gesamte Result-Schema sind noch nicht sichtbar.
- Fachlich geprüft ist nur Warden Weapon Carry. Die Struktur ist auf weitere Helden ausgelegt, die inhaltlichen Profile sind es noch nicht.

## Letzte messbare Korrektur

Beim gleichen zuvor gewählten Warden-Inventar sank die ausgewiesene Sustained-Weapon-DPS nach Entfernung der Spirit-Doppelzählung von **174.2 auf 168.1**. Bei mehreren Resistenzquellen gilt nun z. B. 20 % + 30 % = **44 %**, nicht fälschlich 50 %.

## Prüfstand

- `npm test`: 12 Tests bestehen.
- Vollständiger Warden-Test: zuletzt rund 14 Sekunden auf diesem Rechner. Das ist unter dem 30-Sekunden-Ziel, keine allgemeine Laufzeitgarantie.

## Nächster geplanter Schritt

Punkt 1 des Reviews gemeinsam prüfen. Danach Punkt 2: die Auswahlentscheidung so umbauen, dass ein kleiner DPS-Vorteil robuste Alternativen nicht automatisch verdrängt.

## Merksatz

Keine kanonischen Spieldaten ohne ausdrücklichen Datenpflegeauftrag ändern. Ein Ergebnis bleibt ein **bester geprüfter Build innerhalb dokumentierter Such- und Modellgrenzen**.

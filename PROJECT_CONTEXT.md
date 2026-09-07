# Sidestep Deadlock – Projektübergabe

Stand: 7. September 2026. Dieses Dokument ist der aktuelle Einstieg für einen neuen Chat oder eine Übergabe.

## Produktziel

Sidestep erzeugt aus verifizierten Deadlock-Daten nachvollziehbare Build-Analysen. Es soll keine Meta- oder Bauchgefühlsempfehlungen vortäuschen: Nicht belegte Mechaniken bleiben unbekannt, Modellannahmen bleiben sichtbar und Ergebnisse heissen nur dann „optimal“, wenn Suchraum und Ziel tatsächlich abgedeckt sind. Sonst lautet die Kennzeichnung **bester geprüfter Build**.

## Verbindliche Grundlagen

- `AGENTS.md` ist die Arbeitsanweisung.
- `data/core/`, `data/heroes/` und `data/interactions/` sind kanonisch und dürfen ohne ausdrücklichen Datenpflegeauftrag nicht geändert werden.
- `docs/prompts/build_optimizer.md` beschreibt das verpflichtende Verfahren für Build-Anfragen.
- `docs/schemas/build_request_schema.md` und `docs/schemas/build_result_schema.md` definieren Eingaben und Ergebnisse.
- Core- und Hero-Manifest müssen vor einer Build-Berechnung Patch und Modus kompatibel ausweisen.

## Aktueller Produkt-Slice

Die lokale Web-App (`app/`, Start mit `npm start`) besitzt einen echten, aber klar begrenzten Warden-Weapon-Carry-Optimizer:

1. Die Suche läuft vorwärts über legale Käufe und Upgrades.
2. Sie prüft Kosten, Komponentenrabatte, Kategorie-Investments, Schwellen, Slots und Active-Items.
3. Ein einzelner später Ersetzungs-Schritt rechnet den verifizierten Sellback korrekt; Ketten aus mehreren Verkäufen sind noch offen.
4. Es gibt keine feste Startreihenfolge, Preis-/Tier-Sperre, Weapon-/Vitality-Quote oder Upgrade-Anzahl-Belohnung.
5. Kaufpfade werden bei 3'200, 4'800, 7'200, 12'000, 20'000, 30'000 und 40'000 Souls verglichen. 35k/40k/45k/60k sind separate Sensitivitäts-Planungspunkte, keine behaupteten Matchphasen.
6. Für den robusten Standardpfad gilt eine offene Strukturannahme: bei 4'800 Weapon plus Schutz oder gekauftes Sustain, bei 7'200 Weapon, Schutz und gekauftes Sustain. Kleine Utility-HP oder nicht modellierte Skills reichen nicht.
7. Der Heldenslice berücksichtigt belegte Spirit→Weapon-, Reichweiten-, Projektil- und Kit-Bezüge. Bedingte Distanz-/Triggerwerte werden ohne Uptime- oder Positionsannahme nur dokumentiert.
8. Recharging Rush wird bei Warden ausgeschlossen, weil seine kanonischen Fähigkeitendaten keine Charges ausweisen.

## Berechnungsstand

- Sustained Weapon DPS wird aus Bullet Damage, Rounds per Second, Magazin und Reload hergeleitet.
- Wardens Spirit-Skalierung wirkt einmal über die verifizierte Rounds-per-Second-Skalierung. Die abgeleitete `sustained_dps_spirit_scaling` wird nicht ein zweites Mal addiert.
- Permanente gleiche Resistenzen werden nach `RES-002` in `data/core/mechanics.json` multiplikativ kombiniert.
- Permanente, aktive und bedingte Heilung/Mobilität bleiben getrennt. Lane-Heilung pro Treffer, Regeneration pro Zeit und Lifesteal-Prozente werden nicht vermischt.
- Ohne modellierte Level-/Skillangabe gilt ausschliesslich der kanonische Basiszustand. Es gibt keine stillschweigend angenommene Skillung oder Heldenlevel-Boni.
- Bedingte Effekte werden mit Trigger, Dauer und Cooldown dokumentiert, aber nicht als dauerhafte Baseline eingerechnet.

## Wichtige Grenzen

- Die aktuelle repräsentative Auswahl ist noch DPS-lastig. Punkt 2 des laufenden Reviews soll die Auswahlentscheidung später bewusst überarbeiten.
- Es gibt keine gemeinsame Kauf-/Skill-/Level-Suche, keine verifizierte Treffer- oder Headshotquote, keine Positions-/Falloff-Annahme und keine allgemeine Proc-Uptime.
- Farm, Gegnerdruck und Teamfight sind keine vollständigen Simulationen.
- Nur Warden Weapon Carry ist fachlich geprüft; andere Heldenauswahlen sind noch kein gleichwertiger Optimizer-Modus.
- Die UI zeigt den repräsentativen Pfad, nicht alle nicht-dominierten Alternativen oder die vollständige Result-Schema-Ausgabe.

## Letzter Prüfstand

- `npm test`: 12 Tests bestehen.
- Vollständiger Warden-Test: rund 14 Sekunden auf diesem Rechner.
- Der aktuelle Stand ist lokal; GitHub-Synchronisation muss anhand von `git status`, `git pull --ff-only` und `git push` geprüft werden.

## Nächste sinnvolle Arbeit

Zuerst Punkt 1 des aktuellen Reviews gemeinsam abnehmen: korrekte Wirkungsberechnung und ihre Auswirkung auf denselben Warden-Pfad. Danach Punkt 2 separat umsetzen: eine nachvollziehbare Auswahlentscheidung, bei der ein kleiner DPS-Vorteil robuste Alternativen nicht automatisch verdrängt.

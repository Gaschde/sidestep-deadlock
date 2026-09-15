# Sidestep Deadlock – Projektübergabe

Stand: 15. September 2026. Dieses Dokument ist der aktuelle Einstieg für einen neuen Chat oder eine Übergabe.

## Produktziel

Sidestep erzeugt aus verifizierten Deadlock-Daten nachvollziehbare Build-Analysen. Es soll keine Meta- oder Bauchgefühlsempfehlungen vortäuschen: Nicht belegte Mechaniken bleiben unbekannt, Modellannahmen bleiben sichtbar und Ergebnisse heissen nur dann „optimal“, wenn Suchraum und Ziel tatsächlich abgedeckt sind. Sonst lautet die Kennzeichnung **bester geprüfter Build**.

## Verbindliche Grundlagen

- `AGENTS.md` ist die Arbeitsanweisung.
- `data/core/`, `data/heroes/` und `data/interactions/` sind kanonisch und dürfen ohne ausdrücklichen Datenpflegeauftrag nicht geändert werden.
- `docs/prompts/build_optimizer.md` beschreibt das verpflichtende Verfahren für Build-Anfragen.
- `docs/schemas/build_request_schema.md` und `docs/schemas/build_result_schema.md` definieren Eingaben und Ergebnisse.
- Core- und Hero-Manifest müssen vor einer Build-Berechnung Patch und Modus kompatibel ausweisen.

## Aktueller Produkt-Slice

Die lokale Web-App (`app/`, Start mit `npm start`) besitzt eine approximative, aber transparent begrenzte Carry-Suche:

1. Alle 60 kanonischen Helden sind auswählbar; Carry mit Weapon, Spirit und Hybrid verwendet denselben `runAnytimeCarry`-Kern.
2. Warden und Infernus sind fachlich näher geprüft. Andere Heldenprofile sind als experimentell markiert. Fehlen Bullet Damage, fire rate, magazine oder reload, meldet die App die konkrete Datenlücke statt einen Schein-Build zu rechnen.
3. Das produktive Testszenario läuft von 0 bis 40'000 verdienten Souls, mit zwölf Slots ab Beginn, allen legalen kanonischen Items und einem sichtbaren 25-Sekunden-Budget. Ein Pfad darf Restguthaben behalten.
4. Jeder veröffentlichte Pfad wird im Domänenmodell erneut auf Kosten, Guthaben, Verkäufe, Slots und Kaufberechtigung geprüft. Die zeitgebundene Endgegenprobe meldet ihre Vollständigkeit.
5. Es gibt keine Kategoriequote, Pflichtitems, Preis-/Tier-Sperre oder verdeckte Kandidatenbegrenzung. Unterstützte Komponenten, Upgrades, Verkäufe und Ersetzungen sind Teil des Aktionsraums; beliebige mehrstufige Verkaufsketten bleiben eine Suchgrenze.
6. Charge-Items werden nur bei kanonisch nachgewiesener fehlender Charged Ability ausgeschlossen. Für Warden betrifft dies unter anderem Extra Charge, Rapid Recharge und Recharging Rush.

## Berechnungsstand

- Alle Profile verwenden denselben Kampfablauf: Weapon-Schaden, direkt modellierter Fähigkeitsschaden und belegte passive/Proc-Schäden. Der Fokus ändert die Präferenz, nicht die erlaubten Aktionen.
- Die Auswahl verwendet 70% Endstärke und 30% Verlauf; Schaden und Überleben zählen jeweils 50%. Innerhalb der Schadensgruppe gelten Weapon 70/30 Bullet/Spirit, Spirit 30/70 und Hybrid 50/50.
- Sustained Weapon DPS berücksichtigt Bullet Damage, fire rate, Magazin und Reload. Wardens belegte Spirit→fire-rate-Skalierung wird nur einmal berücksichtigt.
- Permanente Bullet-/Spirit-Resistenzen stacken nach `RES-002` multiplikativ. Regeneration zählt nur über das jeweilige Kampffenster; Bullet-Lifesteal nur auf passenden verursachten Weapon-Schaden.
- Globale belegte Ability-Cooldown-Reduktion, Wardens Last Stand und Infernus Afterburn sind in der gemeinsamen Berechnung angeschlossen. Afterburn benötigt den modellierten Weapon-Hit-Aufbau und ist kein dauerhafter Spirit-Bonus.
- Ohne modellierten Level-/Skillzustand gilt der kanonische Basiszustand. Bedingte Effekte ohne ausreichende Trigger-, Treffer- oder Uptime-Daten bleiben sichtbar, aber außerhalb des Scores.

## Wichtige Grenzen

- Die gesampelte Referenz, die 25-Sekunden-Suche und die Endgegenprobe beweisen keine globale Optimalität; eine unterbrochene Endgegenprobe wird sichtbar ausgewiesen.
- Es gibt keine gemeinsame Kauf-/Skill-/Level-Suche, verifizierte Treffer-/Headshotquote, Positions-/Falloff-Annahme, allgemeine Proc-Uptime oder vollständige Matchsimulation.
- Aktive Items und Combos ohne belegbare Wirkungskette bleiben sichtbar, aber nicht als angenommener Dauerbonus im Score.
- Die App zeigt den besten geprüften Pfad und seine Telemetrie, nicht alle Suchvarianten oder eine vollständige Result-Schema-Ausgabe.

## Letzter Prüfstand

- Commit `4251154` vereinheitlicht den produktiven Schnellhorizont auf 40'000 Souls.
- Der letzte dokumentierte Warden/Carry/Weapon-40k-Lauf endete legal bei genau 40'000 Souls mit 400 Rest-Souls; die direkte Endgegenprobe prüfte 318/318 Aktionen vollständig und fand keine Verbesserung.
- Detaillierte, datierte Messwerte und Tests stehen ausschließlich in `.agent/CONTINUITY.md` und der Suchspezifikation.

## Nächste sinnvolle Arbeit

Die nächste Arbeit soll aus einem reproduzierbaren Befund entstehen: etwa einer vollständigen, eingefrorenen Gegenrechnung eines auffälligen Endinventars. Gewichte oder Kandidaten dürfen nicht allein wegen der Itemfarben geändert werden.

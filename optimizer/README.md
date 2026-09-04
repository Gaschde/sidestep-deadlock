# Optimizer-Engine (erste Ausbaustufe)

Diese Engine setzt den sicheren Rechenkern aus `prompts/build_optimizer.md` um. Sie verändert keine kanonischen Daten.

## Aktueller Umfang

- Patch- und Modusprüfung zwischen Core- und Heldendaten
- Heldenwerte je Boon-Level
- Itemkosten und Kategorie-Investments
- Slot-, Walker-Slot- und Active-Item-Prüfung
- Verbot gleichzeitiger Komponenten und ihrer Upgrades
- HP, Weapon Damage, Bullet Damage, Fire Rate, Ammo, DPS, Bewegung, Resistenzen und Lifesteal
- Magazin-DPS und langfristiger Weapon-DPS inklusive Basis-Nachladezeit
- Basis- und Upgrade-Werte von Fähigkeiten
- strikte Trennung permanenter und bedingter Itemeffekte
- deterministische Suche innerhalb einer ausdrücklich angegebenen Kandidatenmenge
- automatisch erzeugter legaler Kaufpfad mit Komponenten-Upgrades
- Walker-Slot-Meilensteine erst ab dem tatsächlich benötigten Kaufschritt
- Pfadbewertung an mehreren Budget-Checkpoints
- kumulative und inkrementelle Investmentboni nach jedem Kauf
- explizite harte Mindestwerte und minimale Budgetauslastung
- Sicherheitsstopp für nicht eingerechnete Item-Nachteile
- explizites Zielprofil mit Bullet- und Spirit-Resistenz
- getrennte Ziel-DPS für Weapon- und Spirit-Zusatzschaden sowie Resistance Reduction
- Pareto-Auswahl für nicht dominierte Schaden-/Überlebensvarianten
- marginaler Endwert jedes finalen Items und Nutzen pro 1.000 Souls

Die Suche heißt bewusst nicht global optimal: Eine Beam-Suche verwirft Zwischenkandidaten. Verkäufe, Objective-Zeitpunkte, Treffer-/Headshotquoten und automatisch geschätzte Proc-Uptimes fehlen noch. Der erzeugte Kaufpfad ist ein deterministischer, legaler Greedy-Pfad; er ist noch kein Beweis für den global besten Kaufweg.

## Bedingte Effekte

Im Grundzustand zählen nur Effekte mit `trigger=equipped` und einer ausdrücklich dauerhaften Bedingung. Andere Effekte müssen für ein Szenario über ihre vollständige Referenz `item_id::effect_id` aktiviert werden.

Ein Effekt kann ebenfalls explizit deaktiviert werden. Das ist nötig, wenn eine kanonische Effektzeile als permanent markiert ist, der zugehörige Tooltip oder ein beobachteter UI-Zustand aber eine Bedingung erkennen lässt. Jede solche Abweichung erscheint als Warnung im Ergebnis.

Wenn ein ausgeschlossener bedingter Effekt anhand seines kanonischen Mechaniknamens einen Nachteil für den Besitzer beschreibt, steht er zusätzlich unter `unresolved_downsides`. Die Suche verwirft solche Builds standardmäßig. Das verhindert, dass ein großer Bonus gewinnt, während sein noch nicht modellierter Nachteil als kostenlos behandelt wird. Mit `--allow-unresolved-downsides` lässt sich ein solcher Lauf bewusst als unsicheres theoretisches Szenario zulassen.

## Kommandozeile

Die gebündelte oder eine lokal installierte Python-Laufzeit kann den Calculator direkt ausführen:

```text
python tools/calculate_build.py warden --boon 35 --walker-slots 3 \
  --item upgrade_close_quarter_combat \
  --item upgrade_titan_round
```

Optionale Szenarioargumente:

```text
--activate item_id::effect_id
--deactivate item_id::effect_id
--ability-level ability_id=3
```

Die Ausgabe ist JSON und enthält neben den Ergebnissen alle einbezogenen und ausgeschlossenen Effekte sowie Warnungen.
Permanente numerische Effekte, für die noch keine Rechenregel implementiert ist, erscheinen zusätzlich unter `unhandled_effects`; sie werden niemals stillschweigend als bereits berücksichtigt ausgegeben.

Wenn ein vorhandener archivierter API-Snapshot einen kanonisch permanent markierten Effekt als bedingt kennzeichnet, erscheint dessen Referenz unter `audit_flags`. Diese Rohdaten verändern die Rechnung nicht automatisch: Sie dienen gemäß den Projektregeln ausschließlich als sichtbarer Audit-Hinweis.

Eine begrenzte, reproduzierbare Beam-Suche über öffentliche Items ist ebenfalls verfügbar:

```text
python tools/search_builds.py warden --boon 20 --budget 9600 --items 6 --beam-width 250
```

Die Ausgabe nennt Kandidatenzahl, tatsächlich bewertete Zustände, Zahl der pfadbewerteten Finalisten, Endscore, Pfadscore, offengelegte Score-Komponenten, alle Kaufschritte, marginalen Itemnutzen, eine Pareto-Auswahl und stets das Ergebnislabel `best_evaluated`. Eine Beam-Suche deckt den kombinatorischen Suchraum nicht vollständig ab.

Harte Anforderungen und Szenarien werden ausdrücklich angegeben, zum Beispiel:

```text
python tools/search_builds.py warden --boon 35 --budget 56000 --items 12 \
  --walker-slots 3 --minimum-budget-utilization 0.9 \
  --minimum-stat max_health=4500 --minimum-stat move_speed=6.5 \
  --target-bullet-resist 30 --target-spirit-resist 20 \
  --activate upgrade_fervor::eff_fervor_fire_rate
```

`--activate` bedeutet: Der genannte bedingte Effekt gilt im gesamten verglichenen Szenario als aktiv. Es ist keine automatisch erfundene Uptime. Für eine Sensitivitätsprüfung werden derselbe Suchraum und dieselben Randbedingungen einmal ohne und einmal mit dem Effekt ausgeführt.

Das Standardprofil `gun_carry_v2` gewichtet zielbereinigten Magazin-DPS mit 30 %, zielbereinigten langfristigen DPS inklusive Nachladen mit 25 %, Leben mit 20 %, Bullet-EHP mit 10 %, Bewegung mit 10 % und Bullet-Lifesteal mit 5 %. Der Endzustand macht 75 %, die mittlere Qualität der Budget-Checkpoints 25 % des finalen Scores aus. Unbehandelte permanente Effekte und Audit-Widersprüche erhalten einen sichtbaren Unsicherheitsabzug. Diese Gewichte sind Analyseparameter und keine verifizierten Spielwerte.

Mit `--profile survivability_v1` wird stattdessen ein offengelegtes Überlebensprofil verwendet: Leben 20 %, Bullet-EHP 25 %, Spirit-EHP 25 %, Melee-EHP 10 %, Bewegung 10 %, Regeneration 5 % und kombinierter Bullet-/Spirit-Lifesteal 5 %. Auch dieses Profil ersetzt keine harten Mindestbedingungen; diese werden weiterhin separat angegeben.

Die Suche arbeitet standardmäßig konservativ: Effekte mit einem API-Audit-Widerspruch werden für das Grundszenario explizit deaktiviert und als Warnung ausgegeben. Der allgemeine Calculator verändert kanonische Werte dagegen niemals automatisch.

Komponentenpfade führen `UNC-0004` sichtbar mit, weil ein temporärer zusätzlicher Slotbedarf während des Upgrades nicht verifiziert ist. Bei Zielen mit mehreren möglichen Komponenten erscheint zusätzlich `UNC-0013`; die Engine verwendet ausschließlich die konkret gewählte und verifizierte einzelne Upgrade-Kante.

## Referenztest

`tests/test_optimizer_calculator.py` enthält den beobachteten Warden-Endzustand. Der Test reproduziert die eindeutig sichtbaren statischen Werte des bereitgestellten Screenshots und hält notwendige UI-Szenarioabweichungen explizit fest. Dadurch werden Widersprüche nicht als allgemeine Spielregel in den Calculator eingebaut.

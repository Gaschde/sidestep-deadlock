# GPT Council Report — Sidestep Deadlock

> Research artifact. This document is preserved as source material, not as the authoritative project specification.
>
> Source: Sidestep_Deadlock_Council_Analyse.pdf
> Repository state discussed: `b0001472fbbcc2c3becc42582043d82caa547e88` on `main`, 2026-09-19.
> Transcribed from the original report for agent-readable Git history.

SIDESTEP DEADLOCK
7-Personen-Expertencouncil - mathematische und algorithmische Analyse
Ist ein mathematisch "bester Build" für jeden Deadlock-Helden
bestimmbar - und ist das Projekt auf dem richtigen Weg?
Prüfpunkt Stand
Repository Gaschde/sidestep-deadlock
Branch main
Geprüfter Commit b0001472fbbcc2c3becc42582043d82caa547e88
Commit-Zeitpunkt 19.09.2026, 03:46 CEST
Analyse 19.09.2026
Methodik Prompt Perfect + GitHub + SciSpace + 7-Rollen-Council
Kernaussage: Das Projekt ist nicht fundamental falsch. Der stärkste bestehende Teil ist der
verifizierbare Such-/Legalitätskern. Der grösste Engpass ist inzwischen nicht primär die 
Kombinatorik, sondern die Frage, was "bester Build" mathematisch überhaupt bedeuten 
soll.
Lesefassung des vollständigen Council-Berichts


Executive Summary
Kurzfassung: Sidestep kann schon heute sinnvoll einen "best found / best evaluated" Build 
für ein klar definiertes Modell liefern. Ein allgemeiner, kontextfreier "mathematisch 
bester Deadlock-Build" ist dagegen ohne Gegner-, Zeit-, Skill- und Situationsmodell nicht 
sinnvoll definiert.
Der produktive Browserpfad ist bewusst approximativ: 40'000 Souls, 25 Sekunden Suchbudget, 156 
Items, 38 öffentliche Helden, Carry mit Weapon/Spirit/Hybrid.
Die Kauflegalität ist solide modelliert: Kosten, Slots, Active-Limit, Upgrades, Sellback, Ersetzungen 
und ein unabhängiger Replay vor Veröffentlichung.
Der exakte Suchkern ist lokal gut abgesichert: kleine Zustandsräume werden gegen unabhängige 
Exhaustiv-Orakel verglichen.
Der wichtigste konzeptionelle Schwachpunkt ist der Score: 70 % Endstärke, 15 % Worst Regret, 15 % 
Integrated Regret; Damage/Survival je 50 %. Diese Gewichte definieren einen Gewinner, beweisen 
aber nicht, dass genau dieser Gewinner die beste reale Matchentscheidung ist.
Lane, Farm und Teamfight verwenden im produktiven Suchscore derzeit teilweise dieselbe 10-
Sekunden-Schadensmetrik. Das erzeugt eine versteckte Mehrfachgewichtung desselben Signals.
Der produktive Suchzustand enthält Souls/Cash/Inventar/Slots, aber keine echte Matchzeit, 
Gegnerbuilds, Teamzustände, Skill-Level oder adaptive Farm-/Income-Dynamik.
Der nächste Fortschritt sollte deshalb zuerst das Objective- und State-Modell verbessern. Ein noch 
schnellerer Suchalgorithmus allein löst das Kernproblem nicht.
Die drei wichtigsten nächsten Schritte
1. Objective-/State-Vertrag neu definieren: Was bedeutet "best" exakt, welche Szenarien zählen und 
welche Variablen werden bewusst nicht modelliert?
2. Evaluation vom Search entkoppeln und validieren: echte unterschiedliche Szenarien, Pareto-Logik 
und Sensitivity Analysis statt mehrfach benannter, numerisch gleicher Signale.
3. Hybrid-Solver darauf aufsetzen: exakte Verfahren für zertifizierbare Teilräume, Anytime Search 
für den grossen Rest und Simulation nur dort, wo deterministische Bewertung nicht reicht.


1. Scientific Evidence Pack
Die Literatur wurde gezielt auf Methoden beschränkt, die für Definition, Suchgarantien, Unsicherheit 
oder Validierung relevant sind. Allgemeine KI-Literatur wurde nicht als Beleg verwendet.
Methode / Konzept Quelle Garantie Grenze Relevanz
Multiobjective / Pareto Zaroliagis (2005), DOI 
10.1007/11571155_5; 
Ehrgott (2012)
Nichtdominierte 
Lösungen relativ zu 
definierten Zielen und 
Suchraum
Kein automatischer 
einzelner Sieger bei 
Zielkonflikten
Sehr hoch: Damage, 
Survival und Tempo 
besitzen keine 
natürliche 
Totalordnung.
Label-Correcting / DP Labeling Methods for 
the General Case of the 
Multi-objective Shortest 
Path Problem (2013), 
DOI 10.1007/978-94-007-
4722-7_46
Exakte Pareto-Suche bei
vollständigem State, 
korrekten Transitionen 
und gültiger Dominanz
Keine Korrektheit bei 
fehlendem State oder 
falscher Dominanz
Sehr hoch: search-core.mjs folgt diesem 
Muster.
Anytime Search Hansen & Zhou, 
Anytime Heuristic 
Search, JAIR 2007, DOI 
10.1613/JAIR.2096
Frühe Incumbents; mit 
passenden Bounds 
spätere 
Optimalitätszertifikate 
möglich
Zeitlimit allein beweist 
keinen Abstand zum 
globalen Optimum
Extrem hoch: der 
Produktlauf hat 
Incumbents, aber 
keinen globalen Bound.
Branch & Bound / 
Bounds
klassische B&B- und 
Optimality-Certificate-Literatur
Globaloptimalität, wenn
Rest des Suchraums mit 
gültigen Bounds 
ausgeschlossen ist
Ohne Bounds oder 
vollständige Exploration
kein Zertifikat
Sinnvoll für exakte 
Teilsolver.
Robust Optimization Bertsimas & Sim, The 
Price of Robustness, 
Operations Research 
2004, DOI 
10.1287/OPRE.1030.0065
Robustheit relativ zu 
explizitem 
Unsicherheitsset
Keine Garantie 
ausserhalb des 
Unsicherheitsmodells
Sehr relevant für 
Gegner-, Timing- und 
Matchup-Szenarien.
Approximate Dynamic 
Programming
Gosavi 2009, DOI 
10.1287/IJOC.1080.0305
Praktische Behandlung 
grosser sequenzieller 
State Spaces
Im Allgemeinen keine 
exakte globale Lösung
Relevant, sobald 
Matchstate und Zukunft 
Teil des Modells 
werden.
Simulation 
Optimization
Amaran et al., DOI 
10.1007/S10479-015-
2019-X
Optimierung bei nur 
simulierbarer 
Performance
Hängt vom 
Simulationsmodell und 
Sampling ab
Für Position, Treffer, 
Gegnerverhalten und 
dynamische Kämpfe.
Stochastische globale 
Suche
Fu, Hu & Marcus 2008, 
DOI 
10.4310/CIS.2008.V8.N3.
A4
Unter Annahmen 
asymptotische 
Konvergenz
Kein praktisches "25 s = 
optimal"
Später relevant für 
simulationsbasierte 
Suche.
Wissenschaftliche Konsequenz: "Optimal" ist immer relativ zu einem Modell. Bei 
mehreren konkurrierenden Zielen ist zunächst meist eine Pareto-Menge definiert - nicht 
automatisch ein einzelner Build.
2. Verifizierter GitHub-Stand
Repository: Gaschde/sidestep-deadlock
Branch: main
Commit: b0001472fbbcc2c3becc42582043d82caa547e88
Commit-Zeitpunkt: 19.09.2026, 03:46 CEST
Wichtige Dateien: README.md, AGENTS.md, app/app.js, optimizer-worker.mjs, anytime-search.mjs, 
search-core.mjs, deadlock-domain.mjs, optimizer.mjs, warden-search.mjs, reference-search.mjs, 
reference-cache.mjs, direct-reference.mjs, trajectory-objectives.mjs, validate-search-path.mjs, 
search-config.mjs sowie zentrale Tests.


2.1 Tatsächlicher Produktionspfad
UI (app.js:startFastBuild)
 -> Web Worker (optimizer-worker.mjs, mode="anytime")
 -> runAnytimeCarry()
 -> createDeadlockDomain()
 -> State: Souls + Cash + Inventory + Slots
 -> evaluateCarrySearchMetrics()
 -> scoreAnytimePath()
 -> Seeds / Rollouts / Local Refinement
 -> preferPublishedCandidate()
 -> validateSearchPath()
 -> app.js -> Ergebnisdarstellung
Das ist der aktuelle produktive Browserpfad. Daneben existiert eine separate Warden/Carry/Weapon-Diagnose mit stärkerer exakter Pareto-Komponente. Die Python-Engine unter engine/ ist ein paralleler 
CLI-/Audit-/Testpfad und nicht der primäre Browserproduktpfad.
2.2 Was der produktive Optimizer tatsächlich macht
Produkthorizont: 40'000 Souls über FAST_SEARCH_BUDGET.
12 Slots ab Start im schnellen Produktmodus.
156 kanonische Items und 38 öffentliche Helden.
Carry mit Weapon, Spirit und Hybrid.
25 Sekunden Suchzeit.
Reproduzierbarer RNG-Seed.
Kaufen, unterstützte Upgrades, Verkaufen und Ersetzen.
Sellback wird modelliert; volle Refunds werden ausdrücklich nicht modelliert.
Upgradefamilien und Active-Limit werden geprüft.
Jeder veröffentlichte Pfad wird über validateSearchPath() erneut aus legalen Transitionen 
aufgebaut.
Das Repo bezeichnet das Ergebnis korrekt als approximativ und nicht als global optimal.
2.3 Aktueller Score
Score = 0.70 x EndUtility
 + 0.15 x (1 - WorstRegret)
 + 0.15 x (1 - IntegratedRegret)
Damage und Survival: je 50 %
Weapon: Bullet/Spirit = 70/30
Spirit: Bullet/Spirit = 30/70
Hybrid: Bullet/Spirit = 50/50
Kritischer Detailfund: Im produktiven Suchscore verwenden laneTradeWindowDps, 
farmWindowDps und teamfightWindowDps jeweils damageAt(10) / 10. Drei 
unterschiedliche Namen gewichten damit teilweise dieselbe 10-Sekunden-Schadensinformation mehrfach.
Die daraus entstehende Damage-Gewichtung entspricht faktisch ungefähr: 60 % derselben 10-s-Metrik, 
20 % 4-s-Metrik und 20 % 60-s-Metrik. Das ist mathematisch zulässig, aber als Modellentscheidung 
derzeit nicht wissenschaftlich begründet.


3. Was heute bereits stark ist
search-core.mjs implementiert echte mehrdimensionale Dominanz und Label-Correcting-Pruning.
tests/search-foundations.test.mjs enthält ein unabhängiges Exhaustiv-Orakel, dessen erwartete 
Pareto-Vektoren nicht mit dem Produktionsalgorithmus konstruiert werden.
Der Anytime-Optimizer wird auf kleinen vollständigen Zustandsräumen gegen ein exaktes Orakel 
geprüft und erreicht dort denselben Score bis unter 1e-12.
validateSearchPath() trennt Kandidatenranking und Legalitätsbeweis sauber.
reference-cache.mjs bindet Cache-Einträge an Inputs, Modellversion, Achse, Metriken und 
Implementierungsidentität.
README/AGENTS behandeln unbekannte Mechaniken als unbekannt statt automatisch als null.
Diese Tests validieren den Suchkern lokal sehr gut. Sie beweisen jedoch nicht, dass der 
156-Item-/38-Helden-Produktlauf global optimal ist oder dass die Zielfunktion echte 
Matchqualität perfekt abbildet.
4. Das eigentliche Modellproblem
Der produktive Suchzustand bildet vor allem eine Shop-/Ressourcenwelt ab:
earnedSouls
cash
inventory
unlockedSlots
Nicht Teil des Suchzustands sind unter anderem:
reale Matchzeit
Hero-Level und Skill-Level
Cooldown-/Proc-Zustände
aktueller Gegner und Gegneritems
Gegnerresistenzen
Teamzusammensetzung und Teamitems
Map-/Objective-Zustand
Position und Range
Treffer-/Headshot-Wahrscheinlichkeit
Zielwechsel
aktive Item-Nutzung
Matchtempo
zukünftige Farm-/Income-Rate
Fundamental: Der State schreitet über Soul-Koordinaten fort. Die zukünftige Soul-Erzeugung hängt im aktuellen Modell nicht vom gewählten Build ab. Damit ist die 
ökonomische Achse exogen.


5. Sieben unabhängige Erstpositionen
1. Mathematiker
Ein bester Build ist nur dann mathematisch eindeutig, wenn Zustände, Übergänge, Horizont, 
Nebenbedingungen und Zielfunktion vollständig definiert sind. Bei mehreren konkurrierenden Zielen 
ist eine Pareto-Menge natürlicher als ein einzelner Sieger.
Kernurteil: Stärkster Teil: explizite Zustände, Pareto/Dominanz und unabhängige Tests. Grösster 
Schwachpunkt: der fest kodierte Score wird faktisch als Buildqualität verwendet.
Confidence: 96 %
2. Algorithmus-Experte
Die Architektur ist nicht grundsätzlich falsch. Der Label-Correcting-Kern ist für begrenzte, sauber 
definierte Teilräume sinnvoll. Der Produktlauf ist dagegen eine Zeitbudget-Heuristik ohne globalen 
Optimalitätsgap.
Kernurteil: Empfehlung: exakte Subsolver mit Bounds für zertifizierbare Teilräume; Anytime Search 
für den grossen Rest.
Confidence: 94 %
3. First-Principles-Denker
Die Kernfrage sollte nicht nur "welcher Build ist am besten?" lauten, sondern "welche Kaufpolitik 
maximiert einen expliziten Nutzen bei beobachtbarem Matchzustand und Unsicherheit?"
Kernurteil: Grösster Punkt: Souls sind aktuell eher eine Ressourcenuhr als echte Matchzeit. 
Matchzustand muss oberhalb der Shopdomain ergänzt werden.
Confidence: 98 %
4. Deadlock-Profi
Ein bester Build kann für ein konkretes Spielszenario existieren. Ohne Gegner-, Zeit- und 
Situationszustand ist eine allgemeine Empfehlung jedoch zu grob.
Kernurteil: Besonders problematisch: Lane, Farm und Teamfight sind im Search Score nicht 
ausreichend verschieden modelliert.
Confidence: 91 %
5. MOBA-Profi
Builds sind Tempo- und Opportunity-Cost-Entscheidungen. Ein Build kann zukünftige Ressourcen- und 
Wincondition-Pfade verändern.
Kernurteil: Der aktuelle Soul-Pfad ist stärker als ein statischer Endbuild, aber noch kein echtes 
Zeit-/Tempo-Modell.
Confidence: 94 %
6. Skeptiker / Falsifier
Ein Gewinner lässt sich immer erzeugen, sobald man einen Score definiert. Das beweist aber nur, dass 
dieser Score optimiert wurde - nicht, dass die reale Matchentscheidung optimal ist.
Kernurteil: Grösstes Risiko: Objective-Function-Fallacy bzw. Goodhart-Effekt. Wichtigste 
Verbesserung: Sensitivity Analysis.
Confidence: 99 %


7. Praktiker / System Engineer
Ein nützliches Produkt benötigt keinen vollständigen digitalen Zwilling von Deadlock. Es braucht eine 
ehrliche, nachvollziehbare "best evaluated / best found" Aussage.
Kernurteil: Kein Total-Rewrite. Szenario-/Robustheitslayer schrittweise ergänzen.
Confidence: 90 %
6. Unterschiedliche Definitionen von "optimal"
Rolle Definition von optimal Hauptproblem
Mathematiker Optimum einer expliziten Zielfunktion Zieldefinition
Algorithmus zertifiziertes Optimum im Modellraum fehlender Bound
First Principles optimale Policy je State falsche Problemabstraktion
Deadlock beste Entscheidung je Spielsituation fehlender Gegner-/Situationsstate
MOBA beste Tempo-/Wincondition-Entscheidung
fehlende Zeit-/Economy-Dynamik
Skeptiker nur Score-Optimum bewiesen Objective-/Goodhart-Risiko
Praktiker best verified/evaluated Nutzen vs. Modellkomplexität
Der fundamentale Konflikt liegt weniger in einzelnen Codezeilen als in der Frage, wie gross das 
tatsächlich zu optimierende System sein soll.
7. Cross-Review und Rebuttal
Reviewer -> Ziel Starke Kritik / Gegenpunkt Positionsänderung
Mathematiker -> Algorithmus Bessere Suche löst keine falsch 
definierte Zielfunktion.
Nein
Algorithmus -> Praktiker Produktfokus stimmt, aber Teilräume 
sollten stärker zertifizierbar werden.
Ja
First Principles -> Mathematiker Formale Optimierung beginnt erst nach 
der richtigen Problemabstraktion.
Nein
Deadlock -> Algorithmus Das Spiel ist kein Shopgraph allein; 
gegnerabhängige Itemwerte fehlen.
Nein
MOBA -> Praktiker Ein Standardbuild kann bei anderer 
Wincondition systematisch falsch sein.
Nein
Skeptiker -> Algorithmus Ein zertifizierter Solver kann ein 
falsches Modell perfekt optimieren.
Nein
Praktiker -> Mathematiker Vollständige Paretofronten können als 
Produkt-UI zu komplex sein.
Ja
Final änderten der Algorithmus-Experte und der Praktiker ihre Position: Beide gewichten nun einen 
Szenario-/Modell-Layer höher als eine reine Suchoptimierung.
8. Zentrale Streitfragen
Streitfrage Position A Position B Vorläufiges Council-Urteil
Ein bester Build? ein Score-Winner Pareto-/Szenarioabhängigkeit B
Build = Endzustand? Endinventar Trajektorie/Policy B
Ein Score? einfache UX mehrere Ziele + spätere 
Auswahl
B, danach Scalar Selection 
möglich
Gegner im State? generischer Benchmark reicht Gegner ändert Itemwert B für praktische Empfehlung
Zeit explizit? Souls als Proxy Zeit und Souls sind nicht 
äquivalent
B


Statische Endbuilds? ausreichend für Kaufentscheidungen 
unvollständig
B
Globale Optimalität? für das ganze Spiel nur für ein definiertes Modell nur begrenztes Modell
MILP/DP? alles damit lösen nur passende Teilprobleme B
Heuristik? problematisch sinnvoll mit ehrlicher 
Kennzeichnung
sinnvoll
Simulation? unnötig selektiv nötig selektiv nötig
9. Falsification Test
Stärkstes Gegenbeispiel: Ein Build kann nicht nur aktuelle Kampfstärke verändern, 
sondern auch die Geschwindigkeit, mit der zukünftige Ressourcen erreicht werden. Genau
diese Rückkopplung existiert im heutigen Souls-only-State nicht.
Zeitpunkt t, 8'000 Souls
Build A:
- minimal niedrigerer aktueller Fight-Score
- deutlich höhere Farm-/Income-Rate
Build B:
- höherer aktueller Fight-Score
- niedrigere zukünftige Income-Rate
Aktuelles Modell:
8'000 -> 8'800 -> 9'600 ... unabhängig von A oder B
Reales Szenario möglich:
A erreicht bei Minute 15 bereits 16'000 Souls
B erreicht bei Minute 15 erst 12'000 Souls
Damit kann das aktuelle Modell bei gleicher Soul-Koordinate korrekt B > A berechnen, während die 
praktisch relevante Entscheidung bei gleicher Matchzeit A@16k > B@12k sein könnte.
Council-Reaktion: Das Gegenbeispiel wurde als theoretisch valide akzeptiert. Mehr Suchzeit kann 
diesen Modellfehler nicht beheben. Der bestehende Pfad ist deshalb präziser als Performance über 
verdiente Souls zu interpretieren, nicht als vollständige Performance über Matchzeit.


10. Empfohlene Zielarchitektur
INPUT
Hero / Role / Focus / Zeitpunkt / Build / Cash
Level / Skills / Gegner / Team / Situation / Präferenzen
 |
 v
VERIFIED GAME MODEL
Items / Costs / Upgrades / Slots / Stats / Mechanics
 |
 v
STATE REPRESENTATION
time / souls / cash / inventory / skills / opponent / scenario
 |
 +-----------------------------+
 | |
 v v
EXAKT HEURISTISCH
Shop / Inventory grosse adaptive Pfade
DP / Labels / B&B Anytime Search
 | |
 | [Globalgarantie endet
 | ohne gueltigen Bound]
 +-------------+---------------+
 v
 EVALUATION
 deterministic combat / tempo / economy
 |
 v
 SIMULATION
 hit / position / opponent behaviour / randomness
 |
 v
 SCENARIO / ROBUSTNESS
 |
 v
 PARETO FRONT
 |
 v
 USER PREFERENCE / RANKING
 |
 v
OUTPUT: Build + Pfad + Alternativen + Unsicherheit + Begruendung
Simulation soll nur dort eingesetzt werden, wo deterministische Berechnung nicht genügt. Kosten, 
Slots, Upgradepfade und andere harte Regeln bleiben exakte Bestandteile des Modells.
11. Aktuelles System vs. Zielarchitektur
Komponente Urteil Begründung
kanonische/versionierte Daten BEHALTEN stark und auditierbar
explizite Unknowns BEHALTEN verhindert False Precision
deadlock-domain.mjs VERBESSERN guter Shop-State; Regeln weiter 
vervollständigen
search-core.mjs BEHALTEN guter exakter Subsolver


unabhängige Exhaustivtests BEHALTEN wissenschaftlich wertvoll
validateSearchPath() BEHALTEN klare Trennung Search vs. Legalität
Reference Cache BEHALTEN Reproduzierbarkeit
25-s Anytime Search BEHALTEN gutes Produktverfahren für best-found
sampled reference VERBESSERN nicht als globale Referenz interpretieren
70/30 Scalar Score GRUNDLEGEND ÄNDERN Präferenz, keine bewiesene Wahrheit
5 Damage-Metriken GRUNDLEGEND ÄNDERN teilweise identische 10-s-Werte
Souls-only Trajektorie GRUNDLEGEND ÄNDERN Zeit/Income-Feedback fehlt
Gegnerstate NEU HINZUFÜGEN für Counterbuilding relevant
Skill-/Levelstate NEU HINZUFÜGEN bei ausreichenden Daten
Szenario-/Robustheitslayer NEU HINZUFÜGEN Unsicherheit explizit behandeln
Simulation NEU HINZUFÜGEN, selektiv nur für nichtdeterministische Teile
vollständiger digitaler Matchsimulator NICHT BAUEN zu viel Komplexität für zu wenig 
Produktwert
12. Finale Council-Synthese
12.1 Ist es möglich?
Global optimal für das reale Deadlock-Spiel: Nicht sinnvoll behauptbar, solange der reale 
Matchzustand und die Zukunft nicht vollständig definiert sind.
Optimal unter festen Annahmen: Ja.
Robust optimal: Ja, relativ zu einem expliziten Unsicherheitsset.
Pareto-optimal: Ja, relativ zu expliziten Zielgrössen.
Best verified: Ja, wenn der definierte Suchraum vollständig abgedeckt oder mit gültigen Bounds 
ausgeschlossen wurde.
Best found: Ja - genau hier befindet sich der heutige Produktmodus.
Praktisch empfehlenswert: Ja, mit mehr Situationskontext als im aktuellen Score.
12.2 Sind wir auf dem richtigen Weg?
BEHALTEN: Datenmodell, Legalitätsmodell, Search-Core, Pareto-Grundlage, Replay, Tests, Unknown-Handhabung, Auditierbarkeit.
VERBESSERN: Approximation, Reference, Szenarien, Zustandsrepräsentation.
GRUNDLEGEND ÄNDERN: Definition von Buildqualität und Souls-only-Trajektorie.
VERWERFEN: Nichts Zentrales. Ein Total-Rewrite ist fachlich nicht begründet.
12.3 Was fehlt?
Kernlücken: Zeit/Income-Dynamik, Gegnerstate, Skill-/Levelstate, echte unterschiedliche Szenarien, 
Team-/Objective-Kontext, aktive/bedingte Effekte und Sensitivity/Uncertainty.
12.4 Was ist exakt lösbar?
Exakt: Kosten, Slots, bekannte Upgrade-/Sellback-Regeln, feste Inventarlegalität, deterministische Stats,
begrenzte Inventarprobleme und ausgewählte Pareto-Subprobleme.
12.5 Was braucht Approximation?
Approximation: Grossräumige Kauftrajektorien, viele Situationen, adaptive Entscheidungen und sehr 
grosse Pareto-State-Spaces.


12.6 Was braucht Simulation?
Simulation: Nur Outcomes, die nicht ausreichend deterministisch modelliert werden können: Treffer, 
Position, Gegneraktionen und dynamische Matchentwicklung.
12.7 Was ist nicht sinnvoll global optimierbar?
Nicht sinnvoll: "Der beste Build für Hero X, unabhängig von Gegner, Team, Zeitpunkt und Situation." 
Diese Frage ist nicht ausreichend definiert.
12.8 Empfohlene Definition von "bester Build"
Der beste Build ist die höchste bewertete legale Kaufpolitik für einen explizit definierten 
Hero-, Match-, Budget- und Szenariozustand unter einer offengelegten Zielfunktion und 
den angegebenen Modellannahmen.
Bei mehreren nicht aggregierten Zielen: Pareto-optimaler Buildpfad. Bei Heuristik: bester gefundener 
Buildpfad.
12.9 Wann darf "mathematisch der beste" gesagt werden?
Ja - aber nur mit enger, formaler Aussage:
"Dieser Build ist innerhalb des vollständig definierten Modells M, für Hero H, Startzustand
S, Horizont T, Szenario C, Zielfunktion U, verfügbare Items I und die angegebenen 
Mechanikannahmen global optimal."
Zusätzlich muss der komplette relevante Suchraum abgedeckt oder mit gültigen Bounds 
ausgeschlossen sein.
Für den heutigen 25-s-Produktmodus ist die stärkste saubere Aussage:
"Bester gefundener und legal verifizierter Build im angegebenen Modell während dieses 
Suchlaufs."
13. Council Scoreboard
Stufe Konsens
7/7 Kein universeller kontextfreier Deadlock-Build ist im 
aktuellen Problemstatement sinnvoll als "mathematisch 
bester" zu bezeichnen.
7/7 Der 25-s-Produktmodus besitzt keine globale 
Optimalitätsgarantie.
7/7 Legalitätsmodell, Auditierbarkeit und exakte Kleintests sollen
erhalten bleiben.
7/7 Das Hauptproblem ist derzeit eher Objective/Modell als reine 
Suchgeschwindigkeit.
6/7 Build sollte langfristig als Trajektorie/Policy statt nur als 
Endinventar betrachtet werden.
6/7 Szenario-/Pareto-Logik sollte stärker vor einer einzelnen 
Scalar-Wertung stehen.
5/7 Hybridarchitektur aus exaktem Subsolver + Anytime + 
selektiver Simulation ist sinnvoller Zielzustand.


Rolle Ursprüngliche Position Finale Position Geändert? Confidence
Mathematiker bedingt optimal möglich gleich NEIN 97 %
Algorithmus stärkerer Solver zentral hybrides Modell zentral JA 96 %
First Principles falsche Abstraktion gleich NEIN 98 %
Deadlock-Profi Szenarien nötig gleich NEIN 93 %
MOBA-Profi Tempo fehlt gleich NEIN 95 %
Skeptiker Objective grösstes 
Risiko
gleich NEIN 99 %
Praktiker heutigen Kern ausbauen Kern + Szenariolayer JA 93 %
14. Evidence Score
Aussage Evidence Begründung
Der aktuelle 25-s-Lauf beweist keine 
globale Optimalität.
A/B Direkt aus Algorithmus und Code 
ableitbar; Zeitbudget ist kein 
Optimalitätszertifikat.
Die kleinen exakten Kernmodelle sind gut 
validiert.
B Unabhängige Exhaustiv-Orakel und 
Pareto-Vergleiche.
Die Produktbewertung hängt von einem 
fest definierten Scalar Score ab.
A Gewichte stehen explizit im Code.
Lane/Farm/Teamfight nutzen teilweise 
denselben 10-s-Damage-Wert.
A Direkt aus evaluateCarrySearchMetrics() 
ableitbar.
Der Search-State enthält keine echte 
Matchzeit.
A State und Transitionen sind im Code 
sichtbar.
Gegner-/Zeit-/Income-Modell kann 
Rankings verändern.
C Logisch stark, tatsächliche Effektgrösse im 
Live-Spiel nicht empirisch vermessen.
Pareto + Szenario + Robustheit ist 
wissenschaftlich sauberer als ein 
universeller Scalar Score.
B/C Stark durch Literatur gestützt; konkrete 
Gewichtung bleibt Produkt-/Empiriefrage.
Simulation verbessert zwingend reale 
Winrate-Empfehlung.
D Plausibel, aber nicht empirisch bewiesen.
15. Abschluss
GRÖSSTE ERKENNTNIS DES COUNCILS
Das Projekt ist wesentlich besser aufgestellt, als die reine Frage nach extrem vielen 
Kaufreihenfolgen vermuten lässt. Eure eigentliche Grenze ist inzwischen nicht primär 
Kombinatorik, sondern die Definition dessen, was überhaupt optimiert werden soll. Der 
bestehende Search-/Legalitätskern ist brauchbar; das mathematische Modell oberhalb 
davon muss erwachsener werden.
GRÖSSTES NOCH UNGELÖSTES PROBLEM
Der aktuelle Optimizer behandelt Buildqualität hauptsächlich als Performance über eine 
exogen vorgegebene Souls-Achse und einen fest gewichteten Score. Er modelliert nicht 
ausreichend, dass Buildentscheidungen selbst den zukünftigen Matchzustand, Zeitpunkt, 
Gegnerkontext und potentiell die Ressourcenentwicklung verändern können. Solange das 
fehlt, bleibt "best" zwingend modellrelativ.


STÄRKSTER BELEG
Der stärkste konkrete Beleg ist die Kombination aus Code und unabhängigen Tests: Der 
Label-/Domain-Kern stimmt in kleinen vollständigen Welten mit Exhaustiv-Orakeln 
überein, während derselbe Repo im Produktpfad ausdrücklich einen 25-Sekunden-Anytime-Algorithmus mit sampled reference und ohne globalen Bound verwendet. 
Bestimmte Teilmodelle sind exakt lösbar; der aktuelle Gesamtproduktlauf ist es nicht.
STÄRKSTES GEGENARGUMENT
Ein Build-Optimizer muss nicht das komplette Match optimieren. Der heutige Score kann 
bewusst als reproduzierbarer Carry-Benchmark verstanden werden. Unter diesem 
engeren Anspruch ist die heutige Architektur gut. Das Argument begrenzt den Anspruch, 
widerlegt aber nicht die mathematische Kritik.
Anhang: zentrale wissenschaftliche Quellen
Hansen, E. A.; Zhou, R. (2007): Anytime Heuristic Search. Journal of Artificial Intelligence Research. 
DOI 10.1613/JAIR.2096.
Bertsimas, D.; Sim, M. (2004): The Price of Robustness. Operations Research. DOI 
10.1287/OPRE.1030.0065.
Zaroliagis, C. D. (2005): Recent advances in multiobjective optimization. DOI 10.1007/11571155_5.
Labeling Methods for the General Case of the Multi-objective Shortest Path Problem - A 
Computational Study (2013). DOI 10.1007/978-94-007-4722-7_46.
Gosavi, A. (2009): Reinforcement Learning: A Tutorial Survey and Recent Advances. INFORMS 
Journal on Computing. DOI 10.1287/IJOC.1080.0305.
Amaran, S.; Sahinidis, N. V.; Sharda, B.; Bury, S. J.: Simulation optimization: A review of algorithms 
and applications. DOI 10.1007/S10479-015-2019-X.
Fu, M. C.; Hu, J.; Marcus, S. I. (2008): A Model Reference Adaptive Search Method for Stochastic 
Global Optimization. DOI 10.4310/CIS.2008.V8.N3.A4.
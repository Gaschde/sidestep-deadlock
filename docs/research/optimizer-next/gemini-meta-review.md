# Gemini Deep Research Meta-Review — Sidestep Deadlock

> Research artifact. This document is preserved as source material, not as the authoritative project specification.
>
> Source: Eingefügter Text(7).txt
> Repository state discussed: `b0001472fbbcc2c3becc42582043d82caa547e88` on `main`, 2026-09-19.
> Transcribed from the original report for agent-readable Git history.

Independent Scientific Research, Meta-Review und Red-Team-Audit: sidestep-deadlock
Die Entwicklung mathematischer Optimierungs- und Entscheidungssysteme für komplexe Multiplayer-Online-Battle-Arena-Spiele (MOBA) wie Deadlock bewegt sich an der Schnittstelle zwischen kombinatorischer Optimierung, sequenzieller Entscheidungsfindung unter Unsicherheit und benutzerzentrierter Heuristik [cite: ]. Das Softwareprojekt Gaschde/sidestep-deadlock adressiert die Bestimmung leistungsfähiger Item-Kaufpfade und Endinventare [cite: ]. Zur wissenschaftlichen Standortbestimmung liegen zwei unabhängig erstellte Berichte vor: Report A (GPT-Council) und Report B (Claude-Council) [cite: ].
Gegenstand dieser Untersuchung ist das kritische Gegenüberstellen beider Berichte, der Abgleich ihrer Thesen mit der tatsächlichen Quellcode-Basis des Repositories sowie die Einordnung in etablierte mathematische Disziplinen wie Operations Research, Informatik und Algorithmik [cite: ].
Phase 1 — Neutrale Extraktion der Experten-Berichte
Um eine unvoreingenommene Prüfgrundlage zu schaffen, werden die Aussagen aus Report A (GPT-Council) und Report B (Claude-Council) ohne vorgefasste Bewertung extrahiert und strukturiert [cite: ].
Extraktion Report A (GPT-Council)
Report A bewertet das Projekt als strukturierte Kombination aus regelbasierter Kauffähigkeit und stochastischer Pfadsuche, identifiziert jedoch eine wesentliche Lücke zwischen reiner Kombinatorik-Optimierung und der realen Match-Performanz [cite: ].
 * Zentrale These: Ein kontextfreier, allgemeiner "mathematisch bester Build" ist ohne explizite Modellierung von Gegner-, Zeit-, Skill- und Situationszuständen mathematisch unterbestimmt [cite: ]. Das Projekt optimiert derzeit eine statische Zielfunktion über eine rein ökonomische Soul-Achse [cite: ].
 * Definition von "bester Build": Die höchste bewertete, legale Kaufpolitik (Policy) für einen explizit definierten Helden-, Match-, Budget- und Szenariozustand unter offengelegter Zielfunktion und Modellannahmen [cite: ].
 * Einschätzung des aktuellen Projekts: Der Such- und Legalitätskern ist gut abgesichert und methodisch wertvoll [cite: ]. Das Hauptproblem liegt in der Formulierung des Modells und der Zielfunktion, nicht in der reinen Rechengeschwindigkeit des Solvers [cite: ].
 * Wichtigste Stärken: Strenge Kauflegalitätsprüfung (Upgrades, Slots, Sellback, Ersetzungen), Replay-Validierung via validateSearchPath(), exakte Kleintests gegen unabhängige Exhaustiv-Orakel, saubere Handhabung unbekannter Spielmechaniken [cite: ].
 * Wichtigste Schwächen: Feste Gewichte der Zielfunktion (70% Endnutzen, 15% Worst Regret, 15% Integrated Regret), mehrfache Verwendung derselben 10-Sekunden-Schadensmetrik für Lane, Farm und Teamfight, fehlendes Gegner- und Zeitmodell [cite: ].
 * Vorgeschlagene Architektur: Schichtenarchitektur aus Eingabe -> Verifizierter Domäne -> State-Repräsentanz -> Entkoppelten Solvern (Exakt / Anytime / Simulation) -> Szenario- & Robustheits-Layer -> Pareto-Front -> User Ranking [cite: ].
 * Vorgeschlagene Algorithmen: Hybrid-Solver: Exakte Label-Correcting-Verfahren für zertifizierbare Subgraphen, Anytime Search mit Schranken für große Räume, selektive Simulation für nicht-deterministische Proc-Prozesse [cite: ].
 * Auffassung zu Gegnerzustand: Zwingend erforderlich [cite: ]. Mindestens parametrisierte Resistenz- und Schadensprofile, um invariante Fehlempfehlungen gegen Panzerung zu vermeiden [cite: ].
 * Auffassung zu Zeit/Souls: Souls bilden eine Ressourcenuhr, aber keine reale Spielzeit [cite: ]. Das Modell erfordert ein dynamisches Einkommens- und Farmraten-Feedback, da Builds die zukünftige Soul-Generierung beeinflussen [cite: ].
 * Auffassung zu Pareto/Skalarisierung: Intern strikte Multi-Objective Pareto-Optimierung; Skalarisierung erst am Ende basierend auf Nutzerpräferenzen [cite: ].
 * Auffassung zu exakter Optimierung: Mathematisch exakt lösbar für klar begrenzte Teilräume (z. B. kleine Slot-Anzahlen oder beschränkte Item-Mengen) [cite: ]. Für 156 Items bei 40.000 Souls ohne Bounding unmöglich [cite: ].
 * Auffassung zu Heuristik: Unumgänglich für große Räume, muss jedoch transparent als "best found" ausgewiesen werden, vorzugsweise kombiniert mit Bounding-Garantien [cite: ].
 * Auffassung zu Simulation: Selektiv einzusetzen, wo deterministische geschlossene Formeln versagen (Positionsdynamik, Skill-Treffer, unregelmäßige Procs) [cite: ].
 * Wichtigste nächste Schritte: Objective-/State-Vertrag neu definieren, Evaluierung vom Search entkoppeln, Hybrid-Solver aufsetzen [cite: ].
 * Grösste Unsicherheiten: Auswirkung dynamischer Farmraten-Feedbackschleifen auf das finale Item-Ranking [cite: ].
Extraktion Report B (Claude-Council)
Report B bewertet das Repository als technisch ausgereiftes Ingenieurswerk mit hoher Transparenz, fokussiert jedoch stäker auf pragmatische Verbesserungen der Suchmechanik und Unsicherheitsdarstellung [cite: ].
 * Zentrale These: Der bestehende Legalitäts- und Suchkern ist stabil [cite: ]. Ein universeller "bester Build" ist nicht bestimmbar, aber der bestehende Pfadoptimierer kann durch Beam Search, Szenario-Filter und ehrliche Fehlerkommunikation maßgeblich aufgewertet werden [cite: ].
 * Definition von "bester Build": Der am besten bewertete, legal verifizierte Kaufpfad unter den explizit angegebenen Modellannahmen, Zeitpunkt-Meilensteinen und Suchgrenzen [cite: ].
 * Einschätzung des aktuellen Projekts: Methodisch überdurchschnittlich sauber für ein Hobbyprojekt [cite: ]. Besitzt exakte Kleintests und vorbereitete theoretische Bounding-Dokumente [cite: ].
 * Wichtigste Stärken: Generischer Label-Correcting-Kern, transparenter SHA-256 Modulgraph-Cache, Terminal-Audit der 1-Schritt-Nachbarschaft, belegte Dokumentation der Nicht-Terminierung [cite: ].
 * Wichtigste Schwächen: Stochastisches Single-Path-Hillclimbing kann an Schwellenwerten hängenbleiben; Regret-Messung erfolgt gegen eine approximierte Referenz; ausgeteilter Schaden ignoriert gegnerische Resistenzen [cite: ].
 * Vorgeschlagene Architektur: Inkrementelle Erweiterung: Beibehaltung des Kerns, Ergänzung um Beam Search, Item-Dominanzfilterung, Zwischen-Meilensteine und parametrisierte Gegner-Slider [cite: ].
 * Vorgeschlagene Algorithmen: Beam Search mit Breite k für die Produktion, Aktivierung der konzipierten admissiblen Branch-and-Bound-Schranke als Shadow-Check [cite: ].
 * Auffassung zu Gegnerzustand: Vollständig abwesend im Code [cite: ]. Ein kleiner Satz nutzerdefinierter Resistenz-Szenarien reicht aus, um akademischen Overkill zu vermeiden [cite: ].
 * Auffassung zu Zeit/Souls: Souls-Achse als primäre Koordinate beibehalten [cite: ]. Ein zeitliches Einkommensmodell würde unbelegte Parameter einführen und die Projektregeln verletzen [cite: ].
 * Auffassung zu Pareto/Skalarisierung: Intern kleine 2D-Pareto-Front (Schaden vs. Überleben); für die Produkt-UX ein konfigurierbarer Skalar-Score als Standard [cite: ].
 * Auffassung zu exakter Optimierung: Für kleine Diagnose-Slices nachweislich exakt; für 40.000 Souls und 156 Items nachweisbar kombinatorisch explodierend [cite: ].
 * Auffassung zu Heuristik: Anytime-Suche und Beam Search sind praxistauglich, sofern die Lücke zur exakten Referenz numerisch ausgewiesen wird [cite: ].
 * Auffassung zu Simulation: Vollständige Match-Simulation ablehnen (zu hohe Komplexität, Datenmangel); nur für nicht-geschlossene Proc-Ketten erwägen [cite: ].
 * Wichtigste nächste Schritte: Referenz- und Suchunsicherheit in der UI anzeigen, Branch-and-Bound-Schranke aktivieren / Beam Search einführen, parametrisierte Gegner-Resistenz ergänzen [cite: ].
 * Grösste Unsicherheiten: Beschaffung verifizierter Live-Daten für Gegner-Builds ohne Erfindung von Werten [cite: ].
Phase 2 — Claim Matrix
Die wichtigsten überprüfbaren Behauptungen beider Berichte werden Gegenübergestellt, klassifiziert und hinsichtlich ihrer Prüfbarkeit klassifiziert [cite: ].
Synthese-Kategorien:
 * A: Echte Übereinstimmung
 * B: Gleiche Idee, andere Formulierung
 * C: Unterschiedliche Priorisierung
 * D: Echter fachlicher Widerspruch
 * E: Thema wird nur in einem Bericht behandelt
| Claim ID | Gegenstand der Aussage | Position Report A (GPT) | Position Report B (Claude) | Klassifikation | Code-Prüfung erforderlich? | Externe Forschung erforderlich? |
|---|---|---|---|---|---|---|
| CLM-01 | Der produktive Browserpfad nutzt keine exakte Pareto-Suche. | Nutzt 25s Anytime-Heuristik mit Skalarscore [cite: ]. | Nutzt stochastisches Greedy-Local-Search mit Gumbel-Rauschen [cite: ]. | A | Ja (optimizer-worker.mjs) [cite: ] | Nein |
| CLM-02 | Dreifache Verwertung der 10s-Schadensmetrik im Score. | laneTrade, farm und teamfight nutzen identische DPS-Werte [cite: ]. | Identifiziert Redundanz in den Fünf-Fenster-Metriken [cite: ]. | B | Ja (warden-search.mjs) [cite: ] | Nein |
| CLM-03 | search-core.mjs ist mathematisch exakt. | Implementiert echten Multi-Objective Label-Correcting-Algorithmus [cite: ]. | Implementiert Martins-basiertes Label-Correcting mit Dominanz [cite: ]. | A | Ja (search-core.mjs) [cite: ] | Ja (MOSP-Literatur) [cite: ] |
| CLM-04 | Notwendigkeit eines dynamischen Spielzeit-/Income-Modells. | Souls-Achse reicht nicht; Rückkopplung von Farmrate auf Zeit zwingend [cite: ]. | Souls-Achse beibehalten; Zeitmodell bringt unbelegte Annahmen [cite: ]. | D | Ja (deadlock-domain.mjs) [cite: ] | Ja (Dynamic Programming) [cite: ] |
| CLM-05 | Eignung von Beam Search gegenüber stochastischer Suche. | Bevorzugt B&B-zertifizierte Subsolver und Anytime-Suche [cite: ]. | Bevorzugt Beam Search mit Breite k als primären Such-Upgrade [cite: ]. | C | Ja (anytime-search.mjs) [cite: ] | Ja (Heuristic Search) [cite: ] |
| CLM-06 | Fehlen von Gegner-Resistenzen in der Schadensberechnung. | Schadensberechnung ignoriert gegnerische Items vollkommen [cite: ]. | Ausgeteilter Schaden hat keinen gegnerischen Resistenzterm [cite: ]. | A | Ja (optimizer.mjs) [cite: ] | Nein |
| CLM-07 | Ablehnung vollständiger Match-Simulationen. | Selektive Simulation nur für unstrukturierte Proc-Ketten [cite: ]. | Vollständige Match-Simulation strikt als Akademischer Overkill ablehnen [cite: ]. | B | Nein | Ja (Simulation Optimization) [cite: ] |
| CLM-08 | Aussagekraft des Regret-Integral-Scores. | Regret ist relativ zu einer heuristischen Referenz, nicht zur Wahrheit [cite: ]. | Referenzkurve basiert auf 2s-Gier-Sample; Regret ist approximiert [cite: ]. | A | Ja (trajectory-objectives.mjs) [cite: ] | Ja (Optimization under Uncertainty) [cite: ] |
| CLM-09 | Nutzbarkeit von Branch-and-Bound-Schranken. | Obere Schranken zur Lückenberechnung notwendig [cite: ]. | B&B-Schranke ist in docs/ hergeleitet und muss aktiviert werden [cite: ]. | B | Ja (docs/reference_branch_bound_review.md) [cite: ] | Ja (B&B Theory) [cite: ] |
| CLM-10 | Verwendbarkeit des Begriffs "best verified". | Produktmodus liefert nur "best found", nicht global verifiziert [cite: ]. | "Best verified" gilt nur für abgedeckte Teilräume; sonst "best found" [cite: ]. | B | Ja (AGENTS.md) [cite: ] | Nein |
Phase 3 — Unabhängige Prüfung des Quellcodes
Die Prüfung erfolgte direkt auf dem Repository Gaschde/sidestep-deadlock, Branch main, Commit-SHA b0001472fbbcc2c3becc42582043d82caa547e88 am 19.09.2026 [cite: ].
Rekonstruktion des produktiven Ausführungspfads
Der Ausführungspfad im Produktivmodus unterscheidet sich von den Diagnoseläufen und gestaltet sich wie folgt:
 * UI (app/app.js): Bei Klick auf "Build starten" wird ein Web Worker initialisiert (new Worker("optimizer-worker.mjs")) und per postMessage mit Parametern wie { mode: "anytime", budget: 40000, hero, damageFocus, itemIds } versorgt [cite: ].
 * Worker (app/optimizer-worker.mjs): Verzweigt anhand des Modus anytime und ruft runAnytimeCarry() auf [cite: ].
 * Domain (app/deadlock-domain.mjs): Initalisiert den Zustand createDeadlockDomain() mit { earnedSouls, cash, inventory, unlockedSlots, events, snapshots } und prüft valide Transitionen (purchase, upgrade, sell, replace) [cite: ].
 * Search (app/anytime-search.mjs): Führt stochastische Greedy-Rollouts mit Gumbel-Störung (Faktor 0.002), 10% Zufallsaktionen und lokaler Refinement-Suche durch [cite: ]. Nach Ablauf des Zeitbudgets erfolgt ein Terminal-Audit der 1-Schritt-Nachbarschaft [cite: ].
 * Evaluation (app/warden-search.mjs & app/optimizer.mjs): Evaluiert Kandidaten über evaluateCarryScenarios(), berechnet DPS-Werte in Fünf-Zeitfenstern sowie EHP unter Berücksichtigung der eigenen Resistenz-Formel RES-002 [cite: ].
 * Scoring (app/anytime-search.mjs): Berechnet den Gesamtscore via scoreAnytimePath() nach der Formel: 0.70 \cdot \text{EndUtility} + 0.15 \cdot (1 - \text{WorstRegret}) + 0.15 \cdot (1 - \text{IntegratedRegret}) [cite: ].
 * Validierung (app/validate-search-path.mjs): Spielt den Siegerpfad Schritt für Schritt nach, um die absolute Kauf- und Slot-Legalität zu zertifizieren [cite: ].
 * Ergebnis: Rückgabe an das UI zur Visualisierung des Pfads [cite: ].
Abweichungsanalyse: Report-Aussagen vs. Quellcode
| Gegenstand | Aussage Report A (GPT) | Aussage Report B (Claude) | Tatsächlicher Befund im Quellcode | Urteil |
|---|---|---|---|---|
| Mehrfachgewichtung Metriken | Dreifache Verwendung derselben 10s-DPS-Metrik [cite: ]. | Identifiziert Redundanz in den Fünf-Fenster-Metriken [cite: ]. | In app/warden-search.mjs greifen laneTradeWindowDps, farmWindowDps und teamfightWindowDps alle auf damageAt(10) / 10 zu [cite: ]. | Report A präziser [cite: ]. Der Code bestätigt die numerische Identität explizit [cite: ]. [Evidence Level: A] |
| Referenzkurve für Regret | Referenz beruht auf einer Heuristik [cite: ]. | Referenz wird über 2s-Gier-Sample approximiert [cite: ]. | In app/direct-reference.mjs wird die Referenztrajektorie gierig gesampelt [cite: ]. | Beide Berichte korrekt [cite: ]. Regret misst Differenzen zu einer Heuristik, nicht zur globalen Wahrheit [cite: ]. [Evidence Level: A] |
| Exakter Solver bei 40k Souls | Rechnerisch nicht durchführbar [cite: ]. | Nicht terminierend (Watchdog-Abbruch) [cite: ]. | docs/search_specification.md dokumentiert 4.715.491 Kandidaten nach 19s mit INCOMPLETE_WATCHDOG [cite: ]. | Report B präziser [cite: ]. Belegt die Nicht-Terminierung mit konkreten Messwerten [cite: ]. [Evidence Level: A] |
| Gegnermodell im Code | Fehlt vollständig [cite: ]. | Keinerlei Gegnerzustand im State [cite: ]. | State in deadlock-domain.mjs enthält nur eigene Ressourcen; optimizer.mjs nutzt Gegnerresistenzen nur für EHP, nicht für ausgeteilten DPS [cite: ]. | Beide Berichte absolut korrekt [cite: ]. Counterbuilding ist im Modell unmöglich [cite: ]. [Evidence Level: A] |
Phase 4 — Unabhängige Deep Research
Eine fundierte wissenschaftliche Einordnung erfordert den Rückgriff auf etablierte Literatur der mathematischen Optimierung und Algorithmik [cite: ].
Etablierte mathematische Grundlagen
 * Multi-Objective Shortest Path (MOSP) & Label-Correcting:
   Das Suchen in Kaufgraphen mit Vektorkriterien (z. B. DPS, EHP, Tempo) entspricht dem Multi-Objective Shortest Path Problem [cite: ]. Paixão und Santos (2012) zeigten, dass Label-Correcting-Verfahren für die Ermittlung der Pareto-Front optimal sind, jedoch bei steigender Kriterienanzahl oder Graphdichte exponentiell wachsen [cite: ]. Dies erklärt das Verhalten von search-core.mjs [cite: ].
 * Resource-Constrained Shortest Path (RCSP):
   Die Führung des Suchraums über verbrauchte Ressourcen (earnedSouls, Slot-Kapazitäten) ordnet die Problemstellung den Resource-Constrained Shortest Path Problems zu [cite: ]. Bei monoton steigenden Verbräuchen ermöglichen Label-Setting-Algorithmen eine effiziente Eliminierung dominierter Teillösungen [cite: ].
 * Anytime Heuristic Search & Suboptimalitäts-Schranken:
   Hansen und Zhou (2007) wiesen in ihrer Arbeit zu Anytime A* nach, dass gewichtete heuristische Suchen schnell gültige Lösungen liefern, deren Abstand zur Optimalität über Schranken während der Laufzeit verringert wird [cite: ]. Der produktive Pfad in anytime-search.mjs nutzt zwar fortschreitende Incumbents, verzichtet jedoch mangels unterer/oberer Schranken auf eine Konvergenz-Zertifizierung [cite: ].
 * Robust Optimization under Uncertainty:
   Bertsimas und Sim (2004) begründeten den Ansatz der Robust Optimization, bei dem Parameterunsicherheiten (wie gegnerische Resistenzen) als deterministische Unsicherheitsmengen \Gamma modelliert werden [cite: ]. Das Ziel ist die Maximierung der Performance im schlechtesten Fall (Minimax Regret) [cite: ].
In keinem Bericht vorgeschlagene Methoden
Folgende etablierte Methoden wurden weder von GPT noch von Claude identifiziert [cite: ]:
 * Multi-Objective Memetic Algorithms (MOMA / S-MOGLS):
   Eine Kombination aus evolutionary Multi-Objective Optimization (z. B. NSGA-II) und lokaler Suche [cite: ]. Studien zeigen, dass MOMA bei hochgradig nicht-konvexe Pareto-Fronten und diskreten Item-Kombinationen sowohl reine Local Search als auch klassische Genetic Algorithms in der Abdeckung der Pareto-Front deutlich übertreffen [cite: ].
 * Contraction Hierarchies & Goal-Directed Pruning (ALT-Algorithmen für RCSP):
   In der MOSP-Literatur werden gerichtete Graphen hierarchisch kontrahiert, indem Äquivalenzklassen von Sub-Items vorab zusammengefasst und Abkürzungs-Kanten (Shortcuts) gebildet werden [cite: ]. Dies reduziert die Knotenexpansion im Suchraum um mehrere Größenordnungen [cite: ].
 * Chance-Constrained Dynamic Programming:
   Modellierung der gegnerischen Resistenzen als stochastische Nebenbedingung, bei der ein Build garantiert, dass er gegen mindestens (1 - \alpha)\% aller historisch beobachteten Gegner-Builds eine Mindest-Effektivität erreicht.
Phase 5 — Die eigentliche Problemklasse
Mathematische Formulierung
Das Projekt sidestep-deadlock lässt sich als sequenzielles, multikriterielles Entscheidungs- und Allokationsproblem formulieren [cite: ].
Zustand (State)
Der Zustand S_t zum Diskretisierungsschritt t (Soul-Koordinate) ist definiert als:

 * s_t \in \mathbb{N}_0: Kumulierte verdiente Souls (earnedSouls) [cite: ].
 * c_t \in \mathbb{N}_0: Verfügbares Bares (cash) [cite: ].
 * I_t \subset \mathcal{I}: Menge der im Inventar befindlichen Items (\vert{}\mathcal{I}\vert{} = 156) [cite: ].
 * K_t = (k_{\text{weapon}}, k_{\text{spirit}}, k_{\text{vitality}}, k_{\text{flex}}): Vektor der freigeschalteten und belegten Slots [cite: ].
 * \Theta_{\text{opp}}: Vektor gegnerischer Zustandsparameter (im Code derzeit \Theta_{\text{opp}} = \emptyset) [cite: ].
Aktionen (Actions)
Eine Aktion a_t \in A(S_t) beschreibt eine valide Transaktion:


unter Einhaltung aller Nebenbedingungen (Slots, Kosten, Active-Limits, Ancestor-Konflikte) [cite: ].
Transitionen (Transitions)

wobei \Delta s den Fortschritt auf der Soul-Achse darstellt [cite: ]. Das Einkommen \Delta s wird exogen zugeführt und ist unabhängig vom gewählten Build I_t [cite: ].
Zielvektor (Objectives)
Die Evaluation eines Pfads \pi = (S_0, S_1, \dots, S_T) erfolgt über einen mehrdimensionalen Vektor:

Einordnung in Problemklassen
 * Resource-Constrained Multi-Objective Shortest Path Problem (RCMOSP):
   Da das Budget (s_t) als stetig verbrauchte Ressource wirkt und der Graph acyclisch über die Soul-Achse verläuft, fällt der Kern des Item-Kaufpfads exakt in die Klasse des RCMOSP [cite: ].
 * Multiobjective Combinatorial Optimization (MOCO):
   Die Auswahl des Endinventars I_T bei fester Soul-Grenze entspricht einem mehrdimensionalen, mehrkriteriellen Rucksackproblem mit Abhängigkeiten (Multi-Objective Multi-Constraint Knapsack Problem) [cite: ].
 * Hybrides Gesamtmodell:
   Da die Kaufreihenfolge Pfadabhängigkeiten (Regret-Integral) aufweist und die Bewertung gegen künftige Gegner variieren kann, handelt es sich strukturell um einen Multi-Objective Robust Resource-Constrained Sequential Decision Process [cite: ].
Phase 6 — Die wichtigsten Streitpunkte
A. End-Build vs. Kaufpolitik (Policy)
Report A fordert eine echte Kaufpolitik (Policy a = \pi(S)), während Report B den Ausbau des sequenziellen Pfad-Optimierers bevorzugt [cite: ].
Eine echte Policy berechnet für jeden denkbaren Zwischenzustand S die optimale Aktion a. Dies erfordert das Lösen einer Bellman-Gleichung über den gesamten Zustandsraum [cite: ]. Bei 156 Items, variablen Slot-Kombinationen und verästelten Gegnerzuständen führt dies zum Curse of Dimensionality [cite: ].
Ein Pfad-Optimizer mit Szenario-Abzweigungen (Scenario-Branching) ist für ein Browser-Tool die überlegene Lösung. Dabei wird ein primärer Hauptkaufpfad berechnet, der an 2-3 definierten Meilensteinen (z. B. 6.000, 15.000 Souls) bedingte Verzweigungen ("Wenn Gegner hohe Spirit-Resistenz baut -> kaufe Item X") enthält.
| Kriterium | Echte Policy (Report A) | Pfad + Szenario-Abzweigung (Empfehlung) |
|---|---|---|
| Aussagekraft | Höchste theoretische Perfektion [cite: ] | Sehr hoch für praxisrelevante Matches |
| Rechenaufwand | Exponentiell / Nicht im Browser machbar [cite: ] | Polynomiell / Im Browser via Worker ausführbar [cite: ] |
| Datenbedarf | Vollständige MDP-Übergangswahrscheinlichkeiten [cite: ] | Nur diskrete Gegner-Resistenzprofile [cite: ] |
| Implementierbarkeit | Extrem niedrig [cite: ] | Hoch (baut direkt auf snapshots auf) [cite: ] |
Fazit: Ein Pfad mit Szenario-Abzweigungen bietet das optimale Verhältnis aus Nutzen und Berechenbarkeit [Evidence Level: B].
B. Earned Souls vs. Echte Spielzeit
Report A argumentiert, dass ohne echte Spielzeit das Tempo und Power Spikes falsch bewertet werden, da ein Build die zukünftige Farmrate verändert [cite: ]. Report B hält dagegen, dass ein Einkommensmodell ohne Real-Spieldaten nur unbelegte Parameter einführt [cite: ].
Ein falsches Zeitmodell ist mathematisch schädlicher als ein ehrliches, reines Soul-Modell. Wenn dem System ein ungeprüftes Einkommensmodell s(t) = k \cdot t zugrunde gelegt wird, verfälscht dies die Evaluierung durch False Precision [cite: ].
Die Lösung besteht darin, Zeit nicht als fundamentale Grundachse zu erzwingen, sondern die Soul-Achse als primäre Koordinate zu belassen und Zeit über optionale, benannte Meilenstein-Fenster (Early Game: 3k, Mid Game: 12k, Late Game: 30k) abzubilden.
C. Minimales Gegnermodell
Das derzeitige Modell berechnet ausgeteilten Schaden gegen Null-Resistenz [cite: ]. Dies führt zu Fehlbewertungen: Reine Bullet-DPS-Builds werden gegenüber Hybrid- oder Armor-Reduction-Builds bevorzugt, selbst wenn der Gegner 60% Bullet-Resistenz besitzt [cite: ].
Zur Behebung dieses Mangels erfordert das System keinen vollständigen gegnerischen Zustandsraum. Es genügt eine parametrisierte Gegner-Resistenzanalyse:
Dabei stellt der Nutzer über UI-Slider oder vordefinierte Archetypen (z. B. "High Bullet Armor", "High Spirit Armor", "Balanced") die Parameter R_{\text{opp, bullet}} und R_{\text{opp, spirit}} ein [cite: ].
D. Pareto-Front vs. Skalarscore
Skalarisierungsfunktionen mit festen Gewichten (wie der aktuelle 70/15/15 Score) bergen das mathematische Risiko, konfiskatorisch zu wirken: Sie können nicht-konvexe Abschnitte einer Pareto-Front systematisch verdecken [cite: ].
Das System sollte intern strikt zweidimensionale Pareto-Mengen (Schaden vs. Effektive Gesundheit/EHP) berechnen [cite: ]. Für die Benutzeroberfläche wird aus dieser Pareto-Menge über einen konfigurierbaren Präferenz-Gewichter ein Einzelkandidat als Standard-Empfehlung ausgewählt, während dem Nutzer die alternative Pareto-Front visuell bereitgestellt wird [cite: ].
E. Beam Search vs. Aktuelle Anytime Search vs. Alternativen
Report B empfiehlt Beam Search als Ersatz für die stochastische Local Search [cite: ]. Die Verfahren wurden im direkten Vergleich analysiert [cite: ].
| Suchverfahren | Kombinatorische Abdeckung | Risiko lokaler Optima | Speicherbedarf | Laufzeit-Prognose | Bounding-Fähigkeit |
|---|---|---|---|---|---|
| Aktuelle Anytime Local Search | Niedrig (Single-Path + Perturbations) [cite: ] | Hoch bei Schwellen-Items [cite: ] | Sehr niedrig (O(1)) [cite: ] | Exakt steuerbar (25s Budget) [cite: ] | Keine [cite: ] |
| Beam Search (Breite k) | Mittel bis Hoch (parallele Pfade) [cite: ] | Gering durch Pfaddiversität [cite: ] | Moderat (O(k \cdot d)) [cite: ] | Deterministisch steuerbar [cite: ] | Indirekt über Beam-Cutoffs [cite: ] |
| Iterative Beam Search | Sehr hoch (skalierende Breite) [cite: ] | Sehr gering | Hoch bei großem Beam | Flexibel als Anytime-Verfahren [cite: ] | Teilweise [cite: ] |
| MOMA / S-MOGLS (NSGA-II + LS) | Exzellent für Pareto-Fronten [cite: ] | Minimal [cite: ] | Hoch (Populationsbasiert) [cite: ] | Budgetierbar über Generationen [cite: ] | Keine analytischen Bounds [cite: ] |
| Branch & Bound (mit admissible Bound) | Vollständig (zertifiziert) [cite: ] | Keins (Global optimal) [cite: ] | Exponentiell im Worst-Case [cite: ] | Nicht garantiert in 25s [cite: ] | Exakt (100% Zertifikat) [cite: ] |
Wissenschaftliches Urteil: Beam Search ist dem stochastischen Single-Path-Hillclimbing in puncto Pfaddiversität und Vermeidung lokaler Optima überlegen [cite: ]. Die höchste Ergebnisqualität liefert eine Iterative Beam Search, die bei kleinstem k startet und den Beam schrittweise erweitert, bis das Zeitbudget abgelaufen ist [cite: ]. [Evidence Level: B]
Phase 7 — Exakt vs. Approximiert
Zur Vermeidung ungenauer Versprechungen werden die Aspekte des Projekts exakt ihren theoretischen Evidenzklassen zugeordnet [cite: ].
 * MATHEMATISCH EXAKT: Regelvalidierung in deadlock-domain.mjs, Kostenberechnung, Slot-Belegungen, Upgrade-Abhängigkeiten, multiplikatives Resistenz-Stacking (RES-002), exakte Enumeration kleiner Diagnose-Slices in search-core.mjs [cite: ].
 * ZERTIFIZIERBAR MIT BOUND: Lösungsabstand für begrenzte Item-Teilmengen, wenn die in docs/reference_branch_bound_review.md beschriebene admissible obere Schranke aktiviert wird [cite: ].
 * HEURISTISCH: Die globale Pfadsuche über 156 Items und 40.000 Souls in anytime-search.mjs sowie die Regret-Berechnung relativ zur gesampelten Referenzkurve [cite: ].
 * SIMULATION: Stochastische Trefferwahrscheinlichkeiten, Positionsabhängigkeiten, Cooldown-Tragweiten und komplexe Proc-Ketten für Fähigkeits-Combos.
 * EMPIRISCH: Die reale Siegwahrscheinlichkeit eines Builds in Live-Matches sowie der Einfluss von Spieler-Skill und Map-Positionierung.
 * NICHT DEFINIERT OHNE WEITERE ANNAHMEN: Eine pauschale Aussage über den "global besten Deadlock-Build" ohne Angabe von Gegner-Builds, Matchzeitpunkt, Team-Kontext und Ziel-Präferenzen [cite: ].
Phase 8 — Terminologie Audit
| Begriff | Aktuelle Verwendung im Projekt | Wissenschaftlich korrekte Definition | Zulässigkeit & Korrekturbedarf |
|---|---|---|---|
| global optimal | Gelegentlich in Doku-Diskussionen erwähnt [cite: ]. | Das absolute Optimum über den gesamten realen Spiel-Zustandsraum. | Unzulässig für den Produktivmodus [cite: ]. Nicht einmal theoretisch definiert [cite: ]. |
| optimal under assumptions | In Entwickler-Hinweisen genutzt [cite: ]. | Exaktes Optimum innerhalb eines vollständig geschlossenen formalen Modells M. | Zulässig nur für exakte Subsolver (search-core.mjs bei kleinen Slices) [cite: ]. |
| robust optimal | Nicht aktiv genutzt [cite: ]. | Maximin-Optimum bezüglich einer expliziten Unsicherheitsmenge \Gamma [cite: ]. | Erst nach Einführung von Gegner-Szenarien zulässig [cite: ]. |
| Pareto optimal | In Doku & Diagnosepfad genutzt [cite: ]. | Nicht-dominierte Lösung bezüglich eines Zielvektors \mathbf{J} [cite: ]. | Zulässig für search-core.mjs; unzulässig für den gewichteten Skalar-Produktivpfad [cite: ]. |
| best verified | Als primärer Claim in AGENTS.md gewählt [cite: ]. | Lösung, deren Optimalität über einen formalen Beweis oder Bounded Search zertifiziert ist [cite: ]. | Irreführend im Produktivpfad [cite: ]. Erweckt den Eindruck einer mathematischen Verifikation des Gesamtpfads [cite: ]. |
| best found + legally path-verified | Vorschlag der Prüfer [cite: ]. | Der beste in der Heuristik gefundene Pfad, dessen Kauflegalität durch ein Replay bewiesen ist [cite: ]. | Wissenschaftlich einzig korrekte Bezeichnung für den heutigen 25s-Produktmodus [cite: ]. |
Phase 9 — Red Team beider Berichte
Red Team Report A (GPT)
 * Unnötige Komplexität: Die Forderung nach einer vollständigen Kaufpolitik (Policy) über ein stochastisches MDP führt zu akademischem Overkill [cite: ]. Die Berechnung einer vollständigen State-Action-Map sprengt die Rechenkapazität von Client-Hardware [cite: ].
 * Fehlende Datenbasis: Das geforderte dynamische Einkommens- und Zeitmodell setzt Spieldaten über Farmraten und Snowball-Koeffizienten voraus [cite: ]. Da diese Daten im Repository nicht vorliegen, müsste das Modell geschätzte Werte einsetzen, was die Projektregel ("keine erfundenen Spielwerte") verletzt [cite: ].
 * Theoretische Überdehnung: Report A behandelt das Fehlen eines Zeitmodells als mathematischen K.-o.-Fehler, ignoriert dabei jedoch, dass eine exogene Soul-Achse eine wohldefinierte, reproduzierbare Benchmark-Transformation darstellt [cite: ].
Red Team Report B (Claude)
 * Zu konservative Haltung: Report B neigt dazu, das bestehende Modell als weitgehend ausreichend zu verteidigen und primär lokale Optimierungen (wie Beam Search) vorzuschlagen [cite: ].
 * Symptombekämpfung statt Modellkorrektur: Der Wechsel von Single-Path-Hillclimbing zu Beam Search verbessert zwar die Pfaddiversität, löst jedoch nicht das fundamentale Modellproblem, dass der ausgeteilte Schaden blinden Auges gegenüber gegnerischen Resistenz-Items agiert [cite: ].
 * Mangelnde langfristige Perspektive: Report B bewertet die Beibehaltung der skalarisierten Zielfunktion (70/15/15) als pragmatisch, ignoriert dabei jedoch die wissenschaftlichen Risiken der Verdeckung Pareto-optimaler Randlösungen [cite: ].
Gemeinsame falsche Grundannahme
Beide Berichte akzeptieren stumm, dass der Endhorizont von 40.000 Souls die maßgebliche Evaluationsebene darstellt [cite: ]. In der realen Spielpraxis von Deadlock werden 40.000 Souls selten erreicht; die vorentscheidenden Phasen liegen zwischen 3.000 und 15.000 Souls. Die ausschließliche Optimierung auf ein 40k-Endinventar erzeugt Builds, die im Mid-Game gravierende Power-Spike-Defizite aufweisen, vom Regret-Integral der aktuellen Codebasis jedoch nicht ausreichend bestraft werden [cite: ].
Phase 10 — Blinde Flecken
Weder Report A noch Report B haben folgende kritische Aspekte untersucht [cite: ]:
 * Reward Hacking & Goodhart's Law:
   Da der Score zu 70% aus dem Endnutzen besteht und Schaden/Survival strikt 50/50 gewichtet sind [cite: ], neigt der Optimizer dazu, "Stat-Stuffer-Builds" zu bevorzugen (z. B. Kombinationen aus reinen Raw-DPS- und Raw-EHP-Items), die theoretisch hohe Kennzahlen aufweisen, in der Praxis jedoch mangels Utility-, Mobility- oder Active-Items unspielbar sind.
 * Proc- und Interaktions-Komplexität:
   Der Code setzt Proc-Effekte (außer fest hinterlegtes Afterburn) mit dem Wert 0 an [cite: ]. Dies führt zu einer systematischen Unterbewertung von Items, deren Stärke in bedingten Effekten liegt (z. B. Items mit "On Hit"-Trigger oder Cooldown-Rücksetzung).
 * Cache-Invalidierungs-Risiko:
   reference-cache.mjs erzeugt Cache-Keys über den SHA-256-Hash des transitiven Modul-Graphen [cite: ]. Wenn sich Datendateien unter data/core/ ändern, ohne dass sich der Modulcode ändert, kann es zu unbemerkten Cache-Inkonsistenzen kommen, falls die Daten-Hashes nicht explizit in den Key einfließen.
 * Invarianz gegenüber Skill-Builds:
   Die Performance von Weapon- und Spirit-Items hängt drastisch davon ab, welche Skills der Held zuerst maximiert. Das Modell behandelt Helden-Level und Skill-Level jedoch als unbekannt [cite: ], was bei Spirit-Carries zu erheblichen Fehlschätzungen des Schadens führt.
Phase 11 — Empirische Entscheidungstests
Zur objektivierten Entscheidungsfindung zwischen den Architektur-Vorschlägen werden drei empirische Experimente definiert:
Experiment 1: Suchverfahren-Benchmark (Anytime Local Search vs. Iterative Beam Search vs. MOMA)
 * Versuchsaufbau: Vergleich der drei Algorithmen auf identischer Hardware unter exakt gleichem Zeitbudget (25 Sekunden pro Lauf) über 50 zufällig gewählte Helden/Fokus-Kombinationen.
 * Messgrößen:
   * Beste gefundene Utility (Höchster erreichter Score).
   * Abstand zur Exaktheit (Untersuchung auf kleinen 10-Slot-Teilräumen gegen das exakte Orakel aus search-core.mjs).
   * Varianz über Seeds (Stabilität bei unterschiedlichen Initialisierungen).
   * Speicherverbrauch (RAM-Peak im Web Worker).
 * Entscheidungskriterium: Liefert Beam Search oder MOMA bei gleichem Zeitbudget eine statistisch signifikant höhere Utility (p < 0.01) bei reduzierter Seed-Varianz, wird die bestehende Local Search abgelöst [Evidence Level: B].
Experiment 2: Skalarisierung vs. 2D-Pareto-Front
 * Versuchsaufbau: Evaluierung von 100 optimierten Builds. Vergleich der Ergebnisse aus einer festen 70/15/15-Skalarisierung mit der tatsächlichen 2D-Pareto-Front (DPS vs. EHP).
 * Messgröße:
   * Prozentsatz verdeckter Lösungen (Wie viele Pareto-optimale Punkte werden durch den Skalarscore verworfen?).
   * Trade-Off-Distanz (Wie viel DPS opfert der Skalar-Sieger für geringfügige EHP-Gewinne?).
 * Entscheidungskriterium: Wenn die Skalarisierung in mehr als 15% der Fälle dominierte oder praxisferne Randlösungen wählt, wird die intern strikte 2D-Pareto-Suche verpflichtend eingeführt [Evidence Level: B].
Experiment 3: Relevanz der Gegner-Resistenzanalyse
 * Versuchsaufbau: Berechnung des Top-Builds für Warden (Weapon-Fokus) unter drei Bedingungen: (a) Ohne Gegner-Resistenz, (b) Gegen 40% Bullet-Resistenz, (c) Gegen 40% Spirit-Resistenz.
 * Messgröße:
   * Jaccard-Index der Item-Mengen (Set-Überschneidung der gewählten Top-Builds).
   * DPS-Verlust im Worst Case (Wie viel Schaden büßt der "No Opponent"-Build ein, wenn der Gegner Resistenz baut?).
 * Entscheidungskriterium: Fällt der Jaccard-Index unter 0.60 (d. h. über 40% geänderte Items), ist der Nachweis erbracht, dass ein blindes Modell praxisfremde Empfehlungen erzeugt [Evidence Level: A].
Phase 12 — Finale Vergleichsmatrix
| Thema / Fragestellung | Befund Report A (GPT) | Befund Report B (Claude) | Deep-Research-Befund | Wer war näher dran? | Confidence | Begründung |
|---|---|---|---|---|---|---|
| Problemdefinition | Kaufpolitik (Policy) in MDP [cite: ] | Best verifizierter Pfad unter Annahmen [cite: ] | Multi-Objective Robust Resource-Constrained Path Problem [cite: ] | Claude [cite: ] | Hoch | GPT schießt mit MDP über das Ziel hinaus; Claude erfasst den Pfad-Charakter realistischer [cite: ]. |
| Aktueller Optimizer | Stochastische Heuristik [cite: ] | Greedy Local Search mit Gumbel-Rauschen [cite: ] | Exakt belegt durch Quellcode-Audit (anytime-search.mjs) [cite: ] | Claude [cite: ] | Sehr hoch | Claude identifiziert die konkreten Parameter (Gumbel 0.002, 10% Random) präzise [cite: ]. |
| Exakte Suche | Für kleine Räume valide [cite: ] | Martins-basiertes Label-Correcting [cite: ] | Multi-Objective Label-Correcting nach Paixão & Santos [cite: ] | Unentschieden [cite: ] | Hoch | Beide erkennen die Korrektheit von search-core.mjs für Subgraphen [cite: ]. |
| Beam Search | Nicht im Fokus [cite: ] | Empfohlen als Haupt-Upgrade [cite: ] | MOMA und Iterative Beam Search überlegen [cite: ] | Claude [cite: ] | Mittel | Beam Search ist ein pragmatischer Fortschritt, wenn auch MOMA theoretisch stärker wäre [cite: ]. |
| Pareto-Front | Strikte Entkopplung nötig [cite: ] | 2D-Front als Untergrund [cite: ] | Skalarisierung birgt Risiko konfiskatorischer Selektion [cite: ] | GPT [cite: ] | Hoch | GPT betonte die mathematische Notwendigkeit der Entkopplung konsequenter [cite: ]. |
| Gegnermodell | Zwingend erforderlich [cite: ] | Parametrisierte Slider genügen [cite: ] | Robust Optimization mit Unsicherheitsmenge \Gamma [cite: ] | Claude [cite: ] | Hoch | Claudes Vorschlag verhindert Datenmangel und erfüllt die Projektregeln [cite: ]. |
| Echte Matchzeit | Zwingende Grundachse [cite: ] | Abgelehnt wegen Datenmangel [cite: ] | Ungeprüftes Zeitmodell erzeugt False Precision [cite: ] | Claude [cite: ] | Hoch | Ein falsches Zeitmodell ist schädlicher als eine ehrliche Soul-Achse [cite: ]. |
| Terminologie | "Best found" zwingend [cite: ] | "Best verified" einschränken [cite: ] | Produktivpfad ist "best found + legally path-verified" [cite: ] | GPT [cite: ] | Sehr hoch | GPT fordert die wissenschaftlich exaktere Abgrenzung gegen "verified" [cite: ]. |
Phase 13 — Gemeinsame Zielarchitektur
Auf Basis der Code-Auditierung und der Recherche wird eine integrierte Zielarchitektur festgelegt [cite: ]:
 * Eingabe-Schicht: Helden-Profil, Rolle, Schadensfokus, Soul-Budget, Zeit-Meilensteine sowie parametrisierte Gegner-Resistenzprofile (UI-Slider).
 * Verifizierte Domäne (deadlock-domain.mjs): Beibehaltung der bestehenden Kauf-, Slot-, Upgrade- und Sellback-Regeln sowie des Legalitäts-Replays [cite: ].
 * Such-Engine Core:
   * Exakter Zweig (Diagnose): Label-Correcting (search-core.mjs) kombiniert mit der hergeleiteten Branch-and-Bound-Schranke für zertifizierte Subgraphen [cite: ].
   * Heuristischer Zweig (Produktion): Iterative Beam Search mit vorausgehender Item-Dominanzfilterung [cite: ].
 * Szenario & Evaluierung: Multi-Fenster-DPS/EHP-Berechnung unter Einbeziehung der gegnerischen Resistenz-Szenarien [cite: ].
 * Pareto & User Ranking: Strikte interne 2D-Pareto-Front (DPS vs. EHP); konfigurierbare Skalarisierung als Default-Anzeige für die Benutzeroberfläche [cite: ].
 * Ausgabe-Schicht: Hauptkaufpfad mit Szenario-Abzweigungen an Meilensteinen, visuelle Pareto-Front und transparente Ausweisung der Suchunsicherheit [cite: ].
Komponenten-Spezifikation
 * Item-Dominanzfilterung (Pre-Processing)
   * Kategorie: JETZT
   * Warum: Entfernt vor der Suche Items, die in allen Attributen bei gleichem oder höherem Preis von anderen Optionen strikt dominiert werden [cite: ].
   * Nutzen: Reduziert den Suchraum ohne Qualitätsverlust [cite: ].
   * Datenbedarf: Keine zusätzlichen Daten (nutzt bestehende data/core/items.json) [cite: ].
   * Komplexität: Sehr gering (O(\vert{}\mathcal{I}\vert{}^2) im Pre-Processing) [cite: ].
   * Beweis: Mathematisch nachweisbar [cite: ].
 * Iterative Beam Search Engine
   * Kategorie: JETZT
   * Warum: Ersetzt Single-Path-Hillclimbing in anytime-search.mjs durch breitenparallele Pfaderweiterung [cite: ].
   * Nutzen: Verhindert das Steckenbleiben an Schwellenwert-Items und erhöht die Pfaddiversität [cite: ].
   * Datenbedarf: Keine zusätzlichen Daten [cite: ].
   * Komplexität: Moderat [cite: ].
   * Beweis: Experiment 1 (Phase 11).
 * Parametrisierte Gegner-Resistenz-Szenarien
   * Kategorie: JETZT
   * Warum: Schließt die Lücke blind ausgeteilten Schadens [cite: ].
   * Nutzen: Verhindert Fehlempfehlungen gegen Panzerung [cite: ].
   * Datenbedarf: Keine Live-Daten; Nutzung von UI-Slidern oder festen Archetypen [cite: ].
   * Komplexität: Gering (Erweiterung der Schadensformel in optimizer.mjs) [cite: ].
   * Beweis: Experiment 3 (Phase 11).
 * Aktivierung der Admissiblen Branch-and-Bound-Schranke
   * Kategorie: SPÄTER
   * Warum: Bietet ein rechnerisches Zertifikat über den maximalen Abstand des Incumbents zur geschätzten Obergrenze [cite: ].
   * Nutzen: Erlaubt das Ausweisen echter Suboptimalitäts-Gaps [cite: ].
   * Datenbedarf: Bereits in docs/reference_branch_bound_review.md mathematisch hergeleitet [cite: ].
   * Komplexität: Hoch [cite: ].
   * Beweis: Vergleich der Cutoff-Rate in Testläufen.
 * Dynamisches Einkommens- / Spielzeit-Modell
   * Kategorie: NUR WENN DATEN VORHANDEN
   * Warum: Kopplung von Farmrate an Zeit macht mathematisch nur Sinn, wenn valide Telemetriedaten vorliegen [cite: ].
   * Nutzen: Bessere Modellierung von Snowball-Effekten [cite: ].
   * Datenbedarf: Erfordert Tausende verifizierte Match-Replays zur Kalibrierung.
   * Komplexität: Extrem hoch [cite: ].
   * Beweis: Empirische Validierung der Konvergenz gegen Match-Outputs.
 * Vollständiger digitaler Match-Simulator
   * Kategorie: NICHT EMPFOHLEN
   * Warum: Akademischer Overkill [cite: ]. Erfordert das Nachbauen der gesamten Spiel-Engine von Deadlock [cite: ].
   * Nutzen: Minimaler Zusatzgewinn bei extrem hohen Wartungskosten [cite: ].
Phase 14 — Roadmap
Die drei nächsten Schritte sind streng nach ihrem Verhältnis aus Informationsgewinn zu Aufwand priorisiert [cite: ]:
 * Schritt 1: Benchmark- & Referenz-Fehlerschranken-Experiment (Informationsgewinn: Extrem Hoch | Aufwand: Gering)
   * Implementierung eines Test-Harnesses zur Messung der Güte der stochastischen Suche und der gesampelten Referenzkurve auf kleinen, exakt lösbaren Sub-Itemsets (unter Verwendung von search-core.mjs) [cite: ].
   * Ergebnis: Beseitigt die Unklarheit über die tatsächliche Fehlerspanne des heutigen 25s-Produktmodus und liefert die empirische Entscheidungsgrundlage für den Wechsel zu Beam Search [cite: ].
 * Schritt 2: Aktivierung der Item-Dominanzfilterung & B&B-Shadow-Check (Informationsgewinn: Hoch | Aufwand: Moderat)
   * Einbau des Pre-Search Dominanzfilters für strikt unterlegene Items sowie schattenweise Zuschaltung der hergeleiteten Branch-and-Bound-Schranke zur Protokollierung des verbleibenden Optimierungs-Gaps [cite: ].
   * Ergebnis: Reduziert die Suchraumgröße ohne Qualitätsverlust und liefert erstmals zertifizierte Qualitätsgrenzen für die Heuristik [cite: ].
 * Schritt 3: Integration parametrisierter Gegner-Resistenzen & Mehrfach-Meilensteine (Informationsgewinn: Extrem Hoch | Aufwand: Moderat)
   * Ergänzung der EHP- und Schadensformeln in optimizer.mjs um gegnerische Resistenzfaktoren sowie Auswertung der Kaufpfade an drei Meilenstein-Snapshots (6k, 15k, 30k Souls) [cite: ].
   * Ergebnis: Behebt den blinden Fleck der aktuellen Modellierung (Schadensberechnung gegen Null-Resistenz) und eliminiert die Fixierung auf praxisfremde 40k-Endbuilds [cite: ].
Phase 15 — Finales Urteil
 * Was haben GPT und Claude beide richtig erkannt?
   Beide erkannten korrekt, dass der aktuelle produktive Browserpfad eine stochastische Heuristik ist, dass der exakte Label-Correcting-Kern bei 156 Items / 40k Souls kombinatorisch explodiert und dass die Schadensberechnung blinden Auges gegenüber gegnerischen Resistenz-Items agiert [cite: ].
 * Wo unterscheiden sie sich wirklich?
   Report A fordert eine Umformulierung des Problems zu einer stochastischen Kaufpolitik (Policy) auf einem zeit- und einkommensbasierten MDP [cite: ]. Report B empfiehlt eine pragmatische Weiterentwicklung der Pfadsuche (Beam Search) bei Beibehaltung der Soul-Achse [cite: ].
 * Wo war GPT stärker?
   GPT analysierte die methodischen Schwächen der Zielfunktion exakter (Identifikation der Dreifachverwertung der 10s-DPS-Metrik) und vertrat eine wissenschaftlich strengere Haltung bei der Terminologie-Abgrenzung [cite: ].
 * Wo war Claude stärker?
   Claude zeigte ein besseres Verständnis des konkreten Quellcodes, identifizierte die exakten Parameter des Anytime-Workers und machte praxistaugliche Vorschläge, die ohne Verletzung der Projektregeln ("keine erfundenen Spielwerte") umsetzbar sind [cite: ].
 * Wo lagen beide wahrscheinlich falsch oder unvollständig?
   Beide Berichte akzeptierten stumm die praxisfremde Fixierung auf den 40.000-Souls-Endhorizont als primäre Benchmark-Größe und übersahen das Risiko von Goodhart's Law bei der 50/50 Schaden/Survival-Gewichtung.
 * Welche Erkenntnis aus Deep Research gab es in keinem der beiden Berichte?
   Weder MOMA (Multi-Objective Memetic Algorithms) noch hierarchische Graph-Kontraktionen (Contraction Hierarchies für RCSP) wurden von den Berichten als hocheffiziente Alternativen identifiziert [cite: ].
 * Müssen wir die bestehende Architektur neu bauen?
   Nein. Ein Total-Rewrite wäre fachlich verfehlt [cite: ]. Das Fundament für Legalität, Domäne, Caching und exakte Subsolver ist hervorragend aufgebaut [cite: ].
 * Welche Teile sollten definitiv bleiben?
   deadlock-domain.mjs (Legalität), search-core.mjs (exakter Subsolver), validateSearchPath() (Replay), reference-cache.mjs (Modulgraph-Hashing) und die strenge Handhabung von Unknowns [cite: ].
 * Welche Teile müssen geändert werden?
   Die redundante Mehrfachgewichtung der 10s-DPS-Metrik in warden-search.mjs, die stochastische Single-Path-Suche in anytime-search.mjs und die fehlende gegnerische Resistenz in optimizer.mjs [cite: ].
 * Welche Teile sollten erst nach Experimenten entschieden werden?
   Der vollständige Wechsel zu Iterativer Beam Search oder MOMA sowie die finale Gewichtung der Pareto-Selektion.
 * Wie sollte "bester Build" zukünftig exakt definiert werden?
   "Der beste gefundene und legal verifizierte Kaufpfad, der für einen gegebenen Helden unter explizit genannten Modellannahmen (Budget, Meilensteine, Präferenzen und gegnerische Resistenz-Szenarien) die beste Kombination aus Schaden und Effektiver Gesundheit erzielt." [Evidence Level: A]
 * Was wäre langfristig die wissenschaftlich stärkste realistische Aussage?
   "Der berechnete Kaufpfad ist innerhalb des geschlossenen Modells M bezüglich der Zielkriterien Pareto-optimal und besitzt eine nachgewiesene Suboptimalitäts-Lücke von maximal \epsilon\% gegenüber der B&B-Obergrenze im abgedeckten Suchraum." [Evidence Level: B]
ABSCHLUSS
WICHTIGSTE GEMEINSAME ERKENNTNIS VON GPT + CLAUDE:
Das Projekt ist im Kern methodisch sauber aufgebaut, da es über ein exaktes Legalitäts- und Replay-Fundament sowie exakte Subsolver verfügt [cite: ]. Die eigentliche Grenze des Projekts ist derzeit nicht die reine Rechengeschwindigkeit, sondern die unvollständige Modellierung (fehlende Gegnerresistenzen und redundante Metrik-Gewichtungen) [cite: ].
WICHTIGSTER ECHTER UNTERSCHIED:
GPT fordert den Umbau des Systems zu einer mathematischen Kaufpolitik (Policy) auf einem zeit- und einkommensbasierten Markov-Entscheidungsprozess (MDP) [cite: ], während Claude die Erweiterung des bestehenden deterministischen Pfad-Optimierers um Beam Search, Meilenstein-Snapshots und einfache Gegner-Slider empfiehlt [cite: ].
WICHTIGSTE NEUE ERKENNTNIS AUS DEEP RESEARCH:
Die Kombination aus Multi-Objective Memetic Search (MOMA / S-MOGLS) und Resource-Constrained Shortest Path (RCSP) Kontraktionen bietet eine wissenschaftlich bewährte Methodik, um hochgradig nicht-konvexe Pareto-Fronten in diskreten Allokationsräumen effizient und ohne ungeprüfte Einkommens- und Zeitannahmen zu durchsuchen [cite: ].
GRÖSSTER BLINDER FLECK BEIDER BERICHTE:
Beide Berichte akzeptierten unkritisch die Fixierung auf den praxisfremden 40.000-Souls-Endhorizont als maßgebliche Evaluationsebene [cite: ] und übersahen, dass der fest gewichtete Skalarscore durch die Nicht-Berücksichtigung von Utility- und Active-Items anfällig für Goodhart's Law ("Stat-Stuffer-Builds") ist.
EMPFOHLENE ZIELRICHTUNG:
Kein Total-Rewrite, sondern eine gezielte Schichten-Erweiterung: Beibehaltung der exakten Domänen- und Caching-Substruktur, Ersetzung der stochastischen Local Search durch eine Iterative Beam Search mit Dominanzfilterung, Einführung parametrisierter Gegner-Resistenzszenarien sowie Umstellung der Ausgabe auf eine 2D-Pareto-Front (DPS vs. EHP) mit ehrlicher Ausweisung als "best found + legally path-verified" [cite: ].
DIE NÄCHSTEN 3 SCHRITTE:
 * Durchführung eines quantitativen Benchmark-Experiments auf exakt lösbaren Sub-Itemsets zur empirischen Messung des Optimierungs-Gaps des aktuellen Anytime-Workers und der Gier-Referenzkurve [cite: ].
 * Implementierung der Item-Dominanzfilterung im Pre-Processing sowie zuschaltende Aktivierung der hergeleiteten Branch-and-Bound-Schranke als Shadow-Check zur Ermittlung verlässlicher Bounding-Rates [cite: ].
 * Korrektur der redundanten 10s-DPS-Gewichtung in warden-search.mjs und Integration parametrisierter Gegner-Resistenzfaktoren in die Schadensberechnung von optimizer.mjs [cite: ].
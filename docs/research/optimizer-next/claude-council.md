# Claude Council Report — Sidestep Deadlock

> Research artifact. This document is preserved as source material, not as the authoritative project specification.
>
> Source: council-analyse-sidestep-deadlock.pdf
> Repository state discussed: `b0001472fbbcc2c3becc42582043d82caa547e88` on `main`, 2026-09-19.
> Transcribed from the original report for agent-readable Git history.

Council-Analyse: sidestep-deadlock
Ist ein mathematisch bester Deadlock-Build grundsätzlich bestimmbar?
PHASE 0 — Gemeinsame Faktengrundlage
Repository Gaschde/sidestep-deadlock (öffentlich auf GitHub, per git clone geladen)
Branch main
Geprüfter Commit b0001472fbbcc2c3becc42582043d82caa547e88
Commit-Zeitstempel 2026-09-19 03:46:52 +0200
Untersuchungszeitpunkt 2026-09-19
Methode Repo real geklont und im Container gelesen (keine Erinnerungs-Rekonstruktion). Kernbehauptungen aus
README/AGENTS/ docs/search_specification.md wurden gegen den tatsächlichen Quellcode gegengeprüft.
Vollständig gelesen: README.md , AGENTS.md , package.json , docs/search_specification.md ,
docs/reference_branch_bound_review.md , debatte/README.md , debatte/methodik-review.json , app/search-core.mjs ,
app/deadlock-domain.mjs , app/search-config.mjs , app/optimizer-worker.mjs , app/warden-search.mjs , app/anytime-search.mjs (Kernlogik vollständig, Randbereich per Ausschnitt).
Per gezieltem Grep/Ausschnitt geprüft: app/optimizer.mjs (Resistenz-Stacking, EHP-Formel, Fensterschaden),
app/app.js (Worker-Aufruf, Modus „anytime"), Testanzahl in tests/*.mjs , Commit-Historie (48 Commits),
Datenstruktur unter data/core/ und data/heroes/ .
Nicht im Detail gelesen (Existenz/Import bestätigt, Innenleben nicht verifiziert): app/direct-reference.mjs ,
app/reference-search.mjs , app/reference-cache.mjs , app/trajectory-objectives.mjs , app/validate-search-path.mjs ,
app/small-domain.mjs , app/capabilities.mjs , engine/*.py , tools/*.py , docs/engine.md , docs/schemas/* ,
docs/prompts/* , Inhalte in docs/research/ .
A. Verifizierte Fakten (direkt im Code oder durch Ausführungslogik belegt)
Zwei parallele Engines existieren tatsächlich: Python ( engine/ ) und JavaScript ( app/ ), wie in AGENTS.md behauptet.
Der Suchkern in app/search-core.mjs ist ein generischer Multi-Objective-Label-Correcting-Algorithmus mit
Pareto-Dominanzprüfung über futureKey -Äquivalenzklassen — exakt wie in docs/search_specification.md
beschrieben.
Der produktive Browser-Pfad ( app/app.js → worker.postMessage({mode:"anytime", budget: FAST_SEARCH_BUDGET,
...}) → app/optimizer-worker.mjs → runAnytimeCarry in app/anytime-search.mjs ) verwendet nicht den exakten
Label-Correcting-Kern, sondern eine stochastische Greedy-/Local-Search-Heuristik.
FAST_SEARCH_BUDGET = 40000 ist zentral definiert und wird laut Code tatsächlich von Worker, Anfrage und Referenz
gemeinsam genutzt.
Score-Formel exakt verifiziert: score = 0.7·endUtility + 0.15·(1−worstRegret) + 0.15·(1−integratedRegret) ;
innerhalb dessen Damage/Survival 50/50, Fokusgewichte Weapon 70/30, Spirit 30/70, Hybrid 50/50 — Zahlen
stimmen exakt mit README/AGENTS überein.
Resistenz-Stacking ist multiplikativ ( multiplier *= 1 - value/100 ) und referenziert exakt die kanonische Regel RES-002 ( total_resist = 1 - product(1-R_i) ) aus data/core/mechanics.json .
Die stochastische Suche nutzt einen fest kodierten Seed 123456789 , eine Gumbel-Störung mit Faktor 0.002 und
eine 10%-Zufallsaktion — exakt wie dokumentiert.
Der exakte Pareto-Suchkern wird im Produktivmodus nicht für alle 156 Items bei 40k eingesetzt, weil das
nachweislich nicht terminiert: Eine dokumentierte Messung ( docs/search_specification.md , Stand 2026-09-09) zeigt
nach 19 s bereits 4.715.491 generierte Kandidaten, 73.991 expandierte Zustände und einen durch Watchdog
erzwungenen Abbruch ( INCOMPLETE_WATCHDOG ), ohne dass diese Zahl bewiesen vollständig wäre.
Ein fertig hergeleiteter, aber bewusst noch nicht aktivierter Branch-and-Bound-Ansatz mit admissibler
oberer Schranke existiert bereits als eigenständiges Dokument ( docs/reference_branch_bound_review.md ) inklusive
einer expliziten Kosten-Nutzen-Abwägung vor Implementierung.
Ein separates, offline lauffähiges LLM-Debattentool ( debatte/ ) existiert bereits im Repo für Build-Reviews mit vier
Rollen (Pfad-Planer, Gegenprüfer, Pro-Spieler, Skeptischer Auditor) — unabhängig vom eigentlichen Optimizer.
76 test() -Aufrufe in vier JS-Testdateien plus zusätzliche Python-Tests bestätigen die in AGENTS.md genannte Zahl


„75+ Tests" ungefähr.
B. Theoretische/dokumentierte Annahmen (aus Docs übernommen, nicht unabhängig im Code
nachvollzogen)
Die exakte Formel für calculateTrajectoryObjectives (Regret-Integral, Worst Regret) wurde nicht im Detail gelesen;
ihr Verhalten wird nur aus docs/search_specification.md und der Verwendung in warden-search.mjs abgeleitet.
Die formale Äquivalenzbeweis-Passage für direct-reference.mjs („Geltungsbedingungen und
Gleichwertigkeitsbeweis") wurde als Dokumentationstext gelesen, aber die Implementierung selbst nicht codeseitig
nachvollzogen.
Die konkrete Messung „318 von 318 legalen Aktionen vollständig geprüft, keine Verbesserung"
(Warden/Weapon/40k) ist eine im Repository dokumentierte Einzelmessung; sie wurde vom Council nicht durch
eigenen Lauf reproduziert (ein vollständiger 40k-Lauf wäre im Rahmen dieser Analyse nicht praktikabel gewesen).
Aktuelle Spielbalance-Aussagen zu Deadlock (Itemwerte, Meta) wurden nicht über Live-Spieldaten verifiziert; das
Council verlässt sich hier auf die im Repo hinterlegten, als „verifiziert" markierten data/ -Dateien und auf
generelles MOBA-Fachwissen.
C. Offene Punkte
Wie vollständig/aktuell data/core/ und data/heroes/ tatsächlich mit dem Live-Spiel übereinstimmen, kann das
Council nicht unabhängig beurteilen (keine Ingame-Verifikation durchgeführt).
Die tatsächliche Codequalität von engine/ (Python) wurde nicht geprüft; die Analyse fokussiert auf den JS-Browser-Pfad, da dieser laut AGENTS.md der primäre Optimizer ist.
Ob die 22 „nicht öffentlich spielbaren" Helden-Registerzeilen zukünftig relevant werden, ist offen.
Codeuntersuchung: rekonstruierter produktiver Pfad
UI (app/index.html, app/app.js)
→ Klick „Build starten" → new Worker("optimizer-worker.mjs")
→ postMessage({ mode: "anytime", budget: FAST_SEARCH_BUDGET=40000,
heroId, damageFocus, data, itemIds: alle 156 Items })
→ app/optimizer-worker.mjs: runAnytimeCarry(...)
→ app/deadlock-domain.mjs: createDeadlockDomain()
Zustand = { earnedSouls, cash, inventory[], unlockedSlots, events, snapshots }
Transitionen = { save(+1 Soul), purchase, upgrade, sell, replace }
→ app/anytime-search.mjs: runAnytimeCarry()
1. Seed-Rollouts (End-Zielitems + Komponenten, gierig)
2. Greedy-Rollouts mit Gumbel-Störung (0.002) + 10% Zufallsaktion,
Suffix-Varianten ab Präfixen des bisher besten Pfads
3. lokale Verfeinerung (refineCurrentWinner) nach erstem Nicht-Seed-Rollout
4. Terminal-Audit: vollständige 1-Schritt-Nachbarschaft des Endzustands
(kauf/upgrade/replace) wird exakt durchprobiert
→ app/warden-search.mjs: evaluateCarryPerformance()
→ app/optimizer.mjs: evaluateCarryScenarios()
Waffenschaden, Fähigkeitsschaden, Afterburn-Proc, EHP,
Resistenz-Multiplikation (RES-002), 5 Zeitfenster
→ app/anytime-search.mjs: scoreAnytimePath()
70% Endnutzen / 15% Worst Regret / 15% Integrated Regret,
Damage/Survival 50/50, Fokusmischung 70-30 / 30-70 / 50-50
→ app/validate-search-path.mjs: Kaufpfad erneut legal abgespielt
← postMessage({ type: "incumbent" / "progress" / "anytime-complete" })
→ UI zeigt Build, Kaufpfad, Telemetrie, Warnungen
Parallel existierender Diagnosepfad (nicht der Standardknopf): derselbe Worker unterstützt ohne mode:"anytime"
einen zweiten Modus, der runWardenCarryPareto (exakter Label-Correcting-Kern + direct-reference.mjs ) aufruft.
Dieser ist laut Doku für kleinere Itemmengen/Diagnosen gedacht, nicht für die volle 40k/156-Item-Suche, weil dort
nachweislich keine Terminierung im Sekundenbereich erreicht wird.
Legacy/experimentell: app/small-domain.mjs und Teile von app/optimizer.mjs scheinen ältere/kleinere Testwelten
für Regressionsvergleiche zu sein (laut Doku: „separat formulierte kleine Kauf-/Verkaufswelt … vollständige
Enumeration"). debatte/ ist ein komplett separates Werkzeug (LLM-Debatte über einen vorgegebenen
Buildausschnitt) und kein Teil der eigentlichen Optimierungs-Pipeline.
Modellprüfung — zentrale Befunde


Kategorie Modelliert? Befund
Itemkosten, Slots,
Kauf/Verkauf/Ersetzen/Upgrade
Ja Vollständig in deadlock-domain.mjs ; Sellback < 1, Ancestor-Konflikte (kein gleichzeitiges
Halten von Item + Upgrade-Vorfahre), Active-Item-Limit
Soul-/Budgetachse Ja, aber als
Modellannahme
Jeder Ganzzahlwert 0…Budget ist ein Entscheidungspunkt — kein zeitliches
Einkommensmodell, keine Soul/Sekunde-Kopplung
Waffen-/Spirit-Schaden, 5
Zeitfenster
Ja Sustained (60s), Lane-Trade/Farm (10s), Skirmish (4s), Teamfight (10s)
Resistenz Ja, multiplikativ Entspricht kanonischer Regel RES-002
Survivability (EHP) Ja, teilweise Nur permanente Regeneration + Bullet-Lifesteal im 10s-Fenster; aktive Heilitems/Cooldown-Heilung ausgeschlossen
Skilllevel/Ability-Reihenfolge Nein Explizit ausgeschlossen; „unbekannter Level-/Skillzustand"
Trefferchance/Headshot/Falloff Nein Explizit als Lücke benannt
Proc-Uptime (außer belegten
Triggern)
Nein Nur Afterburn mit dokumentiertem Trigger; alles andere zählt mit 0
Gegnerzustand/-items Nein Kein Gegnermodell überhaupt — Bewertung ist ein reines 1-Spieler-Optimierungsproblem
Team/Objectives/Map-Zustand Nein Nicht Teil des State
Power-Spike-Zeitpunkte relativ
zum Gegner
Nein Nur die eigene Trajektorie über Souls, kein Zeit-Wettlauf gegen Gegnerkurve
Zeit als expliziter Zustand Nein Achse ist earnedSouls , nicht Sekunden; „keine implizite lineare Interpolation"
Referenzkurve (für Regret) Approximation Bis zu 2s gierig gesampelt, kein bewiesenes Optimum — Regret ist relativ zu einer
Heuristik, nicht zur Wahrheit
Globale Suchvollständigkeit bei
40k/156 Items
Nein,
nachweislich
nicht
Kombinatorische Explosion dokumentiert (Millionen Kandidaten in Sekunden, kein Abschluss)
Wichtigste implizit konstant gehaltene Variablen: Gegnerverhalten, Skilllevel, Trefferquote, Positionierung,
Marktpreiskonstanz der Items (keine Rabatte/Boni aus Kills), Zeit-Souls-Kopplung.
Kurzer Blick in etablierte Methodik (Fachwissen, keine gezielte
Literaturrecherche durchgeführt — allgemein bekannte OR/CS-Grundlagen,
keine erfundenen Quellen)
Multiobjective Label-Correcting/Label-Setting-Suche (à la Martins' Multicriteria-Shortest-Path-Verfahren) ist
der korrekte, etablierte Ansatz für exakte Pareto-Fronten in Graphen mit mehreren Zielgrößen — genau das, was
search-core.mjs implementiert. Ihr bekanntes Problem ist exponentielles Wachstum der nicht-dominierten
Labelmenge bei wachsender Dimensionalität und Zustandsraumgröße — exakt das Symptom, das die 40k/156-
Item-Messung zeigt.
Branch-and-Bound mit admissiblen (nie unterschätzenden) oberen Schranken ist Standard, um solche Räume
exakt, aber ohne vollständige Enumeration zu durchsuchen. Das im Repo skizzierte Vorgehen (additive
Obergrenzen aus den k größten Beiträgen, log-Transformation für multiplikative Resistenz) ist mathematisch
korrekt hergeleitet und methodisch sauber (Shadow-Check vor Aktivierung).
Anytime-Algorithmen (Zilberstein u. a.) liefern zu jedem Zeitpunkt eine gültige, sich verbessernde Lösung ohne
Optimalitätsgarantie — das ist exakt die Klasse, in die runAnytimeCarry fällt. Das ist keine Schwäche per se,
sondern eine bewusste, korrekt benannte Kategorie.
Robuste/verteilungsfreie Optimierung unter Unsicherheit (Worst-Case- bzw. Minimax-Ansätze) ist die
etablierte Antwort auf unbekannten Gegnerzustand — im Projekt bislang nicht vorhanden, da es überhaupt kein
Gegnermodell gibt.
Pareto-Optimierung ist die korrekte Antwort auf mehrere nicht kommensurable Ziele (Schaden vs. Überleben);
das Projekt nutzt sie im Diagnosepfad, ersetzt sie aber im Produktivpfad bewusst durch eine gewichtete
Skalarisierung.
PHASE 1 — Sieben unabhängige Erstpositionen


Jede Position wurde ohne Kenntnis der anderen sechs formuliert (streng simulierte Unabhängigkeit).
1. Mathematiker
A. Nur unter einer vorab fixierten, endlichen Definition — nicht im offenen, spielrealistischen Sinn. B. „Bester Build" ist
nur sinnvoll relativ zu: festem Held, festem Budget, fixem Skalarisierungsschema (oder Pareto-Front), fixem
Referenzmodell des Gegners (hier: keinem), fixem Horizont. C. Exakt bestimmbar: das Maximum einer
additiven/multiplikativen Zielfunktion über einen endlichen, explizit gegebenen Kandidatenraum (z. B. die kleinen
Diagnose-Slices mit vollständiger Enumeration) — dort ist Optimalität ein reiner Suchvollständigkeitsnachweis, kein
offenes Problem. D. Approximierbar: alles, was von einer stochastischen Referenz, einem heuristischen Suchabbruch
oder unbewiesenen Grenzen (Gitterreduktion, Sellback-Grenzen) abhängt. E. Prinzipiell nicht allgemein bestimmbar:
ein „bester Build" ohne festgelegtes Gegner-/Unsicherheitsmodell, weil das Problem dann kein wohldefiniertes
Optimierungsproblem mehr ist, sondern ein Spiel mit unbestimmtem Gegenspieler (spieltheoretisch unterbestimmt).
F. Die Architektur (Zustand, Transitionen, Label-Dominanz) ist strukturell richtig für ein Ressourcenallokationsproblem
mit Kaufpfaden. Die Wahl, im Produktivmodus von exakter Pareto-Suche auf gewichtete Skalarisierung zu wechseln, ist
mathematisch eine grundlegend andere Problemklasse, nicht nur eine Beschleunigung. G. Der generische Label-Correcting-Kern ( search-core.mjs ) ist sauber: korrekte Dominanzdefinition, korrekte Trennung von
stateKey / futureKey , endliche Terminierungsbedingung explizit bewiesen ( cash + Summe(total_cost) = earnedSouls −
Verkaufsverluste , streng monoton bei Verkäufen). H. Die 70/15/15- und 50/50-Gewichte sind normative, nicht
abgeleitete Setzungen. Eine Skalarisierung mit fixen Gewichten kann Pareto-optimale Punkte systematisch
verdecken (bekanntes Ergebnis: gewichtete Summen erreichen nur konvexe Teile der Pareto-Front). I. Die
Referenzberechnung (2s gieriger Sample) müsste durch eine bewiesene obere Schranke ersetzt werden, damit
„Regret" tatsächlich Regret gegenüber einer verifizierten Grenze ist und nicht gegenüber einer weiteren Heuristik. J.
Ich würde das Ganzzahl-Zustandsmodell behalten, aber die Zielfunktion als Vektor führen (kein Skalar) und erst am
Ende — mit explizit gewählter Nutzerpräferenz — projizieren; zusätzlich die im Repo bereits skizzierte Branch-and-Bound-Schranke umsetzen, um wenigstens einen bewiesenen Suchraum-Ausschnitt exakt zu lösen. K. Am
schwierigsten zu rechtfertigen: dass der Endscore mit „bester geprüfter Build" kommuniziert wird, während die
zugrunde liegende Referenz selbst nur eine Heuristik ist — der Regret-Wert hat dann keine bewiesene Fehlerschranke.
L. Der admissible Branch-and-Bound (bereits skizziert in docs/reference_branch_bound_review.md ) als Shadow-Check zu
aktivieren und gegen die volle 40k/156-Item-Suche laufen zu lassen, würde zum ersten Mal eine bewiesene Lücke
zwischen „gefunden" und „exakt optimal in diesem Suchraum" liefern. Codebelege: app/search-core.mjs Z.6–13
(Dominanz), Z.41–43 (Terminierungslogik in docs/search_specification.md ); docs/reference_branch_bound_review.md
gesamt. Theoretische Belege: Multicriteria-Shortest-Path-Theorie (Label-Correcting), Skalarisierungstheorie in Multi-Objective-Optimierung (konvexe Hülle). Wichtigste Annahmen: dass „optimal" für den Nutzer relativ zu einem
festen Modell akzeptabel ist. Mögliches Gegenbeispiel: zwei Builds mit identischem Skalarscore, aber einer
dominiert im Schaden, der andere im Überleben — die Skalarisierung kann das nicht unterscheiden. Confidence: 78
%. Größte Unsicherheit: ob eine vollständige Vektor-Pareto-Ausgabe im Browser noch UX-praktikabel wäre.
2. Algorithmus-Experte
A. Ja, für einen explizit begrenzten Suchraum; nein für den vollen 156-Item/40k-Raum in praktikabler Zeit. B. „Bester
tatsächlich vollständig durchsuchter Build" innerhalb Zeit-/Speicherbudget. C. Exakt: kleine Item-Teilmengen (wie in
den Tests), da vollständige Enumeration nachweislich terminiert. D. Approximierbar: die volle Itemmenge über Beam
Search, Branch-and-Bound mit Schranken, oder — wie aktuell — Greedy+Rollouts. E. Nicht allgemein bestimmbar
ohne State-Space-Reduktion: das Problem ist strukturell ein kombinatorisches Rucksack-/Pfadproblem mit exponentiell
vielen Kaufreihenfolgen: 156 Items, beliebige Kauf-/Verkaufs-/Ersetzreihenfolgen bei jedem Ganzzahlpunkt — das ist
im schlimmsten Fall PSPACE-artig groß, praktisch NP-schwer im Umfang der Zustände. F. Ja, im Grundsatz richtig:
Label-Correcting für die exakte Diagnose, stochastische Anytime-Suche für die Produktion ist eine vernünftige
Aufteilung „exakt für klein, approximativ für groß". Das ist ein Standardmuster. G. Der stärkste Teil ist der Terminal-Audit: eine vollständige 1-Schritt-Nachbarschaftsprüfung nach der stochastischen Phase ist eine reale, wenn auch
begrenzte, lokale Optimalitätsgarantie (kein Nachbar verbessert den Score). H. Größter Schwachpunkt: die Suche ist
reine First-Choice-Hill-Climbing mit Perturbation, kein Beam Search, kein systematisches Backtracking über
mehrere Pfade gleichzeitig; sie kann in schlechten lokalen Optima stecken bleiben, besonders bei Items mit stark
nichtlinearen Schwelleneffekten (Kategorie-Investment-Boni). I. Ein Beam Search mit Breite k über die
vielversprechendsten Präfixe (statt Einzelpfad + Rollouts) würde bei ähnlichem Zeitbudget robustere Ergebnisse
liefern und ließe sich mit den vorhandenen Bausteinen (Domain, Scoring) direkt kombinieren. J. Ich würde: (1) Beam
Search statt Single-Path-Hillclimbing, (2) die admissible Schranke aus dem B&B-Dokument als Pruning in einer exakten
Phase für kleine Sub-Item-Mengen aktivieren, (3) State-Space-Reduktion über dominierte Items (ein Item, das in jeder


Dimension von einem anderen bei gleichem Preis dominiert wird, kann sicher entfernt werden) vor der Suche. K. Am
schwierigsten zu rechtfertigen: dass die veröffentlichte Telemetrie „vollständige Kaufpfade" zählt, aber keine Aussage
über die Qualität im Vergleich zum global besten Pfad trifft — Nutzer könnten „completedPaths: 40" als Qualitätssignal
fehlinterpretieren. L. Item-Dominanzfilterung vor der Suche (strikt dominierte Items entfernen) — reduziert den
Suchraum ohne jegliche Qualitätseinbuße und ist ein „kostenloser" erster Schritt vor komplexerem B&B. Codebelege:
app/anytime-search.mjs Z.475–557 (Rollout-Loop), Z.564–608 (Terminal-Audit). Theoretische Belege: Beam
Search/Anytime-Algorithmen-Literatur; Dominanzfilterung in Rucksackproblemen. Annahmen: dass 25 s Worker-Budget die harte Grenze bleibt. Gegenbeispiel: bei stark schwellenwertgetriebenen Items (z. B. Kategorie-Investmentboni bei bestimmten Summen) kann Greedy+kleine Perturbation den Sprung über eine Schwelle
systematisch verpassen, weil Zwischenstände vor der Schwelle schlechter bewertet werden als Alternativpfade, die die
Schwelle nie erreichen. Confidence: 74 %. Unsicherheit: tatsächliche empirische Häufigkeit von „stuck in lokalem
Optimum" ist nicht gemessen.
3. Genie / First-Principles-Denker
A. Die Frage „gibt es einen besten Build" ist falsch gestellt, solange sie einen Endzustand statt eine Situation-Reaktion-Funktion meint. B. Redefinition: nicht „bester Build", sondern „beste Kauf-Politik" — eine Funktion von
(Souls, Zeit, Gegnerzustand, eigener Zustand) → nächste Kaufentscheidung. Ein statischer Build ist nur ein Sonderfall
dieser Politik bei einem einzigen, isolierten Betrachtungspunkt. C. Exakt bestimmbar: die beste Politik für eine
vollständig spezifizierte Markov-Entscheidungswelt (Zustände, Übergänge, Belohnungen alle bekannt) — Bellman-Optimalität ist dann wohldefiniert. D. Approximierbar: alles, sobald Gegnerverhalten, Skill-Timing oder
Trefferwahrscheinlichkeit ins Spiel kommen — dort wird es ein stochastisches, teilweise beobachtbares
Entscheidungsproblem. E. Nicht bestimmbar: „der" beste Build unabhängig vom Gegner — das ist wie zu fragen,
welcher Schachzug „objektiv am besten" ist, ohne die Stellung zu kennen. Ohne Gegnerzustand ist die Frage
kategorial falsch gestellt, nicht nur schwer. F. Grundlegend: Wenn wir heute bei null anfingen mit diesem Wissen —
nein, wir würden nicht zuerst einen Endzustands-Optimizer bauen, sondern zuerst fragen: „Was ist die kleinste Menge
an Zustandsvariablen, ohne die die Frage 'bester Build' bedeutungslos wird?" Antwort: mindestens Zeit/Power-Spike-Fenster und ein grobes Gegner-Ressourcenmodell. Das Projekt hat implizit die Endzustands-Frage vor die Politik-Frage gestellt. G. Bemerkenswert stark: die Ehrlichkeit der Terminologie („bester geprüfter Build" statt „optimal") ist
genau die First-Principles-Haltung, die man von einem guten Wissenschaftler erwartet — das Projekt lügt sich selbst
nicht in die Tasche. H. Größte Lücke: Ein Build wird gegen eine abstrakte, unveränderliche Welt bewertet.
Deadlock ist aber ein Spiel mit einem denkenden Gegner, der auf denselben Build reagiert (Counter-Items kaufen). Ein
„bester Build gegen niemanden" ist ein Kategorienfehler. I. Fundamental neu bauen müsste man die Zielfunktion
selbst: von „maximiere Skalarwert eines isolierten Builds" zu „minimiere Worst-Case-Verlust gegenüber einer Menge
plausibler Gegnerprofile" (Robust-/Minimax-Optimierung). J. Ich würde zuerst 3–5 archetypische Gegner-Ressourcenprofile (schwache/starke Bullet-Resist, schwache/starke Spirit-Resist, Burst-Killer) definieren und jeden
Build gegen alle rechnen lassen — das ist billiger als es klingt, weil die EHP-Formel bereits pro Resistenztyp getrennt
ist. K. Am schwersten zu rechtfertigen: der Name „Sidestep" impliziert reaktive, situative Cleverness — die aktuelle
Architektur ist aber komplett proaktiv/statisch und reagiert auf nichts. L. Ein einziges robustes Gegner-Sensitivitätsmaß (z. B. „Score bei +30% gegnerischer Bullet-Resistenz") würde den größten Erkenntnisgewinn pro
Implementierungsaufwand liefern. Codebelege: README-Abschnitt „Nicht modelliert als Score"; kompletter Mangel
an enemy / opponent in deadlock-domain.mjs -Zustand. Theoretische Belege: Markov-Entscheidungsprozesse,
Minimax-Regret in Entscheidungstheorie unter Unsicherheit. Annahmen: dass Gegnerdaten überhaupt modellierbar
sind, ohne kanonische Werte zu erfinden — das ist selbst fraglich. Gegenbeispiel: ein reiner Spirit-Build kann laut
Modell optimal sein, verliert aber real gegen einen Gegner mit hoher Spirit-Resistenz — das Modell kann diesen Fall
nicht einmal ausdrücken. Confidence: 70 %. Unsicherheit: ob genug verifizierte Gegner-Itemdaten für auch nur
grobe Szenarien vorliegen, ohne AGENTS.md-Regel „keine erfundenen Spielwerte" zu verletzen.
4. Deadlock-Profi
A. Ein „bester Build" im Sinne einer festen Itemliste existiert in der Praxis so gut wie nie — erfahrene Spieler denken in
Kaufprioritäten und Anpassungsfenstern, nicht in Endinventaren. B. Realistische Definition: „bester Standardpfad bei
durchschnittlichem Spielverlauf, mit klar benannten situativen Abzweigungen". C. Exakt bestimmbar: reine
Zahlenverhältnisse bei fixem Gegner-Nullzustand (z. B. „welches Item gibt pro Soul mehr Sustained DPS" bei sonst
identischem Build) — das ist im Kern eine Bruchrechnung, keine Optimierung. D. Approximierbar: Gesamtscore über
ein ganzes Spiel, weil Trefferquote, Cooldown-Nutzung und Gegner-Reaktion stark spielerabhängig sind. E. Nicht
bestimmbar: „richtiges" Timing von Team-Items (Rescue Beam, Repulsor) — das hängt zu 90% von Teamkoordination
ab, nicht vom eigenen Build. F. Im Kern richtig für das, was es zu sein behauptet (ein Endinventar-Rechner), aber es


fehlt der wichtigste praktische Faktor: Power-Spike-Reihenfolge. Ein Build, der bei 40.000 Souls optimal ist, sagt
nichts darüber, ob er bei 6.000 Souls (dem Zeitpunkt der ersten Laning-Duelle) überhaupt konkurrenzfähig ist. G.
Stärkster Teil: die explizite Trennung von Weapon/Spirit/Hybrid-Fokus mit unterschiedlichen Bullet/Spirit-Gewichten
trifft eine reale, für erfahrene Spieler nachvollziehbare Unterscheidung. H. Größte Schwäche: Fünf Zeitfenster
(60s/10s/10s/4s/10s) sind zwar mehr als ein einziger Score, bilden aber immer noch kein echtes Laning-Fenster
(typischerweise die ersten 1–3 Minuten, in denen 1v1-Trades über den Spielausgang mitentscheiden) und keinen
echten Gegnerzustand ab. I. Es müsste ein „Zwischenbudget-Snapshot"-Konzept geben: wie gut ist der vom Optimizer
vorgeschlagene Kaufpfad bei typischen Meilensteinen (z. B. 2.500/6.000/12.000 Souls), nicht nur am Ende bei 40.000.
J. Ich würde den Kaufpfad selbst (nicht nur das Endinventar) als primäres Bewertungsobjekt behandeln und an 3–4
realistischen Zwischen-Souls-Marken separat validieren lassen (das Datenmodell mit snapshots erlaubt das technisch
bereits). K. Am schwierigsten zu rechtfertigen: die implizite Botschaft „bei 40.000 Souls ist das der beste Build" — die
allermeisten Spiele enden nie bei 40.000 Souls; die relevanten Entscheidungen liegen bei 2.000–15.000. L. Die
Kaufpfad-Zwischenbewertung an 2–3 realistischen Meilensteinen statt nur am Horizont wäre der größte praktische
Hebel, ohne die Architektur zu ändern. Codebelege: README „0–40.000-Souls-Testszenario"; ANYTIME_METRIC_GROUPS
mit 60s/10s/4s-Fenstern, aber kein „early game"-Fenster unter 4 s. Theoretische Belege: allgemeines MOBA-Erfahrungswissen zu Power-Spikes (nicht spezifisch für Deadlock recherchiert — als Heuristik markiert). Unsicherheit
ausdrücklich markiert: genaue aktuelle Deadlock-Patch-Werte (Itemkosten, Cooldowns zum Stand 2026-09) wurden
vom Council nicht gegen die Live-Spielversion verifiziert, nur gegen die repo-internen data/ -Dateien. Confidence: 65
% (niedriger, weil Live-Spielverifikation fehlt). Unsicherheit: ob der 08-22-2026-Patchstand in
data/core/manifest.json noch aktuell ist.
5. MOBA-Profi
A. Nein — in jedem MOBA mit Gegner-Counterplay ist „der" beste Build eine Illusion; es gibt bestenfalls „am wenigsten
schlecht gegen die wahrscheinlichste Gegnerverteilung". B. Definition: „Build mit höchstem erwarteten Wert über eine
realistische Verteilung von Gegner-Builds und Spielverläufen" — nicht Einzelfall-Maximum. C. Exakt: reine
Ressourceneffizienz-Verhältnisse (Souls pro DPS-Punkt) bei fixierten Annahmen. D. Approximierbar: Meta-Stärke über
viele Spiele (Winrate-Statistik) — das ist der übliche MOBA-Weg, ist hier aber nicht vorhanden, weil das Projekt keine
Matchdaten nutzt, nur theoretische Formeln. E. Nicht bestimmbar: „Snowball"-Effekte (ein früher kleiner Vorteil wird
durch Vorsprung bei Objectives/Leveln zu einem großen Vorteil) — das ist pfadabhängig und nicht aus einem einzelnen
Endbuild ableitbar. F. Der Kernfehler klassischer Build-Optimizer in MOBAs, den ich aus anderen Spielen kenne, ist
Gold-Effizienz ohne Opportunity Cost zu verwechseln mit Sieg-Wahrscheinlichkeit. Sidestep vermeidet den
naiven Fehler „teuerstes Item = bestes Item" bereits explizit (Regret-Integral bestraft ineffiziente Zwischenpfade) —
das ist überdurchschnittlich gut für ein Hobby-Projekt. G. Stärkster Teil: die explizite Bestrafung von Verlust-Trades
(Regret-Integral über den ganzen Verlauf, nicht nur Endpunkt) — verhindert den klassischen Fehler, nur auf das 40k-Endinventar zu optimieren und dabei einen Spieler zu produzieren, der bei 8.000 Souls nackt dasteht. H. Größte
Schwäche aus MOBA-Sicht: kein Meta-/Team-Kontext. In jedem MOBA hängt „bester Build" stark von
Teamzusammensetzung ab (braucht das Team mehr Crowd-Control? Mehr Poke? Mehr Frontline?) — das Modell ist
strikt 1-Spieler. I. Nicht fundamental neu bauen, aber ergänzen: ein optionaler Team-Kontext-Modifier (z. B. „Team hat
bereits genug Tank → Gewicht auf Damage erhöhen") wäre eine leichte, sinnvolle Erweiterung, kein Umbau. J. Ich
würde die Regret-basierte Trajektorienbewertung beibehalten (sie ist methodisch überdurchschnittlich), aber
zusätzlich eine einfache Sensitivitätsanalyse einbauen: „wie stark ändert sich der Score, wenn der Gegner 20% mehr
Bullet-Resistenz hat" — kein volles Gegnermodell, aber ein erster Schritt zu Robustheit. K. Am schwierigsten zu
rechtfertigen: dass zwei Builds mit identischem 70/15/15-Score als „gleich gut" behandelt werden (nur nach
Transaktionszahl getrennt), obwohl sie in der Praxis sehr unterschiedliche Risikoprofile haben können (ein Build könnte
fragiler gegenüber Gegner-Varianz sein als der andere). L. Eine einzige zusätzliche robuste Sensitivitätskennzahl
(Score-Varianz über plausible Gegner-Resistenzspannen) hätte das beste Aufwand-Nutzen-Verhältnis. Codebelege:
scoreAnytimePath Regret-Integral-Logik; ANYTIME_METRIC_GROUPS . Theoretische Belege: allgemeine MOBA-Buildtheorie (Opportunity Cost, Snowball) — aus Fachwissen, nicht Deadlock-spezifisch recherchiert. Confidence: 72
%. Unsicherheit: wie stark Snowball-Effekte in Deadlock spezifisch (vs. Dota/LoL) ausgeprägt sind, wurde nicht
recherchiert.
6. Skeptiker / Falsifier
Aufgabe: das Projektprinzip zu widerlegen versuchen.
A. Nein — und zwar nicht nur praktisch, sondern strukturell: „bester Build" ohne Gegnermodell ist kein
wohldefiniertes Optimierungsproblem, sondern die Optimierung eines Proxys. B. Es gibt in diesem Repository de facto
keine Definition von „bester Build" im spielentscheidenden Sinn (Sieg-Wahrscheinlichkeit), sondern nur eine Definition


von „bestes gewichtetes Schaden/Überlebens-Verhältnis gegen ein unveränderliches Nichts". C. Exakt bestimmbar ist
ausschließlich: das Maximum einer vollständig spezifizierten, endlichen Formel über eine vollständig enumerierte,
kleine Kandidatenmenge. Sobald „alle 156 Items bei 40k" behauptet wird, ist das nachweislich (siehe Messung) nicht
mehr exakt, sondern eine unvollständige Heuristik, die sich als „bester geprüfter Build" tarnt. D–E. Wie oben — aber
ich betone: die Grenze zwischen „approximiert" und „prinzipiell unbestimmbar" wird im Projekt selbst korrekt gezogen
(README: „does not yet jointly optimize …"). Das ist ungewöhnlich ehrlich für ein Optimierungsprojekt. F. Die
Architektur ist für das, was sie explizit behauptet zu sein (best evaluated build unter definierten Bedingungen), im
Kern korrekt. Sie ist falsch, wenn man sie — wie die zentrale Forschungsfrage dieses Councils nahelegt — als Weg zu
einem allgemeinen „mathematisch besten Build" liest. Das Projekt selbst widerspricht dieser Lesart bereits im
README. G. — (nicht meine Aufgabe, Stärken zu suchen) — H. Die größte verdeckte Annahme: metricValue -Fallback
in anytime-search.mjs (Zeile 35–41) verwendet bei fehlenden Komponentenmetriken den aggregierten Elternwert als
Fallback — das ist eine stille Approximation innerhalb der „exakten" Buchhaltung, die in Randfällen (kleine
Testreferenzen ohne Komponentenaufschlüsselung) zu einer leicht verzerrten Fokus-Neutralität führen kann. Kein
Beweis eines Fehlers, aber ein Ort, an dem Stille Näherung passiert, ohne im Ergebnis als Warnung zu erscheinen. I.
Ja: die komplette Trennung von „Gegner existiert nicht" müsste fallen, wenn das Projekt jemals den Anspruch „bester
Build" statt „bester geprüfter Endzustand gegen ein Vakuum" erheben will. J. — (nicht meine Aufgabe) — K. Am
schwersten zu rechtfertigen: dass ein Score, der auf einer selbst nur approximierten Referenz beruht (2-Sekunden-Sample), in der UI möglicherweise als einzelne Kandidat-Empfehlung erscheint, ohne dass die Referenz-Unsicherheit
dem Nutzer numerisch mitgeteilt wird (nur regret relativ zur Heuristik, nicht ein Konfidenzintervall). L. Eine sichtbare,
numerische Fehlerschranke der Referenz selbst (z. B. „Referenz kann um bis zu X% zu niedrig sein") würde das
Ehrlichkeitsniveau des Projekts, das bereits hoch ist, noch konsistenter machen. Codebelege:
docs/search_specification.md Messung 2026-09-09 (INCOMPLETE_WATCHDOG); app/anytime-search.mjs Z.35–41
(Fallback). Stärkstes Gegenbeispiel: siehe Phase 6. Confidence: 85 % (dass die zentrale Forschungsfrage in ihrer
starken Form „Nein" lautet). Unsicherheit: ob eine schwächere Interpretation („bester Build unter festen, genannten
Annahmen") vom Nutzer akzeptiert würde.
7. Praktiker / System Engineer
A. Für ein Produkt: nein, und man sollte es auch nicht versuchen — man sollte „bester geprüfter, transparent
begründeter Build in nützlicher Zeit" liefern. B. Definition, die ich für ein Produkt akzeptieren würde: reproduzierbarer,
in begrenzter Zeit gefundener, gegen lokale Alternativen geprüfter Build mit klar kommunizierten Annahmen. C.
Exakt: alles, was schon deterministisch und getestet ist (Kostenrechnung, Legalitätsprüfung, Resistenz-Stacking) —
das ist Ingenieurarbeit, kein offenes Forschungsproblem. D. Approximierbar: die Suche selbst, mit klar kommunizierter
Zeit-/Qualitäts-Abwägung. E. Nicht sinnvoll global optimierbar im Produktkontext: alles, was Live-Spieldaten
(Gegner, Team) bräuchte, die die App zum Anfragezeitpunkt gar nicht hat. F. Im Grundsatz ja — Web Worker +
IndexedDB-Cache + deterministische Domäne ist eine solide, wartbare Architektur für ein Browser-Tool. Zwei parallele
Engines (Python + JS) sind hingegen ein Wartungsrisiko: Logik muss zweimal korrekt gehalten werden. G. Stärkster
Teil aus Engineering-Sicht: der Cache-Schlüssel ( SHA-256 über Modellversion, Daten, Itemmenge, Metrikdefinition
und den transitiven Modulgraphen) — das ist ungewöhnlich robuste Invalidierung, verhindert stille Inkonsistenzen
zwischen Code-Änderung und gecachter Referenz. H. Größte Schwäche: Fehlende Nutzerkommunikation der
Unsicherheit in der UI (laut Beschreibung zeigt die Oberfläche „derzeit nur den gewählten Pfad, keine … vollständige
Marginalnutzen-Ausgabe" laut methodik-review.json — Hinweis auf eine ältere Projektphase, aktueller UI-Stand nicht
im Detail geprüft). I. Die Python/JS-Doppel-Engine sollte mittelfristig konsolidiert werden (eine Quelle der Wahrheit für
Berechnung), sonst drohen Divergenzen bei zukünftigen Balance-Patches. J. Ich würde: (1) Telemetrie (Regret,
Suchvollständigkeit, Referenz-Unsicherheit) prominent in der UI zeigen statt nur im Objekt, (2) eine klare Timeout-
/Qualitätsanzeige („Suche zu X% des Zeitbudgets abgeschlossen, Y Alternativen geprüft"), (3) die zwei Engines auf
einen gemeinsamen Berechnungskern zusammenführen oder zumindest cross-testen. K. Am schwierigsten in der
Praxis zu rechtfertigen: 25 Sekunden Rechenzeit im Browser bei jedem Aufruf ohne progressive Zwischenanzeige wäre
für viele Nutzer ein UX-Problem (Telemetrie/ onProgress existiert zwar im Code, ob sie sichtbar genutzt wird, wurde
nicht im UI-Detail geprüft). L. Sichtbare, laufende Zwischenergebnisse + eine einzige klar sichtbare „Wie sicher ist
das?"-Kennzahl in der UI wäre der Hebel mit dem besten Aufwand/Nutzen-Verhältnis für den Produktwert (nicht für die
mathematische Aussagekraft). Codebelege: docs/search_specification.md „SHA-256-Schlüssel … transitiver …
Modulgraph"; AGENTS.md „Zwei parallele Engines". Confidence: 80 % (für Engineering-Aussagen, für die dies mein
Fachgebiet ist). Unsicherheit: aktueller UI-Detailstand von app/app.js / index.html wurde nicht vollständig gelesen.
PHASE 2 — Erste Präsentation: Muster über alle sieben Positionen


Breite Übereinstimmung (6–7/7):
Ein im starken, offenen Sinn „mathematisch bester Build" ist nicht bestimmbar, solange kein Gegnermodell
existiert (Mathematiker, Genie, Deadlock-Profi, MOBA-Profi, Skeptiker, Praktiker — 6/7 explizit, Algorithmus-Experte
implizit über „E").
Für fest definierte, kleine Teilprobleme ist exakte Optimalität dagegen tatsächlich erreichbar und im Repo
bereits nachgewiesen (7/7 — niemand bestreitet das).
Die Projektterminologie „bester geprüfter Build" statt „optimal" wird von allen sieben als methodisch korrekt und
positiv hervorgehoben.
Die größte fehlende Zustandsvariable ist branchenübergreifend derselbe Punkt, nur unterschiedlich benannt: Genie
nennt es „Gegnerzustand als Kategorienfehler", Deadlock-Profi „fehlendes Laning-Fenster", MOBA-Profi „fehlender
Team-Kontext", Skeptiker „Optimierung eines Proxys". Es ist im Kern ein Befund aus vier Blickwinkeln.
Unterschiedliche Ansätze / abweichende Betonung:
Mathematiker und Algorithmus-Experte fokussieren auf Suchvollständigkeit (Branch-and-Bound, Beam Search)
als nächsten Schritt.
Genie und MOBA-Profi fokussieren auf Robustheit gegenüber Unsicherheit (Gegnerprofile, Sensitivität) als
nächsten Schritt.
Deadlock-Profi fokussiert auf Zeit-/Meilenstein-Bewertung statt Endzustand.
Praktiker fokussiert auf UX/Engineering (Sichtbarkeit der Unsicherheit), nicht auf das mathematische Modell
selbst.
Fundamentaler Konflikt:
Mathematiker/Algorithmus-Experte sehen den Weg vorwärts in mehr Exaktheit (bewiesene Schranken) innerhalb
des bestehenden Rahmens. Genie/Skeptiker sehen den Weg vorwärts in einer anderen Zielfunktion
(robust/politikbasiert), bei der zusätzliche Exaktheit im aktuellen Rahmen kaum hilft, weil der Rahmen selbst das
falsche Problem löst. Das ist kein Meinungsunterschied über Details, sondern über die Richtung der nächsten
Investition.
Unterschiedliche Definitionen von „optimal": | Rolle | Optimalitätsbegriff | |---|---| | Mathematiker | global optimal
relativ zu fixiertem Vektorziel | | Algorithmus-Experte | best-in-time unter Zeit-/Speicherbudget, mit bewiesener Lücke
wo möglich | | Genie | optimale Politik, nicht optimaler Endzustand | | Deadlock-Profi | optimal an mehreren
realistischen Zeitmarken, nicht nur am Horizont | | MOBA-Profi | höchster Erwartungswert über eine Gegnerverteilung |
| Skeptiker | lehnt den Begriff für das Gesamtproblem ab, akzeptiert ihn nur für Teilprobleme | | Praktiker | „gut genug,
schnell, transparent, reproduzierbar" |
PHASE 3 — Cross-Review
Mathematiker → Algorithmus-Experte: Stark: die Diagnose „Hillclimbing kann bei Schwelleneffekten
steckenbleiben" ist präzise und mit Codebeleg (Kategorie-Investment-Boni) plausibel. Schwach/unvollständig: es fehlt
eine quantitative Abschätzung, wie oft das in der Praxis passiert — ohne Messung bleibt es eine plausible Hypothese.
Zu prüfende Annahme: dass Beam Search bei gleichem Zeitbudget tatsächlich mehr Coverage liefert als mehr Rollouts
mit dem bestehenden Ansatz. Gegenbeweis: keiner vorhanden, nur fehlende Empirie. Ändert meine Position: nein,
bestärkt sie eher.
Mathematiker → Deadlock-Profi: Stark: der Punkt „40.000 Souls wird selten erreicht" ist ein reales, in der
Formalisierung bisher unsichtbares Problem — der Horizont selbst ist eine unbegründete Setzung. Schwach: „Power-Spike-Reihenfolge" ist noch keine mathematische Definition; ohne eine formale Fenstergewichtung bleibt es eine
Forderung, kein Modellbaustein. Zu prüfen: ob sich Meilenstein-Bewertung als zusätzliche Label-Dimensionen (nicht als
Ersatz) einbauen lässt, was strukturell einfach wäre. Ändert meine Position: ja, teilweise — ich erweitere meine
Antwort auf I um „Horizont-Wahl selbst braucht eine explizite Begründung oder Mehrfachhorizont-Bewertung".
Algorithmus-Experte → Mathematiker: Stark: die klare Trennung „Skalar vs. Vektor" trifft den Kern, warum Pareto-Verlust bei Skalarisierung ein reales Risiko ist. Schwach: eine vollständige Vektor-Pareto-Ausgabe bei 156 Items/40k ist
rechnerisch noch unrealistischer als die jetzige Skalarsuche — der Vorschlag löst das Rechenproblem nicht, er
verschärft es. Zu prüfen: ob eine kleine, feste Anzahl Pareto-Dimensionen (2–3, nicht 7) ein praktikabler Kompromiss
wäre. Gegenbeweis: die Diagnoseslice-Messung zeigt bereits bei 9 Slots/kleinerer Menge hohe Kosten für Vektorlabels.
Ändert meine Position: teilweise — ich würde für die Produktion eine kleine Pareto-Front (Schaden vs. Überleben, 2D)
statt vollem Vektor vorschlagen.
Algorithmus-Experte → Praktiker: Stark: der Hinweis auf den robusten Cache-Schlüssel ist berechtigt und in der Tat
ein gutes Beispiel für sauberes Engineering. Schwach: die Forderung nach Engine-Konsolidierung unterschätzt das


Risiko, bei einer Migration bestehende, gut getestete Python-Logik (Audit, CLI) zu brechen — das ist kein reiner
Gewinn. Zu prüfen: ob Konsolidierung wirklich nötig ist oder ob ein gemeinsamer, cross-getesteter Referenzdatensatz
(statt gemeinsamer Code) ausreicht. Ändert meine Position: nein.
Genie → Mathematiker: Stark: die Beobachtung, dass Skalarisierung eine andere Problemklasse ist, teile ich
vollständig — das ist der Kern meines eigenen Arguments aus anderer Richtung. Schwach: der Mathematiker bleibt
innerhalb des bestehenden Zustandsraums (Item, Souls) und fragt nur nach der Zielfunktionsform — er stellt die
Zustandsraumwahl selbst nicht infrage. Zu prüfen: ob „earnedSouls" überhaupt die richtige unabhängige Variable ist,
oder ob es Spielzeit sein sollte. Ändert meine Position: nein, bestärkt sie.
Genie → Skeptiker: Stark: „Optimierung eines Proxys" ist exakt meine eigene Kernaussage, nur präziser formuliert.
Schwach: der Skeptiker sagt nicht, was die Alternative wäre — reine Falsifikation ohne Rekonstruktionsvorschlag lässt
das Council ohne Weg nach vorn. Zu prüfen: ob „kein Gegnermodell" bedeutet „das Problem ist unlösbar" oder nur
„das Problem braucht eine explizite Unsicherheitsklasse" (was lösbar wäre). Gegenbeweis für die stärkste Skeptiker-Lesart: robuste Optimierung unter Unsicherheit ist ein etabliertes, lösbares Feld — „unlösbar" wäre also zu stark.
Ändert meine Position: ja — ich präzisiere: das Problem ist nicht unlösbar, sondern in seiner aktuellen Form falsch
spezifiziert; mit einer expliziten Unsicherheitsmenge wird es wieder lösbar.
Deadlock-Profi → Algorithmus-Experte: Stark: die Dominanzfilterung vor der Suche ist ein netter, risikofreier
Gewinn, der nichts an der spielerischen Aussagekraft ändert. Schwach: sie löst mein Kernproblem (fehlende
Meilensteine) überhaupt nicht — sie ist reine Effizienzverbesserung, keine Modellverbesserung. Zu prüfen: ob die
Zeitersparnis durch Dominanzfilterung groß genug wäre, um die frei werdende Zeit für Meilenstein-Auswertungen zu
nutzen. Ändert meine Position: nein.
Deadlock-Profi → MOBA-Profi: Stark: der Team-Kontext-Punkt ergänzt meinen Laning-Punkt sinnvoll — beides sind
Facetten von „Kontext fehlt". Schwach: ein Team-Kontext-Modifier ohne echte Team-Daten würde vermutlich schnell
zu geratenen Gewichten führen, was gegen die Projektregel „keine erfundenen Werte" verstößt. Zu prüfen: ob es
überhaupt verifizierte Interaktionsdaten für Team-Synergien in data/interactions/ gibt (nicht geprüft). Ändert meine
Position: nein, aber ich würde den Team-Vorschlag hinter meinen eigenen Meilenstein-Vorschlag zurückstufen, weil
letzterer ohne neue Daten umsetzbar ist.
MOBA-Profi → Deadlock-Profi: Stark: das Laning-Fenster-Argument ist berechtigt und spezifisch genug, um sofort
testbar zu sein. Schwach: „die meisten Spiele enden nie bei 40.000" ist eine empirische Behauptung ohne Beleg im
Repo oder in dieser Analyse — sie klingt plausibel, ist aber nicht verifiziert. Zu prüfen: reale Spieldauer-/Souls-Verteilungsdaten (liegen dem Council nicht vor). Ändert meine Position: nein, aber ich markiere die empirische Lücke.
MOBA-Profi → Praktiker: Stark: die UX-Sichtbarkeits-Forderung (Unsicherheit anzeigen) ist eine leicht umsetzbare
Brücke zwischen mathematischer Ehrlichkeit und Produktwert — sehr sinnvoll. Schwach: „progressive
Zwischenanzeige" allein ändert nichts an der fehlenden Gegner-Sensitivität, die ich für wichtiger halte. Zu prüfen:
Priorisierung zwischen UX-Transparenz und Modellrobustheit. Ändert meine Position: nein.
Skeptiker → Genie: Stark: die Politik-statt-Endzustand-Neudefinition ist die einzige Erstposition, die das Problem
tatsächlich neu formuliert statt es nur zu kritisieren — das nehme ich ernst. Schwach: eine vollständige Politik-Funktion
über (Souls, Zeit, Gegnerzustand) zu berechnen ist um Größenordnungen aufwendiger als das jetzige Problem, das
bereits nicht terminiert — das könnte die Situation verschlimmern statt verbessern. Zu prüfen: ob eine grob
diskretisierte Politik (wenige Gegner-Archetypen statt Kontinuum) praktikabel bleibt. Gegenbeweis: keiner, nur ein
Machbarkeitsvorbehalt. Ändert meine Position: nein, ich bleibe bei „im starken Sinn nicht bestimmbar", stimme aber
zu, dass eine grob diskretisierte Politik ein sinnvoller Kompromiss wäre.
Skeptiker → Algorithmus-Experte: Stark: der Vorschlag, admissible Schranken zuerst als Shadow-Check zu
validieren (bereits im Repo so geplant), ist genau die vorsichtige, falsifizierbare Vorgehensweise, die ich einfordere.
Schwach: selbst eine perfekte exakte Suche über den aktuellen Zustandsraum würde mein Kernargument (kein
Gegnermodell) nicht entkräften — sie würde nur ein falsch spezifiziertes Problem exakter lösen. Zu prüfen: nichts
Neues, Bestätigung meiner Kernthese. Ändert meine Position: nein.
Praktiker → Skeptiker: Stark: der Punkt zur unsichtbaren Referenz-Unsicherheit in der UI ist berechtigt und praktisch
leicht behebbar (Zahl anzeigen). Schwach: „das Projektprinzip scheitert" ist eine zu starke Formulierung für ein
Produkt, das explizit nie behauptet hat, ein Sieg-Vorhersage-Tool zu sein — das Prinzip „bester geprüfter Build"
scheitert nicht, wenn man es wörtlich nimmt. Zu prüfen: ob Nutzer die Formulierung „bester geprüfter Build"
tatsächlich so vorsichtig lesen, wie sie gemeint ist (UX-Frage, nicht Mathematik-Frage). Ändert meine Position: nein,
aber ich nehme den UI-Transparenz-Punkt in meine eigene Liste auf.
Praktiker → Mathematiker: Stark: die Forderung nach Vektor- statt Skalarbewertung ist mathematisch sauber.
Schwach: für ein Browser-Produkt mit einem „Build starten"-Knopf ist eine einzelne empfohlene Antwort ein reales
Produktbedürfnis — eine 7-dimensionale Pareto-Front an normale Nutzer auszuliefern, ist eine UX-Katastrophe ohne
zusätzliche Kuratierung. Zu prüfen: ob eine kleine 2D-Pareto-Front (Schaden/Überleben) mit einem Skalar-Default-Vorschlag beide Bedürfnisse verbindet. Ändert meine Position: nein, ich möchte nur die Skalarisierung nicht ersatzlos,


sondern als „Standardansicht über einer kleinen Pareto-Front" behalten.
PHASE 4 — Rebuttal
Mathematiker. POSITION GEÄNDERT: JA. Geändert: Ergänzung, dass der Horizont (40.000 Souls) selbst eine
unbegründete freie Variable ist und Mehrfachhorizont-Bewertung nötig ist. Aufgrund: Deadlock-Profis Kritik zu Power-Spikes. Beleg: README-Aussage, dass 40k „historisch" und praktisch selten erreicht wird.
Algorithmus-Experte. POSITION GEÄNDERT: JA. Geändert: von „volle Vektor-Pareto-Front" zu „kleine 2D-Pareto-Front (Schaden/Überleben) statt reinem Skalar" als praktikablem Zwischenschritt. Aufgrund: eigener Erkenntnis im
Cross-Review, dass volle Vektor-Suche das Rechenproblem verschärft statt löst. Beleg: eigene Messanalyse der
Diagnoseslice-Kosten.
Genie. POSITION GEÄNDERT: JA (Präzisierung, nicht Umkehr). Geändert: von „das Problem ist ohne Gegnermodell
kategorial falsch gestellt" zu „das Problem ist falsch spezifiziert, aber mit expliziter Unsicherheitsmenge (nicht vollem
Gegnermodell) wieder lösbar". Aufgrund: eigener Reflexion im Cross-Review mit dem Skeptiker. Beleg: Existenz
etablierter robuster Optimierungsverfahren unter Unsicherheit.
Deadlock-Profi. POSITION GEÄNDERT: NEIN. Kritik von MOBA-Profi (fehlender Beleg für „40k selten erreicht")
akzeptiert als offene empirische Lücke, ändert aber nicht die Kernforderung nach Meilenstein-Bewertung, die
unabhängig davon Sinn ergibt.
MOBA-Profi. POSITION GEÄNDERT: NEIN. Priorisierung zwischen Team-Kontext und Meilensteinen zugunsten von
Deadlock-Profis Vorschlag angepasst (Reihenfolge, nicht Substanz).
Skeptiker. POSITION GEÄNDERT: NEIN. Die stärkste Formulierung meiner Kernthese (kein wohldefiniertes Problem
ohne Gegnermodell) bleibt bestehen; ich akzeptiere aber ausdrücklich, dass „falsch spezifiziert, aber reparierbar" eine
faire Präzisierung ist, keine Widerlegung meiner These über die aktuelle Form des Projekts.
Praktiker. POSITION GEÄNDERT: JA (Ergänzung). Geändert: Skalarausgabe soll über einer kleinen (2D) Pareto-Front
sitzen, nicht die Pareto-Idee ersatzlos verwerfen. Aufgrund: Cross-Review mit Mathematiker/Algorithmus-Experte.
Beleg: keine neue Codeevidenz, reines Argument.
PHASE 5 — Gemeinsame Diskussion der zentralen Streitfragen
Streitfrage Position A Position B Bester Beleg
A
Bester Beleg B Vorläufiger Konsens
Gibt es einen
einzelnen
besten Build?
Nein, nie ohne
Gegnermodell
(5/7)
Ja, relativ zu
vollständig fixierten
Annahmen (2/7,
Mathematiker/Algo.-
Experte für
Teilprobleme)
Fehlendes
Gegnermodell
im gesamten
Code
Bewiesene
Vollständigkeit in
kleinen Diagnose-Slices
Nein im offenen Sinn, Ja im eng
definierten Sinn — beide Positionen
sind korrekt für unterschiedliche
Fragen, kein echter Widerspruch.
Build:
Endzustand
oder
Trajektorie?
Trajektorie (6/7) Endzustand reicht
(0/7 als reine
Position, aber
implizit im aktuellen
70%-Endgewicht)
Regret-Integral
bestraft
schlechte
Zwischenpfade
bereits
70% Gewicht liegt
dennoch auf dem
Endzustand
Trajektorie — das Projekt bewegt sich
bereits in diese Richtung (30%
Verlaufsgewicht), sollte aber
konsequenter werden.
Szenarien statt
einzelner
Zielfunktion
nötig?
Ja (Genie,
Skeptiker,
MOBA-Profi)
Nicht zwingend,
wenn Nutzer
explizit einen Fokus
wählt (Praktiker)
Kein
Gegnermodell
= ein Szenario
ist nicht mal
spezifiziert
Weapon/Spirit/Hybrid-Fokus ist bereits eine
Art Nutzer-Szenario
Ja für Gegnerunsicherheit, aber die
bestehende Fokuswahl ist ein
sinnvoller erster Szenario-Baustein,
kein Ersatz für Gegner-Robustheit.
Pareto-Front
statt
Einzelgewinner?
Ja, aber klein-dimensional
(Mathematiker
nach Rebuttal,
Algo.-Experte)
Skalar für Produkt-UX (Praktiker, mit
Ergänzung)
Skalarisierung
verdeckt nicht-konvexe
Pareto-Punkte
7D-Pareto ist für
Endnutzer
unbrauchbar
2D-Pareto (Schaden/Überleben) als
Untergrund, Skalar als
Standardanzeige — Kompromiss von
beiden Seiten akzeptiert.
Muss
Gegnerzustand
Teil des Modells
sein?
Ja (6/7) Nein, außerhalb des
Produktumfangs
vertretbar
(Praktiker mit
Vorbehalt)
Modell ist
strukturell kein
Spiel gegen
einen Gegner
Fehlen kanonisch
verifizierter
Gegnerdaten macht
Umsetzung riskant
(Erfindung von
Werten)
Ja im Prinzip nötig, aber nur mit
verifizierten Daten umsetzbar — sonst
verstößt es gegen die eigene
AGENTS.md-Regel „keine erfundenen
Werte". Bis dahin: explizit als bekannte
Lücke kommunizieren, nicht
ignorieren.


Muss Zeit
expliziter
Zustand sein
(statt Souls)?
Ja (Genie) Souls als Proxy für
Zeit ist praktikabel
(Mathematiker,
Algo.-Experte)
Power-Spikes
sind
zeitgebunden,
nicht Soul-gebunden
Ein zeitliches
Einkommensmodell
wäre eine weitere
unbewiesene
Annahme (README
warnt davor explizit)
Kein Konsens — echter fachlicher
Konflikt. Beide Seiten haben Recht: Zeit
wäre realistischer, aber ein falsches
Zeitmodell wäre schlechter als das ehrliche
„keine Zeitannahme" von heute.
Wie wichtig
sind Power-Spikes?
Sehr wichtig
(Deadlock-Profi,
MOBA-Profi)
Sekundär
gegenüber
Gegnermodell-Lücke (Skeptiker,
Genie)
Reale
Spielerfahrung:
frühe Duelle
entscheiden oft
Ohne Gegner ist auch
ein „starker" früher
Spike bedeutungslos
Beides wichtig, aber Gegnermodell ist
die Voraussetzung — Power-Spikes
ohne Gegnerkontext sind nur die halbe
Verbesserung.
Ist statische
Endbuild-Optimierung
ausreichend?
Nein (7/7) — Alle sieben
Rollen nennen
unabhängig
Lücken jenseits
des
Endzustands
— 7/7 Konsens: nicht ausreichend als
alleinige Aussage, aber wertvoll als
eine von mehreren Kennzahlen.
Kann globale
Optimalität
bewiesen
werden?
Nur für kleine,
fest definierte
Teilräume (7/7)
— Direkter Beweis
in direct-reference.mjs -
Dokumentation
für definierte
Bedingungen
Nachgewiesene
Nicht-Terminierung
bei voller
Itemmenge/40k
7/7 Konsens.
Wann reicht
„best verified"?
Wenn
Suchraum
vollständig
benannt und
tatsächlich
abgedeckt ist
(7/7)
— AGENTS.md-Regel 7
formuliert das
bereits korrekt
— 7/7 Konsens — das Projekt definiert
diese Schwelle bereits richtig, hält sie
in der Kommunikation aber nicht
immer konsequent ein (siehe
Skeptiker/Praktiker-Kritik zur
Referenz-Unsicherheit).
MILP/DP/exakte
Verfahren wofür
geeignet?
Kleine
Itemteilmengen,
Diagnoseslices
(Algorithmus-Experte,
Mathematiker)
— Bereits im Repo
für kleine Slices
demonstriert
— Konsens: für kleine, klar begrenzte
Unterprobleme geeignet, nicht für den
vollen 156-Item-Raum.
Wo braucht es
Simulation?
Proc-
/Comboreiche
Helden mit
vielen
bedingten
Triggern
(Deadlock-Profi)
— Afterburn-Modell zeigt
bereits, wie
aufwendig ein
einzelner Proc
korrekt zu
modellieren ist
— Konsens: Simulation ist der richtige
Weg für Fähigkeitscombos, die sich
nicht mehr geschlossen als Formel
ausdrücken lassen — noch nicht Teil
des Produktivpfads.
PHASE 6 — Falsification Test (Skeptiker-Sonderrunde)
Konkretes Gegenbeispiel-Szenario:
Held: Warden, Fokus Weapon. Budget: 20.000 Souls (ein realistisches Mid-Game-Budget, weit vor dem 40k-Horizont). Zeitpunkt: ca. 12–15 Minuten Spielzeit (typisches erstes großes Duell-/Skirmish-Fenster).
Gegnerzustand: Der gegnerische Carry hat bereits deutlich in permanente Bullet-Resistenz investiert (im Modell:
mehrere Items mit bullet_resist -Mechanik gemäß RES-002 multiplikativ gestapelt). Buildentscheidung: Item
B1 (reiner Weapon-Damage-Booster, hoher sustainedWeaponDps -Beitrag) vs. Item B2 (Spirit-lastiges Hybrid-Item
mit moderatem Weapon- und Spirit-Anteil).
→ Das mathematische Modell (Score = 0.5·Damage + 0.5·Survival, Damage = 70% Bullet/30% Spirit für Weapon-Fokus, ohne Gegner-Resistenzterm) bevorzugt B1, weil B1 in der isolierten sustainedWeaponDps -Metrik höher
bewertet wird als B2. → Die real optimale Entscheidung wäre B2, weil B1s Bullet-Schaden durch die multiplikative
gegnerische Bullet-Resistenz (RES-002) stark reduziert wird, während B2s Spirit-Anteil ungemindert bleibt — das
Modell kann diesen Effekt nicht abbilden, weil sustainedWeaponDps keinen Gegner-Resistenzfaktor enthält
(der einzige Resistenz-Term im Code ist der des eigenen Builds für EHP, nicht der des Gegners für den
ausgeteilten Schaden).
Ist das valide? Ja — dies ist keine Spekulation über unmodellierte Spielmechanik, sondern eine direkte Konsequenz
der bereits verifizierten Codestruktur: evaluateCarryScenarios berechnet ausgeteilten Schaden ohne jeden


gegnerseitigen Resistenzfaktor (nur die eigene EHP-Berechnung des Builds enthält Resistenz, und zwar die eigene,
nicht die gegnerische). Ausgeteilter Schaden gegen einen variablen Gegner ist damit im Modell schlicht nicht als
Funktion des Gegners repräsentiert.
Reaktion der sechs übrigen Mitglieder:
Mathematiker: Bestätigt — das ist ein direktes Beispiel für eine fehlende Modelldimension, kein
Kalkulationsfehler; die vorhandene Formel ist innerhalb ihres eigenen Rahmens korrekt, der Rahmen ist nur
unvollständig.
Algorithmus-Experte: Bestätigt technisch, ergänzt: eine parametrisierte Gegner-Resistenz (als zusätzlicher, vom
Nutzer wählbarer Skalar 0–60%) ließe sich mit geringem Aufwand in evaluateCarryScenarios einführen, ohne die
Suche selbst zu verändern.
Genie: Sieht darin die Bestätigung der eigenen Kernthese — genau dieser Fall zeigt, warum „bester Build ohne
Gegner" ein Kategorienfehler ist, nicht nur eine fehlende Funktion.
Deadlock-Profi: Bestätigt aus Spielerfahrung, dass Gegner-Resistenzaufbau (Bullet vs. Spirit) real eine der
häufigsten Ursachen für Build-Anpassungen im späteren Spiel ist.
MOBA-Profi: Bestätigt, ordnet es als klassisches „Counterbuilding"-Muster ein, das in jedem MOBA mit Rüstungs-
/Resistenzsystemen auftritt.
Praktiker: Bestätigt technische Machbarkeit einer einfachen Erweiterung, warnt aber, dass ohne verifizierte
Verteilung realer Gegner-Resistenzwerte ein Default-Parameter selbst zu einer neuen unbelegten Annahme würde.
Korrektur des Konsenses: Ja — der vorläufige Konsens aus Phase 5 („Gegnerzustand sollte Teil des Modells sein,
aber nur mit verifizierten Daten") wird durch dieses konkrete, codebasierte Gegenbeispiel von einer theoretischen
Vorsichtsmaßnahme zu einem nachweisbar aktiven blinden Fleck hochgestuft: Es ist kein hypothetischer Randfall,
sondern eine direkte Lücke im tatsächlich ausgeführten Berechnungspfad für Schaden.
PHASE 7 — Alternative Architektur (Council-Zielbild)
Leitlinie: Nur Methoden, die nachweisbaren Vorteil bringen. Kein akademischer Overkill (kein volles Game-Theoretic-Nash-Equilibrium-Solving — dafür fehlen sowohl Daten als auch Notwendigkeit).


INPUT
Hero, Role, Focus, Budget, aktueller Zeitpunkt, aktueller Build,
Gegner-Resistenzprofil (parametrisiert, nicht erfunden — Nutzer-Slider
oder kleiner Satz benannter Archetypen), Team-Kontext (optional), Situation
│
▼
GAME MODEL (= heutiges data/core, data/heroes, data/interactions — BEHALTEN)
│
▼
STATE REPRESENTATION
heutiges Ganzzahl-Soul-/Inventar-Modell (BEHALTEN)
+ zusätzliche Dimension: Gegner-Resistenzparameter (NEU, aber klein — kein
voller Gegner-State, nur ein Sensitivitätsparameter pro Resistenztyp)
+ mehrere benannte Zeit-/Budget-Meilensteine statt nur Endhorizont (NEU)
│
▼
SEARCH / OPTIMIZATION
kleine Sub-Item-Mengen / Diagnose: exakter Label-Correcting-Kern +
admissible Branch-and-Bound-Schranke (aus docs/reference_branch_bound_review.md,
endlich aktiviert statt nur skizziert)
volle 156-Item-Produktivsuche: Beam Search statt Single-Path-Hillclimbing,
mit Item-Dominanzfilterung als kostenlosem Vorschritt
│
▼
SIMULATION / EVALUATION
bestehende deterministische Formeln (Schaden, EHP) BEHALTEN für alles,
was bereits belegt ist; punktuelle Ereignis-Simulation NUR für Helden mit
komplexen, nicht geschlossen darstellbaren Combo-/Proc-Ketten (nicht generell)
│
▼
ROBUSTNESS / SCENARIOS
Score wird über eine KLEINE, benannte Menge von Gegner-Resistenzszenarien
berechnet (z. B. „neutral", „hohe Bullet-Resistenz", „hohe Spirit-Resistenz");
ausgegeben wird Worst-Case- UND Erwartungswert-Score, nicht nur ein Skalar
│
▼
PARETO / RANKING
2-dimensionale Pareto-Front (Schaden vs. Überleben) je Szenario,
plus ein empfohlener Skalar-Default als „Einstiegsantwort"
│
▼
OUTPUT
Build, Buildpfad (mit 2–3 Zwischen-Meilensteinen bewertet),
Alternativen (Pareto-Front), situative Varianten (je Gegnerszenario),
explizite numerische Unsicherheit (Referenz-Konfidenz, Suchvollständigkeit),
Begründung mit Codebelegen wie heute bereits üblich
Warum nicht mehr: Ein vollständiges Multi-Agenten-Spielsimulationsmodell (echtes gegnerisches Verhalten, Team-KI, Reinforcement Learning über echte Matches) wäre akademisch reizvoll, aber ohne Zugriff auf echte Matchdaten
und mit der Projektregel „keine erfundenen Werte" nicht verantwortbar umsetzbar — das Council rät ausdrücklich
davon ab.
PHASE 8 — Vergleich Alt vs. Neu
Komponente Entscheidung Begründung
Ganzzahl-Soul-/Inventarmodell
( deadlock-domain.mjs )
BEHALTEN Formal bewiesen korrekt und vollständig für seinen definierten Rahmen;
kein besseres Basismodell nötig.
Generischer Label-Correcting-Kern ( search-core.mjs )
BEHALTEN Sauber implementiert, mathematisch korrekt, wertvoll für Diagnose-Slices.
Admissible Branch-and-Bound-Schranke
VERBESSERN → aktivieren Bereits fertig hergeleitet, nur noch nicht als Pruning aktiv; höchster
Aufwand-Nutzen-Hebel für „mehr Exaktheit".
Anytime-Suche (Single-Path-Hillclimbing)
VERBESSERN → Beam Search Grundidee (anytime, budgetiert) richtig; Suchstrategie selbst ist die
schwächste Stelle im Produktivpfad.
Score-Formel (70/15/15, 50/50,
Fokusmischung)
BEHALTEN als Default, ERGÄNZEN
um Pareto-Untergrund
Empirisch/normativ vernünftig gewählt, aber sollte nicht die einzige
Ausgabe bleiben.
Resistenz-Stacking (RES-002) BEHALTEN Verifiziert korrekt gegen kanonische Regel.
Referenzberechnung (2s-Gier-Sample)
VERBESSERN Funktioniert, aber ihre Unsicherheit muss numerisch sichtbar werden
statt implizit zu bleiben.
Gegnermodell NEU HINZUFÜGEN (parametrisiert,
klein)
Größte inhaltliche Lücke, durch Phase 6 konkret nachgewiesen.
Zeit-/Meilenstein-Bewertung NEU HINZUFÜGEN Technisch bereits über snapshots fast vorbereitet; niedriger
Zusatzaufwand.


Terminal-Audit (1-Schritt-Nachbarschaft)
BEHALTEN Reale, wenn auch lokale, Optimalitätsgarantie — guter, günstiger
Baustein.
Cache-Identität (SHA-256 über
Modulgraph)
BEHALTEN Vorbildliches Engineering, kein Verbesserungsbedarf erkennbar.
Zwei parallele Engines
(Python/JS)
VERBESSERN → langfristig
konsolidieren oder cross-testen
Wartungsrisiko, aber kein akutes Korrektheitsproblem; keine sofortige
Neuentwicklung nötig.
debatte/ -LLM-Debattentool BEHALTEN, aber klar als separates
Werkzeug kennzeichnen
Nützlich für qualitative Reviews, ersetzt aber keine mathematische
Verifikation und sollte nicht damit verwechselt werden.
UI-Transparenz für Unsicherheit VERBESSERN Mathematische Ehrlichkeit im Backend vorhanden, im Frontend laut
vorliegenden Infos nicht durchgängig sichtbar.
Vollständige
Spielsimulation/Gegner-KI
NICHT HINZUFÜGEN Kein belastbarer Datenzugang, widerspräche der eigenen „keine
erfundenen Werte"-Regel.
PHASE 9 — Finale Council-Synthese
1. Ist es möglich?
Global optimal (bester Build gegen jeden denkbaren Gegner/Verlauf): Nein, nicht sinnvoll definierbar ohne ein
Gegner-/Unsicherheitsmodell — die Frage wäre unterspezifiziert.
Optimal unter festen Annahmen (fixer Held, Budget, Score-Formel, kein Gegner): Ja, für kleine, vollständig
enumerierbare Itemmengen bereits bewiesen im Repo; für die volle 156-Item-Menge bei 40k nachweislich noch
nicht (kombinatorische Explosion, dokumentiert).
Robust optimal (bester Worst-Case über eine benannte Unsicherheitsmenge): Prinzipiell ja, aber im aktuellen
Projekt nicht implementiert.
Pareto-optimal: Ja, im Diagnosepfad bereits real umgesetzt; im Produktivpfad bewusst durch Skalarisierung
ersetzt.
Best verified: Ja, das ist die korrekte, vom Projekt selbst bereits verwendete Kategorie für den Produktivpfad.
Best found: Ja, für die volle Itemmenge ist dies aktuell die ehrlich zutreffendste Beschreibung.
Praktisch empfehlenswert: Ja, mit den in Phase 6/8 benannten Einschränkungen klar kommuniziert.
2. Sind wir auf dem richtigen Weg?
BEHALTEN: Zustandsmodell, Label-Correcting-Kern, deterministische Formeln, Terminal-Audit, Cache-Design,
Terminologie-Disziplin („bester geprüfter Build").
VERBESSERN: Suchstrategie (Beam Search statt Single-Path), Referenz-Unsicherheitskommunikation, UI-Transparenz, Meilenstein-Bewertung.
GRUNDLEGEND ÄNDERN: die implizite Annahme, dass ein 1-Spieler-Optimierungsproblem ohne jedes
Gegnermodell ausreicht, um „bester Build" (statt „beste isolierte Stat-Kombination") zu behaupten.
VERWERFEN: nichts Zentrales — es gibt keinen fundamentalen Baustein, der komplett falsch ist, nur einen
fehlenden Baustein (Gegnerdimension) und eine verbesserungsfähige Suchstrategie.
3. Was fehlt? Gegner-Resistenz-/Itemzustand (auch nur parametrisiert), Zeit/Meilenstein-Dimension neben dem 40k-Endhorizont, sichtbare numerische Unsicherheit der Referenz, Beam-Search-/Branch-and-Bound-Aktivierung.
4. Was ist exakt lösbar? Kostenrechnung, Legalitätsprüfung, Resistenz-Stacking, Terminal-Audit-Nachbarschaft,
vollständige Enumeration kleiner Itemteilmengen — alles bereits umgesetzt und getestet.
5. Was braucht Approximation? Die volle 156-Item/40k-Suche (Beam Search/Heuristik), jede Aussage über
„durchschnittliches" Spielverhalten, jede Referenzkurve außerhalb kleiner Diagnose-Slices.
6. Was braucht Simulation? Fähigkeiten-/Proc-Ketten von Helden mit vielen bedingten Interaktionen (komplexer als
Warden/Infernus), sobald sie nicht mehr geschlossen als Formel darstellbar sind.
7. Was ist nicht sinnvoll global optimierbar? Alles, was echtes Gegnerverhalten, Teamdynamik, Trefferquote oder
Spielerskill voraussetzt — das sind keine Optimierungsprobleme mehr, sondern empirische/verhaltensbezogene
Fragen.
8. Wie sollte „bester Build" definiert werden? „Der Build, der unter explizit genannten Annahmen (Held, Budget,
Fokus, Zeitpunkt, ggf. Gegner-Szenario) die höchste geprüfte Kombination aus Schaden und Überleben erreicht,
gemessen relativ zu einer offen ausgewiesenen, selbst nicht als exakt behaupteten Referenz — mit einer klar
kommunizierten Grenze zwischen dem, was bewiesen, approximiert oder schlicht nicht modelliert ist."
9. Welche Architektur würde das Council heute bauen? Siehe Phase 7 — im Kern die bestehende Architektur,
erweitert um eine kleine Gegner-Sensitivitätsdimension, Beam Search statt Hillclimbing und Mehrfach-Meilenstein-


Bewertung. Kein Neubau von Grund auf — das ist eine der klareren Erkenntnisse dieses Councils.
10. Können wir irgendwann ehrlich sagen: „Dieser Build ist mathematisch der beste"? Ja, aber nur mit der
Formulierung: „… der beste Build unter der vollständig benannten Bedingungsmenge {Held, Budget, Fokus,
Itemmenge, Zeitpunkt/Meilenstein, Gegnerszenario X}, geprüft durch vollständige Enumeration oder eine bewiesene
Branch-and-Bound-Schranke über diesen Suchraum." Ohne diese vollständige Bedingungsliste — insbesondere ohne
Gegnerszenario — nein; die wissenschaftlich korrekte stärkste Aussage bleibt „bester geprüfter/gefundener Build
unter den offengelegten Annahmen und Modellgrenzen".
11. Die drei wichtigsten nächsten Schritte (in Abhängigkeitsreihenfolge):
1. Referenz- und Suchunsicherheit numerisch sichtbar machen (Voraussetzung für alles Weitere — ohne
ehrliche Fehlerschranken ist jede weitere Verbesserung nicht messbar).
2. Admissible Branch-and-Bound-Schranke aktivieren (bereits fertig hergeleitet in
docs/reference_branch_bound_review.md| , erst als Shadow-Check, dann produktiv) und/oder Beam Search statt
Single-Path-Hillclimbing einführen — beide zusammen liefern die erste bewiesene Aussage über die Lücke
zwischen gefunden und exakt optimal im aktuellen Suchraum.
3. Parametrisierte Gegner-Resistenzdimension ergänzen (klein, nutzerwählbar, keine erfundenen Werte) — erst
danach wird „bester Build" mehr als eine isolierte Stat-Optimierung.
PHASE 10 — Council-Scoreboard
Konsens 7/7:
Statische Endbuild-Optimierung allein ist nicht ausreichend.
Globale Optimalität ist nur für kleine, vollständig definierte Teilräume bewiesen.
„Best verified" ist die korrekte Kategorie für den heutigen Produktivpfad; die Terminologie im Projekt ist bereits
richtig gewählt.
Die Architektur sollte erweitert, nicht neu gebaut werden.
Konsens 6/7:
Ein Gegnermodell (mindestens parametrisiert) fehlt und ist die wichtigste inhaltliche Lücke.
Kontrovers — keine klare Mehrheit / fachlicher Konflikt:
Soll Zeit statt Souls die Verlaufsachse sein? (Genie dafür; Mathematiker/Algorithmus-Experte dagegen, mit triftigem
Gegenargument zur Vermeidung neuer unbewiesener Annahmen.)
Mitglied Ursprüngliche Position Finale Position Geändert Warum Finale
Confidence
Mathematiker Optimal nur relativ zu Vektorziel + Horizont selbst ist unbegründete
freie Variable
JA Deadlock-Profi-Kritik 80 %
Algorithmus-Experte
Beam Search als Verbesserung + kleine 2D-Pareto statt voller Vektor JA eigene Kostenanalyse im
Cross-Review
78 %
Genie Politik statt Endzustand nötig Präzisiert: Unsicherheitsmenge statt
volles Gegnermodell
JA Cross-Review mit
Skeptiker
74 %
Deadlock-Profi
Meilensteine wichtiger als
Endhorizont
unverändert NEIN — 66 %
MOBA-Profi Team-Kontext +
Counterbuilding-Warnung
Priorität zugunsten Meilensteine
angepasst
JA
(Reihenfolge)
Deadlock-Profi 74 %
Skeptiker Kein wohldefiniertes Problem
ohne Gegnermodell
unverändert in der Substanz NEIN Präzisierung akzeptiert,
nicht Widerlegung
85 %
Praktiker Skalar-Output für UX Skalar über kleiner Pareto-Front JA Cross-Review mit
Mathematiker
80 %
PHASE 11 — Evidence Score wichtiger Aussagen
„Der generische Suchkern ist ein korrekter Multi-Objective-Label-Correcting-Algorithmus." — Evidence A (direkt
aus Code ableitbar/verifiziert).
„Resistenz-Stacking folgt exakt RES-002." — Evidence A (Code-Grep-Beleg exakt übereinstimmend).


„Die volle 156-Item/40k-Suche terminiert nicht exakt in praktikabler Zeit." — Evidence A (dokumentierte, im Repo
festgehaltene Messung mit INCOMPLETE_WATCHDOG ).
„Die Produktivsuche ist ein stochastisches Hillclimbing mit Gumbel-Perturbation und Terminal-Audit." — Evidence
A (Code vollständig gelesen und verifiziert).
„Fehlendes Gegnermodell ist die größte inhaltliche Lücke." — Evidence B (starke Codebelege + etablierte
Optimierungstheorie, aber kein empirischer Beweis über tatsächliche Sieg-Auswirkung).
„Beam Search würde robustere Ergebnisse liefern als Single-Path-Hillclimbing." — Evidence C (plausible,
theoretisch gut begründete, aber nicht empirisch im Projekt gemessene Schlussfolgerung).
„40.000 Souls wird in den meisten realen Spielen selten erreicht." — Evidence D (plausible Hypothese ohne
vorliegenden Datenbeleg).
„Der Branch-and-Bound-Ansatz aus docs/reference_branch_bound_review.md würde bei Aktivierung eine relevante
Beschleunigung bringen." — Evidence D/E (das Dokument selbst benennt dies ausdrücklich als unbewiesen und
macht die Aktivierung von einem vorherigen Shadow-Check abhängig).
„Aktuelle Deadlock-Patchwerte in data/ sind zum heutigen Live-Stand exakt aktuell." — Evidence E (unbekannt,
vom Council nicht gegen das Live-Spiel geprüft).
„318 von 318 legalen Aktionen im dokumentierten Warden/40k-Lauf wurden geprüft, keine Verbesserung
gefunden." — Evidence B (dokumentierte Einzelmessung im Repo, vom Council nicht selbst reproduziert).
PHASE 12 — Visuelle Darstellung
Empfohlene Zielarchitektur
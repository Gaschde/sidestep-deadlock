# Optimizer V1 — 40k Multiobjective Width-4 Profiling

Status: **ABGESCHLOSSEN**

Ausgangs-HEAD: `b60ce6c8c48ab451145daf587e7214bcacac3f9a`

Mess-Source-Commit: `40354a05601c84f40988b45a27f26b5f0440b3e1`

Daten-Commit: `eb72121cef08642bb980814466c4750e364302d7`

Workflow: `35466351196`

## Auftrag

Diagnose, warum der experimentelle 40k-Multiobjective-Beam bei Width 4 innerhalb des 60-s-Produktbudgets keinen terminalen Kandidaten erreicht, während Production bei Width 4 terminale Builds liefert.

Keine Search-Heuristik, kein Objective, keine Beam Width, keine Itemdaten und keine Production-Auswahl wurden verändert.

## Messdesign

Verglichen wurden:

- Warden Hybrid 40k Production Width 4
- Warden Hybrid 40k Multiobjective Width 4
- Infernus Hybrid 40k Production Width 4
- Infernus Hybrid 40k Multiobjective Width 4

Jeder Fall lief einmal ohne Profiling und einmal mit Profiling unter demselben 60-s-Wallclock-Vertrag. Multiobjective reserviert wie der bestehende Shadow 2 s für Audit/Finalisierung, daher endet der Search-Teil ungefähr bei 58 s.

Die Instrumentierung ist opt-in und ändert weder Ranking noch Legalität, Objective oder Retention. Die JavaScript-Suite bestätigt die semantische Neutralität der instrumentierten Path/End- und Pareto-Helfer.

Timer sind inklusive/nestend. Nur tatsächlich sequentielle Top-Level-Abschnitte werden gemeinsam interpretiert; Kindtimer werden nicht zu Eltern addiert.

## Kernergebnis

Es gibt **nicht eine einzige gemeinsame Ursache**.

1. **Terminal-Asymmetrie:** Production materialisiert sehr früh einen legalen Save-to-horizon-Kandidaten mit `completeBySaving()`. Multiobjective bewertet eine Save-to-horizon-Fortsetzung zwar bereits implizit im Path/End-Vektor, materialisiert sie aber nicht als terminalen Node. Deshalb kann Production einen terminalen Build liefern, obwohl der normale Beam selbst noch weit von 40k entfernt ist.
2. **Warden-Fortschritt:** der dominante zusätzliche 40k-Kostenblock ist die vollständige Pareto-Layer-Zerlegung des gesamten Unique-Candidate-Pools. Die erste Front ist klein; teuer ist das Berechnen **aller** nachfolgenden Layer.
3. **Infernus-Fortschritt:** Evaluation innerhalb der Vector/Dedupe-Arbeit dominiert. Multiobjective kommt beim normalen Soul-Fortschritt trotzdem weiter als der Production-Beam; die fehlende Terminal-Ausgabe ist daher bei Infernus primär die fehlende Terminal-Materialisierung, nicht schlechtere Soul-Progression.

## Messwerte

### Warden Hybrid

| Messung | Production W4 | Multiobjective W4 |
|---|---:|---:|
| Control wall-clock | 12.37 s | 60.21 s |
| Profiled Search | 13.09 s | 58.12 s |
| Search-generated States | 88,760 | 93,846 |
| Evaluated Inventories | 16,791 | 28,732 |
| Duplicate removals | 2,270 (2.56%) | 1,163 (1.24%) |
| Max Candidate Pool | 829 | 2,857 |
| Natürlich erreichter Soul-Wert | 40,000 | 32,000 profiled / 32,400 control |
| Terminaler Kandidat | ja | nein |

Profiled Multiobjective, sequentielle Loop-Abschnitte:

- Future-safe Dedupe: **22.52 s**
- Frontier maintenance: **35.38 s**
  - davon vollständige Pareto-Layer-Berechnung: **35.35 s**
  - Sorting: 0.41 s
  - Diversity: 0.001 s
- Beam Search gesamt: **58.12 s**

Die beiden Loop-Abschnitte Dedupe und Frontier maintenance sind im Code sequentiell; ihre Rohzeiten erklären praktisch den gesamten Search-Loop. Untergeordnete Timer überlappen und werden nicht addiert:

- Trajectory/Vector scoring: 22.26 s
- Path reconstruction inklusive darin ausgelöster Metric-Lookups/Evaluation: 10.27 s
- Evaluation: 4.84 s
- Path-AUC state/integration timer: 4.80 s
- Endbuild state scoring: 0.046 s
- Transition generation: 0.185 s
- Replacement generation: 0.145 s
- Purchase generation: 0.004 s
- Upgrade generation: 0.002 s
- Save generation: 0.001 s

Soul-Fortschritt, profiled:

- 10k: Production 1.54 s, Multiobjective 2.90 s
- 20k: Production 5.39 s, Multiobjective 12.30 s
- 25k: Production 6.73 s, Multiobjective 25.49 s
- 30k: Production 7.77 s, Multiobjective 45.22 s
- 40k: Production 10.51 s; Multiobjective nicht erreicht

Die Verlangsamung wächst also mit dem Candidate-Pool; sie ist kein konstanter Evaluator-Faktor.

### Infernus Hybrid

| Messung | Production W4 | Multiobjective W4 |
|---|---:|---:|
| Control wall-clock | 60.02 s | 59.80 s |
| Profiled Search | 58.37 s | 58.18 s |
| Search-generated States | 11,085 | 33,085 |
| Evaluated Inventories | 6,384 | 5,670 |
| Duplicate removals | 374 (3.37%) | 33 (0.10%) |
| Max Candidate Pool | 624 | 1,648 |
| Natürlich erreichter Soul-Wert | 11,200 profiled | 17,200 profiled / 16,400 control |
| Terminaler Kandidat | ja | nein |

Profiled Multiobjective, sequentielle Loop-Abschnitte:

- Future-safe Dedupe: **47.51 s**
- Frontier maintenance: **10.60 s**
  - davon Pareto-Layer-Berechnung: **10.59 s**
  - Sorting: 0.089 s
  - Diversity: 0 s
- Beam Search gesamt: **58.18 s**

Verschachtelte Diagnose:

- Trajectory/Vector scoring: 47.40 s
- Path reconstruction inklusive Metric-Lookups/Evaluation: 43.47 s
- Evaluation: **42.54 s**
- Path-AUC state/integration timer: 1.72 s
- Endbuild state scoring: 0.018 s
- Transition generation: 0.060 s
- Replacement generation: 0.044 s

Damit bleibt die bekannte teure Infernus-Evaluation der dominante innere Kostenblock. Sie wurde in diesem Auftrag nicht verändert.

Wichtig: Multiobjective erreicht im normalen Search **mehr** Soul-Fortschritt als Production (17.2k vs. 11.2k im profiled run), liefert aber trotzdem keinen terminalen Kandidaten. Das widerlegt die Erklärung, Multiobjective müsse bei Infernus deshalb ohne Terminal enden, weil es weniger weit als Production komme.

## Production-vs-Multiobjective: warum Terminal vs. kein Terminal?

Production ruft nach der ersten Beam-Selektion `completeBySaving(beam[0])` auf und publiziert diesen legalen 40k-Kandidaten sofort. Das ist ein Anytime-Ausgabepfad; der normale Beam muss dafür nicht bis 40k laufen.

Multiobjective hat keinen entsprechenden Materialisierungsschritt. Sein Partial-Vector hat bereits die Semantik:

`Path/End of the legal save-to-horizon completion of the current partial path`

aber der resultierende Save-Pfad wird nicht als terminaler Node in `terminalNodes` eingetragen.

Das ist bei Infernus direkt messbar:

- Production natürlicher Beam: max. 11.2k Souls
- Multiobjective natürlicher Beam: max. 17.2k Souls
- Production Terminal: ja
- Multiobjective Terminal: nein

Der Terminal-Unterschied ist deshalb **kein fairer Beleg für bessere Production-Progression**.

Zusätzlich ist `widthsCompleted:[4]` bei einem wall-clock-Abbruch nicht gleichbedeutend mit natürlichem 40k-Abschluss: der Production-Loop kann am äußeren Deadline-Check enden, ohne `completed=false` zu setzen. Der neue Soul-Trace macht diesen Unterschied sichtbar.

## Wo Warden Search-Fortschritt verloren geht

Warden Multiobjective generiert ungefähr dieselbe Grössenordnung an Search States wie Production, braucht dafür aber rund 4.2× weniger State-Durchsatz.

Die Ursache liegt nach der Generation:

1. Dedupe muss für praktisch jeden neuen Kandidaten den exakten Path/End-Vektor herstellen.
2. Dedupe entfernt nur 1.24% der Kandidaten.
3. Danach wird für fast den gesamten Unique-Pool eine vollständige Pareto-Schichtung berechnet.
4. Die erste Front bleibt klein; trotzdem werden hunderte spätere Layer berechnet, obwohl Beam Width nur 4 beträgt.
5. Mit wachsenden Pools explodiert deshalb die Zeit pro Soul-Fortschritt.

Am letzten abgeschlossenen Warden-Schritt lagen 2,468 Kandidaten vor; alle 2,468 waren unique, retained wurden 4.

## Wo Infernus Search-Fortschritt verloren geht

Bei Infernus liegt der Hauptkostenblock innerhalb der Vector/Dedupe-Arbeit:

- 33,085 Vector-Misses für 33,085 generierte States;
- nur 33 Kandidaten werden dedupliziert;
- 5,670 echte Inventory-Evaluations;
- Evaluation belegt 42.54 s innerhalb der 47.40 s Trajectory/Vector-Arbeit.

Pareto-Layering kostet zusätzlich 10.59 s, ist aber nicht der primäre innere Infernus-Kostenblock.

## Bestätigte Ursachen

- **Terminal-Materialisierung unterscheidet die Engines:** Production erzeugt proaktiv einen Save-to-horizon-Terminal; Multiobjective nicht.
- **Multiobjective-Dedupe ist schwach:** Warden entfernt 1.24%, Infernus 0.10% der Search-Kandidaten.
- **Warden:** vollständige Pareto-Layer-Berechnung über grosse Unique-Pools ist der grösste zusätzliche Search-Kostenblock.
- **Infernus:** die teure Evaluation dominiert die Vector/Dedupe-Arbeit; vollständiges Pareto-Layering ist sekundär.
- **Candidate Pools sind grösser:** max. 2,857 vs. 829 bei Warden und 1,648 vs. 624 bei Infernus. Das vervielfacht downstream Vector-/Pareto-Arbeit.
- **Wiederholte History-Arbeit existiert:** jeder neue Node ist ein Vector-Miss und rekonstruiert seine Parent-Chain; Inventory-Metriken werden zwar gecacht, aber Millionen Metric-Cache-Hits zeigen wiederholtes Traversieren ähnlicher Histories.

## Nicht die Ursache

- **Keine Explosion der ersten Pareto-Front:** bereits der 60-s-Shadow mass maximal 6; im Infernus-Hybrid-Profil ist die erste Front am Deadline-Schritt 1.
- **Diversity:** 0–1 ms im Multiobjective-Profil.
- **Sorting allein:** 0.41 s Warden / 0.089 s Infernus; der teure Pareto-Teil ist die Layer-Berechnung, nicht das Sortieren.
- **Action-Generation selbst:** 0.185 s Warden / 0.060 s Infernus.
- **Purchases/Upgrades/Saves als Generator-Kosten:** jeweils nur Millisekunden.
- **Replacement-Generation als direkte CPU-Zeit:** 0.145 s Warden / 0.044 s Infernus. Replacements erhöhen zwar den Candidate-Pool, ihre Erzeugung ist aber nicht der gemessene Hotspot.
- **Endbuild-Scoring:** 0.046 s Warden / 0.018 s Infernus.
- **Terminal Audit:** Multiobjective erreicht ihn gar nicht; er kann den fehlenden Search-Fortschritt daher nicht verursachen.
- **Continuation/Lookahead:** Multiobjective nutzt ihn nicht; er kann dessen Laufzeitproblem nicht erklären.
- **Path-AUC-Arithmetik allein:** relevant, aber mit 4.80 s Warden / 1.72 s Infernus deutlich kleiner als die jeweils dominanten Blöcke.

## Profiler-Effekt

Profiling verändert keine Suchentscheidung, kann unter Wallclock-Limit aber die Menge abgeschlossener Arbeit beeinflussen. Deshalb gelten Control-Runs für Reach und profiled Runs für Attribution.

- Warden Production: gleiche 88,760 States / 16,791 Evaluations; 12.37 s control vs. 13.13 s profiled.
- Warden Multiobjective: 32.4k max control vs. 32.0k profiled.
- Infernus Production/Multiobjective zeigen erwartbar stärkere wall-clock-sensitive State-Schwankungen.

Die Hauptbefunde hängen nicht von einer einzelnen profiled Reach-Zahl ab.

## Tests / CI

- Optimizer JavaScript: **108/108 PASS**
- Optimizer-next Workflow `35466351173`: **success**
- Width-4 Profiling Workflow `35466351196`: **success**
- Python-Regression bleibt wie zuvor advisory; die sechs bekannten Python-Failures wurden nicht durch diesen Auftrag verändert.
- Main wurde nicht verändert oder gemergt.

## Genau ein nächster Implementierungsauftrag

**Multiobjective Pareto-Retention semantisch identisch lazy machen:** berechne Pareto-Layer nur so weit, bis die Beam-Kapazität gefüllt ist, statt den gesamten Unique-Pool vollständig in alle späteren Layer zu zerlegen. Beweise mit Regressionstests gegen die aktuelle Vollschichtung, dass für identische Kandidaten/Width exakt dieselben retained Nodes gewählt werden; ändere weder Objective, Dedupe-Identität, Beam Width noch Diversity-Regeln. Danach denselben 40k Width-4 Warden/Infernus-Vergleich erneut messen.

Begründung: Das entfernt den grössten Warden-spezifischen Zusatzkostenblock und reduziert auch Infernus-Pareto-Kosten, ohne Search-Semantik oder Objective zu verändern. Die separate Terminal-Materialisierungs-Asymmetrie bleibt dokumentiert und darf in diesem Auftrag nicht mitverändert werden.

## Evidenz

- `benchmarks/optimizer-v1/experiments/40k-multiobjective-width4-profile/results.json`
- `benchmarks/optimizer-v1/experiments/40k-multiobjective-width4-profile/summary.json`
- `tools/optimizer-width4-profile.mjs`
- `app/search-telemetry.mjs`

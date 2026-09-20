# Optimizer V1 — Lazy Multiobjective Pareto Retention

Status: **ABGESCHLOSSEN**

Ausgangs-HEAD: `4e12db79b2ba41a59de8568a87fce358c55b966c`

Implementierungs-Commit: `a0b99f684b77df7129a91ef4dda9e3d7b6519ced`

Regressionstest-Commit / Benchmark-Source: `daa2389ff46f69916907db460171d74c73a87d4b`

Daten-Commit: `8cf29106b8cffa117767815f178a5eb5094afc9f`

Workflow: `35467808600` — **success**

## Änderung

Die Multiobjective-Retention berechnet Pareto-Layer jetzt nur noch bis die aktuelle Beam-Kapazität gefüllt werden kann.

Unverändert bleiben:

- Path/End-Dominanzrelation
- Dedupe-Identität
- Beam Width
- Partial-Layer-Auswahl
- Path/End-Extremes
- Diversity-Buckets und Reihenfolge
- Objective / Path-AUC / Endbuild-Messung
- Terminal-Completion
- Evaluator / Afterburn
- Production-Beam
- Itemdaten
- 60-s-Produktbudget

Die alte vollständige Schichtung bleibt ausschließlich als Test-Oracle verfügbar und wird von keinem Search-Runner aufgerufen.

## Semantische Gleichheit

Full und Lazy verwenden dieselbe einzelne Layer-Extraktion auf demselben jeweils verbleibenden Kandidatenset. Lazy beendet die Folge nur, sobald die bis dahin extrahierten vollständigen Layer mindestens `width` Kandidaten enthalten.

Damit ist der von der Retention konsumierte Layer-Prefix identisch zur Vollschichtung. Die unveränderte Partial-Layer-Auswahl erhält daraus dieselben Nodes in derselben Search-relevanten Reihenfolge.

Regressionstests vergleichen Full gegen Lazy über:

- verschiedene Candidate-Pool-Größen
- Widths 1/2/3/4/5/8/12
- mehrere Pareto-Layer
- gleiche Path/End-Vektoren / Dominanz-Ties
- Frontier-Overflow
- deterministische Wiederholung

Ergebnis: **111/111 JavaScript-Tests PASS**.

## 40k Width-4 Benchmark

Der gleiche Profiling-Runner wie in der vorherigen Phase wurde erneut verwendet.

### Warden Hybrid Multiobjective

| Messung | Vorher Full | Nachher Lazy |
| --- | ---: | ---: |
| Pareto-Layering | 35.348 s | **1.677 s** |
| Frontier maintenance | 35.379 s | **1.728 s** |
| Profiled Search States | 93,846 | **122,262** |
| Profiled Evaluations | 28,732 | 30,254 |
| Profiled Soul-Reach | 32.0k | **35.6k** |
| Control Soul-Reach | 32.4k | **37.2k** |
| Max Candidate Pool | 2,857 | 4,532 |
| Search complete | nein | nein |
| Terminal candidates | 0 | 0 |

Pareto-Layering sank um **95.3%**. Der größere Candidate-Pool nach der Änderung ist Folge des weiter fortgeschrittenen Suchlaufs, nicht einer Retention-Semantikänderung.

Über die 122 profilierten Lazy-Schritte wurden 121,099 Unique-Kandidaten in den jeweiligen Pools gesehen. Nur 509 mussten tatsächlich einem extrahierten Pareto-Layer zugeordnet werden; 120,590 bzw. **99.58%** blieben absichtlich ungeschichtet. Im größten Schritt lagen 4,532 Unique-Kandidaten vor; maximal 7 Kandidaten mussten für die Width-4-Auswahl geschichtet werden.

### Infernus Hybrid Multiobjective

| Messung | Vorher Full | Nachher Lazy |
| --- | ---: | ---: |
| Pareto-Layering | 10.586 s | **0.121 s** |
| Frontier maintenance | 10.597 s | **0.129 s** |
| Profiled Search States | 33,085 | 20,477 |
| Profiled Evaluations | 5,670 | 3,898 |
| Profiled Soul-Reach | 17.2k | 13.6k |
| Control Soul-Reach | 16.4k | 14.0k |
| Max Candidate Pool | 1,648 | 1,452 |
| Search complete | nein | nein |
| Terminal candidates | 0 | 0 |

Pareto-Layering sank um **98.9%**.

Über die 50 profilierten Lazy-Schritte wurden 20,444 Unique-Kandidaten gesehen. Nur 194 wurden für die benötigten Layer geschichtet; **99.05%** blieben ungeschichtet.

Die niedrigere absolute Infernus-Reichweite ist kein belastbarer Regressionsbeleg: derselbe neue Runner war insgesamt deutlich langsamer. Auch Production-Infernus fiel im profilierten Lauf von 11.2k auf 9.6k natürlichen Soul-Fortschritt. Gleichzeitig stieg die Multiobjective-Evaluation-Zeit von 42.54 s auf 52.63 s. Der Pareto-Anteil selbst wurde dagegen eindeutig fast vollständig entfernt.

### Production-Kontrolle

Warden Production behielt exakt dieselben deterministischen Arbeitsmengen:

- 88,760 States
- 16,791 Evaluations
- Width 4 abgeschlossen
- terminaler Build vorhanden

Die Wallclock lag auf dem neuen Runner höher, obwohl die Arbeitsmenge identisch war. Das bestätigt zusätzlich, dass rohe Vorher/Nachher-Runtime über getrennte GitHub-Runner nicht als alleiniger Search-Regressionsindikator verwendet werden darf.

Infernus Production blieb durch Wallclock/Evaluation begrenzt und publiziert weiterhin über die bekannte frühe Save-to-40k-Completion einen terminalen Build.

## Ergebnis

Die Lazy-Retention entfernt den bestätigten Pareto-Hotspot semantisch neutral.

- Warden: Pareto-Zeit praktisch entfernt und deutlich mehr Search-Fortschritt innerhalb desselben Budgets.
- Infernus: Pareto-Zeit praktisch entfernt; der dominante Restblock bleibt Evaluation/Vector-Dedupe-Arbeit.
- Multiobjective erzeugt weiterhin keine terminalen Kandidaten. Das ist weiterhin mit der bekannten separaten Save-to-40k-Materialisierungs-Asymmetrie vereinbar und wurde hier bewusst nicht geändert.

## Tests / CI

- Optimizer JavaScript: **111/111 PASS**
- `optimizer-next tests` Workflow `35467808611`: **success**
- Width-4 Profiling Workflow `35467808600`: **success**
- Python: dieselben sechs bekannten advisory Failures wie vor diesem Auftrag
- Main: nicht verändert oder gemergt

## Genau ein nächster Schritt

**Die Multiobjective Save-to-40k-Terminal-Materialisierung separat an Production angleichen**, ohne Objective oder Retention zu verändern, damit auch bei wall-clock-begrenzter natürlicher Search eine legale terminale Pareto-Ausgabe vergleichbar gemessen werden kann.

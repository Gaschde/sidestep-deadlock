# Optimizer V1 — 40k Multiobjective Width-4 Profiling

Status: **MESSUNG LÄUFT**

Ausgangs-HEAD: `b60ce6c8c48ab451145daf587e7214bcacac3f9a`

## Auftrag

Diagnose, warum der experimentelle 40k-Multiobjective-Beam bei Width 4 innerhalb des 60-s-Produktbudgets keinen terminalen Kandidaten erreicht, während Production bei Width 4 terminale Builds erreicht.

Keine Search-Heuristik, kein Objective, keine Beam Width, keine Itemdaten und keine Production-Auswahl werden verändert.

## Messdesign

Verglichen werden:

- Warden Hybrid 40k Production Width 4
- Warden Hybrid 40k Multiobjective Width 4
- Infernus Hybrid 40k Production Width 4
- Infernus Hybrid 40k Multiobjective Width 4

Jeder Lauf wird unter demselben 60-s-Wallclock-Vertrag einmal ohne Profiling und einmal mit Profiling ausgeführt. Dadurch wird der Profiling-Overhead selbst sichtbar.

Die Instrumentierung misst inklusive/nestende Timer. Phase- und Operationstimer dürfen deshalb nicht addiert oder als exklusive Runtime-Prozente interpretiert werden.

Gemessen werden insbesondere Evaluation, Transition-/Action-Generation, Save-Generation, Path-AUC/Endbuild-Scoring, Future-safe Dedupe, Pareto/Frontier, Diversity, Sorting, Path-Rekonstruktion, Terminal Completion/Audit sowie Cache-/State-/Action-/Soul-/Depth-Counter.

Ergebnisse werden nach erfolgreichem Workflow ergänzt.

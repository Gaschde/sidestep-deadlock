# Optimizer V1 — 60s Product Budget + 40k Multiobjective Shadow Experiment

Status: **ABGESCHLOSSEN — Entscheidung C: CONTROLLED-Erfolg überträgt sich nicht ausreichend auf 40k**

Ausgangs-HEAD: `9914c4c27700d1f58288d81073db47c672c60ef5`

Shadow-Source-Commit: `1441b2aa559b2fcd2180316eae48b76b39d9fa1f`

Workflow: `35464300745` — **success**

## Ziel

Der bisherige 25-s-Produktvertrag wurde auf **60 Sekunden** erhöht. Historische `baseline-v0`-Daten bleiben unverändert als 25-s-Messung erhalten.

Parallel wurde der bereits in CONTROLLED erfolgreiche experimentelle Multiobjective-Beam als reiner Shadow auf sechs echten 40k-Fällen geprüft:

- Warden Weapon
- Warden Spirit
- Warden Hybrid
- Infernus Weapon
- Infernus Spirit
- Infernus Hybrid

Production-Auswahl, UI und Production-Objective blieben unverändert. Der Shadow verwendet weiterhin ausschließlich die zwei getrennten Dimensionen:

`(Path-AUC, Endbuild)`

Es wurde keine Path/End-Scalarisierung eingeführt.

## 60-s-Produktbudget

Der aktuelle Product-Wallclock-Vertrag ist jetzt zentral `60000 ms`.

Die historische 25-s-`baseline-v0` wird nicht überschrieben. Die neue 60-s-Messung liegt separat unter:

- `benchmarks/optimizer-v1/experiments/40k-multiobjective-shadow/results.json`
- `benchmarks/optimizer-v1/experiments/40k-multiobjective-shadow/summary.json`

### Effekt auf Production Search Width

Historisch erreichten unter 25 s alle sechs 40k-Fälle nur vollständig **Width 4**.

Unter 60 s:

- Warden Weapon: Width **4 und 8** vollständig
- Warden Spirit: Width **4 und 8** vollständig
- Warden Hybrid: Width **4 und 8** vollständig
- Infernus Weapon: weiterhin nur Width **4**
- Infernus Spirit: weiterhin nur Width **4**
- Infernus Hybrid: weiterhin nur Width **4**

Damit hilft 60 s Warden klar bei der Search-Breite. Für Infernus reicht die Verlängerung wegen der weiterhin hohen Evaluationskosten nicht für Width 8.

## Production — 60-s-Ergebnisse

| Fall | Path-AUC | Endbuild | States | Evaluations | Widths vollständig | Terminal Audit |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Warden Weapon | 0.432077 | 0.476983 | 191,817 | 66,376 | 4, 8 | vollständig |
| Warden Spirit | 0.450626 | 0.502647 | 181,167 | 66,954 | 4, 8 | vollständig |
| Warden Hybrid | 0.440517 | 0.404127 | 211,913 | 62,345 | 4, 8 | vollständig |
| Infernus Weapon | 0.344288 | 0.399237 | 9,244 | 4,538 | 4 | unvollständig |
| Infernus Spirit | 0.326649 | 0.413244 | 9,273 | 4,938 | 4 | unvollständig |
| Infernus Hybrid | 0.335469 | 0.472851 | 8,142 | 4,838 | 4 | unvollständig |

Alle sechs veröffentlichten Production-Pfade sind legal replay-verifiziert.

## 40k Multiobjective Shadow

Der Shadow erhielt pro Fall dasselbe 60-s-Wallclock-Budget wie Production.

Geplante feste Widths:

`4 → 8 → 16 → 32`

Tatsächlicher Befund in **allen sechs Fällen**:

- Width 4 wurde gestartet.
- Width 4 wurde innerhalb 60 s **nicht vollständig beendet**.
- Es wurde **kein terminaler Kandidat** erreicht.
- Deshalb existiert keine terminale 40k-Pareto-Front.
- Width 8 wurde nie erreicht.
- Terminal Audit konnte nicht stattfinden.

| Fall | Shadow States | Evaluations | max. First-Front | Frontier Overflow | Terminalkandidaten |
| --- | ---: | ---: | ---: | ---: | ---: |
| Warden Weapon | 58,776 | 17,169 | 3 | 0 | 0 |
| Warden Spirit | 66,129 | 20,063 | 6 | 1 | 0 |
| Warden Hybrid | 66,897 | 24,259 | 6 | 1 | 0 |
| Infernus Weapon | 13,220 | 3,854 | 2 | 0 | 0 |
| Infernus Spirit | 17,074 | 4,406 | 1 | 0 | 0 |
| Infernus Hybrid | 19,477 | 3,662 | 1 | 0 | 0 |

Die Front selbst explodiert in den beobachteten Partial States nicht: maximale First-Front-Größe 6. Das Hauptproblem ist stattdessen, dass die Multiobjective-Suche unter 40k innerhalb des Budgets nicht bis zu terminalen Lösungen gelangt.

## Production vs Shadow Search-Kosten

Unter praktisch demselben Wallclock-Budget:

- Warden Shadow erzeugt nur etwa **31–37 %** so viele States wie Production und **26–39 %** so viele Evaluations.
- Infernus Shadow erzeugt etwa **1.43–2.39×** so viele States wie Production, aber nur **76–89 %** so viele Evaluations.
- Trotz dieser Arbeit erreicht der Shadow in keinem Fall einen terminalen Kandidaten.

Damit ist nicht eine terminale Frontier-Explosion der Blocker, sondern die 40k-Search-Durchsatz-/Fortschrittscharakteristik der aktuellen Multiobjective-Retention.

## Reproduzierbarkeit

Jeder Shadow-Fall wurde zweimal ausgeführt.

Für alle sechs Fälle waren identisch:

- gestartete Widths
- abgeschlossene Widths
- Partial Width 4
- leere terminale Front
- Front-Hash
- State Count
- Evaluation Count

Die Reproduktion ist damit für den beobachteten Fehlschlag stabil.

## Pathologien

### Warden Production

Die 60-s-Production-Läufe zeigen starke Replacement-/Reacquisition-Muster:

- Weapon: 46 Transaktionen, davon 26 Replacements
- Spirit: 44 Transaktionen, davon 24 Replacements
- Hybrid: **79 Transaktionen, davon 62 Replacements**

Besonders Warden Hybrid zeigt einen klar pathologischen Wechsel zwischen `Grit` und `Health Stimpak`:

- 60 Reacquisitions insgesamt
- 58 Replacement-Rebuys
- lange alternierende Replacement-Folge bis kurz vor 40k

Daraus wird in diesem Auftrag bewusst **keine** Anti-Churn-Regel abgeleitet.

### Infernus Production

Alle drei Infernus-60-s-Pfade sparen weiterhin bis **40,000 Souls** und tätigen erst dort 1–2 Käufe.

Damit bleibt das bereits bekannte Buildpath-Problem trotz des höheren Zeitbudgets bestehen.

### Shadow

Da kein Shadow-Lauf einen terminalen Kandidaten erreicht, kann für terminale Shadow-Pfade keine belastbare Churn-/Reacquisition-Aussage getroffen werden.

## Antworten auf die Kernfragen

1. **Überträgt sich die CONTROLLED-Frontier auf 40k?**  
   Nein. Innerhalb 60 s entsteht in keinem Fall überhaupt eine terminale Frontier.

2. **Explodiert die Pareto-Front?**  
   Nicht sichtbar. Partial First-Fronts bleiben klein (maximal 6). Der Lauf scheitert vorher an Search-Fortschritt/Runtime.

3. **Findet Multiobjective bessere Path-Lösungen ohne unnötigen Endbuild-Verlust?**  
   Auf 40k nicht messbar, da keine terminalen Shadow-Lösungen erreicht werden.

4. **Dominiert Multiobjective Production in beiden Dimensionen?**  
   Nein beobachtbar; es existiert kein terminaler Shadow-Kandidat.

5. **Reichen 60 s für deutlich breitere Search?**  
   Für Production-Warden ja: Width 8 wird erreicht. Für Production-Infernus nein. Für Multiobjective-Shadow nein: nicht einmal Width 4 wird vollständig beendet.

6. **Wie stark steigen Runtime/States durch Multiobjective-Retention?**  
   Das 60-s-Budget wird vollständig verbraucht. Die Kosten äußern sich vor allem in geringerem Fortschritt pro Wallclock, nicht in einer beobachteten terminalen Frontier-Explosion.

7. **Bleiben Ergebnisse reproduzierbar?**  
   Ja, der beobachtete 40k-Fehlschlag reproduziert sich über beide Wiederholungen.

8. **Neue pathologische Kaufpfade?**  
   Im Shadow nicht beurteilbar. Production-Warden zeigt unter 60 s ausgeprägte Replacement-/Reacquisition-Pathologien; Infernus spart weiterhin bis 40k.

## Entscheidung

**C — CONTROLLED-Erfolg überträgt sich nicht ausreichend auf 40k.**

Begründung:

- 0/6 Shadow-Fälle erreichen einen terminalen Kandidaten.
- 0/6 schließen Width 4 innerhalb 60 s ab.
- damit gibt es keine 40k-Pareto-Front, die gegen Production verglichen werden könnte;
- der CONTROLLED-Erfolg bleibt gültig, liefert aber aktuell keine ausreichende Evidenz für Production-Integration;
- Production bleibt unverändert auf dem bestehenden Beam und `baseline-v0`.

Diese Entscheidung ist keine Aussage gegen das Zwei-Ziel-Modell selbst. Sie sagt ausschließlich, dass die aktuelle experimentelle 40k-Search-Implementierung unter dem Produktbudget nicht ausreichend überträgt.

## Tests / CI

Workflow `35464300745`: **success**

- JavaScript: **106/106 grün**
- 60-s 40k Shadow Experiment: success
- Artifact Upload: success
- Ergebnisdaten auf `feature/optimizer-next` gespeichert
- Main nicht verändert

## Genau ein nächster Schritt

Den **40k-Multiobjective-Width-4-Lauf gezielt profilieren**, um zu bestimmen, wo der Search-Fortschritt gegenüber CONTROLLED verloren geht — zunächst nur messen, ohne Search-Heuristik, Objective, Afterburn oder Production zu verändern.

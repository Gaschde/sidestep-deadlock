# Optimizer V1 — Controlled Multiobjective Beam Experiment

Status: **ABGESCHLOSSEN — Entscheidung A: 40k-Shadow-Experiment als nächster Schritt**

Ausgangs-HEAD: `3954cc01ce08eda3e76a5413d2acda26e78f1cd5`

Experiment-Source-Commit: `69fd77fa1a1394775df227112554c837193df4a4`

Benchmark-Daten-Commit: `0de29f54bedadc49be010dd333f2547838cb1131`

## Ziel

Der CONTROLLED-only Versuch prüft, ob eine Suche während des Suchprozesses mehrere Alternativen nach den zwei getrennten Dimensionen

`(Path-AUC, Endbuild)`

erhalten kann, ohne einen Path/End-Scalar einzuführen.

Production bleibt unverändert auf `baseline-v0`.

## Implementierung

Der Versuch ist von Production getrennt:

- `benchmarks/optimizer-v1/controlled-multiobjective-beam.mjs`
- `tools/optimizer-controlled-multiobjective.mjs`
- `tests/controlled-multiobjective-beam.test.mjs`
- `.github/workflows/optimizer-controlled-multiobjective.yml`

Der Production-Search-Code `app/beam-search.mjs` wurde für dieses Experiment nicht verändert.

### Retention

Kandidaten werden in 2D-Pareto-Layer zerlegt. Ein Layer wird vollständig vor späteren, dominierten Layern bevorzugt.

Es gibt **keinen** gewichteten Path/End-Gesamtscore.

Falls ein einzelner Layer die Beam-Kapazität übersteigen würde, werden zuerst das Path- und End-Extrem erhalten und danach die bereits existierende Kategorie-/Itemfamilien-Diversity verwendet. Im gemessenen CONTROLLED-Experiment trat dieser First-Front-Overflow jedoch nie auf.

Dominierte Partial States werden nicht global als beweisbar nutzlos verworfen. Spätere Pareto-Layer bleiben erhalten, solange Beam-Kapazität vorhanden ist, weil unterschiedliche Future-Konfigurationen später zu terminal nicht-dominierten Pfaden führen können.

### Partial-State-Semantik

Für einen Partial State wird der bestehende legale Pfad bis zum Horizont durch weiteres Sparen fortgesetzt. Path-AUC und Endbuild dieser Save-to-Horizon-Fortsetzung bilden den 2D-Suchvektor.

Das ist eine Search-Repräsentation, kein Optimalitätsbeweis.

### Future-safe Dedupe

Dedupe verwendet:

`futureKey + exakter ungerundeter (Path-AUC, Endbuild)-Save-Completion-Vektor`

Damit werden Pfade mit gleicher Future-Konfiguration, aber verschiedener relevanter Path-AUC-Historie nicht zusammengelegt.

## Versuchsaufbau

Fälle:

- CONTROLLED Warden Hybrid
- CONTROLLED Infernus Hybrid

Pro Fall:

- eingefrorene Referenz aus dem vorigen Pareto-Experiment
- feste Beam Widths 8, 16, 32, 64
- zwei identische vollständige Wiederholungen
- Runtime nur beobachtet; keine Wallclock-Truncation der experimentellen Search
- direkter Purchase/Upgrade/Replacement-Terminal-Audit um die gefundene terminale Pareto-Front
- bestehender CONTROLLED-`baseline-v0`-Beam auf demselben Runner als Kostenreferenz

## Reproduzierbarkeit

Alle Front-Hashes waren in beiden Wiederholungen identisch:

- Warden: Width 8, 16, 32 und 64 identisch
- Infernus: Width 8, 16, 32 und 64 identisch
- auch alle kumulativen Front-Hashes identisch

Die Search ist damit für diese CONTROLLED-Fälle reproduzierbar.

## Warden Hybrid

Eingefrorene Referenzfront:

| Punkt | Path-AUC | Endbuild |
| --- | ---: | ---: |
| baseline-v0 | 0.433542 | 0.417532 |
| Path-orientiert | 0.438080 | 0.414560 |

### Width 8

Die neue Search findet zwei neue nicht-dominierte Punkte. Beide eingefrorenen Punkte werden bereits von mindestens einem neuen Kandidaten dominiert.

Beste beobachtete Vektoren:

- `0.443588 / 0.414560`
- `0.443579 / 0.417532`

Die exakten alten Pfade/Vektoren werden nicht reproduziert; sie werden durch bessere beobachtete Lösungen ersetzt.

### Width 16

Weiter verbesserte zweipunktige Front:

- `0.444554 / 0.414560`
- `0.444544 / 0.417532`

Auch hier werden beide eingefrorenen Punkte dominiert.

### Width 32

Die Front kollabiert auf einen einzelnen Kandidaten:

- ID: `41683f0a4b2febc8`
- Path-AUC: **0.449185**
- Endbuild: **0.427123**
- 7 Transaktionen
- nur Purchases; keine Sells, Replacements oder Reacquisitions

Dieser Kandidat dominiert **beide** eingefrorenen Warden-Pareto-Punkte.

Width 64 verbessert die Front nicht weiter.

## Infernus Hybrid

Eingefrorene Referenzfront:

| Punkt | Path-AUC | Endbuild |
| --- | ---: | ---: |
| baseline-v0 | 0.443688 | 0.436432 |
| Path-orientiert | 0.448848 | 0.429789 |

### Width 8

Die Path-orientierte eingefrorene Lösung wird dominiert. Die eingefrorene baseline-v0-Endseite wird bei Width 8 noch verpasst.

Neue Front:

- `0.451962 / 0.429789`
- `0.451887 / 0.431497`

### Width 16

Ein einzelner neuer Kandidat erreicht:

- `0.452921 / 0.436432`

Damit wird auch baseline-v0 bei gleichem Endbuild durch höheren Path-AUC dominiert. Ab Width 16 sind beide eingefrorenen Punkte mindestens repräsentiert oder dominiert.

### Width 32

Die Front verbessert sich erneut auf einen einzelnen Kandidaten:

- ID: `02bfdee893695775`
- Path-AUC: **0.455859**
- Endbuild: **0.441198**
- 7 Transaktionen
- nur Purchases; keine Sells, Replacements oder Reacquisitions

Dieser Kandidat dominiert **beide** eingefrorenen Infernus-Pareto-Punkte.

Width 64 verbessert die Front nicht weiter.

## Frontier-Grösse und Diversity

Die Frontier explodiert in diesen CONTROLLED-Fällen nicht:

- Warden maximale First-Front-Grösse: 6
- Infernus maximale First-Front-Grösse: 3
- First-Front-Overflow bei Width 8+: 0 Schritte

Damit musste die Diversity-Fallback-Regel die eigentliche erste Pareto-Front in diesem Experiment nie beschneiden.

Das beweist nicht, dass Diversity in grösseren Suchräumen unnötig ist. Es zeigt nur, dass Dominanz plus die getesteten Beam-Kapazitäten im CONTROLLED-Raum für die beobachtete First-Front ausreichen.

## Search-Kosten

Vergleich jeweils kumulativ über die experimentellen Width-Läufe mit dem bestehenden CONTROLLED-`baseline-v0`-Run auf demselben Runner.

### Widths 8 + 16

Warden:

- Runtime: **2.15×**
- Search Generated States: **0.95×**
- Evaluations: **1.60×**

Infernus:

- Runtime: **1.80×**
- Search Generated States: **0.89×**
- Evaluations: **1.77×**

Damit wird die eingefrorene Front bei beiden Fällen bereits dominiert, ohne mehr generierte Search States als die bestehende CONTROLLED-Baseline zu benötigen. Die reichere Path-Auswertung erhöht aber die Laufzeit pro Arbeitseinheit.

### Bis Width 32

Warden:

- Runtime: **5.31×**
- Search Generated States: **2.41×**
- Evaluations: **2.50×**

Infernus:

- Runtime: **3.27×**
- Search Generated States: **2.25×**
- Evaluations: **2.79×**

Width 32 liefert in beiden Fällen die beste stabile beobachtete Front.

### Bis Width 64

Keine weitere Frontverbesserung.

Warden:

- Runtime: **13.67×**
- Search Generated States: **5.27×**

Infernus:

- Runtime: **5.94×**
- Search Generated States: **4.97×**

Width 64 ist damit in diesen CONTROLLED-Fällen zusätzliche Arbeit ohne beobachteten Qualitätsgewinn.

## Kandidatenzahl

Eingefrorene Kandidatenpools:

- Warden: 322
- Infernus: 361

Kumulative beobachtete Terminalkandidaten der Multiobjective-Läufe bis Width 32:

- Warden: 623 Kandidateninstanzen
- Infernus: 632 Kandidateninstanzen

Diese Zahlen sind Search-Arbeit über mehrere Width-Läufe und **keine** behauptete exhaustive Zahl verschiedener legaler Pfade.

## Pathologien

Bei Width 8/16 existieren noch Replacement-Reacquisitions:

- Warden: Rapid Rounds / Headshot Booster
- Infernus: Headshot Booster

Keine der beobachteten Fronten zeigt Same-Soul-Transaktionsgruppen oder Sell/Rebuy-Churn.

Die stabilen Width-32/64-Kandidaten beider Helden haben:

- 7 Purchases
- 0 Replacements
- 0 Sells
- 0 Reacquisitions
- 0 Same-Soul-Gruppen

Es wurde daher keine neue harte Anti-Churn-Regel eingeführt.

## Kritische Antworten

### Wie viele Pareto-Alternativen müssen erhalten werden?

Im CONTROLLED-Raum blieb die aktuelle First-Front klein: maximal 6 Warden bzw. 3 Infernus. Width 8 reichte für die Front selbst; Width 16 reichte, um beide eingefrorenen Fronten in beiden Fällen zu repräsentieren oder zu dominieren. Width 32 verbesserte die Qualität nochmals und stabilisierte die finale beobachtete Front.

### Explodiert die Frontier?

Nein, nicht in diesen CONTROLLED-Fällen.

### Reicht Dominanz allein oder braucht Search Diversity?

Für die gemessene First-Front musste Diversity nicht eingreifen. Für spätere Pareto-Layer und grössere Räume ist daraus keine allgemeine Abschaffung von Diversity ableitbar.

### Ist Future-safe Dedupe mit Path-AUC-Historie kompatibel?

Ja, wenn die relevante Path-Historie Teil der Identität bleibt. Der Versuch verwendet Future-State plus exakten Path/End-Vektor und hat dafür einen Regressionstest.

### Kann Search wichtige Kandidaten verlieren, obwohl sie später Pareto-optimal wären?

Theoretisch ja. Deshalb wird Dominanz über verschiedene Future-Konfigurationen nicht als beweissicherer Global-Prune verwendet. Spätere Pareto-Layer bleiben bis zur Beam-Grenze erhalten. Die alten eingefrorenen Pfade wurden zwar nicht exakt wiedergefunden, aber ab Width 8/16 durch neue Punkte dominiert.

### Wie stark steigen Runtime und State Count?

Bei 8+16 bleiben die generierten Search States ungefähr auf Baseline-Niveau, Runtime steigt aber auf rund 1.8–2.15×. Width 32 kostet rund 2.25–2.41× States und 3.27–5.31× Runtime. Width 64 bringt keinen beobachteten Qualitätsgewinn.

## Tests / CI

Workflow: `35463184096` — **success**

- JavaScript: **106/106 grün**
- Multiobjective-Experiment: **success**
- Artefakt-Upload: **success**
- Benchmark-Datencommit: **success**

Bestehender Optimizer-Next-Workflow: `35463184126` — **success**

- JavaScript tests: success
- Python regression baseline: advisory, Workflow success

Production-Semantik wurde nicht verändert.

## Interpretation

Der wichtigste neue Befund ist stärker als die ursprüngliche Hypothese:

Die eingefrorenen zweipunktigen CONTROLLED-Fronten waren keine stabilen Grenzen des Suchraums. Der Multiobjective-Beam findet reproduzierbar Kandidaten, die die alten Trade-off-Punkte dominieren. Bei Width 32 verschwindet der beobachtete Path-vs-End-Trade-off in beiden CONTROLLED-Fällen vollständig zugunsten eines einzelnen besseren Vektors.

Das beweist **keine globale Optimalität**. Es zeigt aber, dass der frühere Trade-off teilweise durch Search-Coverage begrenzt war und dass die Zwei-Ziel-Retention gerade deshalb nützlich ist.

## Entscheidung

**A — Multiobjective-Beam funktioniert im CONTROLLED-Experiment gut genug.**

Begründung:

- reproduzierbar;
- legal;
- keine versteckte Scalarisierung;
- keine Frontier-Explosion;
- eingefrorene Pareto-Strukturen werden nicht nur approximiert, sondern durch bessere Lösungen ersetzt;
- Width 32 stabilisiert in beiden Fällen eine stärkere Front;
- keine neue Pathologie auf der stabilen Front;
- Kosten steigen deutlich, bleiben aber messbar und erlauben eine klare Shadow-Frage für den grösseren Raum.

Production bleibt unverändert.

## Genau ein nächster Schritt

Ein **40k-Shadow-Experiment** durchführen, das den Multiobjective-Beam neben Production misst, ohne Production-Auswahl oder UI zu verändern.

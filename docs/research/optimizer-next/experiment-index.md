# Optimizer Next — Experiment Index

Status: **KANONISCHER RESEARCH-INDEX**
Branch: **feature/optimizer-next**
Initialer Evidence-Cut: Parent-HEAD **678aa741e9e13846a9ec0bf3edc389fd6bf95e72**

## Zweck und Leseregel

Dieser Index ist die zentrale Navigations- und Duplikatkontrolle für Optimizer-Experimente auf feature/optimizer-next. Er ersetzt keine historischen Research Notes, Result-Dateien oder Commit-Diffs; diese bleiben die Primärbelege.

Vor einem neuen Optimizer-Experiment ist dieser Index zu prüfen. Eine bereits beantwortete Hypothese wird nur erneut getestet, wenn neue Evidenz vorliegt, sich relevante Search-/Objective-/State-Semantik geändert hat oder ausdrücklich eine Replikation verlangt wird.

Statussemantik:

- **CONFIRMED** — die formulierte Aussage wird durch die vorhandene Evidenz im angegebenen Scope gestützt.
- **REJECTED** — die formulierte Hypothese wird durch die vorhandene Evidenz im angegebenen Scope widersprochen.
- **PARTIAL** — gemischte, eingeschränkte oder noch nicht hinreichend generalisierbare Evidenz.
- **OPEN** — noch keine ausreichende Repo-Evidenz.

Spätere Experimente dürfen den Scope früherer Befunde einschränken. Sie ändern aber nicht rückwirkend die historischen Artefakte.

## 01 — Measurement Foundation / baseline-v0

- **Datum / Commit:** 2026-09-19; Source **371a22e3bda9c015a7b1c5e19947db06c6fb7045**; Daten **0f84bd091ac8c7d33d6ed18d3590ed2af690370f**; Doku **54ea462dacb91d42d2cecd80afee0131eedc6123**.
- **Forschungsfrage:** Gibt es eine reproduzierbare Messgrundlage, gegen die spätere Objective-/Search-Änderungen ohne Optimalitätsbehauptung verglichen werden können?
- **Aufbau:** SMALL/EXACT, zwei CONTROLLED-Fälle und sechs 40k-Production-Fälle mit eingefrorenen Referenzen; Result-Run und Profiling-Run getrennt. Pfade wurden legal replay-verifiziert.
- **Bestätigter Befund:** SMALL/EXACT hat im begrenzten Raum Gap 0. Im historischen 25-s-Vertrag schlossen alle sechs 40k-Fälle nur Width 4 ab. Infernus-Evaluation lag auf dem gemessenen Runner ungefähr 32–36× über Warden pro ausgewertetem Inventory.
- **Interpretation:** baseline-v0 ist eine Messreferenz, kein globales Optimum. Inclusive Profiler-Timer dürfen nicht als exklusive Bottleneck-Anteile addiert werden.
- **Status:** **CONFIRMED**.
- **Erledigt / ausgeschlossen:** Baseline-Vertrag, Replay-Legalität und SMALL-Exact-Kontrolle sind etabliert; aus baseline-v0 folgt kein Beweis globaler Optimalität und kein Beweis, dass Replacement-Generation der dominante Bottleneck ist.
- **Offen:** Wiederholungsverteilungen der Wallclock-Messungen bleiben außerhalb dieses Baseline-Laufs; neue Performancebehauptungen brauchen neue Messung unter aktueller Semantik.
- **Pfade:** docs/research/optimizer-next/measurement-foundation.md; docs/research/optimizer-next/baseline-contract-v0.md; benchmarks/optimizer-v1/references/baseline-v0.json; benchmarks/optimizer-v1/baselines/baseline-v0.json.

## 02 — Objective V1A

- **Datum / Commit:** 2026-09-19; Investigation-Start **f1b318f945e2797208df95252c560e3dd19fdbff**; A/B-Daten **3c0728acbeb0c7eb99fd6537d7c0805378d08b94**; Doku **134b47b6a590c3ef14bc54341733831f49e5ecf9**.
- **Forschungsfrage:** Behebt ein Soul-Axis-Path-AUC plus separater Endbuild, scalarisiert als sqrt(Path × End), das terminal-lastige Buildpath-Verhalten ohne Search-Änderung?
- **Aufbau:** Gleiche State-Utility wie baseline-v0; nur die Aggregation wurde auf Path-AUC plus Endbuild geändert. A/B über SMALL/EXACT, CONTROLLED und sechs 40k-Fälle mit gemeinsamen Path-/End-Observables.
- **Bestätigter Befund:** 9/9 Pfade waren legal; nur 2/9 verbesserten Path, 4/9 regressierten End nicht, 0/9 verbesserten Path bei erhaltenem End. Alle V1A-40k-Läufe kauften erstmals bei 40k; Warden Hybrid zeigte zusätzlich eine Search/Objective-Kompatibilitätslücke.
- **Interpretation:** Der konkrete V1A-Scalar löst das Produktproblem nicht; das widerlegt nicht Path-AUC als separate Dimension.
- **Status:** **REJECTED** — für Aktivierung des konkreten V1A-Scalars.
- **Erledigt / ausgeschlossen:** Den identischen sqrt(Path × End)-V1A-Scalar unter unveränderter Semantik erneut zu testen ist nicht begründet.
- **Offen:** Eine andere Scalarisierung wäre eine neue Hypothese. Die damalige Folgefrage, Path und End getrennt zu halten, wurde in #03 untersucht.
- **Pfade:** docs/research/optimizer-next/objective-v1-investigation.md; benchmarks/optimizer-v1/experiments/objective-v1a/; app/search-objective-v1.mjs.

## 03 — Path/End Pareto

- **Datum / Commit:** 2026-09-19; Experiment-Source **1e22e035b99393a180570c600552f4ee09a11b02**; Daten **2975c5beded8dcbfbcc1f3dd85f6bd222dce31c2**; Doku **2464e0625e3006a893fc3b39c2bd12af67fbb92b**.
- **Forschungsfrage:** Zeigt der echte 2D-Vektor (Path-AUC, Endbuild) relevante Trade-offs, ohne Path/End erneut zu scalarisieren?
- **Aufbau:** SMALL vollständig über fünf terminale Kandidaten; CONTROLLED Warden/Infernus über die feste Union beobachteter baseline-v0- und V1A-Kandidaten. CONTROLLED ist ausdrücklich nicht exhaustiv.
- **Bestätigter Befund:** SMALL hatte genau einen Pareto-Punkt. Beide CONTROLLED-Fälle hatten reproduzierbar zwei Pareto-Punkte: baseline-v0 und eine Path-bessere Lösung mit End-Verlust; baseline-v0 wurde in keinem dieser festen Pools dominiert.
- **Interpretation:** Path und End enthalten getrennte Information; der beobachtete Trade-off kann aber Search-Coverage widerspiegeln und ist keine Suchraumgrenze.
- **Status:** **PARTIAL**.
- **Erledigt / ausgeschlossen:** Der konkrete feste Kandidatenpool rechtfertigt Multiobjective-Forschung; er beweist weder globale Pareto-Optimalität noch einen unvermeidbaren Path-vs-End-Trade-off.
- **Offen:** Ob Search die getrennten Ziele aktiv besser abdecken kann, wurde in #04 geprüft.
- **Pfade:** docs/research/optimizer-next/path-end-pareto-experiment.md; benchmarks/optimizer-v1/experiments/path-end-pareto/.

## 04 — Controlled Multiobjective Beam

- **Datum / Commit:** 2026-09-19; Experiment-Source **69fd77fa1a1394775df227112554c837193df4a4**; Daten **0de29f54bedadc49be010dd333f2547838cb1131**; Doku **93260c0378547c1391ce76b4d46f5f039ac28eaf**.
- **Forschungsfrage:** Kann eine CONTROLLED-only Beam-Suche Path und End getrennt erhalten und bessere Pareto-Lösungen finden, ohne versteckte Scalarisierung?
- **Aufbau:** Warden/Infernus Hybrid, Width 8/16/32/64, je zwei vollständige Wiederholungen ohne Wallclock-Truncation; 2D-Pareto-Retention, future-safe Dedupe und Terminal-Audit.
- **Bestätigter Befund:** Front-Hashes waren reproduzierbar. Ab Width 32 fand die Suche in beiden CONTROLLED-Fällen einen einzelnen Kandidaten, der beide zuvor eingefrorenen Pareto-Punkte dominierte; Width 64 verbesserte die Front nicht weiter. First-Front-Größen blieben klein.
- **Interpretation:** Der frühere CONTROLLED-Trade-off war mindestens teilweise Search-Coverage-bedingt. Das ist kein globaler Optimalitätsbeweis.
- **Status:** **CONFIRMED** — im CONTROLLED-Scope.
- **Erledigt / ausgeschlossen:** Frontier-Explosion und notwendige First-Front-Diversity sind in diesen zwei CONTROLLED-Fällen nicht beobachtet; daraus folgt nichts Allgemeines für 40k.
- **Offen:** Die damalige Transferfrage auf 40k wurde in #05 getestet.
- **Pfade:** docs/research/optimizer-next/controlled-multiobjective-beam-experiment.md; benchmarks/optimizer-v1/experiments/controlled-multiobjective-beam/; benchmarks/optimizer-v1/controlled-multiobjective-beam.mjs.

## 05 — 40k Multiobjective Shadow

- **Datum / Commit:** 2026-09-19; finale Daten **03dd2e6faa03040bb908baa97a59db758871102f**; Doku **7a1c094b355d8b1d75179d326505529ff9ea1c76**, Statusabgleich **b60ce6c8c48ab451145daf587e7214bcacac3f9a**.
- **Forschungsfrage:** Überträgt sich der CONTROLLED-Erfolg des Multiobjective-Beams unter dem 60-s-Produktbudget auf die sechs 40k-Fälle?
- **Aufbau:** Warden/Infernus × Weapon/Spirit/Hybrid, 60 s pro Fall; Production unverändert, Multiobjective nur als Shadow mit getrenntem Path/End.
- **Bestätigter Befund:** Alle sechs Shadow-Läufe starteten Width 4, keiner schloss Width 4 innerhalb 60 s ab und keiner erreichte einen terminalen Kandidaten. Die partiellen First Fronts blieben klein (max. 6).
- **Interpretation:** Der CONTROLLED-Erfolg überträgt sich unter diesem Budget nicht ausreichend auf 40k; eine Frontier-Explosion ist nicht der gemessene Grund.
- **Status:** **REJECTED** — für die Transferhypothese unter dem getesteten 60-s-Vertrag.
- **Erledigt / ausgeschlossen:** Ein unveränderter 40k-Multiobjective-Shadow muss unter gleicher Semantik nicht erneut laufen, um denselben Transfer zu prüfen.
- **Offen:** Wo die Search-Zeit verloren geht, wurde in #06 profiliert.
- **Pfade:** docs/research/optimizer-next/40k-multiobjective-shadow-experiment.md; benchmarks/optimizer-v1/experiments/40k-multiobjective-shadow/.

## 06 — Width-4 Profiling

- **Datum / Commit:** 2026-09-19; Mess-Source **40354a05601c84f40988b45a27f26b5f0440b3e1**; Daten **eb72121cef08642bb980814466c4750e364302d7**; Doku **a5da4d7703047add829cfd284427cb16ee62b9f5**.
- **Forschungsfrage:** Warum erreicht 40k-Multiobjective bei Width 4 keine terminale Ausgabe bzw. zu wenig natürlichen Fortschritt?
- **Aufbau:** Warden Hybrid und Infernus Hybrid, Production vs Multiobjective, je Control- und Profiling-Lauf unter 60 s; inklusive/nestende Timer wurden nur dort additiv interpretiert, wo Abschnitte tatsächlich sequenziell sind.
- **Bestätigter Befund:** Production materialisiert früh Save-to-horizon-Terminals, Multiobjective damals nicht. Bei Warden war vollständiges Pareto-Layering großer Unique-Pools der größte zusätzliche Kostenblock; bei Infernus dominierte Evaluation innerhalb Vector/Dedupe. Dedupe entfernte nur 1.24% bzw. 0.10%.
- **Interpretation:** Es gibt keine einzelne gemeinsame Ursache. Direct action generation, Diversity, Endbuild-Scoring und Terminal-Audit waren nicht die gemessenen Hauptblocker.
- **Status:** **CONFIRMED** — für die zwei profilierten Hybridfälle.
- **Erledigt / ausgeschlossen:** Die fehlende Infernus-Terminalausgabe darf nicht als schlechterer natürlicher Soul-Fortschritt interpretiert werden; Multiobjective erreichte dort profiliert mehr Souls als der normale Production-Beam.
- **Offen:** Nach Änderungen an Retention/Evaluation/History-Kosten ist eine neue Profilierung nötig, statt diese Attribution unverändert fortzuschreiben.
- **Pfade:** docs/research/optimizer-next/40k-multiobjective-width4-profiling.md; benchmarks/optimizer-v1/experiments/40k-multiobjective-width4-profile/.

## 07 — Carry Objective A/B

- **Datum / Commit:** 2026-09-20; Source **7c2ba3f2088695974ce634c1955273a012cfcba6**; Result erzeugt 2026-09-20T01:30Z.
- **Forschungsfrage:** Verändert ein Carry-Objective von 50/50 Damage/Survival + 70/30 Spezialisierung zu 75/25 + 85/15 die Bewertung und die gefundenen Warden-Builds?
- **Aufbau:** Stage 1 rescorte gespeicherte 40k-Warden-Pfade ohne neue Search. Nach bestandenem Gate führte Stage 2 kontrollierte Multiobjective-Suchen für Weapon/Spirit/Hybrid mit identischem Search-Vertrag durch.
- **Bestätigter Befund:** Die kombinierte Änderung verschob Pareto-/Dominanzrelationen und führte in allen drei Focus-Fällen zu anderen Search-Ergebnissen; die B-geführten Kandidaten deckten jeweils die unter B beobachtete Union-Front ab.
- **Interpretation:** Die Objective-Gewichte sind search-relevant; weil Außen- und Spezialisierungsgewicht gleichzeitig geändert wurden, ist die Ursache noch nicht isoliert.
- **Status:** **PARTIAL**.
- **Erledigt / ausgeschlossen:** Die Hypothese, die Carry-Gewichte seien im beobachteten Warden-Scope praktisch inert, ist nicht haltbar.
- **Offen:** Welcher Anteil von 75/25 vs 85/15 den Effekt trägt, wurde in #08 isoliert.
- **Pfade:** benchmarks/optimizer-v1/experiments/carry-objective-ab/results.json; benchmarks/optimizer-v1/experiments/carry-objective-ab/summary.json; tools/optimizer-carry-objective-ab.mjs.

## 08 — Carry Objective Isolation

- **Datum / Commit:** 2026-09-20; Source **6d18f1e6a40c4262acb0729fa7c926e535f3a62e**; Result erzeugt 2026-09-20T07:31Z.
- **Forschungsfrage:** Kommt der A/B-Effekt vom Damage/Survival-Gewicht, von der Weapon/Spirit-Spezialisierung oder von ihrer Interaktion?
- **Aufbau:** Exaktes algebraisches 2×2-Rescoring der gespeicherten festen Kandidaten; keine Search und kein Evaluator-Rerun. A=50/50+70/30, B1=75/25+70/30, B2=50/50+85/15, B3=75/25+85/15.
- **Bestätigter Befund:** Weapon zeigte die relevante Dominanzänderung erst bei B3; Spirit reagierte auf beide Faktoren mit teils gegensätzlichen Dominanzänderungen; Hybrid blieb im festen Zwei-Kandidaten-Pool über A/B1/B2/B3 unverändert.
- **Interpretation:** Es gibt keinen universellen einzelnen Gewichtsknopf; Interaktion und Focus sind relevant.
- **Status:** **CONFIRMED** — für den festen Kandidatenpool.
- **Erledigt / ausgeschlossen:** Eine monokausale Erklärung „nur Damage/Survival“ oder „nur Spezialisierung“ ist für alle drei Focus-Fälle ausgeschlossen.
- **Offen:** Wo sinnvolle Zwischenwerte liegen, wurde in #09 gerastert; Search-Verhalten musste danach separat validiert werden.
- **Pfade:** benchmarks/optimizer-v1/experiments/carry-objective-isolation/results.json; tools/optimizer-carry-objective-isolation.mjs; .github/workflows/optimizer-carry-objective-isolation.yml.

## 09 — Carry Objective Calibration

- **Datum / Commit:** 2026-09-20; Source **8cbfc40f8c8a3e80f96b3f1e89828eb64845a280**; Result erzeugt 2026-09-20T08:05Z.
- **Forschungsfrage:** Wie verändern Zwischenwerte zwischen Baseline und aggressivem Carry-Objective die festen Kandidatenrelationen?
- **Aufbau:** Fixed-candidate Cross-Rescoring ohne Search: Damage/Survival 60/40, 65/35, 70/30, 75/25 × Spezialisierung 70/30, 77.5/22.5, 85/15; Hybrid bleibt 50/50.
- **Bestätigter Befund:** Übergänge sind Focus-abhängig. Weapon kippt im getesteten Pool bereits bei allen gerasterten Damage-Gewichten zum aggressiv entdeckten Kandidaten; Spirit zeigt stärkere Abhängigkeit von beiden Achsen; Hybrid kippt zwischen 60/40 und 65/35. 70/30 + 77.5/22.5 wurde als intermediärer Search-Kandidat weiterverfolgt.
- **Interpretation:** Das Raster beschreibt Bewertungsgrenzen im vorhandenen Kandidatenpool, nicht die Pfade, die eine Search unter diesen Gewichten entdecken würde.
- **Status:** **PARTIAL**.
- **Erledigt / ausgeschlossen:** Aus Fixed-candidate Calibration darf keine Production-Empfehlung oder Search-Qualitätsbehauptung abgeleitet werden.
- **Offen:** Ob der intermediäre „sweet“-Kandidat in Search robust ist, wurde in #10 getestet.
- **Pfade:** benchmarks/optimizer-v1/experiments/carry-objective-calibration/results.json; tools/optimizer-carry-objective-calibration.mjs; .github/workflows/optimizer-carry-objective-calibration.yml.

## 10 — Carry Objective Search Validation

- **Datum / Commit:** 2026-09-20; Source **71c6b756ef91707ec1472ba575a3e8946b2cb492**; Summary erzeugt 2026-09-20T08:43Z.
- **Forschungsfrage:** Wie verhalten sich „sweet“ 70/30 Damage/Survival + 77.5/22.5 Spezialisierung und „aggressive“ 75/25 + 85/15 in echter kontrollierter Warden-Search?
- **Aufbau:** Weapon/Spirit/Hybrid, zwei 60-s-Wiederholungen pro Objective mit gegenbalancierter A/B-Reihenfolge; gleicher Search-Algorithmus, Kandidatenraum und Referenz. Gefundene Kandidaten wurden anschließend unter beiden Objectives cross-gescort.
- **Bestätigter Befund:** Front-IDs waren je Objective in beiden Wiederholungen stabil. Bei Weapon und Hybrid dominierte der vom aggressiven Objective gefundene Kandidat den Sweet-Kandidaten sogar unter beiden getesteten Objectives; bei Spirit bevorzugte jedes Objective seinen jeweils eigenen Kandidaten.
- **Interpretation:** „Sweet ist generell besser“ ist nicht belegt. Objective-Guidance verändert Search-Coverage, und die Wirkung ist Focus-abhängig.
- **Status:** **PARTIAL**.
- **Erledigt / ausgeschlossen:** Ein universeller Carry-Gewinner zwischen diesen zwei Gewichtssätzen ist aus den drei Warden-Fällen nicht ableitbar.
- **Offen:** Warum Sweet im Weapon-Fall einen Kandidaten verliert, den es nachträglich selbst besser bewertet, wurde in #11 lokalisiert.
- **Pfade:** benchmarks/optimizer-v1/experiments/carry-objective-search-validation/results.json; benchmarks/optimizer-v1/experiments/carry-objective-search-validation/summary.json; tools/optimizer-carry-objective-search-validation.mjs.

## 11 — Search Divergence Diagnosis

- **Datum / Commit:** 2026-09-20; Source **ec577d3710b68130695ee8ae789f2a5edae388b8**.
- **Forschungsfrage:** Wo verliert Sweet Width 4 im Warden-Weapon-Fall erstmals den später interessanten aggressiv gefundenen Pfad, und welche Mechanismen sind dort ursächlich?
- **Aufbau:** Exakter Prefix-Trace bis zur ersten Divergenz; gleicher Kandidatenpool wurde unter Sweet und aggressivem Objective analysiert. Generation, Dedupe, Pareto-Layer, Retention, Diversity und Runtime wurden getrennt geprüft.
- **Bestätigter Befund:** Erste Divergenz bei Depth 14 / 3,600 Souls: der Pfad Health → High Velocity Mag ist unter Sweet nach Dedupe vorhanden, liegt dort auf Pareto-Layer 15 und fällt aus Width-4-Retention; unter aggressiver Bewertung ist derselbe Kandidat Layer 0 und wird auf demselben Pool behalten.
- **Interpretation:** Primärklassifikation ist Objective-Guidance + Beam/Pareto-Retention.
- **Status:** **CONFIRMED**.
- **Erledigt / ausgeschlossen:** Candidate generation, Dedupe als direkter Verlust, Runtime und Diversity sind als erste Ursache dieses konkreten Divergenzpunkts ausgeschlossen.
- **Offen:** Ob der lokal verworfene Ast unter Sweet tatsächlich besseren zukünftigen Wert hat, wurde in #12 geprüft.
- **Pfade:** benchmarks/optimizer-v1/experiments/search-divergence-diagnosis/results.json; tools/optimizer-search-divergence-diagnosis.mjs; .github/workflows/optimizer-search-divergence-diagnosis.yml.

## 12 — Value-to-Go Diagnosis

- **Datum / Commit:** 2026-09-20; Source **84e6768117007a1575b19249cb9856b0bde6b450**.
- **Forschungsfrage:** Hat der bei 3.6k von Sweet verworfene High-Velocity-Ast unter identischer Sweet-Continuation besseren Value-to-Go als die vier tatsächlich behaltenen Seeds?
- **Aufbau:** Fünf Seeds wurden mit identischer deterministischer Width-4-Sweet-Continuation und Step-Budget 160 ohne Wallclock fortgesetzt; Production-Dedupe und -Pareto-Retention wurden verwendet, Save-to-40k materialisiert.
- **Bestätigter Befund:** Die Target-Continuation-Front dominierte jede der vier Competitor-Fronten; die globale Union-Front bestand nur aus dem Target-Seed mit Path 0.4417724595 / End 0.4459173427.
- **Interpretation:** Für genau diese Seeds und diese Continuation-Semantik ist der lokale Sweet-Retention-Entscheid myopisch.
- **Status:** **CONFIRMED** — im getesteten Continuation-Scope.
- **Erledigt / ausgeschlossen:** „Der verworfene Ast war ohnehin langfristig schlechter“ ist für diesen Vergleich widerlegt. Daraus folgt kein globales Optimum.
- **Offen:** Wie viel zusätzlicher Horizont genügt, damit Sweet den Vorteil erkennt, wurde in #13 getestet.
- **Pfade:** benchmarks/optimizer-v1/experiments/value-to-go-diagnosis/results.json; tools/optimizer-value-to-go-diagnosis.mjs; .github/workflows/optimizer-value-to-go-diagnosis.yml.

## 13 — Crossover Horizon Test

- **Datum / Commit:** 2026-09-20; Source **e0b4f6384b15b865f7887addf28d27df9db81a5e**.
- **Forschungsfrage:** Ab welchem gemeinsamen Sweet-Horizont kippen Score, Paar-Pareto und gepoolte Width-4-Retention zugunsten des bei 3.6k verlorenen Seeds?
- **Aufbau:** Deterministische per-seed Width-4-Continuation ohne Wallclock; initiale Horizonte 4.0k, 4.4k, 5.2k, 6.8k mit adaptiver Verlängerung nur falls nötig.
- **Bestätigter Befund:** Score-, Pairwise-Pareto- und gepoolter Retention-Crossover traten bereits bei 4,000 Souls auf, also +400 Souls nach der 3.6k-Divergenz. Die Initial-Grid reichte; Klassifikation H1_SHORT_LOOKAHEAD.
- **Interpretation:** Der bekannte Myopiefehler ist in diesem Seed-Vergleich sehr kurz-horizontig.
- **Status:** **CONFIRMED**.
- **Erledigt / ausgeschlossen:** Für diesen Divergenzfall ist kein langer Lookahead nötig, um den bekannten Target-Seed relativ zu den vier Seeds zu erkennen.
- **Offen:** Ob eine gemeinsame-Horizont-Retention im vollständigen Search nützlich und bezahlbar ist, wurde ab #14 untersucht.
- **Pfade:** benchmarks/optimizer-v1/experiments/crossover-horizon-test/results.json; tools/optimizer-crossover-horizon-test.mjs; .github/workflows/optimizer-crossover-horizon-test.yml.

## 14 — Common-Horizon Retention Shadow

- **Datum / Commit:** 2026-09-21; aktuell gespeicherter Result-Source **b2fc48a8e2640347e50029d6a78d6871138b8a26**.
- **Forschungsfrage:** Kann eine materialisierte Common-Horizon-Bewertung den bekannten 3.6k-Seed retten und verändert sie den vollständigen Warden-Weapon-Search?
- **Aufbau:** Kandidaten eines Retention-Pools werden, wo zulässig, per Save bis zum nächsten gemeinsamen ökonomischen Horizont materialisiert und dort Path/End-bewertet; Production bleibt unverändert. Exakter Divergenzpool, isolierte Target-Continuation und vollständiger Shadow wurden getrennt gemessen.
- **Bestätigter Befund:** Im 3.6k/4.0k-Pool steigt das Target von Layer 15 auf Layer 0 und wird retained. Der Full Shadow verändert den Search-Baum und die finale Front, kostet aber deutlich mehr Arbeit; 111 Pools wurden projiziert, 69 übersprungen und 59,000 Save-Projektionen materialisiert.
- **Interpretation:** Lokale Rettung funktioniert, aber ein anderes finales Ergebnis beweist nicht, dass gerade die bekannte gerettete Ancestry final wertvoll ist. #16 zeigt später, dass diese Ancestry erneut verloren geht.
- **Status:** **PARTIAL**.
- **Erledigt / ausgeschlossen:** Die lokale Common-Horizon-Idee kann den bekannten First-Loss-Pool korrigieren; daraus folgt keine Production-Policy und kein Kausalbeweis für die spätere finale Front.
- **Offen:** Materialisierungskosten und tatsächliche Relevanz der geänderten Retentions wurden in #15/#16 getrennt untersucht.
- **Pfade:** benchmarks/optimizer-v1/experiments/common-horizon-retention-shadow/results.json; tools/optimizer-common-horizon-shadow.mjs; .github/workflows/optimizer-common-horizon-shadow.yml.

## 15 — Common-Horizon Score-Only Shadow

- **Datum / Commit:** 2026-09-21; Result-Source **b2fc48a8e2640347e50029d6a78d6871138b8a26**; aktueller Daten-Commit **678aa741e9e13846a9ec0bf3edc389fd6bf95e72**.
- **Forschungsfrage:** Kann die Common-Horizon-Retention ohne materialisierte Save-Nodes exakt dieselben Retention-Entscheidungen treffen?
- **Aufbau:** Materialized vs Score-only zunächst auf dem 248-Kandidaten-Divergenzpool, danach vollständiger Search; Score-only bewertet den Originalpfad direkt am gemeinsamen Horizont.
- **Bestätigter Befund:** Im exakten Pool waren Path/End-Differenzen 0, Pareto-Layer identisch und Retention identisch. Im Full Search waren normalisierter Selection-Trace, Work-Shape und finale Front zwischen materialized und score-only gleich. Score-only reduzierte Materialisierungskosten, blieb aber wegen des geänderten Search-Baums deutlich teurer als Baseline.
- **Interpretation:** Die Node-Materialisierung ist nicht semantisch notwendig; sie erklärt aber auch nicht den gesamten Overhead der Common-Horizon-Policy.
- **Status:** **CONFIRMED** — für die Äquivalenz zur materialisierten Shadow-Semantik.
- **Erledigt / ausgeschlossen:** Eine erneute materialized-vs-score-only-Äquivalenzmessung unter unveränderter Semantik ist nicht nötig.
- **Offen:** Ob die Retention-Änderungen selbst downstream wertvoll sind, wurde in #16 auditiert.
- **Pfade:** benchmarks/optimizer-v1/experiments/common-horizon-score-only-shadow/results.json; tools/optimizer-common-horizon-score-only.mjs; .github/workflows/optimizer-common-horizon-score-only.yml.

## 16 — Common-Horizon Retention Pool Audit

- **Datum / Commit:** 2026-09-21; Result-Source **b2fc48a8e2640347e50029d6a78d6871138b8a26**.
- **Forschungsfrage:** Welche Common-Horizon-Pools ändern tatsächlich Retention, und überlebt gerettete Ancestry bis zu späteren bzw. finalen Search-Ergebnissen?
- **Aufbau:** Score-only Full Search mit gepaartem No-audit-Control; direkte Parent-Chain-Ancestry ist Autorität. Pools werden Typ 0–4 nach Selection- und Downstream-Relevanz klassifiziert.
- **Bestätigter Befund:** Von 111 angewandten Pools waren 87 Typ 0 (keine Retention-Änderung), 24 Typ 1 (Selection geändert, aber keine gerettete Ancestry überlebt ausreichend weit), 0 Typ 2/3/4. Der bekannte 3.6k-Target-Seed ist Typ 1 und wird nach lokaler Rettung bei einer späteren Retention wieder eliminiert.
- **Interpretation:** „Retention geändert“ ist in diesem Lauf kein Proxy für downstream Wert; ein einfacher Soul-Gap-Threshold ist durch die Daten nicht begründet.
- **Status:** **REJECTED** — für die Hypothese, dass die beobachteten Common-Horizon-Selection-Changes automatisch downstream wertvoll sind.
- **Erledigt / ausgeschlossen:** Die 24 geänderten Pools dürfen nicht als 24 nützliche Rettungen gezählt werden; im auditierten Lauf erreicht keine davon die finale Front.
- **Offen:** Wo und auf welche Weise die geretteten Lineages erstmals wieder verloren gehen, wurde in #17 lokalisiert.
- **Pfade:** benchmarks/optimizer-v1/experiments/common-horizon-retention-pool-audit/results.json; tools/optimizer-common-horizon-retention-audit.mjs; .github/workflows/optimizer-common-horizon-retention-audit.yml.

## 17 — Retention First-Loss Audit

- **Datum / Commit:** 2026-09-21; Source/Doku **b2fc48a8e2640347e50029d6a78d6871138b8a26**.
- **Forschungsfrage:** An welcher späteren Stelle verlieren die durch Common-Horizon geänderten Pools ihre geretteten Ancestries tatsächlich?
- **Aufbau:** Ein deterministischer Infinity-time Warden Weapon Carry Width-4 Score-only-Lauf mit gepaartem No-observer-Control; direkte und semantische Post-Dedupe-/Retention-Verfolgung der 26 rescued origins.
- **Bestätigter Befund:** Alle 26 rescued origins haben einen echten späteren semantischen Retention-Loss. Beim bekannten Seed 93260772842f0c27 entstehen am Loss-Step 14 24 direkte und 24 semantische Post-Dedupe-Kandidaten, aber 0 werden retained. Observer-Neutralität für Trace, Front und Search-Work ist bestätigt.
- **Interpretation:** Direkter Label-/Dedupe-Verlust erklärt diese traced losses nicht; metric-history influence ist ausdrücklich nicht ausgeschlossen.
- **Status:** **CONFIRMED**.
- **Erledigt / ausgeschlossen:** Für den bekannten Seed ist klar, dass die Common-Horizon-Rettung nicht an unmittelbarer Dedupe-Repräsentation scheitert, sondern an einer späteren Retention.
- **Offen:** Ob diese spätere Retention gegen den vollständigen gepoolten Konkurrenzsatz tatsächlich falsch ist, wurde in #18 counterfactual geprüft.
- **Pfade:** benchmarks/optimizer-v1/experiments/retention-first-loss/research-note.md; benchmarks/optimizer-v1/experiments/retention-first-loss/results.json; tools/optimizer-retention-first-loss.mjs.

## 18 — Retention Loss Counterfactual

- **Datum / Commit:** 2026-09-21; Source/Doku **b2fc48a8e2640347e50029d6a78d6871138b8a26**.
- **Forschungsfrage:** Würde der bekannte Target-Lineage beim ersten späteren Loss unter kurzem weiterem Horizont gegen den vollständigen gepoolten Gewinner-Satz wieder konkurrenzfähig werden?
- **Aufbau:** Deterministische Rekonstruktion des Step-14-Snapshots, gegen gespeicherte Kompaktevidenz gegengeprüft. Vollständiger captured-pool Rerank bei 4.4k sowie per-seed Continuations zu 4.4k/5.2k/6.8k; Width 4 bleibt heuristisch.
- **Bestätigter Befund:** Beim vollständigen 4.4k-Pool-Rerank wird das Target nicht in Width 4 retained; bester Target-Layer ist 8. Bei 4.4k, 5.2k und 6.8k sind 24/24 Target-Continuation-Fronten jeweils von mindestens einem Punkt aus den gepoolten vier tatsächlichen Gewinner-Fronten dominiert.
- **Interpretation:** Die frühere lokale 3.6k-Rettung bedeutet nicht, dass dieselbe Lineage an der späteren Retention weiter geschützt werden sollte. Die Counterfactual-Evidenz ist wegen separater per-seed Budgets und fehlender same-Soul-Horizon-Closure nicht endgültig.
- **Status:** **PARTIAL**.
- **Erledigt / ausgeschlossen:** Die früher beobachteten zwei 5.2k-Trade-offs gegen nur einen Max-Path-Winner reichen nicht als Gegenbeleg für den vollständigen Pool; sie dürfen nicht als Full-pool-Rerank interpretiert werden.
- **Offen:** Explizit ungetestet bleibt ein Lineage-vs-Lineage-Vergleich unter **einem gleichen Total-State-Budget**, Width 4 und Width 16, bei 5.2k/6.8k inklusive same-Soul-Closure.
- **Pfade:** benchmarks/optimizer-v1/experiments/retention-loss-counterfactual/research-note.md; benchmarks/optimizer-v1/experiments/retention-loss-counterfactual/results.json; tools/optimizer-retention-loss-counterfactual.mjs.

## Pflegepflicht

Nach jedem abgeschlossenen Optimizer-Experiment ist dieser Index im selben Research-Zyklus zu aktualisieren. Neue Einträge müssen Befund, Interpretation und offenen Punkt getrennt halten und auf die Primärartefakte verweisen.

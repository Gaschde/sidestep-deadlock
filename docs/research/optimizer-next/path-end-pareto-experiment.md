# Optimizer V1 — Path vs End Pareto Experiment

Status: **ABGESCHLOSSEN — Multiobjective experimentell weiterverfolgen; Production bleibt unverändert**

Ausgangs-HEAD: `134b47b6a590c3ef14bc54341733831f49e5ecf9`

Finaler reproduzierter Experiment-Source-Commit: `1e22e035b99393a180570c600552f4ee09a11b02`

Finaler Daten-Commit vor Dokumentation: `2975c5beded8dcbfbcc1f3dd85f6bd222dce31c2`

## Fragestellung

Nach dem verworfenen V1A-Scalar

`sqrt(Path-AUC × Endbuild)`

wurde Path-Qualität nicht erneut scalarisiert. Das Experiment betrachtet stattdessen ausschließlich den zweidimensionalen Vektor:

`(Path-AUC, Endbuild)`

Ein Kandidat ist nur dominiert, wenn ein anderer Kandidat in beiden Dimensionen mindestens gleich gut und in mindestens einer strikt besser ist.

Keine 70/30-Gewichtung, kein geometrisches Mittel und kein versteckter Gesamt-Score werden für die Pareto-Auswertung verwendet.

## Kandidatensatz

### SMALL

`small-exact-warden-carry-weapon`

- bestehende `searchLabels`-Exact-Infrastruktur
- bestehende synthetische Soul-Achse und eingefrorene Referenz
- 5 terminale Kandidaten
- alle 5 legal replay-verifiziert
- für den modellierten SMALL-Raum vollständig

### CONTROLLED

`controlled-warden-carry-hybrid` und `controlled-infernus-carry-hybrid`

Der Kandidatensatz wird vor der Pareto-Auswertung erzeugt als Union aus zwei bereits vorhandenen Scorern:

- `baseline-v0`
- `objective-v1a-soul-auc-terminal-gmean`

Beide laufen mit dem bestehenden CONTROLLED-Vertrag:

- Beam Width 8 → 16
- nur vollständig abgeschlossene Widths
- vollständiger Terminal-Audit erforderlich

Der Diagnose-Observer beeinflusst die Suche nicht: Terminalkandidaten werden während Search/Audit nur als Node-Referenzen gepuffert und erst nach allen Search-/Audit-Entscheidungen materialisiert. Ein Regressionstest vergleicht denselben SMALL-Beam mit und ohne Observer und bestätigt identischen Gewinner, Pfad und Search-Telemetrie.

CONTROLLED ist **nicht exhaustiv**. Die Pareto-Front gilt nur relativ zu diesem festen beobachteten Kandidatenpool.

## Reproduzierbarkeit

Zwei aufeinanderfolgende Läufe mit unveränderter Experimentsemantik ergaben exakt dieselben Kandidatenmengen:

| Case | Kandidaten | Kandidaten-Hash |
| --- | ---: | --- |
| SMALL Warden Weapon | 5 | `05abf8faa7514a0280f0c8cb6b72c4b944b9d19ba9bed36426f310d892ee8de1` |
| CONTROLLED Warden Hybrid | 322 | `7c8b9cd82426a78faf9a01763023f1dee8e7f15baca48a8f529c53bd953f3a67` |
| CONTROLLED Infernus Hybrid | 361 | `e40a72074629213d46c8fe263b984725c33472acb551e78aa4c05133b1015db5` |

Auch Pareto-IDs und Path-/End-Werte waren identisch.

Der finale Lauf hatte 101/101 grüne JavaScript-Tests.

## Pareto-Front SMALL

Es existiert genau **ein** Pareto-Punkt:

| Kandidat | Path-AUC | Endbuild |
| --- | ---: | ---: |
| baseline-v0 / `aac31f939aa032cf` | 0.500000 | 0.485863 |

`baseline-v0` entspricht exakt diesem Kandidaten und liegt damit auf der Front.

Es gibt im SMALL-Fall keinen Path-vs-End-Trade-off.

## Pareto-Front CONTROLLED — Warden Hybrid

322 legale Kandidaten, davon genau **zwei** Pareto-optimal:

| Kandidat | Path-AUC | Endbuild | Transaktionen | erster Kauf |
| --- | ---: | ---: | ---: | ---: |
| baseline-v0 / `4750700aa2e5607b` | 0.433542 | 0.417532 | 9 | 1'600 |
| Path-orientiert / `d4d79e4664fc8b62` | 0.438080 | 0.414560 | 8 | 800 |

Trade-off gegenüber baseline-v0:

- Path-AUC: **+0.004538** bzw. rund **+1.05 %**
- Endbuild: **−0.002971** bzw. rund **−0.71 %**

Es gibt **keinen** Kandidaten mit besserem Path ohne Endbuild-Verlust.

Es gibt **keinen** Kandidaten mit besserem Endbuild ohne Path-Verlust.

## Pareto-Front CONTROLLED — Infernus Hybrid

361 legale Kandidaten, davon genau **zwei** Pareto-optimal:

| Kandidat | Path-AUC | Endbuild | Transaktionen | erster Kauf |
| --- | ---: | ---: | ---: | ---: |
| baseline-v0 / `97644bd71a4db681` | 0.443688 | 0.436432 | 8 | 1'600 |
| Path-orientiert / `8d81ce6c57d9c4da` | 0.448848 | 0.429789 | 9 | 1'600 |

Trade-off gegenüber baseline-v0:

- Path-AUC: **+0.005160** bzw. rund **+1.16 %**
- Endbuild: **−0.006643** bzw. rund **−1.52 %**

Auch hier gibt es weder besseren Path ohne Endbuild-Verlust noch besseren Endbuild ohne Path-Verlust.

## Position von baseline-v0

Bestätigter Befund:

- SMALL: baseline-v0 ist der einzige Pareto-Vektor.
- CONTROLLED Warden: baseline-v0 liegt auf der zweipunktigen Front.
- CONTROLLED Infernus: baseline-v0 liegt auf der zweipunktigen Front.
- baseline-v0 wird in keinem Fall dominiert.

Damit war das zentrale V1A-Problem nicht, dass baseline-v0 offensichtlich Pareto-schlecht wäre. Die beobachtete Verbesserung des Paths kostet in beiden CONTROLLED-Fällen tatsächlich Endbuild-Qualität.

## Gegenbeispiele / Path-Verhalten

### Unnötig frühe Käufe / zu langes Sparen

Kein extremer Befund:

- Warden Path-Kandidat kauft bei 800 statt baseline bei 1'600.
- Infernus startet bei beiden Pareto-Punkten bei 1'600.
- längste beobachtete No-Shop-Spanne auf den CONTROLLED-Fronten: 1'200–1'600 Souls.

Das frühere Warden-Investment korreliert mit dem besseren Path, ist allein aber kein Beweis für Path-Gaming.

### Zwischenitem-Churn / Sell-Rebuy

Churn ist vorhanden, aber nicht auf pathologisch hohe Transaktionszahlen eskaliert:

- Warden baseline: 9 Transaktionen; Rapid Rounds werden nach Sell wieder erworben; gleiche-Soul Sell/Replacement-Gruppe bei 6'800.
- Warden Path-Kandidat: 8 Transaktionen; Health Stimpak wird zweimal nach Replacement wieder erworben.
- Infernus baseline: 8 Transaktionen; Health Stimpak wird einmal nach Replacement wieder erworben.
- Infernus Path-Kandidat: 9 Transaktionen; Headshot Booster Sell/Rebuy sowie Health-Stimpak-Reacquisition; gleiche-Soul Sell/Replacement-Gruppe bei 4'800.

Es wurden keine Upgrade-Zyklen und keine explosionsartig langen Transaktionsfolgen auf der Pareto-Front gefunden.

Interpretation: Path-AUC erzeugt im beobachteten Raum **keinen offensichtlichen Spam-Kollaps**, aber Bridge-/Replacement-Churn bleibt ein reales Verhalten, das bei einer späteren Search-Änderung beobachtet werden muss. Daraus wird hier bewusst keine harte Item- oder Transaktionsregel abgeleitet.

## Entscheidung

### A. Ist `(Path-AUC, Endbuild)` als echtes Zwei-Ziel-Modell sinnvoll?

**Ja, als Modellierung und Diagnose.**

Die Darstellung macht genau den Trade-off sichtbar, den der V1A-Scalar verborgen hat. Path und End sind empirisch nicht austauschbar.

### B. Gibt es genug Pareto-Struktur für eine spätere Multiobjective-Search?

**Ja, für einen weiteren experimentellen Schritt.**

Beide CONTROLLED-Fälle liefern reproduzierbar zwei verschiedene nicht-dominierte Lösungen: baseline-v0 auf der Endbuild-Seite und eine Path-bessere Lösung mit Endbuild-Verlust.

Das ist klein, aber strukturell konsistent über beide CONTROLLED-Helden.

### C. Ist eine andere Modellierung schon nötig?

**Noch nicht belegt.**

Das Experiment widerlegt Path-AUC nicht. Es widerlegt vielmehr die Annahme, dass Path und End hier verlustfrei zu einem einzelnen symmetrischen Scalar zusammengezogen werden können.

Ein Endbuild-Constraint auf baseline-Niveau würde im beobachteten Kandidatensatz jede Path-Verbesserung entfernen und daher aktuell nur baseline-v0 reproduzieren.

### D. Entscheidung

**Multiobjective weiterverfolgen — experimentell, nicht Production.**

Production bleibt vollständig auf `baseline-v0`. Es wurde keine Production-Semantik, keine Search-Heuristik, kein Itemdatensatz und kein Solver geändert.

## Genau ein nächster Schritt

Einen **CONTROLLED-only Multiobjective-Beam-Versuch** bauen, der während der Suche die nicht-dominierten `(Path-AUC, Endbuild)`-Alternativen erhält, und ihn gegen die hier eingefrorenen Kandidaten/Fronten vergleichen — weiterhin ohne Production-Integration.

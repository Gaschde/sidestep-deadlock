# Lineage-vs-Lineage Capacity Test

Status: **PARTIAL — BUDGET-LIMITED**

## Forschungsfrage

Erklärt zu geringe lokale Search-Kapazität den späteren Verlust der bekannten Target-Lineage `93260772842f0c27`, oder bleibt sie bis mindestens 6.8k auch mit mehr lokaler Breite tatsächlich schlechter?

## Aufbau

- Warden Weapon Carry, Sweet-Objective, exakt gespeicherter Step-14-Verlustpool aus `retention-loss-counterfactual`.
- TARGET-LINEAGE: alle 24 semantischen Nachfolger der geretteten Lineage.
- WINNER-LINEAGE: die vier tatsächlich retained Gewinner desselben Pools.
- Bedingungen: Width 4/16 bei 5.2k und 6.8k.
- Alle Seeds einer Gruppe konkurrieren gemeinsam in genau einer Lineage-Search.
- Identischer Total-State-Cap von 500,000 generierten Zuständen pro Lineage-Gruppe; Width 16 erhält keinen höheren Cap.
- Gleiche Candidate Generation, Objective-/Reference-, Retention-, Economy- und Slot-Semantik.
- Am Zielhorizont wird eine unpruned Same-Soul-Closure über legale Käufe, Upgrades und Replacements expandiert. Äquivalente Closure-Zustände werden global nach Future-State + identischem Path/End-Vektor dedupliziert.
- Die erste Diagnoseversion deduplizierte Closure-Äquivalenz nur schichtweise. Nach globaler Closure-Deduplizierung wurde der komplette Test mit unverändertem 500k-Cap wiederholt. Die unten dokumentierten Werte stammen ausschließlich aus diesem korrigierten Lauf.

## Ergebnis

| Bedingung | Gruppe | generated | evaluated | transitions | retentions | max depth | Cap | Horizon | Closure | Front |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: |
| 5.2k / W4 | TARGET | 500000 | 14064 | 11051 | 13 | 30 | erreicht | ja | unvollständig | 2 |
| 5.2k / W4 | WINNER | 500000 | 11972 | 10660 | 13 | 30 | erreicht | ja | unvollständig | 1 |
| 5.2k / W16 | TARGET | 500000 | 18215 | 9240 | 13 | 30 | erreicht | ja | unvollständig | 2 |
| 5.2k / W16 | WINNER | 500000 | 20231 | 10459 | 14 | 31 | erreicht | ja | unvollständig | 1 |
| 6.8k / W4 | TARGET | 500000 | 36058 | 6203 | 11 | 28 | erreicht | ja | unvollständig | 1 |
| 6.8k / W4 | WINNER | 500000 | 36041 | 6018 | 11 | 28 | erreicht | ja | unvollständig | 1 |
| 6.8k / W16 | TARGET | 500000 | 27170 | 6422 | 22 | 38 | erreicht | ja | unvollständig | 2 |
| 6.8k / W16 | WINNER | 500000 | 30949 | 5712 | 11 | 28 | erreicht | ja | unvollständig | 1 |

Beobachtete, aber wegen unvollständiger Closure **nicht abschließend interpretierbare** Pareto-Relationen:

- 5.2k / Width 4: ein Target-Punkt ist nicht von der Winner-Front dominiert; kein Target-Punkt dominiert den Winner-Punkt.
- 5.2k / Width 16: qualitativ identisch zu Width 4.
- 6.8k / Width 4: die beobachtete Target-Front ist vollständig von der Winner-Front dominiert.
- 6.8k / Width 16: beide beobachteten Target-Punkte sind nicht dominiert und mindestens ein Target-Punkt dominiert den beobachteten Winner-Punkt.

## Interpretation

Der Width-16-Wechsel bei 6.8k wäre unter vollständiger Closure Evidenz für zusätzliche Search-Kapazität. Diese Schlussfolgerung ist hier **nicht zulässig**, weil TARGET und WINNER in allen vier Bedingungen den 500k-State-Cap erreichen und keine Same-Soul-Closure vollständig abschließen.

Damit sind weder H1 noch H2 bestätigt oder verworfen. Das Experiment bestätigt nur, dass ein 500k-Total-State-Cap für die geforderte kontrollierte Same-Soul-Closure nicht ausreicht.

## Exakt nächster Schritt

Gezielter Wiederholungstest mit **unveränderter Semantik und unverändertem Runner**, aber gemeinsamem Cap-Ladder:

1. 1,000,000 States pro Lineage-Gruppe,
2. falls irgendeine der acht Gruppen weiterhin budget-limited/closure-incomplete ist: 2,000,000,
3. danach bei Bedarf 4,000,000.

Pro Ladder-Stufe müssen alle vier Bedingungen und beide Lineage-Gruppen denselben Cap erhalten. Erst die erste Stufe, auf der **alle acht Gruppen** `stateCapReached=false`, `horizonReached=true` und `sameSoulClosureComplete=true` melden, darf für H1-vs-H2 interpretiert werden.

Keine Production-, Default-Width-, Common-Horizon-, Objective-, UI- oder kanonische Datenänderung folgt aus diesem PARTIAL-Ergebnis.

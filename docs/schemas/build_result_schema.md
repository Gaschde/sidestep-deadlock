# Build-Result-Schema

Dieses Schema definiert den verpflichtenden Inhalt einer Build-Analyse. Die Darstellung kann als Markdown im Chat oder auf ausdrücklichen Wunsch als Datei unter `builds/` erfolgen.

## 1. Status

- `result_label`: `optimal` oder `best_evaluated`
- `validation_status`: `PASS`, `PASS_WITH_WARNINGS` oder `FAIL`
- `patch`
- `mode`
- `hero_id`
- `objective`
- `scope_statement`

## 2. Annahmen

- Budget und Checkpoints
- Hero- und Skillzustand
- Zielprofil
- Treffer-, Headshot-, Kampfzeit- und Uptime-Annahmen
- Medium-/Low-Confidence-Abhängigkeiten

Analytische Annahmen müssen ausdrücklich von verifizierten Spieldaten getrennt werden.

## 3. Kaufpfad

Eine Zeile pro Kauf mit:

```text
step,item_id,item_name,purchase_type,component_used,cash_cost,total_spent,weapon_investment,vitality_investment,spirit_investment,thresholds_crossed,normal_slots_used,active_slots_used,replaces_item_id,reason
```

## 4. Finaler Build

Für jedes finale Item:

- `item_id`
- Name
- Kategorie
- `total_cost`
- Kern-, Auswahl- oder Situativstatus
- zentrale belegte Wirkung
- Quellen- und Konfidenzhinweis bei relevanten Unsicherheiten

## 5. Berechnete Metriken

Jede zentrale Metrik enthält:

- Ausgangswert
- Endwert
- absolute Änderung
- prozentuale Änderung, falls sinnvoll
- verwendete IDs
- Formel oder Rechenregel
- Einheit
- Annahmen
- Konfidenz

## 6. Fähigkeitentabelle

Für relevante Fähigkeiten getrennt:

```text
ability_id,base_cooldown,final_cooldown,charge_up_time,base_charges,final_charges,charge_restore_time,duration,uptime,damage_or_healing_per_use,per_cycle_value,confidence
```

Nicht anwendbare Werte bleiben leer und werden nicht als bestätigte Nullwerte behandelt.

## 7. Marginaler Itemnutzen

Für jedes Kernitem:

- Wert vor und nach dem Kauf
- Zugewinn
- Zugewinn pro Soul
- ausgelöste Schwelle
- beste geprüfte Alternative
- Wechselbedingung zugunsten der Alternative

## 8. Alternativen und Unsicherheiten

- situative Alternativen mit konkreten Bedingungen
- nicht berechenbare Interaktionen
- referenzierte `UNC-*`- und `HUNC-*`-Einträge
- Sensitivität des Ergebnisses gegenüber Annahmen

## 9. Validierungsblock

Zeige kompakt:

- Kostenprüfung
- Upgradeprüfung
- Investment- und Schwellenprüfung
- Slotprüfung
- Cooldown-/Charge-Prüfung
- Referenzprüfung
- Quellen-/Konfidenzprüfung
- Umfang des geprüften Suchraums

Ein `FAIL` darf nicht als endgültige Empfehlung präsentiert werden.


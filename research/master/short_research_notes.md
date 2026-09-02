# Kurze Forschungsnotizen

- ItemData ist der kanonische Rohwertanker; Lang en liefert Labels und Einheiten. Als aktuelle Effekte werden nur Werte übernommen, deren Label in der gerenderten Default-Infobox sichtbar ist, plus explizite Timing-/Target-Felder und belegte Notes-Ausnahmen.
- `PropertyUpgrades` wurde nicht als Standard-Effekt importiert, weil es Varianten-/Override-Daten enthält und nicht den normalen Basiswert ersetzt.
- Nicht sichtbare Rohfelder bleiben unter UNC-0014 ausgeschlossen, damit Implementierungsreste nicht als Live-Effekte erscheinen; die vollständige Prüfliste liegt in `excluded_itemdata_fields.csv`.
- Itembedingungen bewahren den englischen Quelltooltip, wenn der strukturierte Datensatz keine separaten Condition-/Trigger-Felder anbietet.
- Ausschließlich in freien Itemseiten-Notes beschriebene Randfälle bleiben unter UNC-0015 erhalten; hero-spezifische Fälle gehören in die spätere Interaction-Research.
- Nicht dokumentiertes Objective-Verhalten wird leer gelassen und nicht aus allgemeinen TargetTypes geraten.
- `additional_cost` in Upgrade-Kanten ist der Preis bei Besitz genau dieser Komponente; die aggregierte Multi-Komponenten-Regel steht getrennt in economy.json.
- Hero-spezifische Objective-Damage-Reduktionen wurden absichtlich nicht übernommen.

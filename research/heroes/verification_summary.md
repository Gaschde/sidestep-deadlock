# Verification Summary

- Recherchedatum: 2026-09-02
- Neuester verifizierter Patch: **Minor Update - 08-22-2026** vom 22. August 2026 (`HSRC-0001`, `HSRC-0002`)
- Client-Build: nicht verifizierbar (`HUNC-0001`)
- Modus: Standard Match (6v6, three lanes)
- Öffentliche Helden: 38 laut post-patch Heroes-Seite (`HSRC-0007`)
- Zusätzlich dokumentierte nicht öffentliche Datensätze: 22
- Strukturierte HeroData-Revision: 108817 vom 12. August 2026 (`HSRC-0003`)
- Strukturierte AbilityData-Revision: 114011 vom 22. August 2026 (`HSRC-0004`)
- Patch-Synchronisation: AbilityData ist mit den Celeste-Änderungen des aktuellen Patches abgeglichen; HeroData ist älter, aber nach den letzten bekannten Basiswertänderungen vom 12. August exportiert. Vollständige Client-Synchronität bleibt `HUNC-0002`.
- Core-Abgleich: `data/core/manifest.json` verwendet denselben Patch und dasselbe Forschungsdatum. `data/core/` wurde nicht verändert.
- Schema-Version: 0.1.0-research; verwendete Core-Schema-Version: 0.1.0-research

Der Datensatz übernimmt aktuelle strukturierte Werte, trennt Basiswerte, Boon-Wachstum und Skalierungskoeffizienten und rekonstruiert keine unbekannten Zahlen. Modifier-Klassen werden nur als strukturierte Kennungen gespeichert, nicht als ausformulierte Wirkung interpretiert.

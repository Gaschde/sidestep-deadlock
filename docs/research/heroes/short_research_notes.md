# Short Research Notes

- Verpflichtende Primärquelle war ausschließlich `deadlock.wiki`; `deadlockwiki.org` wurde weder abgerufen noch registriert.
- Der aktuelle Patch wurde vor der Datenerzeugung über Updates-Index, Patchseite und `Data:LatestUpdate.json` geprüft.
- Öffentliche Verfügbarkeit folgt der post-patch Heroes-Seite (38), nicht dem technischen `IsSelectable`-Flag (44).
- AbilityData wurde atomar in Basiswerte, Skalierungsattribute/-koeffizienten sowie einzelne Upgrade-Änderungen zerlegt.
- Alle 38 post-patch Heldenseiten wurden auf zusätzliche `Innate`-Abschnitte geprüft; Ivy, Billy, Rem und Celeste sind als separate Innate-Fähigkeiten registriert.
- Zahlen aus Patchnotes wurden nur in `patches.json` rekonstruiert, wenn alter und neuer Wert explizit waren. Die McGinnis-Änderung bleibt absichtlich als relative 5-%-Angabe erhalten.
- Allgemeine Item-Skalierung wurde nicht als Sonderinteraktion dupliziert. Die fehlende belastbare Item×Ability-Matrix ist `HUNC-0004` und benötigt Client-Tests.
- Summon-Vererbung, Proc- und Objective-Regeln wurden nicht geraten (`HUNC-0005`).
- Builds, Skill-Reihenfolgen, Rollen-/Meta-Bewertungen und Matchup-Rankings sind ausgeschlossen.

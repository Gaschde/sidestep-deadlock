# Validierungsbericht

Erstellt: 2026-09-02T09:17:55Z

| Prüfung | Status | Ergebnis |
|---|---:|---|
| Item-count consistency | PASS | manifest=156, CSV=156, Wiki-Headcount=156 |
| Duplicate IDs | PASS | 0 |
| Broken upgrade references | PASS | 0 |
| Missing source IDs | PASS | 0 |
| Broken JSON source references | PASS | 0 |
| Broken uncertainty references | PASS | 0 |
| Duplicate effects | PASS | 0 |
| Missing units | PASS | 0 |
| Inconsistent costs | PASS | 0 |
| Conflicting current values | PASS | erhalten in 14 Unsicherheitsdatensätzen; keine stille Auflösung |
| Unsupported confidence ratings | PASS | 0 |
| Secondary-only records | PASS | 0 |
| Forbidden domain | PASS | 0 |
| Hero/build scope | PASS | keine Hero-Masterdaten und keine Build-Empfehlungen erzeugt |

## Kontrollsummen

- Items: 156
- Upgrade-Kanten: 64
- Effekte: 836
- Quellen: 42
- Unsicherheiten: 14
- Unit-Fallback `game_value`: 0 (kein fehlender Unit-Wert)
- Nicht sichtbare ItemData-Rohfelder: 187 ausgeschlossen (UNC-0014; keine stillen Altwerte als Effekte)

Alle Konflikte bleiben als Unsicherheit oder explizite Low-Confidence-Regel erhalten. Es wurden keine Sekundärquellen als alleinige Datengrundlage verwendet.

# Builds

Dieser Ordner enthält ausschließlich ausdrücklich angeforderte, aus den kanonischen Daten abgeleitete Build-Ergebnisse.

- Build-Analysen verwenden `docs/prompts/build_optimizer.md`.
- Eingaben folgen `docs/schemas/build_request_schema.md`.
- Ergebnisse folgen `docs/schemas/build_result_schema.md`.
- Ein Ergebnis ist immer an Patch, Modus, Budget, Hero-/Skillzustand und Annahmen gebunden.
- `optimal` ist nur zulässig, wenn Suchraum und Ziel vollständig definiert und geprüft wurden; sonst lautet die Kennzeichnung `best_evaluated`.
- Unsichere oder nicht dokumentierte Interaktionen werden nicht als Fakten ergänzt.


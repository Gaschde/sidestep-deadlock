# Deadlock API snapshots

Dieser Ordner wird von `tools/sync_deadlock_api.py` erzeugt. Er ist eine technische, versionierte Quelle und kein Ersatz für die geprüften Masterdaten in `data/core/` oder `data/heroes/`.

```text
archive/api/
  manifest.json
  versions/<client_version>/
    manifest.json
    raw/<endpoint>.json
    revisions/<timestamp>/raw/<endpoint>.json
    runs/<timestamp>/
      manifest.json
      mapped/<logical-dataset>.json
      diff.json
      review_required.json
      validation.json
      schema_observations.json
```

`raw/` enthält die unveränderten Response-Bytes. Bei einer anderen Antwort für dieselbe Client-Version wird der bisherige Stand nicht ersetzt, sondern unter `revisions/` ergänzt. Die Mappings enthalten `_provenance` und sind Review-Artefakte. Kanonische Dateien werden nur durch ein explizites Approval mit konkreten `change_id`-Werten geändert.

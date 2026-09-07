# Build-Debatte

Dieser Ordner führt eine kleine, lokale Debatte über einen vollständigen Buildpfad von Early bis Late Game aus. Die kanonischen Projektdateien bleiben dabei unverändert. Die Modelle erhalten nur den Auszug, den du in der Eingabedatei bereitstellst.

## Einrichten

`Debatte.env` existiert lokal und wird nicht in Git aufgenommen. Sein einziger notwendiger Inhalt ist:

```text
OPENROUTER_API_KEY=dein_openrouter_key
```

Als Ausgangspunkt kopiere `input.example.json` beispielsweise nach `mein-build.json`. Fülle die exakte `hero_id`, ein messbares Ziel, Budget und Checkpoints sowie den aktuellen deterministischen Kaufpfad aus. Lege außerdem ausschließlich die hierfür relevanten verifizierten Daten bei: Items, Upgrades, Economy/Slots, Heldenprofil, Interaktionen und Unsicherheiten.

Für den bestehenden Warden-Weapon-Carry-Slice wird diese Eingabe automatisch erzeugt:

```powershell
npm run debatte:warden
```

Danach ist `debatte/warden-weapon-carry.json` der gemeinsame Ausgangspunkt der Modelle.

## Starten

Standardmäßig laufen zwei Runden: Pfad-Planer → Gegenprüfer → Pro-Spieler-Perspektive → Skeptischer Auditor, dann dieselbe Reihenfolge erneut. Jeder Beitrag enthält die vorherigen Vorschläge, sodass tatsächlich über Kaufreihenfolge und Alternativen debattiert wird:

```powershell
npm run debatte -- --input debatte/mein-build.json
```

Eine kürzere einzelne Runde:

```powershell
npm run debatte -- --input debatte/mein-build.json --rounds 1
```

Das Skript ruft bei jedem Lauf den aktuellen Modellkatalog ab, wählt für jeden Schritt eine andere `:free`-Modell-ID und speichert Antwort, tatsächlich verwendete Modell-ID und Token-Nutzung unter `debatte/outputs/`. Modelle mit verpflichtendem Reasoning und reine Content-Safety-Modelle werden ausgelassen. Liefert ein Modell keine vollständige strukturierte Review-Antwort, probiert das Skript automatisch ein anderes Modell. Der Ordner ist absichtlich nicht versioniert.

Die Rollen und ihre Anweisungen stehen in `roles.json`. Die Antworten sind keine neue kanonische Datenquelle: Werte und Behauptungen bleiben nur dann belastbar, wenn sie durch die mitgelieferten Projektdaten gedeckt sind. Ohne klar definierten und tatsächlich abgedeckten Suchraum darf auch der Auditor nur `bester_gepruefter_build` ausgeben. Bei vorübergehend nicht verfügbaren Gratis-Modellen versucht der Ablauf bis zu acht unterschiedliche Kandidaten pro Rolle.

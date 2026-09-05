# Sidestep – aktueller Stand

## Quick links

- [GitHub repository](https://github.com/Gaschde/sidestep-deadlock)
- [Current README on GitHub](https://github.com/Gaschde/sidestep-deadlock/blob/main/README.md)
- [Local app](http://127.0.0.1:4173/app/) — available after running `npm start` in this project folder
- [Local app source](C:/Users/sampa/Desktop/sidestep-deadlock/app/index.html)
- [Local Superdesign system](C:/Users/sampa/Desktop/sidestep-deadlock/.superdesign/design-system.md)
- [Local Superdesign prototype](C:/Users/sampa/Desktop/sidestep-deadlock/.superdesign/sidestep-v10-1.html)
- [Engine documentation on GitHub](https://github.com/Gaschde/sidestep-deadlock/blob/main/docs/engine.md)
- [Build-analysis procedure on GitHub](https://github.com/Gaschde/sidestep-deadlock/blob/main/docs/prompts/build_optimizer.md)

Die App, die Superdesign-Dateien und dieses Statusdokument sind aktuell nur lokal vorhanden. Die Python-Optimizer-Engine und das englische README liegen auf GitHub.

## Funktioniert jetzt

- Lokale Daten für Helden, Items, Effekte, Kosten, Upgrades, Slots und Schwellen.
- UI für Held, Spielstil und Kaufpfad – ohne manuell gewähltes Budget.
- Erster echter Optimizer-Slice für **Weapon Carry**:
  - berechnet einen vollständigen 12-Slot-Pfad nach drei Walker-Freischaltungen;
  - baut den Pfad als echte Vorwärtssuche: Von jedem Kaufzustand prüft sie direkte, dauerhaft verifizierte Wirkung sowie registrierte Upgrade-Bausteine. Sie kann auf einen stärkeren Kauf sparen; feste Preis- oder Tier-Sperren gibt es nicht;
  - prüft Upgrades, Slots, Active-Limit und Investments;
  - verlangt als feste Schutzregel mindestens fünf Weapon-, drei Vitality-Slots und eine dauerhaft verifizierte Sustain-Quelle;
  - besitzt ein geprüftes erstes Heldenprofil für Warden: belegte Spirit-zu-Weapon-Skalierung sowie Kit-Kontext für Schutz, Sustain und verzögerte Kontrolle;
  - bewertet Schaden, Schutz, Sustain, Zugang, Mobilität, Risiken, Schwellen und Upgrade-Kohärenz getrennt. Es gibt keinen addierten Geheimscore;
  - behält in einer begrenzten Vorwärtssuche mehrere nicht-dominierte Zustände und vergleicht frühe Grundlagen nach tatsächlich ausgegebenen Souls statt nur nach Schrittnummern;
  - behandelt das erste Weapon-Item sowie die 4'800er-Weapon-Schwelle als eigene Pfadkriterien. Der erste Kauf, ein bestimmtes Item oder ein Preis werden nicht vorgeschrieben;
  - vermeidet im gewählten Pfad belegte Selbst-Risiken und parallele Vor-/Endstufen derselben Upgrade-Linie;
  - rechnet Wardens verifizierte Spirit-zu-Weapon-DPS-Skalierung ein. Bedingte Proc-Uptime wird weiterhin nicht erfunden.
- `npm test`: 8 Tests bestehen.

## Noch nicht drin

- Late-Game-Entscheidung aus einem bereits laufenden Match (aktuelles Inventar, Souls, Verkauf und Ersatzkäufe).
- Spirit, Tank, Support, Mobility und Hybrid als echte Optimizer-Modi.
- Gegnerprofil und konkrete Todesursache als echte Entscheidungskriterien.
- Fähigkeitsschaden, Skill-Reihenfolge, Procs, Uptime und Summons.
- Langfristiger DPS inklusive Nachladen, Headshots und Reichweitenfalloff.
- EHP, Heilung, Schilde, Debuff-Schutz und komplexe Defensive.
- Aktuelles Inventar aus einem laufenden Match übernehmen oder speichern.
- Darstellung der intern bewahrten Alternativen in der Oberfläche; derzeit wird nur der ausgewählte Pfad gezeigt.
- Vollständige Ausgabe nach dem Build-Result-Schema mit Alternativen und Marginalnutzen.
- Geprüfte Heldenprofile für weitere Helden; die Struktur ist allgemein, der fachlich geprüfte Inhalt derzeit bewusst nur Warden.
- Gemeinsame Kauf- und Skillplanung: sinnvolle Fähigkeit-Upgrades nach dem gewählten Pfad bewerten statt den Skill-Strahl nur als Demo zu zeigen.

## UI noch offen

- Echte Portraits für alle Helden; aktuell sind nur Warden, Vyper und Abrams hinterlegt.
- Echte Item-Icons statt Buchstaben-Kacheln.
- Darstellung von Metriken, Begründungen, Unsicherheiten und Alternativen im Ergebnis.
- Bessere Anzeige für volles Inventar, Walker-Slots und mögliche Ersatzkäufe.

## Als Nächstes

**Den neuen Warden-Pfad ingame prüfen:**

Der korrigierte mehrdimensionale Lauf liefert 24 sichtbare Kauf-/Upgrade-Schritte bis 12 Endslots und 48'000 Souls. Der erste Kauf bleibt frei; im geprüften Beispiel folgt das erste Weapon-Item bei 2'400 Souls. Schutz, Sustain und Zugang sind bis 3'200 abgedeckt, die 4'800er-Weapon-Schwelle folgt bei 7'200. Slowing Hex ist dabei ein normal bewerteter Kandidat, keine fest eingebaute Warden-Regel.

Als nächstes zählt echtes Spiel-Feedback: Welcher konkrete Kauf fühlt sich zu früh, zu spät oder unpassend an? Danach wird entweder die belegte Fähigkeitsklassifikation korrigiert oder als nächste Schicht die Skill-Reihenfolge mit dem Kaufpfad gekoppelt. Weitere Heldenprofile folgen erst, wenn Warden stabil funktioniert.

Die Oberfläche zeigt den gesamten Pfad gleichzeitig in einer Deadlock-artigen Fläche: breite Early-Reihe, darunter Mid und Late. Es gibt keine 4/4/4-Phasen-Tabs mehr.

## Merksatz

Keine kanonischen Daten verändern. Erst einen kleinen Fall korrekt und testbar bauen, dann erweitern.

# Search-Core-Spezifikation

## Unterstützter Zwischenstand

Der exakte Kern ist als separate Browserdiagnose angebunden; der produktive 40k-Button verwendet die unten beschriebene approximative Suche. Der kanonisch gebundene Adapter unterstützt positive Itempreise, positive Ein-Komponenten-Upgrades mit exakt konservierter Gesamtkostenbasis und einen Sellback-Satz von mindestens 0 und kleiner als 1. Nicht unterstützte Upgradezahlungen und volle Rückgaben werden ausdrücklich abgewiesen, nicht stillschweigend approximiert. Damit entspricht bei unterstützten Upgradepfaden die kumulierte Anschaffung dem total_cost des gehaltenen Items. Der Defaultwert `power` aus Itemkosten ist ausschließlich eine technische Testmetrik, keine Warden-Bewertung.

## Ressourcenachse

Ohne `soulAxis` bietet der Adapter jeden ganzzahligen earnedSouls-Wert von 0 bis einschließlich budget an. Dies ist eine **ausgewiesene Modellannahme** über zulässige Entscheidungskoordinaten, keine aus Spieldaten abgeleitete kontinuierliche Vollständigkeit und kein zeitliches Einkommensmodell. Die nächste Spartransition erhöht earnedSouls und Guthaben um eine Soul. An jeder Koordinate stehen alle unterstützten Shoptransitionen einschließlich Verkäufen zur Verfügung. Auch nach Erreichen des Horizonts dürfen Shopaktionen erfolgen.

Vollständigkeit im Ganzzahlmodell folgt unmittelbar: Jede erlaubte Entscheidung liegt auf einer besuchten Koordinate, beliebiges längeres Sparen ist eine Folge von Einzelschritten; vor jedem weiteren Sparschritt können alle legalen Shopfolgen durchlaufen werden. Es gibt keine zusätzliche Beschränkung auf Kaufpreise. Verzögerte Käufe, Guthaben nach mehreren Verkäufen, separate Slotfreischaltungen und Referenzänderungen an Ganzzahlkoordinaten werden nicht ausgelassen. Das ist eine exhaustive Basis, **keine effiziente Ereignisreduktion**. Eine solche Reduktion bleibt beweispflichtige spätere Arbeit.

Eine explizite `soulAxis` bleibt als eingeschränkte synthetische Testwelt verfügbar und muss 0 sowie budget enthalten. Sie garantiert nichts über ausgelassene Punkte. Freischaltungen werden separat angegeben; das vereinbarte Warden-Szenario verwendet `slotUnlocks: []`. Ein zeitliches Einkommensmodell oder eine kanonische Souls→Walker-Zuordnung ist dafür nicht erforderlich. Bewertungs- oder Fortschrittsereignisse außerhalb des Ganzzahlmodells sind bislang nicht unterstützt.

## Zielvektor und Verlauf

Die Verlaufsachse ist earnedSouls, nicht Nettoausgabe und nicht Zeit. Die aktuelle Auswertung unterstützt **stückweise konstante**, nichtnegative, endliche Leistungsmetriken. Snapshots gelten rechtsseitig ab ihrer Koordinate bis zum nächsten Ereignis. Änderungen an Referenz, Level oder Freischaltung sind ebenso ausdrücklich als Ereignisse einzutragen. Es gibt keine implizite lineare Interpolation und keine Wirkung vor einem Kauf. Ein kontinuierliches Wirkungsmodell benötigt eine eigene begründete Integration und ist hier nicht behauptet.

Alle unmittelbaren Shoptransaktionen an derselben earnedSouls-Koordinate bilden einen Besuch ohne Zeit-/Ressourcenbreite. Die stabile Ereignisreihenfolge bestimmt dessen letzten Zustand; nur dieser wird als Leistungswert an dieser Koordinate verwendet. Jede Zwischentransition muss weiterhin legal sein. Dadurch bewerten Verkauf+Kauf und eine äquivalente Replacement-Abkürzung denselben Verlauf gleich. Ein reiner Verkauf bleibt der letzte Zustand, wenn danach gespart oder der Pfad beendet wird. Modelle mit Kampf oder Zeitverlust innerhalb eines Shopbesuchs benötigen zusätzliche Zustandsgrößen und werden hier nicht simuliert.

Ist- und Referenzereignisse werden zu einer gemeinsamen Achse einschließlich start und horizon vereinigt. Das Integral ist die Summe aus Intervallbreite mal Rückstand des links gültigen Zustands, keine Trapezsumme über Sprünge. Der Worst Regret erfasst alle gültigen Intervalle und den abgeschlossenen Endpunkt. Ereignisse nach horizon tragen nicht bei. Gehaltene Werte werden bis horizon fortgeführt; beide Kurven müssen start abdecken.

Für Nutzenmetriken mit positiver Referenz r gilt `max(0, (r-m)/r)`, für Kostenmetriken `max(0, (m-r)/r)`. Bei Referenz 0 ist ein bereits mindestens gleich guter Wert mit Rückstand 0 zulässig. Ein positiver Kostenwert gegen Nullreferenz ist relativ nicht definiert und wird ausdrücklich abgewiesen. Fehlende, negative oder nichtendliche Metriken und unbekannte Richtungen werden nicht als Nullqualität akzeptiert.

Ausgabe: Endleistung, Worst Regret, Regret-Integral und Integrated Regret (`Integral/(horizon-start)`). Bei Nullbreite beträgt das Integral 0; die Endbewertung bleibt erhalten.

## Labels und sichere Dominanz

Der generische Kern maximiert alle Labeldimensionen. Zu minimierende Größen sind daher zu negieren. Labels sind flache Vektoren mit derselben Menge endlicher numerischer Dimensionen. Fehlerhafte Labels werden abgewiesen.

Labels werden nur innerhalb desselben futureKey auf Gleichheit oder Dominanz verglichen. Unterschiedliche nicht dominierte Labels bleiben erhalten. Eine identische Vergangenheit darf für die Rekonstruktion durch einen Vertreter ersetzt werden. Bereits in der Queue überholte Labels werden nicht erneut expandiert. stateKey ist keine visited-Sperre und beweist allein keine Zyklusfreiheit.

Der Domänenautor muss Future Equivalence und die Erhaltung der Labeldominanz unter jeder Fortsetzung nachweisen. Im unterstützten Modell umfasst futureKey verdiente Souls, Guthaben, Slots und Inventar; zusätzliche zukünftige Abhängigkeiten müssen ergänzt werden, bevor sie modelliert werden.

**Offener Shop-Endpunkt:** Bei fortsetzbaren Zuständen darf der gerade angekommene Endpunkt nicht irreversibel zum bisherigen Worst Regret addiert werden, weil weitere Shoptransaktionen an derselben Koordinate noch folgen können. `settledWorstRegret` bewertet deshalb nur [start,horizon); `regretIntegral` ist ebenfalls die abgeschlossene Vergangenheit. Bei Zukunftsäquivalenz sind diese Größen sichere Verlaufslabels im stückweise konstanten Modell. Erst beim finalen Ergebnis wird der Endpunkt in `worstRegret` aufgenommen. Der reale Warden-Bewertungsadapter ist im nachfolgenden, bewusst engen Weapon-DPS-Slice implementiert.

`metrics(state)` liefert Snapshot-Leistung, `label(state)` die Suchbewertung. Beide sind getrennte Callbacks; Verlaufssnapshots dürfen nicht rekursiv aus bereits aggregierten Suchlabels entstehen.

## Terminierung und Referenz

Der generische Kern terminiert bei endlich vielen erreichbaren Zukunftszuständen und endlich vielen akzeptierten Labelverbesserungen/Trade-offs. Identische Gratiszyklen werden zusammengeführt. Unbegrenzt verbessernde Zyklen oder unendlich viele Trade-offs bleiben ohne zusätzlichen Domänennachweis unzulässig; es wird keine künstliche Grenze eingeführt.

Im unterstützten Preis-/Sellback-Modell ist `cash + Summe(total_cost des Inventars)` gleich earnedSouls minus bisherigen Verkaufsverlusten. Kaufen und konservierende Upgrades ändern diesen Wert nicht; jeder Verkauf vermindert ihn bei positivem Itempreis und Sellback < 1 strikt. Der endliche Itembestand liefert einen positiven minimalen Verkaufsverlust. Positive Upgradezahlungen, begrenzte Ressourcen, eindeutiger Besitz und endlicher Ganzzahlhorizont begrenzen damit auch die Anzahl der Shopaktionen. Kostenlose volle Rückgaben sind ausdrücklich nicht Teil dieses Nachweises.

Die generische Referenzenumeration ist nur relativ zum gelieferten State-Key und Graphen vollständig. Gemeinsame Transitionen oder Bewertungsfunktionen sind kein unabhängiger Nachweis dieser Funktionen. Die zusätzliche Regression verwendet deshalb eine separat formulierte kleine Kauf-/Verkaufswelt, eigene Verlaufsrechnung und vollständige Enumeration zum Vergleich terminaler Pareto-Vektoren.

## Grenzen

Keine Aussage über die Laufzeit oder vollständige Pareto-Menge bei 60k. Die Browser-App bietet den neuen Kern als getrennten Diagnosemodus mit Web Worker an; der bisherige Optimizer bleibt verfügbar. Kein vollständiges Modell von Warden-Combos, Skills, Gegnern oder zeitlicher Entwicklung. Die Ganzzahlachse löst die externe Achsenabhängigkeit im ausdrücklich beschriebenen Ressourcenmodell; sie löst nicht das kombinatorische Skalierungsproblem.

## Warden Carry Weapon – realer Bewertungsslice

`app/warden-search.mjs` verbindet ausschließlich die vorhandene kanonische Warden-Weapon-Rechnung mit dem neuen Kern. Die Snapshot-Leistung ist `sustained_weapon_dps` aus `evaluateCarryScenarios`: Basiswaffe, permanente Itemwerte, Investmentschwellen und Wardens verifizierte Spirit→Rounds-per-Second-Skalierung sind enthalten; Trigger-, Uptime-, Skill-, Gegner- und Positionsannahmen bleiben ausgeschlossen. Der Slice verlangt eine explizite Itemmenge, startet mit 0 Souls, verwendet die neun Grundslots und akzeptiert zusätzliche Slots nur als explizite `slotUnlocks`; das vereinbarte Warden-Szenario übergibt `[]`.

Die Referenz ist die punktweise erreichbare Oberhülle dieser selben definierten Itemmenge. Ein erster, endleistungsorientierter Lauf erzeugt sie für jede Ressourcenkoordinate; ein zweiter Lauf maximiert je ausgewählter Metrik Endleistung und minimiert Worst Regret sowie Regret-Integral. Im Carry-Slice sind dies getrennte Window-DPS-Metriken für Lane-Trade, Farm, kurzen Kampf und Teamkampf sowie Bullet-/Spirit-EHP. Die terminale Pareto-Filterung erhält den vollständigen Vektor dieser Szenario-/Regret-Dimensionen. Das ist keine behauptete globale Spielreferenz außerhalb der übergebenen Items.

Der Warden-Adapter verwendet weiterhin ein explizites GCD-Zahlungsraster (aktuell 400 Souls bei der vollständigen Itemmenge), einschließlich des Horizonts. Die frühere Behauptung einer bewiesenen Pareto-erhaltenden Linksverschiebung wird ausdrücklich zurückgenommen: Ganzzahlige Preise und 50%-Sellback allein beweisen nicht, dass frühere Verkäufe oder mehrdimensionale Ersetzungen keine Verlaufsdimension verschlechtern. Vollständigkeit wird ausschließlich innerhalb dieses Rasters und der unterstützten Upgrade-Kanten behauptet. Der allgemeine Domänenadapter bietet weiterhin die vollständige Ganzzahlachse an. Eine sichere Ressourcenreduktion bleibt offen.

Der öffentliche Carry-Aufruf durchsucht jetzt alle sieben Leistungsmetriken mit jeweils Endleistung, Worst Regret und Integral gemeinsam (21 Dimensionen). Sieben unabhängige skalare Suchen und ihre Vereinigung ersetzen diese Menge nicht: Ein Regressionstest erhält einen sonst verlorenen Schaden-/Schutzkompromiss. Gleiche terminale Zielvektoren werden durch einen Pfad repräsentiert; bevorzugt wird unter diesen Gleichständen die geringere Zahl von Shopaktionen. Unterschiedliche Zukunftszustände werden während der Suche weiterhin nicht deshalb zusammengeführt.

Die Referenz benötigt keine Rekonstruktionshistorie: Ihr Label hängt ausschließlich vom Zukunftszustand ab. Nur dort darf ein bereits bekannter Zukunftszustand vor erneuter Bewertung verworfen werden. Inventarbewertungen und Upgrade-Vorfahren werden zwischengespeichert. Der Verlaufslauf behält seine Historie und nichtdominierte Labels. Laufende Meldungen zeigen beide Suchphasen, erzeugte Kandidaten, expandierte Zustände und Warteschlange.

Messung vom 2026-09-09: Alle 156 Items, 40k, gemeinsamer Vektor. Nach 19,03 Sekunden Referenzsuche: 4.715.491 Kandidaten, 73.991 expandierte Zustände, 138.859 wartende Labels; letzter und größter erfasster Node-Heap-Snapshot 853.351.568 Bytes. Der externe Diagnose-Watchdog stoppte nach 20 Sekunden ausdrücklich als INCOMPLETE_WATCHDOG. Es liegt kein abgeschlossener 40k-Build vor. Diese Messgrenze ist kein Pruning und keine produktive Suchgrenze. Das Werkzeug tools/measure_warden_search.mjs erlaubt reproduzierbare Messungen; Speicherstichproben sind kein exakter Peak.

51 Tests bestehen, einschließlich unabhängiger kleiner Pareto-Vergleiche, Gleichstandsrepräsentation und historienfreier Referenz. Der vollständige 60k-Ein-Item-Weapon-Test besteht ebenfalls; daraus folgt keine Skalierbarkeit der vollständigen Itemmenge. Frühere Aussagen, die gemessenen vielen Pfade seien viele echte Zielkonflikte, sind nicht belegt: Gleichstandsduplikate wurden gefunden und entfernt. Vier mehrkomponentige Upgrade-Kanten bleiben ausgeschlossen und werden in Fortschritt und Ergebnis offengelegt. Aktive Combos, vollständige Held-/Gegnerszenarien, eine begründete finale Gewinnerregel und praktische 40k-/60k-Skalierung bleiben offen.
## Direkte Referenz und persistenter Cache

Die Referenz wird jetzt durch `direct-reference.mjs` aus legalen Inventaren bestimmt. Die eigentliche Trajektoriensuche bleibt unverändert. Der frühere Verlaufslauf ist über `computeWardenReference({method: "legacy", ...})` als kleiner Testoracle erhalten.

### Geltungsbedingungen und Gleichwertigkeitsbeweis

Dieser Nachweis gilt ausschließlich für die implementierte Domäne: leerer Start mit null Guthaben; alle Kandidaten direkt zu positiven total_cost kaufbar; keine Erwerbsbedingungen außer Budget, Slots, Active-Limit und paarweisen Vorfahrenkonflikten; nur nichtnegative Slotfreischaltungen; unterstützte Upgrades kosten exakt die Differenz der Inventarwerte; Sellback liegt unter 1. Die Warden-Referenzbewertung hängt nur vom aktuellen Inventar und dem festen Request/Datenstand ab. Historische Stacks, Kaufboni, Einkommen aus Items, Verbrauchsgüter, Rabatte oder zeitabhängige Werte sind nicht enthalten. Änderungen dieser Bedingungen erfordern einen neuen Nachweis, keine ungeprüfte Übernahme dieser Reduktion.

Notwendigkeit: Für jeden erreichbaren Zustand gilt Guthaben + Summe(total_cost der gehaltenen Items) = earnedSouls minus Verkaufsverluste. Kaufen und unterstützte Upgrades erhalten diese Gleichung; Verkaufen/Replacement vermindern die rechte Seite um den Verkaufsverlust. Bei nichtnegativem Guthaben ist der Inventarpreis daher höchstens earnedSouls. Alle Transitionen erhalten Slot-/Active-Legalität und verbieten den gleichzeitigen Besitz eines Items mit seinen Upgrade-Vorfahren.

Hinreichend: Für ein solches legales Inventar kann bis zur betrachteten Soul-Koordinate gespart und dann jedes enthaltene Item direkt gekauft werden. Jeder Teilkauf bleibt bezahlbar, belegt höchstens so viele Slots/Active-Slots wie das Endinventar und besitzt keine verbotenen Vorfahrenpaare. Deshalb ist jedes vom direkten Verfahren akzeptierte Inventar dort tatsächlich erreichbar, auch wenn Einzelkäufe erst nach einer Slotfreischaltung möglich werden. Der früheste erreichbare Punkt ist der erste Achsenpunkt mit ausreichendem Budget und Slotkapazität. Nichtnegative Freischaltungen und zeitunabhängige Inventarwerte erlauben das Fortschreiben des Referenzmaximums auf spätere Punkte.

Beide Verfahren maximieren damit dieselben Werte über dieselbe Inventarmenge je Achsenpunkt. Die Referenz benötigt keine Pareto-Menge: Ein Durchlauf aktualisiert sieben voneinander unabhängige Maxima. Jede legale Kombination wird einmal bewertet, ohne Kaufpfade, Budgetzustandskopien oder alle Inventarprofile zu speichern. Das Aufbewahren ausführlicher Bewertungsprofile ist nur für diesen einmaligen Referenzdurchlauf deaktiviert; die Bewertungsformeln sind unverändert. Die Vergleichstests prüfen alle Referenzwerte exakt, ohne Toleranz.

Dieser Nachweis betrifft nicht die optimale Trajektorie zwischen Rasterpunkten. Das bisherige 400-Souls-Raster und die vier ausgeschlossenen Upgrade-Kanten bleiben offengelegte Modellgrenzen. Insbesondere wird keine globale Spieloptimalität daraus abgeleitet.

### Cache

Der Browser-Worker verwendet IndexedDB (`sidestep-reference-cache`), getrennt von flüchtigen Worker-Objekten. Ein Neuladen/erneutes Starten kann abgeschlossene Referenzen wiederverwenden. Browserprofil, Origin und verfügbare Browser-Speicherung begrenzen die Persistenz; gelöschte Website-Daten verursachen eine Neuberechnung. `tools/reference-file-cache.mjs` bietet denselben Speichervertrag für lokale Node-Anwendungen und Tests mit atomarer Dateiablage.

Der SHA-256-Schlüssel enthält Modellversion, sämtliche übergebenen Dateninhalte einschließlich Maps/Manifeste, Itemmenge, Held/Rolle/Schadensfokus, Slotannahmen, Metrikdefinition, Soul-Achse und Horizont. Der Worker liest zusätzlich den transitiven aktuellen statischen Modulgraphen der Warden-Suche ein; damit invalidieren Änderungen der Bewertungsformeln und eingebauten Szenarioannahmen den Cache automatisch. Neue dynamische/extern bereitgestellte Bewertungsquellen müssen ausdrücklich in diese Identität aufgenommen werden.

Nur vollständig berechnete, strukturell validierte Kurven mit endlichen nichtnegativen, monotonen Referenzwerten werden gespeichert. Ein Abschlussmarker und eine Inhaltsprüfsumme schützen gegen unvollständige/beschädigte Cacheeinträge. Abbruch oder Rechenfehler erzeugt keinen Eintrag. Fehlende Schreibrechte/Browserquota führen zur sichtbaren Warnung, nicht zu einer anderen Bewertung. Ein Treffer ersetzt nur die Referenzberechnung, niemals die Trajektoriensuche.

### Messung

Vollständige 156-Item-Warden-Referenz, Horizont 40k, 20-Sekunden-Diagnose: nach 19,00 Sekunden 121.863 legale Inventare ausgewertet; größter erfasster Node-Heap-Snapshot 67.043.568 Bytes. Der Lauf wurde als INCOMPLETE_WATCHDOG beendet und nicht gespeichert. Die erste Messung deckte ein Wachstum auf über 1,2 GB durch bislang versteckte Bewertungsprofil-Caches auf; deren Aufbewahrung ist für die direkte Referenz jetzt ausgeschaltet. Laufzeit bleibt kombinatorisch und der vollständige 40k-Abschluss ist nicht nachgewiesen. Messungen sind Stichproben, kein exakter Peak und keine belastbare Laufzeitprognose.


## Aktueller Browsermodus: approximativer 40k-Build

Warden / Carry / Weapon, 0 bis 40.000 verdiente Souls, zwölf Slots ab Beginn (neun Grundslots plus drei explizite initiale Zusatzslots) und keine Walker-Freischaltungen. Alle 156 kanonischen Items werden übergeben. Der Worker verwendet ein sichtbares Rechenbudget von 25 Sekunden und veröffentlicht zuvor gefundene vollständige, im Domänenmodell erneut abgespielte legale Pfade. Abbrechen erhält den letzten Build. Die Zeitgrenze ist weich: laufende Expansion und abschließende Validierung können sie geringfügig überschreiten.

Die Nutzerpräferenz ist 70 % Endstärke und 30 % Verlauf. Implementiert sind 70 % mittlere Endutility, 15 % mittlerer Worst Regret und 15 % mittlerer Integrated Regret. Die fünf Schadensfenster bilden eine eigene Gruppe; Bullet- und Spirit-Überlebenskapazität bilden eine zweite. Beide Gruppen zählen mit 50 %, damit mehrere ähnliche Schadensmaße Überleben nicht verdrängen. Endutility ist x/(x+Referenz am Horizont); Rückstände sind max(0,1-x/Referenz), über die Soul-Achse stückweise konstant integriert. Die beiden Überlebensmaße enthalten nur permanente Resistenz sowie für das gemeinsame 10-Sekunden-Teamkampffenster belegte permanente Regeneration und permanenten Bullet-Lifesteal. Ability-Lifesteal, Kill-Heilung, aktive Effekte und bedingte Trigger bleiben ohne belegte Ability-Schadens-, Treffer- oder Uptime-Annahme sichtbar, aber ausgeschlossen. Gleichzeitige Shopaktionen zählen als ein abgeschlossener Zustand. Diese explizite skalare Auswahl ersetzt im approximativen Modus die vollständige Pareto-Ausgabe.

Eine bis zu zwei Sekunden gesampelte erreichbare Referenz wird innerhalb des Laufs eingefroren. Sie ist kein exaktes punktweises Maximum; die daraus berechneten Rückstände sind keine exakten Regret-Werte. Referenz und Anfangsinventare entstehen durch zielweise gierige Direktkäufe. Danach bleiben sämtliche unterstützten Aktionen und Items in der Trajektoriensuche verfügbar: zunächst gieriger Verlauf, anschließend Varianten ab Präfixen des besten Pfads, mit Gumbel-Störung 0,002 und 10 % gleichverteilter Aktionswahl. Der Zufallsstartwert ist 123456789; die Zeitgrenze macht Ergebnisse dennoch rechnerabhängig. Diese Parameter sind Heuristiken, keine Korrektheitsbeweise oder Qualitätsgarantien.

Bekannte Grenzen bleiben das Zahlungsraster, vier nicht unterstützte Upgrade-Kanten, unbekannter Level-/Skillzustand und unvollständig bewertete aktive Effekte/Combos. Es gibt keine garantierte Nähe zum global besten Build. Die erneute Pfadprüfung belegt Legalität innerhalb des vorhandenen Modells, nicht Vollständigkeit der Spielmodellierung.

Validierung: 59/59 Tests bestanden. Zwei kleine vollständig enumerierte Fälle vergleichen den approximativen Gewinner mit dem exakten Gewinner derselben Auswahlregel. Browser mit allen 156 Items und zwölf Startslots: erster legaler Pfad nach 1,17 Sekunden, vollständiger Suchdurchlauf etwa 25,1 Sekunden; zehn Käufe, zehn belegte Slots, 0 Souls Restguthaben. Abbruch nach erstem Ergebnis erhält Inventar und Kaufpfad. Diese Messung ist keine Laufzeitgarantie für andere Rechner oder Ziele.

Aktualisierung des Browser-Szenarios: Auf Nutzerwunsch sind alle zwölf Slots bereits ab 0 Souls verfügbar (drei explizite initiale Zusatzslots). Dies ersetzt die bisherige Neun-Slot-Annahme ausschließlich im approximativen Browsermodus. Zwölf ist die Kapazität, keine Mindestanzahl von Items. Suche, Referenzsampling und Ausgabevalidierung verwenden dieselbe Slotkonfiguration.

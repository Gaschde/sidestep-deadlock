# Referenzprofil und Branch-and-Bound-Vorschlag

Status: Profilierung implementiert, Schranke noch NICHT implementiert oder als praktisch wirksam behauptet. Keine Änderung der Itemmenge, Kaufpfadsuche, Bewertungsformeln oder Pruning-Regeln.

## Messverfahren und Ergebnisse

`node tools/measure_warden_search.mjs 40000 20 reference-profile`

Profilierung ist opt-in. Die Messabschnitte sind nicht verschachtelt: Kombinationserzeugung (Kosten/Active-Zähler, Inventarabbildung, push/pop), Legalität (Soul-/Slot-Erreichbarkeit, Budget, Active-Limit, Familienkonflikte), numerische Bewertung einschließlich bestehender Profilaufbereitung, Referenzmaximum-Aktualisierung. Setup wird separat ausgewiesen. Laufzeit enthält zusätzlich Rekursion, Schleifen, Uhrmessungen, Fortschrittsmeldungen, finalen Präfixdurchlauf und Garbage Collection. GC wird dem gerade laufenden Abschnitt zugerechnet. Angaben sind deshalb diagnostische Wall-Clock-Zeiten, keine CPU-Sampling-Profile.

Alle 156 Items, Warden/Carry/Weapon, neun Slots, keine Freischaltungen, Horizont 40k. Letzte Probe nach 19.001,795 ms:

| Abschnitt | ms | Anteil Laufzeit |
| --- | ---: | ---: |
| Bewertung | 18.708,497 | 98,46 % |
| Kombinationserzeugung | 68,455 | 0,36 % |
| Legalitätsprüfung | 51,155 | 0,27 % |
| Referenzmaxima aktualisieren | 78,507 | 0,41 % |
| Übrige Arbeit/Messaufwand | ca. 95,181 | ca. 0,50 % |

Setup separat: 6,089 ms. 124.717 Inventare bewertet; 128.176 Erweiterungen betrachtet, 3.460 davon illegal. Größter erfasster Heap-Snapshot: 67.800.920 Bytes. Externer Diagnoseabbruch nach 20,008 s: INCOMPLETE_WATCHDOG, keine vollständige Referenz und kein Cacheeintrag. Der Ausschnitt ist abhängig von DFS-Reihenfolge und JIT-Warmup; keine Hochrechnung auf die vollständige Suche.

Vollständiger Kontrolllauf mit denselben 156 Items bis 2.400 Souls: 3.067 Inventare, 211.961 Erweiterungen, 208.895 illegale Erweiterungen, 748,641 ms. Bewertung 681,595 ms, Kombinationserzeugung 25,112 ms, Legalität 12,256 ms, Maxima-Aktualisierung 2,134 ms. Ein gleichzeitig laufender Diagnoseprozess beeinflusst absolute Zeiten; die Abschnittsanteile gelten für diesen Lauf. Hohe Illegalitätsrate im kleinen Fall zeigt, warum dessen Profil nicht ungeprüft auf 40k übertragbar ist.

Die Regression vergleicht profilierten und unprofilierten Lauf sowie die alte vollständige Methode: alle kleinen Referenzkurven und Inventarzahlen exakt identisch. Die Instrumentierung ändert weder Reihenfolge noch Kandidaten oder Bewertungswerte. Bestehende unabhängige kleine Tests bleiben erhalten.

## Sichere Schranke: Herleitung über eine Obermenge

Ein DFS-Knoten enthält das feste Inventar P und den noch nicht besuchten Itemsuffix R. Für jeden Soul-Punkt s sind B = s - Preis(P) und k = Slots(s) - Anzahl(P) die verbleibenden Ressourcen. Bei B < 0 oder k < 0 kann der Knoten dort nichts beitragen. Alle Nachfahren kaufen höchstens k verschiedene Items aus R. Eine Obermenge entsteht, wenn wir beim Abschätzen Familienkonflikte, Active-Limit und gemeinsame Realisierbarkeit verschiedener Stat-Maxima ignorieren. Die tatsächliche Suche behält diese Regeln unverändert.

Für jede additive Bewertungsgröße x liefert

    x_upper(P,s) = x(P) + Summe der k größten positiven x-Beiträge aus R

eine obere Schranke. Negative Zusatzbeiträge dürfen in der SCHRANKE entfallen, die bereits festgelegten Beiträge aus P nicht. Die Beiträge müssen exakt dieselben Effekt-/Confidence-/Availability-Filter verwenden wie der bestehende Evaluator; etwa Spirit-Power und Waffenwerte verwenden derzeit unterschiedliche Filter. Eine vereinheitlichte, abweichende Interpretation wäre keine zulässige Beschleunigung.

Kategorieinvestment nach oben begrenzen durch:

    Icat_upper = Icat(P) + min(B, Summe der k größten Itemkosten der Kategorie aus R).

Bei Schwellenboni ist das Maximum aller im möglichen Investmentintervall liegenden Evaluatorwerte zu verwenden (einschließlich des bereits geltenden Bonus). Nur nach geprüfter Monotonie genügt der Wert an der oberen Grenze. So bleiben Investment-Sprünge und mögliche Datenänderungen sicher behandelt.

### Schaden

Aus den oberen Grenzen für Waffenschadensbonus, Spirit-Power und Feuerratenbonus folgen D_upper (Schaden pro Schuss) und R_upper (Schüsse pro Sekunde). Voraussetzung: die Basis-/Skalierungsfaktoren sind nichtnegativ, die gültigen Waffenparameter positiv; andernfalls keine endliche Schranke behaupten. Ungeklärte/ungültige Parameter dürfen niemals einen Zweig löschen.

Für alle vier Fensterschadensmaße ist D_upper * R_upper eine sichere DPS-Obergrenze: selbst ohne jedes Nachladen können in T Sekunden höchstens R_upper * T Schüsse abgegeben werden. Sie umfasst damit auch die konkrete floor/min-Zyklusformel bei 4 und 10 Sekunden, ohne eine ungeprüfte Monotonie ihrer Phasenlage anzunehmen.

Für Dauer-DPS kann die engere Schranke verwendet werden:

    C_upper = ceil((Basisclip + Flat_upper) * (1 + ClipPercent_upper/100))
    U_sustained = D_upper * C_upper / (C_upper/R_upper + Reloadzeit).

Diese Funktion ist für positive D, C, R und nichtnegative feste Reloadzeit monoton in D, C und R. Bei nicht erfüllten Voraussetzungen bleibt die sichere Schranke unendlich und pruned nichts. Die vier Fenster-Schranken bleiben zunächst ohne Reload-Abzug und sind deshalb voraussichtlich großzügiger.

### Bullet-/Spirit-EHP

Gesundheit wird analog mit oberem flachem Bonus und oberem Vitality-Schwellenbonus begrenzt. Widerstände werden NICHT addiert. Pro Item und Schadenstyp entspricht der Widerstandsbeitrag dem Produkt seiner im bestehenden Evaluator berücksichtigten Faktoren (1-r/100). Für positive Faktoren kann man äquivalent den Nutzen -log(Produkt) verwenden. Zum festen Inventar die k größten positiven solchen Nutzen addieren und wieder exponentieren ergibt einen oberen EHP-Multiplikator. Die ignorierte gemeinsame Realisierbarkeit mit dem Gesundheitsmaximum macht die Schranke nur größer, nicht unsicher. Faktoren <= 0, Unterlauf, Overflow oder eine nicht positiv begrenzbare EHP-Division ergeben eine unendliche Schranke.

## Löschregel für sieben Ziele und die ganze Referenzkurve

L_m(s) ist die beste bereits TATSÄCHLICH erreichte Leistung für Kennzahl m am Soul-Punkt s. Im aktuellen Speicher liegt zunächst nur das Maximum je erstem erreichbaren Punkt; für L muss das Präfixmaximum über alle früheren Punkte gebildet werden. Ein späterer guter Wert darf nicht als früher erreichbar behandelt werden.

Ein Teilbaum darf genau dann vollständig verworfen werden, wenn für JEDEN von ihm erreichbaren Soul-Punkt s und JEDE der sieben Kennzahlen m gilt:

    U_m(P,s) <= L_m(s).

Dann kann kein Nachfahre einen Referenzwert verbessern. Gleichstände benötigen für die Referenz keinen zusätzlichen Repräsentanten. Unabhängige Maxima unterschiedlicher Kennzahlen dürfen von unterschiedlichen Inventaren stammen: Dies ist nur die Referenz, keine gemeinsame Trajektorienentscheidung. Ein Prüfen allein des Endhorizonts oder allein der Dauer-DPS wäre falsch.

Die Herleitung gilt in reeller Arithmetik. Für eine prunende JavaScript-Implementierung fehlen noch nach außen gerundete obere Intervalle (auch ceil, Produkte und EHP-Division) oder ein ebenso strenger Fehlernachweis gegenüber dem vorhandenen Fließkomma-Evaluator. Ein beliebiges epsilon ist kein Beweis. Bei Unsicherheit muss die Implementierung U = Infinity verwenden. Dieser numerische Schritt ist eine Voraussetzung, keine bereits erledigte Zusicherung.

## Erwarteter Nutzen und Entscheidung vor Implementierung

Die Bewertung kostet in der 40k-Probe durchschnittlich rund 150 Mikrosekunden je Inventar. Suffix-Tabellen der k besten Beiträge könnten die Stat-Schätzung günstig machen; k stammt aus dem echten Slotlimit, nicht aus einem Suchlimit. Die Prüfung aller Soul-Punkte und sieben Maße bleibt zusätzliche Arbeit. Für einen gemessenen Prüfaufwand C_bound lohnt sich ein Aufruf erst, wenn die eingesparten Bewertungen und sonstige Nachfolgerarbeit diesen Aufwand übersteigen. Beispiel nur zur Einordnung: 30 Mikrosekunden Zusatzaufwand pro geprüftem Knoten würden ohne weitere Einsparungen mehr als 20 % vermiedene Bewertungen erfordern. Diese 30 Mikrosekunden sind KEIN gemessener Wert.

Risiken: Unabhängig maximierte Stats können viel zu hoch sein; besonders der fehlende Reload-Abzug der Fenstermaße und die unabhängigen Schadens-/EHP-Extrema können das gemeinsame Löschkriterium selten erfüllen. Eine sichere Schranke kann somit trotzdem langsamer sein. Es gibt noch keine gemessene Pruning-Quote, keine erwartbare feste Beschleunigungszahl und keinen 40k-Abschlussnachweis.

Empfehlung: Zuerst die Schranke als rein beobachtenden Shadow-Check implementieren, ohne Zweige zu löschen. Auf kleinen vollständigen Bäumen jede Schranke gegen alle echten Nachfahren je Kennzahl und Soul-Punkt prüfen, einschließlich negativer Effekte, Investitionssprünge, freier Slots und Rundungsgrenzen. Gleichzeitig Schrankenzeit, hypothetisch vermiedene Bewertungen und Doppelzählungsfreiheit vermiedener Teilbäume messen. Erst nach bestandener mathematischer/numerischer Prüfung und positivem Netto-Nutzen das Pruning separat aktivieren. Kein Itemlimit, keine Zieländerung und keine Änderung der Kaufpfadsuche.

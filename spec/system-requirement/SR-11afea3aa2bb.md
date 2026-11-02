---
id: 6ea3455b-23d1-4ec3-ac13-11afea3aa2bb
type: system-requirement
status: draft
title: Metamodell-Ausschnitt für Attribute ohne Zuordnung vorschlagen
spec-id: SR-170
rationale: "Entscheidung des Produktverantwortlichen, 2026-11-02: Weil die Zuordnung das Metamodell nie ändert (SR-054), braucht jedes übernommene Attribut eine eigene Property; die Analyse soll dafür einen Ausschnitt vorschlagen, den man ins Metamodell übernehmen kann (#573)."
requirement-type: functional
acceptance-criteria:
  - Gegeben eine ReqIF-Datei mit Attributen ohne Zuordnung, wenn sie mit `reqseq reqif analyze export.reqif` gelesen wird, dann enthält die Ausgabe einen Ausschnitt im Format des Metamodells mit einer Property je solchem Attribut. Ihre Wertart ist Text für STRING und XHTML, Zahl für INTEGER und REAL, Datum für DATE und Auswahl für ENUMERATION und BOOLEAN; ein Attribut mit mehreren Werten (MULTI-VALUED) ergibt eine Property mit mehreren Werten.
  - Gegeben Attribute und Aufzählungswerte, deren Namen keine gültigen Schlüssel sind (zum Beispiel `ReqIF.ForeignID` oder die Werte `1` bis `4`), wenn der Ausschnitt vorgeschlagen wird, dann hat jede vorgeschlagene Property und jede Auswahl einen Schlüssel nach dem Muster der Schlüssel des Metamodells (Kleinbuchstaben, Ziffern und Bindestriche, am Anfang ein Buchstabe), verschiedene Werte einer Aufzählung haben verschiedene Schlüssel, und der Name aus der Quelle ist der Anzeigename.
  - Gegeben ein Attribut vom Datentyp BOOLEAN, wenn der Ausschnitt vorgeschlagen wird, dann ist es eine Auswahl-Property mit den Schlüsseln `true` und `false`, und der Import übernimmt die Werte `true` und `false` der Datei in diese Auswahl.
  - Gegeben der Ausschnitt ist ins Metamodell übernommen und die Zuordnung ordnet jedes Attribut der vorgeschlagenen Property und jeden Aufzählungswert seiner Auswahl zu, wenn die Datei importiert wird, dann läuft der Import durch und meldet für diese Attribute keinen Verlust.
  - Gegeben die Analyse schlägt einen Ausschnitt vor, wenn die Dateien danach geprüft werden, dann ist das Metamodell unverändert (SR-054); der Ausschnitt steht nur in der Ausgabe der Analyse.
  - Gegeben dieselbe Datei und dieselbe Zuordnung, wenn die Analyse über App, Kommandozeile, API oder MCP ausgeführt wird, dann liefert das Tool dasselbe Ergebnis.
packages:
  - { id: 7755a224-01c9-4710-869a-7b1477fbd624, version: n1:cd51c9fc3d83c915, title: "Stufe 6: Austausch per ReqIF und Schutz" }
verification-method: test
topic: Import und Export
derives-from:
  - { id: 6adc5040-2819-4ec5-a9e9-ad790fd35904, version: n1:3a3f6b6e64b1edc5, title: Zuordnung zum Metamodell }
  - { id: 6adc531a-5a09-476b-9253-7a620b9698d3, version: n1:212741657b151bd3, title: Unbekannte Typen beim Import }
based-on:
  - { id: 6adc5318-7e31-4925-b180-ff19c4c61c5f, version: n1:ed13abb3520fa053, title: Kein Austausch von Metamodellen }
---

Das Tool muss beim Lesen einer ReqIF-Datei für ihre Attribute ohne Zuordnung einen Ausschnitt des Metamodells vorschlagen, ohne das Metamodell selbst zu ändern.

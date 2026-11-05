---
id: 6ea3455b-23d1-4ec3-ac13-11afea3aa2bb
type: system-requirement
status: draft
title: Metamodell-Ausschnitt für Attribute ohne Zuordnung vorschlagen
spec-id: SR-170
rationale: "Entscheidung des Produktverantwortlichen, 2026-11-02: Weil die Zuordnung das Metamodell nie ändert (SR-054), braucht jedes übernommene Attribut eine eigene Property; die Analyse soll dafür einen Ausschnitt vorschlagen, den man ins Metamodell übernehmen kann (#573)."
requirement-type: functional
acceptance-criteria:
  - Gegeben eine ReqIF-Datei mit Attributen ohne Zuordnung, wenn sie mit `reqseq reqif analyze export.reqif` gelesen wird, auch mit einer Zuordnung, die einen Teil der Attribute nennt (`--mapping reqif/ea.yaml`), dann enthält die Ausgabe einen Ausschnitt im Format des Metamodells mit Properties nur für die Attribute, die danach noch ohne Zuordnung sind. Ihre Wertart ist Text für STRING und XHTML, Zahl für INTEGER und REAL, Datum für DATE und Auswahl für ENUMERATION und BOOLEAN; ein Attribut mit mehreren Werten (MULTI-VALUED) ergibt eine Property mit mehreren Werten.
  - Gegeben Attribute mit demselben Namen und demselben Datentyp in mehreren SPEC-OBJECT-TYPEs, wenn der Ausschnitt vorgeschlagen wird, dann enthält er dafür genau eine Property; Attribute mit demselben Namen und verschiedenem Datentyp ergeben verschiedene Properties.
  - Gegeben Attribute und Aufzählungswerte, deren Namen keine gültigen Schlüssel sind (zum Beispiel `ReqIF.ForeignID` oder die Werte `1` bis `4`), wenn der Ausschnitt vorgeschlagen wird, dann folgt der Schlüssel jeder vorgeschlagenen Property und jeder Auswahl der Regel für Schlüssel aus SR-010 AK2. Die vorgeschlagenen Property-Schlüssel sind untereinander und von den Schlüsseln der Properties im Metamodell verschieden, die Schlüssel der Auswahl einer Property sind untereinander verschieden, und der Name aus der Quelle ist der Anzeigename.
  - Gegeben ein Attribut vom Datentyp BOOLEAN, wenn der Ausschnitt vorgeschlagen wird, dann ist es eine Auswahl-Property mit den Schlüsseln `true` und `false`.
  - Gegeben ein Attribut vom Datentyp BOOLEAN, das die Zuordnung einer Auswahl-Property mit den Schlüsseln `true` und `false` zuordnet, wenn importiert wird (zum Beispiel `reqseq reqif import --file export.reqif --mapping reqif/ea.yaml --delivery "Lieferung 1"`), dann übernimmt das Tool die Werte `true` und `false` der Datei als diese Schlüssel, ohne dass die Zuordnung Werte (`values`) dafür nennt.
  - Gegeben der Ausschnitt ist ins Metamodell übernommen, die vorgeschlagenen Properties sind den Typen hinzugefügt, denen die Zuordnung die SPEC-OBJECT-TYPEs zuordnet (der Ausschnitt schlägt keine Typen vor), und die Zuordnung ordnet jedes Attribut seiner vorgeschlagenen Property und jeden Aufzählungswert seiner Auswahl zu, wenn die Datei importiert wird, dann läuft der Import durch und meldet für diese Attribute keinen Verlust.
  - Gegeben die Analyse schlägt einen Ausschnitt vor, wenn die Dateien danach geprüft werden, dann ist das Metamodell unverändert (SR-054); der Ausschnitt steht nur in der Ausgabe der Analyse.
  - Gegeben dieselbe Datei und dieselbe Zuordnung, wenn die Analyse über App, Kommandozeile, API oder MCP ausgeführt wird, dann liefert das Tool dasselbe Ergebnis.
packages:
  - { id: 0d3dc867-b3e5-401f-a6db-d95463166616, version: n2:4a83a04662882161, title: Austausch per ReqIF }
verification-method: test
derives-from:
  - { id: 6adc5040-2819-4ec5-a9e9-ad790fd35904, version: n1:3a3f6b6e64b1edc5, title: Zuordnung zum Metamodell }
  - { id: 6adc531a-5a09-476b-9253-7a620b9698d3, version: n1:212741657b151bd3, title: Unbekannte Typen beim Import }
based-on:
  - { id: 6adc5318-7e31-4925-b180-ff19c4c61c5f, version: n2:05581a0e4c20cadf, title: Kein Austausch von Metamodellen }
---

Das Tool muss beim Lesen einer ReqIF-Datei für ihre Attribute ohne Zuordnung einen Ausschnitt des Metamodells vorschlagen, ohne das Metamodell selbst zu ändern.

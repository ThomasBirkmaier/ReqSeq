---
id: 740b11ef-2bcf-4200-b544-9c3ce17a4f4d
type: system-requirement
status: approved
title: Export an die Quelle in ihrem Modell schreiben
spec-id: SR-158
rationale: "Der Export an eine Quelle bleibt eine ReqSeq-Datei und nutzt von der Zuordnung nur ihre Einstellungen für den Export. Damit Werkzeuge wie DOORS Next oder Polarion Werte wie die Stellungnahme (SR-058) in ihre vorhandenen Objekte übernehmen, soll der Export die Datei zusätzlich im Modell der Quelle schreiben können. Welche Werte der Export trägt (AK3, AK6): siehe #1835."
requirement-type: interface
acceptance-criteria:
  - key: rpq1
    text: Gegeben importierte Requirements einer Quelle und ihre gespeicherte Zuordnung, wenn sie im Modell der Quelle an die Quelle exportiert werden, dann tragen SPEC-OBJECT-TYPE, ATTRIBUTE-DEFINITION und Datentyp jeweils den IDENTIFIER und den LONG-NAME der Quelle und jedes Requirement seinen ursprünglichen IDENTIFIER.
  - key: bccw
    text: Gegeben eine Property mit festen Werten, deren Werte die Zuordnung den Werten einer Aufzählung der Quelle zuordnet, wenn ihr Wert so exportiert wird (AK3 oder AK6), dann trägt das Requirement im Attribut der Quelle den Aufzählungswert der Quelle, dem die Zuordnung den Wert zuordnet.
  - key: b63m
    text: Gegeben importierte Requirements mit Stellungnahme, wenn sie so mit Stellungnahme exportiert werden (SR-058), dann steht die Stellungnahme im Attribut laut Zuordnung am SPEC-OBJECT-TYPE der Quelle, und von den Werten jedes Requirements trägt die Datei nur die Stellungnahme (SR-058 AK1).
  - key: qgcj
    text: Gegeben ein Export im Modell der Quelle, mit oder ohne Stellungnahme, wenn er gegen das Schema von ReqIF 1.2 geprüft wird, dann ist er gültig.
  - key: z33h
    text: Gegeben ein Export an die Quelle, bei dem das Modell der Quelle nicht gewählt ist, wenn er geschrieben wird, dann bleibt die Datei eine ReqSeq-Datei wie bisher (SR-058, SR-054 AK2).
  - key: kz13
    text: Gegeben importierte Requirements einer Quelle und ihre gespeicherte Zuordnung, wenn sie im Modell der Quelle ohne Stellungnahme an die Quelle exportiert werden (zum Beispiel `reqseq reqif export --mapping reqif/kunde-a.yaml --source-model`), dann trägt jedes Requirement in jedem Attribut der Quelle, das die Zuordnung dem Titel, dem Text oder einer Property zuordnet, deren Wert; für die wegzulassenden Properties (SR-059 AK1) und für einen leeren Wert trägt es keinen Wert. Exportiert werden alle Elemente mit der Quelle der Zuordnung, durch eine Auswahl eingrenzbar. Die Datei enthält keine SPEC-RELATION, auch nicht zu einem nicht exportierten Element (anders als SR-052 AK2 und SR-059 AK2).
  - key: nxcq
    text: Gegeben ein Export im Modell der Quelle, bei dem ein Wert nicht eindeutig oder nicht in den Datentyp der Quelle passt, weil die Zuordnung mehrere Attribute eines SPEC-OBJECT-TYPE demselben Titel, Text oder derselben Property zuordnet, weil sie mehrere SPEC-OBJECT-TYPEs der Quelle demselben Typ zuordnet, oder weil ein Wert länger, größer oder kleiner ist, als der Datentyp erlaubt, oder keinem Aufzählungswert zugeordnet ist, wenn er geschrieben wird, dann lehnt das Tool ab, schreibt nichts und nennt jedes betroffene Requirement mit Attribut oder Typ.
verification-method: test
packages:
  - { id: 0d3dc867-b3e5-401f-a6db-d95463166616, version: n2:0a96ee534d188a3a, title: Austausch per ReqIF }
refines:
  - { id: 6adc6d25-0c38-4486-8849-02874ac41f76, version: n2:1390184909e23837, title: Stellungnahme als ReqIF exportieren }
  - { id: 6adc6d20-e825-45be-8813-dbb9e8a760ca, version: n2:300bb4016276ad39, title: Zuordnung zum Metamodell als Datei speichern }
derives-from:
  - { id: 6adc6159-80e0-4421-84c4-4055e6912b63, version: n1:5e594bd18b6129c8, title: Stellungnahme per ReqIF zurückgeben }
based-on:
  - { id: 6adc5318-7e31-4925-b180-ff19c4c61c5f, version: n2:05581a0e4c20cadf, title: Kein Austausch von Metamodellen }
---

Das Tool muss den Export an eine Quelle wahlweise im Modell der Quelle schreiben können, mit deren Typen, Attributen, Datentypen und Aufzählungswerten, damit Werkzeuge wie DOORS Next oder Polarion Werte wie die Stellungnahme in ihre vorhandenen Objekte übernehmen.

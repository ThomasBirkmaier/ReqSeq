---
id: 740b11ef-2bcf-4200-b544-9c3ce17a4f4d
type: system-requirement
status: approved
title: Export an die Quelle in ihrem Modell schreiben
spec-id: SR-158
rationale: "Entscheidung des Produktverantwortlichen, 2026-11-01: Der Export an eine Quelle bleibt eine ReqSeq-Datei und nutzt von der Zuordnung nur ihre Export-Einstellungen (SR-054 AK2). Damit Werkzeuge wie DOORS Next oder Polarion Werte wie die Stellungnahme (SR-058) in ihre vorhandenen Objekte übernehmen, soll der Export die Datei zusätzlich im Modell der Quelle schreiben können. Eingetragen in Später."
requirement-type: interface
acceptance-criteria:
  - Gegeben importierte Requirements einer Quelle und ihre gespeicherte Zuordnung, wenn sie im Modell der Quelle an die Quelle exportiert werden, dann tragen SPEC-OBJECT-TYPE, ATTRIBUTE-DEFINITION und Datentyp jeweils den IDENTIFIER und den LONG-NAME der Quelle und jedes Requirement seinen ursprünglichen IDENTIFIER.
  - Gegeben eine Auswahl-Property, deren Werte die Zuordnung den Werten einer Aufzählung der Quelle zuordnet, wenn sie so exportiert wird, dann trägt die Datei die Aufzählungswerte der Quelle.
  - Gegeben importierte Requirements mit Stellungnahme, wenn sie so mit Stellungnahme exportiert werden (SR-058), dann steht die Stellungnahme im Attribut laut Zuordnung am SPEC-OBJECT-TYPE der Quelle.
  - Gegeben dieser Export, wenn er gegen das Schema von ReqIF 1.2 geprüft wird, dann ist er gültig.
verification-method: test
topic: Import und Export
packages:
  - { id: c64ee86d-761a-4180-bfb1-cde819bfc27c, version: n1:fd3ed3f03b3d762f, title: Später }
refines:
  - { id: 6adc6d25-0c38-4486-8849-02874ac41f76, version: n1:b316ca541885a2eb, title: Stellungnahme als ReqIF exportieren }
derives-from:
  - { id: 6adc6159-80e0-4421-84c4-4055e6912b63, version: n1:5e594bd18b6129c8, title: Stellungnahme per ReqIF zurückgeben }
based-on:
  - { id: 6adc5318-7e31-4925-b180-ff19c4c61c5f, version: n1:ed13abb3520fa053, title: Kein Austausch von Metamodellen }
---

Das Tool muss den Export an eine Quelle wahlweise im Modell der Quelle schreiben können, mit deren Typen, Attributen, Datentypen und Aufzählungswerten, damit Werkzeuge wie DOORS Next oder Polarion Werte wie die Stellungnahme in ihre vorhandenen Objekte übernehmen.

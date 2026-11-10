---
id: 5496fb70-2008-4e3a-861f-f7eac225c6f3
type: system-requirement
status: draft
title: Akzeptanzkriterien mit Kriterienschlüssel und Nummer ausgeben
spec-id: SR-205
rationale: "Entscheidung des Produktverantwortlichen, 2026-11-10: Tests nennen einzelne Akzeptanzkriterien. Eine Nummer würde nach dem Einfügen oder Verschieben still auf ein anderes Akzeptanzkriterium zeigen, und feste Nummern mit Lücken würden Nutzer für einen Fehler halten. Deshalb trägt jedes Akzeptanzkriterium einen festen Kriterienschlüssel, und angezeigt wird die Position."
requirement-type: interface
acceptance-criteria:
  - Gegeben ein Requirement mit Akzeptanzkriterien, wenn es abgefragt wird (App, Kommandozeile, API, MCP), dann liefert das Tool zu jedem Akzeptanzkriterium Kriterienschlüssel, Nummer, Text und den Bezug für einen Testnamen, etwa `[SR-036/AK-k7f3]`, mit der Kennung des Requirements oder, ohne Kennung, seiner Kurz-ID.
  - Gegeben eine Ausgabe nennt ein Akzeptanzkriterium, etwa im Nachweisstatus, in den Datensätzen oder in einer Baseline, wenn sie erzeugt wird, dann nennt sie Kriterienschlüssel und Nummer; die Nummer ist die Position in der Fassung, deren Akzeptanzkriterien gezählt werden, und ein Kriterienschlüssel, den diese Fassung nicht hat, erscheint ohne Nummer.
  - Gegeben Akzeptanzkriterien wurden eingefügt, verschoben oder entfernt, wenn sie angezeigt werden, dann sind ihre Nummern lückenlos von 1 an.
  - Gegeben ein Akzeptanzkriterium in der App, wenn sein Bezug kopiert wird (Kontextmenü und Befehlszeile), dann steht der Bezug für einen Testnamen in der Zwischenablage.
  - Gegeben ein Bezug mit Kriterienschlüssel, etwa `[SR-036/AK-k7f3]` aus einem fehlgeschlagenen Test, wenn er aufgelöst wird (App, Kommandozeile, API, MCP), dann nennt das Tool Requirement, Nummer und Text des Akzeptanzkriteriums.
packages:
  - { id: ed14d465-fd3f-4188-992b-3ff7af8595af, version: n2:1261455098bd8d6a, title: Nachweis und Abdeckung }
verification-method: test
derives-from:
  - { id: 6ad49bf3-78bf-4ed8-9311-04142d2988ac, version: n2:3c28eb663e715c27, title: Nachweisstatus aus anderen Werkzeugen }
  - { id: 6ad39e3f-89cc-42d3-9499-8cfa89caf73c, version: n2:b6a8d4281d1101b3, title: Wenig Aufwand für Werkzeuganbindung }
based-on:
  - { id: 3d5793a1-a4d5-493c-892b-c1b1dded5eca, version: n2:c98e4d2e2b546d5d, title: Nachweisstatus je Akzeptanzkriterium }
---

Das Tool muss zu jedem Akzeptanzkriterium Kriterienschlüssel, Nummer und Text ausgeben und einen Bezug für Testnamen liefern, der auf das Akzeptanzkriterium zeigt, auch wenn sich seine Nummer ändert.

---
id: 74bc69b0-f7d1-4ad2-8d2f-ae9a561cde2f
type: system-requirement
status: approved
title: Listen, Startseite und Paketseiten im HTML-Export
spec-id: SR-233
requirement-type: functional
acceptance-criteria:
  - key: pmt8
    text: Gegeben ein Typ mit mindestens einem gültigen Element, außer Typen mit der Bedeutung Paket oder Variante, wenn seine Liste geöffnet wird, dann zeigt sie je Element eine Zeile mit Kennung, Titel, Status, Paket, der Zahl seiner offenen Hinweise und, bei Requirements, dem Nachweisstatus im Kern (ein Requirement, das nicht in der Sicht des Kerns steht, zeigt keinen, wie [SR-137](reqseq:f2d94bd2-e53d-4495-9343-8d01ab466d85?version=n2:9d491620789e34d4) AK4); die Zeilen lassen sich über ein Suchfeld auf Kennung, Kurz-ID und Titel einschränken, nach Status, Paket, Nachweisstatus und jeder Property mit festen Werten filtern (mehrere Werte einer Angabe gelten mit oder, mehrere Angaben mit und; jeder Wert nennt die Zahl seiner Treffer), nach jeder Spalte in der Ordnung von [SR-075](reqseq:6adc6d90-2b1b-4060-86c6-1b5a0fd6e27a?version=n2:c1b9abd450fa8acf) AK1 sortieren, den Nachweisstatus in der Ordnung von SR-075 AK4, und nach einer dieser Angaben gruppieren.
  - key: p6z2
    text: Gegeben eine Liste und eine gewählte Baseline, wenn verglichen wird, dann zeigt die Liste eine Spalte und einen Filter mit der Änderung seit der Baseline, mit den Werten wie in [SR-232](reqseq:f401459c-75fd-48f2-8874-67f6800b2d2a?version=n2:dadcc029833128c4) AK7; ohne gewählte Baseline gibt es keinen Vergleich, und das ist die Vorgabe.
  - key: hqc9
    text: Gegeben ein exportierter Arbeitsbereich, wenn die Startseite angezeigt wird, dann trägt sie den Namen des Arbeitsbereichs und nennt Commit, Datum des Exports und Version des Tools, den Nachweisgrad im Kern mit der Anzahl je Nachweisstatus, die Requirements, deren Nachweisstatus im Kern nicht bestanden, veraltet oder offen ist, die Elemente mit offenen Hinweisen, die Zahl der geänderten und hinzugefügten Elemente seit der neuesten Baseline und je Typ die Zahl seiner Elemente mit Link auf seine Liste; fehlt ein Repository lokal, sagt sie, dass der Export unvollständig ist ([SR-006](reqseq:6adc6ac9-5d28-45d7-9c2c-18ed8887e1e1?version=n2:db49f247048c3643) AK2).
  - key: kh76
    text: Gegeben ein Paket, wenn eine Seite des Exports angezeigt wird, dann nennt ihre Navigation jedes Paket mit Link auf seine Seite, und die Seite des Pakets zeigt seinen Text und seine Elemente mit Kennung, Titel, Status und, bei Requirements, dem Nachweisstatus im Kern (ein Requirement, das nicht in der Sicht des Kerns steht, zeigt keinen, wie AK1).
  - key: twk6
    text: Gegeben ein Browser ohne JavaScript, wenn eine Liste geöffnet wird, dann steht sie vollständig als Tabelle da; Suche, Filter, Sortierung und Vergleich brauchen Skript, und ein Mermaid-Block zeigt dann seinen Quelltext.
packages:
  - { id: 17252361-b899-4483-ba2b-baf32da3193e, version: n2:233cd483722ffe08, title: Zugänge und Anbindung }
verification-method: test
based-on:
  - { id: b413f77d-743e-4abe-8b79-bceb24c4b7ca, version: n2:ea62ff545cc1d56b, title: HTML-Export erzeugt das Tool selbst }
  - { id: 6adc615b-8a00-4ce4-9526-56bd3b72bfc9, version: n2:7c87e88362a6b473, title: Keine feste Reihenfolge }
  - { id: 6ad4a03f-d7cf-4b85-98da-3f4431f33fe7, version: n2:84d08b2dbd1bf992, title: Auswertungen mit externen Werkzeugen }
derives-from:
  - { id: 39e94ec5-33f0-4745-aff7-37c82bc6cd0e, version: n2:aeeed6f1f4b3a5f4, title: Elemente ohne das Tool im Browser lesen }
  - { id: 6adc50a5-05d9-4e59-adfc-ae0179b6e5bf, version: n2:b861b59a0ef949e1, title: Filtern }
---

Das [Tool](reqseq:6ad4f973-fdb9-461f-8dc4-b73619ba1dac?version=n2:2427cdd2079ee312) muss im [HTML-Export](reqseq:7f240c30-80c6-476d-bc9c-0215a0fef867?version=n2:7e08d73bbf3cc65a) je Typ eine Liste seiner Elemente, je [Paket](reqseq:6ad4f97f-7000-48de-a0c1-3d4e5d126cf7?version=n2:add50f9ad9b0d77e) eine Seite und eine Startseite mit dem [Nachweisgrad](reqseq:6ad4f977-5b23-4a33-a450-d377e776a54b?version=n2:36cf695a2c408b4f) zeigen.

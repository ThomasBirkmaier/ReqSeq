---
id: 6adc6bd6-5f7d-44f8-bc1d-be89db7ba23f
type: system-requirement
status: draft
title: "Kette aufwärts und abwärts zeigen"
spec-id: "SR-022"
requirement-type: functional
acceptance-criteria:
  - "Gegeben ein Need mit abgeleiteten System Requirements, Component Requirements und Nachweisen, wenn die Kette des Needs angezeigt wird, dann erscheinen alle Ebenen bis zu den Nachweisen mit ihrer Tiefe."
  - "Gegeben ein Component Requirement, wenn seine Kette aufwärts angezeigt wird, dann erscheinen alle Parents bis zu den Needs."
  - "Gegeben eine Ebene ohne Child oder ohne Nachweis, wenn die Kette angezeigt wird, dann ist die Lücke gekennzeichnet."
  - "Gegeben ein Zyklus in den Ableitungen, wenn die Kette angezeigt wird, dann bricht das Tool am Zyklus ab und meldet ihn als Hinweis."
verification-method: test
topic: "Traceability und Ketten"
packages:
  - { id: 76455508-8047-4fdc-ba94-495751bd880b, version: n1:fc6046c245ac6717, title: "Stufe 2: Traceability" }
derives-from:
  - { id: 6ad3a132-19a2-4a9c-83c7-2470c9c71be1, version: n1:ab23c3ad252d23f2, title: Vollständige Kette vom Parent bis zum Child }
  - { id: 6ad49bf0-0608-4419-8ed7-17ae97059199, version: n1:a8503d8bd977adba, title: Traceability bis zum Nachweis }
based-on:
  - { id: 6ad4ffaa-f5ad-494e-97eb-a4c77c54dccc, version: n1:24d0db5bd6fe4be0, title: Fest eingebaute Bedeutungen des Metamodells }
---

Das Tool muss zu jedem Element die vollständige Kette aufwärts bis zu den obersten Parents und abwärts bis zu den Nachweisen zeigen.

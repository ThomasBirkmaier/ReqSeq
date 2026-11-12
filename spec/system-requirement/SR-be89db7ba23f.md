---
id: 6adc6bd6-5f7d-44f8-bc1d-be89db7ba23f
type: system-requirement
status: approved
title: "Kette aufwärts und abwärts zeigen"
spec-id: "SR-022"
requirement-type: functional
acceptance-criteria:
  - key: rmkp
    text: Gegeben ein Need mit abgeleiteten System Requirements, Component Requirements und Nachweisen, wenn die Kette des Needs angezeigt wird, dann erscheinen alle Ebenen bis zu den Nachweisen mit ihrer Tiefe.
  - key: dqf1
    text: Gegeben ein Component Requirement, wenn seine Kette aufwärts angezeigt wird, dann erscheinen alle Parents bis zu den Needs.
  - key: g8js
    text: Gegeben ein Need der Kette ohne Child oder ein Requirement ohne Child und ohne Nachweis, wenn die Kette angezeigt wird, dann ist die Lücke gekennzeichnet.
  - key: vvhc
    text: Gegeben ein Zyklus in den Ableitungen, wenn die Kette angezeigt wird, dann bricht das Tool am Zyklus ab und meldet ihn als Hinweis.
  - key: s38c
    text: "Gegeben ein Element eines Typs mit der Bedeutung Requirement, das über keine Beziehung mit der Bedeutung Ableitung einen Parent hat, wenn seine Kette angezeigt wird (App, CLI, API, MCP: `trace.chain`), dann ist der fehlende Parent als Lücke gekennzeichnet."
  - key: bb3n
    text: "Gegeben dasselbe Element, wenn der Bestand geprüft wird (CLI, API, MCP: `workspace.check`), dann meldet das Tool es als Hinweis mit seiner ID."
verification-method: test
packages:
  - { id: 546c26ea-a25f-4ccf-a9c7-ce63607961b3, version: n2:dd8ebe8868421160, title: Traceability }
derives-from:
  - { id: 6ad3a132-19a2-4a9c-83c7-2470c9c71be1, version: n1:ab23c3ad252d23f2, title: Vollständige Kette vom Parent bis zum Child }
  - { id: 6ad49bf0-0608-4419-8ed7-17ae97059199, version: n1:a8503d8bd977adba, title: Traceability bis zum Nachweis }
based-on:
  - { id: 6ad4ffaa-f5ad-494e-97eb-a4c77c54dccc, version: n2:c94085aee93eede7, title: Fest eingebaute Bedeutungen des Metamodells }
rationale: "Ein Requirement ohne Parent soll mit einem Befehl auffindbar sein, ohne eigenes Metamodell. Eine Entscheidung wird dagegen kein Parent: Based on bleibt ohne Bedeutung für die Kette; ein Projekt, das Entscheidungen als Parent zeigen will, gibt seiner Beziehungsart im eigenen Metamodell die Bedeutung Ableitung. Anlass ist ein Befund aus dem ersten Pilotlauf (#626)."
---

Das Tool muss zu jedem Element die vollständige Kette aufwärts bis zu den obersten Parents und abwärts bis zu den Nachweisen zeigen.

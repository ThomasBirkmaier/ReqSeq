---
id: 24249b73-ffbe-4332-bec2-74aacfb3e15b
type: system-requirement
status: approved
title: Alle Buffer schließen
spec-id: SR-123
rationale: "Entscheidung des Produktverantwortlichen, 2026-10-26: Es fehlt ein Befehl, der alle Buffer schließt (#411)."
requirement-type: functional
acceptance-criteria:
  - Gegeben mehrere offene Buffer, wenn der Befehl „Close all buffers“ ausgeführt wird, dann sind alle Buffer geschlossen.
  - Gegeben ein Buffer mit ungespeicherten Änderungen, wenn alle Buffer geschlossen werden, dann fragt die App in der Befehlszeile nach und öffnet keinen modalen Dialog.
  - Gegeben die Befehlszeile mit den Befehlen, wenn „cab“ getippt wird, dann steht „Close all buffers“ an erster Stelle.
verification-method: test
topic: Bearbeiten und Finden
packages:
  - { id: cf800f25-d03d-4092-8783-334263089f89, version: n1:3ec49c0d5a7866d3, title: "Stufe 3: Oberfläche" }
derives-from:
  - { id: d546b567-fda6-410d-a379-78deec04bfe2, version: n1:7ea137b2c763b6b2, title: Nur Aussagekräftiges sehen }
based-on:
  - { id: c14efb7d-59da-4ef5-9b85-626310b9a57e, version: n1:ce1d13c56aad179c, title: Oberfläche als weißes Blatt }
refines:
  - { id: 0f759f3b-b03d-42f5-a38a-b0ca831ca864, version: n1:88f7a1e2a1bfc5a9, title: In Buffern arbeiten }
---

Die App muss alle offenen Buffer mit einem Befehl schließen lassen.

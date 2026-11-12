---
id: 24249b73-ffbe-4332-bec2-74aacfb3e15b
type: system-requirement
status: approved
title: Alle Buffer schließen
spec-id: SR-123
rationale: Es fehlt ein Befehl, der alle Buffer schließt (ThomasBirkmaier/ReqSeq-archive#411).
requirement-type: functional
acceptance-criteria:
  - Gegeben mehrere offene Buffer, wenn der Befehl „Close all buffers“ ausgeführt wird, dann sind alle Buffer außer der Übersicht geschlossen.
  - Gegeben ein Buffer mit Eingaben, die noch nicht in der Datei stehen, wenn alle Buffer geschlossen werden, dann schreibt die App sie zuerst in die Datei (SR-105 AK1); lassen sich Eingaben nicht schreiben (SR-105 AK5, SR-106 AK2), fragt sie in der Befehlszeile und nicht in einem modalen Dialog, ob alle Buffer außer diesen geschlossen werden oder alle und ihre Eingaben verworfen werden; Enter wählt das Erste, und Escape schließt keinen Buffer.
  - Gegeben die Befehlszeile mit den Befehlen und mindestens ein offener Buffer außer der Übersicht, wenn „cab“ getippt wird, dann steht „Close all buffers“ an erster Stelle.
verification-method: test
packages:
  - { id: 5c0075c7-0fad-483a-b35e-af77d1499468, version: n2:23c8afe7316d80f6, title: Bedienung der App }
derives-from:
  - { id: d546b567-fda6-410d-a379-78deec04bfe2, version: n1:ff4acfc7f0085726, title: Nur Aussagekräftiges sehen }
based-on:
  - { id: c14efb7d-59da-4ef5-9b85-626310b9a57e, version: n2:2ec3810c4995e7aa, title: Oberfläche als weißes Blatt }
refines:
  - { id: 0f759f3b-b03d-42f5-a38a-b0ca831ca864, version: n2:8db21e7aaeb96d22, title: In Buffern arbeiten }
---

Die App muss alle offenen Buffer mit einem Befehl schließen lassen.

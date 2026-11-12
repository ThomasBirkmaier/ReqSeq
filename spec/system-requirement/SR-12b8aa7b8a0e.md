---
id: 6adc6d8f-8576-4055-b12b-12b8aa7b8a0e
type: system-requirement
status: approved
title: "Oberfläche auf Englisch anzeigen"
spec-id: "SR-074"
requirement-type: constraint
acceptance-criteria:
  - "Gegeben App, Kommandozeile, API, MCP-Server und Dokumentation, wenn sie geprüft werden, dann sind alle Texte, Meldungen und Hilfen auf Englisch."
  - "Gegeben Elemente mit deutschem Inhalt, wenn sie angezeigt werden, dann zeigt das Tool den Inhalt unverändert."
verification-method: inspection
packages:
  - { id: 5c0075c7-0fad-483a-b35e-af77d1499468, version: n2:23c8afe7316d80f6, title: Bedienung der App }
derives-from:
  - { id: 6ad49f57-47f2-4570-a046-b1af59b51503, version: n1:7406bb900e631830, title: "Einfach, minimalistisch und ästhetisch" }
based-on:
  - { id: 6adc50a6-2c26-4513-8a40-a2afbca60eec, version: n1:213303dcc0ab524e, title: Oberfläche nur auf Englisch }
---

Das Tool muss alle Texte seiner Oberfläche, Meldungen und Dokumentation nur auf Englisch anbieten.

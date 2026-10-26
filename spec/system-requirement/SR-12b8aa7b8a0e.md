---
id: 6adc6d8f-8576-4055-b12b-12b8aa7b8a0e
type: system-requirement
status: draft
title: "Oberfläche auf Englisch anzeigen"
spec-id: "SR-074"
requirement-type: constraint
acceptance-criteria:
  - "Gegeben App, Kommandozeile, API, MCP-Server und Dokumentation, wenn sie geprüft werden, dann sind alle Texte, Meldungen und Hilfen auf Englisch."
  - "Gegeben Elemente mit deutschem Inhalt, wenn sie angezeigt werden, dann zeigt das Tool den Inhalt unverändert."
verification-method: inspection
topic: "Bearbeiten und Finden"
packages:
  - { id: 7a12a8c7-43e7-4349-9453-0ac2b6d5157d, version: n1:648fcf9e635aa114, title: Querschnitt }
derives-from:
  - { id: 6ad49f57-47f2-4570-a046-b1af59b51503, version: n1:38d37db10c3c86df, title: "Einfach, minimalistisch und ästhetisch" }
based-on:
  - { id: 6adc50a6-2c26-4513-8a40-a2afbca60eec, version: n1:3403af88ba883828, title: Oberfläche nur auf Englisch }
---

Das Tool muss alle Texte seiner Oberfläche, Meldungen und Dokumentation nur auf Englisch anbieten.

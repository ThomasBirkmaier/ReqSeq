---
id: e1aca253-af02-4724-8748-baebce42f2bf
type: system-requirement
status: approved
title: Einstieg als Animation in der README zeigen
spec-id: SR-203
rationale: "Entscheidung des Produktverantwortlichen, 2026-10-31: die README zeigt den Ablauf des Einstiegs als Animation in der App, damit Besucher sofort sehen, wie das Tool arbeitet; sie endet in der Graphansicht des Need, nicht in der Prüfung des Arbeitsbereichs. Entscheidung des Produktverantwortlichen, 2026-11-10: dieses Kriterium muss nur unter Linux gelten, nicht unter Windows und macOS; deshalb steht es, bisher AK4 von SR-140, in diesem Requirement, das nur für die Variante Linux gilt."
requirement-type: functional
acceptance-criteria:
  - "Gegeben die README des Repositorys, wenn sie angezeigt wird, dann zeigt sie die Schritte des Einstiegs als Animation in der App: einen Arbeitsbereich, einen Need und ein davon abgeleitetes System Requirement anlegen und die Beziehung hinzufügen; die Animation endet in der Graphansicht des Need."
validity:
  - { id: 9a7c2fca-3edf-43ab-8b68-7771b9666d08, version: n2:970f7f0a83619951, title: Linux }
packages:
  - { id: ef531b57-0991-45bf-8a1b-0cce10050063, version: n2:3f74ba2fff156a2d, title: Dokumentation }
verification-method: test
refines:
  - { id: e6faea96-23af-4d19-bbf0-622baef7e5aa, version: n2:f1a9d708c7963ffb, title: Einstieg und Anleitungen mit geprüften Beispielen }
derives-from:
  - { id: 3826ab28-2019-458a-9170-f14f25591ce1, version: n2:5d1ea5ad9235c416, title: Das Tool ohne fremde Hilfe benutzen lernen }
based-on:
  - { id: cb583de8-288a-4d8a-82f0-b2be57da2cce, version: n2:973ec19c47b64747, title: Nutzerdokumentation aus den Quellen des Tools }
---

Das Tool muss in der README seines Repositorys die Schritte des Einstiegs als Animation zeigen, die in der App abläuft und im Graphen des Needs endet.

---
id: e1aca253-af02-4724-8748-baebce42f2bf
type: system-requirement
status: approved
title: Die App an der Spezifikation des Tools als Animation in der README zeigen
spec-id: SR-203
rationale: Die README zeigt die App im Gebrauch an der Spezifikation des Tools selbst, damit Besucher sofort sehen, wie das Tool arbeitet. Die Schritte des Einstiegs zeigt die Dokumentation (SR-140). Dieses Kriterium muss nur unter Linux gelten, nicht unter Windows und macOS; deshalb steht es in einem Requirement, das nur für die Variante Linux gilt.
requirement-type: functional
acceptance-criteria:
  - key: vj7k
    text: "Gegeben die README des Repositorys, wenn sie angezeigt wird, dann zeigt sie eine Animation der App auf dem Arbeitsbereich `spec/` des Repositorys: die Befehlshilfe eines Befehls (Ctrl+H) und eine Liste der System Requirements, die gefiltert, sortiert und gruppiert wird; die Animation endet im Graphen eines Needs mit seinen System Requirements."
  - key: qq6z
    text: "Gegeben die Animation der README, wenn sie einmal durchläuft, dann dauert das höchstens 30 Sekunden."
validity:
  - { id: 9a7c2fca-3edf-43ab-8b68-7771b9666d08, version: n2:970f7f0a83619951, title: Linux }
packages:
  - { id: ef531b57-0991-45bf-8a1b-0cce10050063, version: n2:de4346c0dff1f5d3, title: Dokumentation }
verification-method: test
derives-from:
  - { id: 3826ab28-2019-458a-9170-f14f25591ce1, version: n2:5d1ea5ad9235c416, title: Das Tool ohne fremde Hilfe benutzen lernen }
based-on:
  - { id: cb583de8-288a-4d8a-82f0-b2be57da2cce, version: n2:973ec19c47b64747, title: Nutzerdokumentation aus den Quellen des Tools }
---

Das Tool muss in der README seines Repositorys eine Animation zeigen, in der die App an der Spezifikation des Tools selbst bedient wird und die im Graphen eines Needs endet.

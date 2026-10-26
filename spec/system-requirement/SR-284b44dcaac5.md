---
id: 6adc6c45-b044-4aaa-b079-284b44dcaac5
type: system-requirement
status: draft
title: "Testfälle und Durchführungen verfolgen"
spec-id: "SR-033"
requirement-type: functional
acceptance-criteria:
  - "Gegeben Datensätze nennen einen Testfall, wenn die Kette eines Requirements angezeigt wird, dann erscheinen Testfall und alle seine Durchführungen mit Datum, Ergebnis, Prüfling und Beleg."
  - "Gegeben ein Testfall weist mehrere Requirements nach, wenn einer seiner Datensätze gelesen wird, dann zählt er für jedes dieser Requirements."
  - "Gegeben ein Testfall ohne Durchführung, wenn er angezeigt wird, dann ist er als nicht durchgeführt gekennzeichnet."
verification-method: test
topic: "Nachweis und Abdeckung"
packages:
  - { id: 5e69295a-2847-469f-9bd4-a11e20ceba9f, version: n1:89fcc971400d045e, title: "Stufe 4: Nachweise" }
derives-from:
  - { id: 6adc4b47-50a8-4546-9007-f7cfdfa7b9cb, version: n1:534e615f151c6534, title: Traceability bis zu Testfall und Durchführung }
based-on:
  - { id: 6adc58f5-a349-4870-af2f-971ec1cee679, version: n1:9355a14c6f926710, title: Ein offenes Format für Nachweis-Datensätze }
---

Das Tool muss Testfälle und ihre Durchführungen als Teil der Kette bis zum Nachweis zeigen.

---
id: 6adc6c45-b044-4aaa-b079-284b44dcaac5
type: system-requirement
status: approved
title: "Testfälle und Durchführungen verfolgen"
spec-id: "SR-033"
requirement-type: functional
acceptance-criteria:
  - "Gegeben Datensätze nennen einen Testfall, wenn die Kette eines Requirements angezeigt wird, dann erscheinen Testfall und alle seine Durchführungen mit Datum, Ergebnis, Prüfling und Beleg."
  - "Gegeben ein Testfall weist mehrere Requirements nach, wenn einer seiner Datensätze gelesen wird, dann zählt er für jedes dieser Requirements."
  - "Gegeben ein Testfall ohne Durchführung, wenn er angezeigt wird, dann ist er als nicht durchgeführt gekennzeichnet."
verification-method: test
packages:
  - { id: ed14d465-fd3f-4188-992b-3ff7af8595af, version: n2:1261455098bd8d6a, title: Nachweis und Abdeckung }
derives-from:
  - { id: 6adc4b47-50a8-4546-9007-f7cfdfa7b9cb, version: n1:d8500282bf5102a9, title: Traceability bis zu Testfall und Durchführung }
based-on:
  - { id: 6adc58f5-a349-4870-af2f-971ec1cee679, version: n2:15bed38f1bb678ad, title: Ein offenes Format für Nachweis-Datensätze }
---

Das Tool muss Testfälle und ihre Durchführungen als Teil der Kette bis zum Nachweis zeigen.

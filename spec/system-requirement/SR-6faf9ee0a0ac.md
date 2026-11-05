---
id: 6adc6ba7-f2b0-4877-9f7d-6faf9ee0a0ac
type: system-requirement
status: approved
title: "Standardmodell mitliefern"
spec-id: "SR-014"
requirement-type: functional
acceptance-criteria:
  - "Gegeben ein leerer Ordner, wenn darin ein neuer Arbeitsbereich angelegt wird, dann legt das Tool das Standardmodell als Metamodell-Dateien an."
  - "Gegeben das Standardmodell, wenn es geprüft wird, dann enthält es die Typen, Properties, Beziehungsarten und Statuswerte dieser Spec mit englischen Namen und Schlüsseln."
  - "Gegeben das Standardmodell, wenn es geprüft wird, dann ist jede Bedeutung aus D-012 mindestens einem Schlüssel zugeordnet, eine Bedeutung von Typen und Properties genau einem."
verification-method: test
topic: "Metamodell und Typen"
packages:
  - { id: 46610a27-2866-47fb-bb8f-293faae4885f, version: n2:fe4e82907ae44795, title: "Stufe 1: Fundament" }
derives-from:
  - { id: 6ad47d8b-773c-4d21-bf35-1b7deeb96561, version: n1:de3fc7e167c1c882, title: Anpassbares Metamodell }
based-on:
  - { id: 6adc50a6-2c26-4513-8a40-a2afbca60eec, version: n1:213303dcc0ab524e, title: Oberfläche nur auf Englisch }
  - { id: 6adc615b-272a-4377-82e5-9ae991d75bb2, version: n2:a63440db8f6c0cff, title: Statuswerte kommen aus dem Metamodell }
  - { id: 6adc615b-8a00-4ce4-9526-56bd3b72bfc9, version: n2:94db6c18414603e6, title: Keine feste Reihenfolge }
  - { id: 6adc691e-6394-45b3-a796-31e830aa3392, version: n2:3e0c480389b79547, title: Das Standardmodell entspricht dem Modell dieser Spec }
  - { id: 6adc78d3-0812-43dc-94fe-7af63b9acd96, version: n1:be14797fb9d20d4c, title: Bedeutungen und Standardmodell vervollständigt }
  - { id: dc1e4965-0c68-474e-9ab6-2233c6ec2ad3, version: n2:dfe40087504a49ac, title: Priorität und Validierungskriterien am Need }
issue: https://github.com/ThomasBirkmaier/ReqSeq/issues/21
---

Das Tool muss das Standardmodell mitliefern und es beim Anlegen eines neuen Arbeitsbereichs als Metamodell anlegen.

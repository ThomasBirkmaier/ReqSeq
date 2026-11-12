---
id: 6adc6ba7-f2b0-4877-9f7d-6faf9ee0a0ac
type: system-requirement
status: approved
title: "Standardmodell mitliefern"
spec-id: "SR-014"
requirement-type: functional
acceptance-criteria:
  - "Gegeben ein Ordner, der noch kein Arbeitsbereich ist, wenn darin ein neuer Arbeitsbereich angelegt wird (App, CLI, API, MCP: `workspace.init`), dann legt das Tool die Arbeitsbereichs-Datei mit diesem Ordner als Haupt-Repository und das Standardmodell als Metamodell-Dateien an, legt den Ordner an, wenn er fehlt, ändert keine vorhandene Datei außer `.gitignore`, in der es die Zeilen für seine temporären Dateien und für `.reqseq/local.yaml` ergänzt oder die es dafür anlegt, und schreibt nichts in Git; ist der Ordner schon ein Arbeitsbereich, lehnt es das ab."
  - "Gegeben das Standardmodell, wenn es geprüft wird, dann enthält es genau die Typen, Properties, Beziehungsarten und Statuswerte, die D-037, D-059, D-060 und D-071 nennen, mit englischen Namen und Schlüsseln."
  - "Gegeben das Standardmodell, wenn es geprüft wird, dann ist jede Bedeutung aus D-059 mindestens einem Schlüssel zugeordnet, eine Bedeutung von Typen und Properties genau einem; ausgenommen ist die Kennung, die das Standardmodell keinem Schlüssel zuordnet, und ein Typ, der eine Bedeutung nur erbt, zählt nicht mit."
verification-method: test
packages:
  - { id: dfdbf57e-059c-49ed-b9b2-21c51e291b3c, version: n2:9a6d5b6b85dc5026, title: Metamodell und Prüfung }
derives-from:
  - { id: 6ad47d8b-773c-4d21-bf35-1b7deeb96561, version: n1:de3fc7e167c1c882, title: Anpassbares Metamodell }
based-on:
  - { id: 6adc50a6-2c26-4513-8a40-a2afbca60eec, version: n1:213303dcc0ab524e, title: Oberfläche nur auf Englisch }
  - { id: 6adc615b-272a-4377-82e5-9ae991d75bb2, version: n2:5086a4bc7d6ff7de, title: Statuswerte kommen aus dem Metamodell }
  - { id: 6adc615b-8a00-4ce4-9526-56bd3b72bfc9, version: n2:a493a9e966643ed5, title: Keine feste Reihenfolge }
  - { id: 6adc691e-6394-45b3-a796-31e830aa3392, version: n2:679806539676c56d, title: Was das Standardmodell enthält }
  - { id: 6adc78d3-0812-43dc-94fe-7af63b9acd96, version: n2:bb11050375857ccd, title: Bedeutungen und Standardmodell vervollständigt }
  - { id: dc1e4965-0c68-474e-9ab6-2233c6ec2ad3, version: n2:fe91fa92628091b5, title: Priorität und Validierungskriterien am Need }
  - { id: 6adda963-e280-4f8a-8c98-2b03ad686936, version: n2:d8ae58bda42b7eb1, title: Thema im Standardmodell }
---

Das Tool muss das Standardmodell mitliefern und es beim Anlegen eines neuen Arbeitsbereichs als Metamodell anlegen.

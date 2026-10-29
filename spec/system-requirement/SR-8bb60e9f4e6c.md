---
id: 6adc6c44-ff50-43b1-88d3-8bb60e9f4e6c
type: system-requirement
status: approved
title: "Nachweis mit Fassung, Prüfling und Baselines zeigen"
spec-id: "SR-032"
requirement-type: functional
acceptance-criteria:
  - "Gegeben ein Requirement mit Datensätzen, wenn seine Nachweise angezeigt werden, dann zeigt das Tool zu jedem Datensatz Fassung, Prüfling, Datum, Ergebnis und Beleg."
  - "Gegeben die Fassung eines Datensatzes ist in Baselines enthalten, wenn er angezeigt wird, dann nennt das Tool diese Baselines."
verification-method: test
topic: "Nachweis und Abdeckung"
packages:
  - { id: 5e69295a-2847-469f-9bd4-a11e20ceba9f, version: n1:3b91c1fbe49a06cc, title: "Stufe 4: Nachweise" }
derives-from:
  - { id: 6ad3a129-d7b1-4b17-a9d7-6caf73d38315, version: n1:9b945f99f310e930, title: "Requirement, Baseline und Nachweis" }
based-on:
  - { id: 6adc691f-cfbf-4934-9504-21c1fc5849f7, version: n1:5b059ebfcd539c6b, title: Baseline als Datei }
---

Das Tool muss zu jedem Nachweis zeigen, für welche Fassung, welchen Prüfling und welche Baselines er gilt.

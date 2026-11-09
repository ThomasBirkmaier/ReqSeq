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
  - "Gegeben ein Requirement mit mehreren Datensätzen, wenn seine Nachweise in der App angezeigt werden, dann stehen offen nur die Datensätze, die seinen Nachweisstatus tragen: je Akzeptanzkriterium und Variante der neueste zur aktuellen Fassung (D-072) oder, wenn es zu ihr keinen gibt, der neueste zu einer älteren Fassung; alle übrigen stehen in einem zugeklappten Abschnitt darunter, der ihre Zahl nennt und sich per Klick und Tastatur auf- und zuklappen lässt."
verification-method: test
packages:
  - { id: ed14d465-fd3f-4188-992b-3ff7af8595af, version: n2:1261455098bd8d6a, title: Nachweis und Abdeckung }
derives-from:
  - { id: 6ad3a129-d7b1-4b17-a9d7-6caf73d38315, version: n1:9b945f99f310e930, title: "Requirement, Baseline und Nachweis" }
based-on:
  - { id: 6adc691f-cfbf-4934-9504-21c1fc5849f7, version: n2:9f5afea8292bf01a, title: Baseline als Datei }
rationale: "Entscheidung des Produktverantwortlichen, 2026-11-08: Die Nachweis-Ansicht zeigte jeden Datensatz, den es je gab, und wirkte unübersichtlich. Alle Datensätze bleiben sichtbar, wie AK1 verlangt, aber offen steht nur, was den Status trägt; die Historie ist eingeklappt wie ein Abschnitt im Editor."
---

Das Tool muss zu jedem Nachweis zeigen, für welche Fassung, welchen Prüfling und welche Baselines er gilt.

---
id: 6adc6c8f-e59c-42b0-a9db-ff7c2d593c9c
type: system-requirement
status: approved
title: "Kern-Requirement in einer Variante ersetzen"
spec-id: "SR-041"
requirement-type: functional
acceptance-criteria:
  - "Gegeben das Kern-Requirement SR-K „Antwortzeit höchstens 10 ms“ und das Requirement SR-A „Antwortzeit höchstens 20 ms“ mit Gültigkeit [A] und der Beziehung ersetzt auf SR-K, wenn die Sicht von A berechnet wird (App, CLI, API, MCP: `selection.view` A, zum Beispiel mit `element.list`), dann erscheint SR-A statt SR-K."
  - Gegeben die Beziehung ersetzt, wenn sie gespeichert wird, dann enthält sie die Fassung des ersetzten Kern-Requirements.
  - Gegeben die Sicht des Kerns oder einer anderen Variante, wenn sie berechnet wird, dann bleibt das Kern-Requirement darin.
  - Gegeben SR-A hat die Gültigkeit [A, B] und ersetzt SR-K, wenn die Sichten von A, B und einer weiteren Variante C berechnet werden, dann steht SR-A in A und B statt SR-K, und in C bleibt SR-K.
  - "Gegeben SR-K hat Children und SR-A ersetzt SR-K in A, wenn Kette, Abdeckung oder indirekter Nachweis in der Sicht von A berechnet werden, dann hängen die Children von SR-K nicht unter SR-A: SR-A hat nur seine eigenen Beziehungen, und die Children von SR-K stehen dort, wo ihre eigene Gültigkeit sie hinstellt."
  - "Gegeben ein Requirement ohne Gültigkeit mit der Beziehung ersetzt auf SR-K, wenn eine Sicht berechnet wird, dann bleibt SR-K in jeder Sicht: Ersetzen wirkt nur in den Varianten der Gültigkeit des ersetzenden Requirements. Soll ein Kern-Requirement für alle durch ein anderes abgelöst werden, geschieht das mit Ablösen (SR-072)."
  - Gegeben SR-A1 und SR-A2 haben beide die Gültigkeit [A] und ersetzen SR-K, wenn die Sicht von A berechnet wird, dann erscheinen SR-A1 und SR-A2 statt SR-K, und das Tool gibt dazu keinen Hinweis.
  - Gegeben SR-A mit Gültigkeit [A] hat die Beziehung ersetzt auf ein Requirement mit Gültigkeit oder auf ein Element ohne Property mit der Bedeutung Gültigkeit, zum Beispiel einen Need oder ein Paket, wenn eine Sicht berechnet wird oder `workspace.check` läuft, dann ändert sich keine Sicht, das Tool meldet einen Hinweis an der Zeile des Eintrags (wie SR-039 AK3), und im Unterschied von A zum Kern (SR-044) steht SR-A bei den ergänzten Requirements.
verification-method: test
topic: "Varianten"
packages:
  - { id: c44d8f37-ca09-4e36-8bcb-772f426a3e1a, version: n1:6b74dcb250ac00c8, title: "Stufe 5: Pakete, Baselines und Varianten" }
derives-from:
  - { id: 6ad3a420-474e-4443-82d6-56a362271467, version: n1:01158fe8c5032e68, title: Variante ersetzt Kern-Requirement }
based-on:
  - { id: 6adc4946-b44c-4ae1-8dbf-fb9e88b8c607, version: n1:0c3f2da31ca1ae9a, title: Fassung als Prüfwert über den Inhalt }
  - { id: 6adc5316-641d-4817-964e-8803a78ac710, version: n1:98453db7e5f7bec6, title: Varianten über eine Gültigkeitsliste }
---

Das Tool muss ein Kern-Requirement für eine Variante durch ein eigenes Requirement ersetzen lassen und dabei die Fassung des ersetzten Requirements speichern.

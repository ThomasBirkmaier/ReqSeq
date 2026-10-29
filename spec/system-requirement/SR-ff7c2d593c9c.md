---
id: 6adc6c8f-e59c-42b0-a9db-ff7c2d593c9c
type: system-requirement
status: draft
title: "Kern-Requirement in einer Variante ersetzen"
spec-id: "SR-041"
requirement-type: functional
acceptance-criteria:
  - "Gegeben ein Requirement einer Variante mit der Beziehung ersetzt auf ein Kern-Requirement, wenn die Sicht der Variante berechnet wird, dann erscheint das ersetzende Requirement statt des Kern-Requirements."
  - "Gegeben die Beziehung ersetzt, wenn sie gespeichert wird, dann enthält sie die Fassung des ersetzten Kern-Requirements."
  - "Gegeben die Sicht des Kerns oder einer anderen Variante, wenn sie berechnet wird, dann bleibt das Kern-Requirement darin."
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

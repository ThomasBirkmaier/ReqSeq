---
id: 6adc6c94-23b3-4151-b702-ab8e8d17dc02
type: system-requirement
status: draft
title: "Hinweis bei Änderung im Kern geben"
spec-id: "SR-045"
requirement-type: functional
acceptance-criteria:
  - "Gegeben ein ersetztes Kern-Requirement wird inhaltlich geändert, wenn das Tool die Änderung bemerkt, dann zeigt es an der Variante einen Hinweis mit der gespeicherten und der aktuellen Fassung."
  - "Gegeben der Hinweis wird bestätigt, wenn erneut geprüft wird, dann erscheint er nicht mehr."
verification-method: test
topic: "Varianten"
packages:
  - { id: c44d8f37-ca09-4e36-8bcb-772f426a3e1a, version: n1:54e1ce86e105e590, title: "Stufe 5: Pakete, Baselines und Varianten" }
derives-from:
  - { id: 6ad3a4c6-cb89-4fc6-acdf-ff0c8aad33ed, version: n1:7eb1cbe08b45f5da, title: Hinweis bei Änderung im Kern }
based-on:
  - { id: 6adc4946-b44c-4ae1-8dbf-fb9e88b8c607, version: n1:d69cab9f2920b732, title: Fassung als Prüfwert über den Inhalt }
  - { id: 6adc6921-d1f2-4800-aa1b-0a39de119f56, version: n1:c834fefda56c18dd, title: Hinweise werden bestätigt }
---

Wenn sich ein Kern-Requirement ändert, das eine Variante ersetzt, muss das Tool an der Variante einen Hinweis zeigen.

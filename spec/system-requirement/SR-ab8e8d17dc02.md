---
id: 6adc6c94-23b3-4151-b702-ab8e8d17dc02
type: system-requirement
status: draft
title: "Hinweis bei Änderung im Kern geben"
spec-id: "SR-045"
requirement-type: functional
acceptance-criteria:
  - "Gegeben SR-A mit Gültigkeit [A] ersetzt das Kern-Requirement SR-K, und der Inhalt von SR-K wird geändert, wenn die Hinweise abgefragt werden (CLI, API, MCP: `hint.list` oder `workspace.check`; App: Seite von SR-A und Liste der Hinweise von A), dann steht am ersetzenden Requirement SR-A ein Hinweis mit der gespeicherten und der aktuellen Fassung von SR-K, und `hint.list` mit der Variante A listet ihn. Es ist ein Hinweis, kein zweiter neben dem Hinweis auf die veraltete Beziehung."
  - Gegeben der Hinweis wird mit `hint.confirm` bestätigt, wenn die Hinweise erneut abgefragt werden, dann erscheint er nicht mehr, und die Beziehung ersetzt enthält die aktuelle Fassung und den aktuellen Titel von SR-K (D-042).
  - Gegeben an SR-K ändert sich nur der Titel, wenn die Hinweise abgefragt werden, dann gibt es keinen Hinweis; den gespeicherten Titel schreibt das Tool neu, wenn es die Datei von SR-A das nächste Mal schreibt (D-042).
verification-method: test
topic: "Varianten"
packages:
  - { id: c44d8f37-ca09-4e36-8bcb-772f426a3e1a, version: n1:6b74dcb250ac00c8, title: "Stufe 5: Pakete, Baselines und Varianten" }
derives-from:
  - { id: 6ad3a4c6-cb89-4fc6-acdf-ff0c8aad33ed, version: n1:0d48a780647af98d, title: Hinweis bei Änderung im Kern }
based-on:
  - { id: 6adc4946-b44c-4ae1-8dbf-fb9e88b8c607, version: n1:0c3f2da31ca1ae9a, title: Fassung als Prüfwert über den Inhalt }
  - { id: 6adc6921-d1f2-4800-aa1b-0a39de119f56, version: n1:eec226f317cdbcf7, title: Hinweise werden bestätigt }
---

Wenn sich ein Kern-Requirement ändert, das eine Variante durch ein eigenes Requirement ersetzt hat, muss das Tool am ersetzenden Requirement einen Hinweis zeigen, den die Variante auflistet.

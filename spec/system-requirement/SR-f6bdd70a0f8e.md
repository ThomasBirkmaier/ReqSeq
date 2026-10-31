---
id: 314d1458-93cd-4df7-8ee0-f6bdd70a0f8e
type: system-requirement
status: approved
title: Lücken in der Matrix nur bei erwarteten Beziehungen zeigen
spec-id: SR-153
rationale: "Entscheidung des Produktverantwortlichen, 2026-10-31: Die Matrix wertet heute jede leere Zelle als Lücke (SR-125 AK3). Ein Anteil von 66 % in der Spalte „Refines“ sieht deshalb nach einer Lücke aus, obwohl ein System Requirement kein anderes verfeinern muss. Als Lücke soll nur gelten, was das Metamodell als Mindestzahl verlangt (SR-152); für diese Spalten ersetzt das SR-125 AK3. Eingetragen in Später."
requirement-type: functional
acceptance-criteria:
  - Gegeben das Metamodell legt für eine Beziehungsart eine Mindestzahl ab 1 für den Typ einer Zeile fest, wenn die Matrix angezeigt wird, dann ist die Zelle dieser Zeile als Lücke gekennzeichnet, wenn sie weniger Beziehungen hat, und über der Spalte stehen Anzahl und Anteil der Zeilen, die die Mindestzahl erfüllen.
  - Gegeben eine Spalte, für die das Metamodell keine Mindestzahl festlegt, zum Beispiel „Refines“ zwischen System Requirements oder eine Spalte der Gegenrichtung wie „Refined by“, wenn die Matrix angezeigt wird, dann ist eine leere Zelle nicht als Lücke gekennzeichnet, und über der Spalte steht nur die Anzahl der Zeilen mit einer Beziehung dieser Art, ohne Anteil.
  - Gegeben dieselbe Auswahl, wenn die Matrix über Kommandozeile, API oder MCP abgefragt wird, dann liefert das Tool dieselben Lücken, Anzahlen und Anteile wie die App.
packages:
  - { id: c64ee86d-761a-4180-bfb1-cde819bfc27c, version: n1:fd3ed3f03b3d762f, title: Später }
verification-method: test
topic: Traceability und Ketten
refines:
  - { id: fc803465-d4c0-477c-9907-fd8f4bce5508, version: n1:17ea3a0c515f9f15, title: Traceability-Matrix einer Auswahl zeigen }
  - { id: 6f3fa565-e6b7-4799-99b4-e8d0c814f71b, version: n1:532b8750bf838b6f, title: Anzahl der Beziehungen im Metamodell begrenzen }
derives-from:
  - { id: ccf3998d-7bf6-45de-b74b-f45fb7862a92, version: n1:5fe1dc017ff6e9a9, title: Traceability-Matrix einer Auswahl }
---

Das Tool muss in der Traceability-Matrix Lücken sowie Anzahl und Anteil über einer Spalte nur für Beziehungen ausweisen, für die das Metamodell eine Mindestzahl festlegt.

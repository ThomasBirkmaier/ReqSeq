---
id: fc803465-d4c0-477c-9907-fd8f4bce5508
type: system-requirement
status: approved
title: Traceability-Matrix einer Auswahl zeigen
spec-id: SR-125
rationale: "Eine Traceability-Matrix ist Pflicht und fehlt noch; sie soll neu gedacht werden: mit kaskadierten Filtern zum Beispiel alle SRs eines Pakets wählen, die Matrix aufrufen und so die relative Übersicht bekommen. SR-153 gilt statt AK3; als Lücke gilt nur eine Zelle, die eine Mindestzahl ab 1 aus dem Metamodell unterschreitet (SR-152)."
requirement-type: functional
acceptance-criteria:
  - key: mzzq
    text: Gegeben eine gefilterte Liste, zum Beispiel alle System Requirements des Pakets Editor, wenn die Matrix per Befehl aufgerufen wird, dann zeigt das Tool sie in einem Buffer mit genau einer Zeile je Element der Liste, in der Reihenfolge der Liste.
  - key: wzq6
    text: Gegeben die Elemente der Auswahl haben Beziehungen, wenn die Matrix angezeigt wird, dann hat sie je Beziehungsart und Richtung, die vorkommt, eine Spalte, zum Beispiel „Derives from“ und „Derived by“, und jede Zelle nennt die verbundenen Elemente mit Kurz-ID und Titel.
  - key: ps48
    text: Gegeben eine Spalte der Matrix, wenn die Matrix angezeigt wird, dann kennzeichnet das Tool Lücken und nennt die Angaben über der Spalte so, wie SR-153 es festlegt; eine leere Zelle ist nicht schon deshalb eine Lücke.
  - key: zs8y
    text: Gegeben eine Beziehung zeigt auf eine ältere Fassung ihres Ziels oder auf ein fehlendes Ziel, wenn die Matrix angezeigt wird, dann ist sie in ihrer Zelle als veraltet oder fehlend gekennzeichnet.
  - key: k8sg
    text: Gegeben ein Element in einer Zeile oder Zelle der Matrix, wenn es gewählt wird, dann öffnet das Tool dieses Element.
  - key: w9wp
    text: Gegeben eine Auswahl über Paket, gespeicherten Filter oder eine Liste von IDs, wenn die Matrix über Kommandozeile, API oder MCP abgefragt wird, dann liefert das Tool dieselben Zeilen, Spalten und Zellen wie die App für dieselbe Auswahl.
verification-method: test
packages:
  - { id: 546c26ea-a25f-4ccf-a9c7-ce63607961b3, version: n2:dd8ebe8868421160, title: Traceability }
derives-from:
  - { id: ccf3998d-7bf6-45de-b74b-f45fb7862a92, version: n1:5fe1dc017ff6e9a9, title: Traceability-Matrix einer Auswahl }
  - { id: 6ad3a132-19a2-4a9c-83c7-2470c9c71be1, version: n1:ab23c3ad252d23f2, title: Vollständige Kette vom Parent bis zum Child }
based-on:
  - { id: 6ad4ffaa-f5ad-494e-97eb-a4c77c54dccc, version: n2:c94085aee93eede7, title: Fest eingebaute Bedeutungen des Metamodells }
  - { id: c14efb7d-59da-4ef5-9b85-626310b9a57e, version: n2:2ec3810c4995e7aa, title: Oberfläche als weißes Blatt }
refines:
  - { id: 6adc6bd6-5f7d-44f8-bc1d-be89db7ba23f, version: n2:d4e7ba49fc318ecc, title: Kette aufwärts und abwärts zeigen }
---

Das Tool muss für eine Auswahl von Elementen, zum Beispiel die aktuelle gefilterte Liste, eine Traceability-Matrix zeigen: je Element eine Zeile und je Beziehungsart eine Spalte mit den verbundenen Elementen.

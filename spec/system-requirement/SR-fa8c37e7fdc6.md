---
id: 2a5189ca-9ba4-4099-8f65-fa8c37e7fdc6
type: system-requirement
status: draft
title: Vor einer Baseline Befunde, Nachweisgrad und Änderungen zeigen
spec-id: SR-242
requirement-type: functional
acceptance-criteria:
  - key: cq4q
    text: "Gegeben ein Arbeitsbereich mit Warnungen und ohne Fehler, wenn „Prepare baseline“ aufgerufen wird (CLI, API, MCP: `baseline.prepare`), dann nennt der [Antwortsatz](reqseq:d249a00b-83d2-4c62-b42a-f2c929b5ce27?version=n2:9e00b6ad928fc47b) die Zahl der Fehler und Warnungen der Prüfung des Bestands und den Nachweisgrad der Auswahl (SR-037), und die Ausgabe führt in allen Zugängen die Befunde wie `workspace.check`. Erhielt „Prepare baseline“ eine Auswahl, sagt die Ausgabe, dass die Befunde für den ganzen Arbeitsbereich gelten. Zählt die Auswahl kein gültiges Requirement, sagt der Antwortsatz das statt eines Nachweisgrads."
  - key: fncy
    text: Gegeben eine Auswahl mit 10 gültigen Requirements, davon 6 nachgewiesen, 1 nicht bestanden, 1 veraltet und 2 offen, und 3 Requirements ihrer Sicht ohne bestandenen Test, wenn „Prepare baseline“ aufgerufen wird, dann nennt die Ausgabe in allen Zugängen dieselben Zahlen je Nachweisstatus wie `evidence.degree` (SR-037) und die Zahl ohne bestandenen Test wie `evidence.withoutPassedTest` für diese Sicht (SR-120) mit dem Namen der Sicht, jede als Zahl von Elementen gekennzeichnet (SR-224 AK4).
  - key: hss7
    text: Gegeben eine neueste Baseline nach der Regel von SR-241 AK1, wenn „Prepare baseline“ aufgerufen wird, dann nennt die Ausgabe in allen Zugängen ihren Namen und je Kennzeichnung, die `baseline.get` zählt (SR-051), dieselbe Zahl wie `baseline.get` für sie; ohne Baseline fehlt diese Angabe. Hat sie keine gespeicherte Auswahl, sagt die Ausgabe das, und die Zahlen für „hinzugefügt“ und „entfernt“ fehlen (wie SR-241 AK6). Meldet `baseline.get` für sie einen Befund, führt die Ausgabe ihn bei dieser Angabe, getrennt von den Befunden der Prüfung des Bestands; der Antwortsatz zählt ihn nicht. Eine nicht lesbare Baseline-Datei behandelt der Befehl wie SR-241 AK7.
  - key: rqjf
    text: Gegeben ein Arbeitsbereich mit oder ohne Fehler in der Prüfung des Bestands, wenn „Prepare baseline“ aufgerufen wird, dann nennt die Ausgabe in allen Zugängen „Create baseline“ als nächsten Schritt mit der Auswahl, die „Prepare baseline“ erhielt, ohne Angabe mit der Auswahl des ganzen Arbeitsbereichs; offen ist nur der Name. Daneben nennt sie „Show changes since baseline“, wenn es eine Baseline gibt. Ist die Auswahl eine Baseline oder die Ausgabe eines Befehls, oder nennt sie einen gespeicherten Filter und eine andere Sicht als dessen (SR-050 AK8), fehlt „Create baseline“, weil `baseline.create` diese Auswahlen ablehnt; ein Schritt mit einem Schreibbefehl fehlt, solange das Tool Schreibbefehle ablehnt (SR-226 AK5).
  - key: tsww
    text: Gegeben ein Repository des Arbeitsbereichs fehlt lokal (SR-006 AK2), wenn „Prepare baseline“ aufgerufen wird, dann kennzeichnet das Tool die Ausgabe in allen Zugängen als unvollständig.
packages:
  - { id: 2990bac4-d226-4a31-bb4f-64425f53e055, version: n2:a139a91857d617ad, title: Pakete und Baselines }
verification-method: test
derives-from:
  - { id: 6ad47f0e-0734-4f0d-8d66-06c23933693c, version: n2:3d50558afdf39622, title: Baseline jederzeit festhalten }
  - { id: 6adc6939-8613-4ad1-bcbe-36c978755079, version: n2:0ce9bd37d401ff1f, title: Nachweisgrad einer Auswahl }
refines:
  - { id: 6adc6c49-e383-41ed-ac99-941741a85262, version: n2:94718d1b8a2e216c, title: Nachweisgrad einer Auswahl berechnen }
  - { id: 6adc6bad-b94e-40cf-bd99-7ef5e126d1e6, version: n2:92e9eb83b9ef0a94, title: Bestand per Kommandozeile prüfen }
  - { id: bcf88b88-5b60-4d0c-ba56-236e6d453819, version: n2:464535f27421fffe, title: Den nächsten Schritt nennen }
  - { id: 6adc6c9a-01d7-43bd-9e05-4dd4c430de10, version: n2:e8660c8dd1727df7, title: Baseline anzeigen und vergleichen }
  - { id: ad9557d1-874f-49d4-9973-4ce9f96ef998, version: n2:b989765fd9743f52, title: Requirements ohne bestandenen Test finden }
based-on:
  - { id: 82fd4d1b-0df8-4bb4-91d4-4635cf9ddcc3, version: n2:cedfd19af815d1be, title: "Befehle, die Befehle zusammenstellen" }
  - { id: 6ad47f0f-552c-42de-aa78-27c9c18f3d6b, version: n2:24b59ed5af881fec, title: Anlass einer Baseline liegt außerhalb des Tools }
---

Das Tool muss mit einem Befehl vor dem Festhalten einer [Baseline](reqseq:6ad4f981-8c70-4568-a77a-3da4cd2f98ac?version=n2:ccd1e07d6007cfb6) die [Befunde](reqseq:7bd46b59-0bdf-45de-8e04-2ea489b9a477?version=n2:9d0ccd8bf8416a53) der [Prüfung des Bestands](reqseq:737279a5-6169-40cb-b0ca-e4a8b0898b52?version=n2:effcfcd63f29bfa8), den [Nachweisgrad](reqseq:6ad4f977-5b23-4a33-a450-d377e776a54b?version=n2:36cf695a2c408b4f) einer [Auswahl](reqseq:f0c30c41-91fa-4ac5-8e7c-9054c84ccfc8?version=n2:29932e80a50c6573), die Requirements ohne bestandenen Test und die Änderungen seit der neuesten Baseline zeigen und „Create baseline“ als nächsten Schritt nennen. Der Befehl sperrt keinen Befehl und prüft außer der Art der Auswahl nicht, ob die Baseline angelegt werden kann.

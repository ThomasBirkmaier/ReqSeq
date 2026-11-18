---
id: 7ab81a51-99ac-4993-b73c-a3ab93097bcf
type: system-requirement
status: approved
title: Antwortsatz und Feldangaben im Befehlskatalog
spec-id: SR-224
requirement-type: functional
acceptance-criteria:
  - key: cw40
    text: Gegeben ein Befehl des Befehlskatalogs, wenn er über Kommandozeile, API oder MCP-Server ausgeführt wird, dann enthält seine Ausgabe unter `answer` einen nicht leeren englischen Satz, zeichengleich in allen Zugängen, der nennt, was der Befehl feststellt, zählt oder getan hat, ohne Angaben relativ zum Zeitpunkt des Lesens.
  - key: tjmm
    text: Gegeben die Textausgabe der Kommandozeile, wenn ein Befehl ausgeführt wird, dann ist ihre erste Zeile der Antwortsatz, außer bei Befehlen, deren Textausgabe ein Format ist, etwa Mermaid (SR-151 AK4).
  - key: yxs1
    text: Gegeben der Befehlskatalog, wie ihn die API liefert, wenn er gelesen wird, dann hat jede Angabe einer Ausgabe einen Titel; jede Angabe, deren Schema auf UUID, Pfad, Prüfwert, Commit, Art eines Befunds oder Dauer verweist, ist als technisch gekennzeichnet; jede Angabe mit einem Normalwert nennt ihn.
  - key: h9kx
    text: Gegeben eine Zahl in der Ausgabe eines Befehls, die Elemente zählt, wenn der Befehl ausgeführt wird, dann kennzeichnet der Befehlskatalog sie so, und die Ausgabe nennt die gezählten Elemente.
  - key: v2bx
    text: Gegeben ein Befehl, dessen Antwort Elemente sind, wenn `element.list` mit der Auswahl „Ausgabe dieses Befehls mit dieser Eingabe“ aufgerufen wird, dann liefert es genau diese Elemente, unabhängig von Seiten der Ausgabe.
  - key: rxbd
    text: Gegeben eine Art eines Befunds, wenn die Referenz erzeugt wird, dann führt das Tool für sie einen kurzen Titel, den Referenz und App zeigen.
  - key: zk0v
    text: Gegeben ein Schreibbefehl, dessen Ausgabe mehr als Dateien, Befunde und den Antwortsatz trägt, zum Beispiel ein Plan (SR-071) oder ein Import, wenn der Katalog gelesen wird, dann ist er als „zeigt seine Ausgabe“ gekennzeichnet.
packages:
  - { id: 17252361-b899-4483-ba2b-baf32da3193e, version: n2:0d0abaa40f3ba2a2, title: Zugänge und Anbindung }
verification-method: test
derives-from:
  - { id: d546b567-fda6-410d-a379-78deec04bfe2, version: n2:2a7f8dc7cc5cd0bf, title: Nur Aussagekräftiges sehen }
  - { id: 6adc5c63-608a-4196-b8c0-3037e8876029, version: n2:341a607c926aaf31, title: Alles ohne Oberfläche bedienbar }
based-on:
  - { id: 177556f3-8d4f-434d-8cc8-04def92b4fa4, version: n2:726b411ae394127b, title: Ausgaben gestuft zeigen }
  - { id: 6adc5c64-fe36-4191-85d8-c57756a89310, version: n2:3795ac071493804f, title: API und MCP-Server neben der App }
  - { id: cb583de8-288a-4d8a-82f0-b2be57da2cce, version: n2:973ec19c47b64747, title: Nutzerdokumentation aus den Quellen des Tools }
---

Das Tool muss in der [Ausgabe](reqseq:840d00df-60ed-4742-9b82-9e712f270449?version=n2:f75f336199aced66) jedes Befehls einen [Antwortsatz](reqseq:d249a00b-83d2-4c62-b42a-f2c929b5ce27?version=n2:a8f6683763f8c15a) liefern und im Befehlskatalog jede Angabe der Ausgabe mit einem Titel und den Kennzeichen versehen, die ein Zugang braucht, um sie gestuft zu zeigen.

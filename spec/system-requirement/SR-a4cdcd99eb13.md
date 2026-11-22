---
id: 59fd9cdd-f7bc-471a-b66d-a4cdcd99eb13
type: system-requirement
status: approved
title: Web-Oberfläche mit `reqseq ui` nur lokal starten
spec-id: SR-247
requirement-type: interface
acceptance-criteria:
  - key: d8zr
    text: Gegeben ein Arbeitsbereich, wenn `reqseq ui` für ihn aufgerufen wird, mit `--workspace` oder ohne Angabe für den Arbeitsbereich, den die Kommandozeile wie bei jedem Befehl findet, dann lauscht der Server nur auf Loopback-Adressen (127.0.0.1 und, wo vorhanden, ::1), schreibt seine Adresse mit dem Token auf die Standardausgabe und übergibt sie dem Programm, das das System zum Öffnen einer Adresse nennt; mit `--no-open` übergibt er sie keinem, und lässt sich keines starten, läuft der Server weiter, und die Ausgabe sagt das.
  - key: qc3t
    text: "Gegeben `reqseq ui` ohne `--workspace` an einem Ort, an dem die Kommandozeile keinen Arbeitsbereich findet, wenn es aufgerufen wird, dann startet der Server ohne Arbeitsbereich, anders als ein Befehl (SR-004 AK5): Seine Adresse antwortet, und ein Befehl, der einen Arbeitsbereich braucht, wird abgelehnt. Findet die Kommandozeile oder nennt `--workspace` einen Ordner, der fehlt, sich nicht lesen lässt, keine Arbeitsbereichs-Datei enthält oder eine, die sich nicht lesen lässt, dann startet er nicht und meldet das wie jeder Befehl (SR-004 AK5, SR-226 AK1)."
  - key: wgjz
    text: Gegeben `reqseq ui` ohne `--port`, wenn der Server startet, dann nimmt er einen freien Port; mit `--port <n>` nimmt er den Port n (1 bis 65535), und ist dieser belegt oder die Angabe ungültig, startet er nicht und nennt den Grund.
  - key: f28m
    text: Gegeben der Server läuft, wenn ein anderer Rechner im selben Netz den Port des Servers unter der Adresse dieses Rechners im Netz aufruft, dann kommt keine Verbindung zustande; keine Option und keine Einstellung des Tools lässt den Server auf einer anderen als einer Loopback-Adresse lauschen.
  - key: hs88
    text: Gegeben der Server läuft, wenn eine Anfrage kommt, deren Host nicht eine Loopback-Adresse oder `localhost` mit seinem Port nennt, auch der Abruf einer Seite, dann lehnt er sie ab und führt nichts aus.
  - key: dk5t
    text: Gegeben der Server läuft, wenn eine Anfrage kommt, die nicht mit GET oder HEAD eine Datei der Seiten abruft und nicht das Token, das der Server bei jedem Start neu erzeugt, in einem Kopf der Anfrage trägt, dann lehnt er sie ab und führt nichts aus; ein Cookie zählt nicht. Dateien der Seiten sind die Dateien der Web-Oberfläche aus der Auslieferung; sie enthalten nichts aus einem Arbeitsbereich.
  - key: hnqy
    text: Gegeben der Server läuft, wenn eine Anfrage einen Origin-Kopf trägt, der nicht `http://` mit dem Host derselben Anfrage ist, dann lehnt er sie ab und führt nichts aus.
  - key: zp1s
    text: Gegeben der Server läuft, wenn eine Seite abgerufen wird, dann enthält sie das Token nur, wenn die Adresse des Abrufs das Token trägt.
  - key: rq0f
    text: Gegeben der Server läuft, wenn er eine Anfrage beantwortet, dann gibt keine Antwort einer anderen Herkunft den Zugriff frei, jede Antwort mit einer Seite untersagt dem Browser, sie in eine Seite anderer Herkunft einzubetten, und erlaubt ihm nur Quellen des eigenen Servers und Bilder, die die Seite selbst aus einer Antwort des eigenen Servers bildet (`blob:`).
  - key: jv9g
    text: Gegeben der Server läuft, wenn er mit Ctrl-C oder, wo das System es kennt, mit SIGTERM beendet wird oder sein Terminal geschlossen wird, dann antwortet danach seine Adresse nicht mehr.
  - key: c53z
    text: Gegeben die Web-Oberfläche liest oder ändert ein Element, wenn danach der letzte Zugriff eines Agents abgefragt wird (`workspace.activity`, SR-117), dann nennt die Ausgabe denselben Zugriff wie davor, ohne früheren Zugriff keinen.
  - key: dfqv
    text: Gegeben die Web-Oberfläche öffnet einen Arbeitsbereich, beim Start oder danach, wenn danach die zuletzt geöffneten Arbeitsbereiche abgefragt werden (`workspace.recent`), dann steht er dort zuerst (SR-250).
packages:
  - { id: d3daa1a2-adb1-4941-8c51-1fc9cb0bfb1d, version: n2:3cd7fefae7f4386e, title: Betrieb und Sicherheit }
verification-method: test
derives-from:
  - { id: 6adc6939-93a9-4871-b675-ea0d9f64db7a, version: n2:6401e4834f106721, title: Zugänge und Web-Oberfläche nur lokal }
  - { id: 4e9f9a9e-3a7e-4d6b-867c-37db7e1e2253, version: n2:7c57d49e4aa70297, title: Nach dem Herunterladen ohne Vorwissen beginnen }
based-on:
  - { id: 3fcc9c21-164a-4fa1-9d69-2ff8e055c094, version: n2:ab1a775d09c8134c, title: Web-Oberfläche statt Desktop-App }
  - { id: 6adc5c64-fe36-4191-85d8-c57756a89310, version: n2:b68c1780920b121b, title: API und MCP-Server neben Kommandozeile und Web-Oberfläche }
---

Die [Kommandozeile](reqseq:f5c404b5-7886-4c69-af41-5ecc43b71f52?version=n2:9a4f0d8d27de42ba) muss mit `reqseq ui` die [Web-Oberfläche](reqseq:c89b295d-c3d5-49af-b6fd-c7444cdbb5ec?version=n2:8dfd92227dd91b55) als Server starten, der nur von Programmen auf demselben Rechner erreichbar ist, Befehle nur auf Anfragen mit seinem Token ausführt und den [Arbeitsbereich](reqseq:6adc68be-cdfe-4197-a3a9-4c86ffa232a7?version=n2:1fbe0ef1dbe8ddc1), den er öffnet, als zuletzt geöffneten vermerkt.

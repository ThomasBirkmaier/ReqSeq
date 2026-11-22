---
id: 6e69d4d3-7e6e-45e6-909c-d2a436babc1f
type: system-requirement
status: approved
title: Arbeitsbereich als HTML-Export schreiben
spec-id: SR-231
requirement-type: functional
acceptance-criteria:
  - key: vm0n
    text: Gegeben ein Arbeitsbereich, wenn der HTML-Export über Kommandozeile, API oder MCP-Server in einen Zielordner geschrieben wird, dann liegen dort eine Startseite `index.html` und je Element ohne ungültigen Status ([D-044](reqseq:6adc6922-e6d1-4d0a-9617-83d65c71cf7f?version=n2:ce205554ccf5d3d5)) eine Seite; Elemente mit ungültigem Status haben keine eigene Seite und stehen in keiner Liste eines Typs.
  - key: f39g
    text: Gegeben der exportierte Ordner, wenn seine Seiten per `file://` oder unter einem Unterpfad eines Webservers geöffnet werden, dann führt jeder Link zwischen den Seiten auf eine Datei des Ordners, und keine Seite fragt eine Adresse außerhalb des Ordners an ([SR-078](reqseq:6adc6d93-4684-4379-941d-21bd583ceb09?version=n2:bbef4dd74b316b9b)).
  - key: z3tv
    text: Gegeben der Link auf die Seite eines Elements, wenn derselbe Arbeitsbereich später erneut an denselben Ort exportiert wird und das Element noch gültig ist, dann öffnet der Link weiter genau dieses Element, auch wenn sich seine Kennung, sein Titel oder seine Kurz-ID geändert haben.
  - key: q64j
    text: Gegeben die Seiten, wenn sie angezeigt werden, dann binden sie das Stylesheet der mitgelieferten Dokumentation ([SR-141](reqseq:1c987832-234f-4c88-a8bf-dd4b4f6c54d8?version=n2:b3de6a6b9332ffb0)) ein, haben einen Umschalter für hell und dunkel und zeigen unter der Breite, bei der die Dokumentation umbricht, die Navigation als Menü.
  - key: ycws
    text: "Gegeben ein Text oder eine Markdown-Property mit Formeln, Mermaid-Diagrammen, Tabellen, Aufgabenlisten, Hinweisboxen ([D-074](reqseq:909e3182-bbf5-4705-b55e-4e99001a8b98?version=n2:cafceafb26d02e0a)) oder einem Bild aus dem Repository des Elements, wenn exportiert wird, dann erscheinen sie formatiert: Formeln sind beim Export gesetzt, Mermaid zeichnet eine einmal im Ordner liegende Bibliothek, und das Bild liegt als Kopie im Ordner. Ein fehlerhaftes Diagramm oder eine fehlerhafte Formel zeigt den Fehler und den Quelltext."
  - key: wkbf
    text: "Gegeben ein Verweis im Text oder in einer Markdown-Property, wenn exportiert wird, dann ist sein Linktext ein Link auf die Seite des Ziels; hat das Ziel einen ungültigen Status, steht der Linktext ohne Link, außer es gibt die Seite aus AK8, und fehlt das Ziel oder nennt der Verweis ein Repository, das die Arbeitsbereichs-Datei nicht nennt, steht der Linktext ohne Link. Liegt das Ziel in einem Repository, das lokal fehlt, steht der Linktext ohne Link, und dahinter stehen die Angaben aus [SR-006](reqseq:6adc6ac9-5d28-45d7-9c2c-18ed8887e1e1?version=n2:db49f247048c3643) AK1: „UNKNOWN-“ mit dem Ende der UUID des Ziels, der Name des Repositorys und der Vermerk, dass das Ziel nicht zugänglich ist."
  - key: c1hj
    text: Gegeben der exportierte Ordner ohne Netz, wenn im Suchfeld (Ctrl+K, unter macOS Cmd+K) Wörter getippt werden, dann zeigt es die Elemente, in deren Kennung, Kurz-ID oder Titel jedes dieser Wörter vorkommt, ohne Rücksicht auf Groß- und Kleinschreibung, auch als Wortteil, je mit Link auf die Seite.
  - key: q4mj
    text: Gegeben ein Element, das in einem früheren Export eine Seite hatte und jetzt einen ungültigen Status hat, wenn exportiert wird, dann liegt an seiner Stelle eine kurze Seite mit Kennung, Titel und Status und, wo es einen gibt, jedem Nachfolger als Link ([SR-072](reqseq:6adc6d8d-cbb4-448b-9e57-5a64496da4d2?version=n2:e5cf598fa906aaed) AK3); sie steht in keiner Liste und nicht in der Suche.
  - key: hmbc
    text: Gegeben eine Seite des Exports, wenn sie angezeigt wird, dann nennt ihr Fuß den Commit des Haupt-Repositorys (mit `-dirty` wie in [SR-062](reqseq:6adc6d29-4864-49d6-b572-71dc22568f15?version=n2:c4ca26206483b9f4) AK1, ohne Git „no commit“) und das Datum des Exports, und die Seite bittet Suchmaschinen mit `noindex`, sie nicht aufzunehmen.
packages:
  - { id: 17252361-b899-4483-ba2b-baf32da3193e, version: n2:233cd483722ffe08, title: Zugänge und Anbindung }
verification-method: test
based-on:
  - { id: b413f77d-743e-4abe-8b79-bceb24c4b7ca, version: n2:ea62ff545cc1d56b, title: HTML-Export erzeugt das Tool selbst }
  - { id: 909e3182-bbf5-4705-b55e-4e99001a8b98, version: n2:cafceafb26d02e0a, title: Markdown nach CommonMark mit GitHub-Erweiterungen }
  - { id: 6adc691d-c3f6-4d51-a053-72a341032941, version: n2:c433f023b7b96248, title: Das Tool liest Git nur }
derives-from:
  - { id: 39e94ec5-33f0-4745-aff7-37c82bc6cd0e, version: n2:aeeed6f1f4b3a5f4, title: Elemente ohne das Tool im Browser lesen }
  - { id: 6adc50a4-1b5c-4e15-b1ce-ab8ea74f70b0, version: n2:d42b2987bad28fad, title: Lesbar ohne das Tool }
---

Das [Tool](reqseq:6ad4f973-fdb9-461f-8dc4-b73619ba1dac?version=n2:2427cdd2079ee312) muss einen [Arbeitsbereich](reqseq:6adc68be-cdfe-4197-a3a9-4c86ffa232a7?version=n2:1fbe0ef1dbe8ddc1) als [HTML-Export](reqseq:7f240c30-80c6-476d-bc9c-0215a0fef867?version=n2:7e08d73bbf3cc65a) in einen Ordner schreiben, dessen Seiten ohne Netz und unter jedem Unterpfad eines Webservers lesbar sind und deren Links auf ein Element dauerhaft gelten.

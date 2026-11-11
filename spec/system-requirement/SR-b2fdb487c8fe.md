---
id: 6adc6ac6-de13-4a53-9e75-b2fdb487c8fe
type: system-requirement
status: approved
title: "Arbeitsbereich aus Datei laden"
spec-id: "SR-004"
requirement-type: functional
acceptance-criteria:
  - key: rws1
    text: "Gegeben eine Arbeitsbereichs-Datei nennt drei Repositories, die alle lokal vorhanden sind (an dem Pfad, den die Datei für ein Repository nennt, sonst im Ordner `../<Name>` neben dem Haupt-Repository), wenn der Arbeitsbereich geöffnet wird, dann zeigt das Tool die Elemente aller drei Repositories gemeinsam."
  - key: w3xm
    text: "Gegeben ein Arbeitsbereich mit nur einem Repository, wenn er geöffnet wird, dann liefern Status, Suche, Kette und Prüfung Ergebnisse derselben Form wie bei mehreren Repositories, und das eine Repository gilt als Haupt-Repository, auch ohne Kennzeichen."
  - key: kdfm
    text: "Gegeben ein genanntes Repository fehlt lokal, wenn der Arbeitsbereich geöffnet wird, dann zeigt das Tool es als nicht vorhanden, die Prüfung des Bestands meldet es als Info, und das Tool arbeitet mit den übrigen normal; der Import einer Lieferung lehnt dann aber ab (SR-053 AK3); fehlt das Repository des Metamodells, gilt SR-011 AK4."
  - key: hpgp
    text: "Gegeben eine Person nennt in der Datei `.reqseq/local.yaml` im Haupt-Repository, die nur für diesen Rechner gilt, für ein Repository einen anderen Ort auf ihrem Rechner, relativ oder absolut, wenn der Arbeitsbereich geöffnet wird, dann liest das Tool das Repository von dort; ist die Datei fehlerhaft, meldet das Tool eine Warnung und nimmt die Orte aus der Arbeitsbereichs-Datei."
  - key: gm6w
    text: "Gegeben ein Ordner ohne Arbeitsbereichs-Datei oder mit einer, die sich nicht lesen lässt, wenn er als Arbeitsbereich geöffnet wird (CLI, API, MCP mit diesem Ordner als Arbeitsbereich), dann meldet das Tool das mit Datei und Grund und liest keinen Bestand."
  - key: mkv1
    text: "Gegeben ein Repository, in dessen Ordner und darüber es kein Git-Repository gibt, wenn der Arbeitsbereich geöffnet wird, dann liest und schreibt das Tool seine Elemente wie sonst, nennt für ihre Fassungen kein Datum, und ein Hinweis auf eine veraltete Beziehung dorthin sagt, dass Git das Repository nicht lesen kann."
  - key: w2fk
    text: "Gegeben die Arbeitsbereichs-Datei nennt für ein Repository einen Pfad, der absolut ist, aus dem Ordner hinausführt, in dem das Haupt-Repository liegt, oder einem Link aus dem Repository hinaus folgt, das er betritt (zum Beispiel `../../netz/host/r` oder `//server/freigabe/r`), wenn der Arbeitsbereich geöffnet wird, dann folgt das Tool ihm nicht, meldet eine Warnung und sucht das Repository in `../<Name>`, außer `.reqseq/local.yaml` nennt einen Ort dafür (AK4)."
  - key: m7c2
    text: "Gegeben die Datei `.reqseq/local.yaml` ist im Haupt-Repository in Git eingecheckt oder zum Commit vorgemerkt, wenn der Arbeitsbereich geöffnet wird, dann verwendet das Tool sie nicht, meldet eine Warnung und nimmt die Orte aus der Arbeitsbereichs-Datei. Gibt es für das Haupt-Repository kein Git-Repository (AK6) oder ist kein Git-Programm installiert, gilt die Datei. Lehnt Git ein vorhandenes Git-Repository ab, scheitert es oder antwortet es nicht rechtzeitig, oder ist der Ordner `.reqseq` selbst ein Git-Repository oder ein Link, verwendet das Tool die Datei nicht und meldet eine Warnung mit dem Grund."
verification-method: test
packages:
  - { id: 3aaac15c-a3ae-44d6-a640-c0fa48ccd25e, version: n2:3431ccb8330c70d3, title: Ablage und Repositories }
derives-from:
  - { id: 6ad4f636-3b68-4ace-a3be-12ebdcba9b2a, version: n1:fb6a0af7414140ba, title: Ein oder viele Repositories }
based-on:
  - { id: 6adc5317-4e70-4297-942b-10bf39e10d85, version: n2:5fa2f004bf0408a2, title: Das Metamodell gehört zum Stand }
  - { id: 6adc6921-ddaf-4756-954c-0072d0fc0739, version: n2:1ae919bd1dbee2b0, title: Arbeitsbereich als Datei }
rationale: "Entscheidung des Produktverantwortlichen, 2026-11-09: AK4 nimmt die lokale Angabe des Orts eines Repositorys auf, die das Tool schon bietet, statt eines eigenen SR. Pfade aus der Arbeitsbereichs-Datei (AK7): Entscheidung des Produktverantwortlichen, 2026-11-07: Ein Pfad, der hinausführt, etwa auf eine Netzfreigabe, kommt nur aus der lokalen Datei, damit ein Klon das Tool keinen anderen Rechner ansprechen lässt; für absolute Pfade gilt dasselbe (Entscheidung des Produktverantwortlichen, 2026-11-11). Git verweigert oder scheitert (AK8): Entscheidung des Produktverantwortlichen, 2026-11-11: Die Datei gilt nur ohne Git-Repository oder ohne Git-Programm, wie das Tool es umsetzt, damit ein Repository die Prüfung nicht umgehen kann, indem es Git scheitern lässt (#1475)."
---

Das Tool muss die Repositories eines Arbeitsbereichs aus der Arbeitsbereichs-Datei im Haupt-Repository lesen und alle lokal vorhandenen gemeinsam öffnen.

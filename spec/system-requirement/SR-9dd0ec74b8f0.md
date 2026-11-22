---
id: 1d177393-9693-45b9-bba4-9dd0ec74b8f0
type: system-requirement
status: approved
title: Beim ReqIF-Export nur eine ReqIF-Datei ersetzen
spec-id: SR-207
rationale: "Die Angriffsflächen ohne Requirement aus der Liste zu #1429 werden als Draft aufgenommen, mit den empfohlenen Antworten auf die offenen Fragen. Der Export gilt über alle Zugänge, wie die Regel für Dateien der Daten je Stand (SR-062). Die offenen Punkte nach dem Review werden wie empfohlen geklärt: was eine ReqIF-Datei ist, welches Lesen gilt und dass die Regel auch für den Ordner der Bilder gilt. Fehlende Ordner (AK4 bis AK7): wie beim HTML-Export (SR-235 AK7 bis AK10), damit der erste Export in einen neuen Ordner gelingt (#2339)."
requirement-type: functional
acceptance-criteria:
  - key: gbbc
    text: Gegeben am Zielort liegt eine Datei, die keine ReqIF-Datei ist, zum Beispiel ein JUnit-Ergebnis, wenn über Kommandozeile, API oder MCP-Server dorthin exportiert wird, dann lehnt das Tool ab, nennt den Grund und ändert die Datei nicht.
  - key: kyqf
    text: Gegeben am Zielort liegt eine ReqIF-Datei, die unverändert ist, seit der Export sie vor dem Schreiben gelesen hat, wenn dorthin exportiert wird, dann ersetzt das Tool sie.
  - key: h192
    text: Gegeben im Ordner für die Bilder neben der Zieldatei liegt eine Datei, die kein Bild ist, wenn exportiert wird, dann lehnt das Tool ab und ändert sie nicht.
  - key: b0rs
    text: Gegeben eine Zieldatei in einem Repository des Arbeitsbereichs, das auf diesem Rechner vorhanden ist, und zwischen einem vorhandenen Ordner dieses Repositorys und der Zieldatei fehlen ein oder mehrere Ordner, wenn über Kommandozeile, API oder MCP-Server dorthin exportiert wird, dann legt das Tool die fehlenden Ordner an und schreibt den Export, außer AK5 lehnt ab.
  - key: d980
    text: Gegeben eine Zieldatei wie in AK4, und der Weg vom Ordner des Repositorys zu ihr führt über einen symbolischen Link, durch `.git`, `node_modules` oder ein eingebettetes Git-Repository, in den Ordner eines Repositorys des Arbeitsbereichs, das auf diesem Rechner fehlt, oder über eine Datei, oder ein Name auf diesem Weg ist anders geschrieben als auf der Platte (wie in [SR-251](reqseq:2f5a5c1f-557a-433a-912f-36c832aa54c4?version=n2:8bcc3a1a4ba0f473) AK2), endet mit Punkt oder Leerzeichen, enthält eines der Zeichen `<>:"|?*\` oder ein Steuerzeichen oder ist der Name eines Windows-Geräts wie `nul`, wenn dorthin exportiert wird, dann lehnt das Tool ab, nennt den Grund und legt keinen Ordner an.
  - key: p2qv
    text: Gegeben eine Zieldatei außerhalb der Repositories des Arbeitsbereichs, deren Ordner fehlt, wenn über die Kommandozeile dorthin exportiert wird ([SR-142](reqseq:ea47f955-1173-4652-8ae1-7ef47f549bf7?version=n2:ba50cbdc97c1617a) AK3), dann lehnt das Tool ab, nennt den Grund und legt keinen Ordner an.
  - key: c90h
    text: Gegeben das Tool hat für einen Export Ordner über der Zieldatei angelegt (AK4), wenn der Export danach mit einem Fehler abbricht, dann entfernt es jeden dieser Ordner wieder, der leer ist.
packages:
  - { id: 0d3dc867-b3e5-401f-a6db-d95463166616, version: n2:0a96ee534d188a3a, title: Austausch per ReqIF }
verification-method: test
refines:
  - { id: 6adc6d1e-80be-4ec1-acac-006873bc163c, version: n2:dcf8ae22ca60ad54, title: Paket als ReqIF exportieren }
derives-from:
  - { id: 6adc503f-c806-42c1-9750-179bcea5d1cd, version: n2:527652e809efa5b8, title: Austausch per ReqIF }
  - { id: aeee3f81-d8c1-41b5-8f9a-0a1094845828, version: n2:039cc12cd910e3d5, title: Fremde Inhalte gefahrlos öffnen }
based-on:
  - { id: 6adc691d-c3f6-4d51-a053-72a341032941, version: n2:c433f023b7b96248, title: Das Tool liest Git nur }
---

Das Tool darf beim ReqIF-Export eine vorhandene Datei am Zielort nur ersetzen, wenn sie eine ReqIF-Datei ist, also eine XML-Datei mit dem Wurzelelement `REQ-IF`, und über der Zieldatei fehlende Ordner nur in einem Repository des Arbeitsbereichs anlegen.

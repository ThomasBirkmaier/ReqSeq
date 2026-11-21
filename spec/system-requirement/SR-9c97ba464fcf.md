---
id: 87a074c7-fd20-4eac-a3f2-9c97ba464fcf
type: system-requirement
status: draft
title: Folgende Kennung beim Anlegen vergeben
spec-id: SR-245
rationale: "Wer ein Element anlegt, soll die nächste Nummer im Schema des Projekts nicht nachschlagen müssen. Die ID bleibt die UUID (D-017). Das Tool sieht dabei nur die Elemente der lokalen Kopie: Kennungen in anderen Kopien, in Branches oder aus einem gleichzeitigen Aufruf in einem anderen Prozess sieht es nicht; im selben Prozess gilt SR-166 AK1. Eine so entstandene Doppelung meldet die Prüfung des Bestands als Warnung (SR-088 AK4). Lücken füllt das Tool nicht, und es rät keine Schreibweise: Die erste Kennung eines Kennungspräfixes mit einer gewünschten Stellenzahl, etwa SR-001, setzt man von Hand; mit einem angegebenen Kennungspräfix beginnt das Tool bei 1. Eine Kennung, die nicht auf eine Ziffer endet, etwa wegen Leerraum am Ende, zählt nicht. Ein Kennungspräfix mit `/`, `[` oder `]` ergibt eine Kennung, die sich aus einem Testnamen nicht zurücklesen lässt (SR-205 AK1). Die Kriterien nennen Kommandozeile, API und MCP-Server; die App bietet die Angabe noch nicht an (Abweichung von SR-080 AK1), ihre Kriterien kommen mit einer eigenen Änderung der Spec dazu."
requirement-type: functional
acceptance-criteria:
  - key: tskf
    text: "Gegeben Elemente eines Typs mit den Kennungen SR-1 bis SR-243, wenn ein Element dieses Typs mit der Angabe angelegt wird, die folgende Kennung zu vergeben (CLI, API, MCP: `element.create`), dann hat es die Kennung SR-244: die höchste Zahl unter den Kennungen mit demselben Kennungspräfix plus eins, ohne Obergrenze (auf SR-99999999999999999999 folgt SR-100000000000000000000). Kennungspräfixe werden ohne Groß- und Kleinschreibung verglichen wie in SR-088 AK4, Ziffernfolgen als Zahlen wie in SR-075 AK1. Es zählen die Kennungen aller Elemente genau dieses Typs im Arbeitsbereich, auch abgelöster und solcher mit ungültigem Status; eine Kennung ohne Ziffernfolge am Ende oder nur aus Ziffern zählt nicht, ebenso keine in einer Datei, die sich nicht als Element lesen lässt."
  - key: w5bw
    text: "Gegeben die Kennung mit der höchsten Zahl ist VAR-003 oder SR-999, wenn die folgende Kennung vergeben wird, dann ist sie VAR-004 oder SR-1000: so viele Stellen wie die Ziffernfolge dieser Kennung, mit führenden Nullen aufgefüllt, mindestens so viele wie die neue Zahl braucht, und ihr Kennungspräfix in ihrer Schreibweise. Tragen mehrere Kennungen die höchste Zahl, gilt die mit den meisten Stellen, bei gleicher Stellenzahl die in der Datei, deren Angabe aus Repository-Name und Pfad (wie `element.get` sie nennt) zeichenweise verglichen zuerst steht."
  - key: zh91
    text: Gegeben die Kennungen des Typs, die nach AK1 zählen, tragen mehr als ein Kennungspräfix, wenn die folgende Kennung ohne Angabe eines Kennungspräfixes vergeben werden soll, dann lehnt das Tool das ab, schreibt nichts und nennt die Zahl der Kennungspräfixe und die Kennungspräfixe selbst, bei mehr als 20 die 20 mit den meisten Kennungen, bei gleicher Zahl aufsteigend ohne Rücksicht auf Groß- und Kleinschreibung, jedes in der Schreibweise seiner Kennung mit der höchsten Zahl (AK2).
  - key: kscz
    text: Gegeben ein angegebenes Kennungspräfix, wenn die folgende Kennung vergeben wird, dann ist sie die folgende zu diesem Kennungspräfix nach AK1 und AK2; trägt keine Kennung des Typs dieses Kennungspräfix, ist sie das angegebene Kennungspräfix, wie geschrieben, gefolgt von 1.
  - key: kvz3
    text: Gegeben ein angegebenes Kennungspräfix ist leer, länger als 100 Zeichen, endet auf eine Ziffer von 0 bis 9, enthält ein Steuerzeichen oder einen Zeilenumbruch oder beginnt oder endet mit Leerraum, ohne dass eine Kennung des Typs dieses Kennungspräfix trägt, wenn die folgende Kennung vergeben werden soll, dann lehnt das Tool das ab, schreibt nichts und nennt den Grund.
  - key: qp1p
    text: Gegeben der Typ hat keine Property mit der Bedeutung Kennung, wenn die folgende Kennung vergeben werden soll, dann lehnt das Tool das ab, schreibt nichts und nennt den Grund.
  - key: pf8m
    text: Gegeben die Kennung ist zusätzlich als Property angegeben, wenn die folgende Kennung vergeben werden soll, dann lehnt das Tool das ab, schreibt nichts und nennt den Grund.
  - key: fk37
    text: Gegeben kein Element des Typs hat eine Kennung, die nach AK1 zählt, und kein Kennungspräfix ist angegeben, wenn die folgende Kennung vergeben werden soll, dann lehnt das Tool das ab, schreibt nichts und nennt die Angabe eines Kennungspräfixes als Abhilfe.
  - key: tc56
    text: Gegeben ein Repository des Arbeitsbereichs außer dem des Metamodells fehlt lokal (SR-006 AK2), wenn die folgende Kennung vergeben wird, dann vergibt das Tool sie aus den vorhandenen Elementen und kennzeichnet die Ausgabe als unvollständig.
  - key: cyr4
    text: Gegeben ein Kennungspräfix ist angegeben, ohne die Angabe, die folgende Kennung zu vergeben, wenn ein Element angelegt wird, dann lehnt das Tool das ab, schreibt nichts und nennt den Grund.
packages:
  - { id: e8a95bf4-c96c-4c8a-9fa0-7e9bc0dbd5bd, version: n2:8144976caed4daca, title: Element bearbeiten }
verification-method: test
derives-from:
  - { id: 09ea0170-ab5d-4115-9a55-7ea1f0b05e5f, version: n2:a28b5ef4c4351daa, title: Nächste Kennung ohne Nachschlagen }
refines:
  - { id: 6adc6d84-e8f4-48bc-adcc-71a839d13a4d, version: n2:368153fb5dd17acc, title: Element mit Pflicht-Properties zuerst anlegen }
based-on:
  - { id: 6adc4fbb-fe6a-4dfa-b9b6-8ccf0e589cf2, version: n2:806684a4b1a7fb22, title: "Automatisch erzeugte, zufällige IDs" }
---

Das [Tool](reqseq:6ad4f973-fdb9-461f-8dc4-b73619ba1dac?version=n2:2427cdd2079ee312) muss beim Anlegen eines [Elements](reqseq:6ad4f967-cd5c-4742-9496-c32698d7e56d?version=n2:5b3b2eb814e1b440) auf Wunsch die [Kennung](reqseq:78218f4c-28a5-448f-a372-ace52b065061?version=n2:6f7744f2cf9ff6e3) vergeben, die auf die höchste vorhandene Kennung seines [Typs](reqseq:6ad4f971-d4ad-432a-8130-eaaa2255dc93?version=n2:94d028822726b266) mit demselben Kennungspräfix folgt. Kennungspräfix ist der Teil einer Kennung vor der Ziffernfolge aus 0 bis 9 an ihrem Ende, nicht das Präfix des Typs (SR-084).

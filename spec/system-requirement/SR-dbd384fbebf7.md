---
id: 5d5b3dfc-e766-4efa-81ae-dbd384fbebf7
type: system-requirement
status: approved
title: Nachweisstatus im Graphen zeigen
spec-id: SR-136
rationale: "Der Verifikationsstatus muss später unbedingt auch in den Graphen. Öffnet man zum Beispiel einen Need mit 10 abgeleiteten Requirements, wäre es gut, im Knoten des Needs den gesammelten Status als kleine Prozentanzeige zu sehen. Vorbild ist ein kleiner Fortschrittskreis neben einer Beschriftung. Der Nachweisstatus ersetzt die Markierung „ohne Nachweis“ aus SR-111 AK4; auch jedes Requirement zeigt einen Fortschrittskreis, mit dem Anteil seiner nachgewiesenen Akzeptanzkriterien; der Kreis eines Needs zählt die direkt von ihm abgeleiteten Requirements, unabhängig von dem, was der Graph gerade zeigt, damit die Zahl nicht mit der Ansicht springt; wo es nichts zu zählen gibt, bei einem indirekt nachgewiesenen Requirement, einem Requirement ohne Akzeptanzkriterien oder einem Need ohne gültige abgeleitete Requirements, zeigt der Knoten keinen Kreis. Nach #1111 ([Kommentar](https://github.com/ThomasBirkmaier/ReqSeq/issues/1111#issuecomment-6718261094)): Ein Requirement, das nur in einer Variante gilt, hat im Graphen ohne gewählte Variante keinen Nachweisstatus und zählt in keinem Nachweisgrad; in der Sicht einer Variante zählt es wie üblich (AK3, AK7)."
requirement-type: functional
acceptance-criteria:
  - key: h2xg
    text: "Gegeben ein Requirement als Knoten im Graphen (SR-111), wenn er angezeigt wird, dann trägt er seinen Nachweisstatus: offen, nachgewiesen, nicht bestanden oder veraltet (SR-031), indirekt nachgewiesen als solcher gekennzeichnet (SR-034)."
  - key: kvvw
    text: Gegeben ein Requirement mit Akzeptanzkriterien als Knoten im Graphen, wenn er angezeigt wird, dann zeigt er innerhalb seines Blocks einen Fortschrittskreis mit der Zahl seiner Akzeptanzkriterien, deren Nachweisstatus nachgewiesen ist (SR-031), von allen, zum Beispiel „2 von 3“.
  - key: thr6
    text: "Gegeben ein Need als Knoten im Graphen mit 10 direkt von ihm abgeleiteten gültigen Requirements, die in der Sicht des Graphen einen Nachweisstatus haben (ohne Sicht: im Kern), davon 6 nachgewiesen, 1 nicht bestanden, 1 veraltet und 2 offen, wenn er angezeigt wird, dann zeigt er innerhalb seines Blocks deren Nachweisgrad (SR-037) als Fortschrittskreis mit der Prozentzahl, hier 60 %, und zwar gleich bei jeder Tiefe und jeder Auswahl von Beziehungsarten des Graphen (SR-111)."
  - key: w6gh
    text: Gegeben ein indirekt nachgewiesenes Requirement (SR-034) als Knoten im Graphen, wenn er angezeigt wird, dann zeigt er seinen Nachweisstatus und keinen Fortschrittskreis.
  - key: qgyd
    text: Gegeben ein Requirement ohne Akzeptanzkriterien als Knoten im Graphen, wenn er angezeigt wird, dann zeigt er seinen Nachweisstatus und keinen Fortschrittskreis.
  - key: t58p
    text: Gegeben ein Need, von dem kein gültiges Requirement abgeleitet ist, wenn er im Graphen angezeigt wird, dann zeigt er keinen Fortschrittskreis.
  - key: dfzw
    text: Gegeben ein Graph ohne gewählte Variante, wenn er angezeigt wird, dann zeigt jeder Knoten eines Requirements den Nachweisstatus im Kern; ein Requirement, das nicht in der Sicht des Kerns steht, zeigt keinen Nachweisstatus und keinen Fortschrittskreis. Mit gewählter Variante ist es der Nachweisstatus in ihrer Sicht.
verification-method: test
refines:
  - { id: 50824eaa-f59b-4bfc-b99e-bbb156836ef0, version: n2:6ca4a9ec538f4232, title: Graph des aktuellen Elements zeigen }
derives-from:
  - { id: 1015b447-7845-49a6-984d-f1b4e809800f, version: n1:8971994df12cd206, title: Graph des aktuellen Elements }
  - { id: 6ad50227-3476-4a97-8ec4-5d4f0543bb22, version: n2:b080b82a30d57303, title: Status von Nachweis und Validierung }
based-on:
  - { id: a1bb397a-362f-4c60-86e4-0e030a92c8d2, version: n2:0a8ccbe90869ca1c, title: Graph vom aktuellen Element aus }
  - { id: c14efb7d-59da-4ef5-9b85-626310b9a57e, version: n2:2ec3810c4995e7aa, title: Oberfläche als weißes Blatt }
packages:
  - { id: ed14d465-fd3f-4188-992b-3ff7af8595af, version: n2:42294a7722f821a6, title: Nachweis und Abdeckung }
---

Das Tool muss im Graphen des aktuellen Elements bei jedem Requirement seinen Nachweisstatus und den Anteil seiner nachgewiesenen Akzeptanzkriterien und bei jedem Need den Nachweisgrad der direkt von ihm abgeleiteten Requirements zeigen.

---
id: 5d5b3dfc-e766-4efa-81ae-dbd384fbebf7
type: system-requirement
status: approved
title: Nachweisstatus im Graphen zeigen
spec-id: SR-136
rationale: "Entscheidung des Produktverantwortlichen, 2026-10-28: Der Verifikationsstatus muss später unbedingt auch in den Graphen. Öffnet man zum Beispiel einen Need mit 10 abgeleiteten Requirements, wäre es gut, im Knoten des Needs den gesammelten Status als kleine Prozentanzeige zu sehen. Vorbild ist ein kleiner Fortschrittskreis neben einer Beschriftung. Bisher markiert der Graph einen Knoten nur, wenn er ohne Nachweis ist (SR-111 AK4); bis Später eingeplant ist, gilt SR-111 wie umgesetzt. Geparkt im Paket Später nach der Entscheidung des Produktverantwortlichen vom 2026-10-27, neue Ideen weiter aufzunehmen und zu parken."
requirement-type: functional
acceptance-criteria:
  - "Gegeben ein Requirement als Knoten im Graphen (SR-111), wenn er angezeigt wird, dann trägt er seinen Nachweisstatus: offen, nachgewiesen, nicht bestanden oder veraltet (SR-031), indirekt nachgewiesen als solcher gekennzeichnet (SR-034)."
  - Gegeben ein Need als Knoten im Graphen, zum Beispiel mit 10 abgeleiteten Requirements, wenn er angezeigt wird, dann zeigt er innerhalb seines Blocks den Nachweisgrad dieser Requirements (SR-037) als kleine Prozentanzeige, einen Fortschrittskreis mit der Prozentzahl.
verification-method: test
topic: Nachweis und Abdeckung
refines:
  - { id: 50824eaa-f59b-4bfc-b99e-bbb156836ef0, version: n1:80895fb29bfa5796, title: Graph des aktuellen Elements zeigen }
derives-from:
  - { id: 1015b447-7845-49a6-984d-f1b4e809800f, version: n1:8971994df12cd206, title: Graph des aktuellen Elements }
  - { id: 6ad50227-3476-4a97-8ec4-5d4f0543bb22, version: n1:1ba8294de9948498, title: Status von Nachweis und Validierung }
based-on:
  - { id: a1bb397a-362f-4c60-86e4-0e030a92c8d2, version: n1:1b0bf8d6f6d7dc0a, title: Graph vom aktuellen Element aus }
  - { id: c14efb7d-59da-4ef5-9b85-626310b9a57e, version: n1:b92a8ab44c7ea641, title: Oberfläche als weißes Blatt }
packages:
  - { id: c64ee86d-761a-4180-bfb1-cde819bfc27c, version: n1:fd3ed3f03b3d762f, title: Später }
---

Das Tool muss im Graphen des aktuellen Elements bei jedem Requirement seinen Nachweisstatus und bei jedem Need den Nachweisgrad der von ihm abgeleiteten Requirements zeigen.

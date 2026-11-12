---
id: 7bdef2ad-06d9-4f28-b7cf-6e6f7f2bdd8c
type: system-requirement
status: approved
title: Schnell zu Requirements gelangen
spec-id: SR-119
rationale: Gefragt ist der schnellste Weg zu einem bestimmten Requirement und zu allen Requirements eines Needs. Zielwege nach [ThomasBirkmaier/ReqSeq-archive#422, Kommentar](https://github.com/ThomasBirkmaier/ReqSeq-archive/issues/422#issuecomment-6425565888), Tastendrücke ohne den getippten Suchtext gezählt.
requirement-type: functional
acceptance-criteria:
  - "Gegeben ein Requirement, wenn es über Kurz-ID, Kennung oder Wörter des Titels gesucht wird, dann ist es mit zwei Tastendrücken und dem Suchtext geöffnet: Ctrl+P, Suchtext, Enter."
  - "Gegeben ein Need, wenn seine Requirements gesucht werden, dann sind sie mit drei Tastendrücken und dem Suchtext zu sehen: Ctrl+P, Kurz-ID oder Titel des Needs, Enter, Kürzel für die Umgebung (SR-107)."
verification-method: test
packages:
  - { id: ba811685-2a69-43cb-aea4-9c5cf9c4e9a3, version: n2:05f7041d485c484a, title: Finden und Listen }
derives-from:
  - { id: cbfe7443-9220-429d-a879-93d5c730a7fe, version: n1:f6c1a8f3adf322af, title: Einfacher Einstieg in die Daten }
based-on:
  - { id: c14efb7d-59da-4ef5-9b85-626310b9a57e, version: n2:0aa3402d0e47fcf7, title: Oberfläche als weißes Blatt }
---

Das Tool muss ein bestimmtes Requirement und alle Requirements eines Needs mit wenigen Tastendrücken erreichen lassen.

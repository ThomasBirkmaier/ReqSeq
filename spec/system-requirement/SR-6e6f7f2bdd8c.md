---
id: 7bdef2ad-06d9-4f28-b7cf-6e6f7f2bdd8c
type: system-requirement
status: approved
title: Schnell zu Requirements gelangen
spec-id: SR-119
rationale: "Entscheidung des Produktverantwortlichen, 2026-10-26: Gefragt ist der schnellste Weg zu einem bestimmten Requirement und zu allen Requirements eines Needs. Zielwege nach [#422, Kommentar](https://github.com/ThomasBirkmaier/logreq/issues/422#issuecomment-6425565888), Tastendrücke ohne den getippten Suchtext gezählt."
requirement-type: functional
acceptance-criteria:
  - "Gegeben ein Requirement, wenn es über Kurz-ID oder Wörter des Titels gesucht wird, dann ist es mit zwei Tastendrücken und dem Suchtext geöffnet: Ctrl+P, Suchtext, Enter."
  - "Gegeben ein Need, wenn seine Requirements gesucht werden, dann sind sie mit drei Tastendrücken und dem Suchtext zu sehen: Ctrl+P, Kurz-ID oder Titel des Needs, Enter, Kürzel für die Umgebung (SR-107)."
verification-method: test
topic: Bearbeiten und Finden
packages:
  - { id: cf800f25-d03d-4092-8783-334263089f89, version: n1:06520a1e692d8288, title: "Stufe 3: Oberfläche" }
derives-from:
  - { id: cbfe7443-9220-429d-a879-93d5c730a7fe, version: n1:f6c1a8f3adf322af, title: Einfacher Einstieg in die Daten }
based-on:
  - { id: c14efb7d-59da-4ef5-9b85-626310b9a57e, version: n1:b92a8ab44c7ea641, title: Oberfläche als weißes Blatt }
---

Das Tool muss ein bestimmtes Requirement und alle Requirements eines Needs mit wenigen Tastendrücken erreichen lassen.

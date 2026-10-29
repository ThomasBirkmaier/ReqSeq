---
id: 6adc7b11-54f7-4313-85d8-efb6fded357a
type: system-requirement
status: draft
title: "Auswahl einheitlich bilden"
spec-id: "SR-101"
requirement-type: functional
acceptance-criteria:
  - "Gegeben ein Paket P, wenn Abdeckung, Nachweisgrad, Baseline, Export und Mehrfachänderung auf P angewendet werden, dann verarbeitet jede Funktion genau die Elemente von P."
  - "Gegeben ein Filter und eine Variante zugleich, wenn die Auswahl gebildet wird, dann enthält sie nur Elemente, die beide Bedingungen erfüllen."
  - "Gegeben eine Liste von Kurz-IDs über Kommandozeile oder API, wenn die Auswahl gebildet wird, dann enthält sie genau diese Elemente."
verification-method: test
topic: "Bearbeiten und Finden"
packages:
  - { id: 7a12a8c7-43e7-4349-9453-0ac2b6d5157d, version: n1:8c09ff1853730c25, title: Querschnitt }
derives-from:
  - { id: 6ad3a133-c1a9-463e-86cd-23d0f277f785, version: n1:f863e5fdb90ec21b, title: Abdeckung einer Auswahl von Requirements }
  - { id: 6adc50a5-05d9-4e59-adfc-ae0179b6e5bf, version: n1:7b0a5a4bd2ba1739, title: Filtern }
  - { id: 6adc50a5-7bcc-4472-8749-22e86aaf86bd, version: n1:c914d49307741010, title: Filter speichern }
  - { id: 6adc6939-8613-4ad1-bcbe-36c978755079, version: n1:0aaaa75a8f382d15, title: Nachweisgrad einer Auswahl }
based-on:
  - { id: 6adc5316-641d-4817-964e-8803a78ac710, version: n1:98453db7e5f7bec6, title: Varianten über eine Gültigkeitsliste }
  - { id: 6adc691f-cfbf-4934-9504-21c1fc5849f7, version: n1:d3ce3d35b5c87ef2, title: Baseline als Datei }
  - { id: 6adc6920-0efc-478d-b91c-4ca42caaa8a8, version: n1:de2da62f92c63d52, title: Paket als Element }
---

Das Tool muss für jede Funktion, die eine Auswahl verarbeitet, die Auswahl über Filter, gespeicherten Filter, Paket, Baseline, Variante oder eine Liste von IDs bilden lassen.

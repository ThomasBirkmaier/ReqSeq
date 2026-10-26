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
  - { id: 7a12a8c7-43e7-4349-9453-0ac2b6d5157d, version: n1:648fcf9e635aa114, title: Querschnitt }
derives-from:
  - { id: 6ad3a133-c1a9-463e-86cd-23d0f277f785, version: n1:bbf25e560abf99fb, title: Abdeckung einer Auswahl von Requirements }
  - { id: 6adc50a5-05d9-4e59-adfc-ae0179b6e5bf, version: n1:c043acc544173102, title: Filtern }
  - { id: 6adc50a5-7bcc-4472-8749-22e86aaf86bd, version: n1:2dbb0c4c387a1421, title: Filter speichern }
  - { id: 6adc6939-8613-4ad1-bcbe-36c978755079, version: n1:285d8ba430f49045, title: Nachweisgrad einer Auswahl }
based-on:
  - { id: 6adc5316-641d-4817-964e-8803a78ac710, version: n1:e6a6aa661b7f9aa7, title: Varianten über eine Gültigkeitsliste }
  - { id: 6adc691f-cfbf-4934-9504-21c1fc5849f7, version: n1:5315d0dca7b9c00f, title: Baseline als Datei }
  - { id: 6adc6920-0efc-478d-b91c-4ca42caaa8a8, version: n1:798a4609ff245a5c, title: Paket als Element }
---

Das Tool muss für jede Funktion, die eine Auswahl verarbeitet, die Auswahl über Filter, gespeicherten Filter, Paket, Baseline, Variante oder eine Liste von IDs bilden lassen.

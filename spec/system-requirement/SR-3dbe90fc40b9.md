---
id: 6adc6acb-a6e4-4ffc-9258-3dbe90fc40b9
type: system-requirement
status: draft
title: "Fehlerhafte Dateien melden"
spec-id: "SR-008"
requirement-type: functional
acceptance-criteria:
  - "Gegeben eine Datei mit fehlerhaftem YAML-Frontmatter, wenn der Arbeitsbereich gelesen wird, dann meldet das Tool Datei, Zeile und Grund."
  - "Gegeben eine Datei mit Konfliktmarkern von Git, wenn der Arbeitsbereich gelesen wird, dann meldet das Tool die Datei als ungelösten Konflikt."
  - "Gegeben eine fehlerhafte Datei, wenn weitergearbeitet wird, dann arbeitet das Tool mit allen anderen Elementen normal und überschreibt die fehlerhafte Datei nie von selbst."
verification-method: test
topic: "Ablage und Repositories"
packages:
  - { id: 46610a27-2866-47fb-bb8f-293faae4885f, version: n1:f5900659a91cb0df, title: "Stufe 1: Fundament" }
derives-from:
  - { id: 6adc50a4-1b5c-4e15-b1ce-ab8ea74f70b0, version: n1:56a3f0bfddcd6254, title: Lesbar ohne das Tool }
  - { id: 6adc6938-6661-4f39-a0dd-ad97bb9e8f97, version: n1:1ff08c1e4b5bbd4d, title: Von außen geänderte Dateien }
based-on:
  - { id: 6adc78cf-bdda-461d-9245-ee53800698fb, version: n1:4a9fb120c7818346, title: Aufbau der Dateien mit fester Länge des Dateinamens }
---

Wenn eine Datei nicht gelesen werden kann, muss das Tool sie mit Grund melden und mit allen anderen Elementen weiterarbeiten.

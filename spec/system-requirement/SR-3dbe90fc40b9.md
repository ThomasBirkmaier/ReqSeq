---
id: 6adc6acb-a6e4-4ffc-9258-3dbe90fc40b9
type: system-requirement
status: approved
title: "Fehlerhafte Dateien melden"
spec-id: "SR-008"
requirement-type: functional
acceptance-criteria:
  - "Gegeben eine Datei mit fehlerhaftem YAML-Frontmatter, wenn der Arbeitsbereich gelesen wird, dann meldet das Tool Datei, Zeile und Grund."
  - "Gegeben eine Datei mit Konfliktmarkern von Git, wenn der Arbeitsbereich gelesen wird, dann meldet das Tool die Datei als ungelösten Konflikt."
  - "Gegeben eine fehlerhafte Datei, wenn weitergearbeitet wird, dann arbeitet das Tool mit allen anderen Elementen normal und überschreibt die fehlerhafte Datei nie von selbst."
verification-method: test
packages:
  - { id: 3aaac15c-a3ae-44d6-a640-c0fa48ccd25e, version: n2:3431ccb8330c70d3, title: Ablage und Repositories }
derives-from:
  - { id: 6adc50a4-1b5c-4e15-b1ce-ab8ea74f70b0, version: n1:0c42e42f057c09e4, title: Lesbar ohne das Tool }
  - { id: 6adc6938-6661-4f39-a0dd-ad97bb9e8f97, version: n1:398de7f02fc9e503, title: Von außen geänderte Dateien }
based-on:
  - { id: 6adc78cf-bdda-461d-9245-ee53800698fb, version: n2:cd7f259e8803f8f3, title: Aufbau der Dateien mit fester Länge des Dateinamens }
---

Wenn eine Datei nicht gelesen werden kann, muss das Tool sie mit Grund melden und mit allen anderen Elementen weiterarbeiten.

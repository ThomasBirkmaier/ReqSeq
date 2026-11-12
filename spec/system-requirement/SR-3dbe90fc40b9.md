---
id: 6adc6acb-a6e4-4ffc-9258-3dbe90fc40b9
type: system-requirement
status: approved
title: "Fehlerhafte Dateien melden"
spec-id: "SR-008"
requirement-type: functional
acceptance-criteria:
  - key: kj61
    text: Gegeben eine Markdown-Datei, die mit einem Kopf beginnt, der sich nicht als YAML lesen lässt oder nicht geschlossen ist, wenn der Arbeitsbereich gelesen wird, dann meldet das Tool Datei, Zeile und Grund als Fehler.
  - key: hw12
    text: Gegeben eine Datei mit Konfliktmarkern von Git, wenn der Arbeitsbereich gelesen wird, dann meldet das Tool die Datei als ungelösten Konflikt mit dem Schweregrad Fehler.
  - key: kdrw
    text: Gegeben eine fehlerhafte Datei, wenn weitergearbeitet wird, dann arbeitet das Tool mit allen anderen Elementen normal und überschreibt die fehlerhafte Datei nie von selbst; ist es eine Element-Datei, lehnt der Import einer Lieferung ab (SR-053 AK3).
  - key: pm64
    text: "Gegeben eine Datei des Tools mit einer Formatnummer, die das Tool nicht kennt, zum Beispiel `reqseq-filter: 2`, wenn das Tool sie liest, dann meldet es die Datei als fehlerhaft und verwendet ihren Inhalt nicht."
verification-method: test
packages:
  - { id: 3aaac15c-a3ae-44d6-a640-c0fa48ccd25e, version: n2:39b8c7c89788abe8, title: Ablage und Repositories }
derives-from:
  - { id: 6adc50a4-1b5c-4e15-b1ce-ab8ea74f70b0, version: n1:0c42e42f057c09e4, title: Lesbar ohne das Tool }
  - { id: 6adc6938-6661-4f39-a0dd-ad97bb9e8f97, version: n1:398de7f02fc9e503, title: Von außen geänderte Dateien }
based-on:
  - { id: 6adc78cf-bdda-461d-9245-ee53800698fb, version: n2:93c9bf669dbb72fb, title: Aufbau der Dateien mit fester Länge des Dateinamens }
  - { id: e4ccf89c-0e6f-4cd4-8632-c1c8d8e2f80c, version: n2:1af4880f173b5dda, title: Frühere Dateiformate werden nicht gelesen }
rationale: "Unbekannte Formatnummer (AK4): Annahme bestätigt; so ist es für Arbeitsbereich, Filter, Metamodell, Zuordnung und Datensatz gebaut. Import nur nach fehlerhafter Element-Datei abgelehnt (AK3, #1457): Annahme bestätigt; die Sperre verhindert, dass Elemente einer früheren Lieferung ein zweites Mal entstehen, und andere Dateien gefährden das nicht."
---

Wenn eine Datei nicht gelesen werden kann, muss das Tool sie mit Grund melden und mit allen anderen Elementen weiterarbeiten.

---
id: 11636f93-60a8-4b04-b8a4-dc9da6b4e142
type: system-requirement
status: draft
title: Texte vertraulicher Repositories in anderen Repositories finden
spec-id: SR-176
rationale: "In der Bereinigung der offenen Issues aus #678 als Wunsch ins Paket Später übernommen. Befund aus dem Pilot: ob ein öffentliches Repository Titel oder Text eines vertraulichen enthält, ließ sich nur mit einem eigenen Skript prüfen."
requirement-type: functional
acceptance-criteria:
  - Gegeben zwei Repositories, das zweite in der Arbeitsbereichs-Datei als nur über IDs referenziert gekennzeichnet, und der Titel eines Elements des zweiten steht in einer Datei des ersten, wenn der Arbeitsbereich geprüft wird, dann meldet das Tool eine Warnung mit Datei und Zeile.
  - Gegeben eine Textpassage aus einem Element des zweiten Repositories steht in einer Datei des ersten, die kein Element ist (zum Beispiel ein Nachweis-Datensatz oder eine README), wenn geprüft wird, dann meldet das Tool sie ebenso.
packages:
  - { id: 3aaac15c-a3ae-44d6-a640-c0fa48ccd25e, version: n2:3431ccb8330c70d3, title: Ablage und Repositories }
verification-method: test
derives-from:
  - { id: 6adc4fbb-04b5-4bda-a110-17ed577eb713, version: n2:8adb9da36ffa569f, title: Vertrauliches getrennt ablegen }
  - { id: 6adc4fbc-3b1e-4eb7-8e67-c99900ac6b04, version: n2:dcea215336ef28da, title: Fehlender Zugriff ist sichtbar }
based-on:
  - { id: 6adc78d1-e30a-4e59-a784-c469f4118cce, version: n2:2dee4df5314fc938, title: Beziehungen über Repository-Grenzen mit ID und Repository-Name }
---

Das Tool muss melden, wo Titel oder Textpassagen eines Repositories, das nur über IDs referenziert werden darf, in den Dateien eines anderen Repositories des Arbeitsbereichs vorkommen.

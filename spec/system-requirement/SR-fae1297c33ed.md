---
id: 83faee50-44fe-45cf-8251-fae1297c33ed
type: system-requirement
status: draft
title: Varianten und die Wahl der Ansicht auffindbar machen
spec-id: SR-178
rationale: "Entscheidung des Produktverantwortlichen, 2026-11-05: in der Bereinigung der offenen Issues aus #500 als Wunsch ins Paket Später übernommen. Bei der Abnahme der Stufe 5 waren die Varianten der eigenen Spec in der App zunächst nicht auffindbar, ebenso die optionalen Argumente eines Befehls."
requirement-type: functional
acceptance-criteria:
  - Gegeben die App, wenn die Ansicht gewählt werden soll, dann geht das über ein Tastenkürzel oder einen Menüeintrag, und die Statuszeile zeigt die gewählte Ansicht.
  - Gegeben ein Arbeitsbereich mit Varianten, wenn in der App Elemente aufgelistet werden, dann sind die Varianten dort ebenso auffindbar wie andere Elemente.
  - Gegeben ein geöffneter Ordner ohne Arbeitsbereich, in dessen Unterordner einer liegt, wenn er geöffnet wird, dann weist das Tool auf diesen Unterordner hin.
  - Gegeben die Kommandozeile, wenn die Varianten aufgelistet werden sollen, dann geht das mit einem Befehl ohne Auswahl in JSON.
  - Gegeben ein Befehl mit optionalen Argumenten in der Befehlszeile der App, wenn er angezeigt wird, dann zeigt die Befehlszeile, wie diese Argumente erreichbar sind.
packages:
  - { id: d033b1e9-39d8-4729-a08f-6285812ce348, version: n2:bab49f6690dc919b, title: Varianten }
verification-method: test
derives-from:
  - { id: 6adc531a-5adb-45d3-821a-11352a34c3b9, version: n2:bcef3dc092f1c8e8, title: Requirements einer Variante anzeigen }
  - { id: 61d4ffa4-bfc0-42c8-a7ef-d867c0ba286c, version: n2:675fa2767fc2398d, title: Befehle finden und Kürzel lernen }
---

Das Tool muss die Varianten, die Wahl der Ansicht und die optionalen Argumente eines Befehls in App und Kommandozeile auffindbar machen, ohne dass man ihre Namen kennt.

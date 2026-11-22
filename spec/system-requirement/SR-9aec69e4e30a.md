---
id: 6adc6d97-8ac2-4012-a447-9aec69e4e30a
type: system-requirement
status: approved
title: "Große Bestände flüssig bearbeiten"
spec-id: "SR-082"
rationale: "Zielwerte bestätigt. Referenzrechner: 4 Kerne, 16 GB Speicher, SSD. Die 200 ms gelten nicht für das erste Abfragen eines Elements nach dem Start; dieses hat eine eigene Grenze von 1 Sekunde. Eine Zeitgrenze gilt nur, wo ein AK sie nennt; andere Messungen mit 50.000 Elementen sind Vergleichswerte. Übliche Arbeitsbereiche haben 100 bis 1.000 Elemente. AK1 und AK2 messen den Start eines Prozesses bis zur ersten Seite der Liste aller Elemente mit ihrer Zahl (#750). Für das Berechnen von Nachweisstatus, Abdeckung und Nachweisgrad über den ganzen Bestand und für den Export der Daten gibt es keine eigene Grenze; sie werden gemessen und aufgezeichnet (#274)."
requirement-type: performance
acceptance-criteria:
  - key: m65x
    text: Gegeben ein Arbeitsbereich mit 50.000 Elementen und 200.000 Beziehungen und vorhandenem Zwischenspeicher, wenn ein neuer Prozess der API startet (`reqseq serve api`) und die erste Seite der Liste aller Elemente mit der Zahl aller Elemente abgefragt wird (`element.list`), dann liegt die Antwort höchstens 3 Sekunden nach dem Start des Prozesses vor.
  - key: r2jc
    text: Gegeben derselbe Arbeitsbereich ohne Zwischenspeicher, wenn ein neuer Prozess der API startet und dieselbe Abfrage gestellt wird, dann liegt die Antwort höchstens 30 Sekunden nach dem Start des Prozesses vor.
  - key: tndr
    text: Gegeben der Arbeitsbereich aus AK1, in dem seit dem Start bereits ein Element abgefragt wurde, wenn ein Element abgefragt wird (`element.get`), dann liefert das Tool es nach höchstens 200 ms.
  - key: h27y
    text: Gegeben der Arbeitsbereich aus AK1, wenn eine Liste der Elemente gefiltert, sortiert, gruppiert oder als Baum gezeigt oder eine Kette berechnet wird, auch als Nachbarschaft, Graph oder Matrix und für verwandte oder betroffene Elemente, dann liefert das Tool die erste Seite des Ergebnisses nach höchstens 500 ms; für einen Filter auf Nachweis- oder Validierungsstatus, eine Sortierung nach dem Nachweisstatus und eine Sortierung nach dem Zeitpunkt der Fassung gilt das jeweils, sobald sie seit dem Start einmal angewendet wurden.
  - key: csnf
    text: Gegeben der Arbeitsbereich aus AK1, wenn nach dem Start das erste Element abgefragt wird, dann liefert das Tool es nach höchstens 1 Sekunde.
verification-method: test
packages:
  - { id: d3daa1a2-adb1-4941-8c51-1fc9cb0bfb1d, version: n2:3cd7fefae7f4386e, title: Betrieb und Sicherheit }
derives-from:
  - { id: 6ad4f636-daf5-4ccf-86d9-ddb4a7ec1b28, version: n1:dfb6208ba57988f0, title: Große Datenmengen }
---

Das Tool muss Arbeitsbereiche mit 50.000 Elementen ohne spürbare Wartezeit bearbeiten lassen.

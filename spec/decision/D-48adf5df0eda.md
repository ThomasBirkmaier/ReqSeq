---
id: 2e19fbd2-7c21-4ec7-8b46-48adf5df0eda
type: decision
status: draft
title: Agents committen und mergen selbst
spec-id: D-071
---

Agents dürfen in allen Repositories des Projekts selbst committen und mergen. Jede Änderung, auch eine kleine, läuft über einen Pull Request, den der Agent selbst mergt, wenn die Pflichtprüfungen grün sind und das Review durch einen zweiten Agenten nichts Blockierendes findet. Im Repository von ReqSeq sperrt main Force-Push und Löschen und verlangt die Prüfungen static sowie checks und electron auf ubuntu-24.04. macOS und Windows prüfen main nach jedem Merge, nachts und im Release-Lauf; schlägt eine Prüfung auf main fehl, öffnet die Pipeline ein Issue, das vor weiteren Merges behoben wird.

Das gilt auch für Schemas, Architekturentscheidungen, Regeln für Agents, Skills und die Pipeline. Solche Pull Requests meldet der Agent dem Produktverantwortlichen, wartet aber nicht auf ihn.

Der Produktverantwortliche beantwortet Rückfragen zur Spec und nimmt jede Stufe ([D-035](reqseq:6adc6f46-bc08-4598-9b30-474383c78014?version=n1:53f2302a77f39023)) ab. Die Architektur ([D-052](reqseq:6adc723f-2ec5-40bf-a21e-82712e92cfc7?version=n1:6bb93e8ea8165f64)) sieht er bei der Abnahme von Stufe 0.

Grund: Nur so läuft der Bau ohne Warten. Pflichtprüfungen, kleine Pull Requests und die Abnahme je Stufe halten das Risiko klein. Entscheidung des Produktverantwortlichen, 2026-10-24. Seit 2026-10-29 ist main geschützt, und der direkte Weg auf main entfällt; Entscheidung des Produktverantwortlichen, 2026-10-29, im Quality Gate vor Stufe 5. Seit 2026-10-30 ersetzt macos-26 das Image macos-14, das GitHub am 2026-11-02 abschaltet; Entscheidung des Produktverantwortlichen, 2026-10-30, damit seltener umgezogen werden muss. Seit 2026-11-02 laufen macOS und Windows nicht mehr am Pull Request, sondern nach dem Merge auf main: Ein Pull Request wartete auf sie im Median etwa 18 statt 10 Minuten, und nur wenige Läufe scheiterten allein auf macOS oder Windows; Entscheidung des Produktverantwortlichen, 2026-11-02.

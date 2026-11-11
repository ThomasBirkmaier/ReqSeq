---
id: 74a090ad-aaf5-44a8-a0d5-7c0cad16d7bd
type: system-requirement
status: approved
title: Beim Einfügen Markdown erzeugen
spec-id: SR-190
requirement-type: functional
acceptance-criteria:
  - Gegeben formatierter Text in der Zwischenablage, zum Beispiel aus einem Browser oder einem Textprogramm, wenn er eingefügt wird, dann schreibt das Tool Überschriften, Hervorhebungen, Listen, Links und Tabellen als Markdown nach CommonMark mit GitHub-Erweiterungen und nichts als HTML; Bilder mit Adresse im Netz werden zu Markdown-Bildern, die das Tool nicht lädt (SR-184).
  - Gegeben markierter Text, wenn eine Adresse eingefügt wird, dann steht der Text als Markdown-Link mit dieser Adresse in der Datei.
  - Gegeben eine Bilddatei, wenn sie in den Text gezogen oder aus der Zwischenablage eingefügt wird, dann legt das Tool sie wie beim Einfügen eines Bildes ab und schreibt den Verweis an die Stelle.
packages:
  - { id: e8a95bf4-c96c-4c8a-9fa0-7e9bc0dbd5bd, version: n2:f14e7f16f403237e, title: Element bearbeiten }
verification-method: test
derives-from:
  - { id: 6adc5a7a-c3a4-4a8a-8a2e-49131b717bb0, version: n2:3f292d3254c41848, title: Schreiben wie in modernen Markdown-Editoren }
based-on:
  - { id: da7c347e-2b28-4036-9d64-0cdcd0445751, version: n2:4cfed2babc45e7f3, title: Text als Markdown mit Live-Vorschau }
  - { id: 909e3182-bbf5-4705-b55e-4e99001a8b98, version: n2:24ec2970172077cb, title: Markdown nach CommonMark mit GitHub-Erweiterungen }
refines:
  - { id: 6adc7b0b-4466-475b-a48d-d636f9f1f4ee, version: n2:a5edbc527ab70cf1, title: Bilder einfügen }
rationale: "Entscheidung des Produktverantwortlichen, 2026-11-07: Teil des Ausbaus des Editors zum Maßstab von N-055 (Darstellung wie Obsidian und Typora, Tastatur wie Emacs, Maus gleich vollständig)."
---

Der Editor muss eingefügte formatierte Inhalte, Adressen und Bilder als Markdown nach CommonMark mit GitHub-Erweiterungen in den Text schreiben.

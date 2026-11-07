---
id: 127c8da8-dbe4-429c-aaf0-d67bc18d6ff0
type: system-requirement
status: approved
title: Auswahl per Befehl formatieren
spec-id: SR-186
requirement-type: functional
acceptance-criteria:
  - Gegeben markierter Text, wenn der Befehl „Bold“, „Italic“ oder „Inline code“ über die Befehlszeile aufgerufen wird, dann steht der Text in der Datei zwischen „**“, „*“ beziehungsweise „`“, und die Markierung bleibt auf dem Text.
  - Gegeben markierter Text, wenn Ctrl+B oder Ctrl+I gedrückt wird, unter macOS Cmd+B oder Cmd+I (SR-145), dann wirkt das wie „Bold“ beziehungsweise „Italic“.
  - Gegeben markierter Text, der schon so formatiert ist, wenn derselbe Befehl aufgerufen wird, dann entfernt das Tool die Formatierung wieder.
  - Gegeben keine Markierung, wenn „Bold“, „Italic“ oder „Inline code“ aufgerufen wird, dann setzt das Tool die Zeichen um das Wort am Cursor, oder in einem Leerraum ein leeres Paar mit dem Cursor dazwischen.
  - Gegeben der Befehl „Link“ wird aufgerufen und in der Befehlszeile eine Adresse eingegeben, wenn Text markiert ist, dann steht er als Markdown-Link mit dieser Adresse in der Datei; ohne Markierung steht ein Link mit der Adresse als Text am Cursor.
  - Gegeben einer dieser Befehle wird ausgeführt, wenn danach Rückgängig gewählt wird, dann ist die ganze Formatierung in einem Schritt zurückgenommen.
packages:
  - { id: e8a95bf4-c96c-4c8a-9fa0-7e9bc0dbd5bd, version: n2:f14e7f16f403237e, title: Element bearbeiten }
verification-method: test
derives-from:
  - { id: 6adc5a7a-c3a4-4a8a-8a2e-49131b717bb0, version: n2:73038ab1083c32c8, title: Schreiben wie in modernen Markdown-Editoren }
based-on:
  - { id: da7c347e-2b28-4036-9d64-0cdcd0445751, version: n2:4cfed2babc45e7f3, title: Text als Markdown mit Live-Vorschau }
  - { id: 2d990242-8c7d-4d5b-af55-b149cb921241, version: n2:838f5d36618b5b66, title: Mausbedienung im Editor am Ort der Sache }
  - { id: 909e3182-bbf5-4705-b55e-4e99001a8b98, version: n2:cbe4e564179403f4, title: Markdown nach CommonMark mit GitHub-Erweiterungen }
rationale: "Entscheidung des Produktverantwortlichen, 2026-11-07: Teil des Ausbaus des Editors zum Maßstab von N-055 (Darstellung wie Obsidian und Typora, Tastatur wie Emacs, Maus gleich vollständig)."
---

Der Editor muss markierten Text über Befehle der Befehlszeile und deren Kürzel fett, kursiv, als Code oder als Link formatieren lassen.

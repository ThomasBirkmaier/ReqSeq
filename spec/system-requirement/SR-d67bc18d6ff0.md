---
id: 127c8da8-dbe4-429c-aaf0-d67bc18d6ff0
type: system-requirement
status: approved
title: Markierten Text per Befehl formatieren
spec-id: SR-186
requirement-type: functional
acceptance-criteria:
  - key: vzm9
    text: Gegeben markierter Text, wenn der Befehl „Bold“, „Italic“ oder „Inline code“ über die Befehlszeile aufgerufen wird, dann steht der Text in der Datei zwischen „**“, „*“ beziehungsweise „`“, und die Markierung bleibt auf dem Text.
  - key: ykwj
    text: Gegeben markierter Text, wenn Ctrl+B oder Ctrl+I gedrückt wird, unter macOS Cmd+B oder Cmd+I (SR-145), dann wirkt das wie „Bold“ beziehungsweise „Italic“.
  - key: njft
    text: Gegeben markierter Text, der schon so formatiert ist, wenn derselbe Befehl aufgerufen wird, dann entfernt das Tool die Formatierung wieder.
  - key: ddb8
    text: Gegeben keine Markierung, wenn „Bold“, „Italic“ oder „Inline code“ aufgerufen wird, dann setzt das Tool die Zeichen um das Wort am Cursor, oder in einem Leerraum ein leeres Paar mit dem Cursor dazwischen.
  - key: gbzd
    text: Gegeben der Befehl „Link“ wird aufgerufen und in der Befehlszeile eine Adresse eingegeben, wenn Text markiert ist, dann steht er als Markdown-Link mit dieser Adresse in der Datei; ohne Markierung steht ein Link mit der Adresse als Text am Cursor.
  - key: tbd1
    text: Gegeben einer dieser Befehle wird ausgeführt, wenn danach Rückgängig gewählt wird, dann ist die ganze Formatierung in einem Schritt zurückgenommen.
packages:
  - { id: e8a95bf4-c96c-4c8a-9fa0-7e9bc0dbd5bd, version: n2:8144976caed4daca, title: Element bearbeiten }
verification-method: test
derives-from:
  - { id: 6adc5a7a-c3a4-4a8a-8a2e-49131b717bb0, version: n2:3f292d3254c41848, title: Schreiben wie in modernen Markdown-Editoren }
based-on:
  - { id: da7c347e-2b28-4036-9d64-0cdcd0445751, version: n2:4cfed2babc45e7f3, title: Text als Markdown mit Live-Vorschau }
  - { id: 909e3182-bbf5-4705-b55e-4e99001a8b98, version: n2:c1a69d3f66480db9, title: Markdown nach CommonMark mit GitHub-Erweiterungen }
  - { id: 08ee8add-ef27-4972-ab4c-e0b8bcad916e, version: n2:fa15fb6d42e42413, title: Kontextmenü per Rechtsklick }
rationale: Teil des Ausbaus des Editors zum Maßstab von N-055 (Darstellung wie Obsidian und Typora, Tastatur wie Emacs, Maus gleich vollständig).
---

Der Editor muss markierten Text über Befehle der Befehlszeile und deren Kürzel fett, kursiv, als Code oder als Link formatieren lassen.

---
id: 6adc7b0b-4466-475b-a48d-d636f9f1f4ee
type: system-requirement
status: draft
title: "Bilder einfügen"
spec-id: "SR-097"
requirement-type: functional
acceptance-criteria:
  - Gegeben ein Bild wird eingefügt, wenn gespeichert wird, dann liegt die Bilddatei in einem Ordner neben der Element-Datei, der wie die Element-Datei ohne Endung heißt, und der Text verweist relativ darauf.
  - "Gegeben ein eingefügtes Bild, wenn die Datei in einem Texteditor oder auf dem Git-Server angezeigt wird, dann wird das Bild gefunden."
verification-method: test
topic: "Bearbeiten und Finden"
packages:
  - { id: cf800f25-d03d-4092-8783-334263089f89, version: n1:06520a1e692d8288, title: "Stufe 3: Oberfläche" }
derives-from:
  - { id: 6adc5a7a-c3a4-4a8a-8a2e-49131b717bb0, version: n1:cdd9943614927853, title: Schreiben wie in modernen Markdown-Editoren }
based-on:
  - { id: 6adc4946-b44c-4ae1-8dbf-fb9e88b8c607, version: n1:0c3f2da31ca1ae9a, title: Fassung als Prüfwert über den Inhalt }
  - { id: 6adc4ee9-4ac6-485f-a1c3-43352a58580f, version: n1:d6c378367fbf9eab, title: Jedes Element ist eine eigene Markdown-Datei }
---

Der Editor muss Bilder einfügen lassen und die Bilddatei in einem Ordner neben der Element-Datei ablegen, der wie die Element-Datei ohne Endung heißt.

---
id: 6adc7b0b-4466-475b-a48d-d636f9f1f4ee
type: system-requirement
status: approved
title: Bilder anhängen
spec-id: "SR-097"
requirement-type: functional
acceptance-criteria:
  - key: zs31
    text: "Gegeben ein Bild wird angehängt (CLI, API, MCP: `element.addAttachment`), wenn gespeichert wird, dann liegt die Bilddatei in einem Ordner neben der Element-Datei, der wie die Element-Datei ohne Endung heißt, und der Text verweist relativ darauf."
  - key: hp47
    text: Gegeben ein angehängtes Bild, wenn gespeichert wird, dann ist der Verweis ein relativer Pfad, der von der Element-Datei aus auf die Bilddatei führt, auf der Platte und im selben Commit.
  - key: zh1k
    text: Gegeben ein Bild wird als Inhalt mit Dateinamen statt als Datei übergeben, wenn es angehängt wird, dann legt das Tool es wie in AK1 ab und liefert den Verweis; ein Inhalt über 20 MiB oder ein Dateiname ohne die Endung eines Bildes wird mit einer Meldung abgelehnt, und eine vorhandene Datei wird nicht ersetzt.
verification-method: test
packages:
  - { id: e8a95bf4-c96c-4c8a-9fa0-7e9bc0dbd5bd, version: n2:8144976caed4daca, title: Element bearbeiten }
derives-from:
  - { id: 6adc5a7a-c3a4-4a8a-8a2e-49131b717bb0, version: n2:b401b886924aef12, title: Schreiben wie in modernen Markdown-Editoren }
based-on:
  - { id: 6adc4946-b44c-4ae1-8dbf-fb9e88b8c607, version: n2:fa0fbf62535d1e3c, title: Fassung als Prüfwert über den Inhalt }
  - { id: 6adc4ee9-4ac6-485f-a1c3-43352a58580f, version: n2:47d7dc2726d0c379, title: Jedes Element ist eine eigene Markdown-Datei }
---

Das Tool muss Bilder an ein Element anhängen lassen und die Bilddatei in einem Ordner neben der Element-Datei ablegen, der wie die Element-Datei ohne Endung heißt.

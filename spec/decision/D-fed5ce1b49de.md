---
id: 8c5dfcbf-7ed7-4bc0-9302-fed5ce1b49de
type: decision
status: accepted
title: Eigenes Repository für Testdaten
spec-id: D-070
supersedes:
  - { id: 6adc7242-69ec-4828-bdfb-87b5bdeda6ce, version: n1:3e5ad27a9077a346, title: Eigenes Repository für Testdaten }
---

Ein zweites privates Repository (ReqSeq-testdata) enthält einen Testbestand für ein erfundenes Produkt mit Varianten: Metamodell im eigenen Repository, mehrere Repositories mit Beziehungen nur über ID und Repository-Name ([D-058](reqseq:6adc78d1-e30a-4e59-a784-c469f4118cce?version=n1:a512906783057ef1)), Pakete, Baselines, Nachweise mit Belegen, ReqIF-Lieferungen und bewusst eingebaute Fehler. Ein Skript erzeugt daraus mehrere lokale Repositories mit Historie.

Kleine Testdateien je System Requirement und ein Generator für 50.000 Requirements ([N-036](reqseq:6ad4f636-daf5-4ccf-86d9-ddb4a7ec1b28?version=n1:dfb6208ba57988f0)) liegen im Code-Repository.

Agents dürfen den Testbestand ändern. Die Spec ändern sie nur nach [D-064](reqseq:9a32f660-4f85-44f4-8b6c-7ed260532265?version=n1:e9b6f11f497d2d5f): mit dem Tool, per Merge Request, und den Status setzt nur ein Mensch.

Grund: Die eigene Spec deckt nicht alle Fälle ab, und Merge Requests auf einem echten Requirements-Repository lassen sich nur so prüfen. Diese Fassung löst D-055 ab, das Agents jede Änderung der Spec verbot und damit D-064 widersprach. Entscheidung des Produktverantwortlichen, 2026-10-29.

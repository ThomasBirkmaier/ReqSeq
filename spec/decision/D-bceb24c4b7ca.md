---
id: b413f77d-743e-4abe-8b79-bceb24c4b7ca
type: decision
status: accepted
title: HTML-Export erzeugt das Tool selbst
spec-id: D-080
based-on:
  - { id: 6adc4ee9-4ac6-485f-a1c3-43352a58580f, version: n2:47d7dc2726d0c379, title: Jedes Element ist eine eigene Markdown-Datei }
  - { id: 6ad4a03f-d7cf-4b85-98da-3f4431f33fe7, version: n2:84d08b2dbd1bf992, title: Auswertungen mit externen Werkzeugen }
  - { id: 6adc4fba-93c0-402a-817f-2b480d68a0f7, version: n2:e42ff7f25de20c08, title: Zugriffsrechte liegen bei der Versionsverwaltung }
  - { id: 6adc691d-c3f6-4d51-a053-72a341032941, version: n2:c433f023b7b96248, title: Das Tool liest Git nur }
supersedes:
  - { id: 6adc5041-c67d-4bae-832e-562f4f79bb1e, version: n2:bc7a78d5782a0371, title: Dokumente mit externen Werkzeugen }
---

Einen [HTML-Export](reqseq:7f240c30-80c6-476d-bc9c-0215a0fef867?version=n2:7e08d73bbf3cc65a) des Arbeitsbereichs erzeugt das Tool selbst, im Aussehen seiner Dokumentation. Seine Seiten sind Ansichten des Tools. Sie zeigen, was seine Befehle liefern, und lassen sich im Browser durchsuchen, filtern, sortieren und gruppieren. Bearbeiten lässt sich darin nichts ([D-003](reqseq:6ad39066-51e1-4f3a-8e17-b36e2db4dd01?version=n2:8edeff4fa99963fe)), und Auswertungen über die Zeit oder Diagramme baut der Export nicht ([D-008](reqseq:6ad4a03f-d7cf-4b85-98da-3f4431f33fe7?version=n2:84d08b2dbd1bf992)). Auch den Unterschied eines Elements zu seiner Fassung in einer Baseline zeigt er aus der Ausgabe eines Befehls ([D-033](reqseq:6adc615d-b1c4-489a-8843-ecc4593d0bf6?version=n2:613f0cb9c096a2ac)). Wer die Seiten lesen darf, regelt, wer sie ablegt; das Tool veröffentlicht nichts ([D-016](reqseq:6adc4fba-93c0-402a-817f-2b480d68a0f7?version=n2:e42ff7f25de20c08), [D-036](reqseq:6adc691d-c3f6-4d51-a053-72a341032941?version=n2:c433f023b7b96248)).

Andere Dokumente, zum Beispiel PDF oder Word, erzeugt das Tool nicht. Das übernehmen externe Werkzeuge wie Pandoc auf Grundlage der Markdown-Dateien ([D-015](reqseq:6adc4ee9-4ac6-485f-a1c3-43352a58580f?version=n2:47d7dc2726d0c379)) und der abfragbaren Daten ([N-033](reqseq:6ad4a041-1888-4e26-831d-6384f51fb612?version=n2:7fdd4d5efbeb6396)).

Grund: Leser ohne das Tool und ohne Git sehen so dieselben Begriffe, Kennungen, Beziehungen und denselben Nachweisstatus je Akzeptanzkriterium wie in der App, ohne eine zweite Werkzeugkette.

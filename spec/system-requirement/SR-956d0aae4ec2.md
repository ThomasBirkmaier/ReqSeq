---
id: 9b1953ee-86c0-49c2-b014-956d0aae4ec2
type: system-requirement
status: draft
title: Fehlendes Fassungsdatum begründen
spec-id: SR-254
rationale: In einem flachen Klon oder ohne Git blieb das Datum einer Fassung leer, ohne Grund; Agents in Cloud-Containern hielten das für einen Fehler. Die Hinweise auf veraltete Beziehungen nennen den Grund schon in ihrem Text (SR-004 AK6).
requirement-type: functional
acceptance-criteria:
  - key: v8kj
    text: Gegeben `element.get` oder `element.resolve` mit der Eingabe, die das Datum der Fassung verlangt, `baseline.get` oder `html.export`, wenn das Tool für das gezeigte Element, für ein Element der gelieferten Seite der Baseline oder für eine Fassung, deren Datum eine geschriebene Seite des Exports nennt (SR-232 AK7), kein Datum ermitteln kann, dann führt die Ausgabe des Befehls in allen Zugängen die Warnungen nach AK2 und AK3; `html.export` führt jede Warnung einmal für alle geschriebenen Seiten, und die Seiten ändern sich dadurch nicht. Keine andere Ausgabe führt diese Warnungen, außer der von `element.list` nach SR-075 AK5; ein Datum, das nur ein Hinweis nennt, löst keine aus. Ein Element, für das die Ausgabe keine Fassung nennt, zählt nicht als Element ohne Datum; den Grund nennt dort der Befund zu seiner Datei.
  - key: j540
    text: "Gegeben ein Element nach AK1 ohne Datum, dessen Fassung nicht nach AK3 als nicht committet gilt, aus einem Repository, für das mindestens einer dieser Gründe zutrifft: das Repository fehlt lokal (SR-006 AK2); Git kann das Repository nicht lesen (kein Git-Repository in seinem Ordner und darüber, kein Git-Programm, oder Git lehnt das Repository ab); das Repository ist ein flacher Klon; wenn die Ausgabe gezeigt wird, dann führt sie für dieses Repository genau eine Warnung, die es nennt und den ersten zutreffenden dieser Gründe in dieser Reihenfolge; beim flachen Klon sagt sie, dass eine vollständige Git-Historie das Datum committeter Fassungen liefert. Welcher Fall von „Git kann das Repository nicht lesen“ vorliegt, muss sie nicht nennen."
  - key: j82g
    text: "Gegeben Elemente nach AK1 ohne Datum aus einem Repository, wenn die Ausgabe gezeigt wird, dann führt sie für dieses Repository für jeden der beiden folgenden Gründe, der für mindestens eines dieser Elemente zutrifft, genau eine Warnung, die das Repository, den Grund und in ihrem Text die Zahl der Elemente nennt, für die er zutrifft: die Fassung ist nicht committet, weil sie die aktuelle Fassung ist und ihr Inhalt vom letzten Commit abweicht oder ihre Datei in keinem Commit steht, in einem Repository, das lokal vorliegt und das Git lesen kann, auch in einem flachen Klon und in einem Git-Repository ohne Commit; sonst, wenn für das Repository kein Grund nach AK2 zutrifft, kann Git das Datum nicht nennen, etwa weil kein Commit diese Fassung hält oder ein Aufruf von Git scheitert oder nicht rechtzeitig antwortet (Fristen je Aufruf wie SR-075 AK5)."
  - key: mnrr
    text: Gegeben eine Ausgabe nach AK1 nennt für jedes Element aus einem Repository das Datum der Fassung, wenn sie gezeigt wird, dann führt sie für dieses Repository keine Warnung nach AK2 oder AK3, auch wenn sie für ein anderes Repository eine führt.
packages:
  - { id: 546c26ea-a25f-4ccf-a9c7-ce63607961b3, version: n2:dd8ebe8868421160, title: Traceability }
verification-method: test
refines:
  - { id: 6adc6c9a-01d7-43bd-9e05-4dd4c430de10, version: n2:e8660c8dd1727df7, title: Baseline anzeigen und vergleichen }
  - { id: 6adc6ac6-de13-4a53-9e75-b2fdb487c8fe, version: n2:365b801803360674, title: Arbeitsbereich aus Datei laden }
  - { id: 6e69d4d3-7e6e-45e6-909c-d2a436babc1f, version: n2:0c0af79dfb4d0998, title: Arbeitsbereich als HTML-Export schreiben }
derives-from:
  - { id: 4e9f9a9e-3a7e-4d6b-867c-37db7e1e2253, version: n2:7c57d49e4aa70297, title: Nach dem Herunterladen ohne Vorwissen beginnen }
based-on:
  - { id: 6adc4946-b44c-4ae1-8dbf-fb9e88b8c607, version: n2:fa0fbf62535d1e3c, title: Fassung als Prüfwert über den Inhalt }
  - { id: 6adc691d-c3f6-4d51-a053-72a341032941, version: n2:c433f023b7b96248, title: Das Tool liest Git nur }
---

Das Tool muss in jeder [Ausgabe eines Befehls](reqseq:840d00df-60ed-4742-9b82-9e712f270449?version=n2:1da2b0546525b3fa), die das Datum der [Fassung](reqseq:6ad4f981-630d-4227-9025-e1a5fad9ad7c?version=n2:180b056a64f9072f) eines Elements als eigene Angabe nennt, den Grund nennen, wenn es dieses Datum nicht ermitteln kann; ein Datum, das nur ein [Hinweis](reqseq:6adc66f7-7d52-4509-be21-08cffa6e493d?version=n2:40dfe9eae370dfe8) nennt, begründet der Text des Hinweises.

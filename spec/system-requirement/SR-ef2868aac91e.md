---
id: 12bad135-3c8d-49dd-935a-ef2868aac91e
type: system-requirement
status: approved
title: Trefferkarte der Befehlszeile mit Bewegung einblenden
spec-id: SR-182
rationale: Das Öffnen der Befehlszeile soll den Eindruck vermitteln, dass physisch etwas auf dem Bildschirm passiert. Gewählt wurden höchstens 200 ms, das Abdunkeln des ganzen Hintergrunds mit Unschärfe nur im Saum des Schattens und die Bewegung nur beim Öffnen, für die Kürzel-Karte ebenso.
requirement-type: quality
acceptance-criteria:
  - Gegeben die Befehlszeile ohne Trefferkarte, wenn die Trefferkarte erscheint, zum Beispiel nach Ctrl+Shift+P oder Ctrl+P, dann fährt sie von der Befehlszeile aus nach oben in ihre Lage und ist nach höchstens 200 ms vollständig zu sehen.
  - Gegeben die Trefferkarte fährt ein, wenn sie sich bewegt, dann wird der ganze Hintergrund im gleichen Maß dunkler und in einem Saum so breit wie ihr Schatten leicht unscharf; am Ende hat Text im Hintergrund außerhalb des Saums noch einen Kontrast von mindestens 4,5:1, im hellen und im dunklen Farbschema.
  - Gegeben die Trefferkarte fährt ein, wenn währenddessen getippt wird, dann geht kein Zeichen verloren.
  - Gegeben die Trefferkarte ist zu sehen, wenn zwischen Befehlen und Elementen gewechselt wird oder sich die Treffer ändern, dann fährt sie nicht noch einmal ein.
  - Gegeben die Karte der nächsten Tasten nach einem Präfix-Kürzel (SR-109), wenn sie erscheint, dann fährt sie ebenso ein wie die Trefferkarte.
  - Gegeben die Trefferkarte wird geschlossen, wenn sie verschwindet, dann läuft die Bewegung in kürzerer Zeit als beim Einblenden umgekehrt, und Abdunkeln und Unschärfe gehen im gleichen Maß zurück.
  - Gegeben im Betriebssystem ist „Bewegung reduzieren“ eingestellt, wenn die Trefferkarte erscheint oder verschwindet, dann geschieht das ohne Bewegung, und die Karte steht sofort im Endzustand, abgedunkelt und unscharf wie am Ende der Bewegung.
verification-method: test
derives-from:
  - { id: 6ad49f57-47f2-4570-a046-b1af59b51503, version: n2:07b7ff5a4868078c, title: "Einfach, minimalistisch und ästhetisch" }
based-on:
  - { id: c14efb7d-59da-4ef5-9b85-626310b9a57e, version: n2:723848211e07119a, title: Oberfläche als weißes Blatt }
packages:
  - { id: 5c0075c7-0fad-483a-b35e-af77d1499468, version: n2:23c8afe7316d80f6, title: Bedienung der App }
---

Die App muss die Trefferkarte der Befehlszeile beim Öffnen mit einer kurzen Bewegung von unten einblenden und dabei den Hintergrund im gleichen Maß dezent abdunkeln und im Bereich ihres Schattens leicht unscharf zeigen, sodass die Karte wirkt, als lege sie sich über den Inhalt.

---
id: c85ad6a8-717a-49e7-a069-bc8edce427c7
type: system-requirement
status: approved
title: Wechsel zum vorherigen und nächsten Buffer mit Bewegung zeigen
spec-id: SR-212
rationale: "Der Wechsel soll überall gleich aussehen, ob gewischt (SR-211) oder per Taste, Maustaste oder Befehl gewechselt wird. Nur Vor und Zurück gleiten, weil nur dort eine Richtung feststeht; Sprünge und das Öffnen zeigen sofort, so bleibt SR-082 AK3 unberührt. Ein neuer Tastendruck beendet eine laufende Bewegung sofort, damit schnelles mehrfaches Alt+P nicht gebremst wird. Die Bewegung folgt der Haltung von SR-182 (höchstens 200 ms, „Bewegung reduzieren“). Die 200 ms begrenzen nur die Bewegung. Sie beginnt, sobald der neue Buffer vollständig gezeichnet ist, ohne Platzhalter; die Zeit bis dahin begrenzt dieses SR nicht. Damit die Bewegung möglichst ohne Warten beginnt und beim Wischen der Buffer, zu dem gewechselt würde, an der Kante anschließt (SR-211 AK3), zeichnet die App den vorherigen und den nächsten Buffer vorab (AK5), soweit das Lesen dafür kurz dauert: Ein Element und seine Umgebung liest das Tool auch bei 50.000 Requirements in rund 10 ms (#1637). Eine Liste, eine Matrix, eine Paketseite, der Graph eines Elements oder die Übersicht liest es in bis zu einigen hundert Millisekunden; ein Element, das der Nutzer in dieser Zeit öffnet, wartet so lange und kann die Grenze von SR-082 AK3 verfehlen. Solche Buffer liest die App deshalb nicht vorab. Sie bleiben vorab gezeichnet, bis sich etwas ändert, das sie zeigen, also auch bis zum nächsten Speichern eines Elements. Gleich nach einer Änderung dauert das Lesen eines Elements länger, bei 50.000 Requirements bis rund 100 ms (#1637), und eine Änderung kann jederzeit kommen, auch durch das automatische Speichern (SR-105 AK1). Fiele dieses Lesen mit dem Öffnen eines Elements zusammen, könnte das Öffnen die Grenze von SR-082 AK3 verfehlen. Deshalb liest die App nach einer Änderung keinen vorherigen oder nächsten Buffer vorab, bis sie einen anderen Buffer zeigt. Ist der neue Buffer nicht vorab gezeichnet, etwa gleich nach einem Wechsel, nach dem Start oder nach einer Änderung, wartet die Bewegung, bis er gezeichnet ist. Das Vorabzeichnen hat keine eigene Zeitgrenze und ändert keine Grenze eines anderen AK. Die 200 ms der Bewegung und diese Grenzen gelten auch bei 50.000 Requirements (N-036)."
requirement-type: quality
acceptance-criteria:
  - key: d25h
    text: Gegeben mehrere geöffnete Buffer, wenn „Previous buffer“ oder „Next buffer“ ausgeführt wird, gleich ob über die Befehlszeile, ein Tastenkürzel (SR-115 AK5, SR-145 AK2, SR-163 AK3) oder eine Maustaste (SR-163), dann gleitet der gezeigte Buffer bei „Previous buffer“ nach rechts hinaus und der neue von links herein, bei „Next buffer“ umgekehrt, und die Bewegung dauert höchstens 200 ms. Ist das Ziel der Buffer, den der andere Bereich eines geteilten Fensters zeigt, bewegt sich nichts, und der andere Bereich wird aktiv.
  - key: kqvx
    text: Gegeben ein Wechsel gleitet noch, wenn eine Taste gedrückt, eine Maustaste Zurück oder Vor gedrückt oder erneut gewischt wird, dann steht der laufende Wechsel sofort im Endzustand, und die Eingabe wirkt auf den neuen Buffer; keine Eingabe geht verloren, und in den verlassenen Buffer wird kein Zeichen eingefügt.
  - key: hmwp
    text: Gegeben ein anderer Buffer wird aus anderem Grund gezeigt, zum Beispiel durch Ctrl+P, das Öffnen eines Elements oder eines Verweises, das Schließen eines Buffers oder den Modus „Agent folgen“, dann geschieht das ohne diese Bewegung.
  - key: kzb2
    text: Gegeben im Betriebssystem ist „Bewegung reduzieren“ eingestellt, wenn wie in AK1 gewechselt wird, dann steht der neue Buffer sofort da, ohne Bewegung.
  - key: tfck
    text: "Gegeben mehrere geöffnete Buffer, solange ein Buffer gezeigt wird, dann zeichnet die App den vorherigen und den nächsten Buffer (SR-115 AK5) vorab, ohne ihn zu zeigen, wenn er ein geöffnetes Element, das keine Paketseite ist, oder die Umgebung eines Elements zeigt und nicht schon im anderen Bereich eines geteilten Fensters gezeigt wird. Jeden anderen Buffer liest die App dafür nicht aus dem Arbeitsbereich: Er bleibt vorab gezeichnet, wenn er gezeichnet wurde und seither vorheriger oder nächster Buffer geblieben ist. Nach jeder Änderung des Arbeitsbereichs, auch durch eigenes Speichern, und nach jeder anderen Änderung dessen, was der vorherige oder der nächste Buffer zeigt, ist er nicht mehr vorab gezeichnet, und abweichend vom ersten Satz liest die App ihn dafür nicht aus dem Arbeitsbereich, bis sie einen anderen Buffer zeigt; von da an gilt wieder der erste Satz. Das Speichern beim Verlassen eines Elements (SR-105 AK1) zählt dabei zu dem Wechsel, der es auslöst. Ändert sich etwas, während ein Wischen den Buffer, zu dem gewechselt würde, schon zeigt, bleibt er bis zum Ende des Wischens stehen, wie er gezeichnet ist; wechselt das Wischen, zeichnet die App ihn danach neu wie jeden gezeigten Buffer. Ist der neue Buffer vorab gezeichnet und wird wie in AK1 gewechselt, beginnt die Bewegung, ohne auf das Zeichnen des neuen Buffers zu warten, und der neue Buffer zeigt dasselbe, was er ohne das Vorabzeichnen zeigte. Ist er es nicht, zeichnet die App ihn beim Wechsel oder sobald ein Wischen zu ihm beginnt (SR-211 AK3), und die Bewegung beginnt, sobald er gezeichnet ist."
packages:
  - { id: 5c0075c7-0fad-483a-b35e-af77d1499468, version: n2:23c8afe7316d80f6, title: Bedienung der App }
verification-method: test
derives-from:
  - { id: 6ad49f57-47f2-4570-a046-b1af59b51503, version: n2:07b7ff5a4868078c, title: "Einfach, minimalistisch und ästhetisch" }
refines:
  - { id: 0f759f3b-b03d-42f5-a38a-b0ca831ca864, version: n2:3eed09fb96e61f0a, title: In Buffern arbeiten }
based-on:
  - { id: c14efb7d-59da-4ef5-9b85-626310b9a57e, version: n2:723848211e07119a, title: Oberfläche als weißes Blatt }
---

Die App muss jeden Wechsel zum vorherigen oder nächsten [Buffer](reqseq:0dec8101-c777-49b0-8516-3cb674573638?version=n2:a6ae4348e2f95e2c) als waagrechte Bewegung zeigen, die höchstens 200 ms dauert und keine Eingabe aufhält, und dafür den vorherigen und den nächsten Buffer vorab zeichnen, soweit das Lesen dafür kurz dauert.

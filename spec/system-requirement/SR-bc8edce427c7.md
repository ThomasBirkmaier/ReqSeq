---
id: c85ad6a8-717a-49e7-a069-bc8edce427c7
type: system-requirement
status: approved
title: Wechsel zum vorherigen und nächsten Buffer mit Bewegung zeigen
spec-id: SR-212
rationale: Der Wechsel soll überall gleich aussehen, ob gewischt (SR-211) oder per Taste, Maustaste oder Befehl gewechselt wird. Nur Vor und Zurück gleiten, weil nur dort eine Richtung feststeht; Sprünge und das Öffnen zeigen sofort, so bleibt SR-082 AK3 unberührt. Ein neuer Tastendruck beendet eine laufende Bewegung sofort, damit schnelles mehrfaches Alt+P nicht gebremst wird. Die Bewegung folgt der Haltung von SR-182 (höchstens 200 ms, „Bewegung reduzieren“). Die 200 ms begrenzen nur die Bewegung. Sie beginnt, sobald der neue Buffer vollständig gezeichnet ist, ohne Platzhalter; die Zeit bis dahin begrenzt dieses SR nicht. Damit die Bewegung in der Regel ohne Warten beginnt und beim Wischen der Buffer, zu dem gewechselt würde, an der Kante anschließt (SR-211 AK3), zeichnet die App den vorherigen und den nächsten Buffer vorab (AK5); nur solange einer von ihnen noch nicht gezeichnet ist, etwa gleich nach einem Wechsel oder dem Start, wartet die Bewegung auf ihn. Das Vorabzeichnen hat keine eigene Zeitgrenze und ändert keine Grenze eines anderen AK. Die 200 ms der Bewegung und diese Grenzen gelten auch bei 50.000 Requirements (N-036).
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
    text: Gegeben mehrere geöffnete Buffer, solange ein Buffer gezeigt wird, dann zeichnet die App den vorherigen und den nächsten Buffer (SR-115 AK5) vorab, ohne sie zu zeigen, soweit sie nicht schon im anderen Bereich eines geteilten Fensters gezeigt werden. Sind sie gezeichnet und wird wie in AK1 gewechselt, beginnt die Bewegung, ohne auf das Zeichnen des neuen Buffers zu warten, und der neue Buffer zeigt dasselbe, was er ohne das Vorabzeichnen zeigte. Ist der neue Buffer beim Wechsel noch nicht gezeichnet, beginnt die Bewegung, sobald er gezeichnet ist.
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

Die App muss jeden Wechsel zum vorherigen oder nächsten [Buffer](reqseq:0dec8101-c777-49b0-8516-3cb674573638?version=n2:a6ae4348e2f95e2c) als waagrechte Bewegung zeigen, die höchstens 200 ms dauert und keine Eingabe aufhält, und dafür den vorherigen und den nächsten Buffer vorab zeichnen.

---
id: c85ad6a8-717a-49e7-a069-bc8edce427c7
type: system-requirement
status: approved
title: Wechsel zum vorherigen und nächsten Buffer mit Bewegung zeigen
spec-id: SR-212
rationale: Der Wechsel soll überall gleich aussehen, ob gewischt (SR-211) oder per Taste, Maustaste oder Befehl gewechselt wird. Nur Vor und Zurück gleiten, weil nur dort eine Richtung feststeht; Sprünge und das Öffnen zeigen sofort, so bleibt SR-082 AK3 unberührt. Ein neuer Tastendruck beendet eine laufende Bewegung sofort, damit schnelles mehrfaches Alt+P nicht gebremst wird. Die Bewegung folgt der Haltung von SR-182 (höchstens 200 ms, „Bewegung reduzieren“). Die Grenze gilt auch bei 50.000 Requirements (N-036); der neue Buffer wird dabei vollständig gezeichnet, ohne Platzhalter.
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

Die App muss jeden Wechsel zum vorherigen oder nächsten [Buffer](reqseq:0dec8101-c777-49b0-8516-3cb674573638?version=n2:a6ae4348e2f95e2c) als waagrechte Bewegung zeigen, die höchstens 200 ms dauert und keine Eingabe aufhält.

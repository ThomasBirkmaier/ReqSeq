---
id: 4a6851b2-8c80-43c1-ac81-aaad566ecc6a
type: system-requirement
status: approved
title: Hell und dunkel darstellen
spec-id: SR-113
requirement-type: quality
acceptance-criteria:
  - Gegeben die App, wenn sie startet, dann folgt sie der Einstellung des Betriebssystems.
  - Gegeben die App, wenn die Darstellung per Befehl gewechselt wird, dann wechselt sie ohne Neustart.
packages:
  - { id: cf800f25-d03d-4092-8783-334263089f89, version: n2:92f3a59a9af7becd, title: "Stufe 3: Oberfläche" }
verification-method: test
topic: Bearbeiten und Finden
derives-from:
  - { id: 6ad49f57-47f2-4570-a046-b1af59b51503, version: n1:7406bb900e631830, title: "Einfach, minimalistisch und ästhetisch" }
based-on:
  - { id: c14efb7d-59da-4ef5-9b85-626310b9a57e, version: n2:bce0e07df5d43c53, title: Oberfläche als weißes Blatt }
issue: https://github.com/ThomasBirkmaier/ReqSeq/issues/120
---

Die App muss eine helle und eine dunkle Darstellung bieten.

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
  - { id: 5c0075c7-0fad-483a-b35e-af77d1499468, version: n2:65dcf844650577fe, title: Bedienung der App }
verification-method: test
derives-from:
  - { id: 6ad49f57-47f2-4570-a046-b1af59b51503, version: n1:7406bb900e631830, title: "Einfach, minimalistisch und ästhetisch" }
based-on:
  - { id: c14efb7d-59da-4ef5-9b85-626310b9a57e, version: n2:59d1b195778616da, title: Oberfläche als weißes Blatt }
---

Die App muss eine helle und eine dunkle Darstellung bieten.

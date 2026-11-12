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
  - Gegeben keine Darstellung ist per Befehl gewählt, wenn sich die Einstellung des Betriebssystems ändert, während die App läuft, dann folgt die App ihr ohne Neustart; wurde die Darstellung per Befehl gewählt, bleibt sie, bis „Follow system light or dark mode“ gewählt wird, und nach einem Neustart folgt die App wieder dem Betriebssystem.
packages:
  - { id: 5c0075c7-0fad-483a-b35e-af77d1499468, version: n2:23c8afe7316d80f6, title: Bedienung der App }
verification-method: test
derives-from:
  - { id: 6ad49f57-47f2-4570-a046-b1af59b51503, version: n1:7406bb900e631830, title: "Einfach, minimalistisch und ästhetisch" }
based-on:
  - { id: c14efb7d-59da-4ef5-9b85-626310b9a57e, version: n2:2ec3810c4995e7aa, title: Oberfläche als weißes Blatt }
---

Die App muss eine helle und eine dunkle Darstellung bieten.

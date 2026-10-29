---
id: e5c9970b-7ba2-4cc6-b6ac-edaf4e56bb07
type: system-requirement
status: approved
title: Nur Aussagekräftiges zeigen
spec-id: SR-110
requirement-type: quality
acceptance-criteria:
  - Gegeben jede Ansicht der App, wenn sie geprüft wird, dann lässt sich für jedes sichtbare Bedienelement und jede Angabe sagen, was es in diesem Moment aussagt.
  - Gegeben ein Element, wenn es angezeigt wird, dann erscheinen UUID und Fassung nur auf Abruf, die Fassung außerdem bei einem veralteten Verweis.
  - Gegeben die App, wenn sie geprüft wird, dann öffnet sie keine eigenen Formulare, keine eigenen modalen Dialoge und keine dauerhaften Seitenleisten; der Ordnerdialog des Betriebssystems im Menü ist erlaubt.
  - Gegeben eine Farbe in der Oberfläche, wenn sie geprüft wird, dann kennzeichnet sie eine Bedeutung wie veraltet, Lücke oder aktuelles Element.
packages:
  - { id: cf800f25-d03d-4092-8783-334263089f89, version: n1:06520a1e692d8288, title: "Stufe 3: Oberfläche" }
verification-method: inspection
topic: Bearbeiten und Finden
derives-from:
  - { id: 6ad49f57-47f2-4570-a046-b1af59b51503, version: n1:7406bb900e631830, title: "Einfach, minimalistisch und ästhetisch" }
  - { id: d546b567-fda6-410d-a379-78deec04bfe2, version: n1:ff4acfc7f0085726, title: Nur Aussagekräftiges sehen }
based-on:
  - { id: c14efb7d-59da-4ef5-9b85-626310b9a57e, version: n1:fdb39689e8cfdeb5, title: Oberfläche als weißes Blatt }
---

Die App darf nur zeigen, was im jeweiligen Moment etwas aussagt; alles andere muss sie auf Abruf zeigen.

---
id: e5c9970b-7ba2-4cc6-b6ac-edaf4e56bb07
type: system-requirement
status: draft
title: Nur Aussagekräftiges zeigen
spec-id: SR-110
requirement-type: quality
acceptance-criteria:
  - Gegeben jede Ansicht der App, wenn sie geprüft wird, dann lässt sich für jedes sichtbare Bedienelement und jede Angabe sagen, was es in diesem Moment aussagt.
  - Gegeben ein Element, wenn es angezeigt wird, dann erscheinen UUID und Fassung nur auf Abruf, die Fassung außerdem bei einem veralteten Verweis.
  - Gegeben die App, wenn sie geprüft wird, dann öffnet sie keine Formulare, keine modalen Dialoge und keine dauerhaften Seitenleisten.
  - Gegeben eine Farbe in der Oberfläche, wenn sie geprüft wird, dann kennzeichnet sie eine Bedeutung wie veraltet, Lücke oder aktuelles Element.
packages:
  - { id: cf800f25-d03d-4092-8783-334263089f89, version: n1:3ec49c0d5a7866d3, title: "Stufe 3: Oberfläche" }
verification-method: inspection
topic: Bearbeiten und Finden
derives-from:
  - { id: 6ad49f57-47f2-4570-a046-b1af59b51503, version: n1:38d37db10c3c86df, title: "Einfach, minimalistisch und ästhetisch" }
  - { id: d546b567-fda6-410d-a379-78deec04bfe2, version: n1:7ea137b2c763b6b2, title: Nur Aussagekräftiges sehen }
based-on:
  - { id: c14efb7d-59da-4ef5-9b85-626310b9a57e, version: n1:ce1d13c56aad179c, title: Oberfläche als weißes Blatt }
---

Die App darf nur zeigen, was im jeweiligen Moment etwas aussagt; alles andere muss sie auf Abruf zeigen.

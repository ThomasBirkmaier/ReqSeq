---
id: 50cc0c7e-73a4-48ce-95de-f7f285cd9f2d
type: system-requirement
status: approved
title: Nachweisstatus je Variante als Plaketten zeigen
spec-id: SR-157
rationale: "Entscheidung des Produktverantwortlichen, 2026-10-31: Der Nachweisstatus je Variante, den die Seite eines Requirements bisher als Textzeile zeigt (SR-047 AK3), soll aussehen wie die Badges einer GitHub-README, in Pillenform, mit dem Namen der Variante auf der einen und dem Status auf der anderen Hälfte. Die Farben folgen D-062: Farbe nur, wo sie Bedeutung trägt."
requirement-type: functional
acceptance-criteria:
  - Gegeben ein Requirement mit Nachweisstatus für den Kern und seine Varianten (SR-047 AK3), wenn seine Seite in der App angezeigt wird, dann steht statt der Textzeile „Verification — …“ je Kern und Variante eine Plakette in Pillenform mit abgerundeten Enden, links der Name des Kerns oder der Variante, rechts ihr Nachweisstatus, wie ihn die Textzeile bisher zeigt, mit denselben Einträgen in derselben Reihenfolge.
  - Gegeben die Plaketten eines Requirements, wenn sie angezeigt werden, dann ist die linke Hälfte in Graustufen und die rechte trägt Farbe nur bei den Status nicht bestanden und veraltet (D-062); offen und nachgewiesen bleiben in Graustufen und unterscheiden sich durch ihren Text. Text und Hintergrund jeder Hälfte haben im hellen und im dunklen Erscheinungsbild ein Kontrastverhältnis von mindestens 4,5:1.
  - Gegeben die Plakette einer Variante, wenn auf ihre linke Hälfte geklickt wird, dann öffnet die App die Variante, wie bisher ihr Name in der Textzeile.
packages:
  - { id: c64ee86d-761a-4180-bfb1-cde819bfc27c, version: n1:fd3ed3f03b3d762f, title: Später }
verification-method: test
topic: Nachweis und Abdeckung
refines:
  - { id: 6adc6c96-e67e-4b89-b89d-9b7a06c41d9d, version: n1:83c4e0c7dc952286, title: Nachweis je Variante führen }
derives-from:
  - { id: 6ad50227-3476-4a97-8ec4-5d4f0543bb22, version: n1:b20a6c9601d52cfe, title: Status von Nachweis und Validierung }
based-on:
  - { id: c14efb7d-59da-4ef5-9b85-626310b9a57e, version: n1:fdb39689e8cfdeb5, title: Oberfläche als weißes Blatt }
---

Das Tool muss auf der Seite eines Requirements den Nachweisstatus des Kerns und jeder Variante als Plakette in Pillenform zeigen, links den Namen, rechts den Status, wie die Badges einer GitHub-README.

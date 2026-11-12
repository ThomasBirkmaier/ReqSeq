---
id: 50cc0c7e-73a4-48ce-95de-f7f285cd9f2d
type: system-requirement
status: approved
title: Nachweisstatus von Kern und Varianten als Plaketten zeigen
spec-id: SR-157
rationale: "Der Nachweisstatus je Variante, den die Seite eines Requirements bisher als Textzeile zeigt (SR-047 AK3), soll aussehen wie die Badges einer GitHub-README, in Pillenform, mit dem Namen der Variante auf der einen und dem Status auf der anderen Hälfte. Die Farben folgen D-062: Farbe nur, wo sie Bedeutung trägt. Indirekt nachgewiesen bleibt in Graustufen wie nachgewiesen, weil es kein Problem anzeigt; die Angaben zum Status (Zahl der nachgewiesenen Akzeptanzkriterien, fehlende Children) stehen in der rechten Hälfte; ein Requirement, für das keine Variante gilt, zeigt eine Plakette für den Kern, damit die Darstellung überall gleich ist; welche Einträge es gibt, regelt SR-047 AK3, ihre Form in der App diese Anforderung. AK2 meint beide Fälle, einen Arbeitsbereich ohne Varianten und ein Kern-Requirement, das jede Variante ausschließt oder ersetzt."
requirement-type: functional
acceptance-criteria:
  - key: c9cf
    text: "Gegeben ein Requirement mit Nachweisstatus für den Kern und seine Varianten, wenn seine Seite in der App angezeigt wird, dann steht je Eintrag nach SR-047 AK3 eine Plakette in Pillenform mit abgerundeten Enden, links der Name des Kerns oder der Variante, rechts ihr Nachweisstatus: offen, nachgewiesen, nicht bestanden oder veraltet (SR-031) oder indirekt nachgewiesen (SR-034), mit den Angaben, die dazu gehören: die Zahl der nachgewiesenen Akzeptanzkriterien (SR-031 AK5) und bei einem Parent, der nicht indirekt nachgewiesen ist, die fehlenden Children (SR-034 AK2)."
  - key: j923
    text: Gegeben ein Kern-Requirement, das in keiner Sicht einer Variante steht, zum Beispiel in einem Arbeitsbereich ohne Varianten, wenn seine Seite in der App angezeigt wird, dann steht dort eine Plakette für den Kern.
  - key: m1zy
    text: Gegeben die Plaketten eines Requirements, wenn sie angezeigt werden, dann ist die linke Hälfte in Graustufen, und die rechte trägt Farbe nur bei den Status nicht bestanden und veraltet (D-062); offen, nachgewiesen und indirekt nachgewiesen bleiben in Graustufen und unterscheiden sich durch ihren Text.
  - key: hmj8
    text: Gegeben die Plaketten eines Requirements, wenn sie im hellen und im dunklen Erscheinungsbild angezeigt werden, dann haben Text und Hintergrund jeder Hälfte ein Kontrastverhältnis von mindestens 4,5:1.
  - key: n2py
    text: Gegeben die Plakette einer Variante, wenn auf ihre linke Hälfte geklickt wird, dann öffnet die App die Variante.
packages:
  - { id: ed14d465-fd3f-4188-992b-3ff7af8595af, version: n2:42294a7722f821a6, title: Nachweis und Abdeckung }
verification-method: test
refines:
  - { id: 6adc6c96-e67e-4b89-b89d-9b7a06c41d9d, version: n2:7d6b73deee26f4e7, title: Nachweis je Variante führen }
derives-from:
  - { id: 6ad50227-3476-4a97-8ec4-5d4f0543bb22, version: n2:b080b82a30d57303, title: Status von Nachweis und Validierung }
based-on:
  - { id: c14efb7d-59da-4ef5-9b85-626310b9a57e, version: n2:723848211e07119a, title: Oberfläche als weißes Blatt }
---

Das Tool muss auf der Seite eines Requirements den Nachweisstatus des Kerns und jeder Variante als Plakette in Pillenform zeigen, links den Namen, rechts den Status.

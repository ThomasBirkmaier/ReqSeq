---
id: 7c003135-cc59-44fb-bddf-16fdd9fa74b5
type: system-requirement
status: approved
title: Element im anderen Bereich öffnen
spec-id: SR-150
rationale: "Entscheidung des Produktverantwortlichen, 2026-10-31: Ohne geteiltes Fenster soll sich das markierte Element mit „Open to the right“ oder „Open to the left“ auf dieser Seite öffnen lassen. Im geteilten Fenster soll der andere Bereich zeigen, was im aktiven Bereich gerade ausgewählt ist. Der Bereich, in dem markiert wurde, bleibt aktiv (AK1 bis AK3); vom Produktverantwortlichen bestätigt. Nach dem Ausprobieren entschied der Produktverantwortliche am selben Tag: Der andere Bereich ist eine Vorschau, die der Auswahl folgt, auch beim Wechsel von Paket zu Paket (AK4). Betritt der Benutzer die Vorschau, bleibt sie stehen, denn zwei Elemente sollen sich weiter nebeneinander stellen lassen; einen Schalter zum Ein- und Ausschalten gibt es nicht (AK5). Die Vorschau soll gleich beim Teilen erscheinen und nicht erst nach „Open to the right“ (AK6). Alt+O wechselt die Seite, weil Ctrl/Cmd+O schon einen Workspace öffnet und die Ctrl-Taste auf macOS dem Editor gehört (AK7). Die aktive Seite soll dezent erkennbar sein, ohne dass die Lesbarkeit leidet, denn Lesen ist der Hauptzweck (AK8)."
requirement-type: functional
acceptance-criteria:
  - Gegeben ein ungeteiltes Fenster und ein markiertes Element in einem Buffer, etwa ein Knoten im Graph oder eine Zeile einer Liste, wenn der Befehl „Open to the right“ gewählt wird, dann teilt sich das Fenster, der bisherige Buffer bleibt links und aktiv, und das markierte Element öffnet sich rechts als Vorschau.
  - Gegeben dasselbe, wenn der Befehl „Open to the left“ gewählt wird, dann öffnet sich das markierte Element links als Vorschau, und der bisherige Buffer steht rechts und bleibt aktiv.
  - Gegeben ein geteiltes Fenster, wenn „Open to the right“ oder „Open to the left“ gewählt wird und der inaktive Bereich auf dieser Seite liegt, dann zeigt er das markierte Element als Vorschau, und der aktive Bereich bleibt aktiv; liegt der aktive Bereich auf dieser Seite, dann öffnet sich das markierte Element dort wie beim Öffnen mit Enter.
  - Gegeben ein geteiltes Fenster, dessen inaktiver Bereich eine Vorschau zeigt, wenn im aktiven Bereich ein Element markiert wird, dann zeigt die Vorschau dieses Element an Stelle des bisherigen, ohne dass der aktive Bereich wechselt; das gilt auch für eine Paketseite in der Vorschau.
  - Gegeben ein geteiltes Fenster, dessen inaktiver Bereich keine Vorschau zeigt, weil der Benutzer ihn betreten, dort selbst einen Buffer geöffnet oder den Vergleich von Kern-Requirement und Ersatz (SR-044) geöffnet hat, wenn im aktiven Bereich ein Element markiert wird, dann bleibt der inaktive Bereich unverändert, sodass zwei Elemente nebeneinander stehen können.
  - Gegeben ein ungeteiltes Fenster und ein markiertes Element im angezeigten Buffer, wenn „Split window“ gewählt wird, dann bleibt der Buffer links und aktiv, und rechts erscheint sofort die Vorschau des markierten Elements; ohne markiertes Element teilt sich das Fenster wie in SR-115 beschrieben.
  - Gegeben ein geteiltes Fenster, wenn Alt+O (Option+O auf macOS) gedrückt wird, auch beim Tippen im Texteditor, dann wird der andere Bereich aktiv wie mit dem Befehl „Other window“, und es wird kein Zeichen eingefügt.
  - Gegeben ein geteiltes Fenster, dann ist der Text des inaktiven Bereichs etwas blasser, also mit etwas weniger Kontrast zum Hintergrund als der des aktiven, und erreicht im hellen wie im dunklen Modus noch einen Kontrast von mindestens 4,5:1 (WCAG 2.2 AA).
packages:
  - { id: 7755a224-01c9-4710-869a-7b1477fbd624, version: n1:cd51c9fc3d83c915, title: "Stufe 6: Austausch per ReqIF und Schutz" }
verification-method: test
topic: Bearbeiten und Finden
derives-from:
  - { id: 61d4ffa4-bfc0-42c8-a7ef-d867c0ba286c, version: n1:49c90a7abf6c0e3c, title: Befehle finden und Kürzel lernen }
  - { id: d546b567-fda6-410d-a379-78deec04bfe2, version: n1:ff4acfc7f0085726, title: Nur Aussagekräftiges sehen }
based-on:
  - { id: c14efb7d-59da-4ef5-9b85-626310b9a57e, version: n1:fdb39689e8cfdeb5, title: Oberfläche als weißes Blatt }
---

Die App muss das markierte Element per Befehl in einem Bereich neben dem aktuellen öffnen und im geteilten Fenster den anderen Bereich dem markierten Element folgen lassen.

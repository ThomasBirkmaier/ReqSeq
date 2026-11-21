---
id: 14acb1ba-c61a-4835-b570-ca08cbd7368a
type: system-requirement
status: approved
title: Baselines und Varianten im HTML-Export
spec-id: SR-234
requirement-type: functional
acceptance-criteria:
  - key: vjfq
    text: Gegeben eine Baseline, wenn ihre Seite angezeigt wird, dann nennt sie Name, Datum und den Commit je Repository und listet ihre Elemente getrennt nach geändert, hinzugefügt, entfernt und unverändert ([SR-051](reqseq:6adc6c9a-01d7-43bd-9e05-4dd4c430de10?version=n2:990f6c5b33e39b59) AK2, AK3); abgelöste Elemente stehen in einer eigenen Gruppe mit Kennung, Titel und Status ohne Link; ohne gespeicherte Auswahl gibt es kein „hinzugefügt“ und kein „entfernt“, und die Seite sagt das.
  - key: swvj
    text: Gegeben die Baselines eines Arbeitsbereichs, wenn die Seite aller Baselines angezeigt wird, dann steht jede mit Name, Datum, Zahl ihrer Elemente und Zahl der geänderten Elemente da, neueste zuerst.
  - key: k5g4
    text: Gegeben Varianten, wenn die Seite des Variantenvergleichs angezeigt wird, dann zeigt sie den Nachweisgrad je Variante neben dem Kern und darunter die Requirements, deren Nachweisstatus sich zwischen den Sichten unterscheidet, mit dem Status je Sicht.
  - key: gzpr
    text: Gegeben eine Variante, wenn ihre Seite angezeigt wird, dann zeigt sie, was sie gegenüber dem Kern hinzufügt, ersetzt und ausschließt, wie `variant.diff` es liefert ([D-033](reqseq:6adc615d-b1c4-489a-8843-ecc4593d0bf6?version=n2:613f0cb9c096a2ac), Ausnahme für den Kern), und ihren Nachweisgrad. Ein Vergleich mit anderen Varianten entfällt, weil eine Variante nur auf dem Kern aufbaut ([D-020](reqseq:6adc5316-641d-4817-964e-8803a78ac710?version=n2:0cd25f27b89543f2)).
packages:
  - { id: 17252361-b899-4483-ba2b-baf32da3193e, version: n2:0d0abaa40f3ba2a2, title: Zugänge und Anbindung }
verification-method: test
based-on:
  - { id: b413f77d-743e-4abe-8b79-bceb24c4b7ca, version: n2:a14b879b0af2da59, title: HTML-Export erzeugt das Tool selbst }
  - { id: 6adc615d-b1c4-489a-8843-ecc4593d0bf6, version: n2:613f0cb9c096a2ac, title: Unterschiede zeigt die Versionsverwaltung }
  - { id: 6adc5316-641d-4817-964e-8803a78ac710, version: n2:0cd25f27b89543f2, title: Varianten über eine Gültigkeitsliste }
  - { id: 6adc691f-cfbf-4934-9504-21c1fc5849f7, version: n2:310c324700784a6f, title: Baseline als Datei }
derives-from:
  - { id: 39e94ec5-33f0-4745-aff7-37c82bc6cd0e, version: n2:aeeed6f1f4b3a5f4, title: Elemente ohne das Tool im Browser lesen }
  - { id: 6ad3a422-7a13-458e-87c5-cf0c3829c511, version: n2:cbd406ed5e388018, title: Unterschied zum Kern erkennbar }
  - { id: 6ad47f0e-0734-4f0d-8d66-06c23933693c, version: n2:3d50558afdf39622, title: Baseline jederzeit festhalten }
---

Das [Tool](reqseq:6ad4f973-fdb9-461f-8dc4-b73619ba1dac?version=n2:2427cdd2079ee312) muss im [HTML-Export](reqseq:7f240c30-80c6-476d-bc9c-0215a0fef867?version=n2:7e08d73bbf3cc65a) je [Baseline](reqseq:6ad4f981-8c70-4568-a77a-3da4cd2f98ac?version=n2:ccd1e07d6007cfb6) und je [Variante](reqseq:6ad4f982-8c3e-4f6e-8813-a7bec0d462ff?version=n2:5eaaba5de8d5cd20) eine Seite zeigen und die Varianten mit dem [Kern](reqseq:6ad4f983-347f-45f1-9e4e-5223b02f876f?version=n2:f349f6753c963262) vergleichen.

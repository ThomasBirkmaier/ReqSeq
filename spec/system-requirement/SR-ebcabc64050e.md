---
id: 6adc7afa-cc9c-4c24-b09c-ebcabc64050e
type: system-requirement
status: approved
title: "Beziehungen nach erlaubten Typen prüfen"
spec-id: "SR-086"
requirement-type: functional
acceptance-criteria:
  - "Gegeben eine Beziehungsart derives-from, die nur von System Requirement auf Need erlaubt ist, wenn eine Datei sie von einem Need auf ein System Requirement setzt, dann zeigt das Tool einen Hinweis mit Quelle, Ziel und Beziehungsart."
  - "Gegeben eine solche Beziehung, wenn der Bestand über die Kommandozeile geprüft wird, dann erscheint sie als Befund."
verification-method: test
packages:
  - { id: dfdbf57e-059c-49ed-b9b2-21c51e291b3c, version: n2:9a6d5b6b85dc5026, title: Metamodell und Prüfung }
derives-from:
  - { id: 6ad47d8b-773c-4d21-bf35-1b7deeb96561, version: n1:de3fc7e167c1c882, title: Anpassbares Metamodell }
  - { id: 6adc6938-28fa-42f6-b018-5bbf010cc58c, version: n1:36dc84f63608e84c, title: Bestand prüfen }
based-on:
  - { id: 6ad4ffaa-f5ad-494e-97eb-a4c77c54dccc, version: n2:c94085aee93eede7, title: Fest eingebaute Bedeutungen des Metamodells }
---

Wenn eine Beziehung Typen verbindet, die das Metamodell für ihre Beziehungsart nicht erlaubt, muss das Tool einen Hinweis zeigen.

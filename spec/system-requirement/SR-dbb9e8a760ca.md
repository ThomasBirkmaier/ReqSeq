---
id: 6adc6d20-e825-45be-8813-dbb9e8a760ca
type: system-requirement
status: approved
title: "Zuordnung zum Metamodell als Datei speichern"
spec-id: "SR-054"
requirement-type: functional
acceptance-criteria:
  - key: yc8n
    text: Gegeben ein erster Import, wenn Typen, Beziehungsarten und Attribute der Quelle den Typen, Beziehungsarten und Properties des Metamodells zugeordnet werden, dann speichert das Tool die Zuordnung als YAML-Datei im Repository, eine Datei je Quelle im Ordner `reqif` des Haupt-Repositorys (zum Beispiel `reqif/kunde-a.yaml`).
  - key: vy8n
    text: Gegeben eine gespeicherte Zuordnung, wenn dieselbe Quelle erneut importiert oder dorthin exportiert wird und der Befehl die Zuordnungsdatei nennt, dann verwendet das Tool sie und braucht keine weitere Angabe zu Typen, Beziehungsarten und Attributen. Ein Export an die Quelle (SR-058) nimmt aus ihr nur die wegzulassenden Properties (SR-059) und das Attribut der Stellungnahme, ein Export im Modell der Quelle (SR-158) außerdem deren Typen, Attribute und Aufzählungswerte.
  - key: q7hs
    text: Gegeben eine Zuordnung, wenn das Metamodell der Quelle gelesen wird, dann ändert das Tool das eigene Metamodell nicht.
verification-method: test
packages:
  - { id: 0d3dc867-b3e5-401f-a6db-d95463166616, version: n2:0a96ee534d188a3a, title: Austausch per ReqIF }
derives-from:
  - { id: 6adc5040-2819-4ec5-a9e9-ad790fd35904, version: n1:3a3f6b6e64b1edc5, title: Zuordnung zum Metamodell }
based-on:
  - { id: 6adc5318-7e31-4925-b180-ff19c4c61c5f, version: n2:05581a0e4c20cadf, title: Kein Austausch von Metamodellen }
  - { id: 6adc78cf-bdda-461d-9245-ee53800698fb, version: n2:93c9bf669dbb72fb, title: Aufbau der Dateien mit fester Länge des Dateinamens }
rationale: "Was ein Export aus der Zuordnung nimmt (AK2): siehe #588."
---

Das Tool muss die Zuordnung der Typen und Attribute einer Quelle zum eigenen Metamodell als Datei speichern und wiederverwenden.

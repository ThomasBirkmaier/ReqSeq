---
id: 6adc723c-e194-4aa0-885a-a84ffa18e4bf
type: decision
status: accepted
title: "SR-ID in Commit, Pull Request und Test"
spec-id: "D-050"
---

Branch, Commit, Pull Request und Testname nennen die ID des System Requirements, der Testname auch das Akzeptanzkriterium, zum Beispiel [SR-036/AK2]. Testergebnisse entstehen als JUnit-Dateien mit diesen Angaben.

Eine Prüfung in der Pipeline lässt einen Pull Request scheitern, wenn er kein System Requirement nennt oder ein Akzeptanzkriterium mit Nachweismethode Test keinen Test hat.

Analyse, Inspektion und Demonstration werden als Protokoll im Repository festgehalten und bei der Abnahme der Stufe von einem Menschen bestätigt.

Grund: Die JUnit-Dateien sind genau die Datensätze, die das Tool als Nachweis lesen soll ([D-026](logreq:6adc58f5-a349-4870-af2f-971ec1cee679?version=n1:9355a14c6f926710)). Spätestens ab Stufe 4 berechnet das Tool die Abdeckung der eigenen Spec.

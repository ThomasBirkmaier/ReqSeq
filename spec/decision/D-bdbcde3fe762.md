---
id: 6adc723b-436b-4b39-8388-bdbcde3fe762
type: decision
status: accepted
title: "Ein Issue je System Requirement"
spec-id: "D-049"
---

Für jedes System Requirement gibt es genau ein Issue auf GitHub, je Stufe ([D-035](logreq:6adc6f46-bc08-4598-9b30-474383c78014?version=n1:796564f182d15bfd)) dazu ein Sammel-Issue. Das Issue enthält ID, UUID, Akzeptanzkriterien im Wortlaut und Nachweismethode.

Arbeiten ohne eigenes System Requirement, zum Beispiel Gerüst oder Architektur, bekommen ein eigenes Issue mit dem Label enabler.

Grund: Jedes System Requirement hat genau einen Ort der Umsetzung. Das hält die Kette bis zum Test eindeutig ([N-038](logreq:6adc4b47-50a8-4546-9007-f7cfdfa7b9cb?version=n1:534e615f151c6534)).

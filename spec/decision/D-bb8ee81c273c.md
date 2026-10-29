---
id: 6adc7239-e0f1-49c6-a82c-bb8ee81c273c
type: decision
status: superseded
title: "Die Spec kommt als Export ins Repository"
spec-id: "D-047"
---

Needs, System Requirements, Decisions und Glossar werden aus diesem Graph exportiert und liegen im Code-Repository im Ordner spec. Dieser Graph bleibt führend. Im Repository ändert nur der Export die Spec, die Agents lesen sie nur.

Der Export schreibt das Dateiformat des Tools: eine Markdown-Datei je Element ([D-015](reqseq:6adc4ee9-4ac6-485f-a1c3-43352a58580f?version=n1:d6c378367fbf9eab)), Aufbau nach [D-038](reqseq:6adc691f-c92a-4e59-94e3-4316bc024601?version=n1:4fae590a046685ef).

Grund: Jeder Agent und jeder Testlauf sieht denselben Stand. Änderungen der Spec erscheinen als Unterschied im Merge Request. Die eigene Spec wird der erste echte Bestand, den das Tool lesen muss. Wann die Spec ganz ins Tool wechselt, wird später entschieden.

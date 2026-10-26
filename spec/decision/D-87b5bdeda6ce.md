---
id: 6adc7242-69ec-4828-bdfb-87b5bdeda6ce
type: decision
status: accepted
title: "Eigenes Repository für Testdaten"
spec-id: "D-055"
---

Ein zweites privates Repository (logreq-testdata) enthält einen Testbestand für ein erfundenes Produkt mit Varianten: Metamodell im eigenen Repository, mehrere Repositories mit Beziehungen nur über ID ([D-028](logreq:6adc58f6-3c3a-4714-bbeb-99a9b102504e?version=n1:bad0cec4a055f3c0)), Pakete, Baselines, Nachweise mit Belegen, ReqIF-Lieferungen und bewusst eingebaute Fehler. Ein Skript erzeugt daraus mehrere lokale Repositories mit Historie.

Kleine Testdateien je System Requirement und ein Generator für 50.000 Requirements ([N-036](logreq:6ad4f636-daf5-4ccf-86d9-ddb4a7ec1b28?version=n1:46651697d8ac6406)) liegen im Code-Repository.

Agents dürfen den Testbestand ändern, die Spec nie.

Grund: Die eigene Spec deckt nicht alle Fälle ab, und Merge Requests auf einem echten Requirements-Repository lassen sich nur so prüfen.

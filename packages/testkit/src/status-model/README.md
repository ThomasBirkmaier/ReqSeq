# Status model

A second, deliberately naive implementation of the status rules, written from the spec and this table only, without reading `packages/core/src/evidence/` (epic #1389, #1394). Property tests compare the core with it on generated inputs. It is test code: it never ships, and no test of it or against it carries an `[SR-xxx/AKn]` token, so none counts as evidence of the tool.

- `model.ts`: one small function per rule below, the rule's source in its comment.
- `generator.ts`: fast-check arbitraries of small abstract inputs (one requirement, its acceptance criteria with criterion keys, older versions, records). Only records the reader accepts; refused ones belong to level 2 (#1396).
- `run.ts`: `forAllElements` runs a check over generated elements with `propertyParameters(process.env)`: `STATUS_MODEL_RUNS` (default 1000) and `STATUS_MODEL_SEED` (default 1394); a failure names the seed and the shrunk input.
- Level 1, `packages/core/src/evidence/status-model.property.test.ts`: the core's pure functions (`ownVerificationOf`, `criterionStatusesOf`, `validationOf`) against the model, core view only; the file names what it does not check.
- Import it from `@reqseq/testkit/status-model`, not from `@reqseq/testkit`, so only the tests that use it load fast-check.

Scope of this part: the own records of one element in one view. Views, variants, indirect verification and emergent elements follow in #1389's later parts. Not modelled: records refused by the reader (SR-038 AK4, SR-172 AK1, AK3).

## Rules

Quotes are the German spec, verbatim. "Assumption" marks a rule the spec does not settle; its source is ADR-0012 and the question named there.

### Verification status (Nachweisstatus)

| # | Rule | Source |
| --- | --- | --- |
| V1 | Only records of kind verification count; validation records never do. | D-007 („Angabe, ob es ein Nachweis oder eine Validierung ist“); ADR-0012 „Which records count“ |
| V2 | A record is of the current version or of an older one. | SR-031 AK2, AK4 |
| V3 | A requirement without any verification record is open. | SR-031 AK1: „Gegeben ein Requirement ohne Datensatz, wenn der Status berechnet wird, dann ist er offen.“ |
| V4 | Per criterion, the newest record of the current version that counts for it decides: passed gives verified. | SR-031 AK2: „Gegeben für jedes Akzeptanzkriterium ist der neueste Datensatz zur aktuellen Fassung bestanden, wenn der Status berechnet wird, dann ist er nachgewiesen.“ |
| V5 | Failed gives failed. | SR-031 AK3: „Gegeben für ein Akzeptanzkriterium ist der neueste Datensatz zur aktuellen Fassung nicht bestanden, wenn der Status berechnet wird, dann ist er nicht bestanden.“ |
| V6 | A criterion with counting records of older versions only is outdated; without any counting record it is open. | SR-031 AK4, AK8 (per criterion: „mindestens eines hat nur Datensätze zu älteren Fassungen“), D-072 |
| V7 | "Newest" compares dates as instants: the same instant in two offsets is a tie. | ADR-0012 „Which record decides“ („compared as an instant“) |
| V8 | A date that cannot be read is the oldest; two unreadable dates tie with each other. | Assumption: ADR-0012 „a date that cannot be read is the oldest“; the tie among them is this model's reading |
| V9 | Ties at the newest instant: the criterion is failed as soon as one of them failed. | SR-031 AK10: „… mehrere Datensätze zur aktuellen Fassung mit demselben neuesten Zeitpunkt (Datum und Uhrzeit), wenn der Status berechnet wird, dann ist es nicht bestanden, sobald einer von ihnen nicht bestanden ist.“ |
| V10 | A record that names no criterion counts for every criterion, of the current or an older version. | SR-031 AK6: „Gegeben ein Datensatz nennt kein Akzeptanzkriterium, wenn der Status berechnet wird, dann zählt er für alle Akzeptanzkriterien des Requirements.“ |
| V11 | A record of the current version counts for the criterion that carries a named key, or is at a named number (position from 1). | D-072 („über ihre Kriterienschlüssel nennen“; „die Nummer ist die Position in der Fassung, die er nennt“) |
| V12 | A record of the current version that names only unknown keys or numbers counts for no criterion, but is a record of the current version (for V15). | SR-031 AK12: „… nennt nur Kriterienschlüssel, die keines von ihnen trägt, oder nur Nummern, die es in der aktuellen Fassung nicht gibt, … dann zählt er für kein Akzeptanzkriterium, gilt aber als Datensatz zur aktuellen Fassung.“ |
| V13 | A record of an older version counts for the current criterion with the same key: a named key directly, a named number through the key the criterion at that position had in the older version. A number the older version does not have, an older version whose criteria are not known (no Git history), a criterion without key there, or a key no current criterion carries count for no criterion; the record stays a record of an older version (for V15). | SR-031 AK11: „… dann zählt er für das Akzeptanzkriterium der aktuellen Fassung, das denselben Kriterienschlüssel trägt; gibt es die Nummer in der älteren Fassung nicht, fehlt für eine Nummer die Git-Historie mit der älteren Fassung (etwa ohne Git oder in einem flachen Klon), hat das Akzeptanzkriterium dort keinen Kriterienschlüssel oder trägt keines der aktuellen Fassung ihn, zählt er für kein Akzeptanzkriterium und bleibt ein Datensatz zu einer älteren Fassung (AK4).“ (product owner decision, 2026-11-11, #1502). A named key is not checked against the older version's keys: this model's reading (the AK names no such case). |
| V14 | Without criteria, the newest records of the current version decide for the whole requirement (ties as V9), also records that name criteria; only older records give outdated. | SR-031 AK7: „Gegeben ein Requirement ohne Akzeptanzkriterien, wenn der Status berechnet wird, dann zählt der neueste Datensatz zur aktuellen Fassung für das ganze Requirement.“ Ties and named criteria: ADR-0012 „Per acceptance criterion“ |
| V15 | The requirement: failed if one criterion is failed; else outdated if it has no record of the current version but records of older versions (also with a criterion without record); else open if one criterion is open; else outdated if one is outdated; else verified. | SR-031 AK9: „… dann gilt der Vorrang nicht bestanden vor offen vor veraltet vor nachgewiesen mit der Ausnahme aus AK4: Ist eines nicht bestanden, ist er nicht bestanden; sonst ist er veraltet, wenn es für das Requirement keinen Datensatz zur aktuellen Fassung, aber Datensätze zu älteren Fassungen gibt (AK4), auch wenn ein Akzeptanzkriterium keinen Datensatz hat; sonst ist er offen, wenn eines keinen Datensatz hat, sonst veraltet.“ AK4, AK5, AK8 are its cases |
| V16 | The tool shows how many criteria are verified ("2 von 3"). | SR-031 AK5, D-072 („wie viele seiner Akzeptanzkriterien schon nachgewiesen sind“) |
| V17 | A key that two current criteria carry names neither of them, for a record of the current or of an older version (directly or through the key of a number). A number still names its position. | SR-204 AK10: „… tragen zwei Akzeptanzkriterien denselben Kriterienschlüssel, meldet sie einen Fehler, und ein Datensatz mit diesem Kriterienschlüssel zählt für keines der beiden.“ |

### Validation status (Validierungsstatus)

| # | Rule | Source |
| --- | --- | --- |
| A1 | Only records of kind validation count, for the element as a whole: criteria they name are ignored. | D-007; SR-038 AK3 (per element); ADR-0012 (`criteria` „verification only, a reader warns about it on a validation record and reads that without it“) |
| A2 | No validation record: open. | SR-038 AK3: „… dann ist er offen ohne Datensatz …“ |
| A3 | The newest validation record of the current version decides: passed gives validated (erfolgreich), failed gives failed, inconclusive gives inconclusive. | SR-038 AK3: „… erfolgreich, nicht erfolgreich oder nicht beurteilbar (SR-172) nach dem neuesten Datensatz zur aktuellen Fassung …“ |
| A4 | Ties at the newest instant (V7, V8): the worst result, failed before inconclusive before passed. | SR-038 AK3: „… bei mehreren gleich neuen nach dem schlechtesten Ergebnis (nicht erfolgreich vor nicht beurteilbar vor erfolgreich) …“ |
| A5 | Records of older versions only: outdated. | SR-038 AK2: „Gegeben ein Element, dessen Validierungs-Datensätze alle zu älteren Fassungen gehören, wenn der Status berechnet wird, dann ist er veraltet.“ |
| A6 | An inconclusive status carries the reason of its record; on a tie of several inconclusive records, the reason of the first in index order (here: input order). | SR-172 AK2: „… dann ist er nicht beurteilbar … und das Tool zeigt die Begründung.“ The tie: assumption, ADR-0012 „Validation status“ (#807 Q3) |

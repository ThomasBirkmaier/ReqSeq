# Status model

A second, deliberately naive implementation of the status rules, written from the spec and this table only, without reading `packages/core/src/evidence/` (epic #1389, #1394). Property tests compare the core with it on generated inputs. It is test code: it never ships, and no test of it or against it carries an `[SR-xxx/AKn]` token, so none counts as evidence of the tool.

- `model.ts`: one small function per rule below, the rule's source in its comment.
- `generator.ts`: fast-check arbitraries of small abstract inputs (one requirement, its acceptance criteria with criterion keys, older versions, records). Only records the reader accepts; refused ones belong to level 2 (#1396).
- `workspace-model.ts`, `workspace-generator.ts` (#1395): views, records per view and indirect verification over small workspaces (rules W, R, I below).
- `degree-model.ts` (#1396): the verification degree, the status filters and the validation an element shows (rules D, F, A7 below).
- `file-workspace.ts`, `file-render.ts` (#1396): level 2, a workspace as files (twins with their own criteria and version, records against one file's version, both version forms, Markdown and JUnit, CRLF, records the reader refuses), the model's reading of it (R4, R5) and the pure adapter to file contents.
- `run.ts`: `forAllElements`, `forAllWorkspaces` and `forAllFileWorkspaces` run a check over generated inputs with `propertyParameters(process.env)`: `STATUS_MODEL_RUNS` (default 1000) and `STATUS_MODEL_SEED` (default 1394); a failure names the seed and the shrunk input. Level 2 takes `STATUS_MODEL_FILE_RUNS` (default 30) instead of `STATUS_MODEL_RUNS`.
- Level 1, `packages/core/src/evidence/status-model.property.test.ts`: the core's pure functions against the model; the file names what it does not check.
- Level 2, `packages/core/src/evidence/status-model.files.property.test.ts`: the workspace on disk, read through the commands, against the model.
- Import it from `@reqseq/testkit/status-model`, not from `@reqseq/testkit`, so only the tests that use it load fast-check.

Scope: the own records of one element (#1394), and views, variants, indirect verification and emergent elements over a workspace (#1395). Level 2 adds the files, the degree and the filters (#1396). Not modelled: repositories that are not on this machine (`incomplete`, SR-006), and a metamodel without the meanings or not valid.

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
| V13 | A record of an older version counts for the current criterion with the same key: a named key directly, a named number through the key the criterion at that position had in the older version. A number the older version does not have, an older version whose criteria are not known (no Git history), a criterion without key there, or a key no current criterion carries count for no criterion; the record stays a record of an older version (for V15). | SR-031 AK11: „… dann zählt er für das Akzeptanzkriterium der aktuellen Fassung, das denselben Kriterienschlüssel trägt; gibt es die Nummer in der älteren Fassung nicht, fehlt für eine Nummer die Git-Historie mit der älteren Fassung (etwa ohne Git oder in einem flachen Klon), hat das Akzeptanzkriterium dort keinen Kriterienschlüssel oder trägt keines der aktuellen Fassung ihn, zählt er für kein Akzeptanzkriterium und bleibt ein Datensatz zu einer älteren Fassung (AK4).“ (#1502). A named key is not checked against the older version's keys: this model's reading (the AK names no such case). |
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
| A7 | Every need shows a validation status (open without record), a requirement only with a validation record, no other element. | SR-038 AK1, AK5; `data-export.schema.json` `element.validation` |

### Views (Sichten)

| # | Rule | Source |
| --- | --- | --- |
| W1 | A relation item resolves in the repository it names, else in its source's repository; it names an element only when exactly one file there carries the UUID. Two files of one UUID in that repository (twins) make it ambiguous: it names neither, so its source is no child and a replacement or exclusion through it has no effect. | ADR-0004 (relation target `repository`, D-058); trace block (`childrenOf`: „each of them is `unresolved` with the state `ambiguous`“); SR-088 |
| W2 | The core view holds the requirements without validity. | SR-043 AK9: „Gegeben die Sicht des Kerns, wenn sie gewählt wird, dann zeigt das Tool nur Requirements ohne Gültigkeit.“ SR-040 AK1 |
| W3 | A requirement with validity is in the view of each variant it names, and only there. | SR-040 AK2: „Gegeben ein Requirement mit der Gültigkeit Variante A und Variante B, wenn die Sichten berechnet werden, dann gilt es nur für diese beiden.“ |
| W4 | A variant's view holds the core requirements it neither excludes nor replaces. | SR-040 AK1: „… in der Sicht jeder Variante, die es weder ausschließt noch ersetzt.“ SR-043 AK1 |
| W5 | An exclusion of a variant takes the core requirement it names out of that variant's view; one naming a requirement with validity or an element without validity changes no view. | SR-042 AK1, AK7: „… nennt ein Requirement mit Gültigkeit oder ein Element ohne Property mit der Bedeutung Gültigkeit … dann ändert sich keine Sicht …“ |
| W6 | A requirement with validity and the relation replaces on a core requirement takes it out of the views of the variants of its validity, whatever its own status; without validity, or on a target with validity or without validity property, it changes no view. Several replacing requirements are all in the view. | SR-041 AK1, AK3, AK4, AK6, AK7, AK8, AK9: „… ersetzt SR-A das Kern-Requirement SR-K weiter: Der Status ändert die Sicht nicht …“ |
| W7 | Elements of a type without validity (needs) are in every view. Exclusion before replacement (SR-042 AK5) changes `variant.diff` only: both take the core requirement out of the view. | SR-043 AK10; SR-042 AK5 |
| W8 | A requirement has one entry for the core when it is in the core view, and one for each variant whose view holds it, none for a variant with an invalid status. Other types have none. | SR-047 AK3: „… je einen Eintrag für den Kern, wenn es dort gilt, und für jede Variante, für die es gilt …“; AK6: „Gegeben eine Variante mit ungültigem Status, … dann gibt es für sie keinen Eintrag“; ADR-0012 „Which elements“ |

### Records per view

| # | Rule | Source |
| --- | --- | --- |
| R1 | In the core view only verification records without variant count. | SR-047 AK2: „Gegeben ein Datensatz ohne Angabe einer Variante, wenn der Status berechnet wird, dann zählt er nur für den Kern, außer …“; SR-173 AK2 |
| R2 | In a variant's view the records for that variant count; records for another variant never. | SR-047 AK1: „… mit einem bestandenen Datensatz für Variante A, wenn der Status für Variante B berechnet wird, dann ist er dort offen.“ |
| R3 | When the element's repository is variant-independent, its records without variant count in every variant's view too, pooled with that variant's records (V4 to V15 over both). The element's repository decides. | SR-173 AK1: „… dann zählt er für den Kern und für jede Variante, für die das Element gilt.“ Rationale (#817): „Es zählt das Repository des Elements, nicht das des Datensatzes.“ Pooling: ADR-0012 „Which records count“ |
| R4 | A record names its element by UUID, so it is a record of every file with that UUID (twins, also in two repositories); each file is measured by its own repository's mark (R3), criteria and version. A record of the current version of one file is a record of an older version for its twin with other content. Level 1 gives the files of one UUID one own part; level 2 gives a twin its own criteria and text. | ADR-0012 „Decision“ (`element` (UUID)), „Which records count“: „twins of one UUID each follow their own repository“ |
| R5 | A record the reader refuses counts for no status: an inconclusive verification record, a validation record with a variant, an inconclusive one without reason (assumption: SR-172 AK1 says only that the reader reports it; spec question #807 Q1), a date that is no RFC 3339 date-time. | SR-172 AK3: „… weist das Tool ihn ab, nennt den Grund, und er zählt für keinen Status.“ SR-038 AK4 (same words), SR-172 AK1; `evidence-record.schema.json` (`date`) |

### Indirect verification (Indirekter Nachweis)

| # | Rule | Source |
| --- | --- | --- |
| I1 | A requirement with a verification record that counts in the view (R1 to R3, any version, any result) takes its status from its records (V3 to V16). | SR-034 AK1: „Gegeben ein Parent ohne eigenen Datensatz der Art Nachweis in der betrachteten Sicht …“; ADR-0012 „Indirect verification“ |
| I2 | The counted children of a parent in a view: the elements with a derivation item that names it (W1), whose type is requirement, whose status is not invalid and that are in the view; each once. A replacing requirement has only its own children. | SR-034 AK1 („mindestens ein gültiges Child hat, das ein Requirement ist“), AK3: „Gegeben ein Child hat einen als ungültig gekennzeichneten Status, … dann zählt dieses Child nicht.“ D-044; SR-043 AK7; SR-041 AK5: „SR-A hat nur seine eigenen Beziehungen …“ |
| I3 | Without own record, with at least one counted child, and every counted child verified or itself indirect in the same view: indirect. | SR-034 AK1: „… und jedes dieser Children ist nachgewiesen oder selbst indirekt nachgewiesen, … dann ist er indirekt nachgewiesen.“ |
| I4 | Otherwise open; when counted children are failed, open or outdated, it names them (direct children only, compared as a set). Without a counted child it names none. | SR-034 AK2: „… dann ist er nicht indirekt nachgewiesen und das Tool nennt die direkten Children, die fehlen.“ `open`, and none named without a counted child: assumption, ADR-0012 (ThomasBirkmaier/ReqSeq-archive#526 Q3, Q4) |
| I5 | An emergent requirement without own record is open, never indirect, and names no children; as a child it is open, so it is missing. | SR-035 AK1: „… dann reicht der indirekte Nachweis über Children nicht, sondern es braucht einen eigenen Datensatz.“ No children named: assumption, ADR-0012 „Emergent“ (3) (ThomasBirkmaier/ReqSeq-archive#591 Q3) |
| I6 | An element on a derivation cycle of elements without own record is not indirect: indirect is the least fixed point of I3, so a cycle never verifies itself. | Assumption: ADR-0012 „Indirect verification“ (ThomasBirkmaier/ReqSeq-archive#526 Q5) |

### Verification degree (Nachweisgrad) and filters

| # | Rule | Source |
| --- | --- | --- |
| D1 | Counted are the requirements of the selection whose status is not invalid and that have a status in the view (W2 to W7), each once with its status there. The view of a variant with an invalid status is counted like any other (it has statuses, `evidence.status` only shows no entry for it): this model's reading. | SR-037 AK3: „Gegeben Requirements mit ungültigem Status, … dann zählen sie nicht mit.“ `data-export.schema.json` `verificationDegree` (ThomasBirkmaier/ReqSeq-archive#592) |
| D2 | A selection without variant counts the core requirements with their status in the core. | SR-037 AK4: „Gegeben eine Auswahl ohne gewählte Variante, … dann zählen nur die Requirements des Kerns mit ihrem Nachweisstatus im Kern.“ |
| D3 | The count per status: open, verified, indirect, failed, outdated; indirect apart from verified; they add up to the total. | SR-037 AK1: „… die Anzahl je Status“; AK2: „… zählen sie als nachgewiesen und sind getrennt ausgewiesen.“ |
| D4 | The share is (verified + indirect) / total, left out at total 0. | SR-037 AK1: „… 10 gültigen Requirements, davon 6 nachgewiesen, … dann zeigt das Tool 60 %“; AK2; `verificationDegree.share` |
| F1 | The filter `verification` holds for an element whose status in the given view is one of the given; a need, or a requirement outside the view, has none. | `filter.schema.json` `verification`; SR-069 |
| F2 | The filter `validation` holds for an element whose shown validation status (A7) is one of the given. | `filter.schema.json` `validation` |

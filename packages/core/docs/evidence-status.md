# Evidence block: status and degree (`src/evidence/`)

Part of the [`@logreq/core` README](../README.md). Lane B of stage 4 fills this file; the records, folders and index are in [evidence-records.md](evidence-records.md).

The verification status (Nachweisstatus) and validation status (Validierungsstatus) are derived views of the records; they never change the `status` of an element (D-030, ADR-0012 "Status rules").

## Verification status

SR-031 (#43), `status.ts`; the rules are ADR-0012 "Status rules".

- `recordStatusOf(records, kind, current, view)`: what the records of one element say in a view, `open`, `passed`, `failed` or `outdated`. Only records of `kind` that hold in the view count (`holdsIn`: in the core a record without variant, in a variant a record for it, SR-047). Of the records of the `current` version the newest (`date` as an instant, an unreadable date the oldest) decide; when several share that newest date and one failed, the result is `failed` (#525 Q2). Records only of other versions are `outdated` (AK4), none is `open` (AK1); with `current` undefined (no version, #276) every record is of another version. One pass, any order. SR-038 uses it with `validation`.
- `verificationStatusOf(records, current, view)`: the same for `verification`, `passed` named `verified` (AK2, AK3).
- `statusSource(metamodel, index)`: the requirement types (meaning `requirement`, own or inherited), the validity property and the records by element; without `index` no element has records (the metamodel is not valid: the versions follow the metamodel, so the records are not compared and every requirement is `open`).
- `verificationState` (`verification.ts`): one memoised workspace state, reset with the metamodel, the element store and the records, that `evidence.status`, `element.get`, `element.resolve` and the filter share, so they give the same status by construction (SR-080 AK2). It holds the source, the variants, the child rules and the evaluator of `indirect.ts`, and the current versions it has read. `prepare(elements, { own })` walks down from `elements` through their counted children (iteratively, each element once for the life of the state), down to the children with an own record in every view they apply in, and reads the versions of those with records it does not know yet in one batch (`currentVersionsOf`); with `own` also those of `elements`. A page or a leaf reads only what it needs, and a repeated `element.get` of the same parent reads nothing (plan review B1, SR-082 AK3); `versionBatches()` counts the batches for tests and measurements. `workspaceStatusOf(source, variants, children, read)` builds it from parts (tests).
- `verificationOf(status, element, shown?)`: the `verification` entries of `data-export.schema.json#/$defs/element`: the core, then each variant in store order, each where the element applies, with `missingChildren` (SR-034); undefined for an element that is no requirement.
- `workspaceStatus(workspace, shown)` gets the state and prepares it for the elements shown (a page, or the one element of `element.get`); `withVerification(status, record, element)` adds the entries to a shown element, its own records measured against the `version` it shows (`Shown`, never kept).

Who shows it:

- `evidence.status`: one page of a selection (`limit`, default 200, and `offset`, as `element.list`), each element as `element.list` gives it (`listElements`, current versions of the page only) with `verification`; `total` and `incomplete` of the whole selection.
- `element.get` and `element.resolve`: the element shown with `verification`, against the version of its file as read (`ShownElement.record`).
- The filter (`query/evidence.ts`, `evidenceStatusState`): the conditions `verification` and `{relation: {direction: evidence}}` (`hasVerificationRecord` in the view of the selection, else the core). Only requirements with records get a current version (`currentVersionsOf`: their files, or the whole store when they are at least a quarter of it), so a workspace without records reads no element file for the filter. The provider is reset with the metamodel, the element store and the records.

Cost at N-036: one pass over the records of each element shown; the filter computes the current versions of the requirements with records once per store (`currentVersionsOf`, the cost #489 measures for `trace.graph`), measured with records in E4. The provider computes them also for a filter that asks only "has evidence", which needs no version (review of #557, N2, noted on #489): E4 measures that path too.

Not yet: `element.create` and `element.update` return their element without `verification` (#554, before the app shows the status, plan §5); the `evidence.outdated` hint of SR-025 AK4 keeps its own rule until spec question #525 Q1 is answered (`hints/evidence.ts`).

## Indirect verification and emergent

SR-034 (#46), `indirect.ts`; the rules are ADR-0012 "Status rules", bullet "Indirect verification".

- `childRulesOf(context)`: the child rules of a trace context: `childrenOf` gives the derivation children of the trace block (`childrenOf`, so one named only by an ambiguous relation is none), `counts` is false for a status the metamodel marks invalid (D-044, AK3). Undefined while the metamodel is not valid or no relation kind has the meaning `derivation`: then no element has children and nothing is indirect, without `metamodel.meaning-unassigned`.
- `verificationEvaluator(source, children, currentOf)`: `(element, view, shown?) => { status, missingChildren? }`, undefined for no requirement or a view the element does not apply in. A requirement with a verification record that holds in the view has its SR-031 status there, against `shown.current` when given, else `currentOf` (#526 Q1, Q4). One without takes it from its counted children (type with the meaning `requirement`, `counts`, `appliesIn` the view, each once; #526 Q2): all `verified` or `indirect` gives `indirect` (AK1), none gives `open` (#526 Q3), else `open` with the UUIDs of the direct children that are `open`, `failed` or `outdated`, in child order, each once (AK2; #526 Q4). The walk is iterative with an explicit stack; an element being computed counts as `open` for its descendants, so an element on a derivation cycle of elements without own record is never indirect, whatever is computed first (#526 Q5). Results from children are kept per view by repository and UUID (twins of one repository share their children, SR-088); results from own records are not kept, so `shown` never leaks into another call.
- `hasOwnRecordIn(source, element, view)`: rule 1, a verification record that holds in the view. Validation records never count (D-007).

What SR-034 does not change: "has evidence" (`hasVerificationRecord`: the filter's „ohne Nachweis“, SR-069 AK3), the coverage's `withEvidence` (SR-036) and the chain's `no-evidence` gap stay "a verification record in the view", so an indirectly verified parent counts as without Nachweis there (assumption, spec question #527). The `evidence.outdated` hint (`hints/evidence.ts`) is unchanged.

Emergent (SR-035) is not read yet: an element flagged emergent can be `indirect` until SR-035 adds its condition to `indirect.ts`.

Cost at N-036: the filter prepares every requirement once per state (one walk over requirements and derivation edges, the versions of all requirements with records in one batch, as SR-031) and evaluates each requirement once per view (memo). `element.get` on the top of a large tree reads, the first time, the versions of the recorded children below it (cold cost), then nothing (warm); E4 measures both.

## Validation status

SR-038.

## Verification degree

SR-037.

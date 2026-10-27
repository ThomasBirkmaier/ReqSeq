# Evidence block: status and degree (`src/evidence/`)

Part of the [`@logreq/core` README](../README.md). Lane B of stage 4 fills this file; the records, folders and index are in [evidence-records.md](evidence-records.md).

The verification status (Nachweisstatus) and validation status (Validierungsstatus) are derived views of the records; they never change the `status` of an element (D-030, ADR-0012 "Status rules").

## Verification status

SR-031 (#43), `status.ts`; the rules are ADR-0012 "Status rules".

- `recordStatusOf(records, kind, current, view)`: what the records of one element say in a view, `open`, `passed`, `failed` or `outdated`. Only records of `kind` that hold in the view count (`holdsIn`: in the core a record without variant, in a variant a record for it, SR-047). Of the records of the `current` version the newest (`date` as an instant, an unreadable date the oldest) decide; when several share that newest date and one failed, the result is `failed` (#525 Q2). Records only of other versions are `outdated` (AK4), none is `open` (AK1); with `current` undefined (no version, #276) every record is of another version. One pass, any order. SR-038 uses it with `validation`.
- `verificationStatusOf(records, current, view)`: the same for `verification`, `passed` named `verified` (AK2, AK3).
- `statusSource(metamodel, index)`: the requirement types (meaning `requirement`, own or inherited), the validity property and the records by element; without `index` no element has records (the metamodel is not valid: the versions follow the metamodel, so the records are not compared and every requirement is `open`).
- `verificationIn(source, element, view, current)`: the status of a requirement in a view it applies in (`appliesIn`, SR-040); undefined for any other element or view. The filter provider (`query/evidence.ts`) asks it.
- `verificationOf(source, variants, element, current)`: the `verification` entries of `data-export.schema.json#/$defs/element`: the core, then each variant in store order, each where the element applies; undefined for an element that is no requirement.
- `workspaceStatus(workspace)` reads the source (`evidenceIndexState` while the metamodel is valid) and the variants once per command; `withVerification(status, record, element)` adds the entries to a shown element, measured against the `version` it shows.

Who shows it:

- `evidence.status`: one page of a selection (`limit`, default 200, and `offset`, as `element.list`), each element as `element.list` gives it (`listElements`, current versions of the page only) with `verification`; `total` and `incomplete` of the whole selection.
- `element.get` and `element.resolve`: the element shown with `verification`, against the version of its file as read (`ShownElement.record`).
- The filter (`query/evidence.ts`, `evidenceStatusState`): the conditions `verification` and `{relation: {direction: evidence}}` (`hasVerificationRecord` in the view of the selection, else the core). Only requirements with records get a current version (`currentVersionsOf`: their files, or the whole store when they are at least a quarter of it), so a workspace without records reads no element file for the filter. The provider is reset with the metamodel, the element store and the records.

Cost at N-036: one pass over the records of each element shown; the filter computes the current versions of the requirements with records once per store (`currentVersionsOf`, the cost #489 measures for `trace.graph`), measured with records in E4. The provider computes them also for a filter that asks only "has evidence", which needs no version (review of #557, N2, noted on #489): E4 measures that path too.

Not yet: `element.create` and `element.update` return their element without `verification` (#554, before the app shows the status, plan §5); the `evidence.outdated` hint of SR-025 AK4 keeps its own rule until spec question #525 Q1 is answered (`hints/evidence.ts`).

## Indirect verification and emergent

SR-034, SR-035.

## Validation status

SR-038.

## Verification degree

SR-037.

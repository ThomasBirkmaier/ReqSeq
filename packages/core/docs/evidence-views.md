# Evidence block: views and export (`src/evidence/`, `src/data/`)

Part of the [`@logreq/core` README](../README.md). Lane C of stage 4 fills this file; the records, folders and index are in [evidence-records.md](evidence-records.md).

"Has evidence" is `hasVerificationRecord` of the index for every view below (#535).

## Coverage

SR-036 (#48), `evidence.coverage` (`commands/evidence/coverage.ts`), block file `evidence/coverage.ts`:

- `coverageRules(graph, index, views)`: what decides the coverage of each element, on one derivation graph (trace block) and the evidence index, for the views of the selection (`Selected.views`: its own view, then the saved filter's).
  - Levels: the element types with the meaning `need` or `requirement` (own or inherited; a subtype is its own level), in metamodel order. Other types have no level. Evidence counts only for requirement types (D-012).
  - Counted: an element whose status the metamodel does not mark invalid (AK4, D-044).
  - Child: a derivation child of `childrenOf` (incoming relations of a kind with the meaning `derivation`, in any repository; one named only by an ambiguous relation is none, SR-088) whose status is not marked invalid and that applies in every view of the selection; without a view every one, as the chain and the matrix narrow.
  - Evidence: `hasVerificationRecord` in the selection's view, the core without one (as the filter condition `verification`); any version and result (spec question #527).
- `coverageOf(elements, rules)`: one `CoverageLevel` per level type with a counted element, with the counts and the UUIDs behind each number in selection order (AK2). The command adds `incomplete`: a repository of the workspace file is not on this machine (the selection's `incomplete`, AK3), or the evidence state is incomplete.
- Cost: one pass over the selection and each element's incoming relations once (N-036); measured with the other stage 4 commands in E4.
- The assumptions of spec question #527 (level = type, needs count for children only, evidence = any verification record in the view) are not decided yet. SR-042 (exclusion for a variant, stage 5) narrows the view's selection there.

## Evidence list and baselines

SR-032.

## Test cases in the chain and the matrix

SR-033, SR-126.

## Data export and store

SR-061, SR-062.

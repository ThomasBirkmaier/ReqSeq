# Graph block (`src/graph/`)

The graph of one element (SR-111) as `trace.graph` gives it, and the words the app's graph shows, in core so that the Mermaid text of SR-151 (#1537) uses the same ones. It sits above `evidence` and `hints`, because the marks and the verification of the nodes come from there.

- `elementGraphOf(workspace, input, command)` (`element.ts`): the output of `trace.graph` for its input without `withEvidence`, the walk, marks and verification as [trace](trace.md) "Graph" describes, with what the evidence summaries are read from; problems and errors name `command`, the command that asks. The evidence summaries are `trace.graph`'s own (`commands/trace/graph.ts`).
- Words (`words.ts`, `@reqseq/core/graph-words`, imports only types and `evidence/degree-text.ts`): `MARK_WORDS`, `statusOf`, `ringOf` and `verificationWords` (SR-136: "verification open 2 of 3", "verification 60 %"), `shownId` (SR-084 AK4), `typeName`, `relationNames`, `propertyNameKey`, `kindName` and `REFERENCE_NAME` (SR-154 AK1). The app imports them.

# @logreq/core

All program logic of LogReq (ADR-0002). CLI, API, MCP server and app are adapters that only call `invoke`.

## Calling a command (adapters)

```ts
import { CommandError, Workspace, invoke } from "@logreq/core";

const workspace = new Workspace(root); // one object per workspace root, kept for the process
try {
  const output = await invoke("element.get", { ref: "SR-46fb54" }, { workspace, signal });
} catch (error) {
  if (error instanceof CommandError) {
    // error.toJSON() is common.schema.json#/$defs/error: { code, message, details? }
  }
}
```

`invoke(name, input, { workspace, signal?, access? })`:

1. Looks up the implementation. A catalog command without implementation gives `command.not-implemented` ("Command X is not implemented yet"), a name outside the catalog `input.invalid` ("Unknown command: X").
2. Copies the input, fills in `default` values from the catalog schema and validates it with Ajv against the entry's `input` schema in `schemas/commands/catalog.json`. `$ref`s like `../common.schema.json#/$defs/uuid` resolve against `schemas/*.schema.json`. A mismatch gives `input.invalid` with `details.errors` (`path`, `keyword`, `message`, `params` per check). `run` is not called.
3. A `write-files` command whose catalog entry has `whileReadOnly: "refuse"` is refused with `workspace.read-only` while the workspace is read-only (`src/metamodel/access.ts`, SR-011 AK3; ADR-0002 rule 5); `details.problems` gives the reasons, and `run` is not called. `whileReadOnly: "allow"` (`workspace.init`, which creates the workspace) runs.
4. Calls `run(ctx, input)` with `ctx = { workspace, signal }`, then gives each problem of the output that names an element (`elementId`) the short ID of that element (`elementShortId`, #315; `runtime/element-short-ids.ts`) and, when it has one, its identifier (`elementIdentifier`, #305). Where an output holds problems follows from its output schema (every reference to `common.schema.json#/$defs/problem`, `problemLocator`), never from the command name, so no command adds the field itself. The short IDs are those the workspace has built, else built in memory from its element store and metamodel when both are built (a check against an invalid metamodel needs no short IDs of its own); nothing is read, and the field is left out when the store or the metamodel is not built or the element is not in the store (ADR-0008). Problems kept in workspace states are not changed: a changed output is a copy.
5. Maps failures: a thrown `CommandError` passes through unchanged; anything else becomes `internal` with the message `Internal error in X`. The original error, and its text, is only in `cause`, never in what adapters send. An abort (the signal fired, or an `AbortError`) is `internal` with `details.aborted: true` (ADR-0009).
6. With output validation on (`LOGREQ_VALIDATE_OUTPUT=1`, always in tests via `vitest.config.ts`, and in debug builds) the output is checked against the entry's `output` schema; a mismatch is `internal`.
7. `access` names the access the call comes through (`cli`, `api`, `mcp`, `app`; each adapter passes its own). After a successful call through the API or the MCP server (`FOLLOWED_ACCESSES`) on a workspace with a cache folder, the element the call names is recorded in the background as the last access of the copy (SR-117, `model/activity.ts`, `docs/model-store.md` "Agent activity"). Recording never changes the output or the error and nothing waits for it.

Findings are never thrown: commands return them as `problems` (`common.schema.json#/$defs/problem`). Adapters map a `CommandError` code with `errorClass(code)` (`input`, `not-found`, `conflict`, `unavailable`, `not-implemented`, `internal`; the table is `COMMAND_ERROR_CLASSES`); how each class becomes an exit code, HTTP status or MCP tool error is ADR-0009.

`cacheFolder(root)` (workspace block, `src/workspace/cache.ts`) is the cache folder of a working copy, `<OS cache>/logreq/<sha256 of the canonical root>` (absolute, symbolic links resolved, lower case on Windows; ADR-0008, SR-081 AK2); `writeCacheFile(folder, name, text)` writes a private file there (mode 0600, through `writePrivateFile` of the files block), e.g. `api.json` of the local API (ADR-0009), `readCacheFile` reads one back (`undefined` when missing) and `removeCacheFile` removes one (through `removePrivateFile`). `lockCacheFile(folder, name)` takes the lock `<name>.lock` next to a cache file (`lockPrivateFile` of the files block, `src/files/lock.ts`: exclusive create, mode 0600, with the process ID and `created`; stale when that process does not run (`processRuns`) or `created` is more than `LOCK_STALE_MS` away from now; one breaker at a time through `<name>.lock.break`) and resolves `undefined` while another process holds it; `release()` removes only its own lock and never rejects.

`jsonChunks(value, { indent: 0 | 2 })` (files block, `src/files/json-text.ts`, #277) gives exactly the text of `JSON.stringify(value, null, indent || undefined)` in chunks of about 1 MB (`JSON_CHUNK_LENGTH`), never one string of the whole, for outputs larger than V8 holds in one string (about 512 MB; `data.export` at N-036). It descends by size: every plain object and array is walked, and a subtree goes to the native `JSON.stringify` once `jsonByteLength(subtree, atMost)` (UTF-8 bytes of the compact JSON, counted with an early stop) says it fits one chunk. It follows `JSON.stringify`'s rules (`toJSON(key)`, left-out values, `TypeError` for BigInt and cycles); a value that gives no text gives no chunk. Adapters write the chunks one by one; `writeFileAtomic` takes them as a function that gives a new iterable per pass.

`findWorkspaceRoot(start)` (workspace block, `src/workspace/root.ts`) returns the nearest folder from `start` upwards that holds `logreq-workspace.yaml` (`WORKSPACE_FILE`), or `undefined`; adapters use it when no workspace is given (ADR-0009). `PRODUCT_NAME` and `PRODUCT_VERSION` come from the root `package.json` (embedded by `pnpm contracts:generate`), so every access reports the same version. `contracts.schemas` are the schemas that `$ref`s of the catalog resolve against; adapters that read input schemas (CLI flags) use them.

Adapters share one runtime per process: `getCommandRuntime()` returns it (created with the defaults on first use) with the catalog (`contracts.commands`, for CLI subcommands, API routes and MCP tools) and the implemented commands (`commands`). `configureCommandRuntime(options)` sets it, e.g. with `validateOutput`: adapters configure before the first call; replacing it later is for tests. `createCommandRuntime({ commands, contracts, validateOutput })` builds a separate one with other implementations or another catalog (`loadContracts({ catalog })`); tests use it for test-only commands.

## Writing a command (SR work)

1. The catalog entry exists in `schemas/commands/catalog.json` (name, `title` for people, summary, effect, for a write command `whileReadOnly` with its reason, stage, implements, `arguments`, input and output schema). `title` is the name the app's command prompt offers and the MCP tool title; `arguments` lists every top-level input field once, the required ones first, with the source a prompt completes it from (`{ field, complete, of? }`, SR-108 AK4; ADR-0002 rule 1, checked by `scripts/contracts/catalog-checks.mjs`). Changing it is a contract change (ADR-0002 rule 1).
2. Write `src/commands/<group>/<action>.ts`:

   ```ts
   import { defineCommand } from "../../catalog.js";

   export default defineCommand({
     name: "element.get",
     run: async (ctx, input) => {
       // input: ElementGetInput, the result must be ElementGetOutput; both come from the catalog.
       const store = ctx.workspace.get(elementStore); // per-workspace state, see below
       // ...
     },
   });
   ```

   The definition has only `name` and `run`. Summary, effect and schemas come from the catalog, so they cannot drift. The name picks the catalog entry, and `input` and the result of `run` get its generated types (`CommandInput<"element.get">`, `CommandOutput<"element.get">`; see "Generated types"), so a command never writes its own interfaces for them. `input` has already passed the schema, with defaults filled in. The compiler reports extra properties in the result only where it checks object literals against a declared type: write the return type (`Promise<CommandOutput<"element.get">>`) to get that; otherwise the output check in tests catches them. Tests with a test-only catalog use `defineTestCommand<In, Out>({ name, run })`, which takes the types instead of a catalog name.
3. Import it in `src/commands/index.ts` and add it to `commands` (sorted by name). Every `.ts` file in a group folder is taken as a command, so helpers belong in the blocks (`src/model/`, `src/metamodel/`, ...), not next to the commands.
4. `src/commands/registry.test.ts` checks that files, the list and the catalog agree: every file is registered under the name of its path, every implementation has a catalog entry, and every catalog command of a completed stage (`COMPLETED_STAGES`) has exactly one implementation. A stage is added to `COMPLETED_STAGES` when it is done, in a PR with green CI before its acceptance is prepared (lead-run skill, "Stage done").
5. Errors: `throw new CommandError("element.not-found", "No element SR-46fb54", { ref })`. Codes are `CommandErrorCode`, the generated union of `common.schema.json#/$defs/error`; a new code goes into the schema (then `pnpm contracts:generate`) and into `COMMAND_ERROR_CLASSES` in the same PR (its `Record<CommandErrorCode, ...>` type does not compile until the code is classified). Problems use `ProblemCode` from `#/$defs/problemCode` the same way.

## Workspace state

All state lives in the `Workspace` object of its root (ADR-0002 rule 7); there are no globals, so two copies of a workspace never share anything (SR-081). A block defines its state at module level and gets it lazily:

```ts
import { defineWorkspaceState } from "../runtime/workspace.js";

// Async state: create returns a Promise; every caller gets the same one, a rejected one is dropped.
export const metamodelState = defineWorkspaceState("metamodel", (ws) => loadMetamodel(ws.root));

export const modelState = defineWorkspaceState("model", async (ws) => buildModel(await ws.get(metamodelState)), {
  dependsOn: [metamodelState], // reset of the metamodel resets the model too
  dispose: async (model) => (await model).stopWatcher(), // on reset and close, only after a successful build
});

await ctx.workspace.get(modelState); // created on first use, then kept
await ctx.workspace.reset(metamodelState); // e.g. after the watcher saw a change: drops metamodel and model
await workspace.close(); // adapters, when the workspace is closed: disposes everything
```

`new Workspace(root, { cacheFolder })` reads nothing; with `cacheFolder` (the CLI passes `cacheFolder(root)`) the element store is loaded through the model cache there (below), without it every load reads all files and nothing is written outside the working tree (the default for tests). State is built when a command first asks for it. `reset` and `close` remove the values at once and then dispose them one by one, dependents first (independent states newest first). They wait for pending async builds and skip builds that rejected, so they never fail with a build's error. Every disposal runs even if one fails; then they reject with an `AggregateError`. A `get` during a reset may build new state while the old one is still being disposed. A rejected async build is dropped without resetting its dependents. After `close`, `get` throws. `peek(key)` gives the current value without building it; `replace(key, from, to)` sets a new value only while the current one is still `from`, resets the dependents and then disposes `from` (the watcher's file-by-file update of the store, SR-007).

## Generated types

`src/generated/types.ts` holds the TypeScript types of all schemas and catalog commands, written by `pnpm contracts:generate` (`scripts/contracts/types.mjs`) and checked by `pnpm contracts:check`; never edit it, never write a type by hand that mirrors a schema (ADR-0003). `@logreq/core` exports all of them.

- File formats: `WorkspaceFile`, `MetamodelFile`, `ElementFile`, `BaselineFile`, `DataExportFile`, ... (root of `schemas/<name>.schema.json`).
- `$defs`: shared ones of `common.schema.json` by their name (`Uuid`, `ShortId`, `ElementRef`, `Version`, `Key`, `Problem`, `ProblemCode`, ...; renamed where a name would shadow a global: `error` is `CommandErrorObject`, `date`/`dateTime` are `IsoDate`/`IsoDateTime`, `selection` is `ElementSelection`), others prefixed with their file (`FilterCondition`, `MetamodelType`, `WorkspaceRepository`, `DataExportElement`).
- Commands: `<Group><Action>Input` and `...Output` (`ElementGetInput`), and `CommandTypes` from name to both. `catalog.ts` builds on it: `CommandName`, `CommandInput<N>`, `CommandOutput<N>`, `CatalogCommand<N>`, `CommandErrorCode`, `CatalogEntry` (`runtime/contracts.ts`, from `catalog.meta.schema.json`).
- An input type is what `run` gets: a property with a `default` is required (`ElementListInput.limit` is `number`), because the input validator fills it in, also through `$ref` and `allOf`. A referenced `$defs` entry that reaches a default is used in inputs as `<Name>WithDefaults` (`FilterSortKeyWithDefaults`, `order` required); the plain type stays for outputs and files. Below `anyOf`/`oneOf` (and in `if`/`then`/`else`) the type keeps such properties optional; Ajv may still fill them, which optional covers.
- Formats, patterns and lengths are not types: a `Uuid` is a `string`. Values come from validated input or from the command itself; the output check in tests catches the rest.

## Blocks

One file per block, so you read only the area you work on. Update the file of the block you change.

- [Workspace block (`src/workspace/`)](docs/workspace.md)
- [Metamodel block (`src/metamodel/`)](docs/metamodel.md)
- Model block (`src/model/`): [store, watcher, short IDs, current versions](docs/model-store.md), [value kinds, required properties, statuses, metamodel changes](docs/model-checks.md), [writing, reading, status, bulk update, supersede, relations](docs/model-write.md), [superseded targets, duplicates, relation targets and types](docs/model-findings.md)
- [Checking the whole workspace (`workspace.check`, SR-019)](docs/workspace-check.md)
- [Variants block (`src/variants/`)](docs/variants.md)
- [Trace block (`src/trace/`)](docs/trace.md)
- [Query block (`src/query/`)](docs/query.md)
- [Hints block (`src/hints/`)](docs/hints.md)
- Evidence block (`src/evidence/`): [records, folders, state, index](docs/evidence-records.md), [status and degree](docs/evidence-status.md), [views and export](docs/evidence-views.md)
- [Baselines block (`src/baselines/`): reading baseline files](docs/baselines.md)
- [Git reader (`src/git/reader.ts`)](docs/git.md)
- [Version date (`src/model/version-date.ts`)](docs/version-date.md)

## Schemas at runtime

`loadContracts()` uses `src/generated/contracts.json`: all `schemas/*.schema.json`, the catalog meta schema and the catalog in one JSON module, written by `pnpm contracts:generate` and checked by `pnpm contracts:check`. So the package needs no `schemas/` folder at run time (ADR-0014) and works from `src/` without a build. After changing a schema or the catalog, run `pnpm contracts:generate`. Validation uses the Ajv options of `scripts/contracts/load.mjs` plus ajv-formats.

## Tests

Tests that need a workspace on disk use `createFixtureWorkspace` from `@logreq/testkit` (files, fixture cases, Git repositories with deterministic commits); see `fixtures/README.md`. Only `testkit` spawns `git` for tests; in `core` only the `git` module may spawn processes and only `files` writes to disk.

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

`invoke(name, input, { workspace, signal? })`:

1. Looks up the implementation. A catalog command without implementation gives `input.invalid` ("Command X is not implemented yet"), a name outside the catalog `input.invalid` ("Unknown command: X").
2. Copies the input, fills in `default` values from the catalog schema and validates it with Ajv against the entry's `input` schema in `schemas/commands/catalog.json`. `$ref`s like `../common.schema.json#/$defs/uuid` resolve against `schemas/*.schema.json`. A mismatch gives `input.invalid` with `details.errors` (`path`, `keyword`, `message`, `params` per check). `run` is not called.
3. Calls `run(ctx, input)` with `ctx = { workspace, signal }`.
4. Maps failures: a thrown `CommandError` passes through unchanged; anything else becomes `internal` with the message `Internal error in X`. The original error, and its text, is only in `cause`, never in what adapters send. An abort (the signal fired, or an `AbortError`) is `internal` with `details.aborted: true` (ADR-0009).
5. With output validation on (`LOGREQ_VALIDATE_OUTPUT=1`, always in tests via `vitest.config.ts`, and in debug builds) the output is checked against the entry's `output` schema; a mismatch is `internal`.

Findings are never thrown: commands return them as `problems` (`common.schema.json#/$defs/problem`). How each adapter turns a `CommandError` code into an exit code, HTTP status or MCP tool error is ADR-0009.

Adapters share one runtime per process: `getCommandRuntime()` returns it (created with the defaults on first use) with the catalog (`contracts.commands`, for CLI subcommands, API routes and MCP tools) and the implemented commands (`commands`). `configureCommandRuntime(options)` sets it, e.g. with `validateOutput`: adapters configure before the first call; replacing it later is for tests. `createCommandRuntime({ commands, contracts, validateOutput })` builds a separate one with other implementations or another catalog (`loadContracts({ catalog })`); tests use it for test-only commands.

## Writing a command (SR work)

1. The catalog entry exists in `schemas/commands/catalog.json` (name, effect, stage, implements, input and output schema). Changing it is a contract change (ADR-0002 rule 1).
2. Write `src/commands/<group>/<action>.ts`:

   ```ts
   import { defineCommand } from "../../catalog.js";

   export default defineCommand({
     name: "element.get",
     run: async (ctx, input: ElementGetInput): Promise<ElementGetOutput> => {
       const store = ctx.workspace.get(elementStore); // per-workspace state, see below
       // ...
     },
   });
   ```

   The definition has only `name` and `run`. Summary, effect and schemas come from the catalog, so they cannot drift. `input` has already passed the schema, with defaults filled in.
3. Import it in `src/commands/index.ts` and add it to `commands` (sorted by name). Every `.ts` file in a group folder is taken as a command, so helpers belong in the blocks (`src/model/`, `src/metamodel/`, ...), not next to the commands.
4. `src/commands/registry.test.ts` checks that files, the list and the catalog agree: every file is registered under the name of its path, every implementation has a catalog entry, and every catalog command of a completed stage (`COMPLETED_STAGES`) has exactly one implementation. A stage is added to `COMPLETED_STAGES` when it is done, in a PR with green CI before its acceptance is prepared (stage-run skill, step 7).
5. Errors: `throw new CommandError("element.not-found", "No element SR-46fb54", { ref })`. Codes are `COMMAND_ERROR_CODES`, the list of `common.schema.json#/$defs/error`; a new code goes into the schema and the list in the same PR (a test compares them).

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

`new Workspace(root)` reads nothing; state is built when a command first asks for it. `reset` and `close` remove the values at once and then dispose them one by one, dependents first (independent states newest first). They wait for pending async builds and skip builds that rejected, so they never fail with a build's error. Every disposal runs even if one fails; then they reject with an `AggregateError`. A `get` during a reset may build new state while the old one is still being disposed. A rejected async build is dropped without resetting its dependents. After `close`, `get` throws.

## Schemas at runtime

`loadContracts()` uses `src/generated/contracts.json`: all `schemas/*.schema.json`, the catalog meta schema and the catalog in one JSON module, written by `pnpm contracts:generate` and checked by `pnpm contracts:check`. So the package needs no `schemas/` folder at run time (ADR-0014) and works from `src/` without a build. After changing a schema or the catalog, run `pnpm contracts:generate`. Validation uses the Ajv options of `scripts/contracts/load.mjs` plus ajv-formats.

## Tests

Tests that need a workspace on disk use `createFixtureWorkspace` from `@logreq/testkit` (files, fixture cases, Git repositories with deterministic commits); see `fixtures/README.md`. Only `testkit` spawns `git` for tests; in `core` only the `git` module may spawn processes and only `files` writes to disk.

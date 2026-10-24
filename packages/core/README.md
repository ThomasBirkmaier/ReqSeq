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
3. A `write-files` command (except `workspace.init`, which creates the workspace) is refused with `workspace.read-only` while the workspace is read-only (`src/metamodel/access.ts`, SR-011 AK3); `details.problems` gives the reasons. The exemption is an interim list in `runtime/invoke.ts` until the catalog entry carries it (#142). `run` is not called.
4. Calls `run(ctx, input)` with `ctx = { workspace, signal }`.
5. Maps failures: a thrown `CommandError` passes through unchanged; anything else becomes `internal` with the message `Internal error in X`. The original error, and its text, is only in `cause`, never in what adapters send. An abort (the signal fired, or an `AbortError`) is `internal` with `details.aborted: true` (ADR-0009).
6. With output validation on (`LOGREQ_VALIDATE_OUTPUT=1`, always in tests via `vitest.config.ts`, and in debug builds) the output is checked against the entry's `output` schema; a mismatch is `internal`.

Findings are never thrown: commands return them as `problems` (`common.schema.json#/$defs/problem`). Adapters map a `CommandError` code with `errorClass(code)` (`input`, `not-found`, `conflict`, `unavailable`, `internal`; the table is `COMMAND_ERROR_CLASSES`); how each class becomes an exit code, HTTP status or MCP tool error is ADR-0009.

`findWorkspaceRoot(start)` (workspace block, `src/workspace/root.ts`) returns the nearest folder from `start` upwards that holds `logreq-workspace.yaml` (`WORKSPACE_FILE`), or `undefined`; adapters use it when no workspace is given (ADR-0009). `PRODUCT_NAME` and `PRODUCT_VERSION` come from the root `package.json` (embedded by `pnpm contracts:generate`), so every access reports the same version. `contracts.schemas` are the schemas that `$ref`s of the catalog resolve against; adapters that read input schemas (CLI flags) use them.

Adapters share one runtime per process: `getCommandRuntime()` returns it (created with the defaults on first use) with the catalog (`contracts.commands`, for CLI subcommands, API routes and MCP tools) and the implemented commands (`commands`). `configureCommandRuntime(options)` sets it, e.g. with `validateOutput`: adapters configure before the first call; replacing it later is for tests. `createCommandRuntime({ commands, contracts, validateOutput })` builds a separate one with other implementations or another catalog (`loadContracts({ catalog })`); tests use it for test-only commands.

## Writing a command (SR work)

1. The catalog entry exists in `schemas/commands/catalog.json` (name, effect, stage, implements, input and output schema). Changing it is a contract change (ADR-0002 rule 1).
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
4. `src/commands/registry.test.ts` checks that files, the list and the catalog agree: every file is registered under the name of its path, every implementation has a catalog entry, and every catalog command of a completed stage (`COMPLETED_STAGES`) has exactly one implementation. A stage is added to `COMPLETED_STAGES` when it is done, in a PR with green CI before its acceptance is prepared (stage-run skill, step 7).
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

`new Workspace(root)` reads nothing; state is built when a command first asks for it. `reset` and `close` remove the values at once and then dispose them one by one, dependents first (independent states newest first). They wait for pending async builds and skip builds that rejected, so they never fail with a build's error. Every disposal runs even if one fails; then they reject with an `AggregateError`. A `get` during a reset may build new state while the old one is still being disposed. A rejected async build is dropped without resetting its dependents. After `close`, `get` throws.

## Generated types

`src/generated/types.ts` holds the TypeScript types of all schemas and catalog commands, written by `pnpm contracts:generate` (`scripts/contracts/types.mjs`) and checked by `pnpm contracts:check`; never edit it, never write a type by hand that mirrors a schema (ADR-0003). `@logreq/core` exports all of them.

- File formats: `WorkspaceFile`, `MetamodelFile`, `ElementFile`, `BaselineFile`, `DataExportFile`, ... (root of `schemas/<name>.schema.json`).
- `$defs`: shared ones of `common.schema.json` by their name (`Uuid`, `ShortId`, `ElementRef`, `Version`, `Key`, `Problem`, `ProblemCode`, ...; renamed where a name would shadow a global: `error` is `CommandErrorObject`, `date`/`dateTime` are `IsoDate`/`IsoDateTime`, `selection` is `ElementSelection`), others prefixed with their file (`FilterCondition`, `MetamodelType`, `WorkspaceRepository`, `DataExportElement`).
- Commands: `<Group><Action>Input` and `...Output` (`ElementGetInput`), and `CommandTypes` from name to both. `catalog.ts` builds on it: `CommandName`, `CommandInput<N>`, `CommandOutput<N>`, `CatalogCommand<N>`, `CommandErrorCode`, `CatalogEntry` (`runtime/contracts.ts`, from `catalog.meta.schema.json`).
- An input type is what `run` gets: a property with a `default` is required (`ElementListInput.limit` is `number`), because the input validator fills it in, also through `$ref` and `allOf`. A referenced `$defs` entry that reaches a default is used in inputs as `<Name>WithDefaults` (`FilterSortKeyWithDefaults`, `order` required); the plain type stays for outputs and files. Below `anyOf`/`oneOf` (and in `if`/`then`/`else`) the type keeps such properties optional; Ajv may still fill them, which optional covers.
- Formats, patterns and lengths are not types: a `Uuid` is a `string`. Values come from validated input or from the command itself; the output check in tests catches the rest.

## Workspace block (`src/workspace/`)

`workspaceLayoutState` (async Workspace state) reads `logreq-workspace.yaml` in `Workspace.root` (checked against `workspace.schema.json`) and the optional, untracked `.logreq/local.yaml` (`workspace-local.schema.json`), and locates every repository (SR-004):

- Path: the local override, else `path` of the workspace file, else `../<name>`. The main repository (the entry with `main: true`; the only entry of a one-repository workspace) is always the root, `.`. Relative paths are relative to the root. Committed paths use `/` (a `\` is warned about and replaced); an absolute committed path is warned about and ignored, absolute paths belong in `.logreq/local.yaml`. There is no `~` expansion.
- `available` means the folder exists; `folder` is then its real path. A missing repository is normal (N-041): `available: false` and an `info` problem `workspace.repository-missing`; nothing else changes (SR-004 AK3).
- A repository in the same folder as another one is left out (`workspace.invalid` error; the main repository always stays). `excludes` lists the folders of other available repositories nested inside a repository (e.g. submodules); discovery skips them.
- `availableRepositories(layout)` gives the roots in which elements are discovered (SR-003). `locate(layout, location)` resolves a `{ repository, path }` location; `settingLocation(layout, "baselines" | "filters" | "mappings")` gives the configured location or the default in the main repository.
- `layout.metamodel` names the metamodel folder and whether it exists (`metamodel.invalid` error with the reason otherwise); loading it is the metamodel block (SR-011, below). `layout.file` is the checked workspace file for later blocks (evidence, ignore).
- No workspace file: `CommandError workspace.not-found`. A faulty one (YAML, schema, a repository name listed twice): `file.faulty` with `details.problems`; it is never used in part. A location naming an unknown repository and a faulty local file are problems; the workspace still opens.
- The layout, including availability, is kept until `workspace.reset(workspaceLayoutState)` (the watcher, SR-007). Finding the workspace root upwards from a folder is the CLI's job.

## Metamodel block (`src/metamodel/`)

`metamodelState` (async Workspace state, depends on `workspaceLayoutState`) reads the metamodel of the checked-out state (SR-011, D-021) with `loadMetamodel(layout)`:

- Every `*.yaml` file directly in the folder that `layout.metamodel` names, from the working tree, sorted by name (code-unit order). Subfolders and hidden files (`.` first) are not read; a `*.yml` file gives a `metamodel.invalid` warning. Nothing else is read: no built-in model, no other folder, nothing from Git. When the folder is the root of the main repository (`path: .`), `logreq-workspace.yaml` is not a metamodel file, but every other `.yaml` file there is, including unrelated ones; give the metamodel its own folder.
- Each file is read with `readYamlFile` and checked against `metamodel.schema.json`. `types`, `properties`, `relations` and `statuses` of all valid files are merged in file order, as written (meanings are SR-013). A key defined a second time in the same list is a `metamodel.invalid` error on its line; the first definition is kept. Problems come in file order, and within a file in line order.
- Faulty YAML is the problem of the files block (`file.invalid-yaml` with file, line and reason); a schema violation is `metamodel.invalid` with file and line. A faulty file contributes nothing; the valid files are still used (open question #141). `file` is relative to the metamodel repository; a problem of the whole folder names the folder (`.` for the repository root).
- `valid` is false when the folder is missing (the layout reports that), unreadable or has no `.yaml` file, or any file has an error. The workspace is then read-only (`workspaceAccess`, `assertWritable` in `src/metamodel/access.ts`): reads work, write commands are refused by `invoke` (SR-011 AK3; a missing metamodel repository counts too, open question #141). `workspace.status` shows `metamodel.valid`, `readOnly` and the problems.
- Kept until `workspace.reset(metamodelState)` (the watcher, SR-007, SR-015) or a reset of the layout; a new `Workspace` reads it again. Nothing is cached elsewhere, so after a checkout the tool works with the metamodel of the checked-out state (SR-011 AK2).
- The definitions have the generated types of `metamodel.schema.json` (`MetamodelFile`, `MetamodelType`, `MetamodelProperty`, `MetamodelRelationKind`, `MetamodelStatus`).
- Inheritance (SR-012, `src/metamodel/inheritance.ts`): after merging, `effectiveTypes` holds every type of `types` (same order) as an `EffectiveType`: `ancestors` (parent first, up to the root), `properties` and `required` with all own and inherited keys, each once, root type first (the key order for new keys in element files, ADR-0004); required keys count as properties. `meaning` is the own one, else the closest ancestor's; `abstract` is not inherited (default false). A parent that is not defined, every type on an inheritance cycle (also across files, `a -> b -> a`) and a type naming a property that is not defined are `metamodel.invalid` errors at the line of `extends` or of the list item; they come after the problems of the files, in type order, and make the metamodel invalid. Resolution stops at an unknown parent or a cycle, so a read-only workspace still has effective types.
- Lookup (`src/metamodel/lookup.ts`): element files hold the type key, the tool shows its `name` (D-043). `findType(metamodel, key)` finds a type only by key (an index per metamodel object). `typeForNewElement(metamodel, key)` is the type `element.create` uses: it throws `input.invalid` with `details.type` and `details.reason` (`unknown` or `abstract`) when no element of that type can be created.

## Git reader (`src/git/reader.ts`)

The only module that spawns processes (ADR-0006). It exports only typed functions; each runs one fixed command line (now `rev-parse --show-toplevel --verify HEAD`; add commands from ADR-0006's list as SRs need them), so no other subcommand or argument can be passed. Every call runs with `--no-pager -c core.fsmonitor=false`, `GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0`, without inherited repository variables (`GIT_DIR`, ...) and with a 10 s time limit. `headCommit(folder)` gives `{ known: true, commit }` for the top level of a repository, else `{ known: false, reason }` with `no-git`, `refused` (`safe.directory`), `timeout` or `not-a-repository`. `workspace.status` reports `refused` as an `info` problem `git.unavailable`.

## Schemas at runtime

`loadContracts()` uses `src/generated/contracts.json`: all `schemas/*.schema.json`, the catalog meta schema and the catalog in one JSON module, written by `pnpm contracts:generate` and checked by `pnpm contracts:check`. So the package needs no `schemas/` folder at run time (ADR-0014) and works from `src/` without a build. After changing a schema or the catalog, run `pnpm contracts:generate`. Validation uses the Ajv options of `scripts/contracts/load.mjs` plus ajv-formats.

## Tests

Tests that need a workspace on disk use `createFixtureWorkspace` from `@logreq/testkit` (files, fixture cases, Git repositories with deterministic commits); see `fixtures/README.md`. Only `testkit` spawns `git` for tests; in `core` only the `git` module may spawn processes and only `files` writes to disk.

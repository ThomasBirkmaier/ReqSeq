# ADR-0002: Command catalog as the only program logic

Status: Proposed · Based on: D-025, D-029, D-045, D-052 · SRs: SR-080, SR-072, SR-017, SR-081

## Context

Every function must be available through app, CLI, API and MCP with the same result (D-029, SR-080). "The app has no logic of its own" (D-029). If four adapters each call the core differently, they drift.

## Decision

1. **One catalog.** `schemas/commands/catalog.json` lists every command: `name` (`group.action`), `summary`, `effect` (`read` or `write-files`), `stage` (D-035), `implements` (SR IDs), JSON Schema for `input` and `output`. It is the contract; a change is its own PR, announced to Thomas in the stage epic (D-051).
2. **One implementation per command** in `packages/core/src/commands/<group>/<action>.ts`, registered with `defineCommand` (`packages/core/src/catalog.ts`). The definition holds only the catalog name and `run`; summary, effect and the input and output schemas are taken from the catalog entry, so they match by construction. A test (`packages/core/src/commands/registry.test.ts`) checks that every implementation has a catalog entry and is registered under the name of its file, and that every catalog entry of a completed stage (`COMPLETED_STAGES`, set when the stage is done) has exactly one implementation (entries of stages in progress arrive one SR at a time).
3. **Adapters are generic.** They know nothing about individual commands:
   - CLI: `logreq <group> <action>` with flags derived from the input schema, `--input <json|@file>`, `--json` for machine output.
   - API: `POST /v1/commands/<name>` with the input as body (generated `schemas/generated/openapi.json`).
   - MCP: one tool per command, `group_action` (generated `schemas/generated/mcp-tools.json`).
   - App: the renderer calls `invoke(name, input)` over IPC (ADR-0010). Pure display (layout, selection, editor state) is the only thing outside the catalog (SR-080 AK1).
4. **Calling convention.** `run(ctx, input)` gets a `CommandContext` (the `Workspace` object of rule 7, abort signal) and input validated against the catalog with defaults applied; adapters call `invoke(name, input, { workspace })`, which validates and maps every failure to `CommandError` (`packages/core/README.md`); output is validated in tests and in debug builds. Findings and hints are returned as `problems` data, not thrown. Real errors throw `CommandError` with a code from `common.schema.json#/$defs/error`. Each adapter maps codes the same way (CLI exit code and stderr, HTTP status and body, MCP tool error).
5. **Effects.** `read` commands never write. `write-files` commands write only LogReq files in the working tree, and return the list of written files. No command writes Git (D-036, ADR-0006). No command deletes elements (D-045); `scripts/contracts/validate-schemas.mjs` rejects command names with delete/remove except for relations. While a workspace is read-only (a missing or faulty metamodel, SR-011 AK3), `invoke` refuses every `write-files` command with `workspace.read-only` before `run`. Whether a write command may run while the workspace is read-only is part of its catalog entry, not of the runtime. Until the catalog has that field (#142), `workspace.init`, which creates a workspace, is the only exemption, and it is listed in `runtime/invoke.ts`.
6. **Status.** Only `element.setStatus` and `element.supersede` change a status (SR-017 AK2); `element.create` always uses the initial status, and `element.update`/`element.bulkUpdate` reject `id`, `type` and `status`. A test runs every other write command and asserts that no status changed. Both commands are offered on every access like any function (SR-080): "the tool never sets a status itself" (D-030) means no command changes a status as a side effect or by computation. Who may call them, a person directly or an agent acting for a person, is decided outside LogReq (D-029: the tool does not control agents), and the change is reviewed in the merge request (D-024).
7. **One workspace per process state.** All state lives in a `Workspace` object created per workspace root; no globals, no shared cache between copies (SR-081).
8. **Cross-access test.** For each command, one scenario runs through core, CLI, API and MCP and compares the outputs (SR-080 AK2). New commands are added to it automatically from the catalog.

## Consequences

- SR-080 holds by construction; adding a function means adding a catalog entry and one implementation.
- The catalog is long-lived API; removing or changing an input field is a breaking change and needs a new ADR.
- Command names are English (D-019).

## Rejected

- Hand-written REST routes, CLI commands and MCP tools: four places to keep in sync.
- Zod or TypeBox as the source of the schemas: the catalog must be readable and reviewable without TypeScript, and the file formats are JSON Schema anyway (ADR-0003).

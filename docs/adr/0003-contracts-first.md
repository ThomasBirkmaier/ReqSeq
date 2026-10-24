# ADR-0003: JSON Schema files are the contracts

Status: Proposed · Based on: D-026, D-056, D-052 · SRs: SR-009, SR-010, SR-061

## Context

All file formats must be documented publicly so that other tools can read and write them without LogReq (N-070, SR-009). Agents need fixed interfaces before they build in parallel (D-052).

## Decision

- **JSON Schema 2020-12** files in `schemas/` are the single source for every file format and every command input and output:
  `element`, `metamodel`, `workspace`, `baseline`, `filter`, `evidence-record`, `reqif-mapping`, `data-export`, shared `common`, and `commands/catalog.json`.
- Each schema has `$id` `https://logreq.dev/schemas/<file>` (an identifier, never fetched; LogReq opens no network connections).
- `schemas/examples/<format>/` holds at least one example per format. `pnpm schemas:check` compiles all schemas with Ajv in strict mode and validates every example (SR-009 AK2, AK3). The format documentation shipped with the product (SR-009 AK1) is generated from these schemas and examples in stage 1.
- `schemas/generated/` (OpenAPI 3.1, MCP tool list), `packages/core/src/generated/contracts.json` (all schemas and the catalog for runtime validation in `core`), `packages/core/src/generated/standard-model.json` (the text of `schemas/examples/metamodel/standard-model.yaml`, the standard model that `workspace.init` writes, SR-014) and `packages/core/src/generated/types.ts` (TypeScript types) are derived by `pnpm contracts:generate`; `pnpm contracts:check` (CI) fails if they are stale. Never edit them by hand.
- TypeScript types are generated from the schemas, never written by hand. `types.ts` has one type per file format (`WorkspaceFile`, `MetamodelFile`, ...) and per `$defs` entry (`common` ones as they are named, `Uuid`, `Problem`, `ProblemCode`; others after their file, `FilterCondition`; `error` is `CommandErrorObject`), `<Name>Input` and `<Name>Output` per catalog command (`ElementGetInput`), and `CommandTypes`, the map from command name to both, which `defineCommand` uses. An input type is what `run` gets: a property with a `default` is required, because the input validator (Ajv `useDefaults`) fills it in, also through `$ref` and `allOf` (a referenced definition with defaults is used as `<Name>WithDefaults` in inputs); below `anyOf`/`oneOf` (and in `if`/`then`/`else`) the type keeps such properties optional; Ajv may still fill them, which optional covers. Runtime validation in `core` uses Ajv with the same files.
- The generator is our own, small and dependency-free (`scripts/contracts/types.mjs`). It covers the JSON Schema subset our schemas use and fails on any other keyword, so a new keyword is a conscious change and never a silently wrong type. It prints unions the way the type checker sees them (`"core" | ElementRef` where ElementRef is a string is `string`), so the output passes the strict lint rules without exceptions. It is linted and type-checked like product code (it is excluded only from Prettier, like everything in `generated/`).
- Every YAML file starts with a format key and version, e.g. `logreq-baseline: 1`, so a reader can tell the format and future versions can be migrated.
- YAML is read as YAML 1.2 core schema (no `yes`→true surprises).

## Consequences

- Changing a format is a PR touching `schemas/` (plus an ADR when the change is not backward compatible), which is easy to review.
- Readers in other languages (Python, Grafana, DuckDB) can validate with any JSON Schema library.

## Rejected

- Types first (TypeScript or Zod) with generated schemas: the public, language-neutral document would be a by-product.
- `json-schema-to-typescript` (first choice of this ADR): a further dev dependency tree (ADR-0015), output that needs title-based naming and post-processing to pass `strictTypeChecked` (duplicate and redundant union members, `{}` for empty objects, `interface` vs `type`), and no notion of input with defaults applied. Our schemas use a small subset; a tested script covers it (#134).

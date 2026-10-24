# ADR-0003: JSON Schema files are the contracts

Status: Proposed · Based on: D-026, D-056, D-052 · SRs: SR-009, SR-010, SR-061

## Context

All file formats must be documented publicly so that other tools can read and write them without LogReq (N-070, SR-009). Agents need fixed interfaces before they build in parallel (D-052).

## Decision

- **JSON Schema 2020-12** files in `schemas/` are the single source for every file format and every command input and output:
  `element`, `metamodel`, `workspace`, `baseline`, `filter`, `evidence-record`, `reqif-mapping`, `data-export`, shared `common`, and `commands/catalog.json`.
- Each schema has `$id` `https://logreq.dev/schemas/<file>` (an identifier, never fetched; LogReq opens no network connections).
- `schemas/examples/<format>/` holds at least one example per format. `pnpm schemas:check` compiles all schemas with Ajv in strict mode and validates every example (SR-009 AK2, AK3). The format documentation shipped with the product (SR-009 AK1) is generated from these schemas and examples in stage 1.
- `schemas/generated/` (OpenAPI 3.1, MCP tool list) is derived by `pnpm contracts:generate`; CI fails if it is stale.
- TypeScript types are generated from the schemas in stage 1 (`json-schema-to-typescript`), never written by hand. Runtime validation in `core` uses Ajv with the same files.
- Every YAML file starts with a format key and version, e.g. `logreq-baseline: 1`, so a reader can tell the format and future versions can be migrated.
- YAML is read as YAML 1.2 core schema (no `yes`→true surprises).

## Consequences

- Changing a format is a PR touching `schemas/` (plus an ADR when the change is not backward compatible), which is easy to review.
- Readers in other languages (Python, Grafana, DuckDB) can validate with any JSON Schema library.

## Rejected

- Types first (TypeScript or Zod) with generated schemas: the public, language-neutral document would be a by-product.

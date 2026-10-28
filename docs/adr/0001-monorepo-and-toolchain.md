# ADR-0001: Monorepo with pnpm, TypeScript and Node 22

Status: Proposed · Based on: D-004, D-046, D-048

## Context

D-004 fixes TypeScript and Electron. D-046 asks for one repository with separate packages for program logic, CLI, API, MCP server and app. Several agents work in parallel (D-048, N-062); they need fast, reproducible installs and builds in cloud containers and on three CI platforms.

## Decision

- **pnpm workspaces**, version pinned in `package.json#packageManager`. Packages under `packages/`:
  - `core`: program logic and the command catalog (ADR-0002). No runtime dependency on any other package; its tests use `testkit` as a dev dependency.
  - `cli`, `api`, `mcp`: thin adapters over `core` (ADR-0009).
  - `app`: Electron app (ADR-0010).
  - `testkit` (stage 1): fixture builders (`createFixtureWorkspace`), later the data generator for N-036. Test tooling, never shipped. No other packages without a new ADR.
- Dependency direction: `cli`, `api`, `mcp`, `app` → `core`. Adapters never import each other, never import `core` internals (ESLint rule).
- **TypeScript 6.0**, `strict` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`; ESM only (`"type": "module"`, `NodeNext`). Project references; `pnpm typecheck` runs `tsc -b`. TypeScript 7 (native compiler) is not used yet because `typescript-eslint` supports only `<6.1`; revisit when it does.
- **Node 22 LTS** (`.nvmrc`). Electron's bundled Node must be the same major or newer.
- Lint **ESLint** (flat config, `typescript-eslint` strictTypeChecked, see ADR-0016), format **Prettier**, `--max-warnings 0`.
- Exact versions in `package.json` (no ranges) and a committed `pnpm-lock.yaml`; CI installs with `--frozen-lockfile`. Exception: `toolchain/packaging/` (electron-builder) has its own lockfile outside the workspace, installed only by the release workflow, so that pull requests never install it (ADR-0014).

## Consequences

- One install and one lockfile for all packages; agents can change several packages in one PR when an SR needs it.
- Build order follows project references; `core` builds first.
- Upgrading TypeScript is a deliberate PR.

## Rejected

- Separate repositories per package: more coordination, no gain for one product.
- npm or Yarn workspaces: slower installs, weaker strictness about undeclared dependencies.
- Bun or Deno: Electron runs Node; one runtime everywhere is simpler.

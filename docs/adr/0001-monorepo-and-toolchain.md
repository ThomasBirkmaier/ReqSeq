# ADR-0001: Monorepo with pnpm, TypeScript and Node 22

Status: Accepted · Based on: D-004 (superseded by D-083: TypeScript stays, Electron goes; ADR-0020) · Changed by [ADR-0020](0020-web-ui.md) and [ADR-0021](0021-desktop-shell.md): the package `app` and Electron are gone (#2310); `web` holds the pages of the web UI and `shell` the desktop shell

## Context

D-004 fixes TypeScript and Electron. ReqSeq is built in one repository with separate packages for program logic, CLI, API, MCP server and app. Several agents work in parallel (N-062); they need fast, reproducible installs and builds in cloud containers and on three CI platforms.

## Decision

- **pnpm workspaces**, version pinned in `package.json#packageManager`. Packages under `packages/`:
  - `core`: program logic and the command catalog (ADR-0002). No runtime dependency on any other package; its tests use `testkit` as a dev dependency.
  - `cli`, `api`, `mcp`: thin adapters over `core` (ADR-0009).
  - `web`: the pages of the web UI (ADR-0020). It replaces the Electron app `app` (ADR-0010), which #2310 removed.
  - `shell`: the desktop shell, a Cargo workspace with its e2e tests (ADR-0021).
  - `testkit` (stage 1): fixture builders (`createFixtureWorkspace`), later the data generator for N-036. Test tooling, never shipped. No other packages without a new ADR.
- Dependency direction: `cli`, `api`, `mcp`, `web` → `core` (`web` only through the generated command types and core's browser-safe subpaths, ADR-0020; `shell` imports no package). Adapters never import each other, never import `core` internals (ESLint rule).
- **TypeScript 6.0**, `strict` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`; ESM only (`"type": "module"`, `NodeNext`). Project references; `pnpm typecheck` runs `tsc -b`. TypeScript 7 (native compiler) is not used yet because `typescript-eslint` supports only `<6.1`; revisit when it does.
- **Node 22 LTS** (`.nvmrc`). The delivery ships its own Node binary (ADR-0020).
- Lint **ESLint** (flat config, `typescript-eslint` strictTypeChecked, see ADR-0016), format **Prettier**, `--max-warnings 0`.
- Exact versions in `package.json` (no ranges) and a committed `pnpm-lock.yaml`; CI installs with `--frozen-lockfile`.

## Consequences

- One install and one lockfile for all packages; agents can change several packages in one PR when an SR needs it.
- Build order follows project references; `core` builds first.
- Upgrading TypeScript is a deliberate PR.

## Rejected

- Separate repositories per package: more coordination, no gain for one product.
- npm or Yarn workspaces: slower installs, weaker strictness about undeclared dependencies.
- Bun or Deno: Electron ran Node when this was decided, and the delivery ships Node (ADR-0020); one runtime everywhere is simpler.

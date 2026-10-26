# ADR-0015: Dependency policy

Status: Proposed · Based on: N-046, N-047, D-051

## Decision

- Allowed licenses for runtime dependencies: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, CC0-1.0, Unlicense, Python-2.0 and MPL-2.0 (file-level copyleft, unmodified). Anything else needs the product owner's answer first (label `needs-human` on the issue). Checked by `pnpm licenses:check` in CI.
- No dependency that phones home, collects telemetry or downloads at runtime (N-047). Native modules only when there is no pure alternative, because each needs a build per Electron version.
- `pnpm audit --prod --audit-level high` in CI; findings block the PR.
- Every new runtime dependency is named in the PR body with license and reason.

Pinned now (stage 0, dev only): TypeScript, typescript-eslint, ESLint, Prettier, Vitest, Ajv, ajv-formats, yaml, @types/node. Runtime dependencies of `core` pinned since: `yaml`, `ajv`, `ajv-formats`, `minisearch` 7.2.0 (#323: MIT, no dependencies, no network access, no install scripts; LogReq never calls its vacuum, so it starts no timers, ADR-0008). `search-scoring.ts` reads protected members; an upgrade needs `search-scoring.test.ts` green and a review of `search`/`executeQuerySpec`/`termResults`. Planned with their stage: `micromark` family (stage 1–3), `commander`, `@modelcontextprotocol/server` (stage 1; the v2 package of the official MCP SDK, instead of the v1 `@modelcontextprotocol/sdk`, ADR-0009), `electron`, `electron-vite`, `react`, `@codemirror/*`, `katex`, `mermaid`, `@playwright/test`, `electron-builder` (stage 3), `fast-xml-parser`, `hast-util-*` (stage 6).

Stage 3 app shell (#322): `react` and `react-dom` (MIT, runtime, bundled into the renderer); dev only: `electron` (MIT), `electron-vite` and `vite` (MIT), `@playwright/test` (Apache-2.0), `@types/react` and `@types/react-dom` (MIT), and `happy-dom` (MIT, a DOM for the unit tests of the renderer). pnpm does not run Electron's install script. `pnpm --filter @logreq/app electron:install` downloads the binary where it is needed (Electron tests, later packaging).

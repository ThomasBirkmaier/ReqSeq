# ADR-0014: Packaging and delivery

Status: Proposed · Based on: D-003, D-004, D-029 · SRs: SR-076, SR-077, SR-078

## Decision

- **electron-builder** builds per platform: Windows NSIS installer and zip, macOS dmg and zip (arm64 and x64), Linux AppImage and deb. Built in CI on the matching runner from stage 3.
- The delivery contains app, CLI and MCP server (SR-076 AK2). CLI and MCP run on the bundled Electron binary with `ELECTRON_RUN_AS_NODE=1` through a small launcher script (`logreq`, `logreq.cmd`), so no separate Node installation is needed. The installer offers to put `logreq` on the PATH.
- Additionally the CLI is published as a tarball (`npm pack` of `@logreq/cli` with bundled dependencies) for pipelines that already have Node 22.
- Everything is in the installer; nothing is downloaded at install or run time (SR-078 AK2). No auto-update.
- `@logreq/core` carries all schemas and the catalog as the generated module `src/generated/contracts.json` (`pnpm contracts:generate`, checked by `contracts:check`), so no `schemas/` folder is needed next to the app, CLI or MCP server.
- The read worker of the cold load (`@logreq/core` `dist/model/read-worker.js`, ADR-0008) is started from its own file and imports `yaml`, `ajv` and the generated contracts: the packaged app (asar, `asarUnpack` if needed), the utility process and the CLI and MCP server on Electron with `ELECTRON_RUN_AS_NODE=1` must be able to start it (#216).
- Packaging ships `code-fingerprint.json`, written by core's build into `packages/core/dist` (ADR-0008), where the model cache looks for it: in the parent folder of the folder that holds the model-cache module (`new URL("../", import.meta.url)` of `model/model-cache.js`). An asar that ships `@logreq/core` unbundled already includes `dist/code-fingerprint.json` through `files: ["dist"]`; a single-file bundle needs it in the parent folder of the bundle's folder. Without it the model cache falls back to walking core's own files for its fingerprint, which in an asar or single-file bundle gives a different fingerprint or none (#232).
- The delivery includes the guide for connecting a test tool, `toolchain/junit/README.md`, with its examples (SR-063 AK2 „mitgelieferte Beschreibung“; spec question #600 Q3, assumption).
- Code signing and notarisation are not part of the basic scope; unsigned builds are documented.

## Rejected

- A separate Node binary (pkg, Node SEA) for the CLI: a second runtime to keep in sync with Electron's Node.

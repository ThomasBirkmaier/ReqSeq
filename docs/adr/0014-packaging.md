# ADR-0014: Packaging and delivery

Status: Accepted · Based on: D-003, D-004, D-029 · SRs: SR-076, SR-077, SR-078, SR-141 · Changed 2026-10-28: portable delivery instead of installers, release workflow (ThomasBirkmaier/ReqSeq-archive#324) · 2026-11-08: the documentation site in every delivery (#1205)

## Context

D-003: „Das Tool ist eine installierte App. Kein Browser, keine Mobil-Version.“ SR-076 asks that the tool be „als Desktop-App mit Kommandozeile für Windows, macOS und Linux ausgeliefert“; its AK1 starts the app „wenn die Auslieferung installiert wird“, and SR-078 AK2 asks that the installation succeeds „ohne Nachladen“.

The delivery is to be as simple as possible, and a portable artifact is the delivery instead of an installer: **installing it means unpacking it** into any folder (D-003, SR-076 AK1, SR-078 AK2). The release workflow must not make the CI performance drop sharply. For Linux the artifact is a tar.gz, not an AppImage.

## Decision

**One portable artifact per system, no installer.** electron-builder builds:

- Windows: a zip of the program folder's contents (`ReqSeq.exe`, `bin\reqseq.cmd`, `resources\` at its top level, no folder around them), x64.
- macOS: a zip with `ReqSeq.app`, arm64 (the machines that build and test it are Apple silicon; Intel or universal is one configuration line later).
- Linux: a tar.gz with one folder (`ReqSeq`, `bin/reqseq`, `chrome-sandbox`, `resources/`), x64 (the Ubuntu 24.04 reference of SR-076).

Additionally the CLI is published as a tarball (`npm pack` of `@reqseq/cli` with bundled dependencies) for pipelines that already have Node 22.

**Names.** Every artifact and launcher name is defined here and, in the build, in one configuration entry of `toolchain/packaging/` that all build scripts, tests and the release workflow read: in the build, a rename of the product changes only that entry. The install guide (`docs/guide/how-to/install-reqseq.md`) follows this table and is changed with it. The names also decide where user data lives (last two rows); a rename moves those folders, so the renamed version must take the old data over once. `<version>` is the version of the root `package.json`, which `reqseq --version` also reports.

| What | Name |
|---|---|
| Product name, macOS bundle | `ReqSeq`, `ReqSeq.app` |
| App binary | `ReqSeq.app/Contents/MacOS/ReqSeq` (macOS), `ReqSeq.exe` (Windows), `ReqSeq` (Linux) |
| Launcher (CLI and MCP server) | `bin/reqseq` (macOS: `ReqSeq.app/Contents/Resources/bin/reqseq`), `bin\reqseq.cmd` (Windows) |
| macOS artifact | `ReqSeq-<version>-mac-arm64.zip` |
| Linux artifact | `ReqSeq-<version>-linux-x64.tar.gz` (folder `ReqSeq-<version>-linux-x64/`) |
| Windows artifact | `ReqSeq-<version>-win-x64.zip` |
| CLI tarball | `reqseq-cli-<version>.tgz` |
| Documentation site | `resources/cli/docs/` (macOS: `ReqSeq.app/Contents/Resources/cli/docs/`), `package/docs/` in the CLI tarball |
| Checksums | `SHA256SUMS.txt` |
| App data folder (Electron's userData, from the product name; recent elements) | `~/Library/Application Support/ReqSeq`, `~/.config/ReqSeq`, `%APPDATA%\ReqSeq` |
| Cache folder (recent workspaces, model caches; ADR-0008) | `reqseq` in the OS cache folder (`~/Library/Caches`, `$XDG_CACHE_HOME` or `~/.cache`, `%LOCALAPPDATA%`) |

**Content.** Every artifact contains app, CLI and MCP server (SR-076 AK2):

- the app: `app.asar` with the electron-vite output and the app's production dependencies;
- the CLI and the MCP server as a plain folder `resources/cli` outside the asar, with a flat production `node_modules`. They run on the bundled Electron binary with `ELECTRON_RUN_AS_NODE=1` through the launcher, so no separate Node installation is needed, and they start no Chromium: they need neither a display nor the Linux sandbox step below;
- the launchers in a `bin` folder. Windows matches names case-insensitively and tries `.EXE` before `.CMD`, so `reqseq.cmd` next to `ReqSeq.exe` would lose to the GUI app on the PATH; with `bin` on the PATH only the launcher is found. Adding `bin` to the PATH is one documented line ([Install ReqSeq](../guide/how-to/install-reqseq.md#cli));
- `build-info.json` in each staged copy of `@reqseq/core/dist` (app and CLI), with the commit the delivery is built from and its date, which `tool info` shows (SR-161); a build from a checkout has none;
- the documentation site of this version (SR-141, ADR-0017 "Offline build"), the offline build with base `/` and the version in every page title, as `docs/` of the CLI: `resources/cli/docs/` in the archives and `package/docs/` in the CLI tarball, one copy that `reqseq serve docs` serves and the app reads (#1192). About 7 MB and 200 files unpacked, 1.6 MB compressed;
- `resources/THIRD_PARTY_NOTICES.txt` with the production dependencies of app and CLI and the packages and bundled code the documentation site ships, with their licences, naming `@dagrejs/dagre` and `@dagrejs/graphlib` (ADR-0015); the CLI tarball has its own `package/THIRD_PARTY_NOTICES.txt` of the CLI and the site;
- the example for connecting a test tool, `toolchain/junit/` (a workspace, Vitest and pytest tests, and a README that points to the how-to pages of the site), as `resources/docs/junit/`; the description SR-063 AK2 names („mitgelieferte Beschreibung“, spec question ThomasBirkmaier/ReqSeq-archive#600 Q3, assumption) is those pages of the site above (#1255);
- Electron's licence and Chromium's notices.

Everything is in the artifact; nothing is downloaded at install or run time (SR-078 AK2). No auto-update and no update configuration (no `app-update.yml`, electron-builder never publishes). Git is a prerequisite and not part of the delivery: ReqSeq calls the `git` on the PATH.

**Linux on Ubuntu 24.04.** AppArmor blocks the user namespaces of Chromium's sandbox there, so Electron uses the SUID helper `chrome-sandbox`, which must be owned by root with mode 4755. The documented one-time admin step (`sudo chown root:root …/chrome-sandbox && sudo chmod 4755 …/chrome-sandbox`, or an AppArmor profile) downloads nothing. ReqSeq never passes `--no-sandbox`. Without admin rights the app does not start on a stock Ubuntu 24.04; the CLI and the MCP server do.

**Electron fuses.** A fuse is one bit in the binary and applies to the whole binary:

| Fuse | Value | Why |
|---|---|---|
| `RunAsNode` | on | the launcher runs the CLI with `ELECTRON_RUN_AS_NODE=1`; it gives a local user nothing they could not do anyway |
| `EnableNodeCliInspectArguments` | off | ADR-0010 |
| `EnableNodeOptionsEnvironmentVariable` | off | no `NODE_OPTIONS` injection into app or CLI (a bigger heap would be passed by the launcher itself) |
| `OnlyLoadAppFromAsar` | on | the app loads only `app.asar` |
| `EmbeddedAsarIntegrityValidation` | on | on macOS and Windows the app refuses to start when `app.asar` does not match the hash electron-builder writes into the bundle (`Info.plist`, the exe's resources); Electron checks nothing on Linux |

**Signing.** Not part of the basic scope. macOS builds get an ad-hoc signature, the minimum Apple silicon runs; Windows builds are unsigned. [Install ReqSeq](../guide/how-to/install-reqseq.md#app) says how to open them. Signing and notarisation come later.

**Icon.** One master drawing, `toolchain/packaging/icon/icon.svg`; `scripts/icon/generate.mjs` renders from it the macOS `.icns`, the Windows `.ico`, the Linux PNGs, the Linux window icon of the app and the favicons of the docs site, all committed (#410). Windows takes the icon into `ReqSeq.exe` through `signAndEditExecutable`, which edits the exe with rcedit and signs nothing without a certificate.

**Release.** `.github/workflows/release.yml` builds the delivery only on a `v*` tag or a manual run, never on pull requests or pushes, so that CI time of pull requests does not change. Its first job, `docs-site`, builds the offline documentation site once on Linux with the steps it shares with `docs-pages.yml` (`.github/actions/docs-site`: screenshots, generate, install, audit, build under `unshare -rn`), checks it and the licences of what it ships (`scripts/package/stage.mjs --docs-site`, ADR-0015) and hands it to the build jobs as an artifact, which `stage.mjs` copies into the staged CLI; it adds about 7 minutes before the build matrix. macOS, Linux and Windows build on GitHub's hosted runners (`macos-26`, `ubuntu-24.04`, `windows-2025`); the assets are attached to the GitHub release of a tag on `main` whose name is `v<version>`, or `v<major>.<minor>` when the patch is 0 (the stage tags: `v0.<n>` on version `0.<n>.0`). The delivery tests run there (ADR-0011). The release text starts with the summary for the user from `docs/releases/<version>.md`, written in the version PR (its README says how), then the download note and the assets, then the changes since the previous release tag, folded, from the Conventional Commit subjects on `main` grouped into new functions, fixes, specification and other changes (`scripts/package/stage.mjs --release-body`, #346). A manual run only shows the text in its job summary, and fails without the summary of its version. The workflow `release-texts.yml`, by hand on `main`, writes the text of published releases again after their summary changed. electron-builder is a dev tool in its own package `toolchain/packaging/` with its own lockfile and its own `pnpm-workspace.yaml` (its settings and overrides), installed and audited only by the release workflow, so pull requests never install it (exception to ADR-0001).

**Model and core files in the delivery.**

- `@reqseq/core` carries all schemas and the catalog as the generated module `src/generated/contracts.json` (`pnpm contracts:generate`, checked by `contracts:check`), so no `schemas/` folder is needed next to the app, CLI or MCP server.
- The read worker of the cold load (`@reqseq/core` `dist/model/read-worker.js`, ADR-0008) is started from its own file and imports `yaml`, `ajv` and the generated contracts. The CLI and the MCP server start it from the real files of `resources/cli`. The app's core process, a utility process, starts it from inside `app.asar` (`resources/app.asar/node_modules/@reqseq/core/dist/model/read-worker.js`): Electron's asar support reaches worker threads, and the worker's imports resolve inside the archive, so nothing is unpacked (`asarUnpack`). The delivery test `packages/app/test/delivery/start.test.ts` loads 1,200 generated element files in the packaged app and checks with Node's `NODE_DEBUG=worker` trace that the workers started from the archive and with the overview's counts that they read every file; without the DevTools port, which Linux always opens, the counts cannot be seen and the test is skipped (#142).
- Packaging ships `code-fingerprint.json`, written by core's build into `packages/core/dist` (ADR-0008), where the model cache looks for it: in the parent folder of the folder that holds the model-cache module (`new URL("../", import.meta.url)` of `model/model-cache.js`). Both copies of `@reqseq/core`, in the asar and in `resources/cli`, ship unbundled and include `dist/code-fingerprint.json` through `files: ["dist"]`; a single-file bundle would need it in the parent folder of the bundle's folder. Without it the model cache falls back to walking core's own files for its fingerprint, which in an asar or single-file bundle gives a different fingerprint or none (ThomasBirkmaier/ReqSeq-archive#232).

## Rejected

- Installers (NSIS, dmg, deb): more to build, test and document (PATH, uninstall) for no gain over unpacking.
- AppImage for Linux: needs `libfuse2t64` on Ubuntu 24.04, a download during installation (SR-078 AK2), and electron-builder's start script runs Electron with `--no-sandbox` there (ADR-0010).
- Packaging on every pull request: costs runner time on every pull request; a manual release run before each stage acceptance finds packaging regressions.
- A separate Node binary (pkg, Node SEA) for the CLI: a second runtime to keep in sync with Electron's Node.

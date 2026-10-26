# @logreq/app

The LogReq desktop app (ADR-0010). It is an Electron shell over the command catalog of `@logreq/core` (ADR-0002) and has no logic of its own. Every call of the renderer is one `invoke` in the core process, so the app gives the same results as CLI, API and MCP (SR-080). So far it shows only the shell: an empty white sheet, the modeline with the open workspace (`workspace.status`) and a one-line minibuffer. The editor, the main view and the command palette come with their SRs.

```sh
pnpm build                                   # core and the other packages (tsc)
pnpm --filter @logreq/app electron:install   # downloads the Electron binary (pnpm runs no install scripts)
pnpm --filter @logreq/app build:electron     # electron-vite: out/main, out/preload, out/renderer
pnpm --filter @logreq/app start -- --workspace ../../fixtures/SR-004/one-repository
pnpm --filter @logreq/app test:electron      # install, build and the Playwright tests (Linux: under xvfb-run)
```

## Processes

- **Main** (`src/main/`, `out/main/index.js`) opens one window, the menu and the folder dialog. The menu is minimal: File > Open Workspace (Ctrl/Cmd+O), Quit (Close on macOS) and Edit. An unpackaged build adds Developer > Reload (F5) and Developer Tools (F12). Other keys stay free for the minibuffer and buffers. The menu bar hides until Alt on Windows and Linux. It also handles the protocols and the security settings. `--workspace <folder>` opens that folder at start.
- **Core process** (`src/core/`, `out/main/core.js`) is an Electron utility process (plain Node) with one workspace. That workspace is the root found upwards from the chosen folder, or else the folder itself. Its model cache lies in the cache folder of the copy, and the watcher and the load run as in `logreq serve api`. Opening another workspace stops the core process and starts a new one. Before it stops, it aborts running reads, lets running writes finish and closes its workspace; after 5 s it is killed. The app stops it the same way before it quits. A write command also runs to its end when its window goes away. If the workspace cannot be opened, the core process logs it and ends with exit code 1. A core process that stops by itself is started again; after more than 3 stops within 60 s it is not started again.
- **Renderer** (`src/renderer/`, React) is sandboxed and loaded from `app://logreq/index.html`. It reaches only `window.logreq`.

Main gives each page load a `MessagePort` to the core process (`logreq:workspace`, `src/shared/protocol.ts`). The renderer talks to the core process over that port directly.

## `window.logreq` (preload, `src/preload/bridge.ts`)

- `invoke(name, input = {})` resolves to `{ ok: true, output }` or `{ ok: false, error }`, where `error` is the error object of every access. It never rejects, because the context bridge would keep only an error's message. Without a workspace it gives `workspace.not-found`.
- `commands()` returns the catalog entries, each with `implemented`, as `GET /v1/commands` of the API does (for the command palette, SR-073 AK2).
- `on("workspace-changed", listener)` returns the function that unsubscribes. The listener gets `{ reason }`:
  - `opened`: another workspace was opened.
  - `restarted`: the core process was started again.
  - `stopped`: the core process stopped and is not started again.
  - `written`: a write command of a window changed files.

  Files changed outside the app do not send the event yet; that needs a change event of core's watcher (#331).

The bridge offers nothing else, and in particular no delete (SR-099).

## Security (SR-077, SR-078)

- Windows use `contextIsolation`, `sandbox` and `app.enableSandbox()`. They have no `nodeIntegration` and no webview. The spell checker is off and its dictionary URL points at `app://logreq/no-dictionaries/`, which serves nothing.
- The content security policy is sent as a header with every page: `connect-src 'none'`, and only the app's own scripts.
- Navigation of any frame (`will-navigate`, `will-frame-navigate`), redirects, `window.open` and webviews are denied. Every permission request and device (HID, serial, USB, Bluetooth) is refused. The CSP has `frame-src 'none'`.
- `session.webRequest` cancels every request that is not `app:`, `logreq-file:` or `devtools:`, and logs only its origin to standard error.
- `logreq-file://workspace/<repository>/<path>` serves images (by extension) inside an available repository of the workspace. The repository is in the path, because Chromium turns hosts like `1.2` into IPv4 addresses. The path is checked first by its names alone (no `\`, `:` or NUL, and inside the repository folder), before any file system call: a UNC path or `/net/...` would otherwise open a network share. Only then are links resolved and checked again.
- There is no updater, no crash upload and no telemetry. Fuses and packaging belong to #324.

## Tests

- Unit tests (`src/**/*.test.ts`, Vitest) use fake Electron objects, a Node `MessageChannel` and happy-dom for React. They cover 100 % (ADR-0016).
- `test/app.spec.ts` (Playwright, `_electron.launch`) runs the built app on fixture workspaces:
  - it starts and shows the status;
  - `invoke` gives what the CLI gives (`[SR-080/AK2]`);
  - the bridge offers only the catalog (`[SR-099/AK1]`);
  - the renderer has no Node;
  - the session cancels a non-local request, and the app makes none itself (SR-078);
  - `logreq-file:` does not leave the repository;
  - navigation and new windows are denied;
  - a stopped core process is started again;
  - without a workspace, the app says how to open one.

  The JUnit file is `test-results/junit-electron.xml` (CI job `electron`, under `xvfb-run` on Linux).
- The cross-access and no-delete tests in `packages/cli/test/` run the app's bridge and core side over a `MessageChannel` for every catalog command.

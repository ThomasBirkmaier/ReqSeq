# @logreq/app

The LogReq desktop app (ADR-0010). It is an Electron shell over the command catalog of `@logreq/core` (ADR-0002) and has no logic of its own. Every call of the renderer is one `invoke` in the core process, so the app gives the same results as CLI, API and MCP (SR-080).

```sh
pnpm build                                   # core and the other packages (tsc)
pnpm --filter @logreq/app electron:install   # downloads the Electron binary (pnpm runs no install scripts)
pnpm --filter @logreq/app build:electron     # electron-vite: out/main, out/preload, out/renderer
pnpm --filter @logreq/app start -- --workspace ../../fixtures/SR-004/one-repository
pnpm --filter @logreq/app start -- --workspace ../../spec   # the specification of LogReq itself
pnpm --filter @logreq/app test:electron      # install, build and the Playwright tests (Linux: under xvfb-run)
```

## Main view (SR-100)

A white sheet (D-062). The window shows one buffer at a time, the most recent one, above the modeline and the minibuffer; nothing else is permanently visible.

- **Buffers:** the list of elements (`element.list`: filter, sort, derivation tree, pages of 200), a search result (`element.search`, pages of 50) and one element, read-only (`element.get`: title, text as plain text, the properties that are set, relations by kind, with a mark for outdated ones). Opening a buffer again shows the one that is open. Editing comes with the editor (SR-065).
- **Modeline:** a display, not a control. Left the parts of the shown buffer (a list: its filter, sort and count; an element: ID, type, status, `read-only`, outdated relations, hints), right the workspace and its marks. Values are the commands' output as it is.
- **Minibuffer:** the only control. Idle it is one line with the last message. Asked, it has an input and the candidates rise above the modeline, only while asked.
- **Fuzzy matching:** names of actions and buffers are ranked with uFuzzy in the renderer (`intraMode: 0`, and one slip per word when that finds nothing). Elements are found by `element.search` in core.
- **Not shown unless asked:** UUID and version (action "Show element ID and version": the UUID and the date of the version, D-013, not the check value), empty properties, the shortcut of an action (only in the prompt).

| Keys (Ctrl, or Cmd on macOS) | |
| --- | --- |
| Ctrl/Cmd+Shift+P | Command prompt: the app's actions that apply to the shown buffer (filter, sort, close, ...) |
| Ctrl/Cmd+P | Go to an open buffer (the most recent first, so Enter goes back) or to an element |
| Ctrl/Cmd+Shift+F | Search elements |
| Up, Down, Page Up, Page Down, Home, End | Select a row |
| Enter | Open the selected row (in a prompt: run the candidate) |
| Escape | End the prompt |
| Tab | In a prompt, the next candidate |

Catalog commands in the command prompt (SR-073 AK2) come with #85.

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
- `test/main-view.spec.ts` runs the main view on `fixtures/SR-069/filter` and compares it with the CLI: the list, the tree, a filter, the search and an element (`[SR-100/AK1]` checks that nothing but the buffer, the modeline and the minibuffer is permanently visible; the SR is verified by inspection, `verification/SR-100.md`).
- `test/screenshots.spec.ts` takes the screenshots of `verification/SR-100/` on a copy of the repository's `spec/` workspace (`test-results/electron/screenshots/`, or the folder in `LOGREQ_SCREENSHOTS`).
- The cross-access and no-delete tests in `packages/cli/test/` run the app's bridge and core side over a `MessageChannel` for every catalog command.

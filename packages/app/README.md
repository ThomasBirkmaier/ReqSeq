# @reqseq/app

The ReqSeq desktop app (ADR-0010). It is an Electron shell over the command catalog of `@reqseq/core` (ADR-0002) and has no logic of its own. Every call of the renderer is one `invoke` in the core process, so the app gives the same results as CLI, API and MCP (SR-080).

```sh
pnpm build                                   # core and the other packages (tsc)
pnpm --filter @reqseq/app electron:install   # downloads the Electron binary (pnpm runs no install scripts)
pnpm --filter @reqseq/app build:electron     # electron-vite: out/main, out/preload, out/renderer
pnpm --filter @reqseq/app start -- --workspace ../../fixtures/SR-004/one-repository
pnpm --filter @reqseq/app start -- --workspace ../../spec   # the specification of ReqSeq itself
pnpm --filter @reqseq/app test:electron      # install, build and the Playwright tests (Linux: under xvfb-run)
```

The details are in the parts under [`docs/`](docs/), one file per topic. Read only the part you work on.

- [Buffers and views](docs/buffers.md): start, buffers again after a restart, buffers, elements with a value, package page, neighbourhood, traceability matrix, modeline, view, follow agent, what is not shown
- [Property boxes and title](docs/property-boxes.md): property boxes, choice and relation values, saving boxes, title
- [Graph (SR-111)](docs/graph.md): the graph of an element
- [Metamodel (SR-130)](docs/metamodel.md): the metamodel buffer
- [Minibuffer and command prompt](docs/command-prompt.md): minibuffer, fuzzy matching, create element, open workspace, catalog commands, ranking
- [Keys](docs/keys.md): every key of the main window
- [Editor (SR-065)](docs/editor.md): the Markdown editor, saving, undo, drafts, changes from outside, slash menu, `[[` search, formulas
- [`window.reqseq` (preload, `src/preload/bridge.ts`)](docs/bridge.md): the bridge between renderer and core
- [Tests](docs/tests.md): the unit tests and the Electron specs

## Main view (SR-100)

A white sheet (D-062). The window shows one buffer at a time, the most recent one, or two side by side after "Split window", above the modeline and the minibuffer; nothing else is permanently visible.

## Light and dark (SR-113)

The app follows the system's light or dark setting at start and while it runs (`prefers-color-scheme`, which Chromium takes from Electron's `nativeTheme`). Every colour is a token in `src/renderer/styles.css` with a light and a dark value (`light-dark()`), and `styles.test.ts` checks that the text reaches WCAG 2.2 AA in both and that no rule uses a colour of its own. The action "Toggle dark mode" (command prompt, no shortcut) switches to the other scheme at once, without a restart, by setting `data-theme` on the root element; "Follow system light or dark mode" (offered only after a choice) removes it. The choice lasts until the app quits and is stored nowhere, because every start follows the system (SR-113 AK1). The window background at start follows `nativeTheme`; the native title bar keeps the system's look. A new colour in a style rule or in the editor theme must be a token.

## Processes

- **Main** (`src/main/`, `out/main/index.js`) opens one window, the menu and the folder dialog. The menu is minimal: File > Open Workspace (Ctrl/Cmd+O), Quit (Close on macOS) and Edit. An unpackaged build adds Developer > Reload (F5) and Developer Tools (F12). Other keys stay free for the minibuffer and buffers. The menu bar hides until Alt on Windows and Linux. It also handles the protocols and the security settings. `--workspace <folder>` opens that folder at start. It answers the renderer's requests for the workspaces opened last and opens one of them, or the workspace of a typed folder, in the window (SR-131, `src/main/workspaces.ts`), with core's list module `@reqseq/core/recent-workspaces`, loaded on the first request. Before every switch, also from the folder dialog, it asks the window to save its unsaved input (`reqseq:save`) and goes on only when the window answers that it is saved (`reqseq:saved`; no answer within 30 s keeps the open workspace).
- **Core process** (`src/core/`, `out/main/core.js`) is an Electron utility process (plain Node) with one workspace. It passes each batch of the watcher to the windows as `workspace-changed` with the reason `external` (below). That workspace is the root found upwards from the chosen folder, or else the folder itself. Its model cache lies in the cache folder of the copy, and the watcher and the load run as in `reqseq serve api`. Opening another workspace stops the core process and starts a new one. Before it stops, it aborts running reads, lets running writes finish and closes its workspace; after 5 s it is killed. The app stops it the same way before it quits. A write command also runs to its end when its window goes away. It also watches the accesses agents make through the API or MCP on the copy (SR-117, `agent-activity`); why it cannot (no cache folder outside the repositories, no watch) is a line on standard error. Every call of the app passes the access `app` (ADR-0002 rule 4). Once its workspace is open, it records the root in the list of recent workspaces (`<OS cache>/reqseq/recent-workspaces.json`, core's `recordOpenedWorkspace`; not for a folder without a workspace, and not when that folder lies inside a repository of the workspace), and `stop` waits for that write. If the workspace cannot be opened, the core process logs it and ends with exit code 1. A core process that stops by itself is started again; after more than 3 stops within 60 s it is not started again.
- **Renderer** (`src/renderer/`, React) is sandboxed and loaded from `app://reqseq/index.html`. It reaches only `window.reqseq`.

Main gives each page load a `MessagePort` to the core process (`reqseq:workspace`, `src/shared/protocol.ts`). The renderer talks to the core process over that port directly.

## Security (SR-077, SR-078)

- The renderer sends main four messages, each only from the main frame of the ReqSeq window on `app://reqseq` (`src/main/sender.ts`): `reqseq:copy` (SR-128), where main checks the text (a string, at most 16 Mi characters) before it writes the clipboard, and never reads it; `reqseq:recent-workspaces` and `reqseq:open-workspace` (SR-131), where main opens only a root that is, character for character, a root of the stored list (no other folder, no other spelling, no folder without a workspace), checks type, length (4096) and NUL before it reads anything, and makes no synchronous file-system call; a typed path (`typed`) passes core's lexical check first (absolute or `~`, no UNC or device path on Windows) and opens only when a folder from it upwards holds a workspace file; and `reqseq:saved`, the window's answer to main's request to save before a switch.
- Windows use `contextIsolation`, `sandbox` and `app.enableSandbox()`. They have no `nodeIntegration` and no webview. The spell checker is off and its dictionary URL points at `app://reqseq/no-dictionaries/`, which serves nothing.
- The content security policy is sent as a header with every page: `connect-src 'none'`, and only the app's own scripts.
- Navigation of any frame (`will-navigate`, `will-frame-navigate`), redirects, `window.open` and webviews are denied. Every permission request and device (HID, serial, USB, Bluetooth) is refused. The CSP has `frame-src 'none'`.
- `session.webRequest` cancels every request that is not `app:`, `reqseq-file:` or `devtools:`, and logs only its origin to standard error.
- `reqseq-file://workspace/<repository>/<path>` serves images (by extension) inside an available repository of the workspace. The repository is in the path, because Chromium turns hosts like `1.2` into IPv4 addresses. The path is checked first by its names alone (no `\`, `:` or NUL, and inside the repository folder), before any file system call: a UNC path or `/net/...` would otherwise open a network share. Only then are links resolved and checked again.
- There is no updater, no crash upload and no telemetry. Fuses and packaging belong to #324.

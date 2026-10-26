# ADR-0010: Electron app: process model and security

Status: Proposed · Based on: D-003, D-004, D-019, D-029, D-061, D-062, D-063 · SRs: SR-065, SR-066, SR-073, SR-074, SR-076, SR-077, SR-078, SR-082, SR-100

## Decision

**Processes**
- *Main process:* windows, menus, file dialogs, the API server when enabled. No program logic.
- *Core process:* `core` runs in an Electron `utilityProcess` (plain Node), so long commands never block the window. Main passes a `MessagePort` between renderer and core process, a new one on every page load. There is one core process per open workspace, opened as `logreq serve api` opens it: the root is found upwards from the chosen folder (else the folder itself), the model cache lies in the cache folder of the copy, and the watcher starts before the load. Opening another workspace stops the core process: running reads are aborted, running writes finish, then the workspace closes; the process is killed after 5 s. The app stops it the same way before it quits. A write also finishes when its window goes away. A core process that cannot open its workspace ends with exit code 1.
- *Renderer:* UI only. It calls `window.logreq.invoke(name, input)` and subscribes to `window.logreq.on("workspace-changed", …)` via a minimal preload bridge (`contextBridge`; the preload is one CommonJS bundle, as the sandbox requires). It cannot reach Node, the file system or the network.
- *Bridge (#322):* it is generic over the catalog and offers only three functions:
  - `invoke` resolves to `{ ok: true, output }` or `{ ok: false, error }` with the error object of every access. It never rejects, because the context bridge keeps only an error's message.
  - `commands()` gives the catalog entries with `implemented`, as `GET /v1/commands` of the API does.
  - `on("workspace-changed")` gets `{ reason }`: `opened`, `restarted`, `stopped` or `written` (a write command of the app). Changes from outside the app follow with a change event of core's watcher (#331).

**Security settings (all windows)**
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`, no `webview`, no `remote`.
- Content Security Policy, sent as a response header with every page: `default-src 'self'; img-src 'self' data: logreq-file:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; frame-src 'none'`.
- The renderer is loaded from a custom `app://` protocol serving the bundled files (`app://logreq/index.html`; no development server). Images of elements are served by a `logreq-file:` protocol, `logreq-file://workspace/<repository>/<path>`, that only serves image files inside an available repository of the workspace. The repository is in the path because Chromium canonicalises hosts like `1.2` into IPv4 addresses. The path is checked lexically first (no `\`, `:` or NUL, inside the repository folder), so no UNC share or automount is touched; then links are resolved and checked again. The core process reads the files, and main relays them.
- All navigation, `window.open` and webviews are denied. External links open in the system browser only after the user clicks them; that arrives with the first screen that shows links. Redirects and the navigation of every frame are denied too. Every permission request (camera, notifications, ...) and every device chooser (HID, serial, USB, Bluetooth) is refused. The spell checker is off, because it downloads dictionaries, and its download URL points at a local URL that serves nothing. The CSP adds `frame-src 'none'`.
- Menu: minimal, so the keys stay free for the minibuffer and buffers (D-061..D-063): File > Open Workspace (Ctrl/Cmd+O), Quit (Close on macOS), Edit. Reload (F5) and the developer tools (F12) only in unpackaged builds.
- `session.webRequest.onBeforeRequest` cancels every request that is not `app:`, `logreq-file:` or `devtools:` (SR-078).
- No auto-updater, no crash reporter upload, no telemetry (SR-078). Electron fuses: `runAsNode` only for the bundled CLI entry (ADR-0014), `EnableNodeCliInspectArguments` off.

**UI** (D-061..D-063)
- React with TypeScript, bundled with `electron-vite`. A white sheet (D-062): the window shows one buffer (a list, a search result or an element; later a graph, D-063), a quiet modeline (a display, not a control) and the minibuffer. There is no tab bar, no permanent sidebar or tree, no form and no modal dialog (SR-100 AK1). Colour only for meaning: greys, and one accent for "outdated".
- Minibuffer: the only control. Ctrl/Cmd+Shift+P opens the command prompt, Ctrl/Cmd+P jumps to an open buffer or to an element, Ctrl/Cmd+Shift+F searches; each entry shows its shortcut. Every action has a keyboard path (SR-073 AK1). The prompt finds every function by its name (SR-073 AK2). So far it lists the actions of the app that apply to the shown buffer; the catalog commands follow with #85, because they need argument entry. Names of actions and open buffers are ranked with uFuzzy in the renderer (UI only); elements are found by `element.search` in core (ADR-0002). Lists come from `element.list` (filter, sort, derivation tree) in pages of 200, search results in pages of 50.
- Editor (SR-065): CodeMirror 6 in live-preview mode (D-061): the Markdown source shows only on the cursor line; KaTeX and Mermaid are bundled locally; properties are boxes below the text. `[[` opens element search and inserts an inline reference (SR-066, ADR-0004). Until then the element buffer shows the text as plain text.
- Graph (D-063): the current element and what hangs on it, in layers, with an existing library (licence check per ADR-0015 when it comes).
- All UI text is English, no i18n framework (D-019, SR-074).

## Consequences

- Renderer bugs cannot touch files or the network directly.
- The core process restarts independently if it crashes; the window shows a message and reloads the workspace. After more than 3 stops within 60 s it is not started again, and the window says so.

## Rejected

- Core in the main process: blocks the UI on long checks.
- Monaco: larger, more than a Markdown editor needs.

# ADR-0010: Electron app: process model and security

Status: Proposed · Based on: D-003, D-004, D-019, D-029 · SRs: SR-065, SR-066, SR-073, SR-074, SR-076, SR-077, SR-078, SR-082

## Decision

**Processes**
- *Main process:* windows, menus, file dialogs, the API server when enabled. No program logic.
- *Core process:* `core` runs in an Electron `utilityProcess` (plain Node), so long commands never block the window. Main passes a `MessagePort` between renderer and core process.
- *Renderer:* UI only. Calls `window.logreq.invoke(name, input)` and subscribes to `window.logreq.on("workspace-changed", …)` via a minimal preload bridge (`contextBridge`). It cannot reach Node, the file system or the network.

**Security settings (all windows)**
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`, no `webview`, no `remote`.
- Content Security Policy: `default-src 'self'; img-src 'self' data: logreq-file:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'none'`.
- The renderer is loaded from a custom `app://` protocol serving the bundled files. Images of elements are served by a `logreq-file:` protocol that only serves files inside the workspace.
- All navigation and `window.open` are denied; external links open in the system browser only after the user clicks them.
- `session.webRequest.onBeforeRequest` cancels every request that is not `app:`, `logreq-file:` or `devtools:` (SR-078).
- No auto-updater, no crash reporter upload, no telemetry (SR-078). Electron fuses: `runAsNode` only for the bundled CLI entry (ADR-0014), `EnableNodeCliInspectArguments` off.

**UI**
- React with TypeScript, bundled with `electron-vite`. Minimal chrome: list, element, search (SR-073 AK3); a command palette (`Ctrl/Cmd+K`) lists every catalog command and app action by name (SR-073 AK2); every action has a keyboard path (SR-073 AK1).
- Editor: **CodeMirror 6** on the Markdown text with live preview (micromark render), KaTeX for formulas and Mermaid for diagrams, all bundled locally (SR-065). `[[` opens element search and inserts an inline reference (SR-066, ADR-0004).
- All UI text English, no i18n framework (D-019, SR-074).

## Consequences

- Renderer bugs cannot touch files or the network directly.
- The core process restarts independently if it crashes; the window shows a message and reloads the workspace.

## Rejected

- Core in the main process: blocks the UI on long checks.
- Monaco: larger, more than a Markdown editor needs.

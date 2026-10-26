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

- **Start (SR-118):** the first buffer of a workspace is the overview, not the list of all elements. It has one line per element type with the number of its elements (`element.facets`, `types`: "System Requirement 117"), the types of the metamodel first, and below them the elements opened last, at most five, newest first, under a muted "Recent" (nothing of it before an element was opened). Enter or a click on a type line opens the list of the elements of exactly that type (`subtypes: false`, so the list is as long as the count says; it filters further like any list). The full list opens only on request: "List all elements" in the command prompt. Ctrl/Cmd+P works at once, with the overview as the only buffer. "Show overview" in the command prompt (offered when the overview is not shown) and closing the last buffer, also "Close all buffers", show it again; the lone overview cannot be closed. The counts are asked once per change of the workspace, not at every return to the overview. The recent elements are display state of the app, like the open buffers: only the UUID and the repository are kept, per workspace (its name and repositories), in the local storage of the app (Chromium, in the user data folder of the operating system), never in the files of the workspace (SR-118 AK5) and not through a catalog command (SR-080 AK1: "außer reiner Darstellung der App"). Each is read with `element.get` when the overview is shown; one that cannot be read is left out. The main process writes the storage to disk when the app quits.
- **Buffers:** the overview, the list of elements (`element.list`: filter, sort, derivation tree, pages of 200), a search result (`element.search`, pages of 50) and one element (`element.get`: title, the text in the Markdown editor, the properties that are set and the relations by kind, with a mark for outdated ones, both read-only for now). Opening a buffer again shows the one that is open.
- **Package page (SR-112):** an element whose type has the meaning `package` shows below its title, text, properties and relations the elements that name it (`element.list` with `where.package`). They sort and show as a tree with "Sort list" like any list. Down on the page goes into them, Escape and Up on the first row come back.
- **Modeline:** a display, not a control. Left the parts of the shown buffer (a list: its filter, sort and count; an element: one part with the ID, the type by its name in the metamodel and the status, then `read-only`, outdated relations, hints), right the workspace and its marks. Values are the commands' output as it is.
- **Minibuffer:** the only control. Idle it is one line with the last message. Asked, it has an input and the candidates rise above the modeline, only while asked.
- **Fuzzy matching:** names of actions and buffers are ranked with uFuzzy in the renderer (`intraMode: 0`, and one slip per word when that finds nothing). Elements are found by `element.search` in core.
- **Not shown unless asked:** UUID and version (action "Show element ID and version": the UUID and the date of the version, D-013, not the check value), empty properties, the shortcut of an action (only in the prompt).

| Keys (Ctrl, or Cmd on macOS) | |
| --- | --- |
| Ctrl/Cmd+Shift+P | Command prompt: the app's actions that apply to the shown buffer (filter, sort, close, ...) |
| Ctrl/Cmd+P | Go to an open buffer (the most recent first, so Enter goes back) or to an element. Enter typed before the hits of the text have arrived waits for them and opens the first one (SR-119 AK1: Ctrl+P, text, Enter) |
| Ctrl/Cmd+Shift+F | Search elements |
| Up, Down, Page Up, Page Down, Home, End | Select a row (on a package page, Down on the page enters its elements) |
| Enter | Open the selected row (in a prompt: run the candidate) |
| Escape | End the prompt |
| Tab | In a prompt, the next candidate |
| Ctrl+N / Ctrl+P (the Ctrl key, also on macOS) | In an open prompt: the next / previous hit, like Down / Up (SR-122). The prompt takes these keys: Ctrl+P is not "Go to" while a prompt is open |
| Ctrl/Cmd+S | Save the text of the shown element (action "Save element") |
| Enter | On an element, put the cursor into the text (action "Edit text") |
| Ctrl/Cmd+Enter | On an element, open the element of the inline reference at the cursor (action "Follow reference") |
| Escape | In the text, back to the element |
| `/` | In the text, at the start of a line or after a space: the slash menu (SR-129) with the Markdown elements at the caret |
| (slash menu open) Down, Up, Tab, Ctrl+N / Ctrl+P, Enter, Escape | Choose, take the entry (one undo step), close the menu and leave the `/` as typed |

Catalog commands in the command prompt (SR-073 AK2) come with #85.

## Editor (SR-065)

The text of an element is Markdown source with a live preview (D-061, `src/renderer/editor/`, CodeMirror 6): headings, emphasis (`*em*`, `**strong**`, `~~strike~~`, `` `code` ``), bullet, ordered and task lists, tables, fenced and indented code blocks, quotes and links appear set, and the source shows only on the lines the cursor touches while the editor has the focus. A table shows its source while the cursor is in any of its rows (spec question #420). There is no preview pane, no toolbar and no Markdown rewriting: the preview only decorates, and the file holds exactly what is in the editor (core adds the final line break, ADR-0004). Nothing in the text is interpreted as HTML. An inline reference (a `logreq:` link) opens its element on a click on its label (Ctrl/Cmd+click on a line that shows its source) and with Ctrl/Cmd+Enter when the cursor is on it (action "Follow reference"); an outdated one (a `relation.outdated` hint of `element.get`) is shown in the accent colour with the word "outdated". Other links are not followed, and a link in a table cell is not clickable yet.

- **Keys:** Enter on the element puts the cursor at the end of the text; Escape comes back to the element; Ctrl/Cmd+S saves with `element.update`; Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z undo and redo; Enter in a list continues it. After a prompt closes, the focus goes to the element (the article), not to the text, unless the action was "Edit text".
- **Unsaved text** is a draft the app keeps per buffer while another buffer is shown (the modeline says `modified`). "Close buffer" asks once and discards when repeated. Opening another workspace drops all drafts. "Close all buffers" closes every buffer; with unsaved text it asks in the minibuffer (Enter keeps the buffers with unsaved text, the second choice discards it). A draft keeps the text and the file text it was typed on; autosave and the rule for a file that changed outside come with #401 and #402. Until then, when a buffer with a draft is shown and the file text differs from the one it was typed on, the minibuffer says that saving overwrites the file. A file changed outside the app is seen only then, after a write or after a restart of the core process.
- **Slash menu (SR-129)** (`slash-menu.ts`, `slash-entries.ts`): `/` typed at the start of a line or after white space, outside code, links and addresses, opens a menu at the caret with headings, normal text, lists, task list, quote, code block, table, link, reference to an element, image, math block, diagram, bold and italic (no underline: Markdown has none, D-015). More typing narrows it as the command line does (initials, letters in order, one slip); Down/Up, Tab and Ctrl+N/Ctrl+P choose, Enter takes the entry in one undo step, Escape closes the menu and the `/` stays as typed. "Reference to element" opens the prompt "Insert reference" (the search of "Go to") and writes `[title](logreq:<uuid>)`. The menu only edits the text; whether D-062 allows it is the spec question #453.
- **Extension points** (`editor/plugins.ts`) for the following issues: parser extensions and preview rules (formulas and diagrams #108, images #109) and further CodeMirror extensions (`[[` link search #78). Property boxes stay below the text (#400).

## Light and dark (SR-113)

The app follows the system's light or dark setting at start and while it runs (`prefers-color-scheme`, which Chromium takes from Electron's `nativeTheme`). Every colour is a token in `src/renderer/styles.css` with a light and a dark value (`light-dark()`), and `styles.test.ts` checks that the text reaches WCAG 2.2 AA in both and that no rule uses a colour of its own. The action "Toggle dark mode" (command prompt, no shortcut) switches to the other scheme at once, without a restart, by setting `data-theme` on the root element; "Follow system light or dark mode" (offered only after a choice) removes it. The choice lasts until the app quits and is stored nowhere, because every start follows the system (SR-113 AK1). The window background at start follows `nativeTheme`; the native title bar keeps the system's look. A new colour in a style rule or in the editor theme must be a token.

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
- `test/editor.spec.ts` runs the editor on the built app (`[SR-065/AK1]` live preview and source on the cursor line, `[SR-065/AK2]` typed text saved and read back as CommonMark with GitHub extensions by micromark, undo, drafts, no request). `test/editor-screenshots.spec.ts` takes the screenshots of `verification/SR-065/`.
- `test/overview.spec.ts` runs the calm start on `fixtures/SR-069/filter` (SR-118 AK1 to AK5: the type lines as `element facets` gives them, the recent elements, also after a restart of the app; the list of a type; every element by Ctrl+P with its short ID and its title; no list at the start; the files of the workspace unchanged) and the quick jump `[SR-119/AK1]`.
- `test/screenshots.spec.ts` takes the screenshots of `verification/SR-100/` on a copy of the repository's `spec/` workspace (`test-results/electron/screenshots/`, or the folder in `LOGREQ_SCREENSHOTS`).
- The cross-access and no-delete tests in `packages/cli/test/` run the app's bridge and core side over a `MessageChannel` for every catalog command.

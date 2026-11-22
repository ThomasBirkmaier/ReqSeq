# Tests

Part of the [`@reqseq/app` README](../README.md).

- Unit tests (`src/**/*.test.ts`, Vitest) use fake Electron objects, a Node `MessageChannel` and happy-dom for React. The `.ts` modules have an 80 % threshold for the package (ADR-0016, ThomasBirkmaier/ReqSeq-archive#752); React components (`.tsx`) have no coverage threshold, Playwright covers them (ADR-0016, ThomasBirkmaier/ReqSeq-archive#537). happy-dom animates (`Element.animate`), so the DOM tests start with "reduce motion" set (`scripts/test-support/reduced-motion.mjs`): a switch of buffers stands at once there. The tests of the motion turn it on (`buffer-slide.test.ts`, the SR-212 blocks of `buffer-cycle-app.test.ts` and `follow-app.test.ts`; `list-drawn.test.ts` checks when a list counts as drawn). The app tests that look at what the reader sees leave out the layers drawn hidden in advance (`shownAll` in `App.test.ts`, `follow-app.test.ts` and `fold-statuses-app.test.ts`). `area-record.test.ts` checks the record and its pages, `area-record-layer.test.ts` a layer drawn from it (drawn without a read, dropped after a change, the metamodel's names or a stopped core, a miss, a fresh view when leaving changes something), a view not read again after a change of the view, and the layer a swipe draws, also after a change; `swipe-draw.test.ts` the swipe's draw. `swipe-drag.test.ts` checks the drag (offsets, clamp, baseline, spring-back, hand-off, input). `buffer-swipe.test.ts` drives the gesture of the wheel swipe with streams shaped as the trackpad measurement of #1612 describes them (slow, fast with momentum, two quick swipes, diagonal, wheel notches); its `replay` takes recorded events (time, deltas, modifiers), so a recording can be added as a fixture. `use-wheel-swipe.test.ts` and `swipe-target.test.ts` check the window's side (pointer, scrolling content, held-back distance).
- `test/app.spec.ts` (Playwright, `_electron.launch`) runs the built app on fixture workspaces:
  - it starts and shows the status;
  - `invoke` gives what the CLI gives (`[SR-080/AK-bb1t]`);
  - the bridge offers the catalog commands, the events, `copyText`, `pasteText` and the recent workspaces, and no delete (`[SR-099/AK-nbg9]`);
  - the renderer has no Node;
  - the session cancels a non-local request, and the app makes none itself (`[SR-078/AK-tnbh]`);
  - `reqseq-file:` does not leave the repository;
  - navigation and new windows are denied;
  - a stopped core process is started again;
  - without a workspace, the app names the keys that open one (Ctrl/Cmd+O, Ctrl/Cmd+Shift+P; the menu bar is hidden on Windows and Linux) and saves a light screenshot `no-workspace-light.png`; the start buffer shows its three lines, saves `start-buffer-light.png`, and Enter on "Open workspace…" shows the folder dialog (stubbed in main) and then the overview (`[SR-225/AK-d2gk]`, `[SR-225/AK-s5p9]`, `[SR-225/AK-tgvr]`); a folder without a workspace, chosen in the folder dialog, names the key of "Create workspace" (`empty-folder-light.png`).

  The JUnit file is `test-results/junit-electron.xml` (not run in CI while the app is paused, #2295; shard n of k gets the files that `test/playwright.config.ts` deals out by their number of tests (`ELECTRON_SHARD=1/2` runs shard 1 of 2 locally), under `xvfb-run` on Linux). When a test fails, `close()` of `test/support/app.ts` writes what the app showed and logged into the job log: the window's text, the renderer's errors and warnings and the last lines of the main process's log (#1671).

- `test/docs-help.spec.ts` opens the documentation on a fixture site (`--docs-folder`, the `docsFolder` launch option), with `shell.openExternal` stubbed in main and the URL it got fetched from main's docs server: Help > ReqSeq Documentation opens the start page on 127.0.0.1 with the site's CSP (`[SR-141/AK-g8dv]`, `help-documentation-light.png`), F1 on "Show trace chain" in the command prompt its reference page and F1 on "Close all buffers", a command only the app has, its anchor on the page of keys (`[SR-141/AK-c1s5]`), and a missing site says core's message and opens nothing.
- `test/screenshots.spec.ts` takes the screenshots of `verification/SR-100/` (among them the empty command prompt, `main-view-commands-empty.png`) on a copy of the repository's `spec/` workspace (`test-results/electron/screenshots/`, or the folder in `REQSEQ_SCREENSHOTS`).
- The cross-access and no-delete tests in `packages/cli/test/` run the app's bridge and core side over a `MessageChannel` for every catalog command.

## Electron specs by area

The other Electron specs are listed in parts, one file per area and one bullet per spec. A new spec gets its bullet in the part of its area; a spec of an area without a part gets a new part, linked here.

- [Command prompt](tests/command-prompt.md): command line, explanation line, mouse, path completion, open workspace, create element, rename and delete
- [Buffers](tests/buffers.md): buffers, perspectives, switch in motion, wheel swipe, buffers drawn in advance, start, follow agent
- [Main view, lists and search](tests/views.md): main view, modeline, hints, lists with a value, search, list keys, neighbourhood
- [Editor](tests/editor.md): editor, acceptance criteria with keys and their references, affected count, changes from outside
- [Property boxes and title](tests/property-boxes.md): title, property boxes
- [Variants, verification and baselines](tests/evidence.md): variant hints, element variants, verification badges and lines, evidence lines, trace chain, baselines
- [Context menu](tests/context-menu.md): the menu, in the text, as an entry, of a list, of the graph and the matrix
- [Graph and matrix](tests/graph-and-matrix.md): traceability matrix, matrix evidence, graph
- [Metamodel](tests/metamodel.md): metamodel, its limits

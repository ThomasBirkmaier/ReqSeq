# @reqseq/web

The pages of the web UI that `reqseq ui` serves (ADR-0020, D-083): TypeScript, built with Vite into `dist/`. They hold no program logic (ADR-0002): every page calls catalog commands through the UI server of `packages/api` and shows their outputs. They import only the generated command types of `@reqseq/core` and its browser-safe subpaths `displays` and `markdown` (an ESLint rule holds it).

```sh
pnpm --filter @reqseq/web build      # dist/: index.html, scripts, styles and the woff2 fonts as files
pnpm --filter @reqseq/web test:ui    # Playwright; once: pnpm --filter @reqseq/web exec playwright install --with-deps --only-shell chromium firefox webkit
```

## How a page starts

1. `token.ts` takes the token from the address (`#token=…`), keeps it in `sessionStorage` and removes it from the address, before the router reads it. Without a token, or when the server refuses it, the page says to open the address `reqseq ui` printed and calls nothing more.
2. `events.ts` reads `api/events` with `fetch` and the bearer header. One tab per browser holds a Web Lock and reads the stream; it passes every event to the other tabs through a `BroadcastChannel`. The first `workspace` event gives the generation of the open workspace, which every command carries in `X-ReqSeq-Workspace` (`api.ts`).
3. `store.ts` reads the metamodel, the workspace's name, the variants and every element with its verification, and reads them again after a `change` or `workspace` event, and after a write of the page itself, which no `change` event follows.
4. `router.ts` draws the page of the hash route.

## Areas

An area is one module in `src/areas/` with a style sheet of its own in `src/css/`. It registers the first part of its routes (`addRoute`), and may add a rail section (`addRailSection`), a queue (`addQueue`), a tab of the element pages (`addElementTab` in `element-tabs.ts`, which keeps the way back `?from=`) or the name its pages have in "Back to …" (`addPlace`). `main.ts` imports each area once. `layout.ts` holds the frame (rail, phone bar, main area), `marks.ts` the verification and status marks, `base.css` the colours, type and frame. `shell.ts` holds what the desktop shell (`packages/shell/`, ADR-0021) does differently: it opens an address that a link in element text names with the system's program through the shell (SR-252 AK3), and offers a path field whose completion comes from `workspace.listFolder`; in the shell the field also has a button for the operating system's dialog, whose path goes into the field like a typed one (SR-253).

| Area | Routes |
| --- | --- |
| `overview.ts` | `#/q/overview`, `#/q/<queue>`: the overview with the head of each queue (`queues.ts`), and each queue |
| `element.ts` | `#/e/<identifier or short ID>[?from=<route>]`: an element in its trace, with its problems (`element.get`, grouped by `elementProblemGroups`), the verification status of each acceptance criterion in the chosen view (`criterionStatuses` of `evidence.list`, filled in after the page is drawn), a button per criterion and one for all of them that copy each criterion after its reference for a test name (`criteriaCopy` of `element.get` `criterionReferences`), and the decisions on its status (Approve, Set status, Supersede) |
| `edit.ts` (with `edit-pick.ts`) | `#/new[?type=<type>]`, `#/edit/<identifier or short ID>[?from=<route>]`: create and edit an element of any type, its properties and relations |
| `evidence.ts` | `#/evidence/<ref>`: an element's evidence per criterion, test case and view, and a form to record a check |
| `trace.ts` | `#/graph/<ref>[?depth=&chain=&evidence=]`: the trace graph over several levels; `#/impact/<ref>`: what a change can affect |
| `matrix.ts` | `#/matrix[?type=&package=&offset=]`: the trace matrix of one type |
| `variants.ts` | `#/variant/<ref>`: a variant compared with the core, with exclude and include again |
| `changes.ts` | `#/c[?b=<baseline>]`, `#/c/<identifier or short ID>[?b=<baseline>]`: the changes since a baseline and the difference of one element word by word, with the decisions on them (status after a confirmation, supersede, a property of many after ReqSeq's preview); `#/r`: the check before a baseline and a new baseline |
| `workspace.ts` | `#/w/open`, `#/w/problems`, `#/w/export`, `#/w/import`, `#/w/settings`: open, create and switch workspaces (the only page while none is open), the problems of `workspace.check` and the queue `problems`, exports into the repositories (`exports/` proposed), the ReqIF import with the choices of its mapping (`reqif-editor.ts`, `reqif-mapping.ts`), and the settings |
| `lists.ts` | `#/l/all`, `#/l/type/<type>`, `#/l/package/<short ID>`, `#/l/filter/<name>`, `#/l/perspective/<name>`, `#/l/search?q=<words>`: lists with facets, sort and groups (the parameters of `list-state.ts`); saving a list as a filter or perspective, and renaming and deleting one |
| `palette.ts` | no route: ⌘K (Ctrl+K) finds a list or an element from every workspace page |

## Rules

- Every string from a command output goes into the DOM as text (`dom.ts`, `h`), never as markup. The one exception is the element text and the properties the metamodel marks `markdown`: they go through the renderer of the HTML export, `@reqseq/core/markdown`, whose allowlist writer escapes every text and attribute (`markdown.ts`). The word-level difference of two wordings comes from the same subpath (`wordDiff`); a page takes only its `del` and `ins` marks and the text from it. A `reqseq:` reference becomes a route to its element; an image of the repository is read with `element.readImage` and shown from a `blob:` URL revoked once it has loaded (an image that cannot be read stays its Markdown text), and a diagram stays its source.
- The UI names no type, property, relation or status key: `meaning.ts` finds them by the meanings of `metamodel.get` and the status marks initial and invalid.
- Hash routes and relative URLs only. Browser storage holds preferences only, each with a default (`preferences.ts`).
- No Git and no file reads: what the pages show comes from catalog commands.

## Tests

`test/` holds the Playwright tests (Chromium) and the test starter `start-ui.ts`, which is not shipped: it writes one of the test kit's generated workspaces into a temporary folder and starts `createUiServer` of `@reqseq/api` on it with the pages of `dist/`. The fixtures run one server per worker; `ui.run` asks core in the test process what a page should show. Each Playwright project takes one workspace: the copy of the specification with a generated history runs the tests of the pages and the flows, the workspace with an unusual metamodel and the one without identifiers run the tests of the pages. The contract tests (`contract-*.spec.ts`) are the only ones with AK tags (SR-248, SR-078 AK3, SR-080 AK4); they run on the workspace with the unusual metamodel in Chromium, Firefox and WebKit (projects `contract-<browser>`). For SR-248 AK2 `contract-processes.spec.ts` starts the built `reqseq ui --no-open` with the preload of the test kit (`packages/testkit/preload/record-access.mjs`), which records each program started and each file opened with its step (`access-record.ts`). For SR-080 AK4 `contract-queries.spec.ts` walks every area on the built `reqseq ui` and runs each read command the page ran again over the built CLI and `reqseq mcp`. The contract tests start the built CLI, so `pnpm build` comes first. The project `guide` (`guide-*.spec.ts`) makes the screenshots and the README animation of the user guide (ADR-0017) on fixed fixture copies; `pnpm docs:screenshots` writes them to `docs/guide/images/`, otherwise they go to `test-results/web/guide-images/` and only the README check runs. The unit tests of the pure modules (`src/*.test.ts`) run with Vitest; coverage is reported without a threshold (ADR-0016).

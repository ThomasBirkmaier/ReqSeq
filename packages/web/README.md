# @reqseq/web

The pages of the web UI that `reqseq ui` serves (ADR-0020, D-083): TypeScript, built with Vite into `dist/`. They hold no program logic (ADR-0002): every page calls catalog commands through the UI server of `packages/api` and shows their outputs. They import only the generated command types of `@reqseq/core` and its browser-safe subpaths `displays` and `markdown` (an ESLint rule holds it).

```sh
pnpm --filter @reqseq/web build      # dist/: index.html, scripts, styles and the woff2 fonts as files
pnpm --filter @reqseq/web test:ui    # Playwright in Chromium; once: pnpm --filter @reqseq/web exec playwright install chromium --only-shell
```

## How a page starts

1. `token.ts` takes the token from the address (`#token=…`), keeps it in `sessionStorage` and removes it from the address, before the router reads it. Without a token, or when the server refuses it, the page says to open the address `reqseq ui` printed and calls nothing more.
2. `events.ts` reads `api/events` with `fetch` and the bearer header. One tab per browser holds a Web Lock and reads the stream; it passes every event to the other tabs through a `BroadcastChannel`. The first `workspace` event gives the generation of the open workspace, which every command carries in `X-ReqSeq-Workspace` (`api.ts`).
3. `store.ts` reads the metamodel, the workspace's name, the variants and every element with its verification, and reads them again after a `change` or `workspace` event.
4. `router.ts` draws the page of the hash route.

## Areas

An area is one module in `src/areas/` with a style sheet of its own in `src/css/`. It registers the first part of its routes (`addRoute`), and may add a rail section (`addRailSection`) or a queue (`addQueue`). `main.ts` imports each area once. `layout.ts` holds the frame (rail, phone bar, main area), `marks.ts` the verification and status marks, `base.css` the colours, type and frame.

| Area | Routes |
| --- | --- |
| `overview.ts` | `#/q/overview`, `#/q/<queue>`: the overview with the head of each queue (`queues.ts`), and each queue |
| `element.ts` | `#/e/<identifier or short ID>[?from=<route>]`: an element in its trace, read only |

## Rules

- Every string from a command output goes into the DOM as text (`dom.ts`, `h`), never as markup. The one exception is the element text and the properties the metamodel marks `markdown`: they go through the renderer of the HTML export, `@reqseq/core/markdown`, whose allowlist writer escapes every text and attribute (`markdown.ts`). A `reqseq:` reference becomes a route to its element; an image stays its Markdown text until a command reads image files, and a diagram its source.
- The UI names no type, property, relation or status key: `meaning.ts` finds them by the meanings of `metamodel.get` and the status marks initial and invalid.
- Hash routes and relative URLs only. Browser storage holds preferences only, each with a default (`preferences.ts`).
- No Git and no file reads: what the pages show comes from catalog commands.

## Tests

`test/` holds the Playwright tests (Chromium) and the test starter `start-ui.ts`, which is not shipped: it writes one of the test kit's generated workspaces into a temporary folder and starts `createUiServer` of `@reqseq/api` on it with the pages of `dist/`. The fixtures run one server per worker; `ui.run` asks core in the test process what a page should show. Each Playwright project takes one workspace: the copy of the specification with a generated history runs every test, the workspace with an unusual metamodel and the one without identifiers run the tests of the pages. The unit tests of the pure modules (`src/*.test.ts`) run with Vitest; coverage is reported without a threshold (ADR-0016).

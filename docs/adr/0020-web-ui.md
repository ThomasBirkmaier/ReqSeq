# ADR-0020: Web UI: server, token, packages and release without Electron

Status: Accepted · Based on: D-083, D-019, D-029, D-030, D-033, D-036, D-068 · SRs: SR-078, SR-080, SR-142, SR-247, SR-248, SR-249, SR-250 · Supersedes: ADR-0010, ADR-0014 · Changes: ADR-0008, ADR-0009, ADR-0011, ADR-0016

## Context

D-083 replaces the desktop app with a web UI: `reqseq ui` starts a server on the own machine, and the UI is used in the browser. The web UI is a thin layer over the catalog commands (SR-248). Only the same machine reaches it, and every command needs a token that is new on every start (SR-247). The delivery holds the CLI, the MCP server, the web UI and their runtime, without Electron (SR-249). Appearance and operation are free (D-083). The screens exist as a prototype outside the repository (plain JavaScript, a Node `http` server that proxies `reqseq serve api` and calls Git itself). Its screens are the starting point, not its server.

The Electron app (ADR-0010) and its delivery (ADR-0014) stay until the web UI ships: #2308 delivers without Electron, and #2310 removes the app. Until then both ADRs describe the code that is still there. They are superseded by this one.

## Decision

**Packages.**
- `packages/web` holds the pages: TypeScript browser code, styles, fonts and their build. It imports the generated command types of `@reqseq/core` and core's browser-safe subpaths (`displays`, ADR-0019, and the Markdown renderer below), and no other runtime code. It holds no program logic (ADR-0002): it calls catalog commands and shows their outputs.
- `packages/api` holds the UI server, `src/ui-server.ts`, next to the API server. It uses the same loopback Host rule (`loopback.ts`) and the same command handler, serves the built files of `packages/web`, and calls core in its own process.
- `packages/cli` holds `reqseq ui`, which parses its options (SR-247 AK1 to AK3) and starts the UI server, nothing else. This is the third reuse of `@reqseq/api` by the CLI, next to `serve api` and `serve docs` (architecture §5).

**One process.**
- The UI server opens the workspace in its own process, as `reqseq serve api` does: root found upwards, model cache, core's watcher started before the load (ADR-0008).
- It starts no program except the one the system names for opening an address (SR-247 AK1, D-068). It reads Git only through core's `git` module, which starts only `git` to read (D-036, SR-248 AK2).
- Its access name is `ui` (ADR-0009). That access is not in `UNCONFINED_ACCESSES`, so SR-142 applies to it (SR-248 AK4). It is not in `FOLLOWED_ACCESSES` either, so reads and writes of the UI are not an agent's access (SR-247 AK11).
- A running `reqseq serve api` or a second `reqseq ui` for the same workspace is allowed. Each process has its own model, the files are the truth, and the watcher of each process keeps its model current (ADR-0008). The UI server writes no `api.json`.

**Before a workspace is open.**
- `reqseq ui` without a workspace starts anyway (SR-247 AK2). A command that needs a workspace is then refused with the API's `workspace.not-found`.
- Choosing a folder (`workspace.listFolder`), opening it and creating a workspace (`workspace.init`) are the exceptions of SR-248 AK4. The UI server runs them before any workspace is open, with the paths the person typed.
- Opening a workspace, at the start or later, calls the command of SR-250 (#2302), so it is listed first by `workspace.recent` (SR-247 AK12).

**Requests.**
- Pages: `GET` and `HEAD` of the built files of `packages/web` only. They hold nothing from a workspace (SR-247 AK6).
- Commands: `POST /api/<command>` with the JSON input, answered as the API answers (ADR-0009: same status codes, same error body).
- Changes: `GET /api/events` is a stream of Server-Sent Events with what core's `onChange` reports. The page then asks the commands again; the event itself carries no workspace data.
- Every other path answers 404 and runs nothing.

**Token.**
- 32 random bytes, base64url, as in `api.json`. It is new on every start and held only in memory.
- The printed and opened address carries it once, in the fragment: `http://127.0.0.1:<port>/#token=<token>`. A browser never sends a fragment, so the token is in no request line and no log. The page reads it, keeps it in `sessionStorage` and removes it from the address (`history.replaceState`). No page file carries it (SR-247 AK8).
- Every request other than a page file carries `Authorization: Bearer <token>`. That includes `/api/events`, which the page reads with `fetch` and a stream reader, because `EventSource` sets no headers. A cookie is never read (SR-247 AK6).
- The token is compared in constant time. A refused request gets 401 and runs nothing.

**Checks on every request, in this order:**
1. The Host header is a loopback address or `localhost`, with the port of the connection (`loopbackHost`, SR-247 AK5).
2. An `Origin` header, if present, is `http://` with the Host of the same request (SR-247 AK7).
3. The token, for everything but a page file (SR-247 AK6).

A refused request runs nothing. The server listens on `127.0.0.1` and, where available, `::1`. There is no option for any other address (SR-247 AK4).

**Response headers.**
- No `Access-Control-Allow-*` on any answer (SR-247 AK9).
- Pages: `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`.
- Command answers: `Cache-Control: no-store`.
- The build writes no inline script or style, so the policy needs no `'unsafe-inline'`.

**Element content (SR-248 AK5).**
- Markdown is rendered by the renderer of the HTML export (`html-export/markdown.ts`): mdast, then an allowlist writer that escapes every text and attribute. It moves to a browser-safe subpath of core, so the UI and the export show a text alike and no Markdown library is added.
- Links are allowed only for http, https and mailto. They open only on a click, in a new browsing context without opener.
- Images come only from the read command for embedded images, a spec change of its own. Until then the page shows a placeholder with the file name.
- Mermaid runs with `securityLevel: "strict"` and without HTML labels, as in the export.
- The server serves no workspace file itself (SR-248 AK2).

**Status and Git.**
- The pages call `element.setStatus` and `element.supersede` only after a confirmed input that names the elements and, when setting, the status (SR-248 AK3, D-030).
- What the UI shows from Git comes from commands: `baseline.compare`, `baseline.changes`, `workspace.check` with `changedSince`, and `workspace.status`.

**Test seam (SR-248 AK1, AK2).** `createUiServer` takes the command runner and a recorder of started programs and opened files as options. Tests pass fakes; `reqseq ui` passes the real ones. No environment variable switches it.

**Front end.**
- TypeScript strict, bundled with Vite, which is already in the toolchain (ADR-0015).
- Hash routes and relative URLs only.
- Browser storage holds preferences only, each with a default.
- One module, `shell`, holds what a desktop shell would do differently: choose a folder, choose where to save a file, open an address. In the browser it uses a path field with completion. A desktop shell (D-083: an extension) would be a second implementation of this module.
- Exports go into the repositories of the workspace (SR-248 AK4). The page proposes `exports/` in the main repository.

**Quality gates (changes ADR-0016).** Typecheck, lint with zero warnings and format, as in every package. `packages/web` is measured and reported but has no coverage threshold, like the `.tsx` components today. Each area of the UI has Playwright tests instead. `ui-server.ts` is adapter code (80 % for `packages/api`).

**Tests (changes ADR-0011).**
- Playwright starts `reqseq ui --no-open --port <n>` on workspaces that `packages/testkit` generates, never on the checkout: a copy of `spec/` with a generated Git history, a workspace with an unusual metamodel, and one without identifiers.
- All UI tests run in Chromium. The tests of SR-247, SR-248, SR-249 AK1 and SR-078 AK3 run in Firefox and WebKit too.
- The browsers are cached in CI, and the tests run with the network blocked.
- Only these contract tests carry AK tags. Appearance and operation are tested, not traced.

**Release (supersedes ADR-0014 from #2308 on).**
- One archive per system: a zip for Windows and macOS, a tar.gz for Linux, still named as ADR-0014's table says. Each holds:
  - the launcher `bin/reqseq`;
  - the official Node binary of the version CI uses, without `npm`, `npx` and `corepack`;
  - the CLI, the MCP server, the UI server and the built pages;
  - the documentation site;
  - `THIRD_PARTY_NOTICES.txt` with Node's `LICENSE`.
- The release workflow downloads the Node archive once per system, checks it against Node's signed `SHASUMS256.txt` and caches it. Nothing is downloaded at install or run time (SR-078 AK2).
- The CLI tarball stays.
- Electron's app data folder goes away. The cache folder and its files stay (ADR-0008).

**Licences (changes ADR-0015, with the first UI pull request).**
- OFL-1.1 is allowed for font files only: IBM Plex Sans and Mono from `@fontsource`. `scripts/licenses/policy.mjs` accepts it only for a package that ships fonts and no code, and its text goes into the notices.
- The Node runtime holds zlib (Zlib) and ICU (Unicode-3.0) as parts of its binary, as Electron did. Shipping no `npm` keeps Artistic-2.0 out.

## Consequences

- `packages/app`, electron-builder and the Electron jobs of CI go with #2310. ADR-0010 and ADR-0014 then describe nothing that is still built.
- The guide may describe the app until the docs step before the v0.13 release (#2309). Its committed images stay as they are, and nothing regenerates them from the Electron tests once those are gone.
- A save dialog for a place outside the repositories, with a desktop shell, needs a spec change of SR-248 AK4.
- Of the prototype, the screens are taken over. Its own Git calls, folder watcher, file serving and export writing are not.

## Rejected

- Proxying a `reqseq serve api` from a second process: two tokens, the API's cache file and a second process to keep alive. The API refuses browser origins on purpose (ADR-0009).
- Token in a cookie: the browser sends it on requests from other sites, and SR-247 AK6 excludes it.
- Token in the query string: it ends up in logs and browser history. The fragment does not.
- Plain JavaScript with type comments: D-083 asks for TypeScript, and the generated command types catch a schema change in the UI.
- `markdown-it`: a second Markdown renderer next to the export's, and its `argparse` is PSF-2.0, outside the allowlist.
- A separate repository for the UI: two versions and two CIs for one delivery, and the contract tests need server and core together.

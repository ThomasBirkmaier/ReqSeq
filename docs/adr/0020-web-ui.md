# ADR-0020: Web UI: server, token, packages and release without Electron

Status: Accepted · Based on: D-083, D-019, D-029, D-030, D-033, D-036, D-068 · SRs: SR-078, SR-080, SR-142, SR-226, SR-247, SR-248, SR-249, SR-250 · Supersedes: ADR-0010, ADR-0014 · Changes: ADR-0001, ADR-0008, ADR-0009, ADR-0011, ADR-0015, ADR-0016

## Context

D-083 replaces the desktop app with a web UI. `reqseq ui` starts a server on the own machine, and the UI is used in the browser.

- The web UI is a thin layer over the catalog commands (SR-248).
- Only the same machine reaches it, and every command needs a token that is new on every start (SR-247).
- The delivery holds the CLI, the MCP server, the web UI and their runtime, without Electron (SR-249).
- Appearance and operation are free (D-083).

The Electron app (ADR-0010) and its delivery (ADR-0014) stay until the web UI ships. #2308 delivers without Electron, and #2310 removes the app. Until then both ADRs describe the code that is still there; this ADR supersedes them.

## Decision

### Packages

- **`packages/web` holds the pages:** browser code in TypeScript, styles, fonts and their build. It holds no program logic (ADR-0002): it calls catalog commands and shows their outputs. It imports only:
  - the generated command types of `@reqseq/core`;
  - core's browser-safe subpaths: `displays` (ADR-0019) and `markdown` (below).
- **`packages/api` holds the UI server,** `src/ui-server.ts`, next to the API server. It shares these parts of the API with it:
  - the loopback Host rule (`loopback.ts`);
  - the token comparison and the parsing of the bearer header;
  - the body limits;
  - the status codes by error class and the error body (ADR-0009).

  Its own are the routes, the Origin rule and the order of the checks below. The API handler stays as it is.
- **`packages/cli` holds `reqseq ui`.** It does what the CLI does before every command: it finds or checks the workspace. Then it starts the UI server. `ui` joins `serve` and `mcp` as a CLI command outside the catalog (ADR-0009).

### Start and stop (SR-247 AK1 to AK3, AK10)

1. The CLI finds the workspace as for every command, unless `--workspace` names one.
2. A named or found folder that is missing or unreadable, or whose workspace file is missing or unreadable, stops the start before the server listens. The CLI reports it as for every command (SR-226 AK1).
3. If no workspace is found and none is named, the server starts without one (SR-247 AK2).
4. Without `--port`, the server takes a free port. With `--port <n>` it takes n, and a busy or invalid port stops the start with its reason.
5. The server listens at once. The model loads in the background (ADR-0008), and commands wait for it as in `reqseq serve api`.
6. The CLI prints the address with the token, then starts the program the system names for opening an address. It starts that program without a shell and passes the address as one argument. If the program cannot start, the server keeps running and prints that. `--no-open` starts nothing.
7. Ctrl-C, SIGTERM (where the system has it) and the end of the terminal stop the server and close the workspace.

### One process

The UI server opens the workspace in its own process, as `reqseq serve api` does: model cache, and core's watcher started before the load (ADR-0008).

**What it starts.** No program except the opener of step 6. Git is read only by core's `git` module, inside catalog commands and the workspace load (D-036). Whether such Git counts as a process of the tool in SR-248 AK2 is the question #2312; this ADR assumes yes.

**Access name `ui` (ADR-0009).**
- `ui` is not in `FOLLOWED_ACCESSES`, so reads and writes of the UI are not an agent's access (SR-247 AK11).
- `ui` is not in `UNCONFINED_ACCESSES`, so SR-142 confines it like API and MCP (SR-248 AK4), with two exceptions held in core (`invoke`, per access and command), not in the server:
  - `workspace.listFolder` and `workspace.init` take a path outside the repositories;
  - the folder that is opened, below.
- `AccessName` is today the `access` enum of `activity.schema.json`, the file format of `activity.json`. It is decoupled from that enum: `ui` is an access name, never a value of the file, because it is not followed.

**Running side by side.** A running `reqseq serve api`, or a second `reqseq ui`, for the same workspace is allowed. Each process has its own model, the files are the truth, and each process's watcher keeps its model current (ADR-0008). The UI server writes no `api.json`.

### Workspaces

- **No workspace open.** Only commands that need no workspace run: `tool.info`, `tool.guide`, `workspace.recent`, `workspace.listFolder` and `workspace.init`. Every other command gets core's `workspace.not-found` (class `not-found`, 404).
- **Opening and switching: `POST /ui/workspace` with `{ "path" }`.**
  1. The server checks the folder as step 2 of the start does.
  2. It aborts running reads, lets running writes finish, closes the old workspace and its watcher, and opens the new one.
  3. It calls the command of SR-250 (#2302), so the workspace is first in `workspace.recent` (SR-247 AK12).
  4. It sends a `workspace` event.
- **A generation number per open workspace.** It goes to every page with the event and in the answer of `POST /ui/workspace`. Every command request carries it in `X-ReqSeq-Workspace`; one with another number gets `409` with `workspace.changed`. So a tab that has not seen a switch never writes into the other workspace.
- **Creating** a workspace is `workspace.init` with the folder the person names. Its places above the folder (skill files at the Git root) follow `init`'s own rules for `ctx.localPaths`, with the `ui` exception above. Nothing else is created outside the repositories.

### Requests

| Route | What it does | Token |
| --- | --- | --- |
| `GET`, `HEAD` of a page file | Served only from the manifest of the built files that the server reads at start, never from a join of the URL path, with a fixed `Content-Type` per extension; `/` is `index.html`. Page files hold nothing from a workspace (SR-247 AK6). | no |
| `POST /api/<command>` | The JSON input of a catalog command, answered as the API answers (ADR-0009). | yes |
| `POST /ui/workspace` | Open or switch the workspace (above). | yes |
| `GET /api/events` | Server-Sent Events: `change` with the scope and UUIDs that core's `onChange` reports (no texts or values), and `workspace` with the new generation. | yes |
| anything else | 404, nothing run | |

The page files lie in `lib/web/` of the delivery and in `packages/web/dist/` of a checkout.

### Checks on every request, in this order

1. The Host header is a loopback address or `localhost` with the port of the connection (`loopbackHost`, SR-247 AK5).
2. An `Origin` header, if present, is `http://` with the Host of the same request (SR-247 AK7). `Origin: null` is refused.
3. `Sec-Fetch-Site: cross-site` is refused on everything but a page file.
4. The token is required for everything but a page file (SR-247 AK6).

A refused request runs nothing and gets 403 (Host, Origin, fetch site) or 401 (token). The server listens on `127.0.0.1` and, where available, `::1`. No option names another address (SR-247 AK4).

### Token

- **Form:** 32 random bytes, base64url, as in `api.json`. It is new on every start and held only in memory.
- **Passing it to the page:** the printed and opened address carries it once, in the fragment: `http://127.0.0.1:<port>/#token=<token>`. A browser does not send a fragment, so the token appears in no request line, server log or Referer, and no page file carries it (SR-247 AK8). The page reads it before the hash router runs, keeps it in `sessionStorage` and removes it from the address (`history.replaceState`).
- **Accepted exposure:** the first history entry and the opener's arguments hold the token for local users. It dies with the process.
- **Sending it:** every request other than a page file carries `Authorization: Bearer <token>`. That includes `/api/events`, which the page reads with `fetch` and a stream reader, since `EventSource` sets no headers. A cookie is never read (SR-247 AK6).
- **Checking it:** in constant time.
- **No token in the page, or a refused one:** this happens after a restart on the same port, with an address typed without the fragment, or when moving between `localhost` and `127.0.0.1`. The page then says to open the printed address, and calls nothing more.

### Response headers

- **Every answer:**
  - `X-Content-Type-Options: nosniff`;
  - `Cross-Origin-Resource-Policy: same-origin`;
  - `Content-Security-Policy` with `frame-ancestors 'none'`;
  - no `Access-Control-Allow-*` (SR-247 AK9).
- **Pages:**
  - `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
  - `X-Frame-Options: DENY`;
  - `Referrer-Policy: no-referrer`.

  `'unsafe-inline'` for styles is needed because KaTeX writes `style` attributes and Mermaid writes `<style>` into its SVG. Scripts stay `'self'`, and every source stays the own server; `blob:` for images only admits images the page builds from an answer of its server (SR-247 AK9). The build inlines no asset as `data:` (`build.assetsInlineLimit: 0`), and KaTeX's fonts are files.
- **Command answers:** `Cache-Control: no-store`.

### Element content (SR-248 AK5)

- **Plain text by default.** Every string from a command output goes into the DOM as text, never through `innerHTML`: titles, property values, messages, IDs, Mermaid source.
- **Rendered Markdown:** only the element text and properties marked `markdown`. They go through the renderer of the HTML export: mdast, then an allowlist writer that escapes every text and attribute.
  - The renderer moves to the subpath `@reqseq/core/markdown`. The helpers it imports through `model/index.ts` (`imageLink`, `isUuid`, `referenceRepository`) move to import-free modules first.
  - A `reqseq:` reference becomes a hash route to its element.
- **Links:** only http, https and mailto. They open only on a click, in a new browsing context without opener.
- **Images:** only through the read command for embedded images, a spec change of its own. Until then the page shows a placeholder with the file name. The server serves no workspace file itself (SR-248 AK2).
- **Formulas and diagrams:** KaTeX as in the export. Mermaid runs with `securityLevel: "strict"` and without HTML labels; it is pinned exactly, and an upgrade is reviewed, because it runs in the token's origin.

### Status and Git

- The pages call `element.setStatus` and `element.supersede` only after a confirmed input that names the elements and, when setting, the status (SR-248 AK3, D-030).
- What the UI shows from Git comes from commands: `baseline.compare`, `baseline.changes`, `workspace.check` with `changedSince`, and `workspace.status`.
- While it only reads or changes elements, the UI asks for no `versionDate` or `hintDates`.

### Test seam (SR-248 AK1, AK2)

- `createUiServer` takes the command runner as an option. Tests pass one with given outputs (AK1).
- Programs and files are recorded at process level: the test starts `reqseq ui` with a `node --import` preload of the test kit that wraps `child_process` and `fs` (AK2). The product has no switch for it.

### Front end

- TypeScript strict, bundled with Vite, which is already in the toolchain (ADR-0015).
- Hash routes and relative URLs only. Browser storage holds preferences only, each with a default.
- One event stream per browser: the tabs share it through a `BroadcastChannel`, so they do not use up the browser's connections per origin.
- One module, `shell`, holds what a desktop shell would do differently: choose a folder, choose where to save a file, open an address. In the browser it uses a path field with completion. A desktop shell (D-083: an extension) would be a second implementation of this module.
- **Exports** go into the repositories of the workspace (SR-248 AK4); the page proposes `exports/` in the main repository. After an export the page shows the path that was written, as text. It writes no `.gitignore`.

### Quality gates (changes ADR-0016)

- Typecheck, lint with zero warnings and format, as in every package.
- `packages/web` is measured and reported but has no coverage threshold, like the `.tsx` components. Each area of the UI has Playwright tests instead.
- `ui-server.ts` is adapter code (80 % for `packages/api`).

### Tests (changes ADR-0011)

- **Workspaces:** Playwright starts `reqseq ui --no-open` and reads the address from standard output. The workspaces come from `packages/testkit`, never the checkout:
  - a copy of `spec/` with a generated Git history;
  - a workspace with an unusual metamodel;
  - a workspace without identifiers.
- **Browsers:** all UI tests run in Chromium. The tests of SR-248, SR-249 AK1 and SR-078 AK3 run in Firefox and WebKit too.
- **SR-247:** its tests are in the CLI e2e suite (`packages/cli/test/e2e/ui.test.ts`) on the three systems. They start the built `reqseq ui` and send raw HTTP requests, because a browser sends no forged Host, Origin or token header, and the start, the port and the signals are the process's, not the page's.
- **SR-078 AK3:** each browser context routes every request to a non-loopback address to a recorder that refuses it. The server runs in a network namespace with loopback only (Linux), as the delivery tests do.
- **Network:** the browsers are cached in CI, and the tests run with the network blocked.
- **Tags:** only these contract tests carry AK tags. Appearance and operation are tested, not traced.

### Release (supersedes ADR-0014 from #2308 on)

| What | Name |
| --- | --- |
| Artifacts | `ReqSeq-<version>-mac-arm64.zip`, `ReqSeq-<version>-win-x64.zip`, `ReqSeq-<version>-linux-x64.tar.gz` (one folder `ReqSeq-<version>-<system>/`), `reqseq-cli-<version>.tgz`, `SHA256SUMS.txt` |
| Launcher | `bin/reqseq` (macOS, Linux), `bin\reqseq.cmd` (Windows) |
| Runtime | `runtime/` with Node's `node` or `node.exe`, without `npm`, `npx` and `corepack` |
| Program | `lib/` with CLI, MCP server and UI server; `lib/web/` with the pages; `lib/docs/` with the documentation site |
| Notices | `THIRD_PARTY_NOTICES.txt`, with Node's full `LICENSE` |

- **Node binary:**
  - The exact Node version and the SHA-256 of each system's archive are pinned in `toolchain/packaging/`.
  - The release workflow downloads each archive once, checks it against the pin, and caches it.
  - Nothing is downloaded at install or run time (SR-078 AK2).
- **Launcher:** it runs the CLI on the shipped binary and unsets `NODE_OPTIONS`, so options from the environment cannot change the program.
- **Signing:** the Node binaries keep the signatures of the Node project. The archives are not signed by us.
- **Quarantine:** removing the macOS quarantine flag after unpacking is a one-time step of the install guide (SR-249 AK1).
- **Data folders:** Electron's app data folder goes away. The cache folder and its files stay (ADR-0008).

### Licences (changes ADR-0015, with the first UI pull request)

- **Fonts:** OFL-1.1 is allowed for font files only (IBM Plex Sans and Mono from `@fontsource`). `scripts/licenses/policy.mjs` accepts it only for a package that ships fonts and no code, and its text goes into the notices.
- **Node runtime:** like Electron before, it is checked outside the npm allowlist and ships with its full `LICENSE`. Its parts (V8, OpenSSL, libuv, zlib, ICU and others) are under permissive licences. Shipping no `npm` keeps Artistic-2.0 out.

## Consequences

- `packages/app`, electron-builder and the Electron jobs of CI go with #2310. ADR-0010 and ADR-0014 then describe nothing that is still built.
- `tool.info` reports the Electron and Chromium versions (`versions.app`), and SR-161 AK1 asks for them. Changing that needs a spec change, with #2310.
- The guide may describe the app until the docs step before the v0.13 release (#2309). Its committed images stay as they are.
- A save dialog for a place outside the repositories, with a desktop shell, needs a spec change of SR-248 AK4.

## Rejected

- **Proxying a `reqseq serve api` from a second process:** two tokens, the API's cache file, and a second process to keep alive. The API refuses browser origins on purpose (ADR-0009).
- **One handler for API and UI:** the API refuses every `Origin` and has no page files and no state without a workspace. Options for all of that would blur the API's rules.
- **Token in a cookie:** the browser sends it on requests from other sites, and SR-247 AK6 excludes it.
- **Token in the query string:** it would appear in request lines and logs.
- **Plain JavaScript with type comments:** D-083 asks for TypeScript, and the generated command types catch a schema change in the UI.
- **`markdown-it`:** a second Markdown renderer next to the export's.
- **A separate repository for the UI:** two versions and two CIs for one delivery, and the contract tests need server and core together.

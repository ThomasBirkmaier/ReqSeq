# @logreq/cli

The `logreq` command line (ADR-0009). It is a generic adapter over the command catalog of `@logreq/core`: every catalog command is a subcommand, and the CLI has no logic of its own (ADR-0002).

```sh
logreq --help                        # groups of the catalog
logreq element --help                # commands of a group; not yet implemented ones are marked
logreq workspace init my-ws "My workspace"   # new workspace with the standard model in the existing folder my-ws
logreq workspace status              # the workspace of the current folder (or of a folder above it)
logreq element get SR-46fb54         # required string fields are positional
logreq workspace check --json        # every finding of the workspace; exit code 1 on an error
logreq trace chain N-46fb54          # the chain as an indented tree, gaps and cycles marked
logreq hint list                     # one line per open hint: element, kind, reason, hint ID
logreq hint confirm --target N-46fb54   # confirm every outdated relation to N-46fb54 after a change
logreq element create need --title "See the wind"   # a positional field can be given as a flag too
logreq workspace check --fail-on warning  # exit code 1 on a warning too (default: error; info is the lowest)
logreq workspace check --severity error   # show errors only and count the rest; the exit code is --fail-on's
logreq workspace activity              # the element an agent read or changed last through the API or MCP (SR-117)
logreq workspace recent                # the workspaces the app opened last, from any folder (SR-131)
logreq element update SR-46fb54 --input @change.json   # objects only via --input (JSON, @file or - for stdin)
```

- Subcommand `logreq <group> <action>`; the action is kebab-case (`element set-status`).
- Output: compact lines by default (ADR-0009, `src/present.ts`), `--yaml` for the whole output as YAML, `--json` for exactly the command output. In the compact form:
  - an element is one line, `SHORT-ID  status  title`, with its identifier next to the short ID when it has one (`SR-0b0036 (SR-036)  draft  title`, #305; also for relations, chain nodes and hints); `element get` adds its details below (`id`, type, `file`, version, properties, relations one line each, text); affected elements carry their distance and how they point at the element before them on their path, `[via derives-from from SR-00b002]` (without `from` at distance 1);
  - a chain is an indented tree with the depth in front, marked `[gap: no evidence]`, `[gap: no child]`, `[not expanded]`, `[cycle]` and `[listed elsewhere]`; on a later page an element whose parent is on another page is not nested and shows `[under X]`, and edges from another page show as `[cycle from X]` or `[also under X]` (X by short ID when on the page, else UUID);
  - a hint is one line: element short ID, kind, message, `hint: <id>`; each problem is printed once, as `severity  code  repository:file:line  message  (element SR-46fb54)`, the element by its short ID (by its UUID only when core gives none) and its identifier when it has one (`(element SR-0b0036, identifier SR-036)`).
- Element arguments take a UUID, a short ID or an identifier such as `SR-036` (#305), in any case: `logreq element get SR-036`.
- Options come after the command: `--json` (exactly the command output), `--yaml`, `--workspace <path>`, `--input <json|@file|->`, and one `--<field>` per scalar input field (`--x`/`--no-x` for booleans, repeat the flag for arrays).
- A field that may also be `null` keeps its scalar form; `null` itself only via `--input` (`logreq element set-status --refs T-1a2b3c --input @status-null.json` with `{"status": null}` removes a status line, #343).
- With `--input`, positional values fill the positional fields that `--input` does not give, in order; flags override fields of `--input`. A positional field can also be given as `--<field>`; then the arguments fill the other positional fields.
- Local file and folder fields (`common.schema.json#/$defs/localPath`, e.g. `workspace init <path>`, `evidence enrich-junit <file>`) are relative to the current folder; the CLI passes them on as absolute paths.
- Workspace: `--workspace`, else the nearest folder upwards with `logreq-workspace.yaml`, else the current folder.
- Exit codes: `0` no error findings, `1` an error finding or `ok: false` (`workspace check` sets it for a finding at or above `--fail-on`, default `error`, shown or not), `2` usage or input error (every error class but `internal`), `3` internal error, `4` a given commit is not available locally (`workspace check --changed-since`, SR-092), `130` aborted (Ctrl-C). See ADR-0009.
- While the metamodel is faulty or missing, `workspace check` reports its errors, the file findings and duplicate IDs only, not the findings that need the metamodel (unknown or missing properties, values, relations); they return once the metamodel is fixed.
- `--input -` reads standard input to its end and does not watch the abort signal: Ctrl-C while the CLI waits for input ends the process through the second-signal path (exit code 130).
- Output is UTF-8 without colors. Problems go to stdout, errors to stderr. A closed pipe (`logreq ... | head`) ends quietly.

### Servers

- `logreq serve api [--port <n>] [--workspace <path>]`: the local API on `127.0.0.1` and `::1` (`@logreq/api`); prints the URLs and the path of `api.json` (port and token) in the cache folder of the workspace. It refuses at once a wrong `--port` and another API for the copy that runs or starts, then prints `Loading the workspace...` to stderr and loads the workspace (`warmWorkspace`: metamodel, element store, short IDs, incoming relations; the search index then builds in the background) before it listens, so an answer means the workspace is usable (SR-082); stopped meanwhile, it never listens and exits 0 once the running load has finished. Runs until Ctrl-C or SIGTERM, then exits 0.
- `logreq mcp [--workspace <path>]`: the MCP server on standard input and output (`@logreq/mcp`). It starts loading the workspace at once but does not wait for it, so a cold load does not hold up the handshake; the first tool call waits. Runs until standard input ends or Ctrl-C, then exits 0.
- Model cache (ADR-0008, SR-082): every command and server opens its workspace with the cache folder of the copy (`new Workspace(root, { cacheFolder: cacheFolder(root) })`), so the element store is loaded through `model.json` there and the cache is written again after a load with many changed files; a one-shot command waits for that write before it exits. The cache takes about 75 MB per copy at 50,000 elements and holds a copy of every element's frontmatter (not its text), readable only by the user. Caches of moved or deleted copies are not removed (stage 1); deleting `<cache>/logreq/` is always safe.
- These are the only commands outside the catalog; no catalog group may be named `serve` or `mcp`. There is no option for the address (SR-079 AK3).

### Windows shells

- `cmd.exe` treats `^` as escape character: write `HEAD~1` instead of `HEAD^`, or `HEAD^^`.
- PowerShell and `cmd.exe` remove or change quotes inside arguments, so inline JSON (`--input '{"a":1}'`) often arrives broken. Put the JSON into a file and use `--input @file.json`, or pipe it in with `--input -`. Files written by Windows PowerShell (`>`, `Out-File`) are UTF-16; the CLI reads them.

## Code

- `src/bin.ts`: the binary; connects the process (`src/process.ts`: closed pipes, Ctrl-C) and calls `runCli`.
- `src/main.ts`: `runCli(options)`: parse, invoke, print, exit code (`EXIT`, `exitCodeFor`). Also exported for in-process callers.
- `src/program.ts`: the commander tree generated from `runtime.contracts.commands`.
- `src/fields.ts`: positional, flag or `--input` only, from the JSON Schema of each input field.
- `src/input.ts`, `src/render.ts`, `src/present.ts`: command input from the arguments; output (`--json`, `--yaml`, and the compact default by the shape of the output), errors and the exit code of the output.
- `src/argv.ts`: `argvFor(entry, input)`, the arguments for a command input (cross-access test).
- `src/main.ts` also starts the servers (`serve api`, `mcp`) for the subcommands of `src/program.ts`.

## Tests

- Unit tests next to the code (`src/*.test.ts`, 100 % coverage) use a test-only catalog with `createCommandRuntime`.
- `test/cross-access.test.ts` runs every catalog command through core, the CLI, the API and MCP and compares the results (SR-080 AK2); add scenarios there when you implement a command.
- End-to-end tests in `test/e2e/` spawn the built binary: `pnpm build && pnpm test:e2e`. `test/e2e/support/test-bin.mjs` runs the same `runCli` from `dist/` with test implementations of real catalog commands where the product command does not exist yet. On Linux CI the suite runs inside `unshare -rn` with only loopback up.

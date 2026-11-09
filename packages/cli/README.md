# @reqseq/cli

The `reqseq` command line (ADR-0009). It is a generic adapter over the command catalog of `@reqseq/core`: every catalog command is a subcommand `reqseq <group> <action>`, and the CLI has no logic of its own (ADR-0002).

**Users:** the commands, their arguments, output and help are in the generated command reference of the documentation site, https://thomasbirkmaier.github.io/ReqSeq/reference/commands/. This README is for developers of this repository.

## Build and run

```sh
pnpm build                                        # from the repository root
node packages/cli/dist/bin.js --help              # groups of the catalog
node packages/cli/dist/bin.js element get SR-036 --workspace spec
```

## Behaviour the code implements

- Arguments (`src/fields.ts`, `src/input.ts`): required string fields are positional, every scalar field is also `--<field>` (`--x`/`--no-x`, repeated for arrays), a map (`additionalProperties` without `properties`) is a repeated `--<field> key=value` with the value as JSON when it parses, else as text (`--set` on `element create` and `element update`, named by the catalog argument's `flag`), (`--set version=1.10` is the number 1.1, `--set 'version="1.10"'` the text; a repeated key keeps its last value), a Markdown text (`contentMediaType`) also takes `@file` and `-` (`--text @d.md`; a text that is `-` or starts with `@` only via `--input`), a selection, a filter condition and sort keys by their parts (`--ids`, `--filter`, `--package`, `--baseline`, `--view`, `--where <json|@file|->`, `--where-type`, `--where-status`, `--sort <by>[:asc|desc]`; key flags are added to the condition with `all`, #149, #173), other objects and `null` only via `--input <json|@file|->`. Flags override `--input`, `--set` key by key, selection flags property by property. Too many arguments are `input.invalid` with the form of the call (`the form is reqseq element set-status <status> --refs <refs>... [options]`). Local path fields are made absolute against the current folder. Element arguments take a UUID, short ID or identifier.
- Output (`src/render.ts`, `src/present.ts`): compact lines by default, `--json` (exactly the command output), `--yaml`, `--jsonl` where the catalog entry has `jsonLines`; written in pieces with back-pressure (#277). UTF-8; problems to stdout, errors to stderr; a closed pipe ends quietly.
- Terminal layout (`src/style.ts`, #988): only when stdout is a terminal and `TERM` is not `dumb`, the compact lines take a terminal layout, styled with Node's `util.styleText` when `NO_COLOR` is not set (an empty one counts as not set) and the terminal has colours (`hasColors`, which reads `FORCE_COLOR` and `NODE_DISABLE_COLORS`); with `NO_COLOR` the layout stays and only the colours go: an element line names the identifier first (strong) with the short ID faint, the status in a column as wide as the list needs, and the title cut with `…` to the terminal width (whole when details follow, as in `element get` and `--with-text`, or when too little room is left); a tree list draws `├ └ │`, an element whose parent is not shown before it starts a tree of its own; a grouped list heads each group at the left (title strong, identifier, short ID and count faint) with a blank line before it; hints and problems show the severity first, coloured by it. In a pipe or a file, the output is the plain text as before, byte for byte, and never cut; `--json`, `--jsonl` and `--yaml` are never styled. Matrix, chain, graph and the comparisons keep the plain layout on a terminal for now. `bin.ts` asks the process once (`terminalOf`) and passes the terminal to `runCli` (`terminal`), so the renderers read no global state.
- Workspace: `--workspace`, else the nearest folder upwards with `reqseq-workspace.yaml`, else the current folder. Every command opens it with the model cache of the copy (ADR-0008, SR-082).
- Exit codes (`EXIT` in `src/main.ts`, ADR-0009): `0` ok, `1` error finding or `ok: false`, `2` usage or input error, `3` internal, `4` commit not available locally, `130` aborted.
- Servers, the only commands outside the catalog (no catalog group may be named `serve` or `mcp`): `reqseq serve api` loads the workspace before it listens (SR-082), `reqseq mcp` loads it in the background so the handshake is not held up. `reqseq serve docs [--port <n>]` serves the documentation of the delivery, the `docs` folder of the CLI package (`DOCS_FOLDER`), on `127.0.0.1` only and prints `ReqSeq documentation on http://127.0.0.1:<port>/` (SR-141, ADR-0017); it needs no workspace, and without that folder (a checkout) it exits 2 with `file.folder-missing`. There is no option for another folder; in-process callers pass `docsFolder`.
- Windows shells: `cmd.exe` escapes with `^` (`HEAD~1` instead of `HEAD^`), and PowerShell and `cmd.exe` break inline JSON, so use `--input @file.json` or `--input -`. UTF-16 files from PowerShell are read.

## Code

- `src/bin.ts`: the binary; enables Node's compile cache in `<OS cache>/reqseq/node-compile-cache` before it loads the rest (#178, ADR-0008 cache), connects the process (`src/process.ts`: closed pipes, Ctrl-C) and calls `runCli`.
- `src/main.ts`: `runCli(options)`: parse, invoke, print, exit code (`EXIT`, `exitCodeFor`); also starts the servers. Exported for in-process callers.
- `src/program.ts`: the commander tree generated from `runtime.contracts.commands`.
- `src/fields.ts`, `src/input.ts`: positional, flag or `--input` only, from the JSON Schema of each input field.
- `src/render.ts`, `src/present.ts`: the output formats, errors and the exit code of the output; `src/style.ts`: the terminal style.
- `src/argv.ts`: `argvFor(entry, input)`, the arguments for a command input (cross-access test).

## Tests

- Unit tests next to the code (`src/*.test.ts`, 80 % coverage for the package, ADR-0016) use a test-only catalog with `createCommandRuntime`: `pnpm vitest run packages/cli/src --reporter=dot`.
- `test/cross-access.test.ts` runs every catalog command through core, the CLI, the API, MCP and the app and compares the results (SR-080 AK2). When you implement a command, add its scenarios in a module of its own, `test/cross-access/scenarios/<group>/<command>.ts`, which calls `scenariosOf`; fixtures that several commands use are in `test/cross-access/fixtures.ts`.
- End-to-end tests in `test/e2e/` spawn the built binary: `pnpm build && pnpm test:e2e`. `test/e2e/support/test-bin.mjs` runs the same `runCli` from `dist/` with test implementations of real catalog commands where the product command does not exist yet. On Linux CI the suite runs inside `unshare -rn` with only loopback up.
- The JUnit guide (SR-063: the how-to `docs/guide/how-to/record-test-results-in-ci.md` and the example `toolchain/junit/`) is checked end to end by `test/e2e/toolchain-junit.test.ts`.

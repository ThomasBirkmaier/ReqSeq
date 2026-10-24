# @logreq/cli

The `logreq` command line (ADR-0009). It is a generic adapter over the command catalog of `@logreq/core`: every catalog command is a subcommand, and the CLI has no logic of its own (ADR-0002).

```sh
logreq --help                        # groups of the catalog
logreq element --help                # commands of a group; not yet implemented ones are marked
logreq workspace status              # the workspace of the current folder (or of a folder above it)
logreq element get SR-46fb54         # required string fields are positional
logreq workspace check --changed-since HEAD~1 --changed-files a.md --changed-files b.md --json
logreq element update SR-46fb54 --input @change.json   # objects only via --input (JSON, @file or - for stdin)
```

- Subcommand `logreq <group> <action>`; the action is kebab-case (`element set-status`).
- Options come after the command: `--json` (exactly the command output), `--workspace <path>`, `--input <json|@file|->`, and one `--<field>` per scalar input field (`--x`/`--no-x` for booleans, repeat the flag for arrays).
- With `--input`, positional values fill the positional fields that `--input` does not give, in order; flags override fields of `--input`.
- Local file and folder fields (`common.schema.json#/$defs/localPath`, e.g. `workspace init <path>`, `evidence enrich-junit <file>`) are relative to the current folder; the CLI passes them on as absolute paths.
- Workspace: `--workspace`, else the nearest folder upwards with `logreq-workspace.yaml`, else the current folder.
- Exit codes: `0` no error findings, `1` an error finding or `ok: false`, `2` usage or input error (every error class but `internal`), `3` internal error, `130` aborted (Ctrl-C); `4` is reserved for SR-092. See ADR-0009.
- Output is UTF-8 without colors. Problems go to stdout, errors to stderr. A closed pipe (`logreq ... | head`) ends quietly.

### Windows shells

- `cmd.exe` treats `^` as escape character: write `HEAD~1` instead of `HEAD^`, or `HEAD^^`.
- PowerShell and `cmd.exe` remove or change quotes inside arguments, so inline JSON (`--input '{"a":1}'`) often arrives broken. Put the JSON into a file and use `--input @file.json`, or pipe it in with `--input -`. Files written by Windows PowerShell (`>`, `Out-File`) are UTF-16; the CLI reads them.

## Code

- `src/bin.ts`: the binary; connects the process (`src/process.ts`: closed pipes, Ctrl-C) and calls `runCli`.
- `src/main.ts`: `runCli(options)`: parse, invoke, print, exit code (`EXIT`, `exitCodeFor`). Also exported for in-process callers.
- `src/program.ts`: the commander tree generated from `runtime.contracts.commands`.
- `src/fields.ts`: positional, flag or `--input` only, from the JSON Schema of each input field.
- `src/input.ts`, `src/render.ts`: command input from the arguments; output, errors and the exit code of the output.
- `src/argv.ts`: `argvFor(entry, input)`, the arguments for a command input (cross-access test).

## Tests

- Unit tests next to the code (`src/*.test.ts`, 100 % coverage) use a test-only catalog with `createCommandRuntime`.
- End-to-end tests in `test/e2e/` spawn the built binary: `pnpm build && pnpm test:e2e`. `test/e2e/support/test-bin.mjs` runs the same `runCli` from `dist/` with test implementations of real catalog commands where the product command does not exist yet. On Linux CI the suite runs inside `unshare -rn` with only loopback up.

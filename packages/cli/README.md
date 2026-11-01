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

- Arguments (`src/fields.ts`, `src/input.ts`): required string fields are positional, every scalar field is also `--<field>` (`--x`/`--no-x`, repeated for arrays), objects and `null` only via `--input <json|@file|->`. Flags override `--input`. Too many arguments are `input.invalid` with the form of the call (`the form is reqseq element set-status <status> --refs <refs>... [options]`). Local path fields are made absolute against the current folder. Element arguments take a UUID, short ID or identifier.
- Output (`src/render.ts`, `src/present.ts`): compact lines by default, `--json` (exactly the command output), `--yaml`, `--jsonl` where the catalog entry has `jsonLines`; written in pieces with back-pressure (#277). UTF-8 without colors; problems to stdout, errors to stderr; a closed pipe ends quietly.
- Workspace: `--workspace`, else the nearest folder upwards with `reqseq-workspace.yaml`, else the current folder. Every command opens it with the model cache of the copy (ADR-0008, SR-082).
- Exit codes (`EXIT` in `src/main.ts`, ADR-0009): `0` ok, `1` error finding or `ok: false`, `2` usage or input error, `3` internal, `4` commit not available locally, `130` aborted.
- Servers, the only commands outside the catalog (no catalog group may be named `serve` or `mcp`): `reqseq serve api` loads the workspace before it listens (SR-082), `reqseq mcp` loads it in the background so the handshake is not held up.
- Windows shells: `cmd.exe` escapes with `^` (`HEAD~1` instead of `HEAD^`), and PowerShell and `cmd.exe` break inline JSON, so use `--input @file.json` or `--input -`. UTF-16 files from PowerShell are read.

## Code

- `src/bin.ts`: the binary; connects the process (`src/process.ts`: closed pipes, Ctrl-C) and calls `runCli`.
- `src/main.ts`: `runCli(options)`: parse, invoke, print, exit code (`EXIT`, `exitCodeFor`); also starts the servers. Exported for in-process callers.
- `src/program.ts`: the commander tree generated from `runtime.contracts.commands`.
- `src/fields.ts`, `src/input.ts`: positional, flag or `--input` only, from the JSON Schema of each input field.
- `src/render.ts`, `src/present.ts`: the output formats, errors and the exit code of the output.
- `src/argv.ts`: `argvFor(entry, input)`, the arguments for a command input (cross-access test).

## Tests

- Unit tests next to the code (`src/*.test.ts`, 80 % coverage for the package, ADR-0016) use a test-only catalog with `createCommandRuntime`: `pnpm vitest run packages/cli/src --reporter=dot`.
- `test/cross-access.test.ts` runs every catalog command through core, the CLI, the API and MCP and compares the results (SR-080 AK2); add scenarios there when you implement a command.
- End-to-end tests in `test/e2e/` spawn the built binary: `pnpm build && pnpm test:e2e`. `test/e2e/support/test-bin.mjs` runs the same `runCli` from `dist/` with test implementations of real catalog commands where the product command does not exist yet. On Linux CI the suite runs inside `unshare -rn` with only loopback up.
- The JUnit guide `toolchain/junit/README.md` (SR-063) is checked end to end by `test/e2e/toolchain-junit.test.ts`.

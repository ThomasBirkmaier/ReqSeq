---
title: CLI, API and MCP
description: How the command line, the local API and the MCP server find the workspace, take input, give output and report errors.
sidebar:
  order: 2
---

The command line, the local API and the MCP server run the commands of the app's command prompt, with the same input and the same output. The [command reference](/reference/commands/) shows each command in all four; this page says what they share.

## The workspace

A workspace is the folder with `reqseq-workspace.yaml`. Without `--workspace`, ReqSeq looks for that file in the current folder and then in each folder above it; when none has it, the current folder is the workspace, as `reqseq workspace init .` needs. `--workspace <folder>` names it instead. `reqseq serve api` and `reqseq mcp` find it the same way when they start.

## CLI

`element.create` is `reqseq element create`. Required texts are positional, the other fields of the input are flags, and `--help` lists them. `--input` takes the whole input as JSON, inline, from a file (`@input.json`) or from standard input (`-`), and a flag next to it replaces that field. An object without a flag of its own goes only through `--input`. PowerShell and `cmd.exe` break inline JSON; use a file there.

```sh
reqseq workspace init . "Weather station"
reqseq element create need --input '{"title":"See the wind speed","text":"From the JSON."}' --text "As a sailor, I want to see the wind speed."
```

```text title="Output"
N-7fe707  draft  See the wind speed  [validation: open]
files:
  need/N-d0e44b7fe707.md
No problems.
```

The element gets the text of the flag. By default the output is short lines for people; `--json` prints exactly the output of the command, as the API and MCP give it, for scripts. Problems go to standard output with the rest; an error goes to standard error, as JSON with `--json`. The [problem and error codes](/reference/problem-codes/) explain each.

The exit code:

- `0`: done, without an error finding.
- `1`: done, but with a problem of severity error or `ok: false`. `workspace check --fail-on warning` lets warnings fail too ([Check a workspace in CI](/how-to/check-a-workspace-in-ci/)).
- `2`: not run, because of wrong usage or input, such as an unknown option or element.
- `3`: an internal error.
- `4`: a given Git revision is in no repository of the workspace.
- `130`: stopped with Ctrl-C.

## API

`reqseq serve api` runs the local API of one workspace until Ctrl-C. It listens on `127.0.0.1` and `::1` only, so only programs on the same computer reach it. It prints the path of `api.json`, which holds the port and a new token per start, in the folder `reqseq/<hash>/` of `~/Library/Caches` on macOS, `~/.cache` on Linux and `%LOCALAPPDATA%` on Windows ([API endpoint file](/reference/formats/api-endpoint/)). A second API for the same workspace does not start.

A command is a `POST` with the token and the input as JSON:

```http
POST /v1/commands/element.get
Authorization: Bearer <token>

{ "ref": "N-7fe707" }
```

The answer is the output of the command, as with `--json`, with status 200, also when it reports problems or `ok: false`. An error is the same error object as on the command line, with 400 for invalid input, 404 for something that does not exist and 401 for a wrong token.

## MCP

`reqseq mcp` serves MCP over standard input and output and opens no port. The client starts it with the workspace:

```json
{ "mcpServers": { "reqseq": { "command": "reqseq", "args": ["mcp", "--workspace", "/path/to/workspace"] } } }
```

A client that does not find `reqseq` on the path needs its absolute path, and on Windows the app's runtime: see [Install ReqSeq](/how-to/install-reqseq/#mcp). Each command is a tool, named with `_` for the dot (`element_create`, `evidence_enrichJunit`), whose arguments are the input. The result is the output; an error is a tool error with the same error object.

## Paths through the API and MCP

Through the API and MCP, a file path, such as that of a ReqIF or JUnit file, must lie inside a repository of the workspace, also after `..` or a symbolic link, so that instructions hidden in an element text cannot lead an agent elsewhere. A relative path counts from the workspace folder; `~` and a path outside give `input.invalid`, so copy such a file into the repository. The command line takes any path.

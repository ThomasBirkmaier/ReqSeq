---
title: Connect an AI agent
description: Print the ready-made setup that lets an AI agent's client start the MCP server of ReqSeq for a workspace.
---

An agent works with ReqSeq through its client, which starts the MCP server (`reqseq mcp`) for a workspace. **Connect AI agent** prints what to enter in the client, with the absolute paths of the ReqSeq that runs it and of the workspace. It creates and changes no file, the client's included, and opens no connection.

| Client | Value | Setup |
|---|---|---|
| Claude Code | `claude-code` | a command for the terminal |
| VS Code | `vscode` | a command for the terminal |
| Codex CLI | `codex-cli` | a command for the terminal |
| Claude Desktop | `claude-desktop` | a JSON block and the file on this system it belongs in |
| Cursor | `cursor` | a JSON block and the file on this system it belongs in |
| Other | `other` | a JSON block in the common `mcpServers` form |

Run Claude Code's command in the folder where you start Claude Code. For every client but Claude Desktop, the output also names a terminal command with the same absolute paths, `tool guide --skill --write` for the workspace, which writes the skill file `managing-requirements`. On Windows each command is for PowerShell. In a workspace without the skill file, the call writes it; a file there that ReqSeq did not write, or that was changed since, is overwritten only with `--replace`. Add a JSON block under `mcpServers` of the file, keeping the other entries, and restart the client.

The setup holds as long as ReqSeq stays where it is: after a move, print it again. The server is named `reqseq`, so a second workspace in the same client needs another name.

A path with `&`, `^`, `%`, `<`, `>`, `|` or `!` cannot pass VS Code's command on Windows; choose `other` and add its block to VS Code by hand.

## An entry for .mcp.json

For Claude Code, the output also gives an entry for `.mcp.json`, for a Git repository checked out on machines where `reqseq` is on the PATH, such as a cloud container that installs ReqSeq after the checkout. The file belongs in the root of the Git repository the workspace folder lies in (without Git, the workspace folder), which the output names. The entry starts `reqseq` with `mcp --workspace` and the workspace path relative to that folder, once for macOS and Linux and once for Windows (`cmd /c reqseq`). The Windows form is left out when that path holds a space or one of `&^%<>|!"(),;=\`.

The entry assumes Claude Code starts in that folder. Where `reqseq` is not on the PATH, its server does not start; use the command there. It replaces a server named `reqseq` in the file and keeps the others.

## Web UI

Open **Settings** in the rail. Under **AI agents**, choose the program and click **Show setup**: the page shows what to do, the configuration file where there is one, the command or JSON block, and how to go on. **Copy** puts the block on the clipboard. For Claude Code it also shows the `.mcp.json` entries.

The same card says whether an agent is connected to this workspace through the MCP server now, and since when, or that none was connected yet.

Without an open workspace, open or create one first ([Open or create a workspace](/how-to/open-a-workspace/)). **Create a workspace** writes the skill file `managing-requirements` too, unless you clear **Write the skill file for AI agents**.

## CLI

Without `--client`, the command lists the clients:

```sh
reqseq workspace init . "Weather station"
reqseq workspace connect-agent
```

With a client, it prints the setup with the paths of this machine:

```sh
reqseq workspace connect-agent --client claude-code
```

## API

With the [local API](/concepts/cli-api-and-mcp/#api) running in the workspace, and its token:

```http
POST /v1/commands/workspace.connectAgent

{ "client": "cursor" }
```

## MCP

An agent that is connected already can print the setup for another client:

```json
{ "name": "workspace_connectAgent", "arguments": { "client": "codex-cli" } }
```

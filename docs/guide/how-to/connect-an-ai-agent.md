---
title: Connect an AI agent
description: Print the ready-made setup that lets an AI agent's client start the MCP server of ReqSeq for a workspace.
sidebar:
  order: 1.1
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

On Windows the command is for PowerShell. Run Claude Code's command in the folder where you start Claude Code. Under it, the output names the call of `tool guide --skill --write` for the workspace, with the same absolute paths, which writes the skill file `managing-requirements` for Claude Code. In a workspace without the skill file, the call writes it; a file there that ReqSeq did not write, or that was changed since, is overwritten only with `--replace`. Add a JSON block under `mcpServers` of the file, keeping the other entries, and restart the client.

The setup holds as long as ReqSeq stays where it is: after a move, print it again. On macOS, an app that was not moved after the download runs from a place the system gives it for this start only, and gets no setup: move `ReqSeq.app` to `/Applications` first. The server is named `reqseq`, so a second workspace in the same client needs another name.

From a downloaded release, the setup starts the launcher `bin/reqseq` on macOS and Linux. On Windows, where a client cannot start `reqseq.cmd` without a shell, it starts the app's runtime:

```json
{ "command": "C:\\Tools\\ReqSeq\\ReqSeq.exe", "args": ["C:\\Tools\\ReqSeq\\resources\\cli\\dist\\bin.js", "mcp", "--workspace", "C:\\path\\to\\workspace"], "env": { "ELECTRON_RUN_AS_NODE": "1" } }
```

From the CLI tarball (`npm install -g`), it starts Node with the command line's `bin.js` on every system.

A path with `&`, `^`, `%`, `<`, `>`, `|` or `!` cannot pass VS Code's command on Windows; choose `other` and add its block to VS Code by hand.

## App

Run **Connect AI agent** in the command prompt (Ctrl+Shift+P, ⌘⇧P on macOS) and choose the client. The app shows what to do, the command or JSON block, and how to go on. "Copy field" (Ctrl+Shift+C, ⌘⇧C on macOS) or the copy symbol at the block puts the block on the clipboard.

Without an open workspace, it first asks for the workspace as "Open workspace" does, opens it, and then asks for the client.

**Write skill file** writes the skill file `managing-requirements` to `.claude/skills/` and `.agents/skills/` and names each; a file ReqSeq did not write stays.

The right end of the modeline shows whether an AI agent is connected to this copy of the workspace through the MCP server: a green dot and "Agent connected" while one is, a grey dot and "No agent connected" once the last connection has ended, also by a crash, and "Connect AI agent" when none has ever been connected to it. Hover over it for the client and since when it is connected, or which client was connected last and when. A click on "No agent connected" or "Connect AI agent" starts **Connect AI agent**. `reqseq workspace agents` gives the same on the command line.

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

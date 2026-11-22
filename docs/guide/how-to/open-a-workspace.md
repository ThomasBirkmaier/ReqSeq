---
title: Open or create a workspace
description: Open a workspace in the app, from the command line, the API and MCP, switch to one you opened before, or create a new one.
---

A workspace is a folder with a `reqseq-workspace.yaml`, often the folder `spec/` of a Git repository. The app shows one workspace per window; the command line, the API and the MCP server each work in the workspace they find or are given.

## App

Without a workspace the app shows three start commands, and the modeline says "No workspace is open." Click one, or select it with the arrow keys and Enter:

- "Open workspace…" opens the folder dialog of your system, the same as Ctrl+O (⌘O on macOS) and "File > Open Workspace…" in the menu. On Windows and Linux the menu bar is hidden until you press Alt. Choose the workspace folder or any folder inside it: the app opens the nearest workspace from there upwards.
- **Create workspace** opens the folder dialog, or takes the folder open without a workspace; the command prompt asks only for the name, filled in with the folder's, and Enter creates and opens the workspace. A workspace folder opens as it is.
- **Connect AI agent** asks for the workspace first, as [Connect an AI agent](/how-to/connect-an-ai-agent/) shows.

Ctrl+Shift+P (⌘⇧P) opens the command prompt. Its entry "Open workspace" lists the recent workspaces, the most recent first, and narrows them as you type; one that no longer holds its workspace file is marked "not found". Or type an absolute path, starting with `/`, `~` or, on Windows, a drive letter such as `C:\`. Enter on the first line, "Open" with your path, opens the workspace of that folder or a folder above it. Below it the prompt suggests the folders that match the name after the last separator; Down and Enter put one into the path.

The chosen workspace replaces the open one, after your unsaved input is saved.

From the command prompt, **Create workspace** asks for the path too.

One level above a workspace, the bottom line names it: `No reqseq-workspace.yaml in the workspace folder; one level below lies spec/reqseq-workspace.yaml: open that folder as the workspace`.

The [desktop shell](/concepts/the-desktop-shell/) starts without a workspace, whatever its arguments: open one in its window. `reqseq ui --workspace <folder>` starts the web UI with one.

## CLI

A command works in the workspace of the current folder: the nearest folder upwards with a `reqseq-workspace.yaml`, so any folder inside `spec/` will do. `--workspace <folder>` names the workspace folder itself, from anywhere. `workspace init` creates one, here in a new folder `spec`:

```sh
reqseq workspace init spec "Weather station"
reqseq workspace status --workspace spec
```

```text title="Output"
Workspace Weather station has 1 repository, 1 available.
name: Weather station
...
No problems.
```

Without a workspace, a command that needs one exits with code 2 and [workspace.not-found](/reference/problem-codes/#error-workspace-not-found); one level above a workspace, the message names it as the app does. Otherwise, and after `workspace init`, the lines under `next:` name the next calls; API and MCP return them as `next`.

`workspace recent` lists the recent workspaces, and `workspace mark-opened` puts the workspace it runs on first:

```sh
reqseq workspace recent
```

## API

The API serves one workspace: the one `reqseq serve api` finds from the current folder, or the one of `--workspace`, such as `reqseq serve api --workspace spec`. For another workspace, start the API there; no command switches it.

With the [local API](/concepts/cli-api-and-mcp/#api) running in the workspace, and its token:

```http
POST /v1/commands/workspace.recent

{}
```

`workspace.init` creates a workspace. Its path is absolute or relative to the folder the server serves; in a folder without a workspace, `reqseq serve api` starts and serves that folder:

```http
POST /v1/commands/workspace.init

{ "path": "spec", "name": "Weather station" }
```

## MCP

An MCP client starts `reqseq mcp` with `--workspace` and the absolute path of the workspace in its configuration, as [Connect an AI agent](/how-to/connect-an-ai-agent/) shows. For another workspace, configure a second server with its own `--workspace`; no tool switches it.

```json
{ "name": "workspace_recent", "arguments": {} }
```

```json
{ "name": "workspace_init", "arguments": { "path": "/path/to/weather/spec", "name": "Weather station" } }
```

The path works as in the API.

The reference has the details of [workspace.init](/reference/commands/workspace-init/), [workspace.status](/reference/commands/workspace-status/), [workspace.recent](/reference/commands/workspace-recent/) and [workspace.markOpened](/reference/commands/workspace-mark-opened/).

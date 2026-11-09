---
title: Open or create a workspace
description: Open a workspace in the app, from the command line, the API and MCP, switch to one you opened before, or create a new one.
sidebar:
  order: 9
---

A workspace is a folder with a `reqseq-workspace.yaml`, often the folder `spec/` of a Git repository. The app shows one workspace per window; the command line, the API and the MCP server each work in the workspace they find or are given.

## App

The app starts without a workspace, and the bottom line says how to open one:

- Ctrl+O (⌘O on macOS) opens the folder dialog of your system, the same as "File > Open Workspace…" in the menu. On Windows and Linux the menu bar is hidden until you press Alt. Choose the workspace folder or any folder inside it: the app opens the nearest workspace from there upwards.
- Ctrl+Shift+P (⌘⇧P) opens the command prompt. Its entry "Open workspace" lists the workspaces you opened last, the most recent first, and narrows them as you type; one that no longer holds its workspace file is marked "not found". Or type an absolute path, starting with `/`, `~` or, on Windows, a drive letter such as `C:\`. Enter on the first line, "Open" with your path, opens the workspace of that folder or a folder above it. Below it the prompt suggests the folders that match the name after the last separator; Down and Enter put one into the path, so you can type on.

The workspace you choose replaces the open one in the same window, after your unsaved input is saved.

If you choose the folder one level above a workspace with Ctrl+O, such as the root of the repository, the bottom line names the right one: `No reqseq-workspace.yaml in the workspace folder; one level below lies spec/reqseq-workspace.yaml: open that folder as the workspace`.

To create a workspace, open a folder that is not inside a workspace with Ctrl+O. The bottom line says `To create one here, press Ctrl+Shift+P for Initialise workspace.` (⌘⇧P on macOS). Run **Initialise workspace** there, enter `.` as the path, which is the folder you opened, and a name.

To open a workspace when the app starts, give its folder with `--workspace`:

- Windows: `C:\Tools\ReqSeq\ReqSeq.exe --workspace C:\weather\spec`
- Linux: `~/ReqSeq/ReqSeq --workspace ~/weather/spec`
- macOS: `/Applications/ReqSeq.app/Contents/MacOS/ReqSeq --workspace ~/weather/spec`

## CLI

A command works in the workspace of the current folder: the nearest folder upwards with a `reqseq-workspace.yaml`, so any folder inside `spec/` will do. `--workspace <folder>` names the workspace folder itself, from anywhere. `workspace init` creates one, here in a new folder `spec`:

```sh
reqseq workspace init spec "Weather station"
reqseq workspace status --workspace spec
```

```text title="Output"
name: Weather station
...
No problems.
```

Without a workspace, a command that needs one exits with code 2 and [workspace.not-found](/reference/problem-codes/#error-workspace-not-found); one level above a workspace, the message names it as the app does.

`workspace recent` lists the workspaces the app opened last; the CLI only reads that list:

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

An MCP client starts `reqseq mcp` with `--workspace` and the absolute path of the workspace in its configuration, as [Install ReqSeq](/how-to/install-reqseq/#mcp) shows. For another workspace, configure a second server with its own `--workspace`; no tool switches it.

```json
{ "name": "workspace_recent", "arguments": {} }
```

```json
{ "name": "workspace_init", "arguments": { "path": "/path/to/weather/spec", "name": "Weather station" } }
```

As in the API, the path is absolute or relative to the folder the server serves.

The reference has the details of [workspace.init](/reference/commands/workspace-init/), [workspace.status](/reference/commands/workspace-status/) and [workspace.recent](/reference/commands/workspace-recent/).

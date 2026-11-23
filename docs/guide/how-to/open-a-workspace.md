---
title: Open or create a workspace
description: Open a workspace in the web UI, from the command line, the API and MCP, switch to one you opened before, or create a new one.
---

A workspace is a folder with a `reqseq-workspace.yaml`, often the folder `spec/` of a Git repository. The web UI shows one workspace at a time; the command line, the API and the MCP server each work in the workspace they find or are given.

## Web UI

`reqseq ui --workspace <folder>` starts the web UI with that workspace. Without one, it starts on the workspaces page, which **Workspaces** in the rail opens later:

- **Recently opened** lists the workspaces you opened, the most recent first; **Open** opens one.
- **Open a workspace** takes the full path of the folder that holds `reqseq-workspace.yaml`; `~` stands for your home folder.
- **Create a workspace** takes the full path of a new folder, or of one without a workspace yet, and a name; **Create and open** creates the folder when it is missing, writes the workspace and opens it.

The chosen workspace replaces the open one in every tab.

The [desktop shell](/concepts/the-desktop-shell/) starts without a workspace, whatever its arguments: open one in its window, where a button next to the path also opens the folder dialog of your system.

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

Without a workspace, a command that needs one exits with code 2 and [workspace.not-found](/reference/problem-codes/#error-workspace-not-found); one level above a workspace, the message names it. Otherwise, and after `workspace init`, the lines under `next:` name the next calls; API and MCP return them as `next`.

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

---
title: Install ReqSeq
description: Download the release for your system, unpack it, and set up the command line, the web UI, the API and the MCP server.
---

ReqSeq comes as one portable archive per system: unpacking it is installing it. Nothing is downloaded while unpacking or running, and nothing updates itself.

## Download and check

Each GitHub release has these files; `<version>` is its ReqSeq version.

| System | Download |
|---|---|
| macOS 26 or newer, Apple silicon | `ReqSeq-<version>-mac-arm64.zip` |
| Linux x64, Ubuntu 24.04 | `ReqSeq-<version>-linux-x64.tar.gz` |
| Windows 11 x64 | `ReqSeq-<version>-win-x64.zip` |
| Pipelines with Node 22 | `reqseq-cli-<version>.tgz`, the command line and the MCP server only |

Each archive holds one folder, `ReqSeq-<version>-<system>/`, with the command line `bin/reqseq` (`bin\reqseq.cmd` on Windows), the MCP server and the web UI, the Node runtime they run on (`runtime/`), this documentation for its ReqSeq version (`lib/docs/`), an example of connecting a test tool (`examples/junit/`) and the licences of what is inside (`THIRD_PARTY_NOTICES.txt`). It needs no Node of your own; the web UI needs a browser. Check a download against the release's `SHA256SUMS.txt`: `shasum -a 256 -c SHA256SUMS.txt --ignore-missing` on macOS, `sha256sum` with the same options on Linux, `Get-FileHash <file>` in PowerShell.

ReqSeq reads Git through `git` on the path, which the release does not hold: install Git for Windows, the Command Line Tools on macOS (`xcode-select --install`), or your Linux distribution's `git`.

## Unpack

Unpack the archive and move its folder to a place of your own, renamed so that the path stays the same across versions: for example `~/ReqSeq` on macOS and Linux, `C:\Tools\ReqSeq` on Windows. The examples below use these folders.

## First start

The archives are not signed with a developer certificate. Once after unpacking:

- macOS: remove the download mark from the folder, `xattr -dr com.apple.quarantine ~/ReqSeq`.
- Windows: unblock the zip before unpacking it, `Unblock-File .\ReqSeq-<version>-win-x64.zip`.
- Linux: nothing to do.

## CLI

The launcher `reqseq` is in the `bin` folder. Add that folder to the path, then open a new terminal:

- macOS (zsh): `echo 'export PATH="$HOME/ReqSeq/bin:$PATH"' >> ~/.zprofile`
- Linux (bash): `echo 'export PATH="$HOME/ReqSeq/bin:$PATH"' >> ~/.bashrc`, and in `~/.profile` for login shells and scripts.
- Windows (PowerShell): `[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path', 'User') + ';C:\Tools\ReqSeq\bin', 'User')`. The launcher is `bin\reqseq.cmd`.

```sh
reqseq --version
```

The launcher runs ReqSeq on the Node in `runtime/` and ignores `NODE_OPTIONS`.

In a pipeline with Node 22, install the tarball instead, without network: `npm install -g --offline ./reqseq-cli-<version>.tgz`.

To read this documentation without network, in the ReqSeq version you installed, run `reqseq serve docs` and open the address it prints in a browser. It serves the documentation of the release on `127.0.0.1` only, with its search, until Ctrl-C; `--port <n>` picks the port.

## App

The release holds no desktop app; the web UI takes its place. `reqseq ui` in a workspace starts it on your own computer and opens its address in your browser; `--no-open` only prints it. The address holds a token that is new on every start. It runs until Ctrl-C.

## API

Nothing more to install: `reqseq serve api` starts the local API in a workspace, on loopback only, and prints where [`api.json`](/concepts/cli-api-and-mcp/#api) with its port and token is.

## MCP

An agent's client starts the MCP server with `reqseq mcp` and the workspace. `reqseq workspace connect-agent` prints that setup for each client: see [Connect an AI agent](/how-to/connect-an-ai-agent/).

## Update or remove

A new ReqSeq version is a new download: swap its folder for the old one. The recent workspaces and elements, the path line and the MCP configuration stay. Repeat the first start on macOS and Windows.

To remove ReqSeq, delete its folder and the folder `reqseq` in your system's cache folder (`~/Library/Caches`, `~/.cache`, `%LOCALAPPDATA%`). A version with the desktop app also left a data folder (`~/Library/Application Support/ReqSeq`, `~/.config/ReqSeq`, `%APPDATA%\ReqSeq`), which you can delete too.

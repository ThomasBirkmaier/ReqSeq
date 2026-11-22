---
title: Install ReqSeq
description: Download the release for your system, unpack it, and set up the command line, the web UI, the API and the MCP server.
---

ReqSeq comes as one portable archive per system: unpacking it is installing it. Nothing is downloaded while unpacking or running, and nothing updates itself.

## Download and check

Each GitHub release has these files, `<version>` being its version.

| System | Download |
|---|---|
| macOS 26 or newer, Apple silicon | `ReqSeq-<version>-mac-arm64.zip` |
| Linux x64, Ubuntu 24.04 | `ReqSeq-<version>-linux-x64.tar.gz` |
| Windows 11 x64 | `ReqSeq-<version>-win-x64.zip` |
| Pipelines with Node 22 | `reqseq-cli-<version>.tgz`, the command line and the MCP server only |

Each archive holds one folder, `ReqSeq-<version>-<system>/`, with the [desktop shell](/concepts/the-desktop-shell/), the command line `reqseq` with the MCP server and the web UI, the Node they run on, this documentation, an example of connecting a test tool (`examples/junit/`) and the licences (`THIRD_PARTY_NOTICES.txt`):

| System | Desktop shell | Command line |
|---|---|---|
| macOS | `ReqSeq.app`, which holds everything else in `Contents/Resources/` | `ReqSeq.app/Contents/Resources/bin/reqseq` |
| Windows | `ReqSeq.exe` | `bin\reqseq.cmd` |
| Linux | `ReqSeq` | `bin/reqseq` |

Check a download against the release's `SHA256SUMS.txt`: `shasum -a 256 -c SHA256SUMS.txt --ignore-missing` on macOS, `sha256sum` with the same options on Linux, `Get-FileHash <file>` in PowerShell.

ReqSeq reads Git through `git` on the path, which the release does not hold: install Git for Windows, the Command Line Tools on macOS (`xcode-select --install`), or your Linux distribution's `git`.

## Unpack

On macOS, move `ReqSeq.app` to `/Applications`. On Windows and Linux, rename the folder and move it to a place whose path stays across versions, as `C:\Tools\ReqSeq` or `~/ReqSeq` below.

## First start

The release is not signed with a developer certificate. Once after unpacking:

- macOS: remove the download mark, `xattr -dr com.apple.quarantine /Applications/ReqSeq.app`.
- Windows: unblock the zip before unpacking it, `Unblock-File .\ReqSeq-<version>-win-x64.zip`. Otherwise Windows warns that `ReqSeq.exe` is an unrecognized app; **More info**, then **Run anyway** starts it.
- Linux: nothing to do. The desktop shell alone needs the system's web engine, on Ubuntu 24.04 the package `libwebkit2gtk-4.1-0` (`sudo apt install libwebkit2gtk-4.1-0`). It is no step of the installation: without it, `reqseq ui` runs in your browser, and `ReqSeq` ends with a message that names the package.

## CLI

Add the folder of the launcher `reqseq` to the path, then open a new terminal:

- macOS (zsh): `echo 'export PATH="/Applications/ReqSeq.app/Contents/Resources/bin:$PATH"' >> ~/.zprofile`. Up to version 0.13 it was `bin/` of the unpacked folder: change an older path line, and run `reqseq workspace connect-agent` again for each agent.
- Linux (bash): `echo 'export PATH="$HOME/ReqSeq/bin:$PATH"' >> ~/.bashrc`, and in `~/.profile` for login shells and scripts.
- Windows (PowerShell): `[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path', 'User') + ';C:\Tools\ReqSeq\bin', 'User')`.

```sh
reqseq --version
```

In a pipeline with Node 22, install the tarball instead, without network: `npm install -g --offline ./reqseq-cli-<version>.tgz`.

`reqseq serve docs` serves this documentation of your version without network, on `127.0.0.1` with its search, until Ctrl-C; open the address it prints, `--port <n>` picks the port.

## App

Start `ReqSeq.app`, `ReqSeq.exe` or `ReqSeq` for the web UI in a window of its own, the [desktop shell](/concepts/the-desktop-shell/). `reqseq ui` in a workspace opens it in your browser instead; `--no-open` only prints its address, whose token is new on every start. It runs until Ctrl-C.

## API

`reqseq serve api` starts the local API in a workspace, on loopback only, and prints where [`api.json`](/concepts/cli-api-and-mcp/#api) with its port and token is.

## MCP

An agent's client starts the MCP server with `reqseq mcp` and the workspace. `reqseq workspace connect-agent` prints that setup for each client: see [Connect an AI agent](/how-to/connect-an-ai-agent/).

## Update or remove

A new ReqSeq version is a new download: swap its folder, on macOS `ReqSeq.app`, for the old one. The recent workspaces and elements, the path line and the MCP configuration stay. Repeat the first start on macOS and Windows.

To remove ReqSeq, delete its folder and the folder `reqseq` in your system's cache folder (`~/Library/Caches`, `~/.cache`, `%LOCALAPPDATA%`). Versions with the Electron desktop app also left `~/Library/Application Support/ReqSeq`, `~/.config/ReqSeq` or `%APPDATA%\ReqSeq`.

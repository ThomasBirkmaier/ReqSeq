---
title: Install ReqSeq
description: Download the delivery for your system, unpack it, and set up the app, the command line, the API and the MCP server.
sidebar:
  order: 1
---

ReqSeq comes as one portable archive per system: unpacking it is installing it. Nothing is downloaded while unpacking or running, and nothing updates itself.

## Download and check

Each GitHub release has these files:

| System | Download |
|---|---|
| macOS 26 or newer, Apple silicon | `ReqSeq-<version>-mac-arm64.zip` |
| Linux x64, Ubuntu 24.04 | `ReqSeq-<version>-linux-x64.tar.gz` |
| Windows 11 x64 | `ReqSeq-<version>-win-x64.zip` |
| Pipelines with Node 22 | `reqseq-cli-<version>.tgz`, the command line and the MCP server only |

Each archive holds the app, the command line `reqseq` and the MCP server, which need no Node, as well as this documentation for its version (`resources/cli/docs/`), an example of connecting a test tool (`resources/docs/junit/`) and the licences of the libraries inside (`resources/THIRD_PARTY_NOTICES.txt`). Check a download against the release's `SHA256SUMS.txt`: `shasum -a 256 -c SHA256SUMS.txt --ignore-missing` on macOS, `sha256sum` with the same options on Linux, `Get-FileHash <file>` in PowerShell.

ReqSeq reads Git through `git` on the path, which the delivery does not hold: install Git for Windows, the Command Line Tools on macOS (`xcode-select --install`), or your Linux distribution's `git`.

## App

1. Unpack the archive: on macOS, move `ReqSeq.app` to `/Applications`; elsewhere into a folder such as `C:\Tools\ReqSeq` or `~/ReqSeq`.
2. Start `ReqSeq.app`, `ReqSeq.exe` or `~/ReqSeq/ReqSeq`, then [open or create a workspace](/how-to/open-a-workspace/).

The builds are not signed with a developer certificate yet, so the first start asks:

- macOS refuses to open the app: click "Open Anyway" next to the message about ReqSeq in System Settings > Privacy & Security, or remove the download mark once with `xattr -dr com.apple.quarantine /Applications/ReqSeq.app`. If macOS says the app "is damaged", check the checksum; if it matches, remove the mark.
- Windows SmartScreen shows "Windows protected your PC": click "More info", then "Run anyway". Unblocking the zip before unpacking it asks only once: `Unblock-File .\ReqSeq-<version>-win-x64.zip`.
- Ubuntu 24.04 needs one admin step for the app's sandbox, which ReqSeq never turns off:

  ```sh
  sudo chown root:root ~/ReqSeq/chrome-sandbox && sudo chmod 4755 ~/ReqSeq/chrome-sandbox
  ```

  Or allow the sandbox for this one program with an AppArmor profile, `/etc/apparmor.d/reqseq`, loaded with `sudo apparmor_parser -r /etc/apparmor.d/reqseq`:

  ```text
  abi <abi/4.0>,
  include <tunables/global>

  profile reqseq /home/*/ReqSeq/ReqSeq flags=(unconfined) {
    userns,
    include if exists <local/reqseq>
  }
  ```

## CLI

The launcher `reqseq` is in the `bin` folder of the delivery. Add that folder to the path, then open a new terminal:

- macOS (zsh): `echo 'export PATH="/Applications/ReqSeq.app/Contents/Resources/bin:$PATH"' >> ~/.zprofile`
- Linux (bash): `echo 'export PATH="$HOME/ReqSeq/bin:$PATH"' >> ~/.bashrc`, and in `~/.profile` for login shells and scripts.
- Windows (PowerShell): `[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path', 'User') + ';C:\Tools\ReqSeq\bin', 'User')`. The launcher is `bin\reqseq.cmd`; in `cmd.exe` inside the install folder itself, `reqseq` still starts the app.

```sh
reqseq --version
```

In a pipeline with Node 22, install the tarball instead, without network: `npm install -g --offline ./reqseq-cli-<version>.tgz`.

To read this documentation without network, in the version you installed, run `reqseq serve docs` and open the address it prints. It serves the documentation of the delivery on `127.0.0.1` only, with its search, until Ctrl-C; `--port <n>` picks the port.

## API

Nothing more to install: `reqseq serve api` starts the local API in a workspace, on loopback only, and prints where [`api.json`](/concepts/cli-api-and-mcp/#api) with its port and token is.

## MCP

An MCP client starts the server with `reqseq mcp`. In its MCP configuration, give the absolute path of the launcher:

```json
{ "command": "/Applications/ReqSeq.app/Contents/Resources/bin/reqseq", "args": ["mcp", "--workspace", "/path/to/workspace"] }
```

On Linux it is the absolute path of `~/ReqSeq/bin/reqseq`. On Windows, clients that start programs without a shell cannot start `reqseq.cmd`; give the app's runtime:

```json
{ "command": "C:\\Tools\\ReqSeq\\ReqSeq.exe", "args": ["C:\\Tools\\ReqSeq\\resources\\cli\\dist\\bin.js", "mcp", "--workspace", "C:\\path\\to\\workspace"], "env": { "ELECTRON_RUN_AS_NODE": "1" } }
```

## Update or remove

A new version is a new download: replace the old folder or `ReqSeq.app`. The recent workspaces, the path line and the MCP configuration stay. Repeat the Ubuntu step and the first start on macOS and Windows.

To remove ReqSeq, delete its folder, the folder `reqseq` in your system's cache folder (`~/Library/Caches`, `~/.cache`, `%LOCALAPPDATA%`) and the data folder (`~/Library/Application Support/ReqSeq`, `~/.config/ReqSeq`, `%APPDATA%\ReqSeq`).

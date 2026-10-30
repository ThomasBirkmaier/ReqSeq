---
title: Install ReqSeq
description: Download the delivery for your system, unpack it, and set up the app, the command line, the API and the MCP server.
sidebar:
  order: 1
---

ReqSeq comes as one portable archive per system. There is no installer: unpacking it is installing it. Nothing is downloaded while unpacking or running, and nothing updates itself.

## Download and check

Each GitHub release has these files; `<version>` is the version of the release.

| System | Download |
|---|---|
| macOS 26 or newer, Apple silicon | `ReqSeq-<version>-mac-arm64.zip` |
| Linux x64, Ubuntu 24.04 | `ReqSeq-<version>-linux-x64.tar.gz` |
| Windows 11 x64 | `ReqSeq-<version>-win-x64.zip` |
| Pipelines with Node 22 | `reqseq-cli-<version>.tgz`, the command line and the MCP server only |

Each archive holds the app, the command line `reqseq` and the MCP server, which need no Node, as well as the guide for connecting a test tool (`resources/docs/junit/`) and the licences of the libraries inside. Check a download against `SHA256SUMS.txt` of the release: `shasum -a 256 -c SHA256SUMS.txt --ignore-missing` on macOS, `sha256sum` with the same options on Linux, `Get-FileHash <file>` in PowerShell.

ReqSeq reads Git through the `git` program on the path, which is not in the delivery: Git for Windows, the Command Line Tools on macOS (`xcode-select --install`), or the `git` package of your Linux distribution.

## App

1. Unpack the archive. On macOS move `ReqSeq.app` to `/Applications`. On Windows and Linux unpack it into a folder such as `C:\Tools\ReqSeq` or `~/ReqSeq`.
2. Start `ReqSeq.app`, `ReqSeq.exe` or `~/ReqSeq/ReqSeq`.

The builds are not signed with a developer certificate yet, so the first start asks:

- macOS refuses to open the app. Open System Settings, then Privacy & Security, and click "Open Anyway" next to the message about ReqSeq. Or remove the download mark once: `xattr -dr com.apple.quarantine /Applications/ReqSeq.app`. If macOS says the app "is damaged", check the checksum; if it matches, remove the mark.
- Windows SmartScreen shows "Windows protected your PC": click "More info", then "Run anyway". To be asked only once, unblock the zip before unpacking it: `Unblock-File .\ReqSeq-<version>-win-x64.zip`.
- Ubuntu 24.04 needs one admin step for the app's sandbox; ReqSeq never turns the sandbox off:

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

In a pipeline with Node 22, install the tarball instead; it needs no network: `npm install -g --offline ./reqseq-cli-<version>.tgz`.

## API

Nothing more to install: the command line starts the local API in a workspace with `reqseq serve api`. It listens on loopback only and prints where `api.json` with its port and token is.

## MCP

An MCP client starts the server with `reqseq mcp`. In its MCP configuration, give the absolute path of the launcher:

```json
{ "command": "/Applications/ReqSeq.app/Contents/Resources/bin/reqseq", "args": ["mcp", "--workspace", "/path/to/workspace"] }
```

On Linux the command is the absolute path of `~/ReqSeq/bin/reqseq`. On Windows, clients that start programs without a shell cannot start `reqseq.cmd`; give them the runtime of the app:

```json
{ "command": "C:\\Tools\\ReqSeq\\ReqSeq.exe", "args": ["C:\\Tools\\ReqSeq\\resources\\cli\\dist\\bin.js", "mcp", "--workspace", "C:\\path\\to\\workspace"], "env": { "ELECTRON_RUN_AS_NODE": "1" } }
```

## Update or remove

A new version is a new download: replace the old folder or `ReqSeq.app` with the new one. The recent workspaces and elements, the path line and the MCP configuration stay. Repeat the Ubuntu step, and on macOS and Windows confirm the first start again.

To remove ReqSeq, delete its folder, the folder `reqseq` in the cache folder of your system (`~/Library/Caches`, `~/.cache`, `%LOCALAPPDATA%`) and the app's data folder (`~/Library/Application Support/ReqSeq`, `~/.config/ReqSeq`, `%APPDATA%\ReqSeq`).

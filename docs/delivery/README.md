# Getting LogReq

LogReq comes as one portable artifact per system (ADR-0014): unpack it and start it. There is no installer, nothing is downloaded while unpacking or running, and nothing updates itself; a new version is a new download. The artifacts are attached to the GitHub release of each version, from the first release built by the workflow `Release` (`.github/workflows/release.yml`). The names of all files and folders are listed in the table "Names" of [ADR-0014](../adr/0014-packaging.md); `<version>` below is the version of the release.

| System | Download | Contains |
|---|---|---|
| macOS 14 or newer (Apple silicon) | `LogReq-<version>-mac-arm64.zip` | `LogReq.app` |
| Linux x64 (Ubuntu 24.04) | `LogReq-<version>-linux-x64.tar.gz` | folder `LogReq-<version>-linux-x64/` |
| Windows 11 x64 | `LogReq-<version>-win-x64.zip` | one folder (not built yet: no Windows runner) |
| Pipelines with Node 22 | `logreq-cli-<version>.tgz` | the command line and the MCP server only |

Every artifact contains the app, the command line `logreq` and the MCP server (`logreq mcp`). The command line and the MCP server run on the Electron runtime inside the artifact; no Node installation is needed.

`SHA256SUMS.txt` lists the checksums of all files of a release. Check a download with `shasum -a 256 -c SHA256SUMS.txt --ignore-missing` (macOS), `sha256sum -c SHA256SUMS.txt --ignore-missing` (Linux) or `Get-FileHash <file>` (Windows PowerShell). The builds are not signed yet: [Opening unsigned builds](unsigned-builds.md).

## Prerequisite: Git

LogReq reads Git through the `git` program on the PATH; Git is not part of the delivery.

- Windows: install Git for Windows.
- macOS: install the Command Line Tools (`xcode-select --install`). On a machine without them, `git` is a stub that offers to download them; in a network without internet, install them beforehand.
- Linux: the distribution's `git` package.

## Install: unpack

- **macOS:** unpack the zip and move `LogReq.app` to `/Applications` (this may need an administrator; `~/Applications` works too, then use that path below).
- **Windows:** unpack the zip into a folder of your choice, for example `C:\Tools\LogReq`.
- **Linux:** unpack the tar.gz into a folder of your choice, for example `tar -xzf LogReq-<version>-linux-x64.tar.gz && mv LogReq-<version>-linux-x64 ~/LogReq`.

Then start the app: `LogReq.app`, `LogReq.exe` or `~/LogReq/LogReq`.

### Ubuntu 24.04: one admin step for the app's sandbox

Ubuntu 24.04 does not let Chromium, and so the LogReq app, use its usual sandbox. The app then uses the helper `chrome-sandbox` in its folder, which must belong to root. Run once after unpacking (it downloads nothing):

```sh
sudo chown root:root ~/LogReq/chrome-sandbox && sudo chmod 4755 ~/LogReq/chrome-sandbox
```

Instead, an administrator can allow the sandbox for this one program with an AppArmor profile, `/etc/apparmor.d/logreq`:

```
abi <abi/4.0>,
include <tunables/global>

profile logreq /home/*/LogReq/LogReq flags=(unconfined) {
  userns,
  include if exists <local/logreq>
}
```

followed by `sudo apparmor_parser -r /etc/apparmor.d/logreq` (adjust the path to where LogReq is unpacked).

LogReq never turns the sandbox off. Without one of these steps, which need admin rights, the app does not start on Ubuntu 24.04. The command line and the MCP server do not need it: they start no browser engine and need no display.

## The command line on the PATH

The command line is the launcher `logreq` in the `bin` folder of the delivery. Add that folder to the PATH with one line:

- **macOS** (zsh): `echo 'export PATH="/Applications/LogReq.app/Contents/Resources/bin:$PATH"' >> ~/.zprofile`
- **Linux** (bash): `echo 'export PATH="$HOME/LogReq/bin:$PATH"' >> ~/.bashrc`
- **Windows** (PowerShell): `[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path', 'User') + ';C:\Tools\LogReq\bin', 'User')`

Open a new terminal, then `logreq --help` and `logreq workspace status --workspace <folder>` work from anywhere. On Linux, login shells and scripts that do not read `~/.bashrc` need the same line in `~/.profile`, which takes effect at the next login. A link works too: `mkdir -p ~/.local/bin && ln -s ~/LogReq/bin/logreq ~/.local/bin/logreq` (Ubuntu adds `~/.local/bin` to the PATH at login once the folder exists, so log out and in once after creating it).

On Windows the launcher is `bin\logreq.cmd`. It lives in `bin` because Windows would otherwise find `LogReq.exe` (the app) first for the name `logreq`; for the same reason, typing `logreq` in `cmd.exe` inside the install folder itself still starts the app (`cmd.exe` searches the current folder first; PowerShell does not).

## The MCP server

AI agents connect to LogReq through `logreq mcp` (stdio). In the MCP configuration of a client:

```json
{
  "command": "/Applications/LogReq.app/Contents/Resources/bin/logreq",
  "args": ["mcp", "--workspace", "/path/to/workspace"]
}
```

On Linux the command is `~/LogReq/bin/logreq` (as an absolute path). On Windows, clients that start programs without a shell cannot start a `.cmd` file; give them the app's runtime directly:

```json
{
  "command": "C:\\Tools\\LogReq\\LogReq.exe",
  "args": ["C:\\Tools\\LogReq\\resources\\cli\\dist\\bin.js", "mcp", "--workspace", "C:\\path\\to\\workspace"],
  "env": { "ELECTRON_RUN_AS_NODE": "1" }
}
```

## Pipelines: the CLI tarball

Where Node 22 is installed, the command line also comes as an npm package with all its dependencies inside, so it installs without network:

```sh
npm install -g --offline ./logreq-cli-<version>.tgz
logreq workspace check --workspace .
```

## Updating

A new version is a new download. Unpack it and replace the old folder (or `LogReq.app`) with it; nothing else changes:

- The recent workspaces and the recent elements stay. They are not in the delivery folder but in the user profile: the recent workspaces in `logreq/recent-workspaces.json` in the cache folder of the system (`~/Library/Caches` on macOS, `$XDG_CACHE_HOME` or `~/.cache` on Linux, `%LOCALAPPDATA%` on Windows), the recent elements in the app's data folder (`~/Library/Application Support/LogReq`, `~/.config/LogReq`, `%APPDATA%\LogReq`). The model caches of the workspaces are in the same cache folder. Should a future version of the tool carry another name, it takes this data over once.
- The PATH line and MCP configurations stay valid when the new folder has the same place and name.
- On Ubuntu 24.04, repeat the admin step for the new `chrome-sandbox`.
- On macOS and Windows, the first start of the new build asks again ([Opening unsigned builds](unsigned-builds.md)).

To remove LogReq completely, delete its folder (or `LogReq.app`), the folder `logreq` in the cache folder and the app's data folder named above.

## Also in the delivery

- The guide for connecting a test tool that writes JUnit XML, with its examples: `resources/docs/junit/` (in `LogReq.app/Contents/Resources/docs/junit/` on macOS). The same guide is [toolchain/junit/README.md](../../toolchain/junit/README.md).
- The licences of the libraries the app and the command line contain: `resources/THIRD_PARTY_NOTICES.txt`, and Electron's `LICENSE` and `LICENSES.chromium.html`.

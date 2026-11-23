# toolchain/packaging

What the portable delivery of ADR-0020 is made from. Only the workflow `Release` (`.github/workflows/release.yml`)
builds it; pull requests never do.

| File | What |
| --- | --- |
| `names.json` | Every product, artifact and launcher name: product name, app id, launcher, the desktop shell's own program (`shellProgram`), package scope, CLI tarball, artifact name pattern and the pattern of the one folder each archive holds. A rename changes this file only, and the launcher crate's program name (`packages/shell/launcher/Cargo.toml`). |
| `node.json` | The Node runtime the archives ship: its exact version (of the major version in `.nvmrc`), the download address and, per system, the file name and SHA-256 of Node's archive, taken from the `SHASUMS256.txt` of that version on nodejs.org. Only `bin/node` (`node.exe`) and `LICENSE` are taken from it: no npm, npx or corepack. |
| `launchers/` | The command line launcher `bin/<launcher>` (POSIX shell) and `bin\<launcher>.cmd` (Windows): they run `lib/dist/bin.js` on `runtime/node` and unset `NODE_OPTIONS`. |
| `icon/` | The icon (#410): the master `icon.svg` and what `scripts/icon/generate.mjs` renders from it (`icon.icns`, `icon.ico`, `icons/<size>x<size>.png`; also the icon of `ReqSeq.app` and `ReqSeq.exe` and the docs favicons). After changing the master, run `node scripts/icon/generate.mjs` and commit its output. |

## An archive

`ReqSeq-<version>-<os>-<arch>.zip` (macOS arm64, Windows x64) or `.tar.gz` (Linux x64) holds one folder
`ReqSeq-<version>-<os>-<arch>/` with the desktop shell (ADR-0021, SR-249 AK3) and the folder of the rest, the "home":
the folder itself on Windows and Linux, `ReqSeq.app/Contents/Resources/` on macOS.

| Path | What |
| --- | --- |
| `ReqSeq.app/Contents/MacOS/ReqSeq`, `Info.plist`, `Resources/icon.icns` | macOS: the shell `reqseq-shell` and its bundle |
| `ReqSeq.exe` | Windows: the shell `reqseq-shell.exe` |
| `ReqSeq`, `reqseq-shell` | Linux: the launcher that checks for the web engine (SR-252 AK8), and the shell |
| `bin/reqseq`, `bin\reqseq.cmd` | in the home: the launcher of the command line |
| `runtime/node`, `runtime\node.exe` | in the home: Node of `node.json`, with the signature of the Node project |
| `lib/` | in the home: the CLI package with its flat production `node_modules`: command line, MCP server and UI server |
| `lib/web/` | in the home: the pages of the web UI (`packages/web/dist`) |
| `lib/docs/` | in the home: the documentation site of this version (SR-141) |
| `examples/junit/` | in the home: the example of connecting a test tool (`toolchain/junit/`) |
| `THIRD_PARTY_NOTICES.txt` | in the home: the licences of everything inside, Node's full `LICENSE` and the crates of the shell included |

Every path is relative, so the folder, or `ReqSeq.app`, can be moved as a whole. The shell finds `runtime/` and `lib/`
in its home (`packages/shell/shell/src/start.rs`). The release job `shell` builds it on each system with Cargo
(`cargo build --release`, no Tauri CLI) and writes the notices of its crates (`scripts/licenses/crates.mjs --notices`);
the release job `seal` signs `ReqSeq.app` ad hoc (ADR-0021, Signing). Nothing else is signed by us, and there is no
Developer ID signature or notarization (SR-146).

## Build a delivery by hand

```sh
pnpm install --frozen-lockfile && pnpm build
REQSEQ_DOCS_OFFLINE=1 pnpm docs:build              # the documentation site a delivery ships (SR-141)
node scripts/package/stage.mjs --docs-site          # checks it and its licences, into build/docs-site/
mkdir -p build/node-archives && node scripts/package/stage.mjs --node-urls |
  while read -r url file; do curl -fsSL -o "build/node-archives/$file" "$url"; done
# the release build of the shell per system in build/shell/<mac|linux|win>/ with its crates.json:
#   cargo build --release --locked -p shell [-p launcher]   (in packages/shell, on that system)
#   node scripts/licenses/crates.mjs --notices <target> build/shell/<system>/crates.json
node scripts/package/stage.mjs                      # stages build/package/, writes the three archives
node scripts/package/stage.mjs --pack               # the CLI tarball
scripts/package/delivery-tests.sh                   # the delivery tests (Linux: as a normal user with sudo, xvfb and
                                                    # dbus; it removes libwebkit2gtk-4.1-0 at its end)
```

The release job `docs-site` runs the same two docs steps, and CI runs them on every pull request (step "Docs - check
the offline site a delivery ships"). `stage.mjs` checks every Node archive against `node.json` before it takes a file
from it, and needs `zip` and `tar`. The artifacts land in `delivery/`; the delivery itself downloads nothing (SR-078).

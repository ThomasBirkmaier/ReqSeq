# toolchain/packaging

What the portable delivery of ADR-0020 is made from. Only the workflow `Release` (`.github/workflows/release.yml`)
builds it; pull requests never do.

| File | What |
| --- | --- |
| `names.json` | Every product, artifact and launcher name: product name, app id, launcher, package scope, CLI tarball, artifact name pattern and the pattern of the one folder each archive holds. A rename changes this file only. |
| `node.json` | The Node runtime the archives ship: its exact version (of the major version in `.nvmrc`), the download address and, per system, the file name and SHA-256 of Node's archive, taken from the `SHASUMS256.txt` of that version on nodejs.org. Only `bin/node` (`node.exe`) and `LICENSE` are taken from it: no npm, npx or corepack. |
| `launchers/` | The command line launcher `bin/<launcher>` (POSIX shell) and `bin\<launcher>.cmd` (Windows): they run `lib/dist/bin.js` on `runtime/node` and unset `NODE_OPTIONS`. |
| `icon/` | The icon (#410): the master `icon.svg` and what `scripts/icon/generate.mjs` renders from it (`icon.icns`, `icon.ico`, `icons/<size>x<size>.png`; also the window icon of the app and the docs favicons). After changing the master, run `node scripts/icon/generate.mjs` and commit its output. |
| `package.json`, `pnpm-lock.yaml`, `electron-builder.config.mjs` | electron-builder for the delivery of ADR-0014 with the Electron app. The release no longer uses it; it goes with the app (#2310). |

## An archive

`ReqSeq-<version>-<os>-<arch>.zip` (macOS arm64, Windows x64) or `.tar.gz` (Linux x64) holds one folder
`ReqSeq-<version>-<os>-<arch>/`:

| Path | What |
| --- | --- |
| `bin/reqseq`, `bin\reqseq.cmd` | the launcher |
| `runtime/node`, `runtime\node.exe` | Node of `node.json`, with the signature of the Node project |
| `lib/` | the CLI package with its flat production `node_modules`: command line, MCP server and UI server |
| `lib/web/` | the pages of the web UI (`packages/web/dist`) |
| `lib/docs/` | the documentation site of this version (SR-141) |
| `examples/junit/` | the example of connecting a test tool (`toolchain/junit/`) |
| `THIRD_PARTY_NOTICES.txt` | the licences of everything inside, Node's full `LICENSE` included |

Every path is relative, so the folder can be moved as a whole, for example into a desktop shell's bundle.

## Build a delivery by hand

```sh
pnpm install --frozen-lockfile && pnpm build
REQSEQ_DOCS_OFFLINE=1 pnpm docs:build              # the documentation site a delivery ships (SR-141)
node scripts/package/stage.mjs --docs-site          # checks it and its licences, into build/docs-site/
mkdir -p build/node-archives && node scripts/package/stage.mjs --node-urls |
  while read -r url file; do curl -fsSL -o "build/node-archives/$file" "$url"; done
node scripts/package/stage.mjs                      # stages build/package/, writes the three archives
node scripts/package/stage.mjs --pack               # the CLI tarball
scripts/package/delivery-tests.sh                   # the delivery tests (Linux: as a normal user with sudo)
```

The release job `docs-site` runs the same two docs steps, and CI runs them on every pull request (step "Docs - check
the offline site a delivery ships"). `stage.mjs` checks every Node archive against `node.json` before it takes a file
from it, and needs `zip` and `tar`. The artifacts land in `delivery/`; the delivery itself downloads nothing (SR-078).

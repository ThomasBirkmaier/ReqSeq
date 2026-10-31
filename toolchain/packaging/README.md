# toolchain/packaging

Builds the portable delivery of ADR-0014 with electron-builder. Only the workflow `Release`
(`.github/workflows/release.yml`) installs and runs it; pull requests never do.

| File | What |
| --- | --- |
| `names.json` | Every product, artifact and launcher name: product name, app id, launcher, package scope, CLI tarball and artifact name pattern. A rename changes this file only. |
| `package.json`, `pnpm-lock.yaml` | electron-builder (MIT), pinned, with a lockfile of its own outside the workspace (exception to ADR-0001, so that PR CI does not install it). |
| `electron-builder.config.mjs` | The targets (macOS zip arm64, Linux tar.gz x64, Windows zip x64), the fuses, the extra resources. Reads the staged folders from the environment that `scripts/package/stage.mjs` prints. |
| `icon/` | The app icon (#410): the master `icon.svg` and what `scripts/icon/generate.mjs` renders from it (`icon.icns`, `icon.ico`, `icons/<size>x<size>.png`; also the window icon of the app and the docs favicons). After changing the master, run `node scripts/icon/generate.mjs` and commit its output. |
| `launchers/` | Templates of the command line launcher `bin/<launcher>` (POSIX shell and Windows `.cmd`); `stage.mjs` renders them from `names.json`. |

## Build a delivery by hand

```sh
pnpm install --frozen-lockfile && pnpm build && pnpm --filter @reqseq/app build:electron
pnpm install --dir toolchain/packaging --ignore-workspace --frozen-lockfile --ignore-scripts
eval "$(node scripts/package/stage.mjs)"          # stages build/package/, prints the environment
toolchain/packaging/node_modules/.bin/electron-builder --projectDir build/package/app \
  --config "$PWD/toolchain/packaging/electron-builder.config.mjs" --linux --publish never   # or --mac
node scripts/package/stage.mjs --pack              # the CLI tarball
scripts/package/delivery-tests.sh                  # the delivery tests (Linux: as a normal user with sudo)
```

The artifacts land in `delivery/`. electron-builder downloads the Electron zip for the target at build time
(checksum-verified); the delivery itself downloads nothing (SR-078).

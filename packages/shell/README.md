# @reqseq/shell

The desktop shell (D-084, ADR-0021): a Tauri program on the web engine of the operating system that starts `reqseq ui` of its release, shows its pages in its window and ends the server with its own end (SR-252). It calls no command and reads no workspace file. A Cargo workspace with two crates:

- `shell/`: the program `reqseq-shell`. The rules are a library behind the `Host` trait (`src/run.rs`): start, the address the server prints, opening an address, failure and end; and behind the `Dialog` trait (`src/pick.rs`) the dialogs for a folder, an existing file and the target of a file (SR-253 AK1). `src/main.rs`, `src/host.rs`, `src/engine.rs` and `src/frame.rs` wire Tauri, the window, the engine settings and the window's frame; `src/unix.rs` and `src/windows.rs` start and end the server's process group or Job Object and filter the token out of the shell's own standard output and error output.
- `launcher/`: the Linux program `ReqSeq`. It loads `libwebkit2gtk-4.1.so.0` first and, when it is missing, names the package `libwebkit2gtk-4.1-0` and ends with exit code 1 (SR-252 AK8); otherwise it runs `reqseq-shell` beside it.

The pages reach the shell only through `packages/web/src/shell.ts`, with the commands `pick_folder`, `pick_file`, `pick_save_target` and `open_address`, which only the window on the server's exact origin may call. A dialog takes an absolute local folder to open in and, for a target, a plain file name to propose; it answers one absolute path or `null`, one dialog at a time. The command that gets the path decides what it may do (SR-253 AK2).

```sh
cd packages/shell
cargo fmt --all --check
cargo clippy --locked --offline --workspace --all-targets --all-features -- -D warnings -W clippy::pedantic
cargo llvm-cov --locked --offline --workspace --lib --fail-under-lines 100 --fail-under-functions 100 --fail-under-regions 100
cargo audit
node ../../scripts/licenses/crates.mjs     # the licences of the shipped crates, ADR-0015
pnpm build                                 # at the root: the CLI the e2e suite starts
pnpm --filter @reqseq/shell build:e2e      # target/debug/reqseq-shell with the e2e driver, and the launcher
pnpm --filter @reqseq/shell test:e2e
```

Linux needs `libwebkit2gtk-4.1-dev`, and for the e2e suite a display, a session bus and `strace` with `CAP_SYS_PTRACE` over the shell, because the shell is not dumpable (ADR-0021, End): root, or `unshare -r` as in CI. CI runs the suite as `unshare -rn sh -c 'ip link set lo up && exec xvfb-run -a dbus-run-session -- ./node_modules/.bin/vitest run --config vitest.shell.config.ts'`, so it has no network. `rust-toolchain.toml` pins the Rust version, and Cargo builds with `tauri/custom-protocol`, without the Tauri CLI.

## The e2e build

The feature `e2e` adds a driver (`shell/src/e2e.rs`) and is never in a release. The suite (`e2e/`) starts `reqseq-shell` with it and talks to it:

- Standard input, one JSON object per line: `{"eval": "<script>", "id": n}` runs a script in the window and answers with its JSON result, `{"close": true}` closes the window, `{"crash": true}` aborts the shell, `{"dialog": "<path>"}` or `{"dialog": null}` queues the answer of the next dialog (the stand-in of the system's dialog; with nothing queued it gives none).
- Standard output: `e2e <kind> <JSON>` lines: `shown` (the origin), `page-load`, `navigation` (allowed or refused), `open_address` (each call of a page), `dialog` (what the dialog would show first), `queued`, `report` (a reason the shell names), `eval` and `error`.
- Variables: `REQSEQ_SHELL_E2E_NODE` and `REQSEQ_SHELL_E2E_CLI` start another Node or CLI (the fake server `e2e/fixtures/server.mjs`), `REQSEQ_SHELL_E2E_ADDRESS_WAIT_MS` shortens the 30 s wait for the address, `REQSEQ_SHELL_E2E_ROOT` names the folder that stands in for the root of the file system (SR-252 AK10), and `REQSEQ_SHELL_E2E_OPENER` (with `REQSEQ_SHELL_E2E_OPENER_NODE`) replaces the system's opener on macOS and Windows; on Linux the suite puts a fake `xdg-open` first in `PATH`.

## What runs where

| Check | Linux | macOS, Windows |
| --- | --- | --- |
| format, clippy, unit tests | yes | yes |
| coverage 100 % (`--lib`), crate licences, audit | yes | no |
| e2e: start, end, failures, opening an address (SR-252 AK3, AK4, AK5, AK9, AK10), the dialogs (SR-253) | yes, without network | yes |
| e2e with strace: token, programs and files, connections (SR-252 AK2, AK6, AK7) | yes | no recorder yet |

## The release build

The release workflow builds `cargo build --release --locked --offline -p shell` (and `-p launcher` on Linux) on each
system, without the `e2e` feature, and `scripts/package/stage.mjs` puts it into the archive: `ReqSeq.app` on macOS
(the shell as `Contents/MacOS/ReqSeq`, the rest of the release in `Contents/Resources/`, where `start.rs` looks for
it), `ReqSeq.exe` on Windows, `ReqSeq` and `reqseq-shell` on Linux. The binary carries the text
`reqseq-shell build: release` only when it is built with `tauri/custom-protocol` and without `e2e` (`main.rs`), which
the inspection of the delivery checks (`packages/testkit/src/delivery.ts`). The delivery tests in `test/delivery/`
start that build from outside, through the process table, the open files and the connections of the system (SR-252
AK1, AK8); only `scripts/package/delivery-tests.sh` runs them.

Not measured by the coverage: `main.rs`, `host.rs`, `engine.rs`, `frame.rs` and `e2e.rs` (the Tauri wiring, which the e2e suite runs) and the Windows-only `windows.rs`.

# ADR-0021: Desktop shell: Tauri host, test seam and lean CI

Status: Accepted · Based on: D-084, D-083, D-019, D-029, D-036 · SRs: SR-078, SR-247, SR-248, SR-249, SR-252, SR-253 · Changes: ADR-0002, ADR-0011, ADR-0015, ADR-0016, ADR-0020

## Context

D-084 adds a desktop shell, built with Tauri on the web engine of the operating system: WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux. The shell is only a host:

- it starts the UI server of the same release, shows its pages in its window and ends the server with its own end (SR-252);
- it offers the operating system's dialogs for a folder, an existing file and the target of a file (SR-253), and opens an address (SR-252 AK3);
- it calls no command, reads no workspace file and has no update function (D-084).

The web UI, its server and its rules stay as ADR-0020 settles them. SR-247 does not change.

Facts about Tauri 2 and the three engines that cannot be checked without them are marked **(A*n*)**. Each is listed under Assumptions with its fallback. #2377 checks them, and #2379 checks those of the release.

## Decision

### Package

- **`packages/shell/`** is a Cargo workspace with its own `Cargo.toml`, `Cargo.lock` and `rust-toolchain.toml`. The toolchain file pins an exact stable Rust version that is at least two weeks old. The workspace has two crates:
  - `shell`: the Tauri program `reqseq-shell`. It is a library of rules behind a `Host` trait (start, end, open, dialogs, window), plus a thin `main.rs` that wires the real host.
  - `launcher`: the Linux program `ReqSeq` (below). It depends on `libc` only and links neither GTK nor WebKit.
- **No Tauri CLI and no Tauri bundler.** They make installers and download their tools. Cargo builds the binaries with the feature `tauri/custom-protocol`, which the Tauri CLI would otherwise turn on; without it Tauri builds a development binary that looks for a development server. A release test checks that it is on. Then `scripts/package/` assembles `ReqSeq.app`, `ReqSeq.exe` and `ReqSeq` (#2379).
- **Tests and checks.** `packages/shell/package.json` (`@reqseq/shell`, private) holds the e2e tests in `packages/shell/e2e/` with their own `vitest.shell.config.ts`. The root globs (`packages/*/test/**`, `packages/*/test/e2e/**`) do not reach them. `pnpm typecheck` covers them. `pnpm build` and `pnpm test` do not touch Rust.
- **Pages.** The pages reach the shell only through ADR-0020's `shell` module in `packages/web/src/shell.ts`. It gets a second implementation, chosen at run time with `isTauri()`, that calls `invoke` of `@tauri-apps/api/core`, pinned exactly to the release that matches the `tauri` crate. Links in element text open through this module too (#2377).

### Start (SR-252 AK1, AK2, AK10)

1. **Window first.** The shell creates its window hidden, with nothing loaded. If that fails, the shell ends as AK8 says before any server starts.
2. **The server process.** The shell starts the release's runtime directly, not its launcher script. On Windows this means no `cmd.exe`, no batch parsing and no extra process; on Unix no `sh`.
   - Program and arguments: `node` (`node.exe`) and `<CLI entry> ui --no-open`, at the places of the release layout (#2379).
   - Environment: `NODE_OPTIONS` removed, as the launcher does (ADR-0020), and `REQSEQ_UI_END_WITH_STDIN=1` (End).
   - Standard input is a pipe whose write end only the shell holds. Standard output and error are pipes.
   - On Windows the server starts with `CREATE_NO_WINDOW`, so no console window opens. `PROC_THREAD_ATTRIBUTE_HANDLE_LIST` limits the inherited handles to these three pipes. On Unix the server starts in its own process group, so a Ctrl-C in the shell's terminal reaches only the shell.
3. **Where.** The server's current folder is the root of the file system: `/`, or `%SystemDrive%\` on Windows. The CLI looks for `reqseq-workspace.yaml` from the current folder upwards (ADR-0009), and the root is the only folder with no folder above it.
   - If the root holds that file, the shell tests it as the CLI does (`isFile`: links followed, a regular file only) and reads nothing, so a file it cannot read counts too. It starts no server and ends as AK5 says, naming that file with its path as the reason (SR-252 AK10).
4. **The address.** The shell reads standard output line by line until a line `ReqSeq UI on <address>` (the CLI's line, ADR-0020). The address must be `http://` with a loopback host and a port, and must carry `#token=`. Anything else is AK5.
   - Afterwards the shell keeps reading both pipes, so the server never blocks on a full pipe.
   - It keeps the last 2,000 characters of standard error, decoded as UTF-8 with replacement characters.
5. **Showing the pages.** The shell adds the run-time capability (Capabilities), loads the address in the window and shows the window.
6. **Where the token can appear.** It is in no argument and in no file the shell writes. The engine's data folder is the exception that AK2 allows.
   - The shell writes nothing it reads from the server to its own output, except the AK5 reason.
   - The engine's processes inherit the shell's standard output and error, and may print the page's address there. So at its start the shell replaces its own standard output and error with pipes. A thread copies them line by line to the original ones and replaces the token once it is known. Every later process inherits the filtered pipes (A1).
   - Before the replacement the shell keeps a duplicate of the original standard error. The panic hook writes to it a fixed English line and no payload: "the window could not open" before the server started, else "ended unexpectedly". So a panic cannot pass on a token.
   - On every exit path that is not a crash, the shell closes the write ends of the filter pipes and waits for the filter thread before it exits, so the AK5 and AK8 messages reach the original standard error.

### End (SR-252 AK4)

- **A normal end.** This covers the window being closed, Cmd-Q, and SIGTERM, SIGINT or SIGHUP to the shell.
  1. The shell marks itself as ending, so the server's exit is not reported as a failure.
  2. It closes its end of the server's standard input.
  3. `reqseq ui` with `REQSEQ_UI_END_WITH_STDIN=1` stops on end-of-file of its standard input, as it stops on SIGTERM: it lets running writes finish and closes the workspace.
  4. After 3 s the shell kills the server: SIGKILL on Unix, `TerminateJobObject` on Windows. Then the shell exits with 0.

  Closing the window ends the shell on Windows, macOS and Linux, also on macOS, where an app would otherwise keep running without a window.
- **A crash or a kill** (the shell built with `panic = "abort"`, SIGKILL, `TerminateProcess`). The kernel closes the shell's handles. The write end of the server's standard input closes with them, so the server stops as above. This works without the shell's help, on Windows, macOS and Linux.
  - The write end reaches no other process. On Unix, Rust opens its pipes with close-on-exec. On Windows, the handle list above confines the server's handles, and the shell's own end is not inheritable.
- **Windows: the whole tree.** The server is created inside a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` (`CreateProcessW` with `PROC_THREAD_ATTRIBUTE_JOB_LIST`), so it is in the job from its first instruction (A2).
  - The job handle is not inheritable, so only the shell holds it. When the shell dies, the job closes and kills the server and every process the server started, such as Git.
  - On Linux and macOS, end-of-file is the mechanism. A hung server gets SIGKILL on a normal end. On a crash nothing stronger exists without a second process, which AK6 excludes.
- **What changes in the CLI.** The variable adds one condition under which `reqseq ui` ends, and only the shell sets it. The variable is unset in a terminal, so `reqseq ui < /dev/null` behaves as before. SR-247 names when the server ends, and none of its criteria changes. This is a change to ADR-0020, Start and stop, step 7.

### Failures (SR-252 AK5, AK8)

- **Start failures (AK5).** The server cannot start, ends with an error, or prints no address within 30 s. The shell then:
  1. kills the server (End);
  2. destroys the window before anything is loaded from the server;
  3. shows the reason in a message box of the operating system, as plain text in English (D-019). The reason is the stderr tail; without one, "could not start" or "printed no loopback address within 30 s";
  4. writes the same text to its standard error;
  5. exits with a code other than 0.

  If the server ends while the shell runs, and the shell is not ending, it does the same from step 2 on.
- **Missing engine on Linux (AK8).** `ReqSeq` is the launcher. It calls `dlopen("libwebkit2gtk-4.1.so.0", RTLD_LAZY)`, the lookup the dynamic loader would do.
  - If the call fails, the launcher prints on standard error an English message that names the package `libwebkit2gtk-4.1-0` and the loader's reason, and exits with 1.
  - Otherwise it replaces itself with `reqseq-shell` (`exec`), so no further process runs.
- **No window.** The window cannot open, for example with no display or no WebView2 runtime. On Linux `main` calls `gtk::init` itself before the Tauri builder, because a failed GTK start inside Tauri panics. `reqseq-shell` then prints the reason in English on standard error and exits with a code other than 0, before any server starts (Start, step 1). A panic before the server starts gives the fixed line of the panic hook. `ReqSeq.exe`, a GUI program, writes to a standard error that its starter redirected (A3).

### Opening an address (SR-252 AK3)

- **Input.** One string. The `url` crate parses it by the WHATWG rules; a string it cannot parse is refused. The address must be absolute: http and https with a host, or mailto. The scheme is compared after parsing, which lowercases it.
- **Own server.** An address is the own server when the scheme is http or https, the host is in 127.0.0.0/8, `::1` (IPv4-mapped 127.0.0.0/8 included) or `localhost`, and the port is the server's. A missing port counts as the scheme's default port. Parsing turns `127.1`, `0x7f.0.0.1` and decimal forms into `127.0.0.1` first.
- **Refused.** The own server, another scheme, an address without a scheme, or an empty one: the shell starts nothing and answers that it refused.
- **Handed on.** Every other address goes, in its parsed form, to the opener of the operating system. The shell's own platform code calls it, not `tauri-plugin-opener`, whose `open` crate tries several programs in turn on Linux:
  - Windows: `ShellExecuteW` with `open`; the shell itself starts no program.
  - macOS: `/usr/bin/open` with the address as its one argument.
  - Linux: `xdg-open` from `PATH` with the address as its one argument.
  - That one program, with the processes it starts, is the program from AK3 that SR-252 AK6 allows.
  - If no program can start, the page gets an error, and the shell keeps running.
  - A loopback address on another port and a `*.localhost` host are not the own server, as the wording of AK3 says, so they are handed on.
- **Only on a person's input (AK9).** The page calls the opener only from a person's input, through `shell.ts`.
- **The window loads only its server.** `on_navigation` allows only the origin of the printed address: scheme, host as printed, and port. New windows and downloads are refused. A link that does not go through `shell.ts` therefore opens nothing (A4).

### Capabilities (SR-253 AK1)

- **Four commands.** The app commands `pick_folder`, `pick_file`, `pick_save_target` and `open_address` need a permission, through the app manifest of `tauri-build`.
- **One capability.** Once the port is known, the shell adds one capability at run time:
  - window: `main`;
  - `remote.urls`: exactly `http://127.0.0.1:<port>`;
  - permissions: the four commands, and no `core:default`.
- **Everything else is refused.** Tauri's access control refuses every other call and runs nothing: commands of the dialog, opener, window or event plugins, and unknown names (A5).
- **Dialogs.** They run through the Rust API of `tauri-plugin-dialog`, and the pages get none of its permissions.
  - The page's inputs set only the folder the dialog shows first and the proposed file name.
  - The answer is one absolute path, or none when the person cancels or the dialog cannot open.
  - The shell reads, writes and creates no file.
- **SR-253 AK2** needs nothing in the shell: the path goes to a command as a typed one does (SR-248 AK4).

### Calls under the headers of SR-247 AK9

The response headers stay as they are. Tauri's IPC first fetches its own protocol, `ipc://localhost` or `http://ipc.localhost`, which `connect-src 'self'` blocks. It then falls back to the engine's message handler (`postMessage`), which the CSP does not govern, and gets its answers back by native script evaluation (A6). The SR-253 AK1 test shows this on Windows, macOS and Linux. If it fails, a `question` issue follows: widening the CSP would change SR-247 AK9 for the browser too.

### Engine data and the engine's own connections (SR-252 AK2, AK7)

- **No stored browsing data.** The window is `incognito`: WebView2 InPrivate, the non-persistent data store of WKWebView, the ephemeral context of WebKitGTK.
  - Each start has a new port and so a new origin, so storage of an earlier start would never be read again. The token does not outlive the process.
  - Preferences of the pages take their defaults at each start in the shell (ADR-0020: each has a default).
  - The engine's data folder, which WebView2 needs even in InPrivate, is the operating system's per-user app data folder under the app id of `toolchain/packaging/names.json`.
- **Engine connections switched off.**
  - WebView2: SmartScreen and background networking off through the browser arguments; autofill and password saving off.
  - WKWebView: the fraudulent-website warning off.
  - WebKitGTK: DNS prefetching off.

  Which switches exist, and whether they are enough, is checked by the AK7 test (A7).
- **What AK7 covers.** Updates of the WebView2 runtime are the operating system's service, not a process that shows the window. AK7 does not cover them.

### No download at install time (SR-078 AK2)

The release has no installer, so there is no WebView2 bootstrapper and no runtime of a fixed version. Windows 11 ships the Evergreen WebView2 runtime. Without it the window cannot open, and AK8 applies.

### Test seam and evidence

Three layers, with no switch in a release build:

1. **Rust unit tests.** The rules above run against a fake `Host`: the start and its arguments, the address line, the stderr tail, the reasons, the address rule, the command list, the inputs of the dialogs, and the redaction.
2. **e2e build.** The cargo feature `e2e` is only in test builds. A release test checks that the shipped binary lacks it.
   - Its driver reads commands from a channel of its own: run a script in the page as a person's input (click a link, choose in a dialog stand-in), close the window, crash, record the pages' calls to the shell.
   - Vitest tests in `packages/shell/e2e/` start this build with the CLI built from the checkout.
3. **Recording at process level,** with no product switch (A8):
   - programs and opened files: `strace -f` on Linux, `eslogger` or `fs_usage` on macOS, the ETW kernel process and file providers through `logman` on Windows;
   - connections:
     - Linux: a network namespace with a dummy default route and an nftables rule that drops and logs;
     - Windows: firewall rules that block outbound traffic of the shell, `node.exe` and `msedgewebview2.exe` by path, with logging of dropped packets;
     - macOS: pf `block log` for the sockets of a test user.

Plus the **release tests** on the unpacked artifacts in the release workflow (ADR-0011).

| Criterion | Evidence | Operating systems |
| --- | --- | --- |
| SR-252 AK1 | release test: started from a folder with a workspace and with arguments; the recorded server arguments and folder; the server's answer to a page request and to a request with the token | Windows, macOS, Linux |
| SR-252 AK2 | e2e: recorded arguments, the shell's standard output and error, the files the shell writes; unit: redaction | all three |
| SR-252 AK3 | unit: the address rule; e2e: a click in the page, the recorded handover, refusals, a failing opener | all three |
| SR-252 AK4 | e2e: window closed, crash; e2e and release test: SIGTERM, SIGKILL or `TerminateProcess`; the address stops answering within 5 s | all three |
| SR-252 AK5 | unit: reasons and the tail; e2e: a server that fails, one that prints nothing, one that ends while the shell runs | all three |
| SR-252 AK6 | e2e with process-level recording while elements are read and changed | all three |
| SR-252 AK7 | e2e with recorded connections, an element with a remote image and raw HTML | all three |
| SR-252 AK8 | release test: as the last Linux step `dpkg -r --force-depends libwebkit2gtk-4.1-0` (no network needed), and a start without a display; e2e on Windows: no usable WebView2 runtime (A3) | Ubuntu 24.04, Windows |
| SR-252 AK9 | e2e: the pages' calls recorded while elements with links and raw HTML load; then one click | all three |
| SR-252 AK10 | unit: the rule; e2e: a readable and an unreadable workspace file in the folder the e2e build takes for the root (`REQSEQ_SHELL_E2E_ROOT`), no server started, the reason names the file | all three (unreadable: macOS, Linux) |
| SR-253 AK1 | e2e: each of the four commands, a plugin command and an unknown name refused; unit: dialog inputs | all three |
| SR-253 AK2 | e2e: a chosen path outside the repositories is refused by the command | all three |
| SR-249 AK3 | release test (#2379) | all three |

### Building without network

- **Before the network is blocked:**
  - `cargo fetch --locked` runs with network. `~/.cargo/registry` and `target/` are cached, keyed on `Cargo.lock` and the toolchain.
  - Linux: apt installs `libwebkit2gtk-4.1-dev` and the other build packages, plus `libwebkit2gtk-4.1-0` and `xvfb` for the tests.
- **After:** `cargo build --locked --offline` and every test run with the network blocked (ADR-0011).
- **No build scripts that download.** No crate whose build script downloads is allowed.

### Lean CI (changes ADR-0011)

- **When the shell steps run.**
  - On a pull request, only when `tests-needed.sh` gives `shell` not `false`. That is the case for changes to `packages/shell/**`, `packages/web/**`, `packages/api/**`, `packages/cli/**`, `scripts/package/**`, `toolchain/packaging/**` and `.github/**`.
  - CI reads the base branch's copy of the classifier. The pull request that brings these steps (#2377) runs them because an empty output counts as "run".
  - Nightly and manual runs always run them.
- **Where.** They run in the existing `checks` job, so the required checks cover them without a change of branch protection. Their OS-specific setup has `runner.os` guards, because the platform lane reuses these steps. Only when the steps run does the job's time bound grow, by the time #2377 measures.
- **What runs.**
  - Windows, macOS and Linux: `cargo fmt --check`, clippy, the unit tests, the e2e build and a **start check**: the shell starts, its page loads, the window closes, and the address stops answering within 5 s.
  - Linux only: the crate licences and the coverage.
- **The release workflow** builds the release shell on `macos-26`, `windows-2025` and `ubuntu-24.04`, signs it on macOS, and runs the release tests and the e2e suite on all three.

### Quality gates (changes ADR-0016)

- **Lint.** `cargo fmt --check` and `cargo clippy --all-targets --all-features -- -D warnings -W clippy::pedantic`, so the `e2e` driver is linted too. A warning fails as in ESLint, and an `#[allow(clippy::…)]` needs a written reason, as `eslint-disable` does.
- **Unsafe code.** `#![deny(unsafe_code)]` at each crate root, and `#[allow(unsafe_code)]` only on the platform modules (Job Object, process creation, `dlopen`, `exec`). Every `unsafe` block there has a `SAFETY:` comment.
- **Coverage.** The library of `shell` and the `launcher` crate are new packages, so the threshold of 100 % per file applies. `cargo llvm-cov` measures lines, functions and regions on Linux (`--fail-under-lines 100`, `--fail-under-functions 100`, `--fail-under-regions 100`), the regions standing in for branches and statements (A9).
  - Not measured that way: Rust branch coverage as such, which needs a nightly compiler; `main.rs`, the Tauri wiring that only the e2e and release tests run; and the Windows-only and macOS-only modules.
  - Before #2377 leaves any of these out, it opens the `task` issue ADR-0016 requires, and the product owner decides there. Until then the threshold is not lowered.

### Crates and licences (changes ADR-0015)

- **Pins.** Direct crates are pinned exactly (`=x.y.z`), at least two weeks old, with `Cargo.lock` committed. The `tauri` crate and `@tauri-apps/api` move together.
- **Licences.** `scripts/licenses/crates.mjs` checks the licence of every crate in `cargo metadata --locked --offline` against ADR-0015's allowlist, and their texts go into the notices of the release.
  - A licence outside the allowlist needs the product owner's answer first, with `needs-human` on the issue, before #2377 merges. Unicode-3.0, from the ICU4X crates behind `url`, is likely to be one. This ADR does not widen the allowlist.
- **Audit.** `cargo audit` checks against the RustSec database, pinned and cached, in the shell steps and nightly. An advisory that is not informational blocks.
- **Pages.** `@tauri-apps/api` is a runtime dependency of `@reqseq/web`, named with its licence in the pull request that adds it.

### Signing

- **macOS.** After assembly, the release script signs `ReqSeq.app` ad hoc (`codesign --sign -`): first the shell's executables, then the bundle, so the seal covers `Info.plist` and the resources. Node keeps its own signature. Removing quarantine stays a step of the install guide (ADR-0020) (A10).
- **Windows.** `ReqSeq.exe` is not signed. The install guide names the warning that Windows shows for it (#2379).

### Host code and the catalog (changes ADR-0002)

The shell's Rust code is host code. Its four functions are not catalog functions (D-084). It holds no rule of the tool: what a chosen path may do is decided by the command that gets it.

## Assumptions

Each assumption is checked in #2377, except A10, which #2379 checks. If one fails, the fallback applies, or a new decision is made in that issue.

| | Assumption | Fallback |
| --- | --- | --- |
| A1 | Replacing the shell's standard output and error before the engine starts reaches the engine's processes on Windows, macOS and Linux. | Start the engine's processes with null output where the engine allows it. |
| A2 | `PROC_THREAD_ATTRIBUTE_JOB_LIST` and `HANDLE_LIST` work together, and WebView2 runs normally beside a job that holds only the server. | Assign the server to the job right after it is created, before it is resumed (`CREATE_SUSPENDED`). |
| A3 | `ReqSeq.exe`, a GUI-subsystem program, writes to a standard error that its starter redirected; an e2e start with `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER` set to an empty folder makes the window fail as without a runtime. | Attach to the console of the starting process (`AttachConsole`) for the AK8 message; another way to make the runtime unusable in the test. |
| A4 | The pinned Tauri 2 has navigation, new-window and download hooks for a remote URL, on all three engines. | Refuse the load in the engine's own navigation callback through Tauri's platform webview access. |
| A5 | Remote-URL capabilities can be added at run time for an exact origin with a port, and every call without a permission is refused before any code runs. | Fix the capability at build time to `http://127.0.0.1:*` and check the port in each command. |
| A6 | Tauri's IPC works under the unchanged CSP through the `postMessage` fallback. | A `question` issue on SR-247 AK9. |
| A7 | The engine switches above exist, and with them no connection to another machine is recorded. | Further switches, or a `bug` issue against the engine setup. |
| A8 | The recording tools run on the hosted runners: `strace`, `eslogger` or `fs_usage` with sudo, `logman`, firewall logging, pf. | The e2e build's host records what the shell starts; the engine's processes are then not covered on that operating system, and the gap becomes a `question` issue. |
| A9 | `cargo llvm-cov` and `llvm-tools` can be installed with network and cached. | The coverage step stays in the pull request checks and installs them each run; any other change goes into the ADR-0016 `task` issue. |
| A10 | An ad hoc signed `ReqSeq.app` with its quarantine removed starts on macOS 26 on Apple Silicon. | Decide in #2379. |

## Consequences

- **ADR-0020.** The `shell` module gets its second implementation. Its Start and stop list gets `REQSEQ_UI_END_WITH_STDIN`. Its consequence "A save dialog for a place outside the repositories, with a desktop shell, needs a spec change of SR-248 AK4" is settled by SR-253 AK2: a chosen path is bounded like a typed one. Its release table gains the shell's files (#2379).
- **Preferences** do not persist between starts of the shell, because the port and so the origin are new on each start.
- **CI.** A pull request that changes the CLI, the API, the pages or the release build also builds Rust, on Linux in a draft and on Windows, macOS and Linux when ready.
- **The root case.** The shell cannot start when the root of the file system, or on Windows of the system drive, holds a workspace file (SR-252 AK10).

## Rejected

- **Electron:** D-083 and D-084.
- **The Tauri CLI and bundler:** installers, and tools downloaded at build time.
- **Starting the launcher script:** on Windows it means `cmd.exe`, a console window and one more process.
- **`--port` or `--workspace`:** excluded by SR-252 AK1. A fixed port would keep the preferences, but AK1 rules it out.
- **End-of-file of standard input without the variable:** it would end `reqseq ui < /dev/null` and every caller that closes standard input.
- **The server watching the shell's PID:** PIDs are reused, and Windows does not hand an orphaned process to a new owner.
- **`PR_SET_PDEATHSIG` alone:** Linux only, and it fires when the starting thread ends, not the starting process.
- **A watchdog process:** SR-252 AK6 allows no other program.
- **`TerminateJobObject` as the normal end on Windows:** it would cut a running write.
- **WebDriver through `tauri-driver`:** it has no driver for WKWebView on macOS, and it would need a download that matches the engine version.
- **Persistent engine storage:** a new origin on each start, and the token in the history.
- **Widening the CSP for Tauri's IPC:** it would change SR-247 AK9 for the browser.

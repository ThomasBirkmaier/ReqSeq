//! The test driver of the e2e build (ADR-0021, Test seam; cargo feature `e2e`, never in a release). It reads
//! commands as JSON lines from the shell's standard input and writes what happened as lines `e2e <kind> <JSON>` to
//! its standard output, which passes the filter like every other output of the shell.
//!
//! Commands: `{"eval": "<script>", "id": <n>}` runs a script in the page, as a person's input would, and answers
//! `e2e eval {"id": <n>, "result": <JSON text>}`; `{"close": true}` closes the window; `{"crash": true}` aborts the
//! process; `{"dialog": "<path>"}` or `{"dialog": null}` queues the answer of the next dialog.
//! The dialog stand-in records what the dialog would show first (`e2e dialog`) and gives the queued answer, or none
//! when nothing is queued.
use shell::pick::{Pick, Shown};
use shell::start::Layout;
use std::collections::VecDeque;
use std::io::{BufRead as _, Write as _};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};
use std::time::Duration;
use tauri::{AppHandle, Manager as _};

/// Writes one line `e2e <kind> <value as JSON>`.
pub fn record(kind: &str, value: impl Into<serde_json::Value>) {
    let line = format!("e2e {kind} {}\n", value.into());
    let mut out = std::io::stdout().lock();
    let _ = out.write_all(line.as_bytes()).and_then(|()| out.flush());
}

/// The Node binary and CLI entry the test names in `REQSEQ_SHELL_E2E_NODE` and `REQSEQ_SHELL_E2E_CLI`.
pub fn layout() -> Option<Layout> {
    Some(Layout {
        node: std::env::var_os("REQSEQ_SHELL_E2E_NODE")?.into(),
        cli: std::env::var_os("REQSEQ_SHELL_E2E_CLI")?.into(),
    })
}

/// The folder that stands in for the root of the file system, from `REQSEQ_SHELL_E2E_ROOT`, so that a test can put a
/// workspace file there (SR-252 AK10).
pub fn root() -> Option<std::path::PathBuf> {
    std::env::var_os("REQSEQ_SHELL_E2E_ROOT").map(Into::into)
}

/// A shorter wait for the address line, from `REQSEQ_SHELL_E2E_ADDRESS_WAIT_MS`.
pub fn address_wait() -> Option<Duration> {
    millis("REQSEQ_SHELL_E2E_ADDRESS_WAIT_MS")
}

/// A shorter wait for the window, from `REQSEQ_SHELL_E2E_WINDOW_WAIT_MS`.
pub fn window_wait() -> Option<Duration> {
    millis("REQSEQ_SHELL_E2E_WINDOW_WAIT_MS")
}

fn millis(variable: &str) -> Option<Duration> {
    let millis = std::env::var(variable).ok()?.parse().ok()?;
    Some(Duration::from_millis(millis))
}

/// The opener script the test names in `REQSEQ_SHELL_E2E_OPENER`, run with the address as its one argument by the
/// Node of `REQSEQ_SHELL_E2E_OPENER_NODE` (default `REQSEQ_SHELL_E2E_NODE`), on macOS and Windows, where the
/// system's opener would start a browser on the test machine.
pub fn open_with(script: &Path, url: &str) -> Result<(), String> {
    let node = std::env::var_os("REQSEQ_SHELL_E2E_OPENER_NODE")
        .or_else(|| std::env::var_os("REQSEQ_SHELL_E2E_NODE"))
        .ok_or("REQSEQ_SHELL_E2E_NODE is not set")?;
    let mut child = std::process::Command::new(node)
        .arg(script)
        .arg(url)
        .stdin(std::process::Stdio::null())
        .spawn()
        .map_err(|error| format!("{}: {error}", script.display()))?;
    std::thread::spawn(move || child.wait());
    Ok(())
}

/// The answers of the next dialogs, in order.
static ANSWERS: Mutex<VecDeque<Option<PathBuf>>> = Mutex::new(VecDeque::new());

/// The stand-in of the operating system's dialog: records what it would show first and gives the queued answer.
pub fn dialog(pick: Pick, shown: &Shown) -> Option<PathBuf> {
    record(
        "dialog",
        serde_json::json!({
            "command": pick.command(),
            "folder": shown.folder.as_ref().map(|f| f.to_string_lossy()),
            "name": shown.name,
        }),
    );
    ANSWERS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .pop_front()
        .flatten()
}

/// Reads the commands on a thread of its own.
pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines() {
            let Ok(line) = line else { return };
            let Ok(command) = serde_json::from_str::<serde_json::Value>(&line) else {
                record("error", format!("not a command: {line}"));
                continue;
            };
            if let Some(answer) = command.get("dialog") {
                let answer = answer.as_str().map(PathBuf::from);
                ANSWERS
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .push_back(answer);
                record("queued", command["dialog"].clone());
                continue;
            }
            let Some(window) = app.get_webview_window(shell::WINDOW) else {
                record("error", "no window");
                continue;
            };
            if command.get("crash").is_some() {
                std::process::abort();
            } else if command.get("close").is_some() {
                let _ = window.close();
            } else if let Some(script) = command.get("eval").and_then(serde_json::Value::as_str) {
                let id = command.get("id").cloned().unwrap_or_default();
                let sent = window.eval_with_callback(script, move |result| {
                    let result = serde_json::from_str(&result).unwrap_or(serde_json::Value::String(result));
                    record("eval", serde_json::json!({ "id": id, "result": result }));
                });
                if let Err(error) = sent {
                    record("error", error.to_string());
                }
            }
        }
    });
}

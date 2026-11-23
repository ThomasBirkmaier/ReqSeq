//! `reqseq-shell` (ADR-0021): wires Tauri and the operating system as the `Host` of the shell's rules in the
//! library. Only the e2e and release tests run this file (ADR-0021, Quality gates).
#![deny(unsafe_code)]
#![cfg_attr(windows, windows_subsystem = "windows")]

#[cfg(feature = "e2e")]
mod e2e;
mod engine;
mod frame;
mod host;

use shell::redact::TokenSlot;
use shell::run::Event;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock, mpsc};

/// Which build this is, as text in the binary: the release tests find `reqseq-shell build: release` in the shipped
/// program, which only a build with `tauri/custom-protocol` and without `e2e` carries (ADR-0021, Package). `main`
/// reads it, because `#[used]` alone does not keep it from the MSVC linker's `/OPT:REF`.
#[used]
static BUILD: &str = if cfg!(feature = "e2e") {
    "reqseq-shell build: e2e"
} else if tauri::is_dev() {
    "reqseq-shell build: development"
} else {
    "reqseq-shell build: release"
};

/// Set once the server has been asked to start, for the fixed line of the panic hook.
static SERVER_STARTED: AtomicBool = AtomicBool::new(false);

/// The original standard error, before the filter, and the shell's way to write to it.
static ORIGINAL_STDERR: OnceLock<Mutex<std::fs::File>> = OnceLock::new();

/// What the controller thread handles: an event of the shell's life, or a page's call to open an address.
pub enum Input {
    Event(Event),
    Open(String, mpsc::Sender<Result<(), String>>),
}

/// Writes `text` to the original standard error, with the token replaced.
pub fn write_error(text: &str, token: &TokenSlot) {
    if let Some(stderr) = ORIGINAL_STDERR.get() {
        let line = shell::redact::redact(text.as_bytes(), token.get().map(Vec::as_slice));
        let mut file = stderr.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let _ = std::io::Write::write_all(&mut *file, &line);
    }
}

fn main() {
    // Keeps the build mark in the binary on every linker.
    std::hint::black_box(BUILD);
    #[cfg(unix)]
    shell::unix::block_end_signals();
    // A crash then writes no core dump, which would keep the server's standard input open while it is written
    // (ADR-0021, End; #2413).
    #[cfg(target_os = "linux")]
    shell::unix::no_core_dump();
    let token: TokenSlot = Arc::default();
    let filter = host::install_filter(&token);
    // A panic writes a fixed line and no payload, so it cannot pass on a token (ADR-0021, Start step 6).
    std::panic::set_hook(Box::new(|_| {
        let line = if SERVER_STARTED.load(Ordering::SeqCst) {
            "ReqSeq: the shell ended unexpectedly.\n"
        } else {
            "ReqSeq: the window could not open.\n"
        };
        write_error(line, &Arc::default());
    }));
    let code = host::run(token.clone(), filter);
    std::process::exit(code);
}

/// Records that the server is being started.
pub fn server_started() {
    SERVER_STARTED.store(true, Ordering::SeqCst);
}

/// Keeps `file` as the original standard error.
pub fn keep_original_stderr(file: std::fs::File) {
    let _ = ORIGINAL_STDERR.set(Mutex::new(file));
}

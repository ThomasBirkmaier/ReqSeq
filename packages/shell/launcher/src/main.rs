//! `ReqSeq` on Linux (ADR-0021, Failures): exit 1 with the package's name when the web engine is missing, else
//! `exec` of `reqseq-shell`, so no further process runs.
#![deny(unsafe_code)]

#[cfg(target_os = "linux")]
fn main() {
    use std::io::Write as _;
    use std::os::unix::process::CommandExt as _;

    if let Err(reason) = launcher::engine::load(launcher::ENGINE_LIBRARY) {
        let _ = std::io::stderr().write_all(launcher::missing_engine_message(&reason).as_bytes());
        std::process::exit(1);
    }
    let exe = std::env::current_exe().unwrap_or_default();
    let shell = launcher::shell_beside(&exe);
    // `exec` returns only when it failed.
    let error = std::process::Command::new(&shell)
        .args(std::env::args_os().skip(1))
        .exec();
    let _ = std::io::stderr().write_all(launcher::no_shell_message(&shell, &error.to_string()).as_bytes());
    std::process::exit(1);
}

#[cfg(not(target_os = "linux"))]
fn main() {
    eprintln!("ReqSeq: this launcher is for Linux; start reqseq-shell instead.");
    std::process::exit(1);
}

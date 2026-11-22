//! The desktop shell `reqseq-shell` (ADR-0021, D-084): the rules of its start, end, failures and the opening of
//! addresses, behind the `Host` of `run`, plus the platform code it needs. `main.rs` wires Tauri as the real host.
//! The shell calls no command, reads no workspace file and has no update function.
#![deny(unsafe_code)]

pub mod address;
pub mod redact;
pub mod run;
pub mod server;
pub mod start;
pub mod tail;

#[cfg(unix)]
#[allow(unsafe_code)] // ADR-0021, Quality gates: process groups, descriptors and signals need libc.
pub mod unix;

#[cfg(windows)]
#[allow(unsafe_code)]
// ADR-0021, Quality gates: process creation, the Job Object, standard handles and the opener.
pub mod windows;

/// The commands the pages may call, each behind a permission of the app manifest (ADR-0021, Capabilities).
pub const COMMANDS: &[&str] = &["open_address"];

/// The label of the one window.
pub const WINDOW: &str = "main";

/// Whether `path` is a regular file, links followed, as the CLI's `isFile` tests it. Reads nothing.
#[must_use]
pub fn is_file(path: &std::path::Path) -> bool {
    std::fs::metadata(path).is_ok_and(|m| m.is_file())
}

#[cfg(test)]
mod tests {
    #[test]
    fn only_regular_files_count() {
        let dir = std::env::temp_dir().join(format!("reqseq-shell-isfile-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("folder.yaml")).unwrap();
        std::fs::write(dir.join("file.yaml"), "x").unwrap();
        assert!(super::is_file(&dir.join("file.yaml")));
        assert!(!super::is_file(&dir.join("folder.yaml")));
        assert!(!super::is_file(&dir.join("missing.yaml")));
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(dir.join("file.yaml"), dir.join("link.yaml")).unwrap();
            assert!(super::is_file(&dir.join("link.yaml")));
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

//! The desktop shell `reqseq-shell` (ADR-0021, D-084): the rules of its start, end, failures, the opening of
//! addresses and the dialogs, behind the `Host` of `run` and the `Dialog` of `pick`, plus the platform code it needs. `main.rs` wires Tauri as the real host.
//! The shell calls no command, reads no workspace file and has no update function.
#![deny(unsafe_code)]

pub mod address;
pub mod pick;
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
pub const COMMANDS: &[&str] = &["pick_folder", "pick_file", "pick_save_target", "open_address"];

/// The permissions of the run-time capability: one per command, as `tauri-build` names them from the app manifest.
#[must_use]
pub fn permissions() -> Vec<String> {
    COMMANDS
        .iter()
        .map(|command| format!("allow-{}", command.replace('_', "-")))
        .collect()
}

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
    fn the_pages_get_the_three_dialogs_and_the_opener() {
        use super::pick::Pick;
        let picks = [Pick::Folder, Pick::File, Pick::Target].map(Pick::command);
        assert_eq!(super::COMMANDS[..3], picks);
        assert_eq!(super::COMMANDS[3..], ["open_address"]);
        assert_eq!(
            super::permissions(),
            [
                "allow-pick-folder",
                "allow-pick-file",
                "allow-pick-save-target",
                "allow-open-address"
            ]
        );
    }

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

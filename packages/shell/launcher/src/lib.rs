//! The Linux program `ReqSeq` (ADR-0021, Failures): it looks for the web engine as the dynamic loader would, and
//! either names the missing package or hands over to `reqseq-shell` in its own folder. It links neither GTK nor
//! `WebKit`, so it starts where they are missing.
#![deny(unsafe_code)]

use std::path::{Path, PathBuf};

/// The library of `WebKitGTK` that `reqseq-shell` links.
pub const ENGINE_LIBRARY: &str = "libwebkit2gtk-4.1.so.0";
/// The Ubuntu 24.04 package that ships it (SR-252 AK8).
pub const ENGINE_PACKAGE: &str = "libwebkit2gtk-4.1-0";
/// The program the launcher becomes.
pub const SHELL_PROGRAM: &str = "reqseq-shell";

/// The English message on standard error when the engine cannot be loaded: the package and the loader's reason.
#[must_use]
pub fn missing_engine_message(reason: &str) -> String {
    format!(
        "ReqSeq cannot start: the web engine is missing. Install the package {ENGINE_PACKAGE} \
         (sudo apt install {ENGINE_PACKAGE}) and start ReqSeq again.\nReason: {reason}\n"
    )
}

/// The English message when `reqseq-shell` cannot be started.
#[must_use]
pub fn no_shell_message(shell: &Path, reason: &str) -> String {
    format!("ReqSeq cannot start {}: {reason}\n", shell.display())
}

/// `reqseq-shell` in the folder of the launcher `exe`.
#[must_use]
pub fn shell_beside(exe: &Path) -> PathBuf {
    exe.with_file_name(SHELL_PROGRAM)
}

#[cfg(target_os = "linux")]
#[allow(unsafe_code)]
pub mod engine {
    //! The lookup of the engine with `dlopen`.
    use std::ffi::{CStr, CString};

    /// Loads `library` with `RTLD_LAZY`, as the dynamic loader would at the start of `reqseq-shell`; the loader's
    /// reason when it fails. The library stays loaded until the process is replaced.
    ///
    /// # Errors
    ///
    /// The text of `dlerror` when the library cannot be loaded, or that the name holds a NUL.
    pub fn load(library: &str) -> Result<(), String> {
        let name = CString::new(library).map_err(|_| format!("{library:?} holds a NUL"))?;
        // SAFETY: `name` is a valid NUL-terminated string that lives across the call; `dlopen` reads it only.
        let handle = unsafe { libc::dlopen(name.as_ptr(), libc::RTLD_LAZY) };
        if handle.is_null() {
            // SAFETY: `dlerror` returns null or a NUL-terminated string owned by the loader, valid until the next
            // call of a dl function on this thread; `text_of` copies it at once.
            let reason = unsafe { text_of(libc::dlerror()) };
            return Err(reason.unwrap_or(format!("{library} could not be loaded")));
        }
        Ok(())
    }

    /// The text of a C string, or `None` for a null pointer.
    ///
    /// # Safety
    ///
    /// `text` is null or points to a NUL-terminated string that stays valid during the call.
    #[must_use]
    pub unsafe fn text_of(text: *const libc::c_char) -> Option<String> {
        // SAFETY: as the caller promises.
        (!text.is_null()).then(|| unsafe { CStr::from_ptr(text) }.to_string_lossy().into_owned())
    }

    #[cfg(test)]
    #[test]
    fn a_null_text_is_none() {
        // SAFETY: a null pointer and a literal C string.
        unsafe {
            assert_eq!(text_of(std::ptr::null()), None);
            assert_eq!(text_of(c"reason".as_ptr()).as_deref(), Some("reason"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_message_names_the_package_and_the_reason() {
        let text = missing_engine_message("libwebkit2gtk-4.1.so.0: cannot open shared object file");
        assert!(text.contains("libwebkit2gtk-4.1-0"));
        assert!(text.contains("cannot open shared object file"));
        assert!(text.is_ascii());
    }

    #[test]
    fn the_shell_is_beside_the_launcher() {
        assert_eq!(
            shell_beside(Path::new("/opt/ReqSeq/ReqSeq")),
            PathBuf::from("/opt/ReqSeq/reqseq-shell")
        );
        assert!(
            no_shell_message(Path::new("/x/reqseq-shell"), "No such file")
                .contains("/x/reqseq-shell: No such file")
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_library_that_exists_loads_and_a_missing_one_gives_the_reason() {
        assert_eq!(engine::load("libc.so.6"), Ok(()));
        let reason = engine::load("libreqseq-not-there.so.0").unwrap_err();
        assert!(reason.contains("libreqseq-not-there.so.0"), "{reason}");
        assert!(engine::load("a\0b").unwrap_err().contains("NUL"));
    }
}

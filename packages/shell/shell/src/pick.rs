//! Choosing a folder, an existing file or the target of a file that is written, in the dialog of the operating
//! system (SR-253 AK1, ADR-0021, Capabilities). The page's inputs set only what the dialog shows first: the folder
//! and, for a target, the proposed file name. The answer is one absolute path, or none when the person cancels or
//! the dialog cannot open. The shell reads, writes and creates no file: what a chosen path may do is decided by the
//! command that gets it (SR-253 AK2, SR-248 AK4).
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

/// The longest folder the shell passes to the dialog, in bytes.
const MAX_FOLDER: usize = 4096;
/// The longest file name the shell proposes, in bytes.
const MAX_NAME: usize = 255;

/// What the person chooses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pick {
    /// A folder.
    Folder,
    /// An existing file.
    File,
    /// The target of a file that is written.
    Target,
}

impl Pick {
    /// The command of the pages that asks for this dialog.
    #[must_use]
    pub const fn command(self) -> &'static str {
        match self {
            Self::Folder => "pick_folder",
            Self::File => "pick_file",
            Self::Target => "pick_save_target",
        }
    }

    /// The title of the dialog.
    #[must_use]
    pub const fn title(self) -> &'static str {
        match self {
            Self::Folder => "Choose a folder",
            Self::File => "Choose a file",
            Self::Target => "Choose where to save",
        }
    }
}

/// What the dialog shows first.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Shown {
    /// The folder the dialog opens in.
    pub folder: Option<PathBuf>,
    /// The proposed file name, for a target only.
    pub name: Option<String>,
}

impl Shown {
    /// What the dialog shows first, from the page's inputs. A folder counts only when it is absolute and local: on
    /// Windows a drive letter with its root, no UNC or device path, since opening one could connect to another
    /// machine (SR-078). A name counts only for a target, and only as a plain file name. Anything else is left out,
    /// so the dialog opens where the operating system chooses.
    #[must_use]
    pub fn of(pick: Pick, folder: Option<&str>, name: Option<&str>, windows: bool) -> Self {
        Self {
            folder: folder.filter(|f| local_absolute(f, windows)).map(PathBuf::from),
            name: name
                .filter(|n| pick == Pick::Target && plain_name(n))
                .map(str::to_owned),
        }
    }
}

fn local_absolute(text: &str, windows: bool) -> bool {
    if text.len() > MAX_FOLDER || text.chars().any(char::is_control) {
        return false;
    }
    let bytes = text.as_bytes();
    if windows {
        bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && matches!(bytes[2], b'\\' | b'/')
    } else {
        bytes.first() == Some(&b'/')
    }
}

fn plain_name(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= MAX_NAME
        && text != "."
        && text != ".."
        && !text.contains(['/', '\\'])
        && !text.chars().any(char::is_control)
}

/// The dialog of the operating system.
pub trait Dialog {
    /// Shows the dialog for `pick`, opening as `shown` says, and waits for the person. `None` when the person
    /// cancels or the dialog cannot open.
    fn show(&self, pick: Pick, shown: &Shown) -> Option<PathBuf>;
}

/// The answer the page gets for what the dialog gave: one absolute path, else none. A path that is not valid UTF-8
/// cannot reach the page as text and gives none too.
#[must_use]
pub fn answer(chosen: Option<&Path>) -> Option<String> {
    chosen
        .filter(|p| p.is_absolute())
        .and_then(Path::to_str)
        .map(str::to_owned)
}

/// The dialogs of one shell, one at a time: a request while a dialog is open gets none.
#[derive(Debug, Default)]
pub struct Dialogs<D> {
    dialog: D,
    open: AtomicBool,
}

impl<D: Dialog> Dialogs<D> {
    pub fn new(dialog: D) -> Self {
        Self {
            dialog,
            open: AtomicBool::new(false),
        }
    }

    /// Shows the dialog for `pick` with the page's inputs `folder` and `name`, and answers the chosen path.
    #[must_use]
    pub fn choose(
        &self,
        pick: Pick,
        folder: Option<&str>,
        name: Option<&str>,
        windows: bool,
    ) -> Option<String> {
        if self.open.swap(true, Ordering::SeqCst) {
            return None;
        }
        let chosen = self.dialog.show(pick, &Shown::of(pick, folder, name, windows));
        self.open.store(false, Ordering::SeqCst);
        answer(chosen.as_deref())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    struct Fake {
        answer: Option<PathBuf>,
        shown: Mutex<Vec<(Pick, Shown)>>,
    }

    impl Dialog for Fake {
        fn show(&self, pick: Pick, shown: &Shown) -> Option<PathBuf> {
            self.shown.lock().unwrap().push((pick, shown.clone()));
            self.answer.clone()
        }
    }

    fn absolute(name: &str) -> PathBuf {
        std::env::temp_dir().join(name)
    }

    #[test]
    fn each_pick_has_its_command_and_title() {
        assert_eq!(
            [Pick::Folder, Pick::File, Pick::Target].map(Pick::command),
            ["pick_folder", "pick_file", "pick_save_target"]
        );
        assert_eq!(
            [Pick::Folder, Pick::File, Pick::Target].map(Pick::title),
            ["Choose a folder", "Choose a file", "Choose where to save"]
        );
    }

    #[test]
    fn the_folder_counts_only_when_absolute_and_local() {
        let folder = |text: &str, windows: bool| Shown::of(Pick::Folder, Some(text), None, windows).folder;
        assert_eq!(folder("/home/a", false), Some(PathBuf::from("/home/a")));
        assert_eq!(folder("C:\\Users\\a", true), Some(PathBuf::from("C:\\Users\\a")));
        assert_eq!(folder("d:/data", true), Some(PathBuf::from("d:/data")));
        for (text, windows) in [
            ("", false),
            ("home/a", false),
            ("~/a", false),
            ("C:\\a", false),
            ("/a\nb", false),
            ("/a\0b", false),
            ("", true),
            ("C:", true),
            ("C:a", true),
            ("\\a", true),
            ("/a", true),
            ("1:\\a", true),
            ("\\\\server\\share", true),
            ("//server/share", true),
            ("\\\\?\\C:\\a", true),
            ("\\\\.\\pipe\\x", true),
        ] {
            assert_eq!(folder(text, windows), None, "{text:?} on windows={windows}");
        }
        let long = format!("/{}", "a".repeat(MAX_FOLDER));
        assert_eq!(folder(&long, false), None);
        assert_eq!(Shown::of(Pick::File, None, None, false), Shown::default());
    }

    #[test]
    fn a_name_counts_only_for_a_target_and_only_as_a_plain_file_name() {
        let name = |pick: Pick, text: &str| Shown::of(pick, None, Some(text), false).name;
        assert_eq!(name(Pick::Target, "ws.reqif"), Some("ws.reqif".to_owned()));
        assert_eq!(
            name(Pick::Target, &"a".repeat(MAX_NAME)),
            Some("a".repeat(MAX_NAME))
        );
        assert_eq!(name(Pick::Folder, "ws.reqif"), None);
        assert_eq!(name(Pick::File, "ws.reqif"), None);
        for text in ["", ".", "..", "a/b", "a\\b", "/etc/passwd", "a\nb", "a\0b"] {
            assert_eq!(name(Pick::Target, text), None, "{text:?}");
        }
        assert_eq!(name(Pick::Target, &"a".repeat(MAX_NAME + 1)), None);
    }

    #[test]
    fn the_answer_is_one_absolute_path_or_none() {
        let chosen = absolute("chosen.reqif");
        assert_eq!(answer(Some(&chosen)), chosen.to_str().map(str::to_owned));
        assert_eq!(answer(Some(Path::new("relative/x"))), None);
        assert_eq!(answer(None), None);
        #[cfg(unix)]
        {
            use std::os::unix::ffi::OsStrExt as _;
            let bytes = std::ffi::OsStr::from_bytes(b"/tmp/\xff.reqif");
            assert_eq!(answer(Some(Path::new(bytes))), None);
        }
    }

    #[test]
    fn the_dialog_gets_what_it_shows_first_and_its_answer_reaches_the_page() {
        let chosen = absolute("out.reqif");
        let dialogs = Dialogs::new(Fake {
            answer: Some(chosen.clone()),
            ..Fake::default()
        });
        assert_eq!(
            dialogs.choose(Pick::Target, Some("/home/a"), Some("ws.reqif"), false),
            chosen.to_str().map(str::to_owned)
        );
        assert_eq!(
            dialogs.choose(Pick::Folder, Some("rel"), Some("x"), false),
            chosen.to_str().map(str::to_owned)
        );
        assert_eq!(
            *dialogs.dialog.shown.lock().unwrap(),
            [
                (
                    Pick::Target,
                    Shown {
                        folder: Some(PathBuf::from("/home/a")),
                        name: Some("ws.reqif".to_owned())
                    }
                ),
                (Pick::Folder, Shown::default())
            ]
        );
        let cancelled = Dialogs::new(Fake::default());
        assert_eq!(cancelled.choose(Pick::File, None, None, false), None);
    }

    #[test]
    fn a_request_while_a_dialog_is_open_gets_none_and_the_next_one_opens_again() {
        let dialogs = Dialogs::new(Fake {
            answer: Some(absolute("a")),
            ..Fake::default()
        });
        dialogs.open.store(true, Ordering::SeqCst);
        assert_eq!(dialogs.choose(Pick::File, None, None, false), None);
        assert!(dialogs.dialog.shown.lock().unwrap().is_empty());
        dialogs.open.store(false, Ordering::SeqCst);
        assert!(dialogs.choose(Pick::File, None, None, false).is_some());
        assert!(!dialogs.open.load(Ordering::SeqCst));
        assert_eq!(dialogs.dialog.shown.lock().unwrap().len(), 1);
    }
}

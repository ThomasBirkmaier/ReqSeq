//! What the shell starts (ADR-0021, Start steps 2 and 3; SR-252 AK1): the release's Node with the CLI entry and
//! `ui --no-open`, in the root of the file system, without `NODE_OPTIONS` and with `REQSEQ_UI_END_WITH_STDIN=1`.
use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// The file the CLI looks for from its current folder upwards (ADR-0009).
pub const WORKSPACE_FILE: &str = "reqseq-workspace.yaml";
/// Makes `reqseq ui` end when its standard input ends (ADR-0021, End).
pub const END_WITH_STDIN: (&str, &str) = ("REQSEQ_UI_END_WITH_STDIN", "1");
/// Removed, as the launcher of the release removes it (ADR-0020).
pub const REMOVED_VARIABLE: &str = "NODE_OPTIONS";

/// The Node binary and the CLI entry of one release.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Layout {
    pub node: PathBuf,
    pub cli: PathBuf,
}

impl Layout {
    /// The places of the release layout (ADR-0020, Release): `runtime/<node>` and `lib/dist/bin.js` below `root`.
    #[must_use]
    pub fn of_release(root: &Path, windows: bool) -> Self {
        Self {
            node: root
                .join("runtime")
                .join(if windows { "node.exe" } else { "node" }),
            cli: root.join("lib").join("dist").join("bin.js"),
        }
    }
}

/// The folder that holds `runtime/` and `lib/`: the folder of the shell's executable, or `Contents/Resources` of
/// the app bundle on macOS (the release layout, `scripts/package/stage.mjs`).
#[must_use]
pub fn release_root(exe: &Path, macos: bool) -> PathBuf {
    let folder = exe.parent().unwrap_or(exe);
    if macos {
        folder.parent().unwrap_or(folder).join("Resources")
    } else {
        folder.to_path_buf()
    }
}

/// The server process the shell starts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerSpec {
    pub program: PathBuf,
    pub args: Vec<OsString>,
    pub cwd: PathBuf,
    pub remove: &'static str,
    pub set: (&'static str, &'static str),
}

impl ServerSpec {
    /// `<node> <cli> ui --no-open` in `root`, with no `--workspace` and no `--port`.
    #[must_use]
    pub fn new(layout: &Layout, root: &Path) -> Self {
        Self {
            program: layout.node.clone(),
            args: vec![
                layout.cli.clone().into_os_string(),
                "ui".into(),
                "--no-open".into(),
            ],
            cwd: root.to_path_buf(),
            remove: REMOVED_VARIABLE,
            set: END_WITH_STDIN,
        }
    }

    /// The workspace file the CLI would find in the root, which is the only folder with no folder above it.
    #[must_use]
    pub fn workspace_file(&self) -> PathBuf {
        self.cwd.join(WORKSPACE_FILE)
    }
}

/// The root of the file system: `/`, or `%SystemDrive%\` on Windows (`C:` when the variable is unset or not a
/// drive).
#[must_use]
pub fn root_folder(windows: bool, system_drive: Option<&str>) -> PathBuf {
    if !windows {
        return PathBuf::from("/");
    }
    let drive = system_drive
        .filter(|d| d.len() == 2 && d.as_bytes()[0].is_ascii_alphabetic() && d.as_bytes()[1] == b':')
        .unwrap_or("C:");
    PathBuf::from(format!("{drive}\\"))
}

/// The command line of `CreateProcessW` for `program` and `args`, as UTF-16 with a closing NUL: the program in
/// quotes, each argument quoted where it needs it by the rules of `CommandLineToArgvW`, so the CLI gets each argument
/// as it is. No shell parses it.
#[must_use]
pub fn windows_command_line(program: &[u16], args: &[Vec<u16>]) -> Vec<u16> {
    const QUOTE: u16 = b'"' as u16;
    const BACKSLASH: u16 = b'\\' as u16;
    let mut out = vec![QUOTE];
    out.extend(program.iter().copied().filter(|&c| c != QUOTE));
    out.push(QUOTE);
    for arg in args {
        out.push(u16::from(b' '));
        let plain = !arg.is_empty()
            && !arg.iter().any(|&c| {
                [b' ', b'\t', b'\n', 0x0b, b'"']
                    .iter()
                    .any(|&s| c == u16::from(s))
            });
        if plain {
            out.extend(arg);
            continue;
        }
        out.push(QUOTE);
        let mut backslashes = 0;
        for &c in arg {
            if c == BACKSLASH {
                backslashes += 1;
                continue;
            }
            let escaped = if c == QUOTE {
                backslashes * 2 + 1
            } else {
                backslashes
            };
            out.extend(std::iter::repeat_n(BACKSLASH, escaped));
            out.push(c);
            backslashes = 0;
        }
        out.extend(std::iter::repeat_n(BACKSLASH, backslashes * 2));
        out.push(QUOTE);
    }
    out.push(0);
    out
}

/// The environment block of `CreateProcessW` (`CREATE_UNICODE_ENVIRONMENT`): `vars` without `remove` (names compared
/// without case, as Windows does) and with `set`, sorted by name without case, each `NAME=VALUE` closed by a NUL and
/// the block by one more.
#[must_use]
pub fn windows_environment(vars: Vec<(Vec<u16>, Vec<u16>)>, remove: &str, set: (&str, &str)) -> Vec<u16> {
    let upper = |name: &[u16]| String::from_utf16_lossy(name).to_uppercase();
    let removed = remove.to_uppercase();
    let added = set.0.to_uppercase();
    let mut kept: Vec<(Vec<u16>, Vec<u16>)> = vars
        .into_iter()
        .filter(|(name, _)| {
            let n = upper(name);
            n != removed && n != added
        })
        .collect();
    kept.push((set.0.encode_utf16().collect(), set.1.encode_utf16().collect()));
    kept.sort_by_cached_key(|(name, _)| upper(name));
    let mut block = Vec::new();
    for (name, value) in kept {
        block.extend(name);
        block.push(u16::from(b'='));
        block.extend(value);
        block.push(0);
    }
    block.push(0);
    block
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_server_is_node_with_the_cli_and_ui_no_open_in_the_root() {
        // Built with `join`, so that the expectations hold with the separators of the system the test runs on.
        let root = Path::new("/opt/ReqSeq");
        let layout = Layout::of_release(root, false);
        let spec = ServerSpec::new(&layout, Path::new("/"));
        assert_eq!(spec.program, root.join("runtime").join("node"));
        assert_eq!(
            spec.args,
            vec![
                root.join("lib").join("dist").join("bin.js").into_os_string(),
                "ui".into(),
                "--no-open".into()
            ]
        );
        assert!(!spec.args.iter().any(|a| a == "--workspace" || a == "--port"));
        assert_eq!(spec.cwd, PathBuf::from("/"));
        assert_eq!(spec.remove, "NODE_OPTIONS");
        assert_eq!(spec.set, ("REQSEQ_UI_END_WITH_STDIN", "1"));
        assert_eq!(
            spec.workspace_file(),
            Path::new("/").join("reqseq-workspace.yaml")
        );
        let windows = Layout::of_release(root, true);
        assert_eq!(windows.node, root.join("runtime").join("node.exe"));
    }

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().collect()
    }

    fn line(program: &str, args: &[&str]) -> String {
        let args: Vec<Vec<u16>> = args.iter().map(|a| wide(a)).collect();
        let out = windows_command_line(&wide(program), &args);
        assert_eq!(out.last(), Some(&0));
        String::from_utf16(&out[..out.len() - 1]).unwrap()
    }

    #[test]
    fn the_windows_command_line_quotes_as_command_line_to_argv_reads_it() {
        assert_eq!(
            line(
                r"C:\Program Files\ReqSeq\runtime\node.exe",
                &[r"C:\Program Files\ReqSeq\lib\dist\bin.js", "ui", "--no-open"]
            ),
            r#""C:\Program Files\ReqSeq\runtime\node.exe" "C:\Program Files\ReqSeq\lib\dist\bin.js" ui --no-open"#
        );
        assert_eq!(line("a\"b", &[""]), r#""ab" """#);
        assert_eq!(line("p", &[r"C:\x\"]), r#""p" C:\x\"#);
        assert_eq!(
            line("p", &[r"C:\dir with space\"]),
            r#""p" "C:\dir with space\\""#
        );
        assert_eq!(
            line("p", &[r#"say "hi""#, r#"a\"b"#, "tab\tthere"]),
            r#""p" "say \"hi\"" "a\\\"b" "tab	there""#
        );
    }

    #[test]
    fn the_windows_environment_drops_node_options_and_sets_the_end_variable() {
        let vars = vec![
            (wide("Path"), wide(r"C:\Windows")),
            (wide("node_options"), wide("--require x")),
            (wide("REQSEQ_UI_END_WITH_STDIN"), wide("0")),
            (wide("APPDATA"), wide(r"C:\Users\a")),
        ];
        let block = windows_environment(vars, "NODE_OPTIONS", ("REQSEQ_UI_END_WITH_STDIN", "1"));
        assert_eq!(&block[block.len() - 2..], [0, 0]);
        let text = String::from_utf16(&block[..block.len() - 1]).unwrap();
        assert_eq!(
            text,
            "APPDATA=C:\\Users\\a\0Path=C:\\Windows\0REQSEQ_UI_END_WITH_STDIN=1\0"
        );
    }

    #[test]
    fn the_release_root_is_the_folder_of_the_executable_or_the_bundle_resources() {
        assert_eq!(
            release_root(Path::new("/opt/ReqSeq/reqseq-shell"), false),
            PathBuf::from("/opt/ReqSeq")
        );
        assert_eq!(
            release_root(Path::new("/A/ReqSeq.app/Contents/MacOS/reqseq-shell"), true),
            PathBuf::from("/A/ReqSeq.app/Contents/Resources")
        );
        assert_eq!(release_root(Path::new("/"), true), PathBuf::from("/Resources"));
    }

    #[test]
    fn the_root_is_slash_or_the_system_drive() {
        assert_eq!(root_folder(false, Some("D:")), PathBuf::from("/"));
        assert_eq!(root_folder(true, Some("D:")), PathBuf::from("D:\\"));
        assert_eq!(root_folder(true, None), PathBuf::from("C:\\"));
        for odd in ["", "D", "DD", "1:", "D:\\x"] {
            assert_eq!(root_folder(true, Some(odd)), PathBuf::from("C:\\"), "{odd}");
        }
    }
}

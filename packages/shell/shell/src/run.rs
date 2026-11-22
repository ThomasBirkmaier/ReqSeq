//! The rules of the shell's life (ADR-0021, Start, End, Failures, Opening an address), as a state machine that a
//! `Host` drives with events and that acts only through the `Host`. The real host is Tauri with the operating
//! system's processes (`main.rs`); the unit tests use a fake one.
use crate::address::{self, Open, ServerAddress};
use crate::start::ServerSpec;
use crate::tail::Tail;
use std::path::Path;
use std::time::Duration;
use url::Url;

/// How long the shell waits for the address line (SR-252 AK5).
pub const ADDRESS_WAIT: Duration = Duration::from_secs(30);
/// How long the server has after its standard input closed, before it is killed (ADR-0021, End).
pub const KILL_WAIT: Duration = Duration::from_secs(3);
/// The exit code of every failure.
pub const FAILED: i32 = 1;

/// What the shell asks of its host.
pub trait Host {
    /// Whether `path` is a regular file, links followed (the CLI's `isFile`). Reads nothing.
    fn is_file(&self, path: &Path) -> bool;
    /// Starts the server; standard input, output and error are pipes.
    ///
    /// # Errors
    ///
    /// Why it could not start.
    fn start_server(&mut self, spec: &ServerSpec) -> Result<(), String>;
    /// Closes the shell's end of the server's standard input.
    fn close_server_input(&mut self);
    /// Kills the server, with every process it started where the system allows it.
    fn kill_server(&mut self);
    /// The token is known: the shell's own output replaces it from now on.
    fn token_known(&mut self, token: &str);
    /// Allows calls from the server's origin, loads the address in the window and shows the window.
    ///
    /// # Errors
    ///
    /// Why the page could not be shown.
    fn show(&mut self, address: &ServerAddress) -> Result<(), String>;
    /// Destroys the window, so nothing more is loaded.
    fn destroy_window(&mut self);
    /// Shows `reason` in a message box of the operating system and writes it to standard error.
    fn report(&mut self, reason: &str);
    /// Writes `text` to standard error only.
    fn write_error(&mut self, text: &str);
    /// Hands `url` to the opener of the operating system.
    ///
    /// # Errors
    ///
    /// Why no program could start.
    fn open_with_system(&mut self, url: &Url) -> Result<(), String>;
    /// Sends `Event::Timer(timer)` after `delay`.
    fn after(&mut self, delay: Duration, timer: Timer);
    /// Ends the shell with `code`.
    fn exit(&mut self, code: i32);
}

/// A timer the shell set.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Timer {
    /// The address line did not come in time.
    Address,
    /// The server did not end in time after its standard input closed.
    Kill,
}

/// What happens to the shell.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    /// The hidden window exists.
    WindowReady,
    /// The window could not be created.
    WindowFailed(String),
    /// A line of the server's standard output.
    Stdout(String),
    /// A chunk of the server's standard error.
    Stderr(Vec<u8>),
    /// The server ended (after its standard error ended), with its status as text.
    ServerExited(String),
    Timer(Timer),
    /// The window was closed, the app was quit, or SIGTERM, SIGINT or SIGHUP arrived.
    End,
}

#[derive(Debug)]
enum Phase {
    /// No window yet.
    Created,
    /// The server runs; no address yet.
    Waiting,
    Showing(ServerAddress),
    /// The server's input is closed; waiting for it to end.
    Ending,
    /// The shell has asked to exit.
    Done,
}

/// The state of one shell.
#[derive(Debug)]
pub struct Shell {
    spec: ServerSpec,
    phase: Phase,
    tail: Tail,
}

impl Shell {
    #[must_use]
    pub fn new(spec: ServerSpec) -> Self {
        Self {
            spec,
            phase: Phase::Created,
            tail: Tail::default(),
        }
    }

    /// Whether the shell has asked to exit.
    #[must_use]
    pub fn done(&self) -> bool {
        matches!(self.phase, Phase::Done)
    }

    /// Handles one event.
    pub fn on(&mut self, event: Event, host: &mut impl Host) {
        match (&self.phase, event) {
            (_, Event::Stderr(chunk)) => self.tail.push(&chunk),
            (Phase::Created, Event::WindowReady) => self.start(host),
            (Phase::Created, Event::WindowFailed(reason)) => {
                host.write_error(&format!("ReqSeq: the window could not open: {reason}\n"));
                self.exit(host, FAILED);
            }
            (Phase::Waiting, Event::Stdout(line)) => self.read_line(&line, host),
            (Phase::Waiting, Event::Timer(Timer::Address)) => {
                self.fail(host, "printed no loopback address within 30 s");
            }
            (Phase::Waiting, Event::ServerExited(status)) => {
                self.fail(host, &format!("could not start ({status})"));
            }
            (Phase::Showing(_), Event::ServerExited(status)) => {
                self.fail(host, &format!("ended ({status})"));
            }
            (Phase::Waiting | Phase::Showing(_), Event::End) => {
                self.phase = Phase::Ending;
                host.close_server_input();
                host.after(KILL_WAIT, Timer::Kill);
            }
            (Phase::Created, Event::End) | (Phase::Ending, Event::ServerExited(_)) => self.exit(host, 0),
            (Phase::Ending, Event::Timer(Timer::Kill)) => {
                host.kill_server();
                self.exit(host, 0);
            }
            // Late output, timers that no longer apply, a second end, and anything after the exit.
            _ => {}
        }
    }

    /// The page asks to open `input` (SR-252 AK3).
    ///
    /// # Errors
    ///
    /// The refusal, or why no program could start; the shell keeps running either way.
    pub fn open(&mut self, input: &str, host: &mut impl Host) -> Result<(), String> {
        let Phase::Showing(server) = &self.phase else {
            return Err("The shell is not showing its server.".to_owned());
        };
        match address::decide(input, server.port()) {
            Open::HandOn(url) => host
                .open_with_system(&url)
                .map_err(|reason| format!("No program could open the address: {reason}")),
            Open::Refused(reason) => Err(format!("Not opened: {reason}.")),
        }
    }

    fn start(&mut self, host: &mut impl Host) {
        let file = self.spec.workspace_file();
        if host.is_file(&file) {
            self.phase = Phase::Done;
            host.report(&format!(
                "ReqSeq cannot start its UI server: the root of the file system holds a workspace file, {}, and the \
                 server would open it. Move or rename that file.",
                file.display()
            ));
            host.exit(FAILED);
            return;
        }
        match host.start_server(&self.spec) {
            Ok(()) => {
                self.phase = Phase::Waiting;
                host.after(ADDRESS_WAIT, Timer::Address);
            }
            Err(reason) => self.fail(host, &format!("could not start: {reason}")),
        }
    }

    fn read_line(&mut self, line: &str, host: &mut impl Host) {
        match ServerAddress::from_line(line) {
            Ok(None) => {}
            Ok(Some(address)) => {
                host.token_known(address.token());
                match host.show(&address) {
                    Ok(()) => self.phase = Phase::Showing(address),
                    Err(reason) => self.fail(host, &format!("could not be shown: {reason}")),
                }
            }
            Err(reason) => self.fail(host, &reason),
        }
    }

    /// Kills the server, loads nothing more, reports the reason and exits (SR-252 AK5). The reason is the end of
    /// the server's standard error, else `fallback`.
    fn fail(&mut self, host: &mut impl Host, fallback: &str) {
        self.phase = Phase::Done;
        host.kill_server();
        host.destroy_window();
        let reason = match self.tail.text() {
            Some(tail) => format!("The ReqSeq UI server failed. Its last output:\n{tail}"),
            None => format!("The ReqSeq UI server {fallback}."),
        };
        host.report(&reason);
        host.exit(FAILED);
    }

    fn exit(&mut self, host: &mut impl Host, code: i32) {
        self.phase = Phase::Done;
        host.exit(code);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::start::Layout;
    use std::path::PathBuf;

    #[derive(Default)]
    struct Fake {
        files: Vec<PathBuf>,
        start: Option<String>,
        show: Option<String>,
        opener: Option<String>,
        log: Vec<String>,
    }

    impl Host for Fake {
        fn is_file(&self, path: &Path) -> bool {
            self.files.iter().any(|f| f == path)
        }
        fn start_server(&mut self, spec: &ServerSpec) -> Result<(), String> {
            self.log.push(format!("start {}", spec.program.display()));
            self.start.clone().map_or(Ok(()), Err)
        }
        fn close_server_input(&mut self) {
            self.log.push("close input".into());
        }
        fn kill_server(&mut self) {
            self.log.push("kill".into());
        }
        fn token_known(&mut self, token: &str) {
            self.log.push(format!("token {token}"));
        }
        fn show(&mut self, address: &ServerAddress) -> Result<(), String> {
            self.log.push(format!("show {}", address.origin()));
            self.show.clone().map_or(Ok(()), Err)
        }
        fn destroy_window(&mut self) {
            self.log.push("destroy".into());
        }
        fn report(&mut self, reason: &str) {
            self.log.push(format!("report {reason}"));
        }
        fn write_error(&mut self, text: &str) {
            self.log.push(format!("stderr {text}"));
        }
        fn open_with_system(&mut self, url: &Url) -> Result<(), String> {
            self.log.push(format!("open {url}"));
            self.opener.clone().map_or(Ok(()), Err)
        }
        fn after(&mut self, delay: Duration, timer: Timer) {
            self.log.push(format!("after {}s {timer:?}", delay.as_secs()));
        }
        fn exit(&mut self, code: i32) {
            self.log.push(format!("exit {code}"));
        }
    }

    const LINE: &str = "ReqSeq UI on http://127.0.0.1:43123/#token=TOK\n";

    fn shell() -> Shell {
        Shell::new(ServerSpec::new(
            &Layout::of_release(Path::new("/r"), false),
            Path::new("/"),
        ))
    }

    fn run(host: &mut Fake, events: Vec<Event>) -> Shell {
        let mut shell = shell();
        for event in events {
            shell.on(event, host);
        }
        shell
    }

    fn showing(host: &mut Fake) -> Shell {
        run(
            host,
            vec![
                Event::WindowReady,
                Event::Stdout("Loading\n".into()),
                Event::Stdout(LINE.into()),
            ],
        )
    }

    #[test]
    fn the_server_starts_after_the_window_and_its_address_is_shown_with_the_token_known_first() {
        let mut host = Fake::default();
        let shell = showing(&mut host);
        assert!(!shell.done());
        assert_eq!(
            host.log,
            [
                "start /r/runtime/node",
                "after 30s Address",
                "token TOK",
                "show http://127.0.0.1:43123"
            ]
        );
    }

    #[test]
    fn a_window_that_cannot_open_starts_no_server() {
        let mut host = Fake::default();
        let shell = run(
            &mut host,
            vec![Event::WindowFailed("no display".into()), Event::WindowReady],
        );
        assert!(shell.done());
        assert_eq!(
            host.log,
            ["stderr ReqSeq: the window could not open: no display\n", "exit 1"]
        );
    }

    #[test]
    fn a_workspace_file_at_the_root_starts_no_server_and_names_the_file() {
        let mut host = Fake {
            files: vec![PathBuf::from("/reqseq-workspace.yaml")],
            ..Fake::default()
        };
        let shell = run(&mut host, vec![Event::WindowReady]);
        assert!(shell.done());
        assert_eq!(host.log.len(), 2);
        assert!(host.log[0].starts_with("report ReqSeq cannot start"));
        assert!(host.log[0].contains("/reqseq-workspace.yaml"));
        assert_eq!(host.log[1], "exit 1");
    }

    #[test]
    fn a_server_that_cannot_start_is_reported_with_the_reason() {
        let mut host = Fake {
            start: Some("No such file or directory".into()),
            ..Fake::default()
        };
        run(&mut host, vec![Event::WindowReady]);
        assert_eq!(
            host.log,
            [
                "start /r/runtime/node",
                "kill",
                "destroy",
                "report The ReqSeq UI server could not start: No such file or directory.",
                "exit 1"
            ]
        );
    }

    #[test]
    fn a_server_that_ends_before_its_address_is_reported_with_its_standard_error() {
        let mut host = Fake::default();
        run(
            &mut host,
            vec![
                Event::WindowReady,
                Event::Stderr(b"Error: EACCES\n".to_vec()),
                Event::ServerExited("exit code 1".into()),
                Event::Stdout(LINE.into()),
            ],
        );
        assert_eq!(
            &host.log[2..],
            [
                "kill",
                "destroy",
                "report The ReqSeq UI server failed. Its last output:\nError: EACCES",
                "exit 1"
            ]
        );
    }

    #[test]
    fn without_standard_error_the_reason_says_what_happened() {
        let mut host = Fake::default();
        run(
            &mut host,
            vec![Event::WindowReady, Event::ServerExited("exit code 3".into())],
        );
        assert_eq!(
            host.log[4],
            "report The ReqSeq UI server could not start (exit code 3)."
        );
        let mut host = Fake::default();
        run(
            &mut host,
            vec![
                Event::WindowReady,
                Event::Timer(Timer::Address),
                Event::Timer(Timer::Address),
            ],
        );
        assert_eq!(
            host.log[4],
            "report The ReqSeq UI server printed no loopback address within 30 s."
        );
        assert_eq!(host.log.len(), 6);
    }

    #[test]
    fn an_address_line_with_another_address_fails_the_start() {
        let mut host = Fake::default();
        run(
            &mut host,
            vec![
                Event::WindowReady,
                Event::Stdout("ReqSeq UI on http://192.0.2.1:80/#token=T\n".into()),
            ],
        );
        assert!(
            host.log[4]
                .starts_with("report The ReqSeq UI server printed an address that is not a loopback address")
        );
        assert!(
            !host
                .log
                .iter()
                .any(|l| l.starts_with("show") || l.starts_with("token"))
        );
    }

    #[test]
    fn a_page_that_cannot_be_shown_fails_the_start() {
        let mut host = Fake {
            show: Some("no capability".into()),
            ..Fake::default()
        };
        let mut shell = run(&mut host, vec![Event::WindowReady, Event::Stdout(LINE.into())]);
        assert_eq!(
            &host.log[4..],
            [
                "kill",
                "destroy",
                "report The ReqSeq UI server could not be shown: no capability.",
                "exit 1"
            ]
        );
        assert!(shell.open("https://example.org/", &mut host).is_err());
    }

    #[test]
    fn a_server_that_ends_while_shown_is_reported_and_nothing_more_is_loaded() {
        let mut host = Fake::default();
        let mut shell = showing(&mut host);
        shell.on(Event::Stderr(b"Error: out of memory".to_vec()), &mut host);
        shell.on(Event::ServerExited("signal 9".into()), &mut host);
        assert_eq!(
            &host.log[4..],
            [
                "kill",
                "destroy",
                "report The ReqSeq UI server failed. Its last output:\nError: out of memory",
                "exit 1"
            ]
        );
        let mut host = Fake::default();
        let mut shell = showing(&mut host);
        shell.on(Event::ServerExited("exit code 0".into()), &mut host);
        assert_eq!(host.log[6], "report The ReqSeq UI server ended (exit code 0).");
    }

    #[test]
    fn the_end_closes_the_server_input_and_exits_with_0_once_the_server_ended() {
        let mut host = Fake::default();
        let mut shell = showing(&mut host);
        shell.on(Event::End, &mut host);
        shell.on(Event::End, &mut host);
        shell.on(Event::Timer(Timer::Address), &mut host);
        shell.on(Event::ServerExited("exit code 0".into()), &mut host);
        assert!(shell.done());
        assert_eq!(&host.log[4..], ["close input", "after 3s Kill", "exit 0"]);
    }

    #[test]
    fn a_server_that_does_not_end_is_killed_after_3_seconds() {
        let mut host = Fake::default();
        let mut shell = run(
            &mut host,
            vec![Event::WindowReady, Event::End, Event::Timer(Timer::Kill)],
        );
        assert_eq!(&host.log[2..], ["close input", "after 3s Kill", "kill", "exit 0"]);
        shell.on(Event::ServerExited("signal 9".into()), &mut host);
        assert_eq!(host.log.len(), 6);
    }

    #[test]
    fn an_end_before_the_window_exits_at_once() {
        let mut host = Fake::default();
        run(&mut host, vec![Event::End]);
        assert_eq!(host.log, ["exit 0"]);
    }

    #[test]
    fn the_page_opens_addresses_only_as_the_rule_says_and_learns_the_reason() {
        let mut host = Fake::default();
        let mut shell = shell();
        assert_eq!(
            shell.open("https://example.org/", &mut host),
            Err("The shell is not showing its server.".into())
        );
        let mut shell = showing(&mut host);
        assert_eq!(shell.open("HTTPS://Example.org/x", &mut host), Ok(()));
        assert_eq!(host.log.last().unwrap(), "open https://example.org/x");
        assert_eq!(
            shell.open("http://localhost:43123/", &mut host),
            Err("Not opened: an address of the shell's own server.".into())
        );
        assert_eq!(
            shell.open("", &mut host),
            Err("Not opened: not a full address.".into())
        );
        host.opener = Some("xdg-open: not found".into());
        assert_eq!(
            shell.open("mailto:a@example.org", &mut host),
            Err("No program could open the address: xdg-open: not found".into())
        );
        assert!(!shell.done());
    }
}

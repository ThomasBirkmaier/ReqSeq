//! The server's pipes (ADR-0021, Start step 4): its standard output line by line and its standard error in chunks
//! go to the shell as events, both are read until their end so the server never blocks on a full pipe, and its
//! exit is reported after both ended.
use crate::run::Event;
use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::thread;

/// Reads `stdout` and `stderr` on threads of their own and sends their events; then calls `wait` and sends
/// `Event::ServerExited` with what it returns.
pub fn watch<S>(stdout: File, stderr: File, wait: impl FnOnce() -> String + Send + 'static, send: S)
where
    S: Fn(Event) + Send + Clone + 'static,
{
    let lines = {
        let send = send.clone();
        thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut line = Vec::new();
            while reader.read_until(b'\n', &mut line).is_ok_and(|n| n > 0) {
                send(Event::Stdout(String::from_utf8_lossy(&line).into_owned()));
                line.clear();
            }
        })
    };
    let chunks = {
        let send = send.clone();
        thread::spawn(move || {
            let mut reader = stderr;
            let mut buffer = [0u8; 4096];
            while let Ok(n @ 1..) = reader.read(&mut buffer) {
                send(Event::Stderr(buffer[..n].to_vec()));
            }
        })
    };
    thread::spawn(move || {
        let _ = lines.join();
        let _ = chunks.join();
        send(Event::ServerExited(wait()));
    });
}

/// An exit status in words: `exit code 1`, or `signal 9` on Unix.
#[must_use]
pub fn describe(status: std::process::ExitStatus) -> String {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt as _;
        if let Some(signal) = status.signal() {
            return format!("signal {signal}");
        }
    }
    status
        .code()
        .map_or(status.to_string(), |code| format!("exit code {code}"))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::fd::OwnedFd;
    use std::process::{Command, Stdio};
    use std::sync::mpsc;

    #[test]
    fn output_lines_error_chunks_and_then_the_exit_arrive_as_events() {
        let mut child = Command::new("sh")
            .args(["-c", "printf 'one\\ntwo'; printf 'oops' >&2; exit 3"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let stdout = File::from(OwnedFd::from(child.stdout.take().unwrap()));
        let stderr = File::from(OwnedFd::from(child.stderr.take().unwrap()));
        let (tx, rx) = mpsc::channel();
        watch(
            stdout,
            stderr,
            move || describe(child.wait().unwrap()),
            move |e| tx.send(e).unwrap(),
        );
        let events: Vec<Event> = rx
            .iter()
            .take_while(|e| !matches!(e, Event::ServerExited(_)))
            .collect();
        assert!(events.contains(&Event::Stdout("one\n".into())));
        assert!(events.contains(&Event::Stdout("two".into())));
        let errors: Vec<u8> = events
            .iter()
            .filter_map(|e| {
                if let Event::Stderr(b) = e {
                    Some(b.clone())
                } else {
                    None
                }
            })
            .flatten()
            .collect();
        assert_eq!(errors, b"oops");
    }

    #[test]
    fn statuses_are_described() {
        let code = Command::new("sh").args(["-c", "exit 3"]).status().unwrap();
        assert_eq!(describe(code), "exit code 3");
        let signal = Command::new("sh").args(["-c", "kill -9 $$"]).status().unwrap();
        assert_eq!(describe(signal), "signal 9");
    }
}

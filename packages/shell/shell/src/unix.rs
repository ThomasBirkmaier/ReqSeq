//! The Unix side of the shell (ADR-0021): the server in its own process group with three pipes, its kill, the
//! filter of the shell's own standard output and error, the end signals, and the opener of the system.
use crate::redact::{self, TokenSlot};
use crate::start::ServerSpec;
use std::fs::File;
use std::io::{self, BufReader, Write as _};
use std::os::fd::{AsRawFd, FromRawFd as _, OwnedFd, RawFd};
use std::os::unix::process::CommandExt as _;
use std::path::Path;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

/// Starts the server of `spec`: its own process group, so a Ctrl-C in the shell's terminal reaches only the shell;
/// standard input, output and error are pipes, which Rust opens close-on-exec, so no other program inherits them.
///
/// # Errors
///
/// Why the program could not start.
pub fn spawn(spec: &ServerSpec) -> io::Result<Child> {
    Command::new(&spec.program)
        .args(&spec.args)
        .current_dir(&spec.cwd)
        .env_remove(spec.remove)
        .env(spec.set.0, spec.set.1)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .spawn()
}

/// SIGKILL to the process group of the server `pid`, which it leads, so the processes it started end too.
fn kill_group(pid: u32) {
    if let Ok(pid) = libc::pid_t::try_from(pid) {
        // SAFETY: `killpg` takes plain integers and touches no memory of this process.
        unsafe {
            libc::killpg(pid, libc::SIGKILL);
        }
    }
}

/// The server's process group. It is killed only while its leader is not reaped: until then the leader, alive or a
/// zombie, holds its ID, so the ID cannot belong to another group.
#[derive(Clone)]
pub struct Group {
    pid: u32,
    reaped: Arc<Mutex<bool>>,
}

impl Group {
    #[must_use]
    pub fn of(child: &Child) -> Self {
        Self {
            pid: child.id(),
            reaped: Arc::default(),
        }
    }

    /// SIGKILL to the group, unless its leader is reaped.
    pub fn kill(&self) {
        let reaped = self.reaped.lock().unwrap_or_else(PoisonError::into_inner);
        if !*reaped {
            kill_group(self.pid);
        }
    }

    /// Waits until the leader `child` has ended, without reaping it, and then reaps it while no kill can run.
    ///
    /// # Errors
    ///
    /// Why the wait failed.
    pub fn wait(&self, child: &mut Child) -> io::Result<ExitStatus> {
        // An error (none is expected) leaves the plain wait below, which still holds the lock.
        let _ = wait_exited(self.pid);
        let mut reaped = self.reaped.lock().unwrap_or_else(PoisonError::into_inner);
        let status = child.wait();
        *reaped = true;
        status
    }
}

/// Blocks until the child `pid` has ended, and leaves it unreaped (`WNOWAIT`).
fn wait_exited(pid: u32) -> io::Result<()> {
    // SAFETY: `siginfo_t` is plain data, for which all zero bytes are a valid value.
    let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
    // SAFETY: `info` is a valid, writable `siginfo_t` for the duration of the call.
    let result = unsafe { libc::waitid(libc::P_PID, pid, &raw mut info, libc::WEXITED | libc::WNOWAIT) };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

/// A duplicate of `fd` that is close-on-exec, so no started program inherits it.
///
/// # Errors
///
/// The error of `fcntl`.
pub fn duplicate(fd: RawFd) -> io::Result<File> {
    // SAFETY: `fcntl` with `F_DUPFD_CLOEXEC` reads no memory; the new descriptor is owned by the `File` below only.
    let copy = unsafe { libc::fcntl(fd, libc::F_DUPFD_CLOEXEC, 0) };
    if copy < 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: `copy` is a fresh descriptor that nothing else owns.
    Ok(unsafe { File::from_raw_fd(copy) })
}

/// Makes `target` a copy of `source` (`dup2`).
fn replace(target: RawFd, source: RawFd) -> io::Result<()> {
    // SAFETY: `dup2` takes plain descriptors; `target` stays owned by whoever owned it before.
    if unsafe { libc::dup2(source, target) } < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

/// The shell's standard output and error replaced by pipes, whose lines a thread each copies to the original
/// descriptors with the token replaced (ADR-0021, Start step 6). Every process started later inherits the pipes.
pub struct Filter {
    targets: Vec<RawFd>,
    threads: Vec<JoinHandle<()>>,
}

impl Filter {
    /// Replaces each descriptor of `targets` by the write end of a new pipe. A descriptor that is not open, or
    /// for which no pipe can be made, stays as it is.
    #[must_use]
    pub fn install(targets: &[RawFd], token: &TokenSlot) -> Self {
        let mut filter = Self {
            targets: Vec::new(),
            threads: Vec::new(),
        };
        for &target in targets {
            if let (Ok(original), Ok((read, write))) = (duplicate(target), pipe()) {
                // `target` is open and `write` is new, so `dup2` has nothing to fail on.
                let _ = replace(target, write.as_raw_fd());
                drop(write);
                let token = token.clone();
                filter.threads.push(thread::spawn(move || {
                    let mut original = original;
                    let _ = redact::copy_lines(&mut BufReader::new(File::from(read)), &mut original, &token);
                }));
                filter.targets.push(target);
            }
        }
        filter
    }

    /// The descriptors that were replaced.
    #[must_use]
    pub fn targets(&self) -> &[RawFd] {
        &self.targets
    }

    /// Closes the shell's write ends (each target becomes `/dev/null`) and waits up to `wait` for the threads to
    /// copy what is left. Engine processes that still hold the pipes do not hold up the exit longer.
    pub fn finish(self, wait: Duration) {
        // Without /dev/null the replacement fails and the descriptors stay as they are.
        let null = File::options().write(true).open("/dev/null");
        let null_fd = null.as_ref().map_or(-1, AsRawFd::as_raw_fd);
        for &target in &self.targets {
            let _ = replace(target, null_fd);
        }
        let deadline = Instant::now() + wait;
        for thread in self.threads {
            while !thread.is_finished() && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(5));
            }
        }
    }
}

/// A pipe whose ends are close-on-exec, as `std::io::pipe` opens them.
fn pipe() -> io::Result<(OwnedFd, OwnedFd)> {
    io::pipe().map(|(read, write)| (OwnedFd::from(read), OwnedFd::from(write)))
}

/// SIGTERM, SIGINT and SIGHUP, which end the shell normally.
const END_SIGNALS: [libc::c_int; 3] = [libc::SIGTERM, libc::SIGINT, libc::SIGHUP];

fn end_signals() -> libc::sigset_t {
    // SAFETY: `sigemptyset` and `sigaddset` write only into `set`, which lives on this stack.
    unsafe {
        let mut set: libc::sigset_t = std::mem::zeroed();
        libc::sigemptyset(&raw mut set);
        for signal in END_SIGNALS {
            libc::sigaddset(&raw mut set, signal);
        }
        set
    }
}

/// Blocks the end signals in the calling thread and in every thread it starts later, so that only
/// `wait_end_signal` receives them. Call it before any other thread starts.
pub fn block_end_signals() {
    let set = end_signals();
    // SAFETY: `set` is a valid signal set; the old mask is not asked for.
    unsafe {
        libc::pthread_sigmask(libc::SIG_BLOCK, &raw const set, std::ptr::null_mut());
    }
}

/// Waits for one of the end signals, which must be blocked, and returns it.
#[must_use]
pub fn wait_end_signal() -> libc::c_int {
    let set = end_signals();
    let mut signal = 0;
    // SAFETY: `set` and `signal` are valid for the call; `sigwait` writes only `signal`.
    unsafe {
        libc::sigwait(&raw const set, &raw mut signal);
    }
    signal
}

/// Starts `program` with `url` as its one argument and no input, and reaps it on a thread.
///
/// # Errors
///
/// Why the program could not start.
pub fn open_with(program: &Path, url: &str) -> Result<(), String> {
    let mut child = Command::new(program)
        .arg(url)
        .stdin(Stdio::null())
        .spawn()
        .map_err(|error| format!("{}: {error}", program.display()))?;
    thread::spawn(move || child.wait());
    Ok(())
}

/// Writes `text` to `out`, ignoring a failure: nobody may read it any more.
pub fn write_quietly(mut out: &File, text: &str) {
    let _ = out.write_all(text.as_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read as _;
    use std::sync::Arc;

    #[test]
    fn the_server_runs_in_its_own_group_in_the_root_without_node_options_and_with_the_end_variable() {
        let spec = ServerSpec {
            program: "sh".into(),
            args: vec![
                "-c".into(),
                "echo \"$(ps -o pgid= $$) $$ $(pwd) ${NODE_OPTIONS-unset} $REQSEQ_UI_END_WITH_STDIN\"; cat"
                    .into(),
            ],
            cwd: "/".into(),
            remove: "NODE_OPTIONS",
            set: ("REQSEQ_UI_END_WITH_STDIN", "1"),
        };
        let mut child = spawn(&spec).unwrap();
        drop(child.stdin.take());
        let mut out = String::new();
        child.stdout.take().unwrap().read_to_string(&mut out).unwrap();
        let parts: Vec<&str> = out.split_whitespace().collect();
        assert_eq!(parts[0], parts[1], "{out}");
        assert_eq!(&parts[2..], ["/", "unset", "1"]);
        assert!(child.wait().unwrap().success());
        assert!(
            spawn(&ServerSpec {
                program: "/no/such/program".into(),
                ..spec
            })
            .is_err()
        );
    }

    #[test]
    fn the_group_is_killed_only_until_its_leader_is_reaped() {
        let spec = ServerSpec {
            program: "sh".into(),
            args: vec!["-c".into(), "read line; exit 3".into()],
            cwd: "/".into(),
            remove: "NODE_OPTIONS",
            set: ("X", "1"),
        };
        let mut child = spawn(&spec).unwrap();
        let group = Group::of(&child);
        drop(child.stdin.take());
        // Ended but not reaped: the reaping wait below still gets its status.
        wait_exited(child.id()).unwrap();
        assert_eq!(
            crate::server::describe(group.clone().wait(&mut child).unwrap()),
            "exit code 3"
        );
        assert!(*group.reaped.lock().unwrap());
        // No signal goes to the ID once it is free.
        group.kill();
        assert!(wait_exited(child.id()).is_err());
        // A group whose leader runs is killed.
        let mut child = spawn(&ServerSpec {
            args: vec!["-c".into(), "sleep 30".into()],
            ..spec
        })
        .unwrap();
        let group = Group::of(&child);
        group.kill();
        assert_eq!(
            crate::server::describe(group.wait(&mut child).unwrap()),
            "signal 9"
        );
    }

    #[test]
    fn the_kill_ends_the_whole_group() {
        let spec = ServerSpec {
            program: "sh".into(),
            args: vec!["-c".into(), "sleep 30 & echo $!; wait".into()],
            cwd: "/".into(),
            remove: "NODE_OPTIONS",
            set: ("X", "1"),
        };
        let mut child = spawn(&spec).unwrap();
        let mut line = String::new();
        io::BufRead::read_line(&mut BufReader::new(child.stdout.take().unwrap()), &mut line).unwrap();
        let grandchild: libc::pid_t = line.trim().parse().unwrap();
        kill_group(child.id());
        assert_eq!(crate::server::describe(child.wait().unwrap()), "signal 9");
        let deadline = Instant::now() + Duration::from_secs(5);
        // SAFETY: probing with signal 0 sends nothing.
        while unsafe { libc::kill(grandchild, 0) } == 0 && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        // SAFETY: as above.
        assert_ne!(unsafe { libc::kill(grandchild, 0) }, 0);
        kill_group(u32::MAX);
    }

    #[test]
    fn a_duplicate_is_close_on_exec_and_a_bad_descriptor_fails() {
        let file = duplicate(1).unwrap();
        // SAFETY: reading the flags of an open descriptor.
        let flags = unsafe { libc::fcntl(file.as_raw_fd(), libc::F_GETFD) };
        assert_eq!(flags & libc::FD_CLOEXEC, libc::FD_CLOEXEC);
        assert!(duplicate(-1).is_err());
        assert!(replace(-1, 1).is_err());
    }

    #[test]
    fn the_filter_copies_lines_with_the_token_replaced_also_from_started_programs() {
        let (read, write) = pipe().unwrap();
        let target = write.as_raw_fd();
        let token: TokenSlot = Arc::default();
        let filter = Filter::install(&[target], &token);
        token.set(b"SECRET".to_vec()).unwrap();
        // SAFETY: `target` stays open while this borrowed `File` writes to it; `into_raw_fd` gives it back unclosed.
        let mut out = unsafe { File::from_raw_fd(target) };
        out.write_all(b"own SECRET line\n").unwrap();
        let _ = std::os::fd::IntoRawFd::into_raw_fd(out);
        let status = Command::new("sh")
            .args(["-c", "echo child SECRET"])
            .stdout(duplicate(target).unwrap())
            .status()
            .unwrap();
        assert!(status.success());
        filter.finish(Duration::from_secs(5));
        drop(write);
        let mut copied = String::new();
        File::from(read).read_to_string(&mut copied).unwrap();
        assert_eq!(copied, "own <token> line\nchild <token>\n");
        assert!(Filter::install(&[-1], &token).targets().is_empty());
    }

    #[test]
    fn finish_does_not_wait_for_a_writer_that_holds_the_pipe() {
        let (_read, write) = pipe().unwrap();
        let token: TokenSlot = Arc::default();
        let filter = Filter::install(&[write.as_raw_fd()], &token);
        assert_eq!(filter.targets(), [write.as_raw_fd()]);
        let held = duplicate(write.as_raw_fd()).unwrap();
        let started = Instant::now();
        filter.finish(Duration::from_millis(50));
        assert!(started.elapsed() < Duration::from_secs(2));
        drop(held);
    }

    #[test]
    fn a_blocked_end_signal_is_received_by_the_waiter() {
        block_end_signals();
        // SAFETY: the signal goes to this thread, which blocks it, so it stays pending until `sigwait`.
        unsafe {
            libc::pthread_kill(libc::pthread_self(), libc::SIGHUP);
        }
        assert_eq!(wait_end_signal(), libc::SIGHUP);
    }

    #[test]
    fn the_opener_gets_the_address_as_its_one_argument() {
        let dir = std::env::temp_dir().join(format!("reqseq-shell-open-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let record = dir.join("args");
        let program = dir.join("opener");
        std::fs::write(
            &program,
            format!("#!/bin/sh\nprintf '%s|' \"$#\" \"$@\" > '{}'\n", record.display()),
        )
        .unwrap();
        std::fs::set_permissions(&program, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
        open_with(&program, "https://example.org/a b").unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while !record.exists() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        thread::sleep(Duration::from_millis(50));
        assert_eq!(
            std::fs::read_to_string(&record).unwrap(),
            "1|https://example.org/a b|"
        );
        let error = open_with(&dir.join("missing"), "https://example.org/").unwrap_err();
        assert!(error.contains("missing"), "{error}");
        let file = File::options().write(true).open("/dev/null").unwrap();
        write_quietly(&file, "x");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

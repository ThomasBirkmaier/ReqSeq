//! The Windows side of the shell (ADR-0021): the server started directly with `CreateProcessW` inside a Job Object
//! that kills it and every process it started when the shell's handle closes, with only its three pipes inherited
//! and no console window; the filter of the shell's own standard output and error; and the opener of the system.
use crate::redact::{self, TokenSlot};
use crate::start::{ServerSpec, windows_command_line, windows_environment};
use std::ffi::OsStr;
use std::fs::File;
use std::io::{self, BufReader};
use std::os::windows::ffi::OsStrExt as _;
use std::os::windows::io::{AsRawHandle as _, FromRawHandle as _, OwnedHandle};
use std::ptr::{null, null_mut};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::{
    DUPLICATE_SAME_ACCESS, DuplicateHandle, HANDLE, HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE,
    SetHandleInformation,
};
use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;
use windows_sys::Win32::System::Console::{
    GetStdHandle, STD_ERROR_HANDLE, STD_HANDLE, STD_OUTPUT_HANDLE, SetStdHandle,
};
use windows_sys::Win32::System::JobObjects::{
    CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JobObjectExtendedLimitInformation, SetInformationJobObject, TerminateJobObject,
};
use windows_sys::Win32::System::Pipes::CreatePipe;
use windows_sys::Win32::System::Threading::{
    CREATE_NO_WINDOW, CREATE_UNICODE_ENVIRONMENT, CreateProcessW, DeleteProcThreadAttributeList,
    EXTENDED_STARTUPINFO_PRESENT, GetCurrentProcess, GetExitCodeProcess, INFINITE,
    InitializeProcThreadAttributeList, LPPROC_THREAD_ATTRIBUTE_LIST, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
    PROC_THREAD_ATTRIBUTE_JOB_LIST, PROCESS_INFORMATION, STARTF_USESTDHANDLES, STARTUPINFOEXW,
    UpdateProcThreadAttribute, WaitForSingleObject,
};
use windows_sys::Win32::UI::Shell::ShellExecuteW;
use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

fn wide(text: &OsStr) -> Vec<u16> {
    text.encode_wide().collect()
}

fn wide_nul(text: &OsStr) -> Vec<u16> {
    text.encode_wide().chain(Some(0)).collect()
}

fn check(ok: i32) -> io::Result<()> {
    if ok == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

/// A Job Object that kills its processes when its last handle closes; only the shell holds that handle.
pub struct Job(OwnedHandle);

impl Job {
    fn new() -> io::Result<Self> {
        // SAFETY: no attributes and no name; the handle is owned by the `OwnedHandle` at once.
        let handle = unsafe { CreateJobObjectW(null(), null()) };
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: `handle` is a fresh, valid handle that nothing else owns.
        let job = Self(unsafe { OwnedHandle::from_raw_handle(handle) });
        // SAFETY: an all-zero JOBOBJECT_EXTENDED_LIMIT_INFORMATION is valid; only the limit flags are set.
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        // SAFETY: the pointer and size describe `limits`, which lives across the call.
        check(unsafe {
            SetInformationJobObject(
                job.0.as_raw_handle(),
                JobObjectExtendedLimitInformation,
                (&raw const limits).cast(),
                u32::try_from(size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>()).unwrap_or(u32::MAX),
            )
        })?;
        Ok(job)
    }

    /// Ends every process of the job.
    pub fn terminate(&self) {
        // SAFETY: the job handle is valid while `self` lives.
        unsafe {
            TerminateJobObject(self.0.as_raw_handle(), 1);
        }
    }
}

/// The started server: its process, its job, and the shell's ends of its pipes.
pub struct Server {
    pub process: OwnedHandle,
    pub job: Job,
    pub stdin: File,
    pub stdout: File,
    pub stderr: File,
}

/// A pipe whose `child` end is inheritable and whose other end is not.
fn pipe(child_reads: bool) -> io::Result<(OwnedHandle, OwnedHandle)> {
    let attributes = SECURITY_ATTRIBUTES {
        nLength: u32::try_from(size_of::<SECURITY_ATTRIBUTES>()).unwrap_or(u32::MAX),
        lpSecurityDescriptor: null_mut(),
        bInheritHandle: 1,
    };
    let mut read: HANDLE = null_mut();
    let mut write: HANDLE = null_mut();
    // SAFETY: both out pointers are valid; the handles are owned right after.
    check(unsafe { CreatePipe(&raw mut read, &raw mut write, &raw const attributes, 0) })?;
    // SAFETY: fresh handles that nothing else owns.
    let (read, write) = unsafe {
        (
            OwnedHandle::from_raw_handle(read),
            OwnedHandle::from_raw_handle(write),
        )
    };
    let (child, mine) = if child_reads { (read, write) } else { (write, read) };
    // SAFETY: `mine` is a valid handle; only its inherit flag is cleared.
    check(unsafe { SetHandleInformation(mine.as_raw_handle(), HANDLE_FLAG_INHERIT, 0) })?;
    Ok((child, mine))
}

/// Starts the server of `spec` (ADR-0021, Start step 2 and End).
///
/// # Errors
///
/// Why it could not start.
pub fn spawn(spec: &ServerSpec) -> io::Result<Server> {
    let (child_in, stdin) = pipe(true)?;
    let (child_out, stdout) = pipe(false)?;
    let (child_err, stderr) = pipe(false)?;
    let job = Job::new()?;

    let mut size = 0usize;
    // SAFETY: the first call only asks for the size of a list of two attributes; it fails by design.
    unsafe {
        InitializeProcThreadAttributeList(null_mut(), 2, 0, &raw mut size);
    }
    let mut list_memory = vec![0u8; size];
    let list: LPPROC_THREAD_ATTRIBUTE_LIST = list_memory.as_mut_ptr().cast();
    // SAFETY: `list` points to `size` bytes, as asked for above.
    check(unsafe { InitializeProcThreadAttributeList(list, 2, 0, &raw mut size) })?;
    let inherited: [HANDLE; 3] = [
        child_in.as_raw_handle(),
        child_out.as_raw_handle(),
        child_err.as_raw_handle(),
    ];
    let jobs: [HANDLE; 1] = [job.0.as_raw_handle()];
    // SAFETY: `inherited` and `jobs` live until the list is deleted below, after `CreateProcessW`.
    let updated = unsafe {
        check(UpdateProcThreadAttribute(
            list,
            0,
            PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
            inherited.as_ptr().cast(),
            size_of_val(&inherited),
            null_mut(),
            null(),
        ))
        .and_then(|()| {
            check(UpdateProcThreadAttribute(
                list,
                0,
                PROC_THREAD_ATTRIBUTE_JOB_LIST as usize,
                jobs.as_ptr().cast(),
                size_of_val(&jobs),
                null_mut(),
                null(),
            ))
        })
    };

    let result = updated.and_then(|()| {
        // SAFETY: an all-zero STARTUPINFOEXW is valid; the fields used are set below.
        let mut startup: STARTUPINFOEXW = unsafe { std::mem::zeroed() };
        startup.StartupInfo.cb = u32::try_from(size_of::<STARTUPINFOEXW>()).unwrap_or(u32::MAX);
        startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        startup.StartupInfo.hStdInput = inherited[0];
        startup.StartupInfo.hStdOutput = inherited[1];
        startup.StartupInfo.hStdError = inherited[2];
        startup.lpAttributeList = list;
        let application = wide_nul(spec.program.as_os_str());
        let args: Vec<Vec<u16>> = spec.args.iter().map(|a| wide(a)).collect();
        let mut command_line = windows_command_line(&wide(spec.program.as_os_str()), &args);
        let vars = std::env::vars_os().map(|(k, v)| (wide(&k), wide(&v))).collect();
        let environment = windows_environment(vars, spec.remove, spec.set);
        let folder = wide_nul(spec.cwd.as_os_str());
        // SAFETY: an all-zero PROCESS_INFORMATION is valid as an out value.
        let mut info: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };
        // SAFETY: every pointer refers to a NUL-terminated buffer or structure that lives across the call; the
        // command line is mutable, as `CreateProcessW` requires; handles are inherited only as the list says.
        check(unsafe {
            CreateProcessW(
                application.as_ptr(),
                command_line.as_mut_ptr(),
                null(),
                null(),
                1,
                CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT,
                environment.as_ptr().cast(),
                folder.as_ptr(),
                &raw const startup.StartupInfo,
                &raw mut info,
            )
        })?;
        // SAFETY: both handles are fresh; the thread handle is closed at once, the process handle owned.
        unsafe {
            drop(OwnedHandle::from_raw_handle(info.hThread));
            Ok(OwnedHandle::from_raw_handle(info.hProcess))
        }
    });
    // SAFETY: `list` was initialized above and is not used after this.
    unsafe {
        DeleteProcThreadAttributeList(list);
    }
    let process = result?;
    drop((child_in, child_out, child_err));
    Ok(Server {
        process,
        job,
        stdin: File::from(stdin),
        stdout: File::from(stdout),
        stderr: File::from(stderr),
    })
}

/// Waits for `process` to end and gives its exit code in words.
#[must_use]
pub fn wait(process: &OwnedHandle) -> String {
    let mut code = 0u32;
    // SAFETY: the process handle is valid while `process` lives; `code` is a valid out pointer.
    let ok = unsafe {
        WaitForSingleObject(process.as_raw_handle(), INFINITE);
        GetExitCodeProcess(process.as_raw_handle(), &raw mut code)
    };
    if ok == 0 {
        "an unknown status".to_owned()
    } else {
        format!("exit code {code}")
    }
}

/// A duplicate of the shell's standard error that no started program inherits.
///
/// # Errors
///
/// There is no standard error, or it cannot be duplicated.
pub fn duplicate_stderr() -> io::Result<File> {
    duplicate(STD_ERROR_HANDLE)
}

fn duplicate(which: STD_HANDLE) -> io::Result<File> {
    // SAFETY: `GetStdHandle` reads a process-wide value.
    let handle = unsafe { GetStdHandle(which) };
    if handle.is_null() || handle == INVALID_HANDLE_VALUE {
        return Err(io::Error::other("no such standard handle"));
    }
    let mut copy: HANDLE = null_mut();
    // SAFETY: the source handle is valid; the copy is not inheritable and owned by the `File` below.
    check(unsafe {
        DuplicateHandle(
            GetCurrentProcess(),
            handle,
            GetCurrentProcess(),
            &raw mut copy,
            0,
            0,
            DUPLICATE_SAME_ACCESS,
        )
    })?;
    // SAFETY: `copy` is a fresh handle that nothing else owns.
    Ok(unsafe { File::from_raw_handle(copy) })
}

/// The shell's standard output and error replaced by pipes, whose lines a thread each copies to the original handles
/// with the token replaced (ADR-0021, Start step 6). A standard handle the starter did not give is left alone.
pub struct Filter {
    replaced: Vec<STD_HANDLE>,
    ends: Vec<OwnedHandle>,
    threads: Vec<JoinHandle<()>>,
}

impl Filter {
    /// Replaces standard output and error.
    ///
    /// # Errors
    ///
    /// A pipe or a replacement failed.
    pub fn install(token: &TokenSlot) -> io::Result<Self> {
        let mut filter = Self {
            replaced: Vec::new(),
            ends: Vec::new(),
            threads: Vec::new(),
        };
        for which in [STD_OUTPUT_HANDLE, STD_ERROR_HANDLE] {
            let Ok(original) = duplicate(which) else {
                continue;
            };
            // The write end is inheritable, so programs started later inherit the pipe (A1).
            let (write, read) = pipe(false)?;
            // SAFETY: `write` stays open while it is the standard handle; `finish` resets the standard handle first.
            check(unsafe { SetStdHandle(which, write.as_raw_handle()) })?;
            let token = token.clone();
            filter.threads.push(thread::spawn(move || {
                let mut original = original;
                let _ = redact::copy_lines(&mut BufReader::new(File::from(read)), &mut original, &token);
            }));
            filter.replaced.push(which);
            filter.ends.push(write);
        }
        Ok(filter)
    }

    /// Closes the shell's write ends and waits up to `wait` for the threads to copy what is left.
    pub fn finish(self, wait: Duration) {
        for which in self.replaced {
            // SAFETY: a null standard handle is allowed; the old one is closed below.
            unsafe {
                SetStdHandle(which, null_mut());
            }
        }
        drop(self.ends);
        let deadline = Instant::now() + wait;
        for thread in self.threads {
            while !thread.is_finished() && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(5));
            }
        }
    }
}

/// Hands `url` to the program Windows names for it (`ShellExecuteW` with `open`); the shell starts no program itself.
///
/// # Errors
///
/// The code `ShellExecuteW` returned when it failed.
pub fn open(url: &str) -> Result<(), String> {
    let operation = wide_nul(OsStr::new("open"));
    let file = wide_nul(OsStr::new(url));
    // SAFETY: both strings are NUL-terminated and live across the call; no window, parameters or folder.
    let result = unsafe {
        ShellExecuteW(
            null_mut(),
            operation.as_ptr(),
            file.as_ptr(),
            null(),
            null(),
            SW_SHOWNORMAL,
        )
    };
    let code = result as isize;
    if code > 32 {
        Ok(())
    } else {
        Err(format!("ShellExecuteW failed with {code}"))
    }
}

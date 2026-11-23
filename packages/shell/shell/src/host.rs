//! The real host (ADR-0021): Tauri's window and run loop, the server process, the end signals, the opener and the
//! dialogs of the operating system. A controller thread owns the shell's rules and handles every event in order; a
//! dialog waits for the person on a thread of Tauri's async runtime, so the events go on meanwhile.
use crate::{Input, engine, frame, server_started, write_error};
use shell::address::ServerAddress;
use shell::pick::{Dialog, Dialogs, Pick, Shown};
use shell::redact::TokenSlot;
use shell::run::{ADDRESS_WAIT, Event, Host, Shell, Timer};
use shell::start::{Layout, ServerSpec, release_root, root_folder};
use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError, mpsc};
use std::thread;
use std::time::Duration;
use tauri::ipc::CapabilityBuilder;
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager as _, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use url::Url;

#[cfg(unix)]
pub type Filter = shell::unix::Filter;
#[cfg(windows)]
pub type Filter = shell::windows::Filter;

/// How long the exit waits for the filter threads to copy the engine's last lines.
const FILTER_WAIT: Duration = Duration::from_millis(500);

/// Keeps the original standard error and replaces standard output and error by the filter pipes.
#[cfg_attr(
    unix,
    expect(
        clippy::unnecessary_wraps,
        reason = "the Windows filter can fail to install, and both systems share this signature"
    )
)]
pub fn install_filter(token: &TokenSlot) -> Option<Filter> {
    #[cfg(unix)]
    {
        if let Ok(original) = shell::unix::duplicate(2) {
            crate::keep_original_stderr(original);
        }
        Some(shell::unix::Filter::install(&[1, 2], token))
    }
    #[cfg(windows)]
    {
        if let Ok(original) = shell::windows::duplicate_stderr() {
            crate::keep_original_stderr(original);
        }
        shell::windows::Filter::install(token).ok()
    }
}

/// The server's process, as the operating system knows it.
enum Server {
    #[cfg(unix)]
    Unix { group: shell::unix::Group },
    #[cfg(windows)]
    Windows { job: Arc<shell::windows::Job> },
}

struct RealHost {
    app: AppHandle,
    tx: mpsc::Sender<Input>,
    token: TokenSlot,
    allowed: Arc<Mutex<Option<ServerAddress>>>,
    server: Option<Server>,
    input: Option<File>,
    filter: Option<Filter>,
}

impl Host for RealHost {
    fn is_file(&self, path: &Path) -> bool {
        shell::is_file(path)
    }

    fn start_server(&mut self, spec: &ServerSpec) -> Result<(), String> {
        server_started();
        let tx = self.tx.clone();
        let send = move |event| {
            let _ = tx.send(Input::Event(event));
        };
        #[cfg(unix)]
        {
            use std::os::fd::OwnedFd;
            let mut child = shell::unix::spawn(spec).map_err(|e| e.to_string())?;
            let pipes = (child.stdin.take(), child.stdout.take(), child.stderr.take());
            let (Some(stdin), Some(stdout), Some(stderr)) = pipes else {
                return Err("the server's pipes are missing".to_owned());
            };
            self.input = Some(File::from(OwnedFd::from(stdin)));
            let group = shell::unix::Group::of(&child);
            self.server = Some(Server::Unix { group: group.clone() });
            shell::server::watch(
                File::from(OwnedFd::from(stdout)),
                File::from(OwnedFd::from(stderr)),
                move || {
                    group
                        .wait(&mut child)
                        .map_or_else(|e| e.to_string(), shell::server::describe)
                },
                send,
            );
        }
        #[cfg(windows)]
        {
            let server = shell::windows::spawn(spec).map_err(|e| e.to_string())?;
            let job = Arc::new(server.job);
            self.input = Some(server.stdin);
            self.server = Some(Server::Windows { job: job.clone() });
            let process = server.process;
            shell::server::watch(
                server.stdout,
                server.stderr,
                move || shell::windows::wait(&process),
                send,
            );
        }
        Ok(())
    }

    fn close_server_input(&mut self) {
        self.input = None;
    }

    fn kill_server(&mut self) {
        match &self.server {
            #[cfg(unix)]
            Some(Server::Unix { group }) => group.kill(),
            #[cfg(windows)]
            Some(Server::Windows { job }) => job.terminate(),
            None => {}
        }
    }

    fn token_known(&mut self, token: &str) {
        let _ = self.token.set(token.as_bytes().to_vec());
    }

    fn show(&mut self, address: &ServerAddress) -> Result<(), String> {
        *self.allowed.lock().unwrap_or_else(PoisonError::into_inner) = Some(address.clone());
        let capability = shell::permissions().into_iter().fold(
            CapabilityBuilder::new("server")
                .window(shell::WINDOW)
                .remote(address.origin()),
            CapabilityBuilder::permission,
        );
        self.app.add_capability(capability).map_err(|e| e.to_string())?;
        let window = self
            .app
            .get_webview_window(shell::WINDOW)
            .ok_or("the window is gone")?;
        window
            .navigate(address.url().clone())
            .map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
        #[cfg(feature = "e2e")]
        crate::e2e::record("shown", address.origin());
        Ok(())
    }

    fn destroy_window(&mut self) {
        *self.allowed.lock().unwrap_or_else(PoisonError::into_inner) = None;
        if let Some(window) = self.app.get_webview_window(shell::WINDOW) {
            let _ = window.destroy();
        }
    }

    fn report(&mut self, reason: &str) {
        write_error(&format!("{reason}\n"), &self.token);
        #[cfg(feature = "e2e")]
        crate::e2e::record("report", reason);
        #[cfg(not(feature = "e2e"))]
        {
            use tauri_plugin_dialog::{DialogExt as _, MessageDialogKind};
            let text = String::from_utf8_lossy(&shell::redact::redact(
                reason.as_bytes(),
                self.token.get().map(Vec::as_slice),
            ))
            .into_owned();
            self.app
                .dialog()
                .message(text)
                .title("ReqSeq")
                .kind(MessageDialogKind::Error)
                .blocking_show();
        }
    }

    fn write_error(&mut self, text: &str) {
        write_error(text, &self.token);
    }

    fn open_with_system(&mut self, url: &Url) -> Result<(), String> {
        #[cfg(feature = "e2e")]
        if let Some(program) = std::env::var_os("REQSEQ_SHELL_E2E_OPENER") {
            return crate::e2e::open_with(Path::new(&program), url.as_str());
        }
        #[cfg(target_os = "linux")]
        return shell::unix::open_with(Path::new("xdg-open"), url.as_str());
        #[cfg(target_os = "macos")]
        return shell::unix::open_with(Path::new("/usr/bin/open"), url.as_str());
        #[cfg(windows)]
        return shell::windows::open(url.as_str());
    }

    fn after(&mut self, delay: Duration, timer: Timer) {
        #[cfg(feature = "e2e")]
        let delay = crate::e2e::address_wait()
            .filter(|_| timer == Timer::Address && delay == ADDRESS_WAIT)
            .unwrap_or(delay);
        #[cfg(not(feature = "e2e"))]
        let _ = ADDRESS_WAIT;
        let tx = self.tx.clone();
        thread::spawn(move || {
            thread::sleep(delay);
            let _ = tx.send(Input::Event(Event::Timer(timer)));
        });
    }

    fn exit(&mut self, code: i32) {
        if let Some(filter) = self.filter.take() {
            filter.finish(FILTER_WAIT);
        }
        std::process::exit(code);
    }
}

#[tauri::command]
async fn open_address(address: String, tx: tauri::State<'_, mpsc::Sender<Input>>) -> Result<(), String> {
    #[cfg(feature = "e2e")]
    crate::e2e::record("open_address", address.as_str());
    let (reply, answer) = mpsc::channel();
    tx.send(Input::Open(address, reply))
        .map_err(|_| "The shell is ending.".to_owned())?;
    answer
        .recv()
        .unwrap_or_else(|_| Err("The shell is ending.".to_owned()))
}

/// The dialogs of the operating system (SR-253 AK1); in an e2e build the driver's stand-in.
pub struct SystemDialog {
    app: AppHandle,
}

impl Dialog for SystemDialog {
    fn show(&self, pick: Pick, shown: &Shown) -> Option<PathBuf> {
        #[cfg(feature = "e2e")]
        {
            let _ = &self.app;
            crate::e2e::dialog(pick, shown)
        }
        #[cfg(not(feature = "e2e"))]
        {
            use tauri_plugin_dialog::DialogExt as _;
            let mut builder = self.app.dialog().file().set_title(pick.title());
            if let Some(window) = self.app.get_webview_window(shell::WINDOW) {
                builder = builder.set_parent(&window);
            }
            if let Some(folder) = &shown.folder {
                builder = builder.set_directory(folder);
            }
            if let Some(name) = &shown.name {
                builder = builder.set_file_name(name);
            }
            let chosen = match pick {
                Pick::Folder => builder.blocking_pick_folder(),
                Pick::File => builder.blocking_pick_file(),
                Pick::Target => builder.blocking_save_file(),
            };
            chosen.and_then(|path| path.into_path().ok())
        }
    }
}

type Picker = Dialogs<SystemDialog>;

fn choose(dialogs: &Picker, pick: Pick, start: Option<&str>, name: Option<&str>) -> Option<String> {
    dialogs.choose(pick, start, name, cfg!(windows))
}

#[tauri::command]
async fn pick_folder(
    start: Option<String>,
    dialogs: tauri::State<'_, Picker>,
) -> Result<Option<String>, String> {
    Ok(choose(&dialogs, Pick::Folder, start.as_deref(), None))
}

#[tauri::command]
async fn pick_file(
    start: Option<String>,
    dialogs: tauri::State<'_, Picker>,
) -> Result<Option<String>, String> {
    Ok(choose(&dialogs, Pick::File, start.as_deref(), None))
}

#[tauri::command]
async fn pick_save_target(
    start: Option<String>,
    name: Option<String>,
    dialogs: tauri::State<'_, Picker>,
) -> Result<Option<String>, String> {
    Ok(choose(&dialogs, Pick::Target, start.as_deref(), name.as_deref()))
}

/// The Node binary and the CLI entry: the release's, or in an e2e build those the test names.
fn layout() -> Layout {
    #[cfg(feature = "e2e")]
    if let Some(layout) = crate::e2e::layout() {
        return layout;
    }
    let exe = std::env::current_exe().unwrap_or_default();
    Layout::of_release(&release_root(&exe, cfg!(target_os = "macos")), cfg!(windows))
}

fn ends_with_failure(text: &str, token: &TokenSlot, filter: Option<Filter>) -> i32 {
    write_error(text, token);
    if let Some(filter) = filter {
        filter.finish(FILTER_WAIT);
    }
    shell::run::FAILED
}

/// Runs the shell until it exits; returns the exit code when the run loop ends by itself.
pub fn run(token: TokenSlot, filter: Option<Filter>) -> i32 {
    // A failed GTK start inside Tauri panics, so it is tried first (ADR-0021, Failures).
    #[cfg(target_os = "linux")]
    if let Err(error) = gtk::init() {
        return ends_with_failure(
            &format!("ReqSeq: the window could not open: {error}\n"),
            &token,
            filter,
        );
    }
    // The GTK file dialog runs in this process; without its list of recent files it writes no file (SR-253 AK1).
    #[cfg(target_os = "linux")]
    if let Some(settings) = gtk::Settings::default() {
        use gtk::prelude::GtkSettingsExt as _;
        settings.set_gtk_recent_files_enabled(false);
    }
    let (tx, rx) = mpsc::channel::<Input>();
    let root: PathBuf = root_folder(cfg!(windows), std::env::var("SystemDrive").ok().as_deref());
    #[cfg(feature = "e2e")]
    let root = crate::e2e::root().unwrap_or(root);
    let spec = ServerSpec::new(&layout(), &root);
    let allowed: Arc<Mutex<Option<ServerAddress>>> = Arc::default();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(tx.clone())
        .invoke_handler(tauri::generate_handler![
            pick_folder,
            pick_file,
            pick_save_target,
            open_address
        ])
        .setup({
            let tx = tx.clone();
            let allowed = allowed.clone();
            move |app| {
                app.manage(Picker::new(SystemDialog {
                    app: app.handle().clone(),
                }));
                let event = match window(app.handle(), allowed) {
                    Ok(()) => Event::WindowReady,
                    Err(error) => Event::WindowFailed(error.to_string()),
                };
                let _ = tx.send(Input::Event(event));
                Ok(())
            }
        })
        .build(tauri::generate_context!());
    let app = match app {
        Ok(app) => app,
        Err(error) => {
            return ends_with_failure(
                &format!("ReqSeq: the window could not open: {error}\n"),
                &token,
                filter,
            );
        }
    };
    let mut host = RealHost {
        app: app.handle().clone(),
        tx: tx.clone(),
        token,
        allowed,
        server: None,
        input: None,
        filter,
    };
    let mut shell = Shell::new(spec);
    // Tauri creates the window when its run loop starts; `WebView2` may never report the result (#2477).
    shell.begin(&mut host);
    thread::spawn(move || controller(&rx, shell, host));
    #[cfg(unix)]
    {
        let tx = tx.clone();
        thread::spawn(move || {
            loop {
                let _ = shell::unix::wait_end_signal();
                let _ = tx.send(Input::Event(Event::End));
            }
        });
    }
    #[cfg(feature = "e2e")]
    crate::e2e::start(app.handle().clone());
    app.run(move |app, event| match event {
        RunEvent::WindowEvent {
            event: WindowEvent::CloseRequested { api, .. },
            ..
        } => {
            api.prevent_close();
            if let Some(window) = app.get_webview_window(shell::WINDOW) {
                let _ = window.hide();
            }
            let _ = tx.send(Input::Event(Event::End));
        }
        // Cmd-Q, or the last window gone: the shell ends as when its window is closed.
        RunEvent::ExitRequested { api, code: None, .. } => {
            api.prevent_exit();
            let _ = tx.send(Input::Event(Event::End));
        }
        _ => {}
    });
    0
}

fn controller(rx: &mpsc::Receiver<Input>, mut shell: Shell, mut host: RealHost) {
    for input in rx {
        match input {
            Input::Event(event) => shell.on(event, &mut host),
            Input::Open(address, reply) => {
                let _ = reply.send(shell.open(&address, &mut host));
            }
        }
    }
}

/// The hidden window with nothing loaded (ADR-0021, Start step 1): it loads only the origin of the printed address,
/// opens no new window and starts no download, and keeps no browsing data.
fn window(app: &AppHandle, allowed: Arc<Mutex<Option<ServerAddress>>>) -> tauri::Result<()> {
    let blank: Url = "about:blank"
        .parse()
        .map_err(|_| tauri::Error::InvalidWebviewUrl("about:blank"))?;
    let builder = WebviewWindowBuilder::new(app, shell::WINDOW, WebviewUrl::External(blank))
        .title("ReqSeq")
        .inner_size(1280.0, 820.0)
        .visible(false)
        .incognito(true)
        .on_navigation(move |url| {
            let allowed = allowed.lock().unwrap_or_else(PoisonError::into_inner);
            let pass = allowed.as_ref().is_some_and(|server| server.same_origin(url))
                || (allowed.is_none() && url.as_str() == "about:blank");
            #[cfg(feature = "e2e")]
            crate::e2e::record(
                "navigation",
                format!(
                    "{} {}",
                    if pass { "allowed" } else { "refused" },
                    url.origin().ascii_serialization()
                ),
            );
            pass
        })
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .on_download(|_, _| false);
    #[cfg(feature = "e2e")]
    let builder = builder.on_page_load(|_, payload| {
        crate::e2e::record(
            "page-load",
            format!(
                "{:?} {}",
                payload.event(),
                payload.url().origin().ascii_serialization()
            ),
        );
    });
    let window = engine::configure(builder).build()?;
    engine::switch_off(&window);
    frame::set(&window);
    Ok(())
}

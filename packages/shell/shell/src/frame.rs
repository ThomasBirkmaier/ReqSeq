//! The window's own frame: on macOS a hairline between the title bar and the page, as the rail has one between
//! itself and the panes (#2464). Windows and Linux draw their own frame and keep it.
use tauri::{Runtime, WebviewWindow};

/// Sets the frame of the built window.
pub fn set<R: Runtime>(window: &WebviewWindow<R>) {
    #[cfg(target_os = "macos")]
    if let Ok(ns_window) = window.ns_window() {
        macos::titlebar_line(ns_window);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

#[cfg(target_os = "macos")]
#[allow(unsafe_code)] // ADR-0021, Quality gates: NSWindow is reached through Objective-C.
mod macos {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    /// `NSTitlebarSeparatorStyleLine` (macOS 11 and later).
    const LINE: isize = 2;

    /// `window.titlebarSeparatorStyle = NSTitlebarSeparatorStyleLine`.
    pub fn titlebar_line(window: *mut std::ffi::c_void) {
        let window = window.cast::<AnyObject>();
        if window.is_null() {
            return;
        }
        // SAFETY: `window` is the NSWindow that Tauri hands out for the window built in `setup`, on the main thread;
        // the setter takes an NSInteger and exists from macOS 11, the minimum of the shipped `aarch64-apple-darwin`
        // build.
        unsafe {
            let _: () = msg_send![&*window, setTitlebarSeparatorStyle: LINE];
        }
    }
}

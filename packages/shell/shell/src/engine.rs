//! The engine's own connections switched off (ADR-0021, Engine data and the engine's own connections; SR-252 AK7):
//! `SmartScreen`, background networking, proxy detection, autofill and password saving in `WebView2`, the
//! fraudulent-website warning in `WKWebView`, DNS prefetching in `WebKitGTK`.
use tauri::{Runtime, WebviewWindow, WebviewWindowBuilder};

/// The options set while the window is built.
pub fn configure<R: Runtime, M: tauri::Manager<R>>(
    builder: WebviewWindowBuilder<'_, R, M>,
) -> WebviewWindowBuilder<'_, R, M> {
    #[cfg(windows)]
    let builder = builder.additional_browser_args(shell::WEBVIEW2_ARGUMENTS);
    builder
}

/// The switches set on the built engine.
pub fn switch_off<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.with_webview(|webview| {
        #[cfg(target_os = "linux")]
        {
            use webkit2gtk::{SettingsExt as _, WebViewExt as _};
            if let Some(settings) = webview.inner().settings() {
                settings.set_enable_dns_prefetching(false);
            }
        }
        #[cfg(target_os = "macos")]
        crate::engine::macos::fraud_warning_off(webview.inner());
        #[cfg(windows)]
        crate::engine::windows::autofill_off(&webview.controller());
        #[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
        let _ = webview;
    });
}

#[cfg(target_os = "macos")]
#[allow(unsafe_code)] // ADR-0021, Quality gates: WKWebView's preferences are reached through Objective-C.
mod macos {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    /// `webView.configuration.preferences.fraudulentWebsiteWarningEnabled = NO`.
    pub fn fraud_warning_off(webview: *mut std::ffi::c_void) {
        let webview = webview.cast::<AnyObject>();
        if webview.is_null() {
            return;
        }
        // SAFETY: `webview` is the WKWebView that Tauri hands to `with_webview`, valid during the call on the main
        // thread; `configuration` and `preferences` return objects it owns, and the setter takes a BOOL.
        unsafe {
            let configuration: *mut AnyObject = msg_send![&*webview, configuration];
            if configuration.is_null() {
                return;
            }
            let preferences: *mut AnyObject = msg_send![&*configuration, preferences];
            if preferences.is_null() {
                return;
            }
            let _: () = msg_send![&*preferences, setFraudulentWebsiteWarningEnabled: false];
        }
    }
}

#[cfg(windows)]
mod windows {
    use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2Controller, ICoreWebView2Settings4};
    use windows::core::Interface as _;

    /// Autofill and password saving off in the settings of the `WebView2` controller.
    #[allow(unsafe_code)] // ADR-0021, Quality gates: the WebView2 COM interfaces.
    pub fn autofill_off(controller: &ICoreWebView2Controller) {
        // SAFETY: the controller is valid during `with_webview` on the UI thread; each call is a COM method of it or
        // of its settings, with plain BOOL arguments.
        unsafe {
            let Ok(webview) = controller.CoreWebView2() else {
                return;
            };
            let Ok(settings) = webview.Settings() else {
                return;
            };
            if let Ok(settings) = settings.cast::<ICoreWebView2Settings4>() {
                let _ = settings.SetIsGeneralAutofillEnabled(false);
                let _ = settings.SetIsPasswordAutosaveEnabled(false);
            }
        }
    }
}

// Security settings of every window and of the session (ADR-0010). LogReq never opens a network
// connection (SR-078): the renderer is sandboxed, cannot reach Node, and every request that is not to
// the app's own protocols is cancelled before it leaves.
import type { Session, WebContents, WebPreferences } from "electron";

/** The bundled renderer (`app://logreq/...`), the files of the workspace and the developer tools. */
export const LOCAL_PROTOCOLS: ReadonlySet<string> = new Set(["app:", "logreq-file:", "devtools:"]);

/**
 * ADR-0010's policy, plus `object-src`, `base-uri`, `form-action`, `frame-ancestors` and `frame-src`,
 * which `default-src` does not cover or that should not fall back to it. Sent as a header with every page.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "img-src 'self' data: logreq-file:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
].join("; ");

/** Web preferences of every window: isolated, sandboxed, no Node, no webview, no spell check downloads. */
export const webPreferences = (preload: string): WebPreferences => ({
  preload,
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  experimentalFeatures: false,
  navigateOnDragDrop: false,
  // Chromium's spell checker downloads its dictionaries (Linux, Windows).
  spellcheck: false,
});

/** Whether a request may go out: only to the app's own protocols (SR-078). */
export const isLocalRequest = (url: string): boolean => {
  const protocol = URL.parse(url)?.protocol;
  return protocol !== undefined && LOCAL_PROTOCOLS.has(protocol);
};

/** The part of a URL that a log line may show: the protocol and host, never a path or query. */
const originOf = (url: string): string => {
  const parsed = URL.parse(url);
  return parsed === null ? "an invalid URL" : `${parsed.protocol}//${parsed.host}`;
};

/** Where Chromium would download spell checker dictionaries: a local URL that serves nothing. */
export const NO_DICTIONARIES = "app://logreq/no-dictionaries/";

/** The session's device choosers (WebHID, Web Serial, WebUSB): each is refused with no device. */
const DEVICE_CHOOSERS = ["select-hid-device", "select-serial-port", "select-usb-device"] as const;

/**
 * Cancels every request of the session that is not local (SR-078) and logs where it would have gone;
 * denies every permission (camera, notifications, ...) and every device; no spell checker, and no place
 * to download its dictionaries from.
 */
export const secureSession = (session: Session, log: (line: string) => void): void => {
  session.webRequest.onBeforeRequest((details, callback) => {
    const local = isLocalRequest(details.url);
    if (!local) {
      log(`Blocked a request to ${originOf(details.url)}`);
    }
    callback({ cancel: !local });
  });
  session.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  session.setPermissionCheckHandler(() => false);
  session.setDevicePermissionHandler(() => false);
  for (const chooser of DEVICE_CHOOSERS) {
    session.on(chooser as "select-hid-device", (event, _details, callback: (device?: string) => void) => {
      event.preventDefault();
      callback();
    });
  }
  session.setSpellCheckerEnabled(false);
  session.setSpellCheckerDictionaryDownloadURL(NO_DICTIONARIES);
};

/** Every web contents: no navigation of any frame, no redirect, no new windows, no webviews, no Bluetooth device. */
export const guardContents = (contents: WebContents): void => {
  for (const event of ["will-navigate", "will-frame-navigate", "will-redirect"] as const) {
    contents.on(event as "will-navigate", (navigation) => {
      navigation.preventDefault();
    });
  }
  contents.on("select-bluetooth-device", (event, _devices, callback) => {
    event.preventDefault();
    callback("");
  });
  contents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
};

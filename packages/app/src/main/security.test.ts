import type { Session, WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
  CONTENT_SECURITY_POLICY,
  NO_DICTIONARIES,
  guardContents,
  isLocalRequest,
  secureSession,
  webPreferences,
} from "./security.js";

describe("webPreferences", () => {
  it("isolates and sandboxes the renderer, without Node, webviews or spell check", () => {
    expect(webPreferences("/out/preload/index.cjs")).toEqual({
      preload: "/out/preload/index.cjs",
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
      spellcheck: false,
    });
  });
});

describe("CONTENT_SECURITY_POLICY", () => {
  it("is ADR-0010's policy: own scripts, no connections, images from the workspace", () => {
    expect(CONTENT_SECURITY_POLICY.split("; ")).toEqual([
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
    ]);
  });
});

describe("isLocalRequest (SR-078)", () => {
  it("lets only app:, logreq-file: and devtools: through", () => {
    expect(isLocalRequest("app://logreq/index.html")).toBe(true);
    expect(isLocalRequest("logreq-file://workspace/system/a.png")).toBe(true);
    expect(isLocalRequest("devtools://devtools/bundled/inspector.html")).toBe(true);
    for (const url of [
      "https://example.com/",
      "http://127.0.0.1:8080/",
      "file:///etc/passwd",
      "ws://localhost/",
      "chrome://gpu",
      "not a url",
    ]) {
      expect([url, isLocalRequest(url)]).toEqual([url, false]);
    }
  });
});

describe("secureSession", () => {
  type Listener = (details: { url: string }, callback: (response: { cancel: boolean }) => void) => void;
  const fakeSession = () => {
    const session = {
      webRequest: { onBeforeRequest: vi.fn<(listener: Listener) => void>() },
      setPermissionRequestHandler:
        vi.fn<(handler: (c: unknown, p: string, cb: (granted: boolean) => void) => void) => void>(),
      setPermissionCheckHandler: vi.fn<(handler: () => boolean) => void>(),
      setSpellCheckerEnabled: vi.fn<(enabled: boolean) => void>(),
      setDevicePermissionHandler: vi.fn<(handler: () => boolean) => void>(),
      setSpellCheckerDictionaryDownloadURL: vi.fn<(url: string) => void>(),
      on: vi.fn<
        (
          event: string,
          handler: (
            e: { preventDefault: () => void },
            details: unknown,
            cb: (device?: string) => void,
          ) => void,
        ) => void
      >(),
    };
    const log = vi.fn<(line: string) => void>();
    secureSession(session as unknown as Session, log);
    return { session, log };
  };

  it("cancels every request that is not local and logs only its origin (SR-078)", () => {
    const { session, log } = fakeSession();
    const listener = session.webRequest.onBeforeRequest.mock.calls[0]?.[0];
    const answers: boolean[] = [];
    const answer = (response: { cancel: boolean }): void => {
      answers.push(response.cancel);
    };
    listener?.({ url: "app://logreq/assets/index.js" }, answer);
    listener?.({ url: "https://example.com/secret/path?q=element-text" }, answer);
    listener?.({ url: "::" }, answer);
    expect(answers).toEqual([false, true, true]);
    expect(log.mock.calls).toEqual([
      ["Blocked a request to https://example.com"],
      ["Blocked a request to an invalid URL"],
    ]);
  });

  it("denies every permission and device and turns the spell checker and its downloads off", () => {
    const { session } = fakeSession();
    const granted = vi.fn<(granted: boolean) => void>();
    session.setPermissionRequestHandler.mock.calls[0]?.[0]({}, "media", granted);
    expect(granted).toHaveBeenCalledWith(false);
    expect(session.setPermissionCheckHandler.mock.calls[0]?.[0]()).toBe(false);
    expect(session.setDevicePermissionHandler.mock.calls[0]?.[0]()).toBe(false);
    expect(session.on.mock.calls.map((call) => call[0])).toEqual([
      "select-hid-device",
      "select-serial-port",
      "select-usb-device",
    ]);
    for (const [event, handler] of session.on.mock.calls) {
      const preventDefault = vi.fn();
      const choose = vi.fn<(device?: string) => void>();
      handler({ preventDefault }, {}, choose);
      expect([event, preventDefault.mock.calls.length, choose.mock.calls]).toEqual([event, 1, [[]]]);
    }
    expect(session.setSpellCheckerEnabled).toHaveBeenCalledWith(false);
    expect(session.setSpellCheckerDictionaryDownloadURL).toHaveBeenCalledWith(NO_DICTIONARIES);
    expect(isLocalRequest(NO_DICTIONARIES)).toBe(true);
  });
});

describe("guardContents", () => {
  it("prevents navigation of every frame, redirects, webviews and Bluetooth devices, and denies new windows", () => {
    const handlers = new Map<
      string,
      (event: { preventDefault: () => void }, devices?: unknown, choose?: (id: string) => void) => void
    >();
    let opener: (() => unknown) | undefined;
    const contents = {
      on: (
        event: string,
        handler: (
          event: { preventDefault: () => void },
          devices?: unknown,
          choose?: (id: string) => void,
        ) => void,
      ) => {
        handlers.set(event, handler);
      },
      setWindowOpenHandler: (handler: () => unknown) => {
        opener = handler;
      },
    };
    guardContents(contents as unknown as WebContents);
    expect([...handlers.keys()]).toEqual([
      "will-navigate",
      "will-frame-navigate",
      "will-redirect",
      "select-bluetooth-device",
      "will-attach-webview",
    ]);
    for (const event of handlers.keys()) {
      const preventDefault = vi.fn();
      const choose = vi.fn<(id: string) => void>();
      handlers.get(event)?.({ preventDefault }, [], choose);
      expect([event, preventDefault.mock.calls.length]).toEqual([event, 1]);
      if (event === "select-bluetooth-device") {
        expect(choose).toHaveBeenCalledWith("");
      }
    }
    expect(opener?.()).toEqual({ action: "deny" });
  });
});

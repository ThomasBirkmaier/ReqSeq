// @vitest-environment happy-dom
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InvokeResult, LogReqBridge, WorkspaceChange } from "../shared/protocol.js";
import { App } from "./App.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A bridge whose status answers come from `results`, one per call, the last one repeated. */
const fakeBridge = (results: InvokeResult[]) => {
  const listeners = new Set<(change: WorkspaceChange) => void>();
  let call = 0;
  const invoke = vi.fn(() => {
    const result = results[Math.min(call++, results.length - 1)];
    return result === undefined ? Promise.reject(new Error("no result")) : Promise.resolve(result);
  });
  const bridge: LogReqBridge = {
    invoke,
    commands: () => Promise.resolve([]),
    on: (_event, listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const change = async (reason: WorkspaceChange["reason"]): Promise<void> => {
    await act(async () => {
      for (const listener of listeners) {
        listener({ reason });
      }
      await Promise.resolve();
    });
  };
  return { bridge, invoke, change, listeners };
};

const STATUS: InvokeResult = { ok: true, output: { name: "Weather station", readOnly: true } };
const NONE: InvokeResult = {
  ok: false,
  error: {
    code: "workspace.not-found",
    message: "No workspace is open. Open one with File > Open Workspace.",
  },
};

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

const render = async (bridge: LogReqBridge): Promise<void> => {
  await act(async () => {
    root.render(createElement(App, { bridge }));
    await Promise.resolve();
  });
};

const text = (label: string): string | null | undefined =>
  container.querySelector(`[aria-label="${label}"]`)?.textContent;

describe("App", () => {
  it("is a white sheet with the modeline and the minibuffer; empty until the status is there", async () => {
    let answer: (result: InvokeResult) => void = () => undefined;
    const bridge: LogReqBridge = {
      invoke: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
      commands: () => Promise.resolve([]),
      on: () => () => undefined,
    };
    await render(bridge);
    expect(container.querySelector('main[aria-label="Sheet"]')?.childElementCount).toBe(0);
    expect(text("Modeline")).toBe("");
    expect(text("Minibuffer")).toBe("");
    await act(async () => {
      answer(STATUS);
      await Promise.resolve();
    });
    expect(text("Modeline")).toBe("Weather stationread-only");
    expect(document.title).toBe("Weather station - LogReq");
  });

  it("asks for the status again when the workspace changes, and says why when it matters", async () => {
    const { bridge, invoke, change } = fakeBridge([STATUS, NONE, STATUS]);
    await render(bridge);
    expect(invoke).toHaveBeenCalledWith("workspace.status", {});
    await change("stopped");
    expect(text("Modeline")).toBe("No workspace");
    expect(document.title).toBe("LogReq");
    expect(text("Minibuffer")).toBe(
      "The core process keeps stopping. Open the workspace again with File > Open Workspace.",
    );
    await change("restarted");
    expect(text("Modeline")).toBe("Weather stationread-only");
    expect(text("Minibuffer")).toBe("The core process stopped and was started again.");
    await change("written");
    expect(text("Minibuffer")).toBe("");
    expect(invoke).toHaveBeenCalledTimes(4);
  });

  it("shows why no workspace is open", async () => {
    const { bridge } = fakeBridge([NONE]);
    await render(bridge);
    expect(text("Modeline")).toBe("No workspace");
    expect(text("Minibuffer")).toBe("No workspace is open. Open one with File > Open Workspace.");
  });

  it("stops listening and ignores late answers once it is gone", async () => {
    let answer: (result: InvokeResult) => void = () => undefined;
    const { bridge, listeners } = fakeBridge([STATUS]);
    bridge.invoke = () =>
      new Promise((resolve) => {
        answer = resolve;
      });
    await render(bridge);
    expect(listeners.size).toBe(1);
    act(() => {
      root.unmount();
    });
    expect(listeners.size).toBe(0);
    answer(STATUS);
    await Promise.resolve();
    root = createRoot(container);
  });
});

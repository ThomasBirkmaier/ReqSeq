// @vitest-environment happy-dom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { LogReqBridge } from "../shared/protocol.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("renderer entry", () => {
  it("renders the app into #root on the preload bridge", async () => {
    const bridge: LogReqBridge = {
      invoke: (name) =>
        Promise.resolve({
          ok: true,
          output:
            name === "workspace.status"
              ? { name: "Weather station", readOnly: false }
              : name === "metamodel.get"
                ? { types: [], statuses: [], meanings: {} }
                : name === "element.facets"
                  ? { total: 0, types: [], statuses: [], properties: [], incomplete: false }
                  : { elements: [], total: 0 },
        }),
      commands: () => Promise.resolve([]),
      on: () => () => undefined,
      copyText: () => Promise.resolve(true),
    };
    Object.defineProperty(window, "logreq", { value: bridge, configurable: true });
    document.body.innerHTML = '<div id="root"></div>';
    await act(async () => {
      await import("./main.js");
    });
    expect(document.querySelector('[aria-label="Modeline"]')?.textContent).toContain("Weather station");
  });

  it("fails without #root", async () => {
    document.body.innerHTML = "";
    vi.resetModules();
    await expect(import("./main.js")).rejects.toThrow("The page has no #root element");
  });
});

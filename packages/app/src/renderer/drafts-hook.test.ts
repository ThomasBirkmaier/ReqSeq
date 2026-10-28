// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { Drafts } from "./drafts.js";
import { useDrafts } from "./drafts.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useDrafts", () => {
  it("changes a draft the app keeps, and none it does not keep", () => {
    let drafts: Drafts | undefined;
    const Probe = (): null => {
      drafts = useDrafts(undefined);
      return null;
    };
    const root = createRoot(document.createElement("div"));
    act(() => {
      root.render(createElement(Probe));
    });
    act(() => {
      drafts?.onDraft("a", { text: "x!", base: "x" });
      drafts?.update("a", (draft) => ({ ...draft, text: "x?" }));
      drafts?.update("b", () => ({ text: "never", base: "" }));
    });
    expect(drafts?.drafts.current.get("a")).toEqual({ text: "x?", base: "x" });
    expect(drafts?.drafts.current.has("b")).toBe(false);
    act(() => {
      root.unmount();
    });
  });
});

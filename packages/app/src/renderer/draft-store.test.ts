// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { DataExportElement } from "@reqseq/core";
import type { DraftStorage, WindowDrafts } from "./draft-store.js";
import { DRAFTS_KEY, dropDrafts, keepDrafts, takeDrafts, useWindowDrafts } from "./draft-store.js";
import type { Draft } from "./drafts.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const memory = (): DraftStorage & { readonly items: Map<string, string> } => {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
};

const refusing: DraftStorage = {
  getItem: () => {
    throw new Error("no storage");
  },
  setItem: () => {
    throw new Error("full");
  },
  removeItem: () => {
    throw new Error("no storage");
  },
};

const ELEMENT = { id: "u1", title: "Wind" } as unknown as DataExportElement;

/** A draft held back after a conflict: text, a box, the bytes it was typed on and the element shown. */
const CONFLICT: Draft = {
  text: "b1 mine",
  base: "b1",
  boxes: new Map([["rationale", { doc: "why", base: "" }]]),
  sha: "s1",
  shown: { element: ELEMENT, sha: "s1" },
};

describe("the drafts of the window outside the page (#270)", () => {
  it("keeps the drafts of a workspace and takes them back, with the buffer shown", () => {
    const storage = memory();
    keepDrafts(() => storage, {
      workspace: "ws",
      shown: "element:r:u1",
      drafts: new Map([
        ["element:r:u1", CONFLICT],
        ["element:r:u2", { text: "typed", base: "" }],
      ]),
    });
    expect(takeDrafts(() => storage, "ws")).toEqual({
      workspace: "ws",
      shown: "element:r:u1",
      drafts: new Map([
        ["element:r:u1", CONFLICT],
        ["element:r:u2", { text: "typed", base: "" }],
      ]),
    });
    expect(takeDrafts(() => storage, "other")).toBeUndefined();
  });

  it("drops the entry without drafts, and on request", () => {
    const storage = memory();
    keepDrafts(() => storage, { workspace: "ws", drafts: new Map([["a", { text: "x", base: "" }]]) });
    expect(takeDrafts(() => storage, "ws")?.shown).toBeUndefined();
    keepDrafts(() => storage, { workspace: "ws", drafts: new Map() });
    expect(storage.items.has(DRAFTS_KEY)).toBe(false);
    keepDrafts(() => storage, { workspace: "ws", drafts: new Map([["a", { text: "x", base: "" }]]) });
    dropDrafts(() => storage);
    expect(takeDrafts(() => storage, "ws")).toBeUndefined();
  });

  it("leaves out what cannot be read", () => {
    const storage = memory();
    const take = (entry: unknown): ReturnType<typeof takeDrafts> => {
      storage.setItem(DRAFTS_KEY, typeof entry === "string" ? entry : JSON.stringify(entry));
      return takeDrafts(() => storage, "ws");
    };
    expect(take("{not json")).toBeUndefined();
    expect(take([1])).toBeUndefined();
    expect(take({ workspace: "ws", drafts: {} })).toBeUndefined();
    expect(take({ workspace: "ws", drafts: [] })).toBeUndefined();
    const broken = [
      "no pair",
      [1, { text: "", base: "" }],
      ["k", { text: 1, base: "" }],
      ["k", { text: "", base: "", boxes: [["b", { doc: 1, base: "" }]] }],
      ["k", { text: "", base: "", boxes: {} }],
      ["k", { text: "", base: "", sha: 1 }],
      ["k", { text: "", base: "", shown: { element: "x", sha: "s" } }],
    ];
    expect(take({ workspace: "ws", shown: 7, drafts: [...broken, ["ok", { text: "t", base: "" }]] })).toEqual(
      {
        workspace: "ws",
        drafts: new Map([["ok", { text: "t", base: "" }]]),
      },
    );
  });

  it("keeps nothing and takes nothing from a storage that refuses", () => {
    expect(() => {
      keepDrafts(() => refusing, { workspace: "ws", drafts: new Map([["a", CONFLICT]]) });
      keepDrafts(() => refusing, { workspace: "ws", drafts: new Map() });
      dropDrafts(() => refusing);
    }).not.toThrow();
    expect(takeDrafts(() => refusing, "ws")).toBeUndefined();
  });

  it("useWindowDrafts keeps every change with the workspace and the buffer shown", () => {
    const storage = memory();
    let drafts: WindowDrafts | undefined;
    const Probe = ({ shown }: { readonly shown: string | undefined }): null => {
      drafts = useWindowDrafts(shown, () => storage);
      return null;
    };
    const root = createRoot(document.createElement("div"));
    act(() => {
      root.render(createElement(Probe, { shown: "a" }));
    });
    // Without a workspace nothing is kept.
    act(() => {
      drafts?.onDraft("a", { text: "x", base: "" });
    });
    expect(storage.items.has(DRAFTS_KEY)).toBe(false);
    act(() => {
      if (drafts !== undefined) {
        drafts.scope.current = "ws";
      }
      drafts?.onDraft("a", { text: "xy", base: "" });
    });
    expect(takeDrafts(() => storage, "ws")?.shown).toBe("a");
    // Showing another buffer keeps it as the one shown.
    act(() => {
      root.render(createElement(Probe, { shown: undefined }));
    });
    expect(takeDrafts(() => storage, "ws")?.shown).toBeUndefined();
    act(() => {
      root.render(createElement(Probe, { shown: "b" }));
    });
    expect(takeDrafts(() => storage, "ws")?.shown).toBe("b");
    // Drafts seeded from a page before are kept and counted.
    act(() => {
      drafts?.seed(new Map([["b", CONFLICT]]));
    });
    expect([...(takeDrafts(() => storage, "ws")?.drafts.keys() ?? [])]).toEqual(["a", "b"]);
    // A reset drops them.
    act(() => {
      drafts?.reset();
    });
    expect(storage.items.has(DRAFTS_KEY)).toBe(false);
    act(() => {
      root.render(createElement(Probe, { shown: "a" }));
    });
    expect(storage.items.has(DRAFTS_KEY)).toBe(false);
    act(() => {
      root.unmount();
    });
  });
});

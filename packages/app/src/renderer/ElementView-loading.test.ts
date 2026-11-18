// @vitest-environment happy-dom
// happy-dom fires `selectionchange` inside a CodeMirror update; the root vitest config loads this setup, a
// run in packages/app needs it too (ThomasBirkmaier/ReqSeq-archive#460, ThomasBirkmaier/ReqSeq-archive#573).
import "../../../../scripts/test-support/dom-selection.mjs";
import { act } from "react";
import { describe, expect, it } from "vitest";
import type { Call } from "./call.js";
import {
  asCall,
  container,
  fakeCall,
  flush,
  press,
  query,
  renewRoot,
  root,
} from "./components.test-helper.js";
import { editorView, mount, read } from "./ElementView.test-helper.js";

describe("ElementView", () => {
  describe("while the element loads: a key, the pointer (ThomasBirkmaier/ReqSeq-archive#542)", () => {
    /** A call whose `element.get` answers only when `answer` is called. */
    const loadingCall = (): { call: Call; answer: () => Promise<void> } => {
      const call = fakeCall({ "element.get": () => ({ element: read() }) });
      let open: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      return {
        call: ((name: string, input: Record<string, unknown>) =>
          name === "element.get" ? gate.then(() => call(name, input)) : call(name, input)) as unknown as Call,
        answer: async () => {
          open();
          await flush();
        },
      };
    };
    const enterWhileLoading = async (): Promise<{ answer: () => Promise<void> }> => {
      const { call, answer } = loadingCall();
      await mount(call);
      expect(container.querySelector(".cm-editor")).toBeNull();
      const article = query("article");
      act(() => {
        article.focus();
      });
      await press(article, "Enter");
      return { answer };
    };

    it("puts the caret at the end of the text once the text is shown", async () => {
      const { answer } = await enterWhileLoading();
      await answer();
      expect(editorView().hasFocus).toBe(true);
      expect(editorView().state.selection.main.head).toBe(24);
    });

    it("shows the element when its first parents call fails, and says why", async () => {
      const { echoed } = await mount(
        asCall(
          fakeCall({
            "element.get": () => ({ element: read() }),
            "trace.neighbourhood": () => new Error("The parents could not be read"),
          }),
        ),
      );
      expect(query("article h1").textContent).toBe("Measure wind");
      expect(container.querySelector(".cm-editor")).not.toBeNull();
      expect(container.querySelector(".parents")).toBeNull();
      expect(echoed).toEqual(["The parents could not be read"]);
    });

    it("drops the answer of an element that is no longer shown", async () => {
      const { call, answer } = loadingCall();
      const { data } = await mount(call);
      act(() => {
        root.unmount();
      });
      await answer();
      expect(data.filter(([, loaded]) => loaded !== undefined)).toEqual([]);
      renewRoot();
    });

    it("shows the element together with its parents line, so the title never moves down once shown; the modeline with it", async () => {
      const call = fakeCall({ "element.get": () => ({ element: read() }) });
      let open: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      const { data } = await mount(((name: string, input: Record<string, unknown>) =>
        name === "trace.neighbourhood"
          ? gate.then(() => call(name, input))
          : call(name, input)) as unknown as Call);
      expect(call.mock.calls.map(([name]) => name)).toEqual(["element.get"]);
      expect(container.querySelector("article h1")).toBeNull();
      expect(data.filter(([, loaded]) => loaded !== undefined)).toEqual([]);
      open();
      await flush();
      expect(query("article h1").textContent).toBe("Measure wind");
      expect(data.filter(([, loaded]) => loaded !== undefined).map(([, loaded]) => loaded?.kind)).toEqual([
        "element",
      ]);
    });

    it("is taken back by a later key on the buffer, such as Escape", async () => {
      const { call, answer } = loadingCall();
      await mount(call);
      const article = query("article");
      act(() => {
        article.focus();
      });
      await press(article, "Enter");
      await press(article, "Escape");
      await answer();
      expect(editorView().hasFocus).toBe(false);
      expect(document.activeElement).toBe(article);
    });

    it("stays through a modifier pressed on its own, such as Shift for a capital letter", async () => {
      const { call, answer } = loadingCall();
      await mount(call);
      const article = query("article");
      act(() => {
        article.focus();
      });
      await press(article, "Enter");
      await press(article, "Shift", { shiftKey: true });
      await answer();
      expect(editorView().hasFocus).toBe(true);
    });

    it("is dropped when the element cannot be read, also when it is read later", async () => {
      let fail = true;
      const call = fakeCall({
        "element.get": () => (fail ? new Error("No element has that ID") : { element: read() }),
      });
      let open: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      const { again } = await mount(((name: string, input: Record<string, unknown>) =>
        name === "element.get" ? gate.then(() => call(name, input)) : call(name, input)) as unknown as Call);
      const article = query("article");
      act(() => {
        article.focus();
      });
      await press(article, "Enter");
      open();
      await flush();
      fail = false;
      await again(1);
      expect(editorView().hasFocus).toBe(false);
    });

    it("leaves the focus where it went in the meantime", async () => {
      const { answer } = await enterWhileLoading();
      const outside = document.createElement("input");
      document.body.append(outside);
      act(() => {
        outside.focus();
      });
      await answer();
      expect(editorView().hasFocus).toBe(false);
      expect(document.activeElement).toBe(outside);
      outside.remove();
    });
  });
});

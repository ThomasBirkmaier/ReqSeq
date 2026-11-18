// @vitest-environment happy-dom
// happy-dom fires `selectionchange` inside a CodeMirror update; the root vitest config loads this setup, a
// run in packages/app needs it too (ThomasBirkmaier/ReqSeq-archive#460, ThomasBirkmaier/ReqSeq-archive#573).
import "../../../../scripts/test-support/dom-selection.mjs";
import type { DataExportElement } from "@reqseq/core";
import { toggleTask } from "./editor/tasks.js";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { asCall, container, fakeCall, query } from "./components.test-helper.js";
import { editorView, mount, read } from "./ElementView.test-helper.js";

describe("ElementView", () => {
  describe("inline references (ThomasBirkmaier/ReqSeq-archive#424)", () => {
    const TARGET = "6adc4fbb-fe6a-4dfa-b9b6-8ccf0e589cf2";
    const SENTENCE = `Nach [D-017](reqseq:${TARGET}?version=n1:1aac78aad3b5e6a8) gilt das.`;
    const outdatedHint = (message = "points to an older version") => ({
      code: "relation.outdated",
      severity: "warning",
      message,
      targetId: TARGET,
      storedVersion: "n1:1aac78aad3b5e6a8",
      hintId: `relation.outdated/spec/a.md/uuid-1/@text/${TARGET}?version=n1:1aac78aad3b5e6a8&n=1`,
      place: { in: "text", occurrence: 1 },
    });
    const withReference = (problems: object[] = [outdatedHint()]) =>
      fakeCall({
        "element.get": () => ({
          element: read({ text: SENTENCE, problems } as unknown as Partial<DataExportElement>),
        }),
      });

    it("shows the label only, marks an outdated reference, and opens its element on a click", async () => {
      const { opened } = await mount(asCall(withReference()));
      const content = query(".cm-content").textContent;
      expect(content).toBe("Nach D-017 link outdated gilt das.");
      expect(content).not.toContain("](reqseq:");
      expect(content).not.toContain("n1:");
      expect(query(".cm-lr-outdated").title).toBe("points to an older version");
      await act(async () => {
        query(".cm-lr-ref").dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
        );
        await Promise.resolve();
      });
      expect(opened).toEqual([[TARGET, undefined]]);
    });

    it("opens a reference that names a repository with it", async () => {
      const call = fakeCall({
        "element.get": () => ({
          element: read({ text: `[x](reqseq:${TARGET}?repository=other)` }),
        }),
      });
      const { controls, opened } = await mount(asCall(call));
      act(() => {
        editorView().dispatch({ selection: { anchor: 2 } });
      });
      act(() => {
        controls().follow();
      });
      expect(opened).toEqual([[TARGET, "other"]]);
    });

    it("marks nothing when the element has no such hint, and drops the mark on a reload without it", async () => {
      let problems: object[] = [outdatedHint()];
      const call = fakeCall({
        "element.get": () => ({
          element: read({ text: SENTENCE, problems } as unknown as Partial<DataExportElement>),
        }),
      });
      const { again } = await mount(asCall(call));
      expect(container.querySelector(".cm-lr-outdated")).not.toBeNull();
      problems = [outdatedHint("changed message")];
      await again(1);
      expect(query(".cm-lr-outdated").title).toBe("changed message");
      problems = [];
      await again(2);
      expect(container.querySelector(".cm-lr-outdated")).toBeNull();
      expect(query(".cm-lr-ref").textContent).toBe("D-017");
    });

    it("Follow reference opens the element at the cursor, or says there is none", async () => {
      const { controls, opened, echoed } = await mount(asCall(withReference()));
      act(() => {
        controls().follow();
      });
      expect(opened).toEqual([]);
      expect(echoed.at(-1)).toBe("No element reference at the cursor");
      act(() => {
        editorView().dispatch({ selection: { anchor: 8 } });
      });
      act(() => {
        controls().follow();
      });
      expect(opened).toEqual([[TARGET, undefined]]);
    });

    it("[SR-185/AK-jxg0] a text action runs its command on the text at the cursor, or says why not", async () => {
      const tasks = fakeCall({
        "element.get": () => ({ element: read({ text: "- [ ] one\n\nplain" }) }),
      });
      const { controls, echoed } = await mount(asCall(tasks));
      act(() => {
        editorView().dispatch({ selection: { anchor: 3 } });
      });
      act(() => {
        controls().text?.(toggleTask, "No task on this line");
      });
      expect(editorView().state.doc.toString()).toBe("- [x] one\n\nplain");
      expect(editorView().hasFocus).toBe(true);
      act(() => {
        editorView().dispatch({ selection: { anchor: editorView().state.doc.length } });
      });
      act(() => {
        controls().text?.(toggleTask, "No task on this line");
      });
      expect(echoed.at(-1)).toBe("No task on this line");
    });

    it("Ctrl+Enter on the buffer itself is left to the shortcut", async () => {
      await mount(asCall(withReference()));
      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        query("article").dispatchEvent(event);
        await Promise.resolve();
      });
      expect(event.defaultPrevented).toBe(false);
      expect(editorView().hasFocus).toBe(false);
    });
  });
});

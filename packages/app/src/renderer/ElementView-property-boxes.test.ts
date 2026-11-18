// @vitest-environment happy-dom
// happy-dom fires `selectionchange` inside a CodeMirror update; the root vitest config loads this setup, a
// run in packages/app needs it too (ThomasBirkmaier/ReqSeq-archive#460, ThomasBirkmaier/ReqSeq-archive#573).
import "../../../../scripts/test-support/dom-selection.mjs";
import type { DataExportElement } from "@reqseq/core";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Prompt, ElementControls } from "./action-types.js";
import { filteredList } from "./buffers.js";
import { propertyStep } from "./list-filters.js";
import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import type { Draft } from "./drafts.js";
import { NO_SUMMARY } from "./package-summary-test-data.js";
import {
  alone,
  asCall,
  click,
  container,
  fakeCall,
  flush,
  press,
  query,
  texts,
} from "./components.test-helper.js";
import { caretAt, editorView, fresh, modelOf, mount, read } from "./ElementView.test-helper.js";

describe("ElementView", () => {
  describe("property boxes (SR-104)", () => {
    const KEY = "acceptance-criteria";
    const model = modelOf({
      topic: { kind: "text", many: false, markdown: false },
      [KEY]: { kind: "text", many: true, markdown: false },
      effort: { kind: "number", many: false, markdown: false },
      synonyms: { kind: "text", many: true, markdown: false },
      area: {
        name: "Area",
        kind: "choice",
        many: false,
        markdown: false,
        choices: [
          { key: "quality", name: "Quality" },
          { key: "performance", name: "Performance" },
          { key: "interface", name: "Interface" },
        ],
      },
      tags: {
        name: "Tags",
        kind: "choice",
        many: true,
        markdown: false,
        choices: [
          { key: "a", name: "Alpha" },
          { key: "b", name: "Beta" },
        ],
      },
      packages: { name: "Package", kind: "relation", many: true, markdown: false, targetTypes: ["package"] },
      parent: { name: "Parent", kind: "relation", many: false, markdown: false },
    });
    const withProperties = (properties: Record<string, unknown>, more: Partial<DataExportElement> = {}) =>
      read({ text: "Text", relations: [], properties, ...more });
    const mountBoxes = async (
      properties: Record<string, unknown>,
      more: Partial<DataExportElement> = {},
      draft?: Draft,
      update?: (input: Record<string, unknown>) => unknown,
    ) => {
      // The bytes of the file: none until the file changes, then one name per change.
      let current: { properties: Record<string, unknown>; more: Partial<DataExportElement>; sha?: string } = {
        properties,
        more,
      };
      let changes = 0;
      const call = fakeCall({
        "element.get": () => ({
          element: withProperties(current.properties, current.more),
          ...(current.sha === undefined ? {} : { fileSha256: current.sha }),
        }),
        "element.update": update ?? (() => new Error("no update expected")),
      });
      await fresh();
      const mounted = await mount(asCall(call), 0, draft, { properties: model });
      return {
        ...mounted,
        call,
        change: (next: Record<string, unknown>, nextMore: Partial<DataExportElement> = {}) => {
          changes += 1;
          current = { properties: next, more: nextMore, sha: `sha-${String(changes)}` };
        },
      };
    };
    const field = (key: string): HTMLElement => query(`[data-field="${key}"]`);
    const viewOf = (key: string): EditorView => {
      const found = EditorView.findFromDOM(query(`[data-field="${key}"] .cm-editor`));
      if (found === null) {
        throw new Error("no editor");
      }
      return found;
    };
    const typeIn = async (key: string, insert: string, at?: number): Promise<void> => {
      await act(async () => {
        const view = viewOf(key);
        const from = at ?? view.state.doc.length;
        view.dispatch({ changes: { from, insert }, selection: { anchor: from + insert.length } });
        await Promise.resolve();
      });
    };
    const replaceIn = async (key: string, doc: string): Promise<void> => {
      await act(async () => {
        const view = viewOf(key);
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } });
        await Promise.resolve();
      });
    };
    const save = async (controls: () => ElementControls): Promise<void> => {
      await act(async () => {
        controls().save();
        await Promise.resolve();
      });
      await flush();
    };
    const updates = (call: ReturnType<typeof fakeCall>) =>
      call.mock.calls.filter(([name]) => name === "element.update").map(([, input]) => input);
    const savedWith = (properties: Record<string, unknown>) => ({
      element: withProperties(properties),
      files: ["a.md"],
      affected: 0,
    });

    it("[SR-104/AK-df5n] shows every filled property as a box below the text, and none for an empty one", async () => {
      await mountBoxes({
        topic: "Wind",
        empty: "",
        blank: "   ",
        none: null,
        list: [],
        mapping: {},
        [KEY]: ["first", "second"],
      });
      const names = [...container.querySelectorAll<HTMLElement>("[data-field]")].map(
        (f) => f.dataset["field"],
      );
      expect(names).toEqual(["Title", "Text", "topic", KEY]);
      // The boxes come after the text in the document.
      const all = [...container.querySelectorAll("[data-field]")];
      expect(all.indexOf(field("Text"))).toBeLessThan(all.indexOf(field("topic")));
      expect(viewOf(KEY).state.doc.toString()).toBe("first\nsecond");
    });

    it("[SR-104/AK-sxnr] saves a box that was emptied with unset, and the box is gone with the property", async () => {
      const { controls, call, drafts, echoed } = await mountBoxes(
        { topic: "Wind", [KEY]: ["first", "second"] },
        {},
        undefined,
        (input) => {
          expect(input).toEqual({ ref: "uuid-1", unset: [KEY] });
          return savedWith({ topic: "Wind" });
        },
      );
      await replaceIn(KEY, "");
      expect(drafts.at(-1)?.[1]?.boxes?.get(KEY)).toEqual({ doc: "", base: "first\nsecond" });
      // The box stays, empty, until it is saved.
      expect(container.querySelector(`[data-field="${KEY}"]`)).not.toBeNull();
      await save(controls);
      expect(updates(call)).toHaveLength(1);
      expect(container.querySelector(`[data-field="${KEY}"]`)).toBeNull();
      expect(echoed.at(-1)).toBe("Saved SR-000001 (SR-036) Measure wind");
      expect(drafts.at(-1)).toEqual(["element:spec:uuid-1", undefined]);
    });

    it("[SR-104/AK-sxnr] treats a box with nothing but blank lines as emptied", async () => {
      const { controls, call } = await mountBoxes({ [KEY]: ["first"], topic: "Wind" }, {}, undefined, () =>
        savedWith({ topic: "Wind" }),
      );
      await replaceIn(KEY, "  \n\n \t");
      await replaceIn("topic", "   ");
      await save(controls);
      expect(updates(call)).toEqual([{ ref: "uuid-1", unset: [KEY, "topic"] }]);
    });

    it("saves the text and the boxes that changed together, and only those", async () => {
      const { controls, call, drafts } = await mountBoxes(
        { topic: "Wind", [KEY]: ["first", "second"], effort: "3" },
        {},
        undefined,
        () => savedWith({ topic: "Wind!", [KEY]: ["first", "third"], effort: "3" }),
      );
      await typeIn("topic", "!");
      await replaceIn(KEY, "first\n\n  third \n");
      await act(async () => {
        editorView().dispatch({ changes: { from: 0, insert: "More " } });
        await Promise.resolve();
      });
      await save(controls);
      // Blank lines go, every other line is kept byte for byte, an untouched box is not sent.
      expect(updates(call)).toEqual([
        { ref: "uuid-1", text: "More Text", set: { topic: "Wind!", [KEY]: ["first", "  third "] } },
      ]);
      expect(drafts.at(-1)).toEqual(["element:spec:uuid-1", undefined]);
      expect(viewOf(KEY).state.doc.toString()).toBe("first\nthird");
    });

    it("sends only a box whose document differs from the stored one, and keeps the bytes of the others", async () => {
      const { controls, call, echoed } = await mountBoxes({
        topic: "Wind",
        [KEY]: ["first", "", "second"],
      });
      // The document is the stored value as it is: a blank item stays, nothing is trimmed.
      expect(viewOf(KEY).state.doc.toString()).toBe("first\n\nsecond");
      await typeIn("topic", "!");
      await replaceIn("topic", "Wind");
      await save(controls);
      expect(updates(call)).toEqual([]);
      expect(echoed.at(-1)).toBe("No changes to save");
    });

    it("sends what reads as a number in a number property as a number, anything else as the text typed (#614)", async () => {
      const { controls, call } = await mountBoxes({ effort: "1", topic: "t" }, {}, undefined, () =>
        savedWith({ effort: 2.5, topic: "t" }),
      );
      await replaceIn("effort", "2.5");
      await save(controls);
      await replaceIn("effort", "5 ");
      await save(controls);
      await replaceIn("effort", "abc");
      await save(controls);
      expect(updates(call)).toEqual([
        { ref: "uuid-1", set: { effort: 2.5 } },
        { ref: "uuid-1", set: { effort: 5 } },
        { ref: "uuid-1", set: { effort: "abc" } },
      ]);
    });

    it("keeps a number box and says why when core refuses a text that is no number (#614)", async () => {
      const refusal = 'effort: the text "abc" is no number; give a decimal number';
      const { controls, echoed, drafts } = await mountBoxes({ effort: 1, topic: "t" }, {}, undefined, () => {
        return new Error(refusal);
      });
      await replaceIn("effort", "abc");
      await save(controls);
      expect(echoed.at(-1)).toBe(refusal);
      expect(viewOf("effort").state.doc.toString()).toBe("abc");
      expect(drafts.at(-1)?.[1]?.boxes?.get("effort")).toEqual({ doc: "abc", base: "1" });
    });

    it("keeps the draft and the caret and says why when core refuses the update", async () => {
      const { controls, echoed, drafts } = await mountBoxes({ topic: "Wind" }, {}, undefined, () => {
        return new Error("Type system-requirement has no property topic");
      });
      await typeIn("topic", "!");
      await save(controls);
      expect(echoed.at(-1)).toBe("Type system-requirement has no property topic");
      expect(viewOf("topic").state.doc.toString()).toBe("Wind!");
      expect(drafts.at(-1)?.[1]?.boxes?.get("topic")).toEqual({ doc: "Wind!", base: "Wind" });
    });

    it("appends the first hint about a saved key to the echo", async () => {
      // A required property emptied: core saves it and gives the hint (SR-064 AK2).
      const { controls, echoed } = await mountBoxes({ effort: "1", topic: "t" }, {}, undefined, () => ({
        ...savedWith({ effort: "1", topic: "" }),
        problems: [
          { code: "element.missing-required", severity: "warning", message: "effort is odd", key: "effort" },
          {
            code: "element.missing-required",
            severity: "warning",
            message: "topic has no value",
            key: "topic",
          },
        ],
      }));
      await replaceIn("topic", " ");
      await save(controls);
      expect(echoed.at(-1)).toBe("Saved SR-000001 (SR-036) Measure wind. topic has no value");
    });

    it("keeps input typed while the save ran as a draft, and shows the saved value in a box that was not touched", async () => {
      let answer: (value: unknown) => void = () => undefined;
      const call = vi.fn((name: string) =>
        name === "element.update"
          ? new Promise((resolve) => {
              answer = resolve;
            })
          : Promise.resolve({
              ok: true,
              output:
                name === "trace.neighbourhood"
                  ? alone({ ref: "uuid-1" })
                  : (NO_SUMMARY[name]?.() ?? { element: withProperties({ topic: "Wind", [KEY]: ["a"] }) }),
            }),
      );
      const { controls, drafts } = await mount(asCall(call as never), 0, undefined, { properties: model });
      await typeIn("topic", "!");
      await act(async () => {
        controls().save();
        await Promise.resolve();
      });
      await typeIn("topic", "?");
      await act(async () => {
        answer({ ok: true, output: savedWith({ topic: "Wind!", [KEY]: ["a"] }) });
        await Promise.resolve();
      });
      await flush();
      expect(viewOf("topic").state.doc.toString()).toBe("Wind!?");
      expect(drafts.at(-1)?.[1]?.boxes?.get("topic")).toEqual({ doc: "Wind!?", base: "Wind!" });
    });

    it("is read-only for a read-only element, and for a property the type does not know", async () => {
      const { controls, echoed } = await mountBoxes({ topic: "Wind", unknown: "x" }, { readOnly: true });
      expect(field("topic").querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("false");
      await act(async () => {
        controls().save();
        await Promise.resolve();
      });
      expect(echoed.at(-1)).toBe("SR-000001 (SR-036) Measure wind is read-only");
      await mountBoxes({ topic: "Wind", unknown: "x" });
      expect(field("unknown").querySelector(".cm-editor")).toBeNull();
      expect(texts('[data-field="unknown"] .line')).toEqual(["x"]);
    });

    it("shows a choice property and a value that is no text as they are", async () => {
      await mountBoxes({ area: "performance", topic: "t", effort: { nested: true } });
      expect(field("area").querySelector(".cm-editor")).toBeNull();
      expect(texts('[data-field="area"] .line')).toEqual(["performance"]);
      expect(field("effort").querySelector(".cm-editor")).toBeNull();
    });

    it("makes a list with a value that holds a line break read-only and says so on entering it", async () => {
      const { echoed } = await mountBoxes({ [KEY]: ["one\ntwo", "three"] });
      expect(field(KEY).querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("false");
      act(() => {
        field(KEY).focus();
      });
      expect(echoed.at(-1)).toBe(`${KEY} has a value with a line break: edit it in the file`);
      // A single value may hold a line break.
      await mountBoxes({ topic: "one\ntwo" });
      expect(field("topic").querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("true");
    });

    it("keeps the unsaved boxes as a draft for the app, and drops a box that is the stored value again", async () => {
      const { drafts } = await mountBoxes({ topic: "Wind", [KEY]: ["a", "b"] });
      await typeIn("topic", "!");
      expect(drafts.at(-1)).toEqual([
        "element:spec:uuid-1",
        { text: "Text", base: "Text", boxes: new Map([["topic", { doc: "Wind!", base: "Wind" }]]) },
      ]);
      await typeIn(KEY, "\nc");
      expect(drafts.at(-1)?.[1]?.boxes?.size).toBe(2);
      await replaceIn("topic", "Wind");
      await replaceIn(KEY, "a\nb");
      expect(drafts.at(-1)).toEqual(["element:spec:uuid-1", undefined]);
    });

    it("shows the boxes of a draft in place of the stored values, and compares them with the file", async () => {
      const draft: Draft = {
        text: "Text",
        base: "Text",
        boxes: new Map([["topic", { doc: "Mine", base: "Wind" }]]),
      };
      const { drafts, echoed } = await mountBoxes({ topic: "Wind", [KEY]: ["a"] }, {}, draft);
      expect(viewOf("topic").state.doc.toString()).toBe("Mine");
      expect(viewOf(KEY).state.doc.toString()).toBe("a");
      expect(drafts).toEqual([]);
      expect(echoed).toEqual([]);
      // The file changed meanwhile: the draft is kept on the new value, and the conflict shows the file's.
      const other = await mountBoxes({ topic: "Gust" }, {}, { ...draft, sha: "sha-0" });
      expect(viewOf("topic").state.doc.toString()).toBe("Mine");
      expect(other.echoed.at(-1)).toBe(
        'SR-000001 (SR-036) Measure wind changed on disk. Resolve with "Resolve change on disk"',
      );
      expect(query('[data-on-disk="topic"]').textContent).toBe("On diskGust");
      expect(other.drafts.at(-1)?.[1]?.boxes?.get("topic")).toEqual({ doc: "Mine", base: "Gust" });
      // The file holds the draft now: nothing is unsaved.
      const same = await mountBoxes({ topic: "Mine" }, {}, draft);
      expect(same.drafts.at(-1)).toEqual(["element:spec:uuid-1", undefined]);
      expect(same.echoed).toEqual([]);
    });

    it("lets a box without input follow the file on a reload, and keeps a box with input and says so", async () => {
      const { again, change, echoed, drafts } = await mountBoxes({ topic: "Wind", [KEY]: ["a"] });
      await typeIn("topic", "!");
      change({ topic: "Gust", [KEY]: ["b"] });
      await again(1);
      expect(viewOf(KEY).state.doc.toString()).toBe("b");
      expect(viewOf("topic").state.doc.toString()).toBe("Wind!");
      expect(echoed.at(-1)).toBe(
        'SR-000001 (SR-036) Measure wind changed on disk. Resolve with "Resolve change on disk"',
      );
      expect(drafts.at(-1)?.[1]?.boxes?.get("topic")).toEqual({ doc: "Wind!", base: "Gust" });
      // Only the field with input has a block; the one that followed the file has none.
      expect(
        [...container.querySelectorAll<HTMLElement>("[data-on-disk]")].map(
          (block) => block.dataset["onDisk"],
        ),
      ).toEqual(["topic"]);
      // A property without input that appears or disappears in the file appears or disappears as a box.
      change({ topic: "Gust", synonyms: ["x"] });
      await again(2);
      expect(container.querySelector(`[data-field="${KEY}"]`)).toBeNull();
      expect(viewOf("synonyms").state.doc.toString()).toBe("x");
    });

    it("does not say the file changed when an unrelated box changed on disk and none was edited", async () => {
      const { again, change, echoed, drafts } = await mountBoxes({ topic: "Wind", [KEY]: ["a"] });
      change({ topic: "Wind", [KEY]: ["b"] });
      await again(1);
      expect(echoed).toEqual([]);
      // (The editor following the file reports its change; there is nothing unsaved.)
      expect(drafts.every(([, kept]) => kept === undefined)).toBe(true);
    });

    it("shows the file text, not the old one, when a draft of boxes alone comes back after the text changed on disk", async () => {
      const draft: Draft = {
        text: "Text",
        base: "Text",
        boxes: new Map([["topic", { doc: "Mine", base: "Wind" }]]),
      };
      const { drafts, echoed } = await mountBoxes({ topic: "Wind" }, { text: "Changed on disk" }, draft);
      expect(editorView().state.doc.toString()).toBe("Changed on disk");
      expect(viewOf("topic").state.doc.toString()).toBe("Mine");
      // The draft is on the new file text, so the next input cannot bring the old text back.
      expect(drafts.at(-1)?.[1]).toEqual({
        text: "Changed on disk",
        base: "Changed on disk",
        boxes: new Map([["topic", { doc: "Mine", base: "Wind" }]]),
      });
      expect(echoed).toEqual([]);
      await typeIn("topic", "!");
      expect(drafts.at(-1)?.[1]).toEqual({
        text: "Changed on disk",
        base: "Changed on disk",
        boxes: new Map([["topic", { doc: "Mine!", base: "Wind" }]]),
      });
    });

    it("keeps the typed text of a draft, on the new file text", async () => {
      const draft: Draft = { text: "Mine", base: "Text", sha: "sha-0" };
      const { drafts, echoed } = await mountBoxes({ topic: "Wind" }, { text: "Changed on disk" }, draft);
      expect(editorView().state.doc.toString()).toBe("Mine");
      expect(drafts.at(-1)?.[1]).toEqual({ text: "Mine", base: "Changed on disk", sha: "sha-0" });
      expect(echoed.at(-1)).toBe(
        'SR-000001 (SR-036) Measure wind changed on disk. Resolve with "Resolve change on disk"',
      );
    });

    it("[SR-106/AK-ydc8] follows a text that changed on disk while only a box has input, keeps the draft on the new text, and stops saving", async () => {
      const { again, change, drafts, echoed } = await mountBoxes({ topic: "Wind" });
      await typeIn("topic", "!");
      change({ topic: "Wind" }, { text: "Changed on disk" });
      await again(1);
      expect(editorView().state.doc.toString()).toBe("Changed on disk");
      expect(viewOf("topic").state.doc.toString()).toBe("Wind!");
      // Spec question ThomasBirkmaier/ReqSeq-archive#488 (1): any change of the file while there is input asks; the block shows the
      // file's value of the box with input, which the change did not touch.
      expect(echoed).toEqual([
        'SR-000001 (SR-036) Measure wind changed on disk. Resolve with "Resolve change on disk"',
      ]);
      expect(query('[data-on-disk="topic"]').textContent).toBe("On diskWind");
      expect(drafts.at(-1)?.[1]).toEqual({
        text: "Changed on disk",
        base: "Changed on disk",
        boxes: new Map([["topic", { doc: "Wind!", base: "Wind" }]]),
      });
    });

    it("[SR-106/AK-ydc8] keeps the box and its input when the file lost its property, and shows that the file has none", async () => {
      const { again, change, echoed, drafts } = await mountBoxes({ topic: "Wind", [KEY]: ["a"] });
      await typeIn("topic", "!");
      change({ [KEY]: ["a"] });
      await again(1);
      expect(viewOf("topic").state.doc.toString()).toBe("Wind!");
      expect(query('[data-on-disk="topic"]').textContent).toBe("On disk(empty)");
      expect(echoed.at(-1)).toBe(
        'SR-000001 (SR-036) Measure wind changed on disk. Resolve with "Resolve change on disk"',
      );
      expect(drafts.at(-1)?.[1]?.boxes?.get("topic")).toEqual({ doc: "Wind!", base: "" });
    });

    it("shows a box that appears again as it is stored, not as the draft it was first shown with", async () => {
      const draft: Draft = {
        text: "Text",
        base: "Text",
        boxes: new Map([["topic", { doc: "Mine", base: "Wind" }]]),
      };
      const { again, change, controls, asked } = await mountBoxes({ topic: "Wind" }, {}, draft);
      expect(viewOf("topic").state.doc.toString()).toBe("Mine");
      change({});
      await again(1);
      // The input stays while the file has no value; taking the file's version empties the box.
      expect(viewOf("topic").state.doc.toString()).toBe("Mine");
      act(() => {
        controls().resolve?.();
      });
      await act(async () => {
        asked.at(-1)?.items[1]?.run();
        await Promise.resolve();
      });
      expect(viewOf("topic").state.doc.toString()).toBe("");
      change({ topic: "Wind" });
      await again(2);
      expect(viewOf("topic").state.doc.toString()).toBe("Wind");
    });

    it("Follow reference in a box that is not Markdown says there is none in it, and does not take the text's", async () => {
      const { controls, opened, echoed } = await mountBoxes(
        { topic: "Wind" },
        { text: "[x](reqseq:uuid-2)" },
      );
      await caretAt(viewOf("topic"), 1);
      act(() => {
        controls().follow();
      });
      expect(opened).toEqual([]);
      expect(echoed.at(-1)).toBe("No element reference in topic");
    });

    it("Enter in a single value leaves the box, Enter in a list starts a new value at the caret", async () => {
      await mountBoxes({ topic: "Wind", [KEY]: ["ab"] });
      const topic = field("topic");
      const content = (key: string): Element => query(`[data-field="${key}"] .cm-content`);
      await press(content("topic"), "Enter");
      expect(document.activeElement).toBe(topic);
      expect(viewOf("topic").state.doc.toString()).toBe("Wind");
      // Shift+Enter is Enter: no key puts a line break inside a value.
      await press(content("topic"), "Enter", { shiftKey: true });
      expect(viewOf("topic").state.doc.toString()).toBe("Wind");
      // In a list: a new value, split at the caret.
      act(() => {
        viewOf(KEY).dispatch({ selection: { anchor: 1 } });
      });
      await press(content(KEY), "Enter");
      expect(viewOf(KEY).state.doc.toString()).toBe("a\nb");
      await press(content(KEY), "Enter", { shiftKey: true });
      expect(viewOf(KEY).state.doc.toString()).toBe("a\n\nb");
    });

    it("Escape leaves a box for the box itself, and Escape on the box for the buffer; Enter on the box edits it", async () => {
      await mountBoxes({ topic: "Wind" });
      const topic = field("topic");
      const content = query('[data-field="topic"] .cm-content');
      await press(content, "Escape");
      expect(document.activeElement).toBe(topic);
      await press(topic, "Escape");
      expect(document.activeElement).toBe(query("article"));
      act(() => {
        topic.focus();
      });
      await press(topic, "Enter");
      expect(viewOf("topic").hasFocus).toBe(true);
      expect(viewOf("topic").state.selection.main.head).toBe(4);
    });

    it("Enter on the title or on a box that is not edited at all edits the text, as before", async () => {
      await mountBoxes({ unknown: "x" });
      act(() => {
        field("unknown").focus();
      });
      await press(field("unknown"), "Enter");
      expect(editorView().hasFocus).toBe(true);
      act(() => {
        field("Title").focus();
      });
      await press(field("Title"), "Enter");
      expect(editorView().hasFocus).toBe(true);
    });

    it("gives each box one Tab stop: the box itself, not its editor", async () => {
      await mountBoxes({ topic: "Wind" });
      expect(field("topic").getAttribute("tabindex")).toBe("0");
      expect(field("topic").querySelectorAll('[tabindex="0"]')).toHaveLength(0);
      expect(field("topic").querySelector(".cm-content")?.getAttribute("tabindex")).toBe("-1");
    });

    it("moves with Down and Up between the text and the boxes, from the last and the first line", async () => {
      await mountBoxes({ topic: "Wind", [KEY]: ["a", "b"] });
      const content = (key: string): Element => query(`[data-field="${key}"] .cm-content`);
      act(() => {
        editorView().dispatch({ selection: { anchor: 4 } });
      });
      await press(query(".cm-content"), "ArrowDown");
      expect(viewOf("topic").hasFocus).toBe(true);
      expect(viewOf("topic").state.selection.main.head).toBe(0);
      await press(content("topic"), "ArrowDown");
      expect(viewOf(KEY).hasFocus).toBe(true);
      expect(viewOf(KEY).state.selection.main.head).toBe(0);
      // On the last line of the last box there is nowhere to go: the key is the editor's.
      await caretAt(viewOf(KEY), 3);
      await press(content(KEY), "ArrowDown");
      expect(viewOf(KEY).hasFocus).toBe(true);
      await caretAt(viewOf(KEY), 0);
      await press(content(KEY), "ArrowUp");
      expect(viewOf("topic").hasFocus).toBe(true);
      expect(viewOf("topic").state.selection.main.head).toBe(4);
      await press(content("topic"), "ArrowUp");
      expect(editorView().hasFocus).toBe(true);
      expect(editorView().state.selection.main.head).toBe(4);
    });

    it("leaves Down to the editor when the element has no box", async () => {
      await mountBoxes({});
      await press(query(".cm-content"), "ArrowDown");
      expect(editorView().state.selection.main.head).toBe(4);
    });

    it("moves between the fields that are not edited with Down and Up, without starting to edit, and skips what cannot take the focus", async () => {
      await mountBoxes({ topic: "Wind", area: "performance", [KEY]: ["a"] });
      act(() => {
        field("Title").focus();
      });
      await press(field("Title"), "ArrowDown");
      expect(editorView().hasFocus).toBe(true);
      await press(query(".cm-content"), "Escape");
      act(() => {
        field("topic").focus();
      });
      await press(field("topic"), "ArrowDown");
      expect(document.activeElement).toBe(field("area"));
      await press(field("area"), "ArrowDown");
      expect(document.activeElement).toBe(field(KEY));
      expect(viewOf(KEY).hasFocus).toBe(false);
      await press(field(KEY), "ArrowUp");
      expect(document.activeElement).toBe(field("area"));
      await press(field("area"), "ArrowUp");
      expect(document.activeElement).toBe(field("topic"));
      // Up from the first box goes into the text; from the title nowhere.
      await press(field("topic"), "ArrowUp");
      expect(editorView().hasFocus).toBe(true);
      act(() => {
        field("Title").focus();
      });
      await press(field("Title"), "ArrowUp");
      expect(document.activeElement).toBe(field("Title"));
      // Down from the last box has nowhere to go (a package page goes into its elements).
      act(() => {
        field(KEY).focus();
      });
      await press(field(KEY), "ArrowDown");
      expect(document.activeElement).toBe(field(KEY));
    });

    it("skips the text of a read-only element on the way down from the title", async () => {
      await mountBoxes({ topic: "Wind" }, { readOnly: true });
      act(() => {
        field("Title").focus();
      });
      await press(field("Title"), "ArrowDown");
      expect(document.activeElement).toBe(field("topic"));
    });

    it("copies what the editor of a box holds, the unsaved input included, one value per line", async () => {
      const { copies } = await mountBoxes({ [KEY]: ["a", "b"], area: "performance" });
      await typeIn(KEY, "\nc");
      await click(query(`[data-field="${KEY}"] > .copy`));
      await click(query('[data-field="area"] > .copy'));
      expect(copies).toEqual([
        [KEY, "a\nb\nc"],
        ["area", "performance"],
      ]);
    });

    describe("choices, relations, adding and clearing", () => {
      const stage = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
        kind: "packages",
        property: true,
        direction: "out",
        id,
        repository: "spec",
        shortId: `PKG-${id}`,
        title,
        accessible: true,
        targetState: "available",
        ...extra,
      });
      const withStages = (...stages: ReturnType<typeof stage>[]) => ({
        properties: { packages: stages.map(({ id }) => ({ id })), topic: "Wind" },
        more: { relations: stages as unknown as DataExportElement["relations"] },
      });
      const lines = (key: string): string[] => texts(`[data-field="${key}"] .line`);
      const rows = (key: string): string[] => texts(`[data-field="${key}"] .relation`);
      // (happy-dom answers a selection set on a focused editor with an event inside the update: let go first.)
      const blur = (): void => {
        act(() => {
          (document.activeElement as HTMLElement | null)?.blur();
        });
      };
      const focusField = (key: string): void => {
        act(() => {
          field(key).focus();
        });
      };
      /** Takes the entry of the prompt with this name, as Enter in the minibuffer does. */
      const take = async (prompt: Prompt | undefined, name: string): Promise<void> => {
        const item = prompt?.items.find((candidate) => candidate.name === name);
        expect(item, name).toBeDefined();
        await act(async () => {
          item?.run();
          await Promise.resolve();
        });
        await flush();
      };
      const names = (prompt: Prompt | undefined): string[] => prompt?.items.map((item) => item.name) ?? [];
      /** `mountBoxes` with an answer of `element.update` that the test checks and a search for elements. */
      const mountValues = async (
        properties: Record<string, unknown>,
        more: Partial<DataExportElement> = {},
        draft?: Draft,
        update?: (input: Record<string, unknown>) => unknown,
      ) => {
        const mounted = await mountBoxes(properties, more, draft, update);
        return mounted;
      };

      it("[SR-104/AK-df5n] shows a relation property as a box with its targets as links, and no empty one", async () => {
        const first = withStages(stage("p1", "Stufe 3"), stage("p2", "Stufe 4", { targetState: "missing" }));
        const { targets } = await mountValues(first.properties, first.more);
        expect(rows("packages")).toEqual(["PKG-p1 Stufe 3", "PKG-p2 Stufe 4 missing"]);
        expect(texts("h2")).toEqual([]);
        await click(query('[data-field="packages"] [role="link"]'));
        expect(targets).toEqual(["element:spec:p1"]);
        await mountValues({ topic: "Wind", packages: [] });
        expect(container.querySelector('[data-field="packages"]')).toBeNull();
      });

      it("[SR-104/AK-k13x] Add property lists the properties the element lacks, by name; a text property gets an empty box with the caret in it, and no draft", async () => {
        const { controls, asked, drafts } = await mountValues({ topic: "Wind" });
        act(() => {
          controls().addProperty();
        });
        expect(asked.at(-1)?.label).toBe("Add property");
        expect(names(asked.at(-1))).toEqual([KEY, "effort", "synonyms", "Area", "Tags", "Package", "Parent"]);
        await take(asked.at(-1), KEY);
        // At its place in the order of the type, after topic.
        expect(
          [...container.querySelectorAll<HTMLElement>("[data-field]")].map((f) => f.dataset["field"]),
        ).toEqual(["Title", "Text", "topic", KEY]);
        expect(viewOf(KEY).state.doc.toString()).toBe("");
        expect(viewOf(KEY).hasFocus).toBe(true);
        expect(container.contains(document.activeElement)).toBe(true);
        expect(field(KEY).contains(document.activeElement)).toBe(true);
        // An empty box is no draft.
        expect(drafts.filter(([, kept]) => kept !== undefined)).toEqual([]);
      });

      it("[SR-104/AK-k13x] saves what is typed into an added box with set, and the box is then the stored one", async () => {
        const { controls, asked, call, drafts } = await mountValues({ topic: "Wind" }, {}, undefined, () =>
          savedWith({ topic: "Wind", [KEY]: ["first"] }),
        );
        act(() => {
          controls().addProperty();
        });
        await take(asked.at(-1), KEY);
        blur();
        await typeIn(KEY, "first");
        expect(drafts.at(-1)?.[1]?.boxes?.get(KEY)).toEqual({ doc: "first", base: "" });
        await save(controls);
        expect(updates(call)).toEqual([{ ref: "uuid-1", set: { [KEY]: ["first"] } }]);
        expect(drafts.at(-1)).toEqual(["element:spec:uuid-1", undefined]);
        expect(viewOf(KEY).state.doc.toString()).toBe("first");
      });

      it("[SR-104/AK-k13x] Add property for a choice puts the empty box in the page with the focus on it, and opens the prompt with the choices at once", async () => {
        const { controls, asked, drafts } = await mountValues({ topic: "Wind" });
        act(() => {
          controls().addProperty();
        });
        await take(asked.at(-1), "Area");
        expect(field("area")).not.toBeNull();
        expect(lines("area")).toEqual([]);
        expect(document.activeElement).toBe(field("area"));
        expect(asked.at(-1)?.label).toBe("Area");
        expect(names(asked.at(-1))).toEqual(["Quality", "Performance", "Interface"]);
        // Escape on the prompt: the focus is on the new box, not on the element, and the box is empty.
        act(() => {
          asked.at(-1)?.cancel?.();
        });
        expect(document.activeElement).toBe(field("area"));
        expect(lines("area")).toEqual([]);
        expect(drafts.filter(([, kept]) => kept !== undefined)).toEqual([]);
      });

      it("[SR-104/AK-k13x] Add property for a relation opens the prompt with the search of the allowed types at once", async () => {
        const { controls, asked } = await mountValues({ topic: "Wind" });
        act(() => {
          controls().addProperty();
        });
        await take(asked.at(-1), "Package");
        expect(asked.at(-1)?.label).toBe("Package");
        expect(asked.at(-1)?.items).toEqual([]);
        expect(asked.at(-1)?.find).toBeDefined();
        expect(document.activeElement).toBe(field("packages"));
      });

      it("[SR-104/AK-k13x] drops an added box that was left empty when the element is saved", async () => {
        const { controls, asked } = await mountValues({ topic: "Wind" }, {}, undefined, () =>
          savedWith({ topic: "Wind!" }),
        );
        act(() => {
          controls().addProperty();
        });
        await take(asked.at(-1), "Area");
        await typeIn("topic", "!");
        await save(controls);
        expect(container.querySelector('[data-field="area"]')).toBeNull();
      });

      it("[SR-104/AK-k13x] keeps an added box that was typed in while the save ran, as an added box with its input", async () => {
        let answer: (value: unknown) => void = () => undefined;
        const call = vi.fn((name: string, input: Record<string, unknown>) =>
          name === "element.update"
            ? new Promise((resolve) => {
                answer = resolve;
              })
            : Promise.resolve({
                ok: true,
                output:
                  name === "trace.neighbourhood"
                    ? alone(input)
                    : (NO_SUMMARY[name]?.() ?? { element: withProperties({ topic: "Wind" }) }),
              }),
        );
        await fresh();
        const { controls, asked, drafts } = await mount(asCall(call as never), 0, undefined, {
          properties: model,
        });
        act(() => {
          controls().addProperty();
        });
        await take(asked.at(-1), KEY);
        blur();
        await typeIn("topic", "!");
        await act(async () => {
          controls().save();
          await Promise.resolve();
        });
        await typeIn(KEY, "late");
        await act(async () => {
          answer({ ok: true, output: savedWith({ topic: "Wind!" }) });
          await Promise.resolve();
        });
        await flush();
        expect(viewOf(KEY).state.doc.toString()).toBe("late");
        expect(drafts.at(-1)?.[1]?.boxes?.get(KEY)).toEqual({ doc: "late", base: "" });
      });

      it("[SR-104/AK-k13x] says that a read-only element has no property to add, and when there is none to add", async () => {
        const read = await mountValues({ topic: "Wind" }, { readOnly: true });
        act(() => {
          read.controls().addProperty();
        });
        expect(read.echoed.at(-1)).toBe("SR-000001 (SR-036) Measure wind is read-only");
        expect(read.asked).toEqual([]);
        const none = await mountValues({ topic: "Wind" }, { type: "other" });
        act(() => {
          none.controls().addProperty();
        });
        expect(none.echoed.at(-1)).toBe("No property to add");
        expect(none.asked).toEqual([]);
        // A key stored empty is offered, because no box shows it.
        const empty = await mountValues({ topic: "", [KEY]: [] });
        act(() => {
          empty.controls().addProperty();
        });
        expect(names(empty.asked.at(-1)).slice(0, 2)).toEqual(["topic", KEY]);
      });

      it("[SR-104/AK-n97r] Enter on a choice box asks with only the choices, and the one taken is the value of the box; the focus comes back to the box", async () => {
        const { asked, drafts, controls, call } = await mountValues(
          { area: "performance", topic: "t" },
          {},
          undefined,
          () => savedWith({ area: "quality", topic: "t" }),
        );
        focusField("area");
        await press(field("area"), "Enter");
        expect(asked.at(-1)?.label).toBe("Area");
        expect(asked.at(-1)?.text).toBeUndefined();
        // The one that is set first with its hint, then the others.
        expect(names(asked.at(-1))).toEqual(["Performance", "Quality", "Interface"]);
        expect(asked.at(-1)?.items.map((item) => item.hint)).toEqual(["set", "quality", "interface"]);
        focusField("topic");
        await take(asked.at(-1), "Quality");
        expect(lines("area")).toEqual(["quality"]);
        expect(document.activeElement).toBe(field("area"));
        expect(drafts.at(-1)?.[1]?.boxes?.get("area")).toEqual({ doc: "quality", base: "performance" });
        await save(controls);
        expect(updates(call)).toEqual([{ ref: "uuid-1", set: { area: "quality" } }]);
        expect(lines("area")).toEqual(["quality"]);
        expect(drafts.at(-1)).toEqual(["element:spec:uuid-1", undefined]);
      });

      it("[SR-104/AK-n97r] shows exactly the choices of the metamodel and sets a value of a list one at a time, a set one is taken out", async () => {
        const { asked } = await mountValues({ tags: ["a"], topic: "t" });
        focusField("tags");
        await press(field("tags"), "Enter");
        expect(names(asked.at(-1))).toEqual(["Alpha", "Beta"]);
        await take(asked.at(-1), "Beta");
        expect(lines("tags")).toEqual(["a", "b"]);
        await press(field("tags"), "Enter");
        expect(asked.at(-1)?.items.map((item) => item.hint)).toEqual(["set", "set"]);
        await take(asked.at(-1), "Alpha");
        expect(lines("tags")).toEqual(["b"]);
      });

      it("Enter on a choice or relation box of a read-only element says so and asks nothing", async () => {
        const { asked, echoed } = await mountValues({ area: "performance" }, { readOnly: true });
        focusField("area");
        await press(field("area"), "Enter");
        expect(asked).toEqual([]);
        expect(echoed.at(-1)).toBe("SR-000001 (SR-036) Measure wind is read-only");
      });

      it("Enter on a relation box asks with the targets that are set and the elements of the allowed types", async () => {
        const first = withStages(stage("p1", "Stufe 3"));
        const { asked, call } = await mountValues(first.properties, first.more);
        call.mockImplementation((name: string, input: Record<string, unknown>) =>
          Promise.resolve({
            ok: true,
            output:
              name === "element.search"
                ? {
                    hits: [
                      {
                        id: "p2",
                        repository: "spec",
                        shortId: "PKG-p2",
                        type: "package",
                        title: "Stufe 4",
                        score: 1,
                        fields: ["title"],
                        terms: ["stufe"],
                      },
                    ],
                    total: 1,
                  }
                : name === "trace.neighbourhood"
                  ? alone(input)
                  : { element: withProperties(first.properties, first.more) },
          }),
        );
        focusField("packages");
        await press(field("packages"), "Enter");
        const prompt = asked.at(-1);
        expect(prompt?.label).toBe("Package");
        expect(names(prompt)).toEqual(["PKG-p1 Stufe 3"]);
        expect(prompt?.items[0]?.hint).toBe("set");
        const found = await prompt?.find?.("stufe");
        expect(call).toHaveBeenCalledWith("element.search", {
          query: "stufe",
          selection: { where: { type: ["package"] } },
          fields: ["id", "title"],
          limit: 20,
        });
        expect(found?.map((choice) => choice.name)).toEqual(["PKG-p2 Stufe 4"]);
        await take({ label: "x", items: found ?? [] }, "PKG-p2 Stufe 4");
        expect(rows("packages")).toEqual(["PKG-p1 Stufe 3", "PKG-p2 Stufe 4"]);
        expect(document.activeElement).toBe(field("packages"));
      });

      it("keeps a relation box read-only and says so when the file stores an item the output gives no target for", async () => {
        const first = withStages(stage("p1", "Stufe 3"));
        const { asked, controls, call, echoed } = await mountValues(
          { ...first.properties, packages: [{ id: "p1" }, "not a reference"] },
          first.more,
        );
        const prompts = asked.length;
        focusField("packages");
        expect(echoed.at(-1)).toBe("packages has a target that cannot be read: edit it in the file");
        echoed.length = 0;
        await press(field("packages"), "Enter");
        expect(asked.length).toBe(prompts);
        expect(echoed.at(-1)).toBe("packages has a target that cannot be read: edit it in the file");
        echoed.length = 0;
        act(() => {
          controls().clearProperty();
        });
        expect(echoed.at(-1)).toBe("packages has a target that cannot be read: edit it in the file");
        expect(rows("packages")).toEqual(["PKG-p1 Stufe 3"]);
        await save(controls);
        expect(updates(call)).toEqual([]);
      });

      it("saves the targets of a relation as id and repository, the stored ones too, and takes one out with the prompt", async () => {
        const first = withStages(stage("p1", "Stufe 3"), stage("p2", "Stufe 4"));
        const { asked, controls, call } = await mountValues(first.properties, first.more, undefined, () =>
          savedWith({ topic: "Wind" }),
        );
        focusField("packages");
        await press(field("packages"), "Enter");
        await take(asked.at(-1), "PKG-p1 Stufe 3");
        expect(rows("packages")).toEqual(["PKG-p2 Stufe 4"]);
        await save(controls);
        expect(updates(call)).toEqual([
          { ref: "uuid-1", set: { packages: [{ id: "p2", repository: "spec" }] } },
        ]);
      });

      it("a single relation is replaced by the element taken", async () => {
        const single = {
          properties: { parent: [{ id: "n1" }], topic: "t" },
          more: {
            relations: [stage("n1", "Need", { kind: "parent" })] as unknown as DataExportElement["relations"],
          },
        };
        const { asked, controls, call } = await mountValues(single.properties, single.more, undefined, () =>
          savedWith({ topic: "t" }),
        );
        call.mockImplementation((name: string, input: Record<string, unknown>) =>
          Promise.resolve({
            ok: true,
            output:
              name === "element.search"
                ? {
                    hits: [
                      {
                        id: "n2",
                        repository: "vault",
                        shortId: "N-2",
                        type: "need",
                        title: "Other",
                        score: 1,
                        fields: ["title"],
                        terms: [],
                      },
                    ],
                    total: 1,
                  }
                : name === "trace.neighbourhood"
                  ? alone(input)
                  : name === "element.update"
                    ? savedWith({ topic: "t" })
                    : (NO_SUMMARY[name]?.() ?? { element: withProperties(single.properties, single.more) }),
          }),
        );
        focusField("parent");
        await press(field("parent"), "Enter");
        // No target type: the search is not limited.
        const found = await asked.at(-1)?.find?.("other");
        expect(call).toHaveBeenCalledWith("element.search", {
          query: "other",
          fields: ["id", "title"],
          limit: 20,
        });
        await take({ label: "x", items: found ?? [] }, "N-2 Other");
        expect(rows("parent")).toEqual(["N-2 Other"]);
        await save(controls);
        expect(updates(call)).toEqual([
          { ref: "uuid-1", set: { parent: { id: "n2", repository: "vault" } } },
        ]);
      });

      it("has no search when the property may point at no type", async () => {
        const none = new Map(model);
        none.set(
          "system-requirement",
          new Map([
            ["packages", { kind: "relation" as const, many: true, markdown: false, targetTypes: [] }],
            ["topic", { kind: "text" as const, many: false, markdown: false }],
          ]),
        );
        const first = withStages(stage("p1", "Stufe 3"));
        const call = fakeCall({
          "element.get": () => ({ element: withProperties(first.properties, first.more) }),
        });
        await fresh();
        const { asked } = await mount(asCall(call), 0, undefined, { properties: none });
        focusField("packages");
        await press(field("packages"), "Enter");
        expect(asked.at(-1)?.find).toBeUndefined();
        expect(names(asked.at(-1))).toEqual(["PKG-p1 Stufe 3"]);
      });

      it("[SR-104/AK-sxnr] Clear property empties the box with the cursor, for a choice, a relation and a text, and the properties are removed when it is saved", async () => {
        const first = withStages(stage("p1", "Stufe 3"));
        const { controls, call, drafts } = await mountValues(
          { ...first.properties, area: "performance", [KEY]: ["a", "b"] },
          first.more,
          undefined,
          (input) => {
            expect(input).toEqual({ ref: "uuid-1", unset: ["packages", "area", KEY] });
            return savedWith({ topic: "Wind" });
          },
        );
        focusField("area");
        act(() => {
          controls().clearProperty();
        });
        expect(lines("area")).toEqual([]);
        focusField("packages");
        act(() => {
          controls().clearProperty();
        });
        expect(rows("packages")).toEqual([]);
        act(() => {
          field(KEY).focus();
        });
        act(() => {
          controls().clearProperty();
        });
        expect(viewOf(KEY).state.doc.toString()).toBe("");
        // The boxes stay, empty, until the save.
        expect(container.querySelector('[data-field="area"]')).not.toBeNull();
        expect(drafts.at(-1)?.[1]?.boxes?.get("area")).toEqual({ doc: "", base: "performance" });
        await save(controls);
        expect(updates(call)).toHaveLength(1);
        for (const key of ["area", "packages", KEY]) {
          expect(container.querySelector(`[data-field="${key}"]`), key).toBeNull();
        }
        expect(drafts.at(-1)).toEqual(["element:spec:uuid-1", undefined]);
      });

      it("[SR-104/AK-sxnr] Clear property from the command prompt empties the box the cursor was in", async () => {
        const { controls } = await mountValues({ area: "performance" });
        focusField("area");
        // The command prompt has the focus now.
        const input = document.createElement("input");
        input.id = "prompt-input";
        document.body.append(input);
        act(() => {
          input.focus();
        });
        act(() => {
          controls().clearProperty();
        });
        input.remove();
        expect(lines("area")).toEqual([]);
        expect(document.activeElement).toBe(field("area"));
      });

      it("empties a text box so that Ctrl/Cmd+Z brings the value back", async () => {
        const { controls } = await mountValues({ topic: "Wind" });
        focusField("topic");
        act(() => {
          controls().clearProperty();
        });
        expect(viewOf("topic").state.doc.toString()).toBe("");
        await act(async () => {
          undo(viewOf("topic"));
          await Promise.resolve();
        });
        expect(viewOf("topic").state.doc.toString()).toBe("Wind");
      });

      it("Clear property says why it cannot clear: no box, a read-only element, a value that is no text, a value with a line break", async () => {
        const { controls, echoed } = await mountValues({
          topic: "Wind",
          effort: { nested: true },
          [KEY]: ["one\ntwo"],
        });
        act(() => {
          controls().clearProperty();
        });
        expect(echoed.at(-1)).toBe("Put the cursor in a property box to clear it");
        focusField("Title");
        act(() => {
          controls().clearProperty();
        });
        expect(echoed.at(-1)).toBe("Put the cursor in a property box to clear it");
        focusField("effort");
        act(() => {
          controls().clearProperty();
        });
        expect(echoed.at(-1)).toBe("effort cannot be edited here: edit it in the file");
        focusField(KEY);
        act(() => {
          controls().clearProperty();
        });
        expect(echoed.at(-1)).toBe(`${KEY} has a value with a line break: edit it in the file`);
        expect(viewOf(KEY).state.doc.toString()).toBe("one\ntwo");
        const locked = await mountValues({ topic: "Wind" }, { readOnly: true });
        focusField("topic");
        act(() => {
          locked.controls().clearProperty();
        });
        expect(locked.echoed.at(-1)).toBe("SR-000001 (SR-036) Measure wind is read-only");
      });

      it("[SR-104/AK-sxnr] Clear property empties a property the type does not know, which has no editor; Ctrl/Cmd+Z brings it back, and the save removes it with unset (#189)", async () => {
        const { controls, call, drafts } = await mountValues(
          { topic: "Wind", legacy: ["a", "b"] },
          {},
          undefined,
          (input) => {
            expect(input).toEqual({ ref: "uuid-1", unset: ["legacy"] });
            return savedWith({ topic: "Wind" });
          },
        );
        expect(lines("legacy")).toEqual(["a", "b"]);
        // No editor to type in: the box is only emptied.
        expect(field("legacy").querySelector(".cm-editor")).toBeNull();
        focusField("legacy");
        act(() => {
          controls().clearProperty();
        });
        expect(lines("legacy")).toEqual([]);
        expect(drafts.at(-1)?.[1]?.boxes?.get("legacy")).toEqual({ doc: "", base: "a\nb" });
        await press(field("legacy"), "z", { ctrlKey: true });
        expect(lines("legacy")).toEqual(["a", "b"]);
        act(() => {
          controls().clearProperty();
        });
        expect(lines("legacy")).toEqual([]);
        await save(controls);
        expect(updates(call)).toHaveLength(1);
        expect(container.querySelector('[data-field="legacy"]')).toBeNull();
        expect(drafts.at(-1)).toEqual(["element:spec:uuid-1", undefined]);
      });

      it("keeps a cleared property the type does not know in a draft and shows it empty when the buffer comes back (#189)", async () => {
        const draft: Draft = {
          text: "Text",
          base: "Text",
          boxes: new Map([["legacy", { doc: "", base: "Altlast" }]]),
        };
        await mountValues({ topic: "t", legacy: "Altlast" }, {}, draft);
        expect(container.querySelector('[data-field="legacy"]')).not.toBeNull();
        expect(lines("legacy")).toEqual([]);
      });

      it("does not clear a box with Backspace or Delete on the box itself: only the action does (no undo for it)", async () => {
        await mountValues({ area: "performance" });
        focusField("area");
        await press(field("area"), "Backspace");
        await press(field("area"), "Delete");
        expect(lines("area")).toEqual(["performance"]);
      });

      it("keeps the choices and the added boxes of a draft, shows them, and compares them with the file", async () => {
        const draft: Draft = {
          text: "Text",
          base: "Text",
          boxes: new Map([
            ["area", { doc: "quality", base: "performance" }],
            ["effort", { doc: "3", base: "" }],
            ["tags", { doc: "a\nb", base: "" }],
            // A property the type does not have (the metamodel changed meanwhile) has no box to come back to.
            ["nothing", { doc: "x", base: "" }],
          ]),
        };
        const { echoed, drafts } = await mountValues({ area: "performance", topic: "t" }, {}, draft);
        expect(lines("area")).toEqual(["quality"]);
        expect(lines("tags")).toEqual(["a", "b"]);
        expect(viewOf("effort").state.doc.toString()).toBe("3");
        expect(echoed).toEqual([]);
        expect(drafts).toEqual([]);
        // The added boxes are where the type puts them.
        expect(
          [...container.querySelectorAll<HTMLElement>("[data-field]")].map((f) => f.dataset["field"]),
        ).toEqual(["Title", "Text", "effort", "area", "topic", "tags"]);
      });

      it("lets a choice box without input follow the file on a reload, and keeps one with input and says so", async () => {
        const { again, change, echoed } = await mountValues({ area: "performance", tags: ["a"] });
        focusField("area");
        await press(field("area"), "Enter");
        change({ area: "interface", tags: ["b"] });
        await again(1);
        // The box without input follows the file at once.
        expect(lines("tags")).toEqual(["b"]);
        expect(lines("area")).toEqual(["interface"]);
        expect(echoed).toEqual([]);
      });

      it("keeps the choice that was set in the minibuffer when the file changed, and says so", async () => {
        const { again, change, echoed, asked } = await mountValues({ area: "performance", tags: ["a"] });
        focusField("area");
        await press(field("area"), "Enter");
        await take(asked.at(-1), "Quality");
        change({ area: "interface", tags: ["b"] });
        await again(1);
        expect(lines("area")).toEqual(["quality"]);
        expect(lines("tags")).toEqual(["b"]);
        expect(echoed.at(-1)).toBe(
          'SR-000001 (SR-036) Measure wind changed on disk. Resolve with "Resolve change on disk"',
        );
        // The block shows the name of the file's choice, in heavier weight: the input lacks it.
        expect(query('[data-on-disk="area"] mark').textContent).toBe("Interface");
        // A property that left the file keeps its box while it has input.
        change({ tags: ["b"] });
        await again(2);
        expect(lines("area")).toEqual(["quality"]);
        expect(query('[data-on-disk="area"]').textContent).toBe("On disk(empty)");
      });

      it("keeps an added box through a reload while the file has no value for it, and shows the stored value once it has", async () => {
        const { again, change, controls, asked } = await mountValues({ topic: "Wind" });
        act(() => {
          controls().addProperty();
        });
        await take(asked.at(-1), "Tags");
        await again(1);
        expect(container.querySelector('[data-field="tags"]')).not.toBeNull();
        change({ topic: "Wind", tags: ["a"] });
        await again(2);
        expect(lines("tags")).toEqual(["a"]);
      });

      it("Follow reference in a relation box opens the focused target, else the first one; a box with none to open says so", async () => {
        const first = withStages(stage("p1", "Stufe 3"), stage("p2", "Stufe 4"));
        const { controls, targets } = await mountValues(first.properties, first.more);
        focusField("packages");
        act(() => {
          controls().follow();
        });
        const links = [...container.querySelectorAll<HTMLElement>('[data-field="packages"] [role="link"]')];
        act(() => {
          links[1]?.focus();
        });
        act(() => {
          controls().follow();
        });
        expect(targets).toEqual(["element:spec:p1", "element:spec:p2"]);
        const gone = withStages(stage("p1", "Stufe 3", { targetState: "missing" }));
        const other = await mountValues(gone.properties, gone.more);
        focusField("packages");
        act(() => {
          other.controls().follow();
        });
        expect(other.targets).toEqual([]);
        expect(other.echoed.at(-1)).toBe("No element reference in packages");
        // A relation property the type does not know is a read-only box with links, and Follow reference opens its target.
        const unknown = withStages(stage("x1", "Fremd", { kind: "stray" }));
        const stray = await mountValues({ stray: [{ id: "x1" }] }, unknown.more);
        expect(stray.asked).toEqual([]);
        focusField("stray");
        act(() => {
          stray.controls().follow();
        });
        expect(stray.targets).toEqual(["element:spec:x1"]);
      });

      it("copies the targets of a relation box and the keys of a choice, the unsaved input included", async () => {
        const first = withStages(stage("p1", "Stufe 3"), stage("p2", "Stufe 4"));
        const { copies, asked } = await mountValues({ ...first.properties, tags: ["a"] }, first.more);
        focusField("tags");
        await press(field("tags"), "Enter");
        await take(asked.at(-1), "Beta");
        focusField("packages");
        await press(field("packages"), "Enter");
        await take(asked.at(-1), "PKG-p1 Stufe 3");
        await click(query('[data-field="tags"] > .copy'));
        await click(query('[data-field="packages"] > .copy'));
        await press(field("packages"), "Enter");
        expect(copies).toEqual([
          ["tags", "a\nb"],
          ["packages", "PKG-p2 Stufe 4"],
        ]);
      });
    });

    describe("the list of the elements with a value (SR-132)", () => {
      const facetsOf = (topic: string) => ({
        total: 1,
        types: [{ key: "system-requirement", name: "System Requirement", count: 1 }],
        statuses: [{ key: "draft", count: 1 }],
        properties: [
          { key: KEY, name: "Acceptance criteria", kind: "text", count: 1, missing: 0, distinct: 2 },
          {
            key: "topic",
            name: "Topic",
            kind: "text",
            count: 1,
            missing: 0,
            distinct: 1,
            values: [{ value: topic, count: 1 }],
          },
          {
            key: "synonyms",
            name: "Synonyms",
            kind: "text",
            count: 1,
            missing: 0,
            distinct: 2,
            values: [
              { value: "gust", count: 1 },
              { value: "breeze", count: 1 },
            ],
          },
          {
            key: "area",
            name: "Area",
            kind: "choice",
            count: 1,
            missing: 0,
            distinct: 1,
            values: [{ value: "quality", count: 1, name: "Quality" }],
          },
          {
            key: "packages",
            name: "Package",
            kind: "relation",
            count: 1,
            missing: 0,
            distinct: 2,
            values: [
              { value: "PKG-p1", count: 1, title: "Stufe 3" },
              { value: "PKG-p2", count: 1, title: "Stufe 4", identifier: "Stufe-4" },
            ],
          },
        ],
        incomplete: false,
      });
      const target = (id: string, title: string) => ({
        kind: "packages",
        property: true,
        direction: "out",
        id,
        repository: "spec",
        shortId: `PKG-${id}`,
        title,
        accessible: true,
        targetState: "available",
      });
      const PROPERTIES = {
        topic: "Wind",
        [KEY]: ["first", "second"],
        synonyms: ["gust", "breeze"],
        area: "quality",
        packages: [{ id: "p1" }, { id: "p2" }],
      };
      const RELATIONS = [
        target("p1", "Stufe 3"),
        target("p2", "Stufe 4"),
      ] as unknown as DataExportElement["relations"];
      /** The element with every kind of box; `facets` answers `element.facets`, `update` a save. */
      const mountListing = async (
        facets: (input: Record<string, unknown>) => unknown = () => facetsOf("Wind"),
        update?: (input: Record<string, unknown>) => unknown,
      ) => {
        let properties: Record<string, unknown> = PROPERTIES;
        const call = fakeCall({
          "element.get": () => ({ element: withProperties(properties, { relations: RELATIONS }) }),
          "element.facets": facets,
          ...(update === undefined ? {} : { "element.update": update }),
        });
        await fresh();
        const mounted = await mount(asCall(call), 0, undefined, { properties: model });
        await flush();
        return {
          ...mounted,
          call,
          change: (next: Record<string, unknown>) => {
            properties = next;
          },
        };
      };
      const listValue = async (controls: () => ElementControls): Promise<void> => {
        await act(async () => {
          controls().listValue();
          await Promise.resolve();
        });
        await flush();
        await flush();
      };
      const opened = (key: string, shown: string, value: string) => ({
        type: "open",
        buffer: filteredList([propertyStep(key, shown, value)]),
      });
      const facetCalls = (call: ReturnType<typeof fakeCall>) =>
        call.mock.calls.filter(([name]) => name === "element.facets").map(([, input]) => input);
      const blurAll = (): void => {
        act(() => {
          (document.activeElement as HTMLElement | null)?.blur();
        });
      };

      it("[SR-132/AK-y207] the key on the topic box opens the list of the elements with that topic", async () => {
        const { controls, dispatched, call } = await mountListing();
        await caretAt(viewOf("topic"), 0);
        await listValue(controls);
        expect(dispatched.at(-1)).toEqual(opened("topic", "Wind", "Wind"));
        expect(facetCalls(call)).toEqual([{ selection: { ids: ["SR-000001"] } }]);
        blurAll();
      });

      it("[SR-132/AK-ymp3] a list property opens the value on the line with the caret; the box as a whole asks among its values", async () => {
        const { controls, dispatched, asked } = await mountListing();
        await caretAt(viewOf("synonyms"), "gust\nbr".length);
        await listValue(controls);
        expect(dispatched.at(-1)).toEqual(opened("synonyms", "breeze", "breeze"));
        blurAll();
        act(() => {
          field("synonyms").focus();
        });
        await listValue(controls);
        expect(asked.at(-1)?.label).toBe("Elements with");
        expect(asked.at(-1)?.items.map((item) => item.name)).toEqual(["synonyms: gust", "synonyms: breeze"]);
        act(() => {
          asked.at(-1)?.items[0]?.run();
        });
        expect(dispatched.at(-1)).toEqual(opened("synonyms", "gust", "gust"));
      });

      it("[SR-132/AK-ymp3] a choice box opens the list of its value", async () => {
        const { controls, dispatched } = await mountListing();
        act(() => {
          field("area").focus();
        });
        await listValue(controls);
        expect(dispatched.at(-1)).toEqual(opened("area", "quality", "quality"));
      });

      it("[SR-132/AK-q3fb] the focused target of a relation box opens the list of the elements with that target", async () => {
        const { controls, dispatched } = await mountListing();
        const links = [...container.querySelectorAll<HTMLElement>('[data-field="packages"] [role="link"]')];
        act(() => {
          links[1]?.focus();
        });
        await listValue(controls);
        expect(dispatched.at(-1)).toEqual(opened("packages", "Stufe 4", "PKG-p2"));
      });

      it("[SR-132/AK-q3fb] Enter with a modifier on a target link is left to the window; plain Enter still opens the target", async () => {
        const { targets } = await mountListing();
        const link = query('[data-field="packages"] [role="link"]');
        const key = new KeyboardEvent("keydown", {
          key: "Enter",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        });
        act(() => {
          link.dispatchEvent(key);
        });
        expect(key.defaultPrevented).toBe(false);
        expect(targets).toEqual([]);
        await press(link, "Enter");
        expect(targets).toEqual(["element:spec:p1"]);
      });

      /** Clicks `element`, by default with Ctrl, and waits until the list or the echo is there. */
      const modClick = async (
        element: Element | null | undefined,
        init: MouseEventInit = { ctrlKey: true },
      ) => {
        const click = new MouseEvent("click", { bubbles: true, cancelable: true, ...init });
        await act(async () => {
          element?.dispatchEvent(click);
          await Promise.resolve();
        });
        await flush();
        await flush();
        return click;
      };

      it("[SR-132/AK-y207] Ctrl/Cmd+click on a value opens its list: a line of a text box, a choice, a package target", async () => {
        const { dispatched, targets } = await mountListing();
        await modClick(container.querySelectorAll('[data-field="synonyms"] .cm-line')[1]);
        expect(dispatched.at(-1)).toEqual(opened("synonyms", "breeze", "breeze"));
        await modClick(container.querySelector('[data-field="area"] .value .line'));
        expect(dispatched.at(-1)).toEqual(opened("area", "quality", "quality"));
        const link = container.querySelectorAll('[data-field="packages"] [role="link"]')[1];
        const click = await modClick(link, { metaKey: true });
        expect(click.defaultPrevented).toBe(true);
        expect(dispatched.at(-1)).toEqual(opened("packages", "Stufe 4", "PKG-p2"));
        expect(targets).toEqual([]);
        // A click without the modifier still opens the target; on the key of a box nothing is listed.
        const count = dispatched.length;
        await modClick(link, {});
        expect(targets).toEqual(["element:spec:p2"]);
        await modClick(container.querySelector('[data-field="topic"] .key'));
        expect(dispatched).toHaveLength(count);
        blurAll();
      });

      it("[SR-132/AK-k3w0] Ctrl/Cmd+click on the acceptance criteria offers no list, not even the prompt among the other values", async () => {
        const { dispatched, asked, echoed } = await mountListing();
        await modClick(container.querySelector(`[data-field="${KEY}"] .cm-line`));
        expect(dispatched).toEqual([]);
        expect(asked).toEqual([]);
        expect(echoed.at(-1)).toBe(`No value of ${KEY} lists elements`);
        blurAll();
      });

      it("[SR-132/AK-k3w0] on the acceptance criteria the key asks among the other values, never the criteria", async () => {
        const { controls, dispatched, asked } = await mountListing();
        await caretAt(viewOf(KEY), 0);
        await listValue(controls);
        expect(dispatched).toEqual([]);
        const prompt = asked.at(-1);
        expect(prompt?.items.map((item) => item.name)).toEqual([
          "status: draft",
          "type: system-requirement",
          "topic: Wind",
          "synonyms: gust",
          "synonyms: breeze",
          "area: quality",
          "packages: PKG-p1 Stufe 3",
          "packages: PKG-p2 (Stufe-4) Stufe 4",
        ]);
        expect(prompt?.items.map((item) => item.hint)).toEqual([
          undefined,
          "System Requirement",
          undefined,
          undefined,
          undefined,
          "Quality",
          undefined,
          undefined,
        ]);
        blurAll();
        // On no box (the title) it asks the same.
        act(() => {
          field("Title").focus();
        });
        await listValue(controls);
        expect(asked.at(-1)?.items).toHaveLength(8);
      });

      it("[SR-132/AK-y207] from the command prompt it lists the value the cursor was on before the prompt opened", async () => {
        const { controls, dispatched } = await mountListing();
        // The second target of a box with two: once the prompt has the focus, only the snapshot knows it.
        const links = [...container.querySelectorAll<HTMLElement>('[data-field="packages"] [role="link"]')];
        act(() => {
          links[1]?.focus();
        });
        act(() => {
          controls().prompting();
        });
        const input = document.createElement("input");
        input.id = "prompt-input";
        document.body.append(input);
        act(() => {
          input.focus();
        });
        // A prompt over the prompt keeps what the cursor was on.
        act(() => {
          controls().prompting();
        });
        await listValue(controls);
        expect(dispatched.at(-1)).toEqual(opened("packages", "Stufe 4", "PKG-p2"));
        // The caret on the second line of a list property, likewise.
        await caretAt(viewOf("synonyms"), "gust\nbr".length);
        act(() => {
          controls().prompting();
        });
        act(() => {
          input.focus();
        });
        await listValue(controls);
        input.remove();
        expect(dispatched.at(-1)).toEqual(opened("synonyms", "breeze", "breeze"));
      });

      it("[SR-132/AK-y207] typed input is saved before the list opens, so the typed value is the one listed", async () => {
        let saved = "Wind";
        const { controls, dispatched, call } = await mountListing(
          () => facetsOf(saved),
          (input) => {
            saved = "Gust";
            const next = { ...PROPERTIES, topic: "Gust" };
            expect(input).toMatchObject({ set: { topic: "Gust" } });
            return {
              element: withProperties(next, { relations: RELATIONS }),
              files: ["a.md"],
              affected: 0,
            };
          },
        );
        await replaceIn("topic", "Gust");
        await caretAt(viewOf("topic"), 4);
        await listValue(controls);
        expect(dispatched.at(-1)).toEqual(opened("topic", "Gust", "Gust"));
        const names = call.mock.calls.map(([name]) => name);
        expect(names.indexOf("element.update")).toBeLessThan(names.lastIndexOf("element.facets"));
        blurAll();
      });

      it("asks for the facets once per values of the element: not after a reload with the same values, again when they changed", async () => {
        const { again, change, call } = await mountListing();
        expect(facetCalls(call)).toHaveLength(1);
        await again(1);
        await flush();
        expect(facetCalls(call)).toHaveLength(1);
        change({ ...PROPERTIES, topic: "Gust" });
        await again(2);
        await flush();
        expect(facetCalls(call)).toHaveLength(2);
      });

      it("says why when the facets fail, and when no value lists elements", async () => {
        const failing = await mountListing(() => new Error("boom"));
        await listValue(failing.controls);
        expect(failing.echoed.at(-1)).toBe("boom");
        // A failed answer is not kept: each press asks again.
        expect(facetCalls(failing.call)).toHaveLength(2);
        await listValue(failing.controls);
        expect(facetCalls(failing.call)).toHaveLength(3);
        const none = await mountListing(() => ({
          total: 1,
          types: [],
          statuses: [],
          properties: [],
          incomplete: false,
        }));
        await listValue(none.controls);
        expect(none.echoed.at(-1)).toBe("No value of SR-000001 (SR-036) Measure wind lists elements");
        expect(none.dispatched).toEqual([]);
      });
    });
  });
});

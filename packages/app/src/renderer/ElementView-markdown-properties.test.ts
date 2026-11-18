// @vitest-environment happy-dom
// happy-dom fires `selectionchange` inside a CodeMirror update; the root vitest config loads this setup, a
// run in packages/app needs it too (ThomasBirkmaier/ReqSeq-archive#460, ThomasBirkmaier/ReqSeq-archive#573).
import "../../../../scripts/test-support/dom-selection.mjs";
import type { DataExportElement } from "@reqseq/core";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { focusEffect } from "./editor/preview.js";
import type { PropertyModel } from "./element-view.js";
import { asCall, click, container, fakeCall, flush, query, texts } from "./components.test-helper.js";
import { caretAt, fresh, modelOf, mount, read } from "./ElementView.test-helper.js";

describe("ElementView", () => {
  describe("Markdown properties (SR-127)", () => {
    const TARGET = "6adc4fbb-fe6a-4dfa-b9b6-8ccf0e589cf2";
    const VERSION = "n1:1aac78aad3b5e6a8";
    const KEY = "acceptance-criteria";
    const markdown: PropertyModel = modelOf({
      [KEY]: { kind: "text", many: true, markdown: true },
      topic: { kind: "text", many: false, markdown: false },
    });
    const FIRST = "**Gegeben** ein *Satz*, `wenn` er gilt.";
    const SECOND = `**Dann** gilt [D-017](reqseq:${TARGET}?version=${VERSION}).`;
    const hint = (place: string, message = "points to an older version") => ({
      code: "relation.outdated",
      severity: "warning",
      message,
      targetId: TARGET,
      storedVersion: VERSION,
      hintId: `relation.outdated/spec/a.md/uuid-1/${place}/${TARGET}?version=${VERSION}&n=1`,
      ...(place.startsWith("@text:") ? { key: place.slice("@text:".length) } : {}),
      place: { in: "text", occurrence: 1 },
    });
    const element = (criteria: string[], problems: object[] = [], more: Partial<DataExportElement> = {}) =>
      read({
        title: "**Measure**",
        text: "",
        properties: { topic: "**Wind**", [KEY]: criteria },
        relations: [],
        problems,
        ...more,
      } as unknown as Partial<DataExportElement>);
    const mountCriteria = (criteria: string[], problems: object[] = [], shown: PropertyModel = markdown) => {
      let current = { criteria, problems };
      const call = fakeCall({
        "element.get": () => ({ element: element(current.criteria, current.problems) }),
      });
      const mounted = fresh().then(() => mount(asCall(call), 0, undefined, { properties: shown }));
      return {
        mounted,
        change: (next: { criteria: string[]; problems: object[] }) => {
          current = next;
        },
      };
    };
    const box = (): HTMLElement => query(`[data-field="${KEY}"]`);
    const boxViews = (): EditorView[] =>
      [...box().querySelectorAll<HTMLElement>(".cm-editor")].map((editor) => {
        const found = EditorView.findFromDOM(editor);
        if (found === null) {
          throw new Error("no editor");
        }
        return found;
      });
    const lines = (): (string | null)[] => [...box().querySelectorAll(".cm-line")].map((l) => l.textContent);

    it("[SR-127/AK-kjw4] shows the values of a markdown property formatted like the text: bold, italic and code without their marks", async () => {
      await mountCriteria([FIRST, SECOND]).mounted;
      // One editor for the box, one value per line.
      expect(boxViews()).toHaveLength(1);
      expect(lines()).toEqual(["Gegeben ein Satz, wenn er gilt.", "Dann gilt D-017."]);
      expect(box().querySelector(".cm-lr-strong")?.textContent).toBe("Gegeben");
      expect(box().querySelector(".cm-lr-em")?.textContent).toBe("Satz");
      expect(box().querySelector(".cm-lr-code")?.textContent).toBe("wenn");
      expect(box().textContent).not.toContain("*");
      expect(box().textContent).not.toContain("`");
      expect(query(`[data-field="${KEY}"] .key`).textContent).toBe(KEY);
      // The box is editable and named by the key.
      const content = box().querySelector(".cm-content");
      expect(content?.getAttribute("contenteditable")).toBe("true");
      expect(content?.getAttribute("aria-label")).toBe(KEY);
    });

    it("[SR-127/AK-kjw4] shows the source only on the line with the caret; the other values stay formatted", async () => {
      await mountCriteria([FIRST, SECOND]).mounted;
      const [view] = boxViews();
      if (view === undefined) {
        throw new Error("no editor");
      }
      await caretAt(view, 3);
      expect(view.hasFocus).toBe(true);
      // The first value shows its marks, the second is formatted.
      expect(lines()).toEqual([FIRST, "Dann gilt D-017."]);
      // The caret goes down: the second value shows its source, the first is formatted again.
      await caretAt(view, FIRST.length + 3);
      expect(lines()).toEqual(["Gegeben ein Satz, wenn er gilt.", SECOND]);
      // No caret in the box any more: all values are formatted.
      act(() => {
        query(`[data-field="${KEY}"]`).focus();
      });
      expect(view.hasFocus).toBe(false);
      act(() => {
        view.dispatch({ effects: focusEffect.of(false) });
      });
      expect(lines()).toEqual(["Gegeben ein Satz, wenn er gilt.", "Dann gilt D-017."]);
    });

    it("[SR-127/AK-kjw4] shows the label of a reference in a value and opens its element on a click", async () => {
      const { mounted } = mountCriteria([FIRST, SECOND]);
      const { opened } = await mounted;
      expect(box().querySelector(".cm-lr-ref")?.textContent).toBe("D-017");
      expect(box().textContent).not.toContain("reqseq:");
      await act(async () => {
        query(`[data-field="${KEY}"] .cm-lr-ref`).dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
        );
        await Promise.resolve();
      });
      expect(opened).toEqual([[TARGET, undefined]]);
    });

    it("[SR-127/AK-bd1x] marks an outdated reference in a value like one in the text, from the hint of that property only", async () => {
      const { mounted, change } = mountCriteria([FIRST, SECOND], [hint(`@text:${KEY}`)]);
      const { again } = await mounted;
      expect(box().querySelector(".cm-lr-outdated")?.getAttribute("title")).toBe(
        "points to an older version",
      );
      expect(box().textContent).toContain("D-017 link outdated");
      // The editor stays (focus and selection would too) while the hints are the same.
      const [before] = boxViews();
      await again(1);
      expect(boxViews()[0]).toBe(before);
      // The hint of another property or of the text is no mark in this box; a hint that is gone drops it.
      change({ criteria: [FIRST, SECOND], problems: [hint("@text:rationale", "other"), hint("@text")] });
      await again(2);
      expect(box().querySelector(".cm-lr-outdated")).toBeNull();
      expect(box().querySelector(".cm-lr-ref")?.textContent).toBe("D-017");
      change({ criteria: [FIRST, SECOND], problems: [hint(`@text:${KEY}`, "changed")] });
      await again(3);
      expect(box().querySelector(".cm-lr-outdated")?.getAttribute("title")).toBe("changed");
      expect(boxViews()[0]).toBe(before);
    });

    it("[SR-127/AK-bd1x] Follow reference with the focus on the box opens the first reference of the box, or says there is none", async () => {
      const { mounted } = mountCriteria([FIRST, SECOND, `[x](reqseq:uuid-2)`]);
      const { controls, opened, echoed } = await mounted;
      act(() => {
        box().focus();
      });
      act(() => {
        controls().follow();
      });
      expect(opened).toEqual([[TARGET, undefined]]);
      const none = mountCriteria([FIRST]);
      const again = await none.mounted;
      act(() => {
        box().focus();
      });
      act(() => {
        again.controls().follow();
      });
      expect(again.opened).toEqual([]);
      expect(again.echoed.at(-1)).toBe(`No element reference in ${KEY}`);
      expect(echoed).toEqual([]);
    });

    it("[SR-066/AK-c5xd] [SR-127/AK-bd1x] Follow reference with the caret in a value opens the reference at the caret, or says there is none", async () => {
      const { controls, opened, echoed } = await mountCriteria([FIRST, SECOND]).mounted;
      const [view] = boxViews();
      if (view === undefined) {
        throw new Error("no editor");
      }
      await caretAt(view, 2);
      act(() => {
        controls().follow();
      });
      expect(opened).toEqual([]);
      expect(echoed.at(-1)).toBe("No element reference at the cursor");
      const at = FIRST.length + 1 + SECOND.indexOf("D-017") + 1;
      await caretAt(view, at);
      act(() => {
        controls().follow();
      });
      expect(opened).toEqual([[TARGET, undefined]]);
    });

    it("[SR-127/AK-mdr7] shows the title as it is, and a property that is not marked markdown as plain text with its marks", async () => {
      await mountCriteria([FIRST]).mounted;
      expect(query("h1").textContent).toBe("**Measure**");
      const topic = query('[data-field="topic"]');
      expect(topic.querySelector(".cm-content")?.textContent).toBe("**Wind**");
      expect(topic.querySelector(".cm-lr-strong")).toBeNull();
      // The text, the marked box and the plain box have an editor each.
      expect(container.querySelectorAll(".cm-editor")).toHaveLength(3);
    });

    it("[SR-127/AK-mdr7] shows a property as it is when the metamodel has none for the type of the element", async () => {
      await mountCriteria([FIRST, SECOND], [], new Map()).mounted;
      expect(box().querySelector(".cm-editor")).toBeNull();
      expect(texts(`[data-field="${KEY}"] .line`)).toEqual([FIRST, SECOND]);
      await mountCriteria([FIRST], [], modelOf({}, "need")).mounted;
      expect(box().querySelector(".cm-editor")).toBeNull();
    });

    /** A buffer whose criteria are saved as they are sent, with the call to look at. */
    const mountSaving = async (shown: PropertyModel = markdown, extra: Record<string, unknown> = {}) => {
      let criteria = [FIRST, SECOND];
      const call = fakeCall({
        "element.get": () => ({ element: element(criteria, [], extra) }),
        "element.update": (input) => {
          const set = input["set"] as Record<string, string[]> | undefined;
          criteria = set?.[KEY] ?? criteria;
          return { element: element(criteria, [], extra), files: ["a.md"], affected: 0 };
        },
      });
      const mounted = await fresh().then(() => mount(asCall(call), 0, undefined, { properties: shown }));
      return { ...mounted, call };
    };
    /** Types `text` at the end of the first value of the box, as the keyboard does. */
    const typeInFirst = async (text: string): Promise<EditorView> => {
      const [first] = boxViews();
      if (first === undefined) {
        throw new Error("no box editor");
      }
      act(() => {
        first.focus();
        first.dispatch({ selection: { anchor: first.state.doc.line(1).to } });
      });
      for (const char of text) {
        await act(async () => {
          const head = first.state.selection.main.head;
          first.dispatch({
            changes: { from: head, insert: char },
            selection: { anchor: head + 1 },
            userEvent: "input.type",
          });
          await Promise.resolve();
        });
      }
      return first;
    };
    const wind = { id: TARGET, title: "Wind sehen", label: "N-1", shortId: "N-1", repository: "spec" };

    it("[SR-127/AK-k3yf] [[ in an acceptance criterion asks for an element and writes the reference into that value only", async () => {
      const { picks, controls, call } = await mountSaving();
      const first = await typeInFirst("[[");
      expect(picks).toHaveLength(1);
      expect(first.state.doc.toString()).toBe(`${FIRST}[[\n${SECOND}`);
      // A prompt opens while the [[ waits: nothing is saved with it.
      act(() => {
        controls().prompting();
      });
      await flush();
      expect(call.mock.calls.filter(([name]) => name === "element.update")).toEqual([]);
      act(() => {
        picks[0]?.insert(wind);
      });
      expect(first.state.doc.toString()).toBe(`${FIRST}[Wind sehen](reqseq:${TARGET})\n${SECOND}`);
      await act(async () => {
        controls().save();
        await Promise.resolve();
      });
      await flush();
      expect(call.mock.calls.filter(([name]) => name === "element.update")).toEqual([
        [
          "element.update",
          { ref: "uuid-1", set: { [KEY]: [`${FIRST}[Wind sehen](reqseq:${TARGET})`, SECOND] } },
        ],
      ]);
      // Off the line with the caret the value shows the title of the target, which opens on a click.
      act(() => {
        first.contentDOM.blur();
        first.dispatch({ effects: focusEffect.of(false) });
      });
      expect(lines()[0]).toBe("Gegeben ein Satz, wenn er gilt.Wind sehen");
    });

    it("[SR-127/AK-k3yf] no [[ search in a property that is not marked markdown, nor in a read-only box", async () => {
      const plain: PropertyModel = modelOf({ [KEY]: { kind: "text", many: true, markdown: false } });
      const { picks } = await mountSaving(plain);
      await typeInFirst("[[");
      expect(picks).toEqual([]);
      expect(boxViews()[0]?.state.doc.line(1).text).toBe(`${FIRST}[[`);
      const locked = await mountSaving(markdown, { readOnly: true });
      expect(boxViews()[0]?.state.readOnly).toBe(true);
      await typeInFirst("[[");
      expect(locked.picks).toEqual([]);
      // The same box marked markdown and editable asks.
      const open = await mountSaving();
      await typeInFirst("[[");
      expect(open.picks).toHaveLength(1);
    });

    it("[SR-127/AK-k3yf] a reference to another repository in a value shows the title of its target when it is here (D-058)", async () => {
      const across = `Siehe [N-0e9d7c](reqseq:${TARGET}?version=${VERSION}&repository=sensor).`;
      const call = fakeCall({
        "element.get": (input) =>
          input["ref"] === TARGET
            ? { element: read({ id: TARGET, title: "Böen messen" }) }
            : { element: element([across]) },
      });
      await fresh().then(() => mount(asCall(call), 0, undefined, { properties: markdown }));
      await flush();
      expect(call).toHaveBeenCalledWith("element.get", { ref: TARGET, repository: "sensor" });
      expect(lines()).toEqual(["Siehe Böen messen."]);
    });

    it("[SR-127/AK-kjw4] shows no image and no slash menu in a value, and [[ that is not typed asks nothing", async () => {
      const { picks } = await mountCriteria(["![x](a.png) and /heading and [[wind"]).mounted;
      expect(picks).toEqual([]);
      expect(box().querySelector("img:not(.cm-widgetBuffer)")).toBeNull();
      expect(box().querySelector(".cm-content")?.textContent).toBe("![x](a.png) and /heading and [[wind");
      expect(container.querySelector(".cm-tooltip-autocomplete")).toBeNull();
    });

    it("[SR-127/AK-kjw4] sets inline formatting only: a heading, a list item and a quote in a value keep their source", async () => {
      await mountCriteria(["# x", "- y", "> z", "1. n", "**b** and # c"]).mounted;
      expect(lines()).toEqual(["# x", "- y", "> z", "1. n", "b and # c"]);
      expect(box().querySelector(".cm-lr-h1, .cm-lr-bullet, .cm-lr-quote, .cm-lr-task")).toBeNull();
      expect(box().querySelector(".cm-lr-strong")?.textContent).toBe("b");
    });

    it("[SR-127/AK-kjw4] never pairs a mark across two values, though they are lines of one document", async () => {
      await mountCriteria(["*a*", "b*", "**c", "d**", "x_", "_y"]).mounted;
      expect(box().querySelectorAll(".cm-lr-em")).toHaveLength(1);
      expect(box().querySelector(".cm-lr-em")?.textContent).toBe("a");
      expect(box().querySelector(".cm-lr-strong")).toBeNull();
      expect(lines()).toEqual(["a", "b*", "**c", "d**", "x_", "_y"]);
    });

    it("[SR-128/AK-yqp3] copies the stored source of a markdown property, one value per line", async () => {
      const { copies } = await mountCriteria([FIRST, SECOND]).mounted;
      await click(query(`[data-field="${KEY}"] > .copy`));
      expect(copies).toEqual([[KEY, `${FIRST}\n${SECOND}`]]);
    });
  });
});

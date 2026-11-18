// @vitest-environment happy-dom
// happy-dom fires `selectionchange` inside a CodeMirror update; the root vitest config loads this setup, a
// run in packages/app needs it too (ThomasBirkmaier/ReqSeq-archive#460, ThomasBirkmaier/ReqSeq-archive#573).
import "../../../../scripts/test-support/dom-selection.mjs";
import type { DataExportElement } from "@reqseq/core";
import { act, createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { nth } from "./lists.js";
import { elementBuffer, readOnlyBuffer } from "./buffers.js";
import type { Call } from "./call.js";
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
  render,
  renewRoot,
  root,
  texts,
} from "./components.test-helper.js";
import { editorView, mount, read, saved, typeInto } from "./ElementView.test-helper.js";

describe("ElementView", () => {
  it("reads the element with its repository and shows title, text, properties and relations", async () => {
    const call = fakeCall({ "element.get": () => ({ element: read() }) });
    const { data } = await mount(asCall(call));
    expect(call).toHaveBeenCalledWith("element.get", { ref: "uuid-1", repository: "spec" });
    expect(query("article").getAttribute("aria-label")).toBe("SR-000001 (SR-036) Measure wind");
    expect(query("h1").textContent).toBe("Measure wind");
    expect(data).toEqual([
      ["element:spec:uuid-1", undefined],
      ["element:spec:uuid-1", { kind: "element", element: read() }],
    ]);
    expect(texts(".box .key")).toEqual(["topic", "criteria", "packages"]);
    expect(texts(".box .line")).toEqual(["Wind", "first", "second"]);
    // The targets of a relation property are a box (SR-104); the relation groups keep the relation kinds.
    expect(texts('[data-field="packages"] .relation')).toEqual(["p Stage 3"]);
    expect(texts("h2")).toEqual(["derives-from", "← derives-from"]);
  });

  it("edits the text in the editor, as text: nothing of it becomes markup", async () => {
    await mount(asCall(fakeCall({ "element.get": () => ({ element: read() }) })));
    expect(editorView().state.doc.toString()).toBe("Line one\n<b>not bold</b>");
    expect(query(".cm-content").textContent).toBe("Line one<b>not bold</b>");
    expect(container.querySelector(".cm-content b")).toBeNull();
  });

  it("shows an editor also when the text is empty or there is none, and no properties or relations", async () => {
    await mount(
      asCall(
        fakeCall({
          "element.get": () => ({ element: read({ title: "", text: "", properties: {}, relations: [] }) }),
        }),
      ),
    );
    expect(query("h1").textContent).toBe("SR-000001 (SR-036)");
    expect(editorView().state.doc.toString()).toBe("");
    expect(container.querySelector(".box")).toBeNull();
    expect(container.querySelector("section")).toBeNull();
    await mount(
      asCall(
        fakeCall({
          "element.get": () => ({
            // JSON drops what is undefined: an element without an identifier and without text.
            element: JSON.parse(
              JSON.stringify({
                ...read({ title: "", relations: [] }),
                identifier: undefined,
                text: undefined,
              }),
            ) as DataExportElement,
          }),
        }),
      ),
    );
    expect(query("h1").textContent).toBe("SR-000001");
    expect(editorView().state.doc.toString()).toBe("");
  });

  it("is editable, or not for a read-only element", async () => {
    await mount(asCall(fakeCall({ "element.get": () => ({ element: read() }) })));
    expect(query(".cm-content").getAttribute("contenteditable")).toBe("true");
    await mount(asCall(fakeCall({ "element.get": () => ({ element: read({ readOnly: true }) }) })));
    expect(query(".cm-content").getAttribute("contenteditable")).toBe("false");
  });

  it("[SR-044/AK-d2rh] shows an element read-only in a buffer shown read-only, and tells the modeline so", async () => {
    const buffer = readOnlyBuffer(elementBuffer("uuid-1", "spec", "SR-000001 (SR-036) Measure wind"));
    const { data } = await mount(
      asCall(fakeCall({ "element.get": () => ({ element: read() }) })),
      0,
      undefined,
      {
        buffer,
      },
    );
    expect(query(".cm-content").getAttribute("contenteditable")).toBe("false");
    const [key, loaded] = data.at(-1) ?? [];
    expect(key).toBe(buffer.key);
    expect(loaded?.kind === "element" && loaded.element.readOnly).toBe(true);
  });

  it("keeps the text typed as a draft for the app, and drops it when the text is the saved one again", async () => {
    const { drafts } = await mount(asCall(fakeCall({ "element.get": () => ({ element: read() }) })));
    await typeInto("!");
    expect(drafts).toEqual([
      ["element:spec:uuid-1", { text: "Line one\n<b>not bold</b>!", base: "Line one\n<b>not bold</b>" }],
    ]);
    await act(async () => {
      editorView().dispatch({ changes: { from: 24, to: 25 } });
      await Promise.resolve();
    });
    expect(drafts.at(-1)).toEqual(["element:spec:uuid-1", undefined]);
  });

  it("shows the draft of the app in place of the text, and it stays a draft", async () => {
    const { drafts } = await mount(asCall(fakeCall({ "element.get": () => ({ element: read() }) })), 0, {
      text: "my draft",
      base: "Line one\n<b>not bold</b>",
    });
    expect(editorView().state.doc.toString()).toBe("my draft");
    expect(drafts).toEqual([]);
    await typeInto("!");
    expect(drafts).toEqual([
      ["element:spec:uuid-1", { text: "my draft!", base: "Line one\n<b>not bold</b>" }],
    ]);
  });

  it("saves with element.update { ref, text }, says so, and the baseline is what core gives back", async () => {
    const call = fakeCall({
      "element.get": () => ({ element: read() }),
      "element.update": (input) => saved(`${String(input["text"])}\n`),
    });
    const { controls, echoed, drafts, data } = await mount(asCall(call));
    await typeInto("!");
    drafts.length = 0;
    await act(async () => {
      controls().save();
      await Promise.resolve();
    });
    await flush();
    expect(call.mock.calls.filter(([name]) => name === "element.update")).toEqual([
      ["element.update", { ref: "uuid-1", text: "Line one\n<b>not bold</b>!" }],
    ]);
    // Core added the final line break, so the editor shows what the file holds.
    expect(editorView().state.doc.toString()).toBe("Line one\n<b>not bold</b>!\n");
    expect(echoed.at(-1)).toBe("Saved SR-000001 (SR-036) Measure wind");
    expect(drafts.at(-1)).toEqual(["element:spec:uuid-1", undefined]);
    expect(data.at(-1)?.[1]?.kind).toBe("element");
    await act(async () => {
      controls().save();
      await Promise.resolve();
    });
    expect(echoed.at(-1)).toBe("No changes to save");
    expect(call.mock.calls.filter(([name]) => name === "element.update")).toHaveLength(1);
  });

  it("saves an empty text, which core gives back as no text", async () => {
    const call = fakeCall({
      "element.get": () => ({ element: read() }),
      "element.update": () => saved(undefined as unknown as string),
    });
    const { controls, echoed } = await mount(asCall(call));
    await act(async () => {
      editorView().dispatch({ changes: { from: 0, to: editorView().state.doc.length } });
      await Promise.resolve();
    });
    await act(async () => {
      controls().save();
      await Promise.resolve();
    });
    await flush();
    expect(call).toHaveBeenCalledWith("element.update", { ref: "uuid-1", text: "" });
    expect(echoed.at(-1)).toBe("Saved SR-000001 (SR-036) Measure wind");
    expect(editorView().state.doc.toString()).toBe("");
  });

  it("keeps what was typed while the save ran, as a draft", async () => {
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
                : (NO_SUMMARY[name]?.() ?? { element: read({ text: "base" }) }),
          }),
    );
    const { controls, drafts, echoed } = await mount(asCall(call as never));
    await typeInto("!");
    await act(async () => {
      controls().save();
      await Promise.resolve();
    });
    await typeInto("?");
    await act(async () => {
      answer({ ok: true, output: saved("base!") });
      await Promise.resolve();
    });
    await flush();
    expect(editorView().state.doc.toString()).toBe("base!?");
    expect(drafts.at(-1)).toEqual(["element:spec:uuid-1", { text: "base!?", base: "base!" }]);
    expect(echoed.at(-1)).toBe("Saved SR-000001 (SR-036) Measure wind");
  });

  it("waits with a Ctrl+S pressed while a save runs, then saves what is left and says so (#563)", async () => {
    const answers: ((value: unknown) => void)[] = [];
    const call = vi.fn((name: string) =>
      name === "element.update"
        ? new Promise((resolve) => {
            answers.push(resolve);
          })
        : Promise.resolve({
            ok: true,
            output:
              name === "trace.neighbourhood"
                ? alone({ ref: "uuid-1" })
                : (NO_SUMMARY[name]?.() ?? { element: read({ text: "base" }) }),
          }),
    );
    const updates = (): number => call.mock.calls.filter(([name]) => name === "element.update").length;
    const { controls, drafts, echoed } = await mount(asCall(call as never));
    await typeInto("!");
    await act(async () => {
      controls().save();
      await Promise.resolve();
    });
    // Pressed while the first runs: it waits for it, it is not dropped.
    await act(async () => {
      controls().save();
      await Promise.resolve();
    });
    expect(updates()).toBe(1);
    echoed.length = 0;
    await act(async () => {
      answers[0]?.({ ok: true, output: saved("base!") });
      await Promise.resolve();
    });
    await flush();
    // That save left nothing: the second says Saved, not "No changes to save", and writes nothing.
    expect(updates()).toBe(1);
    expect(echoed.at(-1)).toBe("Saved SR-000001 (SR-036) Measure wind");
    // Typed while a save runs: the waiting Ctrl+S writes it after that save.
    await typeInto("?");
    await act(async () => {
      controls().save();
      await Promise.resolve();
    });
    await act(async () => {
      controls().save();
      await Promise.resolve();
    });
    await typeInto("#");
    await act(async () => {
      answers[1]?.({ ok: true, output: saved("base!?") });
      await Promise.resolve();
    });
    await flush();
    expect(updates()).toBe(3);
    await act(async () => {
      answers[2]?.({ ok: true, output: saved("base!?#") });
      await Promise.resolve();
    });
    await flush();
    expect(editorView().state.doc.toString()).toBe("base!?#");
    expect(drafts.at(-1)).toEqual(["element:spec:uuid-1", undefined]);
    expect(echoed.at(-1)).toBe("Saved SR-000001 (SR-036) Measure wind");
  });

  it("echoes why a save failed and keeps the text as a draft", async () => {
    const call = fakeCall({
      "element.get": () => ({ element: read() }),
      "element.update": () => new Error("More than one element has the ID"),
    });
    const { controls, echoed, drafts } = await mount(asCall(call));
    await typeInto("!");
    const before = drafts.length;
    await act(async () => {
      controls().save();
      await Promise.resolve();
    });
    await flush();
    expect(echoed.at(-1)).toBe("More than one element has the ID");
    expect(drafts).toHaveLength(before);
    expect(editorView().state.doc.toString()).toBe("Line one\n<b>not bold</b>!");
  });

  it("does not save a read-only element", async () => {
    const call = fakeCall({ "element.get": () => ({ element: read({ readOnly: true }) }) });
    const { controls, echoed } = await mount(asCall(call));
    await act(async () => {
      controls().save();
      await Promise.resolve();
    });
    expect(echoed.at(-1)).toBe("SR-000001 (SR-036) Measure wind is read-only");
    expect(call.mock.calls.filter(([name]) => name === "element.update")).toEqual([]);
  });

  it("gives the app its controls once the text is shown, and takes them back", async () => {
    const { registered } = await mount(asCall(fakeCall({ "element.get": () => ({ element: read() }) })));
    expect(registered.map((c) => c !== undefined)).toEqual([true]);
    act(() => {
      root.unmount();
    });
    expect(registered.at(-1)).toBeUndefined();
    renewRoot();
    const failing = await mount(
      asCall(fakeCall({ "element.get": () => new Error("No element has that ID") })),
    );
    expect(failing.registered).toEqual([]);
  });

  it("Enter on the buffer gives the editor the focus at the end, Escape in the editor gives it back", async () => {
    const { controls } = await mount(asCall(fakeCall({ "element.get": () => ({ element: read() }) })));
    const article = query("article");
    await press(article, "Enter");
    expect(editorView().hasFocus).toBe(true);
    expect(editorView().state.selection.main.head).toBe(24);
    await press(query(".cm-content"), "Escape");
    expect(document.activeElement).toBe(article);
    act(() => {
      controls().edit();
    });
    expect(editorView().hasFocus).toBe(true);
  });

  it("Enter with a modifier on the buffer is a shortcut and does not edit", async () => {
    await mount(asCall(fakeCall({ "element.get": () => ({ element: read() }) })));
    const article = query("article");
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }]) {
      await press(article, "Enter", init);
      expect(editorView().hasFocus).toBe(false);
    }
    await press(article, "Enter");
    expect(editorView().hasFocus).toBe(true);
  });

  it("ignores Enter on the buffer before the text is shown", async () => {
    await mount(asCall(fakeCall({ "element.get": () => new Error("No element has that ID") })));
    await press(query("article"), "Enter");
    expect(container.querySelector(".cm-editor")).toBeNull();
  });

  it("does not show loading again after a reload: the editor stays, and the text follows when nothing was typed", async () => {
    let text = "first";
    const call = fakeCall({ "element.get": () => ({ element: read({ text }) }) });
    const { again, echoed } = await mount(asCall(call));
    const editor = query(".cm-editor");
    text = "second";
    await again(1);
    expect(query(".cm-editor")).toBe(editor);
    expect(editorView().state.doc.toString()).toBe("second");
    expect(echoed).toEqual([]);
  });

  it("[SR-106/AK-ydc8] keeps unsaved input on a reload with a changed file, shows the file's version below it and says so once", async () => {
    let text = "first";
    let sha = "sha-1";
    const call = fakeCall({ "element.get": () => ({ element: read({ text }), fileSha256: sha }) });
    const { again, echoed, drafts, data } = await mount(asCall(call));
    await typeInto("!");
    text = "changed";
    sha = "sha-2";
    await again(1);
    expect(editorView().state.doc.toString()).toBe("first!");
    expect(query('[data-on-disk="Text"]').textContent).toBe("On diskchanged");
    expect(query('[data-on-disk="Text"] mark').textContent).toBe("changed");
    expect(echoed).toEqual([
      'SR-000001 (SR-036) Measure wind changed on disk. Resolve with "Resolve change on disk"',
    ]);
    // The draft keeps the bytes it was typed on, so the conflict comes back with the buffer.
    expect(drafts.at(-1)).toEqual(["element:spec:uuid-1", { text: "first!", base: "changed", sha: "sha-1" }]);
    expect(data.at(-1)?.[1]).toMatchObject({ kind: "element", disk: "changed" });
    // The same file again says nothing more.
    await again(2);
    expect(echoed).toHaveLength(1);
  });

  it("[SR-106/AK-ydc8] opens the conflict when a draft comes back on another file, and keeps the draft", async () => {
    const call = fakeCall({ "element.get": () => ({ element: read({ text: "Hello" }), fileSha256: "new" }) });
    const { echoed, drafts, controls } = await mount(asCall(call), 0, {
      text: "Hello!",
      base: "Old",
      sha: "old",
    });
    expect(editorView().state.doc.toString()).toBe("Hello!");
    expect(echoed).toEqual([
      'SR-000001 (SR-036) Measure wind changed on disk. Resolve with "Resolve change on disk"',
    ]);
    expect(query('[data-on-disk="Text"]').textContent).toBe("On diskHello");
    expect(controls().resolve).toBeDefined();
    // The draft is on the new file text, typed on the old bytes.
    expect(drafts).toEqual([["element:spec:uuid-1", { text: "Hello!", base: "Hello", sha: "old" }]]);
  });

  it("follows the file with a draft that comes back on the bytes it was typed on", async () => {
    const call = fakeCall({
      "element.get": () => ({ element: read({ text: "Hello" }), fileSha256: "same" }),
    });
    const { echoed, drafts, controls } = await mount(asCall(call), 0, {
      text: "Hello!",
      base: "Hello",
      sha: "same",
    });
    expect(editorView().state.doc.toString()).toBe("Hello!");
    expect(echoed).toEqual([]);
    expect(drafts).toEqual([]);
    expect(container.querySelector("[data-on-disk]")).toBeNull();
    expect(controls().resolve).toBeUndefined();
  });

  it("drops a draft that the file now holds", async () => {
    const call = fakeCall({ "element.get": () => ({ element: read({ text: "Hello!" }) }) });
    const { echoed, drafts } = await mount(asCall(call), 0, { text: "Hello!", base: "Hello" });
    expect(drafts).toEqual([["element:spec:uuid-1", undefined]]);
    expect(echoed).toEqual([]);
  });

  it("says nothing when the base of the draft is the file text", async () => {
    const call = fakeCall({ "element.get": () => ({ element: read({ text: "Hello" }) }) });
    const { echoed, drafts } = await mount(asCall(call), 0, { text: "Hello!", base: "Hello" });
    expect(echoed).toEqual([]);
    expect(drafts).toEqual([]);
    expect(editorView().state.doc.toString()).toBe("Hello!");
  });

  it("drops the draft on a reload when the changed file now holds the typed text, and says nothing", async () => {
    let text = "first";
    let sha = "sha-1";
    const call = fakeCall({ "element.get": () => ({ element: read({ text }), fileSha256: sha }) });
    const { again, echoed, drafts } = await mount(asCall(call));
    await typeInto("!");
    text = "first!";
    sha = "sha-2";
    await again(1);
    expect(echoed).toEqual([]);
    expect(drafts.at(-1)).toEqual(["element:spec:uuid-1", undefined]);
    expect(container.querySelector("[data-on-disk]")).toBeNull();
  });

  it("reads again after an error, with no editor to ask", async () => {
    let fail = true;
    let text = "first";
    const call = fakeCall({
      "element.get": () => (fail ? new Error("busy") : { element: read({ text }) }),
    });
    const { again, echoed } = await mount(asCall(call));
    expect(container.querySelector(".cm-editor")).toBeNull();
    fail = false;
    await again(1);
    expect(editorView().state.doc.toString()).toBe("first");
    // A failed read after the element was shown keeps it with its editor, and says why.
    fail = true;
    const editor = query(".cm-editor");
    await again(2);
    expect(container.querySelector(".quiet")).toBeNull();
    expect(query(".cm-editor")).toBe(editor);
    expect(editorView().state.doc.toString()).toBe("first");
    expect(echoed.at(-1)).toBe("busy");
    fail = false;
    text = "other";
    await again(3);
    expect(editorView().state.doc.toString()).toBe("other");
  });

  it("opens a relation target that is available, on a click and on Enter", async () => {
    const { targets } = await mount(asCall(fakeCall({ "element.get": () => ({ element: read() }) })));
    const links = [...container.querySelectorAll<HTMLElement>('[role="link"]')];
    expect(links.map((link) => link.textContent)).toEqual([
      "p Stage 3",
      "N-000001 (N-1) Need",
      "SR-000009 Child",
    ]);
    await click(nth(links, 1));
    await press(nth(links, 2), "Enter");
    await press(nth(links, 2), "x");
    await click(nth(links, 0));
    expect(targets).toEqual(["element:spec:n1", "element:platform:r1", "element:spec:p"]);
  });

  it("[SR-132/AK-q3fb] Follow reference on a focused link of a relation group opens that link, not the reference at the caret of the text", async () => {
    const { controls, targets, opened } = await mount(
      asCall(fakeCall({ "element.get": () => ({ element: read({ text: "[x](reqseq:uuid-2)" }) }) })),
    );
    // The caret of the text sits on an inline reference.
    act(() => {
      editorView().dispatch({ selection: { anchor: 2 } });
    });
    const links = [...container.querySelectorAll<HTMLElement>('[role="link"]')];
    for (const link of [nth(links, 1), nth(links, 2)]) {
      act(() => {
        link.focus();
      });
      // The link leaves Ctrl+Enter to the window, which runs "Follow reference".
      const key = new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        link.dispatchEvent(key);
      });
      expect(key.defaultPrevented).toBe(false);
      act(() => {
        controls().follow();
      });
    }
    expect(targets).toEqual(["element:spec:n1", "element:platform:r1"]);
    expect(opened).toEqual([]);
  });

  it("shows a target that is not available muted with its state, and no link", async () => {
    await mount(asCall(fakeCall({ "element.get": () => ({ element: read() }) })));
    const muted = query(".unavailable");
    expect(muted.textContent).toBe("N-000002 inaccessible");
    expect(muted.querySelector('[role="link"]')).toBeNull();
    expect(muted.querySelector(".state")?.textContent).toBe("inaccessible");
  });

  it("shows why the element could not be read, and echoes it", async () => {
    const { echoed } = await mount(
      asCall(fakeCall({ "element.get": () => new Error("No element has that ID") })),
    );
    expect(query(".quiet").textContent).toBe("No element has that ID");
    expect(echoed).toEqual(["No element has that ID"]);
    expect(container.querySelector("h1")).toBeNull();
  });

  it("reads again when the workspace changed, and ignores an answer that comes after it is gone", async () => {
    const call = fakeCall({ "element.get": () => ({ element: read() }) });
    const { again } = await mount(asCall(call));
    await again(1);
    // Each time the element and its parents; the facets of its values once (SR-132): its values are the same.
    expect(call.mock.calls.map(([name]) => name)).toEqual([
      "element.get",
      "trace.neighbourhood",
      "element.facets",
      "element.get",
      "trace.neighbourhood",
    ]);
    let answer: (value: unknown) => void = () => undefined;
    const slow = vi.fn(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    await again(1);
    await render(createElement("p"));
    await mount(slow as unknown as Call);
    act(() => {
      root.unmount();
    });
    answer({ ok: true, output: { element: read() } });
    await Promise.resolve();
    renewRoot();
  });
});

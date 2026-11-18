// @vitest-environment happy-dom
// happy-dom fires `selectionchange` inside a CodeMirror update; the root vitest config loads this setup, a
// run in packages/app needs it too (ThomasBirkmaier/ReqSeq-archive#460, ThomasBirkmaier/ReqSeq-archive#573).
import "../../../../scripts/test-support/dom-selection.mjs";
import type { DataExportElement } from "@reqseq/core";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { asCall, click, container, fakeCall, press, query } from "./components.test-helper.js";
import { editorView, mount, read, typeInto } from "./ElementView.test-helper.js";

describe("ElementView", () => {
  describe("copy fields (SR-128)", () => {
    const fieldNames = (): (string | undefined)[] =>
      [...container.querySelectorAll<HTMLElement>("[data-field]")].map((field) => field.dataset["field"]);
    const copySymbol = (label: string): HTMLElement => query(`[data-field="${label}"] > .copy`);
    const mountRead = (extra: Partial<DataExportElement> = {}) =>
      mount(asCall(fakeCall({ "element.get": () => ({ element: read(extra) }) })));

    it("[SR-128/AK-sthw] gives the title, the text, each property box and each group of relations a copy symbol", async () => {
      await mountRead();
      expect(fieldNames()).toEqual([
        "Title",
        "Text",
        "topic",
        "criteria",
        "packages",
        "derives-from",
        "← derives-from",
      ]);
      for (const label of fieldNames()) {
        const symbol = copySymbol(label ?? "");
        expect(symbol.tagName).toBe("BUTTON");
        expect(symbol.getAttribute("aria-label")).toBe(`Copy ${label ?? ""}`);
        // The symbol is no stop of the Tab key: the keyboard has "Copy field".
        expect(symbol.getAttribute("tabindex")).toBe("-1");
        expect(symbol.querySelector("svg")).not.toBeNull();
      }
    });

    it("[SR-128/AK-sthw] lets the focus be in the title and in a box, which have no control inside", async () => {
      await mountRead();
      const focusable = [...container.querySelectorAll<HTMLElement>("[data-field]")]
        .filter((field) => field.getAttribute("tabindex") === "0")
        .map((field) => field.dataset["field"]);
      expect(focusable).toEqual(["Title", "topic", "criteria", "packages"]);
    });

    it("[SR-128/AK-yqp3] copies the values of a box one per line, and says which field", async () => {
      const { copies } = await mountRead();
      await click(copySymbol("criteria"));
      await click(copySymbol("topic"));
      expect(copies).toEqual([
        ["criteria", "first\nsecond"],
        ["topic", "Wind"],
      ]);
    });

    it("[SR-128/AK-yqp3] copies the title, the relations as shown, and the text as the editor holds it", async () => {
      const { copies } = await mountRead();
      await typeInto("!");
      await click(copySymbol("Title"));
      await click(copySymbol("Text"));
      await click(copySymbol("derives-from"));
      await click(copySymbol("← derives-from"));
      await click(copySymbol("packages"));
      expect(copies).toEqual([
        ["Title", "Measure wind"],
        ["Text", "Line one\n<b>not bold</b>!"],
        ["derives-from", "N-000001 (N-1) Need\nN-000002"],
        ["← derives-from", "SR-000009 Child"],
        ["packages", "p Stage 3"],
      ]);
    });

    it("[SR-128/AK-yqp3] copies the heading that is shown when the element has no title", async () => {
      const { copies } = await mountRead({ title: "" });
      await click(copySymbol("Title"));
      expect(copies).toEqual([["Title", "SR-000001 (SR-036)"]]);
    });

    it("[SR-128/AK-x005] leaves the focus where it is when the symbol is pressed, so the editor keeps its cursor", async () => {
      const { copies } = await mountRead();
      await act(async () => {
        editorView().focus();
        await Promise.resolve();
      });
      const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      await act(async () => {
        copySymbol("criteria").dispatchEvent(press);
        await Promise.resolve();
      });
      expect(press.defaultPrevented).toBe(true);
      expect(editorView().hasFocus).toBe(true);
      // Pressing the field itself or focusing it copies nothing.
      await click(query('[data-field="criteria"] .box'));
      await act(async () => {
        query('[data-field="topic"]').focus();
        await Promise.resolve();
      });
      expect(copies).toEqual([]);
    });

    it("[SR-128/AK-pk21] Copy field copies the field the focus is in", async () => {
      const { controls, copies } = await mountRead();
      for (const label of ["criteria", "Title"]) {
        await act(async () => {
          query(`[data-field="${label}"]`).focus();
          await Promise.resolve();
        });
        act(() => {
          controls().copy();
        });
      }
      await act(async () => {
        editorView().focus();
        await Promise.resolve();
      });
      act(() => {
        controls().copy();
      });
      // A link in a group of relations is in that field.
      await act(async () => {
        query('[data-field="derives-from"] [role="link"]').focus();
        await Promise.resolve();
      });
      act(() => {
        controls().copy();
      });
      expect(copies).toEqual([
        ["criteria", "first\nsecond"],
        ["Title", "Measure wind"],
        ["Text", "Line one\n<b>not bold</b>"],
        ["derives-from", "N-000001 (N-1) Need\nN-000002"],
      ]);
    });

    it("[SR-128/AK-pk21] Copy field from the command prompt copies the field the cursor was in, though the prompt has the focus", async () => {
      const { controls, copies } = await mountRead();
      await act(async () => {
        query('[data-field="topic"]').focus();
        await Promise.resolve();
      });
      const prompt = document.createElement("input");
      prompt.id = "prompt-input";
      document.body.append(prompt);
      await act(async () => {
        prompt.focus();
        await Promise.resolve();
      });
      act(() => {
        controls().copy();
      });
      prompt.remove();
      expect(copies).toEqual([["topic", "Wind"]]);
    });

    it("[SR-128/AK-pk21] Copy field does not copy a field the focus has left for somewhere else than the prompt", async () => {
      const { controls, copies } = await mountRead();
      await act(async () => {
        query('[data-field="topic"]').focus();
        await Promise.resolve();
      });
      const other = document.createElement("input");
      document.body.append(other);
      await act(async () => {
        other.focus();
        await Promise.resolve();
      });
      act(() => {
        controls().copy();
      });
      other.remove();
      expect(copies).toEqual([["ID", "SR-000001"]]);
    });

    it("Enter on the focused title or box edits the text, like Enter on the buffer; with a modifier it does not", async () => {
      await mountRead();
      for (const label of ["Title", "criteria"]) {
        await act(async () => {
          query(`[data-field="${label}"]`).focus();
          await Promise.resolve();
        });
        await press(query(`[data-field="${label}"]`), "Enter");
        expect(editorView().hasFocus, label).toBe(true);
        await press(query(".cm-content"), "Escape");
        expect(editorView().hasFocus).toBe(false);
      }
      await press(query('[data-field="topic"]'), "Enter", { ctrlKey: true });
      expect(editorView().hasFocus).toBe(false);
    });

    it("[SR-128/AK-pk21] Copy field copies the ID when the cursor is in no field: on the buffer itself, or after leaving the text", async () => {
      const { controls, copies } = await mountRead();
      act(() => {
        controls().copy();
      });
      await act(async () => {
        editorView().focus();
        await Promise.resolve();
      });
      await press(query(".cm-content"), "Escape");
      act(() => {
        controls().copy();
      });
      expect(copies).toEqual([
        ["ID", "SR-000001"],
        ["ID", "SR-000001"],
      ]);
    });

    it("[SR-128/AK-pk21] copies the short ID of an element that has no identifier", async () => {
      const { controls, copies } = await mountRead({ identifier: undefined } as never);
      act(() => {
        controls().copy();
      });
      expect(copies).toEqual([["ID", "SR-000001"]]);
    });
  });
});

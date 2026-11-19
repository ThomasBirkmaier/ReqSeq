// @vitest-environment happy-dom
// happy-dom fires `selectionchange` inside a CodeMirror update; the root vitest config loads this setup, a
// run in packages/app needs it too (ThomasBirkmaier/ReqSeq-archive#460, ThomasBirkmaier/ReqSeq-archive#573).
import "../../../../scripts/test-support/dom-selection.mjs";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { NOTICE_MS } from "./copy.js";
import type { Handler } from "./App.test-helper.js";
import {
  fakeBridge,
  row,
  workspace,
  text,
  shownAll,
  shownOne,
  query,
  keyDown,
  type,
  click,
  allCommands,
  renderList,
} from "./App.test-helper.js";

describe("App, copy field (SR-128)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const withText = (): Record<string, Handler> => ({
    ...workspace(),
    "element.get": (input) => ({
      element: row(Number(String(input["ref"]).replace("uuid-", "")), {
        identifier: "SR-036",
        text: "Hello\n**bold**",
        properties: { criteria: ["first", "second"] },
        relations: [],
      }),
    }),
  });
  const editorView = (): EditorView => {
    const found = EditorView.findFromDOM(query(".cm-editor"));
    if (found === null) {
      throw new Error("no editor");
    }
    return found;
  };
  const openElement = async () => {
    const fake = fakeBridge(withText());
    await renderList(fake.bridge);
    await keyDown(query('[role="listbox"]'), "Enter");
    return fake;
  };
  const modeline = (): string => text("Modeline") ?? "";
  const copyKeys = { ctrlKey: true, shiftKey: true };

  it("[SR-128/AK-sthw] shows a copy symbol with the ID in the modeline of an element, and none on a list", async () => {
    await renderList(fakeBridge(withText()).bridge);
    expect(shownOne(".modeline .copy")).toBeNull();
    await keyDown(query('[role="listbox"]'), "Enter");
    const field = query('.modeline [data-field="ID"]');
    expect(field.textContent).toBe("SR-000001 (SR-036)");
    expect(field.querySelector(".copy")?.getAttribute("aria-label")).toBe("Copy ID");
    // The rest of the first part, and the modeline's text, are as before.
    expect(modeline()).toBe("SR-000001 (SR-036) · Need · draftWeather stationread-only");
  });

  it("[SR-128/AK-yqp3] copies the ID with the symbol in the modeline, and the modeline says so for a few seconds", async () => {
    const { copyText } = await openElement();
    const symbol = query('.modeline [data-field="ID"] .copy');
    vi.useFakeTimers();
    await act(async () => {
      symbol.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(copyText).toHaveBeenCalledExactlyOnceWith("SR-000001");
    expect(modeline()).toBe("SR-000001 (SR-036) · Need · draftCopied IDWeather stationread-only");
    expect(query(".modeline .notice").getAttribute("role")).toBe("status");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NOTICE_MS - 1);
    });
    expect(modeline()).toContain("Copied ID");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(modeline()).toBe("SR-000001 (SR-036) · Need · draftWeather stationread-only");
  });

  it("[SR-128/AK-yqp3] a second copy restarts the time of the confirmation", async () => {
    const { copyText } = await openElement();
    const symbol = query('.modeline [data-field="ID"] .copy');
    vi.useFakeTimers();
    const copyOnce = () =>
      act(async () => {
        symbol.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await vi.advanceTimersByTimeAsync(0);
      });
    const wait = (ms: number) =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    await copyOnce();
    await wait(NOTICE_MS - 1000);
    await copyOnce();
    await wait(NOTICE_MS - 1000);
    expect(modeline()).toContain("Copied ID");
    await wait(1000);
    expect(modeline()).not.toContain("Copied");
    expect(copyText).toHaveBeenCalledTimes(2);
  });

  it("[SR-128/AK-yqp3] says Copy failed when the main process could not copy", async () => {
    const { copyText } = await openElement();
    copyText.mockResolvedValueOnce(false);
    await click(query('.modeline [data-field="ID"] .copy'));
    expect(modeline()).toContain("Copy failed");
    expect(modeline()).not.toContain("Copied");
  });

  it("[SR-128/AK-pk21] Ctrl+Shift+C in the text copies the text as it is stored, Markdown marks and all", async () => {
    const { copyText } = await openElement();
    editorView().focus();
    await keyDown(query(".cm-content"), "C", copyKeys);
    expect(copyText).toHaveBeenCalledExactlyOnceWith("Hello\n**bold**");
    expect(modeline()).toContain("Copied Text");
  });

  it("[SR-128/AK-pk21] Cmd+Shift+C copies as well", async () => {
    const { copyText } = await openElement();
    editorView().focus();
    await keyDown(query(".cm-content"), "c", { metaKey: true, shiftKey: true });
    expect(copyText).toHaveBeenCalledExactlyOnceWith("Hello\n**bold**");
  });

  it("[SR-128/AK-pk21] Copy field in the command prompt copies the field the cursor was in", async () => {
    const { copyText } = await openElement();
    await act(async () => {
      query('[data-field="criteria"]').focus();
      await Promise.resolve();
    });
    await keyDown(query('[data-field="criteria"]'), "P", copyKeys);
    await allCommands();
    expect([...shownAll('[role="option"]')].map((o) => o.textContent)).toContain("Copy fieldCtrl+Shift+C");
    await type("Copy field");
    await keyDown(query("input"), "Enter");
    expect(copyText).toHaveBeenCalledExactlyOnceWith("first\nsecond");
    expect(modeline()).toContain("Copied criteria");
  });

  it("[SR-128/AK-pk21] copies the ID when the cursor is in no field", async () => {
    const { copyText } = await openElement();
    await keyDown(window, "C", copyKeys);
    expect(copyText).toHaveBeenCalledExactlyOnceWith("SR-000001");
    expect(modeline()).toContain("Copied ID");
  });

  it("[SR-128/AK-pk21] has no Copy field on a list", async () => {
    const { copyText } = await renderListOnly();
    await keyDown(window, "C", copyKeys);
    expect(copyText).not.toHaveBeenCalled();
    await keyDown(window, "P", copyKeys);
    expect([...shownAll('[role="option"]')].map((o) => o.textContent)).not.toContain(
      "Copy fieldCtrl+Shift+C",
    );
  });

  const renderListOnly = async () => {
    const fake = fakeBridge(withText());
    await renderList(fake.bridge);
    return fake;
  };
});

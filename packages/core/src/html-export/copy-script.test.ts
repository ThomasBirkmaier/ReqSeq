// The copy buttons of the HTML export (SR-232 AK1, AK2), run under happy-dom: shown by the script, the value into
// the clipboard, and without a clipboard, or when it refuses, the value selected.
import type { HTMLElement } from "happy-dom";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyButton, copyScript, COPY_SCRIPT } from "./copy-script.js";
import { scriptOf } from "./page-script.js";

const PAGE = `<dl><dt>Short ID</dt><dd><span class="rq-value">SR-e88fb3</span>${copyButton("SR-e88fb3", "Copy Short ID")}</dd></dl>
<p><strong>AK1</strong> ${copyButton("[SR-001/AK-kred]", "Copy criterion reference")}</p><p id="other">x</p>`;

/** A window with `PAGE`, its globals for the script, and the clipboard `clipboard`. */
const browser = (clipboard?: { writeText: (text: string) => Promise<void> }) => {
  const window = new Window();
  window.document.body.innerHTML = PAGE;
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("navigator", clipboard === undefined ? {} : { clipboard });
  vi.stubGlobal("getSelection", () => window.getSelection());
  const timers: (() => void)[] = [];
  vi.stubGlobal("setTimeout", (fn: () => void) => timers.push(fn));
  const buttons = [...window.document.querySelectorAll("button.rq-copy")] as unknown as HTMLElement[];
  return { window, buttons, timers };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("copy buttons (SR-232 AK1, AK2)", () => {
  it("[SR-232/AK-cj5d] are hidden without the script, shown by it, and copy the value of their row", async () => {
    const written: string[] = [];
    const { buttons, timers, window } = browser({
      writeText: (text) => {
        written.push(text);
        return Promise.resolve();
      },
    });
    expect(buttons.map((b) => b.hidden)).toEqual([true, true]);
    const script = copyScript();
    expect(buttons.map((b) => b.hidden)).toEqual([false, false]);
    const [field] = buttons as [HTMLElement];
    field.click();
    await script.clicked();
    expect(written).toEqual(["SR-e88fb3"]);
    expect(field.classList.contains("rq-copied")).toBe(true);
    expect(field.title).toBe("Copied");
    for (const timer of timers) {
      timer();
    }
    expect(field.classList.contains("rq-copied")).toBe(false);
    expect(field.title).toBe("Copy Short ID");
    // A click elsewhere copies nothing.
    (window.document.getElementById("other") as HTMLElement | null)?.click();
    window.document.dispatchEvent(new window.Event("click"));
    expect(written).toEqual(["SR-e88fb3"]);
  });

  it("[SR-232/AK-zr5v] copies the reference of a criterion for test names", async () => {
    const written: string[] = [];
    const { buttons } = browser({
      writeText: (text) => {
        written.push(text);
        return Promise.resolve();
      },
    });
    const [, second] = buttons as [HTMLElement, HTMLElement];
    const script = copyScript();
    second.click();
    await script.clicked();
    expect(written).toEqual(["[SR-001/AK-kred]"]);
  });

  it("selects the value when there is no clipboard or it refuses, and selects nothing without a value", async () => {
    const { buttons, window } = browser();
    const [first, second] = buttons as [HTMLElement, HTMLElement];
    copyScript();
    first.click();
    expect(window.getSelection().toString()).toBe("SR-e88fb3");
    window.getSelection().removeAllRanges();
    second.click();
    expect(window.getSelection().toString()).toBe("");
    const refused = browser({ writeText: () => Promise.reject(new Error("denied")) });
    const [refusedFirst] = refused.buttons as [HTMLElement];
    const script = copyScript();
    refusedFirst.click();
    await script.clicked();
    expect(refused.window.getSelection().toString()).toBe("SR-e88fb3");
    // Without a selection to set, nothing happens.
    vi.stubGlobal("getSelection", () => null);
    refusedFirst.click();
    await script.clicked();
  });

  it("is written as a classic script of the folder", () => {
    expect(COPY_SCRIPT).toBe("assets/copy.js");
    expect(scriptOf(copyScript)).toMatch(/^\(function copyScript\(\) \{[^]*\}\)\(\);\n$/u);
  });
});

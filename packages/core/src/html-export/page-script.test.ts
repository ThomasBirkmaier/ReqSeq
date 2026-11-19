// The scripts of the pages of the HTML export (SR-231 AK4, AK5): theme, menu and diagrams, run under happy-dom.
import type { Element, HTMLElement, HTMLImageElement, HTMLSelectElement } from "happy-dom";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PAGE_SCRIPT_SETTINGS } from "./export.js";
import type { PageScriptSettings } from "./page-script.js";
import { THEME_KEY, pageScript, scriptOf, themeScript } from "./page-script.js";

type Listener = () => void;

/** A `matchMedia` whose answers the test sets, and that tells its listeners. */
const media = (initial: Record<string, boolean>) => {
  const matches = { ...initial };
  const listeners = new Map<string, Listener[]>();
  return {
    matchMedia: (query: string) => ({
      get matches() {
        return matches[query] === true;
      },
      addEventListener: (_type: string, listener: Listener) => {
        listeners.set(query, [...(listeners.get(query) ?? []), listener]);
      },
    }),
    set: (query: string, value: boolean) => {
      matches[query] = value;
      for (const listener of listeners.get(query) ?? []) {
        listener();
      }
    },
  };
};

const LIGHT = "(prefers-color-scheme: light)";
const WIDE = "(min-width: 50em)";

const PAGE = `<a class="sl-skip-link" href="#_top">Skip</a>
<nav><button popovertarget="starlight__sidebar">Menu</button><sl-sidebar-pane id="starlight__sidebar">
<starlight-theme-select><select><option value="dark">Dark</option><option value="light">Light</option><option value="auto" selected>Auto</option></select></starlight-theme-select>
</sl-sidebar-pane></nav>
<div class="main-frame"><starlight-theme-select><select><option value="dark">Dark</option><option value="light">Light</option><option value="auto" selected>Auto</option></select></starlight-theme-select>
<pre class="rq-diagram" data-rq-diagram><code class="language-mermaid">flowchart LR
  accTitle: Wind
  A --> B</code></pre>
<pre class="rq-diagram" data-rq-diagram><code class="language-mermaid">flowchart LR
  A --></code></pre>
<pre><code class="language-mermaid">not marked</code></pre></div>`;

/** A window with `html` as its body, its globals in `globalThis` for the scripts, and the storage `storage`. */
const browser = (
  html: string,
  options: { matches?: Record<string, boolean>; storage?: "throws"; mermaid?: unknown } = {},
) => {
  const window = new Window();
  window.document.body.innerHTML = html;
  const control = media(options.matches ?? {});
  const storage =
    options.storage === "throws"
      ? {
          getItem: () => {
            throw new Error("denied");
          },
          setItem: () => {
            throw new Error("denied");
          },
        }
      : window.localStorage;
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("matchMedia", control.matchMedia);
  vi.stubGlobal("getComputedStyle", (element: Element) => ({
    color: `colour of ${(element as HTMLElement).style.color}`,
    fontFamily: "Docs Sans",
  }));
  vi.stubGlobal("mermaid", options.mermaid);
  return { window, document: window.document, control, storage: window.localStorage };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

const change = (select: HTMLSelectElement, value: string, window: Window): void => {
  select.value = value;
  select.dispatchEvent(new window.Event("change"));
};

describe("themeScript (SR-231 AK4)", () => {
  it("sets the stored theme, else the system's, also when the storage throws", () => {
    const { document, storage } = browser("");
    storage.setItem(THEME_KEY, "dark");
    themeScript();
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    storage.setItem(THEME_KEY, "");
    vi.stubGlobal("matchMedia", media({ [LIGHT]: true }).matchMedia);
    themeScript();
    expect(document.documentElement.dataset["theme"]).toBe("light");
    const blocked = browser("", { storage: "throws" });
    themeScript();
    expect(blocked.document.documentElement.dataset["theme"]).toBe("dark");
  });
});

describe("pageScript: theme select and menu (SR-231 AK4)", () => {
  it("[SR-231/AK-q64j] switches dark, light and auto on every select, stores the choice and follows the system on auto", async () => {
    const { document, storage, control, window } = browser(PAGE, { matches: { [LIGHT]: true } });
    storage.setItem(THEME_KEY, "dark");
    document.documentElement.dataset["theme"] = "dark";
    await pageScript(PAGE_SCRIPT_SETTINGS);
    const selects = [...document.querySelectorAll("select")];
    const [header, menu] = selects as [HTMLSelectElement, HTMLSelectElement];
    expect(selects.map((s) => s.value)).toEqual(["dark", "dark"]);
    change(header, "light", window);
    expect(document.documentElement.dataset["theme"]).toBe("light");
    expect(storage.getItem(THEME_KEY)).toBe("light");
    expect(selects.map((s) => s.value)).toEqual(["light", "light"]);
    // The system's scheme counts only on auto.
    control.set(LIGHT, false);
    expect(document.documentElement.dataset["theme"]).toBe("light");
    change(menu, "something", window);
    expect(storage.getItem(THEME_KEY)).toBe("");
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    control.set(LIGHT, true);
    expect(document.documentElement.dataset["theme"]).toBe("light");
    expect(selects.map((s) => s.value)).toEqual(["auto", "auto"]);
  });

  it("keeps the choice for the page when the storage throws", async () => {
    const { document, window } = browser(PAGE, { storage: "throws" });
    await pageScript(PAGE_SCRIPT_SETTINGS);
    const select = document.querySelector("select") as unknown as HTMLSelectElement;
    expect(select.value).toBe("auto");
    change(select, "light", window);
    expect(document.documentElement.dataset["theme"]).toBe("light");
  });

  it("[SR-231/AK-q64j] makes the sidebar a menu below 50em and keeps the page inert while it is open", async () => {
    const { document, control, window } = browser(PAGE, { matches: { [WIDE]: false } });
    await pageScript(PAGE_SCRIPT_SETTINGS);
    const pane = document.getElementById("starlight__sidebar");
    expect(pane?.getAttribute("popover")).toBe("auto");
    const toggle = (state: string) => {
      const event = new window.Event("toggle") as unknown as Event & { newState: string };
      Object.assign(event, { newState: state });
      pane?.dispatchEvent(event as never);
    };
    toggle("open");
    expect(document.querySelector(".main-frame")?.hasAttribute("inert")).toBe(true);
    expect(document.querySelector(".sl-skip-link")?.hasAttribute("inert")).toBe(true);
    toggle("closed");
    expect(document.querySelector(".main-frame")?.hasAttribute("inert")).toBe(false);
    control.set(WIDE, true);
    expect(pane?.hasAttribute("popover")).toBe(false);
  });

  it("runs on a page without sidebar, selects or diagrams", async () => {
    const { document } = browser("<p>plain</p>", { mermaid: { initialize: vi.fn() } });
    await expect(pageScript(PAGE_SCRIPT_SETTINGS)).resolves.toBeUndefined();
    expect(document.body.innerHTML).toBe("<p>plain</p>");
  });
});

describe("pageScript: diagrams (SR-231 AK5)", () => {
  const svg = '<svg id="x" width="100%" style="max-width: 120px" viewBox="0 0 120.2 40.5"><g/></svg>';

  it("[SR-231/AK-ycws] draws each marked block as an image in the docs' colours, shows the error of a broken one and draws again on a theme change", async () => {
    const initialize = vi.fn();
    const parse = vi.fn((source: string) =>
      source.includes("A -->\n") || source.endsWith("A -->")
        ? Promise.reject(Object.assign(new Error("Parse error on line 2"), {}))
        : Promise.resolve(true),
    );
    const render = vi.fn<(id: string, source: string) => Promise<{ svg: string }>>(() =>
      Promise.resolve({ svg }),
    );
    const { document, window } = browser(PAGE, { mermaid: { initialize, parse, render } });
    document.documentElement.dataset["theme"] = "dark";
    await pageScript(PAGE_SCRIPT_SETTINGS);
    const blocks = [...document.querySelectorAll("pre[data-rq-diagram]")] as unknown as HTMLElement[];
    const image = blocks[0]?.previousElementSibling as HTMLImageElement;
    expect(image.className).toBe("rq-diagram-image");
    expect(image.alt).toBe("Wind");
    expect([image.width, image.height]).toEqual([121, 41]);
    expect(decodeURIComponent(image.src)).toBe(
      'data:image/svg+xml;charset=utf-8,<svg width="121" height="41" id="x" viewBox="0 0 120.2 40.5"><g/></svg>',
    );
    expect(blocks[0]?.hidden).toBe(true);
    expect(blocks[1]?.hidden).toBe(false);
    expect(blocks[1]?.nextElementSibling.textContent).toBe("Error Parse error on line 2");
    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenNthCalledWith(1, "rq-diagram-0", expect.any(String), expect.anything());
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        securityLevel: "strict",
        htmlLabels: false,
        darkMode: true,
        fontFamily: "Docs Sans",
        secure: [...PAGE_SCRIPT_SETTINGS.secure],
        themeVariables: expect.objectContaining({
          darkMode: true,
          primaryTextColor: "colour of var(--sl-color-white)",
          background: "colour of var(--sl-color-black)",
          lineColor: "colour of var(--sl-color-gray-3)",
        }) as unknown,
      }),
    );
    // The unmarked block is never drawn.
    expect(document.body.innerHTML).toContain('<pre><code class="language-mermaid">not marked</code></pre>');
    // A new theme draws again and replaces the image and the error.
    change(document.querySelector("select") as unknown as HTMLSelectElement, "light", window);
    await vi.waitFor(() => {
      expect(initialize).toHaveBeenCalledTimes(2);
    });
    await vi.waitFor(() => {
      expect(document.querySelectorAll(".rq-diagram-image")).toHaveLength(1);
      expect(document.querySelectorAll(".rq-render-error")).toHaveLength(1);
    });
    expect(initialize.mock.calls[1]?.[0]).toMatchObject({ darkMode: false });
    // Choosing the theme that is already shown draws nothing again.
    change(document.querySelector("select") as unknown as HTMLSelectElement, "light", window);
    expect(initialize).toHaveBeenCalledTimes(2);
  });

  it("names the error of what Mermaid throws, and the title Diagram without accTitle", async () => {
    const thrown: unknown[] = [
      new Error("Edge limit exceeded. 600 edges found, but the limit is 500.\nIncrease the limit"),
      { str: "Lexical error on line 1" },
      "plain",
    ];
    const render = vi.fn(() => {
      const next = thrown.shift();
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Mermaid rejects with other values than errors too; the page names each.
      return next === undefined ? Promise.resolve({ svg: "<g/>" }) : Promise.reject(next);
    });
    const blocks = Array.from(
      { length: 4 },
      () => "<pre data-rq-diagram><code>flowchart LR</code></pre>",
    ).join("");
    const { document } = browser(blocks, {
      mermaid: { initialize: vi.fn(), parse: () => Promise.resolve(true), render },
    });
    await pageScript(PAGE_SCRIPT_SETTINGS);
    expect([...document.querySelectorAll(".rq-render-error")].map((e) => e.textContent)).toEqual([
      "Error Edge limit exceeded. 600 edges found, but the limit is 500.",
      "Error Lexical error on line 1",
      "Error plain",
    ]);
    const image = document.querySelector(".rq-diagram-image") as unknown as HTMLImageElement;
    expect([image.alt, image.width, image.height]).toEqual(["Diagram", 0, 0]);
    expect(decodeURIComponent(image.src)).toBe("data:image/svg+xml;charset=utf-8,<g/>");
  });

  it("sizes an image whose drawing names no number in its view box as 0 by 0", async () => {
    const render = vi.fn(() => Promise.resolve({ svg: '<svg viewBox="0 0 wide high"><g/></svg>' }));
    const { document } = browser("<pre data-rq-diagram><code>flowchart LR</code></pre>", {
      mermaid: { initialize: vi.fn(), parse: () => Promise.resolve(true), render },
    });
    await pageScript(PAGE_SCRIPT_SETTINGS);
    const image = document.querySelector(".rq-diagram-image") as unknown as HTMLImageElement;
    expect([image.width, image.height]).toEqual([0, 0]);
  });

  it("leaves every diagram as code without the library", async () => {
    const { document } = browser(PAGE);
    await pageScript(PAGE_SCRIPT_SETTINGS);
    expect(document.querySelectorAll(".rq-diagram-image")).toHaveLength(0);
    expect(document.querySelectorAll(".rq-render-error")).toHaveLength(0);
  });
});

describe("the written scripts", () => {
  it("run in a fresh window as the export writes them", async () => {
    // happy-dom runs scripts only when asked to; the test gives it nothing but the export's own scripts.
    const window = new Window({
      settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true },
    });
    window.document.body.innerHTML = PAGE;
    const run = (code: string): void => {
      const script = window.document.createElement("script");
      script.textContent = code;
      window.document.head.append(script);
    };
    window.localStorage.setItem(THEME_KEY, "light");
    run(scriptOf(themeScript));
    expect(window.document.documentElement.dataset["theme"]).toBe("light");
    const settings: PageScriptSettings = { ...PAGE_SCRIPT_SETTINGS };
    run(scriptOf(pageScript, settings));
    expect((window.document.querySelector("select") as unknown as HTMLSelectElement).value).toBe("light");
    await window.happyDOM.close();
  });
});

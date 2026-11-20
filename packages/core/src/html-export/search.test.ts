// The search of the HTML export (SR-231 AK7): the index file and the script of the search field, under happy-dom.
import vm from "node:vm";
import type { HTMLButtonElement } from "happy-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchEntry, SearchIndex } from "./search.js";
import { SEARCH_INDEX, searchIndexScript } from "./search.js";
import type { SearchPage } from "./search.test-helper.js";
import { SEARCH_FIELD, searchPage } from "./search.test-helper.js";

const entry = (over: Partial<SearchEntry> & { id: string }): SearchEntry => ({
  identifier: "",
  shortId: `SR-${over.id.slice(-6)}`,
  title: "",
  type: "System Requirement",
  ...over,
});

const ENTRIES: SearchEntry[] = [
  entry({ id: "00000000-0000-4000-8000-000000a1a1a1", identifier: "SR-12", title: "Show gusts" }),
  entry({ id: "00000000-0000-4000-8000-000000b2b2b2", identifier: "SR-1", title: "Show wind speed" }),
  entry({ id: "00000000-0000-4000-8000-000000c3c3c3", title: "Prüfung der Böen", type: "Need" }),
  entry({ id: "00000000-0000-4000-8000-000000d4d4d4" }),
  entry({ id: "00000000-0000-4000-8000-000000e5e5e5", title: "Straße sperren" }),
];

const INDEX = searchIndexScript(ENTRIES);

/** The button `selector` names on the page. */
const button = (page: SearchPage, selector: string): HTMLButtonElement =>
  page.window.document.querySelector(selector) as unknown as HTMLButtonElement;

/** Lets the promises of the script settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("searchIndexScript (SR-231 AK7)", () => {
  it("sets the index with the type names once and ASCII only, whatever a server's charset", () => {
    expect(INDEX).toMatch(/^globalThis\.reqseqSearchIndex = \{.*\};\n$/u);
    expect(INDEX).toMatch(/^[\0-\x7f]*$/u);
    expect(INDEX).toContain("Pr\\u00fcfung der B\\u00f6en");
    expect(searchIndexScript([entry({ id: "x", title: "Wind 🌬" })])).toContain("Wind \\ud83c\\udf2c");
    const sandbox: { globalThis?: unknown; reqseqSearchIndex?: SearchIndex } = {};
    sandbox.globalThis = sandbox;
    vm.runInNewContext(INDEX, sandbox);
    expect(sandbox.reqseqSearchIndex).toEqual({
      types: ["System Requirement", "Need"],
      elements: [
        ["SR-12", "SR-a1a1a1", "Show gusts", 0, "00000000-0000-4000-8000-000000a1a1a1"],
        ["SR-1", "SR-b2b2b2", "Show wind speed", 0, "00000000-0000-4000-8000-000000b2b2b2"],
        ["", "SR-c3c3c3", "Prüfung der Böen", 1, "00000000-0000-4000-8000-000000c3c3c3"],
        ["", "SR-d4d4d4", "", 0, "00000000-0000-4000-8000-000000d4d4d4"],
        ["", "SR-e5e5e5", "Stra\u00dfe sperren", 0, "00000000-0000-4000-8000-000000e5e5e5"],
      ],
    });
    expect(SEARCH_INDEX).toBe("assets/search-index.js");
  });
});

describe("the search field (SR-231 AK7)", () => {
  it("is hidden in the frame and shown by its script, with the export's label", () => {
    expect(SEARCH_FIELD).toMatch(/^<reqseq-search class="astro-\w+" hidden="">/u);
    expect(SEARCH_FIELD).not.toContain("data-index");
    const page = searchPage();
    expect(page.field.hasAttribute("hidden")).toBe(false);
    expect(page.input.getAttribute("placeholder")).toBe("Search elements");
    expect(page.input.getAttribute("aria-label")).toBe("Search elements");
    expect(page.window.document.querySelector("kbd")?.textContent).toBe("Ctrl K");
    expect(page.added).toEqual([]);
  });

  it("shows ⌘ K and Meta+K on macOS", () => {
    const { document } = searchPage({ platform: "MacIntel" }).window;
    expect(document.querySelector("kbd")?.textContent).toBe("⌘ K");
    expect(document.querySelector("button[data-open]")?.getAttribute("aria-keyshortcuts")).toBe("Meta+K");
  });

  it("does nothing on a page without the field, a part of it or its own script", () => {
    expect(() => searchPage({ html: "<main></main>" })).not.toThrow();
    const partial = searchPage({ html: SEARCH_FIELD.replace(/<kbd[^]*?<\/kbd>/u, "") });
    expect(partial.field.hasAttribute("hidden")).toBe(true);
    expect(searchPage({ script: false }).field.hasAttribute("hidden")).toBe(true);
  });

  it("loads the index once on the first open, from the way up to the export folder, and finds every word in any case and as a word part", async () => {
    const page = searchPage();
    page.key("k", { ctrlKey: true });
    expect(page.window.document.querySelector("dialog")?.hasAttribute("open")).toBe(true);
    expect(page.added).toHaveLength(1);
    expect(page.added[0]?.getAttribute("src")).toBe("../assets/search-index.js");
    page.type("show WIND");
    expect(page.status()).toBe("");
    page.load(INDEX);
    await settle();
    expect(page.hits()).toEqual([
      {
        text: "SR-1 Show wind speed | System Requirement · SR-b2b2b2",
        href: "../elements/00000000-0000-4000-8000-000000b2b2b2.html",
      },
    ]);
    expect(page.status()).toBe("1 element found");
    page.type("  PRÜF   böen ");
    await settle();
    expect(page.hits()).toEqual([
      {
        text: "SR-c3c3c3 Prüfung der Böen | Need",
        href: "../elements/00000000-0000-4000-8000-000000c3c3c3.html",
      },
    ]);
    page.type("d4d4");
    await settle();
    expect(page.hits().map((h) => h.text)).toEqual(["SR-d4d4d4 | System Requirement"]);
    page.type("STRASSE");
    await settle();
    expect(page.hits().map((h) => h.text)).toEqual(["SR-e5e5e5 Straße sperren | System Requirement"]);
    page.type("wind\ngusts");
    await settle();
    expect(page.hits()).toEqual([]);
    expect(page.status()).toBe("No elements found");
    page.type("   ");
    await settle();
    expect(page.hits()).toEqual([]);
    expect(page.status()).toBe("");
    page.key("k", { metaKey: true });
    page.key("k", { metaKey: true });
    expect(page.added).toHaveLength(1);
  });

  it("puts an element whose identifier or short ID is the whole query first, then the order of the index", async () => {
    const page = searchPage({ src: "assets/reqseq.js" });
    button(page, "button[data-open]").click();
    expect(page.added[0]?.getAttribute("src")).toBe("assets/search-index.js");
    page.load(INDEX);
    page.type("Sr-1 ");
    await settle();
    expect(page.hits().map((h) => h.href)).toEqual([
      "elements/00000000-0000-4000-8000-000000b2b2b2.html",
      "elements/00000000-0000-4000-8000-000000a1a1a1.html",
    ]);
    expect(page.status()).toBe("2 elements found");
    page.type("sr-a1a1a1");
    await settle();
    expect(page.hits()).toHaveLength(1);
  });

  it("shows 50 hits at a time and the next ones on Show more, which keeps the dialog open", async () => {
    const many = searchIndexScript(
      Array.from({ length: 120 }, (_, i) =>
        entry({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, title: `Wind ${String(i)}` }),
      ),
    );
    const page = searchPage({ src: null });
    page.key("k", { ctrlKey: true });
    page.load(many);
    page.type("wind");
    await settle();
    const more = button(page, ".rq-search-more");
    expect(page.status()).toBe("120 elements found");
    expect(page.hits()).toHaveLength(50);
    expect(page.hits()[0]?.href).toBe("elements/00000000-0000-4000-8000-000000000000.html");
    expect(more.textContent).toBe("Show 50 more");
    expect(more.getAttribute("type")).toBe("button");
    more.click();
    expect(page.hits()).toHaveLength(100);
    expect(page.window.document.activeElement.getAttribute("href")).toBe(page.hits()[50]?.href);
    expect(more.textContent).toBe("Show 20 more");
    const arrow = (key: string) => {
      page.window.document.activeElement.dispatchEvent(
        new page.window.KeyboardEvent("keydown", { key, bubbles: true }),
      );
    };
    more.focus();
    arrow("ArrowDown");
    expect(page.window.document.activeElement).toBe(more);
    arrow("ArrowUp");
    expect(page.window.document.activeElement.getAttribute("href")).toBe(page.hits()[99]?.href);
    button(page, "button.close").focus();
    arrow("ArrowUp");
    expect(page.window.document.activeElement).toBe(button(page, "button.close"));
    more.click();
    expect(page.hits()).toHaveLength(120);
    expect(more.hidden).toBe(true);
    more.click();
    expect(page.hits()).toHaveLength(120);
    expect(page.assign).not.toHaveBeenCalled();
  });

  it("says when the index does not load, and tries again on the next search", async () => {
    const page = searchPage();
    page.key("k", { ctrlKey: true });
    page.type("wind");
    page.fail();
    await settle();
    expect(page.status()).toBe("Search unavailable");
    expect(page.hits()).toEqual([]);
    page.type("wind ");
    expect(page.added).toHaveLength(2);
    // A file that ran but set no index is no index either.
    page.load("");
    await settle();
    expect(page.status()).toBe("Search unavailable");
    page.type("wind");
    page.load(INDEX);
    await settle();
    expect(page.status()).toBe("1 element found");
  });

  it("shows only the hits of the last query when an earlier one was still loading", async () => {
    const page = searchPage();
    page.type("gusts");
    page.type("speed");
    page.load(INDEX);
    await settle();
    expect(page.hits().map((h) => h.text)).toEqual(["SR-1 Show wind speed | System Requirement · SR-b2b2b2"]);
  });

  it("opens the first hit on Enter, also while the index loads, and nothing without a hit or an index", async () => {
    const page = searchPage();
    const form = page.window.document.querySelector("reqseq-search form");
    page.key("k", { ctrlKey: true });
    page.type("gusts");
    form?.dispatchEvent(new page.window.Event("submit", { cancelable: true }));
    page.load(INDEX);
    await settle();
    expect(page.assign).toHaveBeenCalledWith("../elements/00000000-0000-4000-8000-000000a1a1a1.html");
    page.type("rain");
    form?.dispatchEvent(new page.window.Event("submit", { cancelable: true }));
    await settle();
    expect(page.assign).toHaveBeenCalledTimes(1);
    const failing = searchPage();
    failing.type("wind");
    failing.window.document
      .querySelector("reqseq-search form")
      ?.dispatchEvent(new failing.window.Event("submit", { cancelable: true }));
    failing.fail();
    await settle();
    expect(failing.assign).not.toHaveBeenCalled();
  });

  it("moves between the hits with Up and Down, and closes on Ctrl+K, Close and a click beside the dialog", async () => {
    const page = searchPage();
    const document = page.window.document;
    const dialog = document.querySelector("dialog");
    page.key("k", { ctrlKey: true });
    page.load(INDEX);
    page.type("show");
    await settle();
    const arrow = (key: string) => {
      dialog?.dispatchEvent(new page.window.KeyboardEvent("keydown", { key, bubbles: true }));
    };
    arrow("ArrowDown");
    expect(document.activeElement.getAttribute("href")).toBe(page.hits()[0]?.href);
    arrow("ArrowDown");
    expect(document.activeElement.getAttribute("href")).toBe(page.hits()[1]?.href);
    arrow("ArrowDown");
    expect(document.activeElement.getAttribute("href")).toBe(page.hits()[1]?.href);
    arrow("ArrowUp");
    arrow("ArrowUp");
    expect(document.activeElement).toBe(page.input);
    arrow("Tab");
    page.key("x", { ctrlKey: true });
    page.key("k");
    expect(dialog?.hasAttribute("open")).toBe(true);
    page.key("K", { ctrlKey: true });
    expect(dialog?.hasAttribute("open")).toBe(false);
    page.key("k", { ctrlKey: true });
    button(page, "button.close").click();
    expect(dialog?.hasAttribute("open")).toBe(false);
    page.key("k", { ctrlKey: true });
    document.querySelector("form")?.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    expect(dialog?.hasAttribute("open")).toBe(true);
    dialog?.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    expect(dialog?.hasAttribute("open")).toBe(false);
  });
});

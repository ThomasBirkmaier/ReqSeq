// The search of the HTML export (SR-231 AK7; packages/core/docs/html-export.md): the index file and the script of
// the search field in the docs' header (`reqseq-search`, kept by `export-theme.ts`, hidden without script).
//
// - `searchIndexScript` writes `assets/search-index.js`, a classic script that sets `reqseqSearchIndex`: the type
//   names once, then per element with a page its identifier ("" without one), short ID, title ("" without one), type
//   and UUID, in the order of the store, in NFC, with every character beyond ASCII as `\uXXXX`, so a server's
//   charset cannot change it. A script file, never `fetch`, which `file://` blocks (ADR-0017).
// - `searchScript` runs at the end of `assets/reqseq.js`. It shows the field, opens it on a click or Ctrl+K / Cmd+K,
//   and on the first open adds the index file as a `<script>` (from its own `src`, the way up to the export folder).
//   A word list is the query in NFC, lower case and split at white space; an element is a hit when each word occurs
//   in its identifier, short ID or title in lower case, also as a word part. Hits whose identifier or short ID is the
//   whole query come first, the others in index order; the list shows them 50 at a time, as text and each a link
//   to the page of its element.
import type { Metamodel } from "../metamodel/index.js";
import { findType } from "../metamodel/index.js";
import type { ElementRecord, ShortIds } from "../model/index.js";
import { identifierField } from "../model/index.js";

/** The index file, relative to the export folder. */
export const SEARCH_INDEX = "assets/search-index.js";

/** What the search shows and finds of one element. */
export interface SearchEntry {
  readonly identifier: string;
  readonly shortId: string;
  readonly title: string;
  readonly type: string;
  /** The UUID, which names the page. */
  readonly id: string;
}

/** The index of a search: the type names and a row per element (see the file comment). */
export interface SearchIndex {
  readonly types: readonly string[];
  readonly elements: readonly (readonly [string, string, string, number, string])[];
}

/** The search entries of `records`, the elements with a page. */
export const searchEntries = (
  records: Iterable<ElementRecord>,
  metamodel: Metamodel,
  shortIds: ShortIds,
  titleKey: string,
): SearchEntry[] =>
  [...records].map((record) => {
    const title = record.data[titleKey];
    return {
      identifier: (identifierField(shortIds, record).identifier ?? "").normalize("NFC"),
      shortId: shortIds.of(record),
      title: typeof title === "string" ? title.normalize("NFC") : "",
      type: (findType(metamodel, record.type)?.name ?? record.type).normalize("NFC"),
      id: record.id,
    };
  });

/** Each UTF-16 unit beyond ASCII as `\uXXXX`. */
const asciiOnly = (json: string): string =>
  json.replace(/[^\0-\x7f]/gu, (character) =>
    [...Array(character.length).keys()]
      .map((i) => `\\u${character.charCodeAt(i).toString(16).padStart(4, "0")}`)
      .join(""),
  );

/** `assets/search-index.js` for `entries` (see the file comment). */
export const searchIndexScript = (entries: readonly SearchEntry[]): string => {
  const types: string[] = [];
  const typeAt = new Map<string, number>();
  const elements = entries.map((entry) => {
    let at = typeAt.get(entry.type);
    if (at === undefined) {
      at = types.length;
      types.push(entry.type);
      typeAt.set(entry.type, at);
    }
    return [entry.identifier, entry.shortId, entry.title, at, entry.id] as const;
  });
  const index: SearchIndex = { types, elements };
  return `globalThis.reqseqSearchIndex = ${asciiOnly(JSON.stringify(index))};\n`;
};

/** What `searchScript` takes. */
export interface SearchScriptSettings {
  /** The index file, relative to the export folder. */
  readonly index: string;
}

/** The settings `assets/reqseq.js` searches with. */
export const SEARCH_SCRIPT_SETTINGS: SearchScriptSettings = { index: SEARCH_INDEX };

// Core has no DOM types (its `lib` is ES only), so the script takes what it uses from `globalThis` as these.
interface Node {
  textContent: string;
}
interface Element extends Node {
  className: string;
  hidden: boolean;
  href: string;
  src: string;
  type: string;
  value: string;
  placeholder: string;
  readonly open: boolean;
  append: (...nodes: Node[]) => void;
  after: (node: Node) => void;
  remove: () => void;
  replaceChildren: (...nodes: Node[]) => void;
  focus: () => void;
  select: () => void;
  showModal: () => void;
  close: () => void;
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, value: string) => void;
  querySelector: (selector: string) => Element | null;
  querySelectorAll: (selector: string) => Iterable<Element>;
  addEventListener: (type: string, listener: (event: BrowserEvent) => void) => void;
}
interface BrowserEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly target: unknown;
  preventDefault: () => void;
}
interface SearchBrowser {
  readonly document: {
    readonly head: Element;
    readonly currentScript: Element | null;
    readonly activeElement: unknown;
    createElement: (name: string) => Element;
    querySelector: (selector: string) => Element | null;
  };
  readonly navigator: { readonly platform: string };
  readonly location: { assign: (url: string) => void };
  addEventListener: (type: string, listener: (event: BrowserEvent) => void) => void;
  readonly reqseqSearchIndex?: SearchIndex;
}

/** The search field of every page (see the file comment). */
export function searchScript(settings: SearchScriptSettings): void {
  const browser = globalThis as unknown as SearchBrowser;
  const { document, navigator, location } = browser;
  const field = document.querySelector("reqseq-search");
  const script = document.currentScript;
  if (field === null || script === null) {
    return;
  }
  const parts = [
    "button[data-open]",
    "kbd",
    "dialog",
    "form",
    "input",
    ".status",
    "ul.hits",
    "button.close",
  ].map((selector) => field.querySelector(selector));
  if (parts.includes(null)) {
    return;
  }
  const [open, kbd, dialog, form, input, status, hits, close] = parts as Element[] as [
    Element,
    Element,
    Element,
    Element,
    Element,
    Element,
    Element,
    Element,
  ];
  const root = (script.getAttribute("src") ?? "").replace(/[^/]*\/[^/]*$/u, "");
  const PAGE = 50;
  const label = "Search elements";
  input.placeholder = label;
  input.setAttribute("aria-label", label);
  if (/Mac|iPhone|iPad/u.test(navigator.platform)) {
    kbd.textContent = "⌘ K";
    open.setAttribute("aria-keyshortcuts", "Meta+K");
  }
  field.hidden = false;

  interface Item {
    readonly hay: string;
    readonly identifier: string;
    readonly shortId: string;
    readonly title: string;
    readonly type: string;
    readonly id: string;
  }
  // One load at a time; a failed one is forgotten, so the next search tries again.
  let loading: Promise<Item[]> | undefined;
  const load = (): Promise<Item[]> => {
    if (loading === undefined) {
      const tag = document.createElement("script");
      const pending = new Promise<Item[]>((resolve, reject) => {
        tag.addEventListener("load", () => {
          const index = browser.reqseqSearchIndex;
          if (index === undefined) {
            reject(new Error("the search index is empty"));
            return;
          }
          resolve(
            index.elements.map(([identifier, shortId, title, type, id]) => ({
              hay: `${identifier}\n${shortId}\n${title}`.toLowerCase(),
              identifier,
              shortId,
              title,
              type: String(index.types[type]),
              id,
            })),
          );
        });
        tag.addEventListener("error", () => {
          reject(new Error("the search index did not load"));
        });
      });
      pending.catch(() => {
        tag.remove();
        loading = undefined;
      });
      loading = pending;
      tag.src = `${root}${settings.index}`;
      document.head.append(tag);
    }
    return loading;
  };

  const wordsOf = (query: string): string[] =>
    query
      .normalize("NFC")
      .toLowerCase()
      .split(/\s+/u)
      .filter((word) => word !== "");
  const pageOf = (item: Item): string => `${root}elements/${item.id}.html`;
  const row = (item: Item): Element => {
    const entry = document.createElement("li");
    const link = document.createElement("a");
    link.href = pageOf(item);
    const name = document.createElement("strong");
    name.textContent = [item.identifier || item.shortId, item.title].filter((t) => t !== "").join(" ");
    const facts = document.createElement("span");
    facts.textContent = [item.type, ...(item.identifier === "" ? [] : [item.shortId])].join(" · ");
    link.append(name, facts);
    entry.append(link);
    return entry;
  };

  const more = document.createElement("button");
  more.type = "button";
  more.className = "rq-search-more";
  more.hidden = true;
  hits.after(more);
  let found: Item[] = [];
  let shown = 0;
  const showMore = (): Element | undefined => {
    const next = found.slice(shown, shown + PAGE).map(row);
    hits.append(...next);
    shown += next.length;
    const rest = Math.min(PAGE, found.length - shown);
    more.hidden = rest === 0;
    more.textContent = `Show ${String(rest)} more`;
    return next[0];
  };

  /** The hits of `query` in `items` (see the file comment). */
  const hitsOf = (items: readonly Item[], query: string): Item[] => {
    const words = wordsOf(query);
    const whole = words.join(" ");
    const first: Item[] = [];
    const rest: Item[] = [];
    for (const item of words.length === 0 ? [] : items) {
      if (words.every((word) => item.hay.includes(word))) {
        const exact = item.identifier.toLowerCase() === whole || item.shortId.toLowerCase() === whole;
        (exact ? first : rest).push(item);
      }
    }
    return [...first, ...rest];
  };

  let run = 0;
  /** Shows the hits of the current query; a later call wins over an earlier one still loading. */
  const render = async (): Promise<void> => {
    const query = input.value;
    const mine = ++run;
    let items: Item[] = [];
    let message = "";
    if (wordsOf(query).length > 0) {
      try {
        items = await load();
      } catch {
        message = "Search unavailable";
      }
    }
    if (mine !== run) {
      return;
    }
    found = hitsOf(items, query);
    shown = 0;
    hits.replaceChildren();
    showMore();
    status.textContent =
      message !== "" || wordsOf(query).length === 0
        ? message
        : found.length === 0
          ? "No elements found"
          : `${String(found.length)} ${found.length === 1 ? "element" : "elements"} found`;
  };

  const show = (): void => {
    dialog.showModal();
    input.focus();
    input.select();
    void load().catch(() => undefined);
    void render();
  };
  open.addEventListener("click", show);
  browser.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (dialog.open) {
        dialog.close();
      } else {
        show();
      }
    }
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });
  close.addEventListener("click", () => {
    dialog.close();
  });
  input.addEventListener("input", () => {
    void render();
  });
  more.addEventListener("click", () => {
    showMore()?.querySelector("a")?.focus();
  });
  // Enter in the box opens the first hit, also when the index is still loading.
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void load().then(
      (items) => {
        const first = hitsOf(items, input.value)[0];
        if (first !== undefined) {
          location.assign(pageOf(first));
        }
      },
      () => undefined,
    );
  });
  // Down from the box goes to the first hit, Up and Down move between hits, Up from the first goes back.
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    const links = [...hits.querySelectorAll("a")];
    const at = links.indexOf(document.activeElement as Element);
    const next = event.key === "ArrowDown" ? at + 1 : at - 1;
    if (next < 0) {
      input.focus();
    } else {
      links[next]?.focus();
    }
    event.preventDefault();
  });
}

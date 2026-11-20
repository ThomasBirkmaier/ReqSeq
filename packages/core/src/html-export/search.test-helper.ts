// A page with the docs' search field under happy-dom, the search script running on it, and the index file it adds
// loaded on demand: tests evaluate the written `search-index.js` with `node:vm` in place of the browser.
import vm from "node:vm";
import type { HTMLElement, HTMLScriptElement } from "happy-dom";
import { Window } from "happy-dom";
import { vi } from "vitest";
import { DOCS_FRAME } from "./docs-theme.generated.js";
import type { SearchIndex } from "./search.js";
import { SEARCH_SCRIPT_SETTINGS, searchScript } from "./search.js";

/** The docs' search field as the frame of every page holds it. */
export const SEARCH_FIELD = String(/<reqseq-search[^]*?<\/reqseq-search>/u.exec(DOCS_FRAME.join(""))?.[0]);

export interface SearchPage {
  readonly window: Window;
  readonly field: HTMLElement;
  readonly input: HTMLInputElement;
  /** The `<script>` elements the search added for its index, in order. */
  readonly added: HTMLScriptElement[];
  readonly assign: ReturnType<typeof vi.fn>;
  /** Runs `text` (the index file) and tells the last added script that it loaded. */
  readonly load: (text: string) => void;
  /** Tells the last added script that it failed. */
  readonly fail: () => void;
  readonly type: (value: string) => void;
  readonly key: (key: string, modifiers?: { ctrlKey?: boolean; metaKey?: boolean }) => void;
  readonly status: () => string;
  /** The text of each hit and its link. */
  readonly hits: () => { text: string; href: string }[];
}

interface HTMLInputElement extends HTMLElement {
  value: string;
}

/** Runs the search script on a page with `html` as its body, loaded from `src`. */
export const searchPage = (
  options: { html?: string; src?: string | null; platform?: string; script?: boolean } = {},
): SearchPage => {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = options.html ?? `${SEARCH_FIELD}<main></main>`;
  const added: HTMLScriptElement[] = [];
  vi.spyOn(document.head, "append").mockImplementation((...nodes) => {
    added.push(...(nodes as HTMLScriptElement[]));
  });
  const current = document.createElement("script");
  if (options.src !== null) {
    current.setAttribute("src", options.src ?? "../assets/reqseq.js");
  }
  Object.defineProperty(document, "currentScript", {
    get: () => (options.script === false ? null : current),
  });
  const assign = vi.fn();
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", { platform: options.platform ?? "Linux x86_64" });
  vi.stubGlobal("location", { assign });
  vi.stubGlobal("addEventListener", window.addEventListener.bind(window));
  vi.stubGlobal("reqseqSearchIndex", undefined);
  searchScript(SEARCH_SCRIPT_SETTINGS);
  const field = document.querySelector("reqseq-search") as unknown as HTMLElement;
  const input = document.querySelector("reqseq-search input") as unknown as HTMLInputElement;
  return {
    window,
    field,
    input,
    added,
    assign,
    load: (text) => {
      const sandbox: { globalThis?: unknown; reqseqSearchIndex?: SearchIndex } = {};
      sandbox.globalThis = sandbox;
      vm.runInNewContext(text, sandbox);
      vi.stubGlobal("reqseqSearchIndex", sandbox.reqseqSearchIndex);
      added.at(-1)?.dispatchEvent(new window.Event("load"));
    },
    fail: () => {
      added.at(-1)?.dispatchEvent(new window.Event("error"));
    },
    type: (value) => {
      input.value = value;
      input.dispatchEvent(new window.Event("input"));
    },
    key: (key, modifiers = {}) => {
      window.dispatchEvent(new window.KeyboardEvent("keydown", { key, ...modifiers }));
    },
    status: () => String(document.querySelector("reqseq-search .status")?.textContent),
    hits: () =>
      [...document.querySelectorAll("reqseq-search .hits a")].map((a) => ({
        text: [...a.children].map((c) => c.textContent).join(" | "),
        href: String(a.getAttribute("href")),
      })),
  };
};

// The two scripts of every page of the HTML export (SR-231 AK4, AK5), written as `assets/theme.js` and
// `assets/reqseq.js`. Both are classic scripts: `file://` refuses module scripts, the policy inline ones. Each is a
// self-contained function (no imports, no names from this module), written out as `(${fn})(settings)`.
//
// - `themeScript`, in `<head>`, sets `data-theme` before the first paint as Starlight does: the stored choice, else
//   the system's (`prefers-color-scheme`).
// - `pageScript`, at the end of `<body>`: the theme selects (dark, light, auto; stored in `localStorage`, which may
//   throw), the sidebar pane, which below the docs' breakpoint of 50em becomes the menu its button opens (a popover,
//   with the rest of the page inert while it is open), and the diagrams. It draws only the blocks the export marked
//   (`pre[data-rq-diagram]`) with the bundled Mermaid (`assets/mermaid.js`, the global `mermaid`), reading the
//   source with `textContent`, in the colours of the docs' tokens, and shows each drawing as a `data:` URL in an
//   `<img>`, so nothing in it can run; it draws again when the theme changes. A diagram Mermaid cannot draw keeps its
//   source, and the error follows it (SR-096 AK3). Without scripts every diagram stays code.

/** What `pageScript` needs to draw diagrams: Mermaid's settings, and the docs' token of each colour role. */
export interface PageScriptSettings {
  readonly mermaid: Readonly<Record<string, unknown>>;
  readonly secure: readonly string[];
  /** Each colour variable of Mermaid's theme and its role (`DIAGRAM_COLOURS`). */
  readonly colours: Readonly<Record<string, string>>;
  /** Each role and the CSS variable of the docs that gives its colour. */
  readonly tokens: Readonly<Record<string, string>>;
}

/** The key Starlight stores the theme under. */
export const THEME_KEY = "starlight-theme";

// Core has no DOM types (its `lib` is ES only), so the scripts take what they use from `globalThis` as these.
interface Node {
  textContent: string;
}
interface Element extends Node {
  className: string;
  hidden: boolean;
  value: string;
  width: number;
  height: number;
  alt: string;
  src: string;
  readonly style: { color: string } & Record<string, string>;
  readonly classList: { contains: (name: string) => boolean };
  readonly previousElementSibling: Element | null;
  readonly nextElementSibling: Element | null;
  readonly dataset: Record<string, string | undefined>;
  append: (...nodes: Node[]) => void;
  before: (node: Node) => void;
  after: (node: Node) => void;
  remove: () => void;
  replaceChildren: () => void;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
  toggleAttribute: (name: string, on: boolean) => void;
  addEventListener: (type: string, listener: (event: { newState?: string }) => void) => void;
}
interface Browser {
  readonly document: {
    readonly documentElement: Element;
    readonly body: Element;
    createElement: (name: string) => Element;
    createTextNode: (text: string) => Node;
    getElementById: (id: string) => Element | null;
    querySelectorAll: (selector: string) => Iterable<Element>;
  };
  readonly localStorage: {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
  };
  matchMedia: (query: string) => {
    matches: boolean;
    addEventListener: (type: string, listener: () => void) => void;
  };
  getComputedStyle: (element: Element) => { color: string; fontFamily: string };
  readonly mermaid?: MermaidApi;
}

/** `assets/theme.js` (see the file comment). */
export function themeScript(): void {
  const { document, localStorage, matchMedia } = globalThis as unknown as Browser;
  let stored: string | null;
  try {
    stored = localStorage.getItem("starlight-theme");
  } catch {
    stored = null;
  }
  const light = matchMedia("(prefers-color-scheme: light)").matches;
  document.documentElement.dataset["theme"] =
    stored === "light" || stored === "dark" ? stored : light ? "light" : "dark";
}

interface MermaidApi {
  initialize: (config: Record<string, unknown>) => void;
  parse: (source: string) => Promise<unknown>;
  render: (id: string, source: string, into: Element) => Promise<{ svg: string }>;
}

/** `assets/reqseq.js` (see the file comment); returns the promise of the first drawing, for tests. */
export function pageScript(settings: PageScriptSettings): Promise<void> {
  const browser = globalThis as unknown as Browser;
  const { document, localStorage, matchMedia, getComputedStyle } = browser;
  const root = document.documentElement;
  const read = (): string => {
    try {
      const stored = localStorage.getItem("starlight-theme");
      return stored === "light" || stored === "dark" ? stored : "auto";
    } catch {
      return "auto";
    }
  };
  const store = (choice: string): void => {
    try {
      localStorage.setItem("starlight-theme", choice === "auto" ? "" : choice);
    } catch {
      // A browser that keeps nothing for `file://` pages: the choice holds for this page.
    }
  };
  const system = (): string => (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  const selects = [...document.querySelectorAll("starlight-theme-select select")];

  // Diagrams: drawn one after the other, again on each change of the theme.
  const mermaid = browser.mermaid;
  const blocks = [...document.querySelectorAll("pre[data-rq-diagram]")];
  let queue: Promise<void> = Promise.resolve();
  const colourOf = (variable: string): string => {
    const probe = document.createElement("span");
    probe.style.color = `var(${variable})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  };
  const message = (error: unknown): string => {
    if (error instanceof Error) {
      return error.message.startsWith("Edge limit exceeded.")
        ? error.message.replace(/\n[^]*$/u, "")
        : error.message;
    }
    if (typeof error === "object" && error !== null && "str" in error) {
      return String(error.str);
    }
    return String(error);
  };
  const image = (svg: string, source: string): Element => {
    const head = /<svg\b[^>]*>/u.exec(svg)?.[0] ?? "<svg>";
    const box = (/\bviewBox="([^"]*)"/u.exec(head)?.[1] ?? "")
      .trim()
      .split(/[\s,]+/u)
      .map(Number);
    const [width = 0, height = 0] = box.slice(2).map((v) => (Number.isFinite(v) ? Math.ceil(v) : 0));
    const sized = head
      .replace(/\s(?:width|height)="[^"]*"/gu, "")
      .replace(/\sstyle="[^"]*"/u, "")
      .replace(/^<svg\b/u, `<svg width="${String(width)}" height="${String(height)}"`);
    const img = document.createElement("img");
    img.className = "rq-diagram-image";
    img.width = width;
    img.height = height;
    img.alt = (/^\s*accTitle\s*:\s*(.*)$/mu.exec(source)?.[1] ?? "").trim() || "Diagram";
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(head, () => sized))}`;
    return img;
  };
  const draw = async (api: MermaidApi): Promise<void> => {
    const dark = root.dataset["theme"] === "dark";
    const roles = Object.fromEntries(
      Object.entries(settings.tokens).map(([role, variable]) => [role, colourOf(variable)]),
    );
    const fontFamily = getComputedStyle(root).fontFamily;
    api.initialize({
      ...settings.mermaid,
      darkMode: dark,
      fontFamily,
      themeVariables: {
        darkMode: dark,
        fontFamily,
        ...Object.fromEntries(Object.entries(settings.colours).map(([name, role]) => [name, roles[role]])),
      },
      secure: [...settings.secure],
    });
    // Out of view but laid out, so that Mermaid can measure the text.
    const into = document.createElement("div");
    into.setAttribute("aria-hidden", "true");
    Object.assign(into.style, { position: "fixed", left: "-10000px", top: "0", visibility: "hidden" });
    document.body.append(into);
    for (const [index, block] of blocks.entries()) {
      const previous = block.previousElementSibling;
      if (previous?.classList.contains("rq-diagram-image") === true) {
        previous.remove();
      }
      const next = block.nextElementSibling;
      if (next?.classList.contains("rq-render-error") === true) {
        next.remove();
      }
      const source = block.textContent;
      try {
        await api.parse(source);
        const { svg } = await api.render(`rq-diagram-${String(index)}`, source, into);
        block.before(image(svg, source));
        block.hidden = true;
      } catch (error) {
        block.hidden = false;
        const shown = document.createElement("div");
        shown.className = "rq-render-error";
        const label = document.createElement("span");
        label.className = "rq-render-error-label";
        label.textContent = "Error";
        shown.append(label, document.createTextNode(` ${message(error)}`));
        block.after(shown);
      } finally {
        into.replaceChildren();
      }
    }
    into.remove();
  };
  const redraw = (): Promise<void> => {
    if (mermaid === undefined || blocks.length === 0) {
      return queue;
    }
    queue = queue.then(() => draw(mermaid));
    return queue;
  };

  const apply = (choice: string): void => {
    const theme = choice === "auto" ? system() : choice;
    const changed = root.dataset["theme"] !== theme;
    root.dataset["theme"] = theme;
    for (const select of selects) {
      select.value = choice;
    }
    if (changed) {
      void redraw();
    }
  };
  for (const select of selects) {
    select.value = read();
    select.addEventListener("change", () => {
      const choice = ["dark", "light"].includes(select.value) ? select.value : "auto";
      store(choice);
      apply(choice);
    });
  }
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (read() === "auto") {
      apply("auto");
    }
  });

  // The sidebar pane: a popover only below 50em; while it is open, the rest of the page takes no input.
  const pane = document.getElementById("starlight__sidebar");
  if (pane !== null) {
    const wide = matchMedia("(min-width: 50em)");
    const fit = (): void => {
      if (wide.matches) {
        pane.removeAttribute("popover");
      } else {
        pane.setAttribute("popover", "auto");
      }
    };
    fit();
    wide.addEventListener("change", fit);
    pane.addEventListener("toggle", (event) => {
      const open = event.newState === "open";
      for (const element of document.querySelectorAll(".main-frame, .sl-skip-link")) {
        element.toggleAttribute("inert", open);
      }
    });
  }
  return redraw();
}

/** A script that runs `fn` with `settings` (JSON) when it loads. */
export const scriptOf = (fn: (settings: never) => unknown, settings?: unknown): string =>
  `(${fn.toString()})(${settings === undefined ? "" : JSON.stringify(settings)});\n`;

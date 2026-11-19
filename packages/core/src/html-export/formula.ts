// Formulas of the HTML export, set at export time by KaTeX (SR-231 AK5, ADR-0002) with the options of the app's
// preview (`render-options.ts`). What KaTeX writes is put into the page only when it matches the grammar below:
// the elements KaTeX's HTML, MathML and SVG output use, each with the attributes it may carry and a value pattern
// per attribute (`style` as `name:value;` pairs of numbers, lengths, words, `#` colours and `var(--name)`), every
// value quoted and without `"`, `<` and `>`, every text without `<` and with `&` only in a character reference.
// Anything else is no formula of KaTeX's: it stays source text and is `html.unsafe-content`, as raw HTML is.
// An untrusted command (`\href`, `\includegraphics`, …) is drawn as its source in the docs' grey (`errorColor`).
import katex from "katex";
import { KATEX_OPTIONS } from "./render-options.js";

/** The grey an untrusted command is drawn in: the docs' muted text token. */
export const ERROR_COLOUR = "var(--sl-color-gray-3)";

export type SetFormula = { readonly html: string } | { readonly error: string };

/** `source` set by KaTeX (display style for `display`), or the message of its error. */
export const setFormula = (source: string, display: boolean): SetFormula => {
  try {
    return {
      html: katex.renderToString(source, {
        ...KATEX_OPTIONS,
        displayMode: display,
        errorColor: ERROR_COLOUR,
      }),
    };
  } catch (error) {
    // KaTeX throws a ParseError that names the place ("KaTeX parse error: Expected '}', …").
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

const NUMBER = String.raw`[-+]?(?:\d+(?:\.\d*)?|\.\d+)`;
const LENGTH = `${NUMBER}(?:em|ex|px|pt|mu|%)?`;
const WORD = "[A-Za-z][A-Za-z0-9-]*";
const COLOUR = `(?:#[0-9A-Fa-f]{3,8}|${WORD}|var\\(--[a-z0-9-]+\\))`;
const STYLE_VALUE = `(?:${LENGTH}|${COLOUR})`;
const whole = (pattern: string): RegExp => new RegExp(`^(?:${pattern})$`, "u");

/** The value patterns, by attribute kind. */
const VALUES = {
  words: whole(`${WORD}(?: ${WORD})*`),
  lengths: whole(`${LENGTH}(?: ${LENGTH})*`),
  /** A MathML length, also relative to the element's own size (`-1width`, `+0.5height`). */
  padding: whole(`${NUMBER}(?:em|ex|px|pt|mu|%|width|height|depth)?`),
  numbers: whole(`${NUMBER}(?: ${NUMBER})*`),
  colour: whole(COLOUR),
  style: whole(`(?:[a-z-]+:\\s?${STYLE_VALUE}(?: ${STYLE_VALUE})*;?)*`),
  path: /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]*$/u,
  classes: whole(`[A-Za-z0-9_-]+(?: [A-Za-z0-9_-]+)*`),
  true: /^true$/u,
  block: /^(?:block|inline)$/u,
  mathml: /^http:\/\/www\.w3\.org\/1998\/Math\/MathML$/u,
  svg: /^http:\/\/www\.w3\.org\/2000\/svg$/u,
  tex: /^application\/x-tex$/u,
} as const;
type Kind = keyof typeof VALUES;

/** The layout attributes of MathML that KaTeX writes, with their kinds. */
const MATHML_ATTRIBUTES: Readonly<Record<string, Kind>> = {
  mathvariant: "words",
  stretchy: "words",
  fence: "words",
  separator: "words",
  accent: "words",
  accentunder: "words",
  largeop: "words",
  movablelimits: "words",
  symmetric: "words",
  form: "words",
  notation: "words",
  displaystyle: "words",
  columnalign: "words",
  rowalign: "words",
  columnlines: "words",
  rowlines: "words",
  frame: "words",
  equalrows: "words",
  equalcolumns: "words",
  side: "words",
  minsize: "lengths",
  maxsize: "lengths",
  lspace: "padding",
  rspace: "lengths",
  linethickness: "lengths",
  mathsize: "lengths",
  rowspacing: "lengths",
  columnspacing: "lengths",
  framespacing: "lengths",
  width: "padding",
  height: "padding",
  depth: "padding",
  voffset: "padding",
  scriptlevel: "numbers",
  mathcolor: "colour",
  mathbackground: "colour",
  style: "style",
  class: "classes",
};

const MATHML_ELEMENTS =
  "semantics mrow mi mo mn ms mtext mspace msup msub msubsup mfrac msqrt mroot mover munder munderover mpadded mphantom menclose mstyle mtable mtr mtd mlabeledtr mmultiscripts mprescripts none merror";

/** The elements of KaTeX's output, each with its attributes and their kinds. */
const ELEMENTS: ReadonlyMap<string, Readonly<Record<string, Kind>>> = new Map<
  string,
  Readonly<Record<string, Kind>>
>([
  ["span", { class: "classes", "aria-hidden": "true", style: "style" }],
  ["math", { xmlns: "mathml", display: "block" }],
  ["annotation", { encoding: "tex" }],
  ...MATHML_ELEMENTS.split(" ").map((name): [string, Readonly<Record<string, Kind>>] => [
    name,
    MATHML_ATTRIBUTES,
  ]),
  [
    "svg",
    {
      xmlns: "svg",
      width: "lengths",
      height: "lengths",
      viewBox: "numbers",
      preserveAspectRatio: "words",
      style: "style",
    },
  ],
  ["path", { d: "path" }],
  ["line", { x1: "lengths", y1: "lengths", x2: "lengths", y2: "lengths", "stroke-width": "lengths" }],
]);
/** The elements KaTeX may close with `/>`. */
const EMPTY: ReadonlySet<string> = new Set(["path", "line", "mspace"]);

// KaTeX writes one attribute with a space before its `=` (`<mpadded class ="vcenter">`).
const TOKEN = /<\/([a-zA-Z]+)>|<([a-zA-Z]+)((?:\s+[a-zA-Z][a-zA-Z0-9-]*\s?="[^"<>]*")*)\s*(\/?)>|([^<]+)/guy;
const ATTRIBUTE = /\s+([a-zA-Z][a-zA-Z0-9-]*)\s?="([^"<>]*)"/gu;
const TEXT = /^(?:[^&<]|&(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);)*$/u;

/** Whether the attributes `written` of an element `name` all match the grammar, each once. */
const attributesMatch = (name: string, written: string): boolean => {
  const allowed = ELEMENTS.get(name);
  if (allowed === undefined) {
    return false;
  }
  const seen = new Set<string>();
  for (const [, attribute = "", value = ""] of written.matchAll(ATTRIBUTE)) {
    const kind = Object.hasOwn(allowed, attribute) ? allowed[attribute] : undefined;
    if (kind === undefined || seen.has(attribute) || !VALUES[kind].test(value)) {
      return false;
    }
    seen.add(attribute);
  }
  return true;
};

/** Whether `html` is KaTeX output by the grammar of the file comment: known elements, nested and closed. */
export const isFormulaHtml = (html: string): boolean => {
  const open: string[] = [];
  TOKEN.lastIndex = 0;
  let at = 0;
  for (let match = TOKEN.exec(html); match !== null; match = TOKEN.exec(html)) {
    at = TOKEN.lastIndex;
    const [, closing, name, written = "", selfClosed, text] = match;
    if (text !== undefined) {
      if (!TEXT.test(text)) {
        return false;
      }
    } else if (closing !== undefined) {
      if (open.pop() !== closing) {
        return false;
      }
    } else if (
      name === undefined ||
      !attributesMatch(name, written) ||
      (selfClosed === "/" && !EMPTY.has(name))
    ) {
      return false;
    } else if (selfClosed !== "/") {
      open.push(name);
    }
  }
  return at === html.length && open.length === 0;
};

// Formulas set by KaTeX (SR-096, #108), bundled with the app: nothing is loaded at run time (SR-078), the
// fonts come from the app's own files (`app:`). KaTeX builds the formula with `createElement` and text
// nodes, never from HTML, and with `trust: false` the commands that could link, load or style anything
// (`\href`, `\url`, `\includegraphics`, `\htmlClass`, `\htmlId`, `\htmlStyle`, `\htmlData`) are drawn as
// their source text (ADR-0010: nothing from a file is interpreted as HTML).
import katex from "katex";
import "katex/dist/katex.min.css";

export type FormulaResult =
  { readonly ok: true; readonly node: HTMLElement } | { readonly ok: false; readonly message: string };

const OPTIONS = {
  throwOnError: true,
  trust: false,
  // KaTeX's warnings about LaTeX it accepts anyway (Unicode text in math mode) are no errors of the text.
  strict: "ignore",
  // A command KaTeX does not run (an untrusted one) is drawn in grey, not red: colour only for meaning (D-062).
  errorColor: "var(--muted)",
  // Bounds against a formula that would take the editor down: no box above 20em, no macro bomb.
  maxSize: 20,
  maxExpand: 1000,
  // The MathML part carries the source for assistive technology and copying.
  output: "htmlAndMathml",
} as const;

/** How many set formulas are kept; a text with more of them sets the ones beyond again on each change. */
export const FORMULA_CACHE_SIZE = 2000;

const cache = new Map<string, FormulaResult>();

const set = (source: string, display: boolean): FormulaResult => {
  const node = document.createElement("span");
  try {
    katex.render(source, node, { ...OPTIONS, displayMode: display });
    return { ok: true, node };
  } catch (error) {
    // KaTeX throws a ParseError with a message that names the place ("KaTeX parse error: Expected '}', …").
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
};

/**
 * The formula `source` set by KaTeX (display style for a block), or the message of its error. Kept by
 * source, most recently used last, so typing elsewhere in the text sets nothing again.
 */
export const renderFormula = (source: string, display: boolean): FormulaResult => {
  const key = `${display ? "D" : "I"}${source}`;
  const found = cache.get(key);
  if (found !== undefined) {
    cache.delete(key);
    cache.set(key, found);
    return found;
  }
  const result = set(source, display);
  cache.set(key, result);
  if (cache.size > FORMULA_CACHE_SIZE) {
    // The first key is the least recently used one; the map holds more than one entry here.
    const [oldest = key] = cache.keys();
    cache.delete(oldest);
  }
  return result;
};

/** The formula as the editor shows it: a copy of the set formula, or the error with the word "Error". */
export const formulaNode = (source: string, display: boolean): HTMLElement => {
  const result = renderFormula(source, display);
  return result.ok ? (result.node.cloneNode(true) as HTMLElement) : errorNode(result.message, display);
};

/** An error of a formula or a diagram, as text in grey after its source (SR-096 AK3, D-062). */
export const errorNode = (message: string, block: boolean): HTMLElement => {
  const element = document.createElement(block ? "div" : "span");
  element.className = "cm-lr-render-error";
  const label = document.createElement("span");
  label.className = "cm-lr-render-error-label";
  label.textContent = "Error";
  element.append(label, document.createTextNode(` ${message}`));
  return element;
};

// @vitest-environment happy-dom
import katex from "katex";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FORMULA_CACHE_SIZE, errorNode, formulaNode, renderFormula } from "./formula.js";

// The page of the app has a doctype; happy-dom's test document has none, and KaTeX, when it is loaded,
// refuses to set anything in quirks mode. Hoisted, so it runs before the imports.
vi.hoisted(() => {
  Object.defineProperty(document, "compatMode", { value: "CSS1Compat", configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const set = (source: string, display = false): HTMLElement => {
  const result = renderFormula(source, display);
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.node;
};

describe("renderFormula", () => {
  it("sets a formula with KaTeX and keeps its source in the MathML annotation", () => {
    const node = set("E = mc^2");
    expect(node.querySelector(".katex")).not.toBeNull();
    expect(node.querySelector(".katex-display")).toBeNull();
    expect(node.querySelector('annotation[encoding="application/x-tex"]')?.textContent).toBe("E = mc^2");
  });

  it("sets a block formula in display style", () => {
    expect(set("\\frac{1}{2}", true).querySelector(".katex-display")).not.toBeNull();
  });

  it("gives the message of a syntax error instead of a formula", () => {
    const result = renderFormula("\\frac{1}{", false);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toMatch(/^KaTeX parse error: /);
  });

  it("gives the text of something thrown that is no Error", () => {
    vi.spyOn(katex, "render").mockImplementation(() => {
      // Thrown as KaTeX could by a bug; the editor shows it as text.
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the branch for a thrown non-Error is what this test covers
      throw "broken";
    });
    expect(renderFormula("\\notcached", false)).toEqual({ ok: false, message: "broken" });
  });

  it("draws untrusted commands as grey text: no link, no class, no colour of meaning (D-062)", () => {
    const node = set("\\href{javascript:alert(1)}{x} \\htmlClass{evil}{y} \\url{https://example.org}");
    expect(node.querySelector("a")).toBeNull();
    expect(node.querySelector(".evil")).toBeNull();
    const coloured = [...node.querySelectorAll<HTMLElement>("[style]")].filter(
      (element) => element.style.color !== "",
    );
    expect(coloured.length).toBeGreaterThan(0);
    for (const element of coloured) {
      expect(element.style.color).toBe("var(--muted)");
    }
  });

  it("keeps the set formulas by source and display style, the most recently used last", () => {
    const spy = vi.spyOn(katex, "render");
    const first = renderFormula("a^1", false);
    expect(renderFormula("a^1", false)).toBe(first);
    expect(renderFormula("a^1", true)).not.toBe(first);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("forgets the least recently used formula beyond its size", () => {
    // A stand-in for KaTeX: the size is about the cache, not about setting.
    vi.spyOn(katex, "render").mockImplementation(() => undefined);
    const kept = renderFormula("kept", false);
    const dropped = renderFormula("dropped", false);
    for (let at = 0; at < FORMULA_CACHE_SIZE - 1; at += 1) {
      renderFormula(`f${String(at)}`, false);
      // "kept" is used all the time, so it stays.
      renderFormula("kept", false);
    }
    expect(renderFormula("kept", false)).toBe(kept);
    expect(renderFormula("dropped", false)).not.toBe(dropped);
  });
});

describe("formulaNode", () => {
  it("is a copy of the set formula, so each widget has its own", () => {
    const one = formulaNode("x_1", false);
    const two = formulaNode("x_1", false);
    expect(one).not.toBe(two);
    expect(one.querySelector(".katex")).not.toBeNull();
  });

  it("is the error with the word Error for a formula with a syntax error", () => {
    const node = formulaNode("\\frac{", true);
    expect(node.tagName).toBe("DIV");
    expect(node.className).toBe("cm-lr-render-error");
    expect(node.querySelector(".cm-lr-render-error-label")?.textContent).toBe("Error");
    expect(node.textContent).toMatch(/^Error KaTeX parse error: /);
  });
});

describe("errorNode", () => {
  it("sets the message as text, within the line or as a block", () => {
    const inline = errorNode("<b>x</b>", false);
    expect(inline.tagName).toBe("SPAN");
    expect(inline.querySelector("b")).toBeNull();
    expect(inline.textContent).toBe("Error <b>x</b>");
    expect(errorNode("m", true).tagName).toBe("DIV");
  });
});

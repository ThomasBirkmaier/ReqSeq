// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiagramTheme } from "./mermaid-renderer.js";

// Mermaid needs a real layout; the real drawing is checked on the built app (`test/diagrams.spec.ts`).
const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn<(source: string) => Promise<unknown>>(),
  render: vi.fn<(id: string, source: string, into: Element) => Promise<{ svg: string }>>(),
}));
vi.mock("mermaid", () => ({ default: mermaid }));

const {
  MAX_EDGES,
  MAX_STATEMENTS,
  MAX_TEXT_SIZE,
  SECURE_KEYS,
  accessibleTitle,
  asImage,
  errorMessage,
  measuringContainer,
  mermaidConfig,
  overLimit,
  pageTheme,
  renderDiagram,
} = await import("./mermaid-renderer.js");

const THEME: DiagramTheme = {
  dark: false,
  text: "rgb(31, 35, 40)",
  muted: "rgb(101, 109, 118)",
  rule: "rgb(230, 232, 235)",
  edge: "rgb(140, 149, 159)",
  sheet: "rgb(255, 255, 255)",
  raised: "rgb(249, 251, 253)",
  fontFamily: "system-ui",
};

const SVG = '<svg id="x" width="100%" style="max-width: 120px;" viewBox="0 0 119.5 80"><text>A</text></svg>';

beforeEach(() => {
  mermaid.initialize.mockReset();
  mermaid.parse.mockReset().mockResolvedValue(true);
  mermaid.render.mockReset().mockImplementation((_id, _source, into) => {
    into.append(document.createElement("div"));
    return Promise.resolve({ svg: SVG });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset["theme"];
});

describe("mermaidConfig", () => {
  it("draws strictly, without HTML labels, in the greys of the theme, and keeps all that from directives", () => {
    const config = mermaidConfig(THEME);
    expect(config).toMatchObject({
      startOnLoad: false,
      securityLevel: "strict",
      deterministicIds: true,
      suppressErrorRendering: true,
      htmlLabels: false,
      maxTextSize: MAX_TEXT_SIZE,
      maxEdges: MAX_EDGES,
      theme: "base",
      darkMode: false,
      fontFamily: "system-ui",
      themeVariables: { primaryTextColor: THEME.text, lineColor: THEME.muted, background: THEME.sheet },
    });
    expect(config.secure).toEqual([...SECURE_KEYS]);
    for (const key of ["securityLevel", "maxTextSize", "maxEdges", "theme", "themeCSS", "themeVariables"]) {
      expect(SECURE_KEYS).toContain(key);
    }
    expect(mermaidConfig({ ...THEME, dark: true }).themeVariables).toMatchObject({ darkMode: true });
  });
});

describe("errorMessage", () => {
  it("is the message of an error, of the edge limit only its first line", () => {
    expect(errorMessage(new Error("Parse error on line 2:\nA -->\n-----^"))).toBe(
      "Parse error on line 2:\nA -->\n-----^",
    );
    expect(
      errorMessage(
        new Error("Edge limit exceeded. 500 edges found, but the limit is 500.\n\nInitialize mermaid …"),
      ),
    ).toBe("Edge limit exceeded. 500 edges found, but the limit is 500.");
  });

  it("is the text of a parser's hash object, or the thrown value as text", () => {
    expect(errorMessage({ str: "Lexical error on line 1" })).toBe("Lexical error on line 1");
    expect(errorMessage("broken")).toBe("broken");
    expect(errorMessage(null)).toBe("null");
  });
});

describe("overLimit", () => {
  it("lets a diagram within the bounds through", () => {
    expect(overLimit("flowchart TD\nA --> B")).toBeUndefined();
    expect(overLimit(`flowchart TD\n${"\n;".repeat(MAX_STATEMENTS * 2)}A`)).toBeUndefined();
  });

  it("names the text size or the statements over the bound, in lines or between semicolons", () => {
    expect(overLimit("x".repeat(MAX_TEXT_SIZE + 1))).toBe(
      `Diagram too large: ${String(MAX_TEXT_SIZE + 1)} characters, at most 50000.`,
    );
    expect(overLimit(Array.from({ length: MAX_STATEMENTS + 1 }, () => "A --> B").join("\n"))).toBe(
      "Diagram too large: 501 statements, at most 500.",
    );
    expect(overLimit("a --> b; ".repeat(501))).toBe("Diagram too large: 501 statements, at most 500.");
  });
});

describe("asImage", () => {
  it("gives the drawing the size of its viewBox and makes it a data: URL", () => {
    const image = asImage(SVG, "Ablauf");
    expect(image).toMatchObject({ ok: true, width: 120, height: 80, title: "Ablauf" });
    const svg = decodeURIComponent(
      (image as { url: string }).url.replace("data:image/svg+xml;charset=utf-8,", ""),
    );
    expect(svg).toBe('<svg width="120" height="80" id="x" viewBox="0 0 119.5 80"><text>A</text></svg>');
    // A `$` in the root is no replacement pattern.
    const dollar = asImage('<svg aria-label="$&amp;$\'" viewBox="0 0 1 1"></svg>', "");
    expect(decodeURIComponent((dollar as { url: string }).url)).toContain('aria-label="$&amp;$\'"');
  });

  it("calls a drawing without a title 'Diagram' and one without a usable viewBox 0 by 0", () => {
    expect(asImage('<svg viewBox="0 0 a b"></svg>', "  ")).toMatchObject({
      width: 0,
      height: 0,
      title: "Diagram",
    });
    expect(asImage("<svg></svg>", "")).toMatchObject({ width: 0, height: 0 });
    expect(asImage("", "")).toMatchObject({ ok: true, url: "data:image/svg+xml;charset=utf-8,", width: 0 });
  });
});

describe("accessibleTitle", () => {
  it("is the accTitle of the source, or empty", () => {
    expect(accessibleTitle("flowchart TD\n  accTitle: Ablauf der Prüfung\nA --> B")).toBe(
      "Ablauf der Prüfung",
    );
    expect(accessibleTitle("flowchart TD\nA --> B")).toBe("");
  });
});

describe("measuringContainer", () => {
  it("is one container out of view, made again when it left the page", () => {
    const first = measuringContainer();
    expect(measuringContainer()).toBe(first);
    expect(first.isConnected).toBe(true);
    expect(first.style.position).toBe("fixed");
    expect(first.style.visibility).toBe("hidden");
    expect(first.getAttribute("aria-hidden")).toBe("true");
    first.remove();
    const second = measuringContainer();
    expect(second).not.toBe(first);
    expect(second.isConnected).toBe(true);
  });
});

describe("renderDiagram", () => {
  it("draws with Mermaid in the measuring container, empties it after, and configures once per theme", async () => {
    const drawn = await renderDiagram("flowchart TD\naccTitle: Ablauf\nA --> B", THEME);
    expect(drawn).toMatchObject({ ok: true, width: 120, height: 80, title: "Ablauf" });
    const [id, source, into] = mermaid.render.mock.calls[0] ?? [];
    expect(id).toMatch(/^lr-diagram-\d+$/);
    expect(source).toBe("flowchart TD\naccTitle: Ablauf\nA --> B");
    expect(into).toBe(measuringContainer());
    expect(measuringContainer().childElementCount).toBe(0);
    await renderDiagram("flowchart TD\nA --> C", THEME);
    expect(mermaid.initialize).toHaveBeenCalledTimes(1);
    await renderDiagram("flowchart TD\nA --> C", { ...THEME, dark: true });
    expect(mermaid.initialize).toHaveBeenCalledTimes(2);
    expect(mermaid.initialize).toHaveBeenLastCalledWith(mermaidConfig({ ...THEME, dark: true }));
  });

  it("gives the parse error as the result and empties the container", async () => {
    mermaid.parse.mockRejectedValue(new Error("Parse error on line 2:\nA -->"));
    expect(await renderDiagram("flowchart TD\nA -->", THEME)).toEqual({
      ok: false,
      message: "Parse error on line 2:\nA -->",
    });
    expect(mermaid.render).not.toHaveBeenCalled();
    mermaid.parse.mockResolvedValue(true);
    mermaid.render.mockImplementation((_id, _source, into) => {
      into.append(document.createElement("div"));
      return Promise.reject(new Error("Edge limit exceeded. 501 edges found, but the limit is 500.\n\nMore"));
    });
    expect(await renderDiagram("flowchart TD\nA --> B", THEME)).toEqual({
      ok: false,
      message: "Edge limit exceeded. 501 edges found, but the limit is 500.",
    });
    expect(measuringContainer().childElementCount).toBe(0);
  });

  it("does not hand a diagram over the bounds to Mermaid", async () => {
    expect(await renderDiagram("x".repeat(MAX_TEXT_SIZE + 1), THEME)).toMatchObject({ ok: false });
    expect(mermaid.parse).not.toHaveBeenCalled();
  });

  it("draws one diagram at a time, in the order asked", async () => {
    const order: string[] = [];
    let release = (): void => undefined;
    mermaid.render.mockImplementation(async (_id, source) => {
      order.push(`start ${source}`);
      if (source.endsWith("1")) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      order.push(`end ${source}`);
      return { svg: SVG };
    });
    const first = renderDiagram("graph 1", THEME);
    const second = renderDiagram("graph 2", THEME);
    await vi.waitFor(() => {
      expect(order).toEqual(["start graph 1"]);
    });
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["start graph 1", "end graph 1", "start graph 2", "end graph 2"]);
  });
});

describe("pageTheme", () => {
  it("resolves the colour tokens through a probe and takes the scheme from data-theme or the system", () => {
    const media = vi.fn(() => ({ matches: true }));
    vi.stubGlobal("matchMedia", media);
    const system = pageTheme();
    expect(Object.keys(system).sort()).toEqual(
      ["dark", "edge", "fontFamily", "muted", "raised", "rule", "sheet", "text"].sort(),
    );
    expect(system.dark).toBe(true);
    expect(media).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
    document.documentElement.dataset["theme"] = "light";
    expect(pageTheme().dark).toBe(false);
    document.documentElement.dataset["theme"] = "dark";
    expect(pageTheme().dark).toBe(true);
    expect(media).toHaveBeenCalledTimes(1);
    // The probe is gone again.
    expect(document.body.querySelectorAll("span")).toHaveLength(0);
  });
});

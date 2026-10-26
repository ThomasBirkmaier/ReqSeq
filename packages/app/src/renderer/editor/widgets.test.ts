// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { GlyphWidget, TableWidget } from "./widgets.js";

describe("GlyphWidget", () => {
  it("draws the glyph as text with its class", () => {
    const dom = new GlyphWidget("•", "cm-lr-bullet").toDOM();
    expect(dom.tagName).toBe("SPAN");
    expect(dom.className).toBe("cm-lr-bullet");
    expect(dom.textContent).toBe("•");
  });

  it("is equal to a widget with the same glyph and class", () => {
    const widget = new GlyphWidget("☐", "cm-lr-task");
    expect(widget.eq(new GlyphWidget("☐", "cm-lr-task"))).toBe(true);
    expect(widget.eq(new GlyphWidget("☑", "cm-lr-task"))).toBe(false);
    expect(widget.eq(new GlyphWidget("☐", "other"))).toBe(false);
  });
});

describe("TableWidget", () => {
  const data = {
    align: ["left", "center", undefined] as const,
    header: [
      [{ text: "a", classes: [] }],
      [{ text: "<b>x</b>", classes: ["cm-lr-strong"] }],
      [{ text: "c", classes: [] }],
    ],
    body: [
      [[{ text: "1", classes: [] }], [{ text: "2", classes: ["cm-lr-em", "cm-lr-strong"] }], []],
      [[], [], [{ text: "z", classes: [] }]],
    ],
  };

  it("builds a table with header, body, alignment and styled pieces, using text nodes only", () => {
    const dom = new TableWidget(data).toDOM();
    expect(dom.tagName).toBe("TABLE");
    expect(dom.className).toBe("cm-lr-table");
    expect([...dom.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual(["a", "<b>x</b>", "c"]);
    expect(dom.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(dom.querySelector("b")).toBeNull();
    const cells = [...dom.querySelectorAll<HTMLElement>("th, td")];
    expect(cells.map((cell) => cell.style.textAlign)).toEqual([
      "left",
      "center",
      "",
      "left",
      "center",
      "",
      "left",
      "center",
      "",
    ]);
    expect(dom.querySelector("td span")?.className).toBe("cm-lr-em cm-lr-strong");
    expect(dom.querySelector("th span")?.textContent).toBe("<b>x</b>");
  });

  it("is equal to a widget of the same rows, so an unchanged table is not drawn again", () => {
    const widget = new TableWidget(data);
    expect(widget.eq(new TableWidget(structuredClone(data)))).toBe(true);
    expect(widget.eq(new TableWidget({ ...data, align: ["right"] }))).toBe(false);
  });

  it("lets the editor handle events, so a click puts the cursor into the table", () => {
    expect(new TableWidget(data).ignoreEvent()).toBe(false);
  });
});

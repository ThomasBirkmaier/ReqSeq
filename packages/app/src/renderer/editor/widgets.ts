// The widgets of the live preview. They build their DOM with `createElement` and `textContent` only:
// nothing from a file is ever interpreted as HTML (ADR-0010).
import { WidgetType } from "@codemirror/view";
import type { Segment } from "./segments.js";

/** One symbol in place of Markdown source: a list bullet or a task box. */
export class GlyphWidget extends WidgetType {
  readonly glyph: string;
  readonly className: string;

  constructor(glyph: string, className: string) {
    super();
    this.glyph = glyph;
    this.className = className;
  }

  override eq(other: GlyphWidget): boolean {
    return other.glyph === this.glyph && other.className === this.className;
  }

  override toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = this.className;
    span.textContent = this.glyph;
    return span;
  }
}

/**
 * A text in place of the label of a link: the title of the target of a reference (D-058). It has the classes
 * and the hint of the label, and the editor takes the presses on it (a press follows the reference).
 */
export class LabelWidget extends WidgetType {
  readonly text: string;
  readonly className: string;
  readonly hint: string | undefined;

  constructor(text: string, className: string, hint?: string) {
    super();
    this.text = text;
    this.className = className;
    this.hint = hint;
  }

  override eq(other: LabelWidget): boolean {
    return other.text === this.text && other.className === this.className && other.hint === this.hint;
  }

  override toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = this.className;
    span.textContent = this.text;
    if (this.hint !== undefined) {
      span.title = this.hint;
    }
    return span;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

export type Align = "left" | "center" | "right" | undefined;

export interface TableData {
  readonly align: readonly Align[];
  readonly header: readonly (readonly Segment[])[];
  readonly body: readonly (readonly (readonly Segment[])[])[];
}

const cell = (tag: "th" | "td", segments: readonly Segment[], align: Align): HTMLElement => {
  const element = document.createElement(tag);
  if (align !== undefined) {
    element.style.textAlign = align;
  }
  for (const segment of segments) {
    if (segment.classes.length === 0) {
      element.append(document.createTextNode(segment.text));
    } else {
      const span = document.createElement("span");
      span.className = segment.classes.join(" ");
      span.textContent = segment.text;
      element.append(span);
    }
  }
  return element;
};

const row = (
  tag: "th" | "td",
  cells: readonly (readonly Segment[])[],
  align: readonly Align[],
): HTMLElement => {
  const element = document.createElement("tr");
  cells.forEach((segments, at) => {
    element.append(cell(tag, segments, align[at]));
  });
  return element;
};

/** A table drawn in place of its source, while the cursor is not in it. */
export class TableWidget extends WidgetType {
  readonly data: TableData;
  private readonly key: string;

  constructor(data: TableData) {
    super();
    this.data = data;
    this.key = JSON.stringify(data);
  }

  override eq(other: TableWidget): boolean {
    return other.key === this.key;
  }

  override toDOM(): HTMLElement {
    const table = document.createElement("table");
    table.className = "cm-lr-table";
    const head = document.createElement("thead");
    head.append(row("th", this.data.header, this.data.align));
    const body = document.createElement("tbody");
    for (const cells of this.data.body) {
      body.append(row("td", cells, this.data.align));
    }
    table.append(head, body);
    return table;
  }

  // A click on the table reaches the editor, so it puts the cursor there and the source appears.
  override ignoreEvent(): boolean {
    return false;
  }
}

// @vitest-environment happy-dom
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import type { ImageElement } from "./image-preview.js";
import {
  ImageNoteWidget,
  ImageWidget,
  NOTE_TEXT,
  failedImages,
  imagePreview,
  imageRule,
  imageTarget,
  imageUrl,
} from "./image-preview.js";
import { markdownSupport } from "./markdown.js";
import { BUILT_IN_RULES, focusEffect, focusState, livePreview, previewDecorations } from "./preview.js";

const ELEMENT: ImageElement = { repository: "spec", file: "requirements/SR-1.md" };
const RULES = [...BUILT_IN_RULES, imageRule(() => ELEMENT)];
const PIXEL = imageUrl("spec", ["requirements", "SR-1", "pixel.png"]);

const stateOf = (doc: string, cursor?: number): EditorState => {
  const state = EditorState.create({
    doc,
    ...(cursor === undefined ? {} : { selection: { anchor: cursor } }),
    extensions: [markdownSupport({}), focusState, failedImages],
  });
  ensureSyntaxTree(state, doc.length, 1e9);
  return state.update({ effects: focusEffect.of(cursor !== undefined) }).state;
};

interface Found {
  readonly from: number;
  readonly to: number;
  readonly kind: string;
  readonly detail?: string;
}

/** The image decorations of `state`: an image in place, an image below the line, or a note. */
const images = (state: EditorState): Found[] => {
  const found: Found[] = [];
  previewDecorations(state, RULES, state.field(focusState)).between(
    0,
    state.doc.length,
    (from, to, value) => {
      const spec = value.spec as { widget?: unknown; block?: boolean };
      if (spec.widget instanceof ImageWidget) {
        found.push({ from, to, kind: from === to ? "below" : "in-place", detail: spec.widget.url });
      } else if (spec.widget instanceof ImageNoteWidget) {
        found.push({ from, to, kind: "note", detail: spec.widget.note });
      }
    },
  );
  return found;
};

/** A test value for `--muted`, set on the parent; the note must take it (muted colour as `[SR-128/AK-sthw]`). */
const MUTED = "rgb(96, 104, 113)";

/** `doc` in an editor with the preview and the image plugin in the document, the cursor at `cursor`. */
const mounted = (doc: string, cursor: number): { view: EditorView; parent: HTMLElement } => {
  const parent = document.createElement("div");
  parent.style.setProperty("--muted", MUTED);
  document.body.append(parent);
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdownSupport({}), livePreview(RULES), ...(imagePreview(() => ELEMENT).extensions ?? [])],
  });
  ensureSyntaxTree(state, doc.length, 1e9);
  const view = new EditorView({ state, parent });
  view.dispatch({ effects: focusEffect.of(true) });
  return { view, parent };
};

/** The note is quiet: the muted colour, smaller type than the source of its line, and no dialog. */
const expectQuiet = (note: Element): void => {
  const line = note.closest(".cm-line");
  expect(line).not.toBeNull();
  expect(getComputedStyle(note).color).toBe(MUTED);
  expect(parseFloat(getComputedStyle(note).fontSize)).toBeLessThan(
    parseFloat(getComputedStyle(line ?? note).fontSize),
  );
  expect(document.querySelector('dialog, [role="dialog"], [role="alertdialog"]')).toBeNull();
};

/** Types `text` at the cursor, one character at a time, as the keyboard does. */
const type = (view: EditorView, text: string): void => {
  for (const character of text) {
    view.dispatch(view.state.replaceSelection(character));
  }
};

describe("imageTarget", () => {
  it("[SR-184/AK-bjm1] loads nothing from the network, a data: address or outside the repository", () => {
    const file = "requirements/SR-1.md";
    expect(imageTarget(file, "https://example.com/a.png")).toEqual({ kind: "note", note: "network" });
    expect(imageTarget(file, "HTTP://example.com/a.png")).toEqual({ kind: "note", note: "network" });
    expect(imageTarget(file, "file:///etc/a.png")).toEqual({ kind: "note", note: "network" });
    expect(imageTarget(file, "C:/a.png")).toEqual({ kind: "note", note: "outside" });
    expect(imageTarget(file, "//host/share/a.png")).toEqual({ kind: "note", note: "outside" });
    expect(imageTarget(file, "data:image/png;base64,AAAA")).toEqual({ kind: "note", note: "data" });
    expect(imageTarget(file, "/etc/a.png")).toEqual({ kind: "note", note: "outside" });
    expect(imageTarget(file, "../../a.png")).toEqual({ kind: "note", note: "outside" });
    expect(imageTarget(file, "%2e%2e/%2e%2e/a.png")).toEqual({ kind: "note", note: "outside" });
    expect(imageTarget(file, "a\\b.png")).toEqual({ kind: "note", note: "unreadable" });
    expect(imageTarget(file, "a%5Cb.png")).toEqual({ kind: "note", note: "unreadable" });
    // As core: an absolute path counts by its text before decoding.
    expect(imageTarget(file, "%2Fa.png")).toEqual({ kind: "file", names: ["requirements", "a.png"] });
    expect(imageTarget(file, "a%00.png")).toEqual({ kind: "note", note: "outside" });
    expect(imageTarget(file, "")).toEqual({ kind: "note", note: "outside" });
    expect(imageTarget(file, "folder/")).toEqual({ kind: "note", note: "unreadable" });
    expect(imageTarget(file, "..")).toEqual({ kind: "note", note: "outside" });
    // As core's version rule: not the element's own file or folder, nothing below `.git`.
    expect(imageTarget(file, "SR-1.md")).toEqual({ kind: "note", note: "outside" });
    expect(imageTarget(file, ".")).toEqual({ kind: "note", note: "outside" });
    expect(imageTarget(file, "../.GIT/a.png")).toEqual({ kind: "note", note: "outside" });
  });

  it("resolves a relative destination against the element's folder, as core's version rule does", () => {
    const file = "requirements/SR-1.md";
    expect(imageTarget(file, "SR-1/pixel.png")).toEqual({
      kind: "file",
      names: ["requirements", "SR-1", "pixel.png"],
    });
    expect(imageTarget(file, "./SR-1/./a%20b.png?x=1#y")).toEqual({
      kind: "file",
      names: ["requirements", "SR-1", "a b.png"],
    });
    expect(imageTarget(file, "../img/a\\_b.png")).toEqual({ kind: "file", names: ["img", "a_b.png"] });
    expect(imageTarget("SR-1.md", "a.png")).toEqual({ kind: "file", names: ["a.png"] });
    expect(imageTarget(file, "%E0%A4%A.png")).toEqual({
      kind: "file",
      names: ["requirements", "%E0%A4%A.png"],
    });
  });

  it("encodes every name of the URL", () => {
    expect(imageUrl("my repo", ["a b", "#?.png"])).toBe("reqseq-file://workspace/my%20repo/a%20b/%23%3F.png");
  });
});

describe("image preview", () => {
  it("[SR-184/AK-n2k7] shows an image of the repository in place of its source off the cursor's line", () => {
    const doc = 'Before\n\n![pixel](SR-1/pixel.png)\n\nText ![p](<SR-1/pixel.png> "title") after';
    const found = images(stateOf(doc));
    expect(found).toEqual([
      { from: 8, to: 32, kind: "in-place", detail: PIXEL },
      { from: 39, to: 69, kind: "in-place", detail: PIXEL },
    ]);
  });

  it("[SR-184/AK-h2f8] keeps the source on the cursor's line and shows the image below it", () => {
    const doc = "![pixel](SR-1/pixel.png) and ![two](SR-1/two.png)\nnext";
    const found = images(stateOf(doc, 3));
    const line = doc.indexOf("\n");
    expect(found.map((item) => [item.from, item.kind])).toEqual([
      [line, "below"],
      [line, "below"],
    ]);
  });

  it("[SR-184/AK-bjm1] keeps the source with a note right after it in its line that names the case, quiet, and typing goes on", () => {
    const network = "![a](https://example.com/a.png)";
    const data = "![b](data:image/png;base64,AA)";
    const outside = "![c](../../c.png)";
    const doc = `Text ${network} ${data} ${outside}`;
    expect(images(stateOf(doc)).map((item) => item.detail)).toEqual(["network", "data", "outside"]);
    // The cursor in the line of the notes, after "Te".
    const { view, parent } = mounted(`${doc}\nend`, 2);
    const [line] = view.contentDOM.querySelectorAll(".cm-line");
    // Each note stands directly after its source, in the same line.
    expect(line?.textContent).toBe(
      `Text ${network}${NOTE_TEXT.network} ${data}${NOTE_TEXT.data} ${outside}${NOTE_TEXT.outside}`,
    );
    const notes = [...(line?.querySelectorAll(".cm-lr-image-note") ?? [])];
    expect(notes).toHaveLength(3);
    notes.forEach(expectQuiet);
    // The cursor stays, and typing goes on: also a new image source on the network gets its note at once.
    expect(view.state.selection.main.head).toBe(2);
    type(view, "x");
    expect(view.state.doc.line(1).text).toBe(`Texxt ${network} ${data} ${outside}`);
    view.dispatch({ selection: { anchor: view.state.doc.line(2).to } });
    type(view, ` ${network} more`);
    expect(view.state.doc.line(2).text).toBe(`end ${network} more`);
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
    const second = view.contentDOM.querySelectorAll(".cm-line")[1];
    expect(second?.textContent).toBe(`end ${network}${NOTE_TEXT.network} more`);
    expectQuiet(second?.querySelector(".cm-lr-image-note") ?? parent);
    view.destroy();
    parent.remove();
  });

  it("[SR-184/AK-vqh4] turns an image that does not load into its source with a note right after it, quiet, also later while the cursor is elsewhere", () => {
    const source = "![pixel](SR-1/pixel.png)";
    const doc = `${source} after\nsecond`;
    const cursor = doc.length - 2;
    const { view, parent } = mounted(doc, cursor);
    const image = view.contentDOM.querySelector("img:not(.cm-widgetBuffer)");
    expect(image?.getAttribute("src")).toBe(PIXEL);
    expect(image?.getAttribute("alt")).toBe("pixel");
    image?.dispatchEvent(new Event("load"));
    expect(images(view.state)[0]?.kind).toBe("in-place");
    // It fails to load while the cursor is in the other line.
    image?.dispatchEvent(new Event("error"));
    expect(images(view.state)).toEqual([
      { from: source.length, to: source.length, kind: "note", detail: "unreadable" },
    ]);
    const [line] = view.contentDOM.querySelectorAll(".cm-line");
    expect(line?.textContent).toBe(`${source}${NOTE_TEXT.unreadable} after`);
    expectQuiet(line?.querySelector(".cm-lr-image-note") ?? parent);
    // The cursor stays at its place, and typing goes on there.
    expect(view.state.selection.main.head).toBe(cursor);
    type(view, "xy");
    expect(view.state.doc.line(2).text).toBe("secoxynd");
    expect(view.contentDOM.querySelector(".cm-lr-image-note")?.textContent).toBe(NOTE_TEXT.unreadable);
    // Taking the focus asks again.
    view.dispatch({ effects: focusEffect.of(false) });
    view.dispatch({ effects: focusEffect.of(true) });
    expect(view.state.field(failedImages).size).toBe(0);
    view.destroy();
    parent.remove();
  });

  it("finds the destination of a reference image in its definition", () => {
    const doc = "![a][Pic] ![pic][] ![PIC] ![x][none]\n\n[pic]: <SR-1/pixel.png>\n[pic]: other.png";
    expect(images(stateOf(doc)).map((item) => [item.kind, item.detail])).toEqual([
      ["in-place", PIXEL],
      ["in-place", PIXEL],
      ["in-place", PIXEL],
    ]);
  });

  it("draws nothing for an image over two lines, which core's scanner does not count", () => {
    expect(images(stateOf("![a\nb](SR-1/pixel.png)"))).toEqual([]);
  });

  it("draws nothing in code", () => {
    expect(images(stateOf("`![a](SR-1/pixel.png)`\n\n```\n![a](SR-1/pixel.png)\n```"))).toEqual([]);
  });

  it("draws widgets as elements with properties, never markup", () => {
    const view = new EditorView({ state: stateOf("x") });
    const block = new ImageWidget(PIXEL, "<b>alt</b>", true).toDOM(view);
    expect(block.className).toBe("cm-lr-image-block");
    expect(block.querySelector("b")).toBeNull();
    expect(new ImageWidget(PIXEL, "a", true).eq(new ImageWidget(PIXEL, "a", true))).toBe(true);
    expect(new ImageWidget(PIXEL, "a", true).eq(new ImageWidget(PIXEL, "a", false))).toBe(false);
    expect(new ImageWidget(PIXEL, "a", true).ignoreEvent()).toBe(false);
    const note = new ImageNoteWidget("outside");
    expect(note.toDOM().textContent).toBe(NOTE_TEXT.outside);
    expect(note.eq(new ImageNoteWidget("outside"))).toBe(true);
    expect(note.eq(new ImageNoteWidget("data"))).toBe(false);
    view.destroy();
  });

  it("is a plugin with its rule and its state", () => {
    const plugins = imagePreview(() => ELEMENT);
    expect(plugins.rules?.[0]?.nodes).toEqual(["Image"]);
    expect(plugins.extensions).toHaveLength(2);
  });
});

// @vitest-environment happy-dom
import { foldedRanges } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { markdownSupport } from "./markdown.js";
import {
  foldSection,
  goToHeading,
  headings,
  sectionAt,
  sectionFolding,
  toggleSectionOnHeading,
  unfoldSection,
} from "./folding.js";

const TEXT = [
  "# Übersicht", // 0
  "",
  "Einleitung.",
  "",
  "## Zweck ##",
  "",
  "Der Zweck.",
  "",
  "### Detail",
  "",
  "Mehr.",
  "",
  "## Umfang",
  "",
  "- Liste",
  "  # kein Abschnitt",
  "",
  "Setext",
  "======",
  "",
  "Ende.",
  "",
  "# Leer",
].join("\n");

let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
});

const editor = (doc: string, anchor = 0): EditorView => {
  const parent = document.createElement("div");
  document.body.append(parent);
  view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [markdownSupport({}), sectionFolding()],
    }),
  });
  return view;
};

const folds = (target: EditorView): string[] => {
  const found: string[] = [];
  foldedRanges(target.state).between(0, target.state.doc.length, (from, to) => {
    found.push(target.state.doc.sliceString(from, to));
  });
  return found;
};

const at = (doc: string, text: string): number => doc.indexOf(text);

describe("headings", () => {
  it("lists the top-level headings with their names, levels and sections", () => {
    const state = editor(TEXT).state;
    const found = headings(state);
    expect(found.map((heading) => [heading.level, heading.name])).toEqual([
      [1, "Übersicht"],
      [2, "Zweck"],
      [3, "Detail"],
      [2, "Umfang"],
      [1, "Setext"],
      [1, "Leer"],
    ]);
    const [overview, purpose, detail] = found;
    // A section ends before the next heading of the same or a higher level; a lower one is inside it.
    expect(state.doc.sliceString(overview?.end ?? 0, overview?.to ?? 0)).toBe(
      TEXT.slice(at(TEXT, "\n\nEinleitung"), at(TEXT, "  # kein Abschnitt") + "  # kein Abschnitt".length),
    );
    expect(state.doc.sliceString(purpose?.end ?? 0, purpose?.to ?? 0)).toBe(
      "\n\nDer Zweck.\n\n### Detail\n\nMehr.",
    );
    expect(state.doc.sliceString(detail?.end ?? 0, detail?.to ?? 0)).toBe("\n\nMehr.");
    // A heading with nothing under it has an empty section.
    expect(found.at(-1)?.to).toBe(found.at(-1)?.end);
  });

  it("finds the innermost section around a position, the heading line included", () => {
    const state = editor(TEXT).state;
    expect(sectionAt(state, at(TEXT, "Mehr."))?.name).toBe("Detail");
    expect(sectionAt(state, at(TEXT, "## Zweck"))?.name).toBe("Zweck");
    expect(sectionAt(state, at(TEXT, "Einleitung"))?.name).toBe("Übersicht");
    expect(sectionAt(editor("Kein Titel.").state, 0)).toBeUndefined();
  });
});

describe("Fold section and Unfold section", () => {
  it("[SR-191/AK1] folds the section at the cursor to a hint up to the next heading of the same level, the text unchanged", () => {
    const target = editor(TEXT, at(TEXT, "Der Zweck."));
    expect(foldSection(target)).toBe(true);
    expect(folds(target)).toEqual(["\n\nDer Zweck.\n\n### Detail\n\nMehr."]);
    expect(target.state.doc.toString()).toBe(TEXT);
    // The cursor stands at the end of the heading, outside the fold.
    expect(target.state.selection.main.head).toBe(at(TEXT, "## Zweck ##") + "## Zweck ##".length);
    const hint = target.dom.querySelector(".cm-lr-fold-hint");
    expect(hint?.textContent).toBe("… 6 lines");
    expect(target.contentDOM.textContent).not.toContain("Der Zweck.");
    expect(target.contentDOM.textContent).toContain("## Umfang");
  });

  it("[SR-191/AK1] folds with a click on the toggle left of the heading, which is there for headings with a section", () => {
    const target = editor(TEXT);
    const toggles = target.dom.querySelectorAll<HTMLElement>(".cm-lr-fold-toggle");
    // "# Leer" has nothing under it and no toggle.
    expect(toggles.length).toBe(5);
    const purpose = Array.from(toggles).find(
      (toggle) => toggle.parentElement?.textContent.includes("Zweck") === true,
    );
    purpose?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(folds(target)).toEqual(["\n\nDer Zweck.\n\n### Detail\n\nMehr."]);
    const folded = Array.from(target.dom.querySelectorAll<HTMLElement>(".cm-lr-fold-toggle")).find(
      (toggle) => toggle.parentElement?.textContent.includes("Zweck") === true,
    );
    expect(folded?.textContent).toBe("▸");
    expect(folded?.title).toBe("Unfold section");
    // A second click unfolds.
    folded?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(folds(target)).toEqual([]);
    expect(target.state.doc.toString()).toBe(TEXT);
  });

  it("[SR-191/AK2] unfolds with Unfold section, with a click on the hint, and when the cursor moves in", () => {
    const target = editor(TEXT, at(TEXT, "Der Zweck."));
    foldSection(target);
    expect(unfoldSection(target)).toBe(true);
    expect(folds(target)).toEqual([]);
    expect(target.contentDOM.textContent).toContain("Der Zweck.");

    foldSection(target);
    target.dom
      .querySelector<HTMLElement>(".cm-lr-fold-hint")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(folds(target)).toEqual([]);

    foldSection(target);
    target.dispatch({ selection: { anchor: at(TEXT, "Mehr.") } });
    expect(folds(target)).toEqual([]);
    expect(target.state.doc.toString()).toBe(TEXT);
  });

  it("keeps the hint right when the text above a fold changes, and the toggle follows a fold the cursor opened", () => {
    const target = editor(TEXT, at(TEXT, "Ende."));
    foldSection(target);
    expect(target.dom.querySelector(".cm-lr-fold-hint")?.textContent).toBe("… 2 lines");
    // Most of the text above goes, then a key on the folded heading's line: the hint is drawn again.
    target.dispatch({ changes: { from: 0, to: at(TEXT, "Setext") } });
    const end = target.state.doc.line(1).to;
    target.dispatch({ changes: { from: end, insert: "!" }, selection: { anchor: end + 1 } });
    expect(target.dom.querySelector(".cm-lr-fold-hint")?.textContent).toBe("… 2 lines");
    const glyph = (): string | null | undefined =>
      target.dom.querySelector(".cm-lr-fold-toggle")?.textContent;
    expect(glyph()).toBe("▸");
    target.dispatch({ selection: { anchor: target.state.doc.toString().indexOf("Ende.") } });
    expect(folds(target)).toEqual([]);
    expect(glyph()).toBe("▾");
  });

  it("says no when there is no section, it is empty, or nothing is folded", () => {
    expect(foldSection(editor("Kein Titel."))).toBe(false);
    expect(foldSection(editor(TEXT, TEXT.length))).toBe(false);
    expect(unfoldSection(editor(TEXT, at(TEXT, "Mehr.")))).toBe(false);
    expect(unfoldSection(editor("Kein Titel."))).toBe(false);
  });

  it("unfolds the sections folded inside the one at the cursor", () => {
    const target = editor(TEXT, at(TEXT, "Mehr."));
    foldSection(target);
    target.dispatch({ selection: { anchor: at(TEXT, "Einleitung") } });
    expect(folds(target).length).toBe(1);
    expect(unfoldSection(target)).toBe(true);
    expect(folds(target)).toEqual([]);
  });
});

describe("Tab on a heading", () => {
  it("[SR-193/AK1] folds the section of the heading the cursor is on, unfolds it on the next Tab, the file unchanged", () => {
    const target = editor(TEXT, at(TEXT, "Zweck ##"));
    expect(toggleSectionOnHeading(target)).toBe(true);
    expect(folds(target)).toEqual(["\n\nDer Zweck.\n\n### Detail\n\nMehr."]);
    expect(toggleSectionOnHeading(target)).toBe(true);
    expect(folds(target)).toEqual([]);
    // A selection within a Setext heading's two lines counts as on its line.
    target.dispatch({ selection: { anchor: at(TEXT, "Setext"), head: at(TEXT, "======") + 3 } });
    expect(toggleSectionOnHeading(target)).toBe(true);
    expect(folds(target)).toEqual(["\n\nEnde."]);
    expect(target.state.doc.toString()).toBe(TEXT);
  });

  it("opens only the heading's own fold with Tab, a section folded inside it stays folded", () => {
    const target = editor(TEXT, at(TEXT, "Mehr."));
    foldSection(target);
    target.dispatch({ selection: { anchor: at(TEXT, "Zweck ##") } });
    expect(toggleSectionOnHeading(target)).toBe(true);
    expect(folds(target).length).toBe(2);
    expect(toggleSectionOnHeading(target)).toBe(true);
    expect(folds(target)).toEqual(["\n\nMehr."]);
  });

  it("[SR-193/AK3] leaves Tab to the others off a heading, on a heading with nothing under it and a selection beyond it", () => {
    expect(toggleSectionOnHeading(editor(TEXT, at(TEXT, "Der Zweck.")))).toBe(false);
    expect(toggleSectionOnHeading(editor(TEXT, at(TEXT, "- Liste")))).toBe(false);
    expect(toggleSectionOnHeading(editor(TEXT, TEXT.length))).toBe(false);
    const target = editor(TEXT);
    target.dispatch({ selection: { anchor: at(TEXT, "## Zweck"), head: at(TEXT, "Der Zweck.") } });
    expect(toggleSectionOnHeading(target)).toBe(false);
    expect(folds(target)).toEqual([]);
  });

  it("takes Tab in the editor on a heading", () => {
    const target = editor(TEXT, at(TEXT, "Zweck ##"));
    const tab = new KeyboardEvent("keydown", { key: "Tab", keyCode: 9, bubbles: true, cancelable: true });
    target.contentDOM.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(folds(target).length).toBe(1);
  });
});

describe("Go to heading", () => {
  it("[SR-191/AK3] puts the cursor at the start of the chosen heading, and a fold around it opens", () => {
    const target = editor(TEXT, at(TEXT, "Einleitung"));
    foldSection(target);
    const detail = headings(target.state).find((heading) => heading.name === "Detail");
    expect(goToHeading(detail?.from ?? -1)(target)).toBe(true);
    expect(target.state.selection.main.head).toBe(at(TEXT, "### Detail"));
    expect(folds(target)).toEqual([]);
    goToHeading(TEXT.length + 10)(target);
    expect(target.state.selection.main.head).toBe(TEXT.length);
  });
});

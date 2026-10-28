// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { MODIFIER_KEYS, fieldKey, fieldLabel, forBuffer, takesBackEdit } from "./element-keys.js";

/** An element buffer with a focusable field (the title), a field without a tab stop and a control in it. */
const buffer = (): { article: HTMLElement; title: HTMLElement; text: HTMLElement; inner: HTMLElement } => {
  const article = document.createElement("article");
  article.innerHTML =
    '<div class="field" data-field="Title" tabindex="0"><h1>T</h1></div>' +
    '<div class="field" data-field="Text"><div class="editor"><span>x</span></div></div>';
  const title = article.querySelector<HTMLElement>('[data-field="Title"]');
  const text = article.querySelector<HTMLElement>('[data-field="Text"]');
  const inner = article.querySelector<HTMLElement>("span");
  if (title === null || text === null || inner === null) {
    throw new Error("fixture");
  }
  return { article, title, text, inner };
};

describe("the keys of the element buffer", () => {
  it("names the field a key press is for, none on the buffer itself", () => {
    const { article, title, inner } = buffer();
    expect(fieldLabel(article, article)).toBeUndefined();
    expect(fieldLabel(title, article)).toBe("Title");
    expect(fieldLabel(inner, article)).toBe("Text");
  });

  it("takes a key press for the buffer on the buffer and on a field that has the focus itself", () => {
    const { article, title, text, inner } = buffer();
    expect(forBuffer(article, article)).toBe(true);
    expect(forBuffer(title, article)).toBe(true);
    expect(forBuffer(text, article)).toBe(false);
    expect(forBuffer(inner, article)).toBe(false);
    expect(forBuffer(new EventTarget(), article)).toBe(false);
  });

  it("handles Enter, Down to a field or to the elements of a package, and Escape and Up on a field", () => {
    expect(fieldKey("Enter", undefined, false)).toBe(true);
    expect(fieldKey("ArrowDown", undefined, false)).toBe(false);
    expect(fieldKey("ArrowDown", undefined, true)).toBe(true);
    expect(fieldKey("ArrowDown", "Text", false)).toBe(true);
    expect(fieldKey("Escape", undefined, true)).toBe(false);
    expect(fieldKey("Escape", "Text", false)).toBe(true);
    expect(fieldKey("ArrowUp", undefined, true)).toBe(false);
    expect(fieldKey("ArrowUp", "Title", false)).toBe(true);
    expect(fieldKey("a", "Title", true)).toBe(false);
  });

  it("takes back an Edit text still waiting with any key but Enter and the modifiers alone", () => {
    expect([...MODIFIER_KEYS]).toEqual(["Shift", "Control", "Alt", "Meta"]);
    for (const key of MODIFIER_KEYS) {
      expect(takesBackEdit(key)).toBe(false);
    }
    expect(takesBackEdit("Enter")).toBe(false);
    expect(takesBackEdit("a")).toBe(true);
    expect(takesBackEdit("ArrowDown")).toBe(true);
  });
});

// @vitest-environment happy-dom
// The states in which a swipe macOS reports switches no buffer (SR-163 AK4): each one alone, and the slash
// menu and the calendar of the focused editor.
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import type { SwitchState } from "./buffer-switch.js";
import { bufferSwitchBlocked, editorMenuOpen } from "./buffer-switch.js";
import { askDate, calendar, calendarOpen } from "./editor/calendar.js";

const NONE: SwitchState = {
  switching: false,
  prompting: false,
  contextMenu: false,
  about: false,
  nextKeys: false,
};

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) {
    view.destroy();
  }
  document.body.replaceChildren();
});

/** A focused editor with the calendar; the slash menu is shown in the app (`buffer-cycle-app.test.ts`). */
const editor = (): EditorView => {
  const host = document.createElement("div");
  document.body.append(host);
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: "",
      extensions: [calendar],
    }),
  });
  views.push(view);
  view.focus();
  return view;
};

describe("a swipe switches no buffer (SR-163 AK4)", () => {
  it("[SR-163/AK-fkcm] in each state of the window that blocks it, and in none other", () => {
    expect(bufferSwitchBlocked(NONE, document)).toBe(false);
    for (const state of ["switching", "prompting", "contextMenu", "about", "nextKeys"] as const) {
      expect(bufferSwitchBlocked({ ...NONE, [state]: true }, document)).toBe(true);
    }
  });

  it("[SR-163/AK-fkcm] while the calendar is open in the focused editor, not when the focus is elsewhere", () => {
    const view = editor();
    expect(editorMenuOpen(document)).toBe(false);
    askDate(view, "2026-11-13");
    expect(calendarOpen(view.state)).toBe(true);
    expect(editorMenuOpen(document)).toBe(true);
    expect(bufferSwitchBlocked(NONE, document)).toBe(true);
    const other = document.createElement("button");
    document.body.append(other);
    other.focus();
    expect(editorMenuOpen(document)).toBe(false);
  });
});

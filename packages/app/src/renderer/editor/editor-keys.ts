// The keys of the editors of the element buffer that the app adds to CodeMirror's own text editing keys, as tables
// for the keyboard reference (SR-139 AK5): the slash menu (`slash-menu.ts`, which builds its keymap from
// `SLASH_NEXT` and `SLASH_PREVIOUS`), the `[[` search (`reference-search.ts`) and the Markdown keymap
// (`markdown.ts`), and the keys between the editors (`box-navigation.ts`). Pure, so the documentation generator reads it without CodeMirror.
import type { KeyPress, KeyRow } from "../keys.js";
import { press } from "../keys.js";

/** The slash menu's keys for the next entry, as CodeMirror names them. */
export const SLASH_NEXT: readonly string[] = ["ArrowDown", "Tab", "Ctrl-n"];

/** The slash menu's keys for the entry before. */
export const SLASH_PREVIOUS: readonly string[] = ["ArrowUp", "Ctrl-p"];

/** A key as CodeMirror names it ("Ctrl-n", "ArrowDown"), as a press: Ctrl is the physical Ctrl key. */
export const codeMirrorPress = (name: string): KeyPress =>
  name.startsWith("Ctrl-") ? press(name.slice("Ctrl-".length), true) : press(name);

const pressesOf = (names: readonly string[]): KeyRow["keys"] =>
  names.map((name) => ({ press: codeMirrorPress(name) }));

/** The keys from an editor to the next box (`box-navigation.ts`): the arrow, and on macOS the Emacs key too. */
export const BOX_NEXT = { arrow: "ArrowDown", emacs: "Ctrl-n" } as const;

/** The keys from an editor to the box before. */
export const BOX_PREVIOUS = { arrow: "ArrowUp", emacs: "Ctrl-p" } as const;

const boxKeys = (keys: typeof BOX_NEXT | typeof BOX_PREVIOUS): KeyRow["keys"] => [
  { press: codeMirrorPress(keys.arrow) },
  { press: codeMirrorPress(keys.emacs), only: "mac" },
];

/** The keys of `boxNavigation`, at the edge of the text, the title or a box. */
export const BOX_KEYS: readonly KeyRow[] = [
  {
    keys: boxKeys(BOX_NEXT),
    does: "In the title, the text or a box, on its last line: into the next box",
  },
  {
    keys: boxKeys(BOX_PREVIOUS),
    does: "In the title, the text or a box, on its first line: into the box before",
  },
];

/** The keys typed into the text that start something (`/`, `[[`), and the keys of the slash menu. */
export const EDITOR_KEYS: readonly KeyRow[] = [
  {
    keys: [{ press: press("/") }],
    does: "In the text, at the start of a line or after a space: the slash menu with the Markdown elements at the caret",
  },
  {
    keys: [{ press: press("[[") }],
    does: "In the text and a Markdown property box, outside code and links: the prompt “Insert reference”; the pick replaces the `[[` with a reference, Escape leaves it as typed",
  },
  { keys: pressesOf(SLASH_NEXT), does: "In the slash menu: the next entry" },
  { keys: pressesOf(SLASH_PREVIOUS), does: "In the slash menu: the entry before" },
  { keys: [{ press: press("Enter") }], does: "In the slash menu: take the entry (one undo step)" },
  {
    keys: [{ press: press("Escape") }],
    does: "In the slash menu: close it and leave the `/` as typed",
  },
];

/** The Markdown keymap (`markdown.ts`): what Enter and Backspace do beyond typing. */
export const MARKDOWN_KEYS: readonly KeyRow[] = [
  {
    keys: [{ press: press("Enter") }],
    does: "In the text, in a list or a quote: continue it on the next line",
  },
  {
    keys: [{ press: press("Backspace") }],
    does: "In the text, right after the markup of a list item or a quote: remove the markup",
  },
];

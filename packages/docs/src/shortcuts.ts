// The page of the app's keyboard shortcuts (SR-139 AK5): the sections of `shortcutReference` of `@reqseq/app`, built
// from the app's own key tables, rendered as tables for Windows and Linux and for macOS.
import type { ShortcutSection } from "@reqseq/app";
import { cell, inline, table } from "./markdown.js";

/** The page below the content folder. */
export const SHORTCUTS_PAGE = "reference/keyboard-shortcuts.md";

/** A key cell: each key as code, a dash where the system has none. */
const keyCell = (keys: readonly string[]): string =>
  keys.length === 0 ? "—" : keys.map((key) => `\`${key}\``).join(", ");

/** The Markdown page of every key of the app, a section each. */
export function shortcutsPage(sections: readonly ShortcutSection[]): string {
  return [
    "---",
    "title: Keyboard shortcuts",
    "description: Every keyboard shortcut of the ReqSeq app with what it does, on Windows and Linux and on macOS.",
    "---",
    "",
    "The keys of the app, generated from the app's own key tables. On Windows and Linux the modifier is Ctrl; on macOS it is Cmd (⌘), and the physical Ctrl key (⌃) with a letter is never one of these shortcuts, except where a row names it. A dash means the key does not exist on that system.",
    "",
    ...sections.flatMap((section) => [
      `## ${inline(section.title)}`,
      "",
      inline(section.about),
      "",
      table(
        ["Windows and Linux", "macOS", "What it does"],
        section.rows.map((row) => [keyCell(row.keys), keyCell(row.mac), cell(row.does)]),
      ),
      "",
    ]),
  ].join("\n");
}

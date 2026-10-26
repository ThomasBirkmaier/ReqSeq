// The inline content of a range as pieces of text with style classes, for the cells of a table widget.
// The markup characters (emphasis marks, backticks, link brackets and destinations) are left out, and every
// piece carries the classes of the nodes around it. Pure: it only reads the syntax tree.
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { inlineMarkup } from "./markup.js";

export interface Segment {
  readonly text: string;
  readonly classes: readonly string[];
}

interface Char {
  readonly char: string;
  readonly classes: string[];
  hidden: boolean;
}

export const inlineSegments = (state: EditorState, from: number, to: number): Segment[] => {
  const text = state.doc.sliceString(from, to);
  const chars: Char[] = Array.from({ length: text.length }, (_, at) => ({
    char: text.charAt(at),
    classes: [],
    hidden: false,
  }));
  const range = (start: number, end: number): Char[] =>
    chars.slice(Math.max(start - from, 0), Math.max(end - from, 0));
  syntaxTree(state).iterate({
    from,
    to,
    enter: (ref) => {
      const markup = inlineMarkup(ref.node);
      for (const style of markup.styled) {
        for (const char of range(style.from, style.to)) {
          char.classes.push(style.className);
        }
      }
      for (const mark of markup.hidden) {
        for (const char of range(mark.from, mark.to)) {
          char.hidden = true;
        }
      }
    },
  });
  const segments: { text: string; classes: readonly string[] }[] = [];
  let open: { text: string; classes: readonly string[] } | undefined;
  for (const char of chars) {
    if (char.hidden) {
      open = undefined;
    } else if (open?.classes.join(" ") === char.classes.join(" ")) {
      open.text += char.char;
    } else {
      open = { text: char.char, classes: char.classes };
      segments.push(open);
    }
  }
  return segments;
};

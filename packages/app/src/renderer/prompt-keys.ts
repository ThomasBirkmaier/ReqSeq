// The keys of a prompt in the minibuffer (`Minibuffer.tsx`, SR-122, SR-108), as one table for the keyboard
// reference (SR-139 AK5). The minibuffer moves with `listStep` (`PROMPT_MOVES`) and takes `MORE_SHORTCUT` from here.
import type { KeyRow, Shortcut } from "./keys.js";
import { PROMPT_MOVES, press } from "./keys.js";

/** Ctrl/Cmd+Enter in a prompt: take the answer and offer the optional arguments; never "Follow reference". */
export const MORE_SHORTCUT: Shortcut = { mod: true, shift: false, key: "enter" };

/** The keys of every prompt, the command prompt and "Go to" among them. */
export const PROMPT_KEYS: readonly KeyRow[] = [
  ...PROMPT_MOVES,
  {
    keys: [{ press: press("Enter") }],
    does: "Take the candidate or the typed text; after the last required argument, run the command",
  },
  {
    keys: [{ shortcut: MORE_SHORTCUT }],
    does: "Take the answer, then offer the optional arguments of the command",
  },
  { keys: [{ press: press("Backspace") }], does: "In an empty input: back one argument" },
  { keys: [{ press: press("Escape") }], does: "Close the prompt" },
];

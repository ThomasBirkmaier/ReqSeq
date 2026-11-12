// The keys of a prompt in the minibuffer (`Minibuffer.tsx`, SR-122, SR-108), as one table for the keyboard
// reference (SR-139 AK5). The minibuffer moves with `listStep` (`PROMPT_MOVES`) and takes `MORE_SHORTCUT` from here.
import type { KeyPress, KeyRow, Shortcut } from "./keys.js";
import { PROMPT_MOVES, press } from "./keys.js";

/** Ctrl/Cmd+Enter in a prompt: take the answer and offer the optional arguments; never "Follow reference". */
export const MORE_SHORTCUT: Shortcut = { mod: true, shift: false, key: "enter" };

/** F1 in the command prompt: the documentation of the chosen entry, in the browser (SR-141 AK3). */
export const HELP_KEY = "F1";

/**
 * Ctrl+H in the command prompt: the command help of the marked command, or the description of an action of the app,
 * in the card, and back to the hits (SR-210 AK3, AK4, AK5). The physical Ctrl key on every system, also on macOS, where Cmd+H hides the app (SR-145 AK4).
 */
export const COMMAND_HELP_KEY: KeyPress = press("h", true);

/** Whether `event` is Ctrl+H (`COMMAND_HELP_KEY`): the physical Ctrl key alone with H. */
export const isCommandHelpKey = (event: KeyPress): boolean =>
  event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "h";

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
  {
    keys: [{ press: press("Enter") }, { press: { ...press("Enter"), shiftKey: true } }],
    does: "In “Find in element”: the next or the previous hit, the prompt stays open; in “Replace … with”: replace the current hit and go to the next, or go to the next without replacing",
  },
  { keys: [{ press: press("Backspace") }], does: "In an empty input: back one argument" },
  {
    keys: [{ press: press("Escape") }],
    does: "With the command help open: show the hits again; in a later step of a command: back one step, the prompt stays open; in the first step: close the prompt",
  },
  {
    keys: [{ press: press(HELP_KEY) }],
    does: "In the command prompt: open the reference page of the chosen command in the browser, or without one the start page of the documentation",
  },
  {
    keys: [{ press: COMMAND_HELP_KEY }],
    does: "In the command prompt: show the command help of the chosen command in the card, or the hits again",
  },
  {
    keys: [{ press: press("PageDown") }, { press: press("PageUp") }],
    does: "In the command help: scroll it down or up",
  },
];

// The keys of a prompt in the command prompt (`Minibuffer.tsx`, SR-122, SR-108), as one table for the keyboard
// reference (SR-139 AK5). The command prompt moves with `listStep` (`PROMPT_MOVES`) and takes `MORE_SHORTCUT` from here.
import type { KeyPress, KeyRow, Shortcut } from "./keys.js";
import { PROMPT_MOVES, press } from "./keys.js";

/** Ctrl/Cmd+Enter in a prompt: take the answer and offer the optional arguments; never "Follow reference". */
export const MORE_SHORTCUT: Shortcut = { mod: true, shift: false, key: "enter" };

/** F1 in the command prompt: the documentation of the chosen entry, in the browser (SR-141 AK3). */
export const HELP_KEY = "F1";

/** Ctrl/Cmd+C, which copies text selected in the command help (SR-210 AK4). */
export const COPY_SHORTCUT: Shortcut = { mod: true, shift: false, key: "c" };

/** Ctrl+N and Ctrl+P, the physical Ctrl key on every system (SR-122, SR-145 AK3), as the command help names them. */
export const NEXT_KEY: KeyPress = press("n", true);
export const PREVIOUS_KEY: KeyPress = press("p", true);

/**
 * Ctrl+H in the command prompt: the command help of the marked command, or the description of an action of the
 * app, slides in over the hits, and out again (SR-210 AK3, AK4, AK5). The physical Ctrl key on every system, also on
 * macOS, where Cmd+H hides the app (SR-145 AK4).
 */
export const COMMAND_HELP_KEY: KeyPress = press("h", true);

/** Whether `event` is Ctrl+H (`COMMAND_HELP_KEY`): the physical Ctrl key alone with H. */
export const isCommandHelpKey = (event: KeyPress): boolean =>
  event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "h";

/**
 * The last row of the command prompt with an empty input, and the last entry of the context menu: it lists every
 * command that can run in the shown view, by name (SR-133 AK3, SR-194 AK3).
 */
export const ALL_COMMANDS = "All commands…";

/**
 * What the explanation line says on "All commands…" (SR-210 AK5), as the keyboard reference gives it in its row
 * (`ALL_COMMANDS_ROW`, SR-210 AK6).
 */
export const ALL_COMMANDS_DESCRIPTION = "Show every command you can run here, by name.";

/** The row of "All commands…" in the keyboard reference: Enter on it, with its description (SR-210 AK6). */
export const ALL_COMMANDS_ROW: KeyRow = {
  keys: [{ press: press("Enter") }],
  does: `On “${ALL_COMMANDS}” in the command prompt`,
};

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
    does: "With the command help open: close it; in a later step of a command: back one step, the prompt stays open; in the first step: close the prompt",
  },
  {
    keys: [{ press: press(HELP_KEY) }],
    does: "In the command prompt: open the reference page of the chosen command in the browser, or without one the start page of the documentation",
  },
  {
    keys: [{ press: COMMAND_HELP_KEY }],
    does: "In the command prompt: show the command help of the chosen command over the hits, or close it",
  },
  {
    keys: [{ press: press("PageDown") }, { press: press("PageUp") }],
    does: "In the command help: scroll it down or up, as the arrow keys, Ctrl+N and Ctrl+P do there",
  },
];

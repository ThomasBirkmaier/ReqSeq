// A channel from the renderer to the main process (ADR-0010): "paste the clipboard into the focused field"
// (SR-195 AK3, "Paste" in the context menu and the command prompt). The renderer cannot read the clipboard,
// because the session refuses every permission, and it must not: main calls `webContents.paste()`, the
// path of the Edit menu's Paste, so Chromium gives the focused field a trusted paste event, which the editor
// handles as Ctrl/Cmd+V (`editor/paste.ts`, images as in SR-190). The renderer never gets the content.
//
// The renderer is not trusted, so a paste needs all of this: the one request `"paste"`, from the main frame
// of the ReqSeq window (`sender.ts`), within 1 s of an input the person made that can run a command, as
// `input-event` reports it, and at most one paste for each such input. Those inputs are the release of the
// left button (an entry of the menu or the command line clicked) and Enter without a modifier (an entry
// chosen by key, the command line's Enter, which "Paste" from the command line needs, SR-195 AK3). Space
// arms nothing, so typing a space never does; the menu's entry "Paste" is chosen by key with Enter.
// Main cannot tell where the Enter went: an Enter typed into the text arms a paste as well. So a renderer
// taken over can paste the clipboard into a field of its own, and read it there, within 1 s after any left
// click or bare Enter of the person, once each, without the person choosing Paste. Without this channel it
// could read the clipboard only when the person pressed Ctrl/Cmd+V.
import type Electron from "electron";
import { EDIT_CHANNEL } from "../shared/protocol.js";
import type { EditRequest } from "../shared/protocol.js";
import type { WindowContents } from "./sender.js";
import { fromReqSeqWindow } from "./sender.js";

/** The parts of the `electron` module the edit handler uses. */
export type EditElectron = Pick<typeof Electron, "ipcMain">;

/** The input event of `input-event`, as far as the handler reads it. */
export interface EditInput {
  readonly type: string;
  readonly button?: string;
  readonly key?: string;
  readonly keyCode?: string;
  readonly modifiers?: readonly string[];
}

/** The part of the window's web contents the handler needs. */
export interface EditContents extends WindowContents {
  on(event: "input-event", listener: (event: unknown, input: EditInput) => void): unknown;
  paste(): void;
}

/** How long after the input a paste is honoured. */
export const INPUT_WINDOW_MS = 1000;

const KEY_DOWN = new Set(["rawKeyDown", "keyDown"]);
const ENTER = new Set(["Enter", "Return"]);
/** Modifiers that make Enter another key (Shift+Enter goes back in a prompt, Ctrl/Cmd+Enter follows). */
const KEY_MODIFIERS = new Set(["shift", "control", "ctrl", "alt", "meta", "command", "cmd"]);

/**
 * Whether `input` is one that runs a command: the release of the left button (a click on an entry), or a
 * press of Enter without a modifier (an entry chosen by key, the command line's Enter). Not Space, which is
 * typed in every text.
 */
export const runsCommand = (input: EditInput): boolean =>
  (input.type === "mouseUp" && input.button === "left") ||
  (KEY_DOWN.has(input.type) &&
    (ENTER.has(input.key ?? "") || ENTER.has(input.keyCode ?? "")) &&
    !(input.modifiers ?? []).some((modifier) => KEY_MODIFIERS.has(modifier)));

/** The one request the channel takes. */
const PASTE: EditRequest = "paste";

/**
 * Answers EDIT_CHANNEL for the window with these web contents: `"paste"` from the contents' main frame,
 * showing the bundled renderer, within INPUT_WINDOW_MS of an input that runs a command and not yet
 * answered for that input, pastes with `contents.paste()` and is answered `true`; anything else does
 * nothing and is answered `false`.
 */
export const handleEdit = (
  electron: EditElectron,
  contents: EditContents,
  now: () => number = Date.now,
): void => {
  // The time of the last input that runs a command, until a paste takes it.
  let ranAt: number | undefined;
  contents.on("input-event", (_event, input) => {
    if (runsCommand(input)) {
      ranAt = now();
    }
  });
  electron.ipcMain.handle(EDIT_CHANNEL, (event, request: unknown): boolean => {
    const at = ranAt;
    if (request !== PASTE || !fromReqSeqWindow(event, contents) || at === undefined) {
      return false;
    }
    const elapsed = now() - at;
    if (elapsed < 0 || elapsed > INPUT_WINDOW_MS) {
      return false;
    }
    ranAt = undefined;
    contents.paste();
    return true;
  });
};

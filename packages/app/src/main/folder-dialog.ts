// A channel from the renderer to the main process (ADR-0010): "show the folder dialog of File > Open Workspace…"
// (SR-225 AK2: "Open workspace…" of the start buffer opens the folder dialog as the menu item does). Main shows the dialog
// and opens the chosen folder exactly as the menu item does (`open`); the renderer sends nothing and gets no path.
//
// The renderer is not trusted, so the dialog needs what a paste needs (`edit.ts`): a message from the main frame of
// the ReqSeq window (`sender.ts`), within 1 s of an input the person made that can run a command (a release of the
// left button, or Enter without a modifier: `runsCommand`), once per such input, and no dialog of it still open. A
// renderer taken over can so show the dialog after a click or Enter, but it opens only a folder the person chose.
import type Electron from "electron";
import { FOLDER_DIALOG_CHANNEL } from "../shared/protocol.js";
import type { EditContents } from "./edit.js";
import { INPUT_WINDOW_MS, runsCommand } from "./edit.js";
import { fromReqSeqWindow } from "./sender.js";

/** The parts of the `electron` module the handler uses. */
export type FolderDialogElectron = Pick<typeof Electron, "ipcMain">;

/** The part of the window's web contents the handler needs: its main frame and its input events. */
export type FolderDialogContents = Omit<EditContents, "paste">;

/**
 * Answers FOLDER_DIALOG_CHANNEL for the window with these web contents: a message from its main frame, within
 * INPUT_WINDOW_MS of an input that runs a command and not yet answered for that input, while no dialog of it is
 * open, starts `open` (the menu's dialog and what follows it) and is answered `true`; anything else is answered
 * `false` and shows nothing.
 */
export const handleFolderDialog = (
  electron: FolderDialogElectron,
  contents: FolderDialogContents,
  open: () => Promise<void>,
  now: () => number = Date.now,
): void => {
  // The time of the last input that runs a command, until a dialog takes it.
  let ranAt: number | undefined;
  let showing = false;
  contents.on("input-event", (_event, input) => {
    if (runsCommand(input)) {
      ranAt = now();
    }
  });
  electron.ipcMain.handle(FOLDER_DIALOG_CHANNEL, (event): boolean => {
    const at = ranAt;
    if (showing || !fromReqSeqWindow(event, contents) || at === undefined) {
      return false;
    }
    const elapsed = now() - at;
    if (elapsed < 0 || elapsed > INPUT_WINDOW_MS) {
      return false;
    }
    ranAt = undefined;
    showing = true;
    void open().finally(() => {
      showing = false;
    });
    return true;
  });
};

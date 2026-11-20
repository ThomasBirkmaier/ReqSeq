// Two channels from the renderer to the main process (ADR-0010): "show the folder dialog of File > Open Workspace…"
// (SR-225 AK2: "Open workspace…" of the start buffer opens the folder dialog as the menu item does), where main shows
// the dialog and opens the chosen folder as the menu item does (`open`); and "the folder for Create workspace" (AK4–AK6,
// `create`), where main takes the folder without a workspace the window has open, else shows the system folder dialog
// and opens the chosen folder itself (`Workspaces.createFolder`). The renderer sends nothing and gets no path: for
// Create workspace only what main did and the folder's name, which the name is pre-filled with (AK4).
//
// The renderer is not trusted, so the dialog needs what a paste needs (`edit.ts`): a message from the main frame of
// the ReqSeq window (`sender.ts`), within 1 s of an input the person made that can run a command (a release of the
// left button, or Enter without a modifier: `runsCommand`), once per such input, and no dialog of it still open. A
// renderer taken over can so show the dialog after a click or Enter, but it opens only a folder the person chose.
// Both channels share the condition: one dialog at a time, one per input.
import type Electron from "electron";
import type { CreateFolderAnswer } from "../shared/protocol.js";
import { CREATE_FOLDER_CHANNEL, FOLDER_DIALOG_CHANNEL } from "../shared/protocol.js";
import type { EditContents } from "./edit.js";
import { INPUT_WINDOW_MS, runsCommand } from "./edit.js";
import { fromReqSeqWindow } from "./sender.js";

/** The parts of the `electron` module the handler uses. */
export type FolderDialogElectron = Pick<typeof Electron, "ipcMain">;

/** The part of the window's web contents the handler needs: its main frame and its input events. */
export type FolderDialogContents = Omit<EditContents, "paste">;

/** What the two channels start in main. */
export interface FolderDialogs {
  /** The menu's dialog and what follows it (File > Open Workspace…). */
  readonly open: () => Promise<void>;
  /** The folder for "Create workspace" of the start buffer and its answer (`Workspaces.createFolder`). */
  readonly create: () => Promise<CreateFolderAnswer>;
}

const REFUSED: CreateFolderAnswer = { outcome: "refused" };

/**
 * Answers FOLDER_DIALOG_CHANNEL and CREATE_FOLDER_CHANNEL for the window with these web contents: a message from
 * its main frame, within INPUT_WINDOW_MS of an input that runs a command and not yet answered for that input, while
 * no dialog of either is open, starts `open`, answered `true`, or `create`, answered with its answer once it is
 * done; anything else is answered `false` or `refused` and shows nothing.
 */
export const handleFolderDialog = (
  electron: FolderDialogElectron,
  contents: FolderDialogContents,
  dialogs: FolderDialogs,
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
  /** Starts `run` when the message may show a dialog now; undefined when it may not. */
  const gated = <T>(event: Electron.IpcMainInvokeEvent, run: () => Promise<T>): Promise<T> | undefined => {
    const at = ranAt;
    if (showing || !fromReqSeqWindow(event, contents) || at === undefined) {
      return undefined;
    }
    const elapsed = now() - at;
    if (elapsed < 0 || elapsed > INPUT_WINDOW_MS) {
      return undefined;
    }
    ranAt = undefined;
    showing = true;
    return run().finally(() => {
      showing = false;
    });
  };
  electron.ipcMain.handle(
    FOLDER_DIALOG_CHANNEL,
    (event): boolean => gated(event, dialogs.open) !== undefined,
  );
  electron.ipcMain.handle(
    CREATE_FOLDER_CHANNEL,
    (event): Promise<CreateFolderAnswer> => gated(event, dialogs.create) ?? Promise.resolve(REFUSED),
  );
};

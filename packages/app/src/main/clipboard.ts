// A channel from the renderer to the main process (ADR-0010): "put this text on the clipboard"
// (SR-128). The renderer cannot use the clipboard API itself, because the session refuses every
// permission, so the main process writes it. The renderer is not trusted: the text must be a string of
// bounded length, and the message must come from the main frame of the LogReq window (`sender.ts`).
import type Electron from "electron";
import { COPY_CHANNEL, MAX_COPY_LENGTH } from "../shared/protocol.js";
import type { WindowContents } from "./sender.js";
import { fromLogReqWindow } from "./sender.js";

/** The parts of the `electron` module the clipboard handler uses. */
export type ClipboardElectron = Pick<typeof Electron, "ipcMain" | "clipboard">;

/**
 * Answers COPY_CHANNEL for the window with these web contents: a string of at most MAX_COPY_LENGTH
 * characters from the contents' main frame, showing the bundled renderer (`app://logreq`), is written
 * with `clipboard.writeText` and answered `true`; anything else writes nothing and is answered `false`, as
 * is a clipboard that cannot be written.
 */
export const handleCopy = (electron: ClipboardElectron, contents: WindowContents): void => {
  electron.ipcMain.handle(COPY_CHANNEL, async (event, text: unknown): Promise<boolean> => {
    if (typeof text !== "string" || text.length > MAX_COPY_LENGTH || !fromLogReqWindow(event, contents)) {
      return false;
    }
    try {
      await electron.clipboard.writeText(text);
      return true;
    } catch {
      // The system clipboard is not available; the renderer says "Copy failed".
      return false;
    }
  });
};

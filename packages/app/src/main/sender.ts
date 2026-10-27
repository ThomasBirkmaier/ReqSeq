// Who may send a message from a renderer to the main process (ADR-0010): the main frame of the web
// contents of the LogReq window, showing the bundled renderer (`app://logreq`). The renderer is not
// trusted, so every channel from it (`logreq:copy`, `logreq:recent-workspaces`,
// `logreq:open-workspace`, `logreq:saved`) checks this first; what it then accepts is each handler's own
// check.
import { RENDERER_HOST } from "./protocols.js";

/** The part of the event of `ipcMain.handle` that decides who sent it. */
export interface SenderEvent {
  readonly sender: unknown;
  readonly senderFrame: { readonly url: string } | null;
}

/** The part of the window's web contents the check needs. */
export interface WindowContents {
  readonly mainFrame: { readonly url: string };
}

/** Whether `event` comes from the main frame of `contents`, showing the bundled renderer. */
export const fromLogReqWindow = (event: unknown, contents: WindowContents): boolean => {
  const { sender, senderFrame } = event as SenderEvent;
  const url = senderFrame === null ? null : URL.parse(senderFrame.url);
  return (
    sender === contents &&
    senderFrame === contents.mainFrame &&
    url?.protocol === "app:" &&
    url.host === RENDERER_HOST
  );
};

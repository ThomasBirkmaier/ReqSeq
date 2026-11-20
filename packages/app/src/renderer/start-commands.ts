// The start buffer (SR-225 AK1–AK3): while no workspace is open in the window and no buffer is shown, the sheet
// shows the start commands "Open workspace…" with the key of File > Open Workspace…, "Create workspace" and
// "Connect AI agent", and nothing else. It is a buffer (D-062), so the main view stays as SR-100 says. Pure: the
// lines, when the buffer is shown, and what a chosen line does (`StartView.tsx` draws them, `App.tsx` runs them).
import { INIT_WORKSPACE_COMMAND, folderKey } from "../shared/open-hint.js";
import { CONNECT_AI_AGENT } from "./connect-agent.js";
import type { WorkspaceView } from "./modeline.js";

/** What a line of the start buffer starts. */
export type StartCommand = "open" | "create" | "connect";

/** A line of the start buffer: its command, its text and, for "Open workspace…", the key of the menu item. */
export interface StartLine {
  readonly command: StartCommand;
  readonly label: string;
  readonly key?: string;
}

/** The title of the line that shows the folder dialog, as the menu item File > Open Workspace… does. */
export const OPEN_WORKSPACE_LINE = "Open workspace…";

/** The lines of the start buffer, in their order, with the keys of macOS when `mac` (AK1). */
export const startLines = (mac: boolean): readonly StartLine[] => [
  { command: "open", label: OPEN_WORKSPACE_LINE, key: folderKey(mac) },
  { command: "create", label: INIT_WORKSPACE_COMMAND },
  { command: "connect", label: CONNECT_AI_AGENT },
];

/**
 * Whether the window shows the start buffer: once the status is known (so a start with a workspace does not show it
 * first), while no workspace is open, also in a folder without one or after an open failed (AK1), and no other
 * buffer is shown, such as the output of a command run there. An opened workspace shows its overview (AK3).
 */
export const startShown = (view: WorkspaceView | undefined, shownBuffers: number): boolean =>
  view !== undefined && view.name === undefined && shownBuffers === 0;

/** What the window can do for a line of the start buffer. */
export interface StartRunner {
  /** Main shows the folder dialog of File > Open Workspace… (`openFolderDialog` of the bridge). */
  readonly folderDialog: () => void;
  /** "Create workspace" of the start buffer (AK4–AK6, `create-workspace.ts`). */
  readonly createWorkspace: () => void;
  /** The action "Connect AI agent" (SR-225 AK7), as the modeline starts it. */
  readonly connectAgent: () => void;
}

/**
 * Runs a chosen line (AK2): "Open workspace…" shows the folder dialog as the menu item does, "Create workspace"
 * begins as AK4 says (the folder, then only the name), and "Connect AI agent" runs as AK7 says.
 */
export const runStart = (command: StartCommand, runner: StartRunner): void => {
  if (command === "open") {
    runner.folderDialog();
  } else if (command === "connect") {
    runner.connectAgent();
  } else {
    runner.createWorkspace();
  }
};

// How the command prompt says to open a workspace, with keys only: Windows and Linux hide the menu bar until Alt
// (ADR-0010), so File > Open Workspace is not visible there. The keys come from the menu (`menu-keys.ts`) and the
// command prompt (`keys.ts`), so the text cannot drift from them. Pure: the preload and the renderer read it.
import { COMMAND_SHORTCUT, shortcutLabel } from "../renderer/keys.js";
import { OPEN_WORKSPACE, acceleratorShortcut } from "./menu-keys.js";

/** The title of the command prompt's action that opens a workspace (SR-131). */
export const OPEN_WORKSPACE_ACTION = "Open workspace";

/** The key of File > Open Workspace…, which opens the folder dialog: Ctrl+O, or ⌘O on macOS (`mac`). */
const folderKey = (mac: boolean): string =>
  shortcutLabel(acceleratorShortcut(OPEN_WORKSPACE.accelerator), mac);

/**
 * What the command prompt says while no workspace is open: the folder dialog, which also opens a folder without a
 * workspace for "Initialise workspace", and the action of the command prompt for the workspaces opened last.
 */
export const noWorkspaceMessage = (mac: boolean): string =>
  `No workspace is open. Press ${folderKey(mac)} to choose a folder, or ` +
  `${shortcutLabel(COMMAND_SHORTCUT, mac)} for ${OPEN_WORKSPACE_ACTION}.`;

/** The title of the catalog command `workspace.init`, which the command prompt offers in a folder without a workspace. */
export const INIT_WORKSPACE_COMMAND = "Initialise workspace";

/** What follows the message of a folder without a workspace, chosen in the folder dialog. */
export const initHint = (mac: boolean): string =>
  `To create one here, press ${shortcutLabel(COMMAND_SHORTCUT, mac)} for ${INIT_WORKSPACE_COMMAND}.`;

/** What it says after the core process stopped for good: the folder dialog opens the workspace again. */
export const stoppedMessage = (mac: boolean): string =>
  `The core process keeps stopping. Press ${folderKey(mac)} to open the workspace again.`;

// "Open workspace" (SR-131): a minibuffer prompt with the workspaces opened last, the most recent first,
// narrowed as typed with the fuzzy search of the command prompt (`fuzzy.ts`); choosing one opens it in
// this window in place of the open workspace. The list and the switch are the main process's (bridge
// `recentWorkspaces`, `openWorkspace`); the renderer shows the list as it comes and asks main to open.
import type { OpenWorkspaceResult, RecentWorkspaceEntry } from "../shared/protocol.js";
import type { Choice, Prompt } from "./actions.js";

/** The workspaces of the window: the open one's name, the list and the switch (from the bridge). */
export interface WorkspaceControls {
  /** The name of the open workspace; undefined while none is open. */
  readonly name: string | undefined;
  readonly list: () => Promise<readonly RecentWorkspaceEntry[]>;
  readonly open: (root: string) => Promise<OpenWorkspaceResult>;
}

export interface WorkspacePromptContext {
  readonly workspaces: WorkspaceControls;
  readonly echo: (message: string) => void;
  /**
   * The name of an open buffer with unsaved input, else undefined. Until a switch saves first (SR-131
   * AK3, next step), a switch with unsaved input is refused, so nothing typed is lost.
   */
  readonly unsaved: () => string | undefined;
}

/** What the echo says when the chosen workspace is gone (SR-131 AK4). */
const notFound = (root: string, open: string | undefined): string =>
  `${root} is not found; ${open === undefined ? "no workspace is open" : `${open} stays open`}`;

const choose = (context: WorkspacePromptContext, { root, state }: RecentWorkspaceEntry): void => {
  const { workspaces, echo } = context;
  switch (state) {
    case "open":
      echo(`${root} is open`);
      return;
    case "missing":
      echo(notFound(root, workspaces.name));
      return;
    case "found": {
      const unsaved = context.unsaved();
      if (unsaved !== undefined) {
        echo(`Unsaved input in ${unsaved}: save it before opening another workspace`);
        return;
      }
      // Opened, the window learns it as `workspace-changed` (`opened`) and shows the new workspace.
      void workspaces.open(root).then((result) => {
        if (!result.ok) {
          echo(result.reason === "missing" ? notFound(root, workspaces.name) : `${root} could not be opened`);
        }
      });
      return;
    }
  }
};

/** One workspace of the list: its full path (so typing narrows on folder names), marked open or not found. */
const workspaceChoice = (context: WorkspacePromptContext, entry: RecentWorkspaceEntry): Choice => ({
  id: `workspace:${entry.root}`,
  name: entry.root,
  ...(entry.state === "found" ? {} : { hint: entry.state === "open" ? "open" : "not found" }),
  run: () => {
    choose(context, entry);
  },
});

/**
 * The prompt "Workspace": it opens at once and takes keys while main reads the list. The choices keep
 * main's order (the most recent first); the prompt ranks the matches of a typed text and keeps that order
 * among equal ones, as the command prompt does.
 */
export const workspacePrompt = (context: WorkspacePromptContext): Prompt => ({
  label: "Workspace",
  items: [],
  fill: context.workspaces.list().then((entries) => ({
    ...(entries.length === 0 ? { label: "Workspace (none opened yet)" } : {}),
    items: entries.map((entry) => workspaceChoice(context, entry)),
  })),
});

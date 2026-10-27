// "Open workspace" (SR-131): a minibuffer prompt with the workspaces opened last, the most recent first,
// narrowed as typed with the fuzzy search of the command prompt (`fuzzy.ts`); choosing one opens it in
// this window in place of the open workspace. A typed folder path is a choice of its own, the first one
// (AK5): it opens the workspace found from that folder upwards. The list and the switch are the main
// process's (bridge `recentWorkspaces`, `openWorkspace`); main has the window save its unsaved input
// before it switches (AK3, `switch.ts`). The renderer shows the list as it comes and asks main to open.
import type { OpenWorkspaceOptions, OpenWorkspaceResult, RecentWorkspaceEntry } from "../shared/protocol.js";
import type { Choice, Prompt } from "./actions.js";
import { notSavedInTime } from "./switch.js";

/** The workspaces of the window: the open one's name, the list and the switch (from the bridge). */
export interface WorkspaceControls {
  /** The name of the open workspace; undefined while none is open. */
  readonly name: string | undefined;
  readonly list: () => Promise<readonly RecentWorkspaceEntry[]>;
  readonly open: (root: string, options?: OpenWorkspaceOptions) => Promise<OpenWorkspaceResult>;
}

export interface WorkspacePromptContext {
  readonly workspaces: WorkspaceControls;
  readonly echo: (message: string) => void;
}

/** What stays open when nothing opens. */
const staying = (open: string | undefined): string =>
  open === undefined ? "no workspace is open" : `${open} stays open`;

/** What the echo says when the chosen workspace is gone (SR-131 AK4). */
const notFound = (root: string, open: string | undefined): string => `${root} is not found; ${staying(open)}`;

/**
 * What the echo says when main did not open `path`. Nothing for `unsaved`: the window already said which
 * input could not be saved (`switch.ts`).
 */
const refusal = (
  path: string,
  result: Exclude<OpenWorkspaceResult, { readonly ok: true }>,
  open: string | undefined,
  typed: boolean,
): string | undefined => {
  switch (result.reason) {
    case "missing":
      return notFound(path, open);
    case "no-workspace":
      return `No workspace in ${path} or a folder above it; ${staying(open)}`;
    case "unsaved":
      return undefined;
    case "timeout":
      return notSavedInTime(open);
    case "busy":
      return `Another workspace is being opened; ${staying(open)}`;
    case "refused":
      return typed ? `${path} is not an absolute path of a local folder` : `${path} could not be opened`;
  }
};

/** Asks main to open `path`; the window learns a switch as `workspace-changed` (`opened`). */
const openThrough = (context: WorkspacePromptContext, path: string, typed: boolean): void => {
  const { workspaces, echo } = context;
  void workspaces.open(path, ...(typed ? [{ typed }] : [])).then((result) => {
    const message = result.ok ? undefined : refusal(path, result, workspaces.name, typed);
    if (message !== undefined) {
      echo(message);
    }
  });
};

const choose = (context: WorkspacePromptContext, { root, state }: RecentWorkspaceEntry): void => {
  const { workspaces, echo } = context;
  switch (state) {
    case "open":
      echo(`${root} is open`);
      return;
    case "missing":
      echo(notFound(root, workspaces.name));
      return;
    case "found":
      openThrough(context, root, false);
      return;
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
 * Whether a typed text looks like a folder path, so the prompt offers to open it: it starts with `/`,
 * `~`, `\` or a drive letter with `:` and a separator. Main decides whether it is one it opens.
 */
export const isFolderPath = (text: string): boolean => /^(?:[/~\\]|[A-Za-z]:[\\/])/.test(text);

/** The choice for a typed folder path (AK5): it opens the workspace of that folder. */
const typedChoice = (context: WorkspacePromptContext, query: string): Choice | undefined => {
  const path = query.trim();
  return isFolderPath(path)
    ? {
        id: `folder:${path}`,
        name: `Open ${path}`,
        hint: "folder",
        run: () => {
          openThrough(context, path, true);
        },
      }
    : undefined;
};

/**
 * The prompt "Workspace": it opens at once and takes keys while main reads the list. The choices keep
 * main's order (the most recent first); the prompt ranks the matches of a typed text and keeps that order
 * among equal ones, as the command prompt does. A typed folder path comes first.
 */
export const workspacePrompt = (context: WorkspacePromptContext): Prompt => ({
  label: "Workspace",
  items: [],
  literal: (query) => typedChoice(context, query),
  fill: context.workspaces.list().then((entries) => ({
    ...(entries.length === 0 ? { label: "Workspace (none opened yet)" } : {}),
    items: entries.map((entry) => workspaceChoice(context, entry)),
  })),
});

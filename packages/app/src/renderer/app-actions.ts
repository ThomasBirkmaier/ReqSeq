// The actions on the window as a whole (view, theme, workspace, documentation, folding, Follow agent);
// `ACTIONS` (`actions.ts`) lists them.
import type { Shortcut } from "./keys.js";
import { OPEN_WORKSPACE_ACTION } from "../shared/open-hint.js";
import type { ShownView } from "./views.js";
import { viewName, viewsOf } from "./views.js";
import { foldPrompt } from "./fold-actions.js";
import { workspacePrompt } from "./workspaces.js";
import type { Choice, Prompt, PromptFill, ActionContext, ViewControls, Action } from "./action-types.js";
import { hasWorkspace } from "./action-conditions.js";
import { CONNECT_AGENT, CONNECT_AGENT_ACTION, CONNECT_AI_AGENT } from "./connect-agent.js";
import { AGENT_GUIDE, WRITE_SKILL_ACTION, WRITE_SKILL_FILE } from "./write-skill.js";

/**
 * Ctrl/Cmd+Shift+O turns the mode „Agent folgen“ on, and off again (SR-117 AK4). Not Shift+G: that is the
 * graph (SR-111); Ctrl/Cmd+G stays free for the keyboard-quit, Ctrl/Cmd+K is the prefix key
 * (`bindings.ts`, ThomasBirkmaier/ReqSeq-archive#472).
 */
export const FOLLOW_SHORTCUT: Shortcut = { mod: true, shift: true, key: "o" };

/** "All elements" ends a view; the window shows no view at the start. */
const ALL_VIEWS = "All elements";

/**
 * The prompt "View" of "Choose view" (SR-043 AK1): all elements, the core and each variant of the
 * workspace (`viewsOf`), the one shown marked. It opens at once and takes keys while core reads them.
 */
const viewPrompt = (context: ActionContext, views: ViewControls): Prompt => {
  const choice = (id: string, name: string, next: ShownView | undefined): Choice => ({
    id,
    name,
    ...(views.shown?.view === next?.view ? { hint: "shown" } : {}),
    run: () => {
      views.choose(next);
      context.echo(next === undefined ? "Showing all elements" : `Showing the view ${viewName(next)}`);
    },
  });
  return {
    label: "View",
    items: [],
    fill: viewsOf(context.call).then((read): PromptFill => {
      if (!read.ok) {
        context.echo(read.message);
      }
      return {
        items: [
          choice("view:all", ALL_VIEWS, undefined),
          ...(read.ok ? read.views : []).map((shown) => choice(`view:${shown.view}`, viewName(shown), shown)),
        ],
      };
    }),
  };
};

export const APP_ACTIONS: readonly Action[] = [
  {
    id: "choose-view",
    title: "Choose view",
    description: "Choose the view the app shows: the view of the core or of a variant.",
    available: (context: ActionContext): boolean => context.workspace && context.views !== undefined,
    run: (context: ActionContext): void => {
      const { views } = context;
      if (views !== undefined) {
        context.ask(viewPrompt(context, views));
      }
    },
  },
  {
    id: "toggle-dark-mode",
    title: "Toggle dark mode",
    description: "Switch between light and dark mode until the app quits.",
    available: hasWorkspace,
    run: (context: ActionContext): void => {
      const scheme = context.theme.toggle();
      context.echo(scheme === "dark" ? "Dark mode until the app quits" : "Light mode until the app quits");
    },
  },
  {
    // Also without an open workspace: then it is the one action of the command prompt (SR-131).
    id: "open-workspace",
    title: OPEN_WORKSPACE_ACTION,
    description: "Open a workspace opened before, or the one in a typed folder.",
    available: (context: ActionContext): boolean => context.workspaces !== undefined,
    run: (context: ActionContext): void => {
      const { workspaces } = context;
      if (workspaces !== undefined) {
        context.ask(workspacePrompt({ workspaces, echo: context.echo }));
      }
    },
  },
  {
    // The catalog command of the same title (SR-227), which it covers; also without a workspace, which it
    // then asks first (SR-225 AK7).
    id: CONNECT_AGENT_ACTION,
    title: CONNECT_AI_AGENT,
    covers: [CONNECT_AGENT],
    available: (context: ActionContext): boolean => context.connectAgent !== undefined,
    run: (context: ActionContext): void => {
      context.connectAgent?.(context);
    },
  },
  {
    // "Agent guide" with fixed input, beside the entry of the catalog command, so it covers nothing and has its own
    // description (SR-229 AK16, SR-210 AK5, SR-139 AK6); also while the tool refuses writes (AK8).
    id: WRITE_SKILL_ACTION,
    title: WRITE_SKILL_FILE,
    description: "Write the skill file for AI agents into the repository of the workspace.",
    runs: [{ where: "with skill and write", command: AGENT_GUIDE }],
    available: (context: ActionContext): boolean => context.workspace && context.writeSkill !== undefined,
    run: (context: ActionContext): void => {
      context.writeSkill?.(context);
    },
  },
  {
    // Also without a workspace: the documentation helps most before one is open (SR-141).
    id: "open-documentation",
    title: "Open documentation",
    description: "Open the documentation of ReqSeq in the browser.",
    available: (context: ActionContext): boolean => context.docs !== undefined,
    run: (context: ActionContext): void => {
      context.docs?.();
    },
  },
  {
    id: "follow-system-theme",
    title: "Follow system light or dark mode",
    description: "Follow the computer's light or dark setting again.",
    available: (context: ActionContext): boolean => context.workspace && context.theme.chosen(),
    run: (context: ActionContext): void => {
      context.theme.follow();
      context.echo("Light or dark as the system says");
    },
  },
  {
    id: "fold-status",
    title: "Fold status in lists",
    description:
      "Choose a status whose elements fold to the end of every list, or whose folded elements go back to their place.",
    available: (context: ActionContext): boolean => context.workspace && context.folds !== undefined,
    run: (context: ActionContext): void => {
      const { folds } = context;
      if (folds !== undefined) {
        context.ask(foldPrompt(context, folds));
      }
    },
  },
  {
    // Offered only after a choice, as "Follow system light or dark mode".
    id: "fold-invalid-statuses",
    title: "Fold invalid statuses in lists",
    description: "Fold the elements in invalid statuses to the end of every list again.",
    available: (context: ActionContext): boolean => context.workspace && context.folds?.choice !== undefined,
    run: (context: ActionContext): void => {
      context.folds?.choose(undefined);
      context.echo("Invalid statuses fold in lists");
    },
  },
  {
    id: "follow-agent",
    title: "Follow agent",
    description: "Show each element when it is read or changed through the API or MCP.",
    shortcut: FOLLOW_SHORTCUT,
    available: (context: ActionContext): boolean => context.workspace && context.follow?.on === false,
    run: (context: ActionContext): void => {
      context.follow?.start();
    },
  },
  {
    id: "stop-following-agent",
    title: "Stop following agent",
    description: "Stop showing the elements read or changed through the API or MCP.",
    shortcut: FOLLOW_SHORTCUT,
    available: (context: ActionContext): boolean => context.workspace && context.follow?.on === true,
    run: (context: ActionContext): void => {
      context.follow?.stop();
    },
  },
];

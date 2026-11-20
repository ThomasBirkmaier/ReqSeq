// The next steps of an output (SR-226 AK5): the steps core names in its field `next` (`#/$defs/nextStep`), which the
// output page shows as its last lines, each by the name the command prompt gives its command and with its key where
// it has one (`appCommandEntry`). Choosing one runs that entry of the command prompt with the step's known inputs
// given (`ActionContext.given`, as the matrix gives them, SR-199), so the prompt asks only the open ones (SR-108
// AK6). A step whose workspace is not the open one opens that workspace first and runs there (`stepRunner`). An
// app action that covers the command (`coveringAction`, such as "Connect AI agent") takes no given inputs: it asks
// all of its inputs itself. Layout and lookup only: which steps an output names is core's (ADR-0002).
import type { NextStep } from "@reqseq/core";
import type { CommandListing, RecentWorkspaceEntry } from "../shared/protocol.js";
import type { WorkspaceControls } from "./workspaces.js";
import { openWorkspaceAt } from "./workspaces.js";
import { appCommandEntry, coveringAction } from "./command-entry.js";
import type { Prefilled } from "./matrix-menu.js";

export type { NextStep };

/** The field of an output that holds its next steps. */
export const NEXT_FIELD = "next";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether `value` is a list of next steps: records that each name a command. */
export const isStepList = (value: unknown): value is readonly NextStep[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((step: unknown) => isRecord(step) && typeof step["command"] === "string");

/** The next steps an output names in `next`; none when it names none. */
export const nextStepsOf = (output: unknown): readonly NextStep[] => {
  const next = isRecord(output) ? output[NEXT_FIELD] : undefined;
  return isStepList(next) ? next : [];
};

/** How a step's line names it: the name the command prompt gives its command, and its key where it has one. */
export interface StepEntry {
  readonly name: string;
  readonly key?: string;
}

/** The entry of the step's command (`appCommandEntry`); a command the catalog does not list goes by its name. */
export const stepEntry = (command: string, catalog: readonly CommandListing[], mac: boolean): StepEntry => {
  const listed = catalog.find((each) => each.name === command);
  if (listed === undefined) {
    return { name: command };
  }
  const { name, key } = appCommandEntry(listed, mac);
  return { name, ...(key === undefined ? {} : { key }) };
};

/** The ID of the command prompt's entry that runs the step: the action that covers its command, else the command. */
export const stepItemId = (step: NextStep, catalog: readonly CommandListing[]): string => {
  const listed = catalog.find((each) => each.name === step.command);
  const action = listed === undefined ? undefined : coveringAction(listed);
  return action?.id ?? `command:${step.command}`;
};

/** The known inputs of the step as the arguments the command prompt counts as given, in their order. */
export const stepGiven = (step: NextStep): Prefilled[] =>
  Object.entries(step.input).map(([field, value]) => ({
    field,
    value,
    label: typeof value === "string" ? value : JSON.stringify(value),
  }));

/**
 * What a choice of a step says when no entry of the command prompt runs it in its own workspace, such as a write
 * command in a read-only workspace.
 */
export const stepUnavailable = (name: string): string => `${name} cannot run here`;

/** What runs a step that is chosen, from the window. */
export interface StepRunnerDeps {
  /** The workspaces of the window; undefined without them. */
  readonly workspaces: () => WorkspaceControls | undefined;
  readonly echo: (message: string) => void;
  /** The read of the catalog while it runs, else undefined. */
  readonly catalogRead: () => Promise<void> | undefined;
  /** Runs the step's entry of the command prompt in the open workspace, or says that it cannot run here. */
  readonly run: (step: NextStep) => void;
}

/** A chosen step, and what the window learns of the switch to its workspace. */
export interface StepRunner {
  readonly choose: (step: NextStep) => void;
  /** The workspace of the window changed (`workspace-changed`). */
  readonly changed: (reason: string) => void;
  /** The status of the window's workspace arrived; `open`: a workspace is open. */
  readonly shown: (open: boolean) => void;
}

/** Whether the workspace the list of recent workspaces marks open is `root`. */
const isOpen = (entries: readonly RecentWorkspaceEntry[], root: string): boolean =>
  entries.find((entry) => entry.state === "open")?.root === root;

/**
 * Runs a chosen step: at once in the open workspace when the step names no workspace or the open one; else it
 * first opens the step's workspace as "Open workspace" does (`openWorkspaceAt`, also while none is open) and
 * runs the step once that workspace is open and its status and the catalog are read. A workspace that does
 * not open runs nothing: the command line says why, as the prompt "Workspace" says it. While one step waits
 * for its workspace, another chosen step runs nothing.
 */
export const stepRunner = (deps: StepRunnerDeps): StepRunner => {
  // The step whose workspace is being opened, and whether the window learned that its open happened: from the
  // choice on, so a second choice before main's answer cannot take its place.
  let pending:
    | {
        readonly step: NextStep;
        readonly root: string;
        readonly workspaces: WorkspaceControls;
        readonly opened: boolean;
      }
    | undefined;
  /** Ends the wait of `step` only, never that of a later one. */
  const end = (step: NextStep): void => {
    if (pending?.step === step) {
      pending = undefined;
    }
  };
  return {
    choose: (step) => {
      const workspaces = deps.workspaces();
      const root = step.workspace;
      if (root === undefined || workspaces === undefined) {
        deps.run(step);
        return;
      }
      if (pending !== undefined) {
        return;
      }
      pending = { step, root, workspaces, opened: false };
      workspaces.list().then(
        (entries) => {
          if (isOpen(entries, root)) {
            end(step);
            deps.run(step);
            return;
          }
          const opening = (on: boolean): void => {
            if (!on) {
              end(step);
            }
          };
          openWorkspaceAt({ workspaces, echo: deps.echo, opening }, entries, root);
        },
        () => {
          end(step);
          deps.echo(`${root} could not be opened`);
        },
      );
    },
    changed: (reason) => {
      if (pending === undefined) {
        return;
      }
      // No core process runs, or a second open came after the step's own: the step does not run.
      if (reason === "stopped" || (reason === "opened" && pending.opened)) {
        pending = undefined;
      } else if (reason === "opened") {
        pending = { ...pending, opened: true };
      }
    },
    shown: (open) => {
      if (pending?.opened !== true) {
        return;
      }
      const { step, root, workspaces } = pending;
      pending = undefined;
      // The workspace did not open after all: its status says why.
      if (!open) {
        return;
      }
      // Only in its own workspace, never in one opened in its place meanwhile.
      void Promise.all([workspaces.list(), deps.catalogRead()]).then(
        ([entries]) => {
          if (isOpen(entries, root)) {
            deps.run(step);
          }
        },
        () => undefined,
      );
    },
  };
};

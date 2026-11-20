// The next steps of an output (SR-226 AK5): the steps core names in its field `next` (`#/$defs/nextStep`), which the
// output page shows as its last lines, each by the name the command prompt gives its command and with its key where
// it has one (`appCommandEntry`). Choosing one runs that entry of the command prompt with the step's known inputs
// given (`ActionContext.given`, as the matrix gives them, SR-199), so the prompt asks only the open ones (SR-108
// AK6). An app action that covers the command (`coveringAction`, such as "Connect AI agent") takes no given inputs:
// it asks all of its inputs itself. Layout and lookup only: which steps an output names is core's (ADR-0002).
import type { NextStep } from "@reqseq/core";
import type { CommandListing } from "../shared/protocol.js";
import type { WorkspaceControls } from "./workspaces.js";
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
 * What a choice of a step says when the command prompt has no entry that runs it now: "open it first" only while
 * the step names a workspace that is not the open one (`open`: the root of the open workspace, undefined while none
 * is open). In its own workspace, such as a write command in a read-only workspace, the step cannot run here.
 */
export const stepUnavailable = (step: NextStep, name: string, open: string | undefined): string =>
  step.workspace === undefined || step.workspace === open
    ? `${name} cannot run here`
    : `${name} runs in the workspace ${step.workspace}: open it first`;

/** The root of the open workspace, as the list of recent workspaces marks it; undefined while none is open. */
export const openRoot = async (workspaces: WorkspaceControls | undefined): Promise<string | undefined> =>
  (await workspaces?.list())?.find((entry) => entry.state === "open")?.root;

// The next steps (SR-226): which command to run next, with the inputs known already and those still to
// give, as data (`common.schema.json#/$defs/nextStep`). Every access shows them in its own form from the
// same data (AK4): the command line as calls.
import type { NextStep } from "./generated/types.js";

/** Creating a workspace in `folder`, the name still to give (AK1: the next step of `workspace.not-found`). */
export const createWorkspaceStep = (folder: string): NextStep => ({
  command: "workspace.init",
  input: { path: folder },
  open: ["name"],
});

/**
 * The next steps after a workspace was created (AK2) in `workspace`: connect an AI agent, the client still to
 * give, then create an element.
 */
export const afterInitSteps = (workspace: string): NextStep[] => [
  { command: "workspace.connectAgent", input: {}, open: ["client"], workspace },
  { command: "element.create", input: {}, open: ["type", "title"], workspace },
];

/**
 * How to begin (AK3: the section "Get started" of the command line's help): create, connect, create an
 * element, and last the call that shows the agent guide (SR-229).
 */
export const GET_STARTED: readonly NextStep[] = [
  { command: "workspace.init", input: {}, open: ["path", "name"] },
  { command: "workspace.connectAgent", input: {}, open: ["client"] },
  { command: "element.create", input: {}, open: ["type", "title"] },
  { command: "tool.guide", input: {}, open: [] },
];

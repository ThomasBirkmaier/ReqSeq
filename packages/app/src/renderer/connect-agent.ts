// "Connect AI agent" in the app (SR-227, SR-225 AK7): the catalog command `workspace.connectAgent` asks the
// client as a step with fixed values (AK1, `ASKED_IN_APP` in `catalog-arguments.ts`), and its output is a buffer
// (AK7, D-078, `ConnectAgentView.tsx`): the answer sentence, the command or JSON block that "Copy field" copies,
// and the sentence on how to go on, then the place the setup holds for. Without an open workspace the action
// first asks for one as "Open workspace" does (SR-131 AK1, AK5), opens it, and then asks the client
// (SR-225 AK7, `use-connect-agent.ts`). The texts come from core; the app only lays them out (ADR-0002).
import type { CommandTypes } from "@reqseq/core";
import type { ActionContext } from "./action-types.js";
import type { ResultBuffer } from "./buffers.js";
import { shownResult } from "./action-conditions.js";

export const CONNECT_AGENT = "workspace.connectAgent" satisfies keyof CommandTypes;

type Output = CommandTypes[typeof CONNECT_AGENT]["output"];

/** The label of the block: what "Copy field" copies and the modeline confirms ("Copied Setup"). */
export const SETUP_FIELD = "Setup";

/**
 * The label of the workspace prompt when no workspace was opened before (SR-225 AK7): it names
 * "Create workspace".
 */
export const NONE_OPENED = "Workspace (none opened yet: type its folder, or use Create workspace)";

/** What the buffer shows of an output for a chosen client, in this order. */
export interface AgentSetup {
  readonly answer: string;
  /** The command or the JSON block. */
  readonly text: string;
  readonly form: "command" | "json";
  readonly next: string | undefined;
  readonly valid: string | undefined;
}

/** The setup a result buffer of `workspace.connectAgent` shows; undefined for any other buffer, or without a client. */
export const agentSetupOf = (buffer: Pick<ResultBuffer, "command" | "output">): AgentSetup | undefined => {
  if (buffer.command !== CONNECT_AGENT || buffer.output === undefined) {
    return undefined;
  }
  const { answer, setup, next, valid } = buffer.output as Output;
  return setup === undefined ? undefined : { answer, text: setup.text, form: setup.form, next, valid };
};

/** The setup of the shown buffer, if it shows one. */
export const shownSetup = (context: ActionContext): AgentSetup | undefined => {
  const shown = shownResult(context);
  return shown === undefined ? undefined : agentSetupOf(shown);
};

/**
 * The sentence on how to go on, split at its backticks: the odd parts are code (`/mcp`, `claude mcp remove
 * reqseq`), the one sentence core writes code in. With a backtick left over it is one plain part, as written.
 */
export const codeParts = (sentence: string): readonly { readonly text: string; readonly code: boolean }[] => {
  const parts = sentence.split("`");
  return parts.length % 2 === 0
    ? [{ text: sentence, code: false }]
    : parts.map((text, at) => ({ text, code: at % 2 === 1 })).filter((part) => part.text !== "");
};

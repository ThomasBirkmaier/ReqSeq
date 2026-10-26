// A typed call of one catalog command through the bridge. The renderer shows what the command gives and
// builds only its input (ADR-0002); the types are those of the catalog.
import type { CommandTypes } from "@logreq/core";
import type { LogReqBridge } from "../shared/protocol.js";

/** The output of command `N`, or why it failed (the message of the error object every access gives). */
export type Answer<N extends keyof CommandTypes> =
  | { readonly ok: true; readonly output: CommandTypes[N]["output"] }
  | { readonly ok: false; readonly code: string; readonly message: string };

/** Runs a command; the input need not repeat what the catalog defaults. */
export type Call = <N extends keyof CommandTypes>(
  name: N,
  input: Partial<CommandTypes[N]["input"]>,
) => Promise<Answer<N>>;

export const callOn =
  (bridge: LogReqBridge): Call =>
  async (name, input) => {
    const result = await bridge.invoke(name, input);
    return result.ok
      ? { ok: true, output: result.output as CommandTypes[typeof name]["output"] }
      : { ok: false, code: result.error.code, message: result.error.message };
  };

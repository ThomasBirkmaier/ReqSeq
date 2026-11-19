// The calls of a fake bridge without the modeline's poll of the connected agents (SR-228, `use-agent-status.ts`).
// While a workspace is open, the window asks `workspace.agents` on a timer, so on a slow runner a poll can fall
// between any two calls a test means, or after the last one, and can take a one-off answer meant for another
// command (#1987). Test code only.
import type { Mock } from "vitest";
import type { InvokeResult } from "../shared/protocol.js";
import { AGENTS_COMMAND } from "./agent-status.js";

type Invoke = (name: string, input?: Record<string, unknown>) => Promise<InvokeResult>;

/** The calls of `invoke` in their order, without the polls of `workspace.agents`. */
export const withoutAgentPoll = <C extends readonly unknown[]>(invoke: { mock: { calls: C[] } }): C[] =>
  invoke.mock.calls.filter(([name]) => name !== AGENTS_COMMAND);

/**
 * Answers the next call of the command `name` with `once`, and every other call, a poll too, as before; unlike
 * `mockImplementationOnce`, which takes the next call of any name.
 */
export const answerNextOf = (invoke: Mock<Invoke>, name: string, once: Invoke): void => {
  const before = invoke.getMockImplementation() ?? (() => Promise.reject(new Error("no answer")));
  let used = false;
  invoke.mockImplementation((called, input) => {
    if (used || called !== name) {
      return before(called, input);
    }
    used = true;
    return once(called, input);
  });
};

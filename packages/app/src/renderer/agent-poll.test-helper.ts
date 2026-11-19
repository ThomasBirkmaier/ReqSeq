// The calls of a fake bridge without the modeline's poll of the connected agents (SR-228, `use-agent-status.ts`).
// While a workspace is open, the window asks `workspace.agents` on a timer, so on a slow runner a poll can fall
// between any two calls a test means, or after the last one (#1987). Test code only.
import { AGENTS_COMMAND } from "./agent-status.js";

/** The calls of `invoke` in their order, without the polls of `workspace.agents`. */
export const withoutAgentPoll = <C extends readonly unknown[]>(invoke: { mock: { calls: C[] } }): C[] =>
  invoke.mock.calls.filter(([name]) => name !== AGENTS_COMMAND);

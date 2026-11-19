// The connected agent in the modeline (SR-228, `agent-status.ts`): while a workspace is open the window asks
// `workspace.agents` every `AGENTS_POLL_MS` after the last answer. Polling, not an event: whether a connection
// still counts depends on the time since its server's last beat, so a crash changes no file that could be
// watched, and core answers from the cache folder without waiting for the element store. The call goes to the
// bridge itself, not through the counted calls the overview gives way to (`call-turn.ts`).
import { useEffect, useState } from "react";
import type { ReqSeqBridge } from "../shared/protocol.js";
import type { AgentStatus } from "./agent-status.js";
import { AGENTS_COMMAND, AGENTS_POLL_MS, agentStatus, sameStatus } from "./agent-status.js";

/** What the modeline shows of the agents of the copy; undefined while no workspace is open or before the answer. */
export const useAgentStatus = (bridge: ReqSeqBridge, open: boolean): AgentStatus | undefined => {
  const [status, setStatus] = useState<AgentStatus | undefined>(undefined);
  useEffect(() => {
    if (!open) {
      setStatus(undefined);
      return;
    }
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async (): Promise<void> => {
      const next = agentStatus(await bridge.invoke(AGENTS_COMMAND, {}));
      if (!live) {
        return;
      }
      setStatus((before) => (sameStatus(before, next) ? before : next));
      timer = setTimeout(() => {
        void ask();
      }, AGENTS_POLL_MS);
    };
    void ask();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [bridge, open]);
  return status;
};

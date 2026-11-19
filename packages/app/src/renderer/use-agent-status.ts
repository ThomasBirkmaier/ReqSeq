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
    // Counts the workspaces of this window: an answer for one that was left is dropped (SR-228 AK6).
    let generation = 0;
    const ask = async (): Promise<void> => {
      const asked = generation;
      let next: AgentStatus | undefined;
      try {
        next = agentStatus(await bridge.invoke(AGENTS_COMMAND, {}));
      } catch {
        // An answer that cannot be read shows nothing; polling goes on.
        next = undefined;
      }
      // Not for a workspace that was left, whose switch started a poll of its own.
      if (!live || asked !== generation) {
        return;
      }
      setStatus((before) => (sameStatus(before, next) ? before : next));
      timer = setTimeout(() => {
        void ask();
      }, AGENTS_POLL_MS);
    };
    void ask();
    // Another workspace, or the same after a restart of core: nothing of the one before shows, and the new one
    // is asked at once.
    const off = bridge.on("workspace-changed", (change) => {
      if (change.reason === "opened" || change.reason === "restarted") {
        generation += 1;
        clearTimeout(timer);
        setStatus(undefined);
        void ask();
      }
    });
    return () => {
      live = false;
      clearTimeout(timer);
      off();
    };
  }, [bridge, open]);
  return status;
};

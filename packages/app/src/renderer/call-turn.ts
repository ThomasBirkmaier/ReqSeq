// Background reads that give way to the user (SR-118 AK8, SR-082 AK1): the overview counts its perspectives
// only once the window is idle and no other call to the core is pending, so a command of the user waits at most
// for the one count in flight. `trackCalls` wraps the bridge's `invoke` and counts the calls that have not
// answered; `turn` resolves once the window is idle and none is pending.
import type { ReqSeqBridge } from "../shared/protocol.js";

type Invoke = ReqSeqBridge["invoke"];

export interface CallTracker {
  /** `invoke`, counted while it runs. */
  readonly wrap: (invoke: Invoke) => Invoke;
  /** Resolves once the window is idle and no wrapped call is pending. */
  readonly turn: () => Promise<void>;
}

/** The window's next idle period, or the next task where there is no `requestIdleCallback`. */
export const idle = (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(
        () => {
          resolve();
        },
        { timeout: 1_000 },
      );
    } else {
      setTimeout(resolve, 0);
    }
  });

export const trackCalls = (whenIdle: () => Promise<void> = idle): CallTracker => {
  let pending = 0;
  const waiting = new Set<() => void>();
  const settle = (): void => {
    if (pending === 0) {
      const all = [...waiting];
      waiting.clear();
      for (const resume of all) {
        resume();
      }
    }
  };
  const quiet = (): Promise<void> =>
    new Promise((resolve) => {
      if (pending === 0) {
        resolve();
      } else {
        waiting.add(resolve);
      }
    });
  return {
    wrap:
      (invoke) =>
      (...args) => {
        pending += 1;
        return invoke(...args).finally(() => {
          pending -= 1;
          // On the next task: a call the answer leads to (the next page, a command) is counted first.
          setTimeout(settle, 0);
        });
      },
    turn: async () => {
      await whenIdle();
      await quiet();
    },
  };
};

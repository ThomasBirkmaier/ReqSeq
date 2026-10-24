// Waiting for file watchers in tests (SR-007). macOS starts FSEvents asynchronously, so a change
// made right after a watcher reports `ready` can be lost. Tests first make a probe change until
// the watcher has seen one, then make the change they check; the bound they assert stays theirs.

export interface ProbeOptions {
  /** Makes a change the watcher reports (and that does not disturb the test), e.g. writes `probe.md`. */
  readonly probe: (attempt: number) => Promise<void>;
  /** Whether the watcher has seen a probe yet. */
  readonly seen: () => Promise<boolean>;
  /** How long to wait for one probe before making it again. Default 250 ms. */
  readonly intervalMs?: number;
  /** When to give up. Default 15 s. */
  readonly timeoutMs?: number;
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Repeats `probe` until `seen` holds; rejects after `timeoutMs`. Polls `seen` every 10 ms. */
export const untilWatching = async (options: ProbeOptions): Promise<void> => {
  const interval = options.intervalMs ?? 250;
  const deadline = performance.now() + (options.timeoutMs ?? 15_000);
  for (let attempt = 1; performance.now() < deadline; attempt++) {
    await options.probe(attempt);
    const next = Math.min(performance.now() + interval, deadline);
    while (performance.now() < next) {
      if (await options.seen()) {
        return;
      }
      await pause(10);
    }
  }
  throw new Error("the watcher saw no probe change in time");
};

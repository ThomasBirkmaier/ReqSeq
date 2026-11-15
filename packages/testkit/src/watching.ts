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

/**
 * Repeats `probe` until `seen` holds; rejects after `timeoutMs`. Polls `seen` every 10 ms. The error names
 * the probes made, the time waited and the slowest probe, so a lost watcher (many fast probes) can be told
 * from a slow disk (few slow ones) in a CI log (#1668).
 */
export const untilWatching = async (options: ProbeOptions): Promise<void> => {
  const interval = options.intervalMs ?? 250;
  const start = performance.now();
  const deadline = start + (options.timeoutMs ?? 15_000);
  let probes = 0;
  let slowest = 0;
  for (let attempt = 1; performance.now() < deadline; attempt++) {
    const before = performance.now();
    await options.probe(attempt);
    probes = attempt;
    slowest = Math.max(slowest, performance.now() - before);
    const next = Math.min(performance.now() + interval, deadline);
    while (performance.now() < next) {
      if (await options.seen()) {
        return;
      }
      await pause(10);
    }
  }
  const waited = Math.round(performance.now() - start);
  throw new Error(
    `the watcher saw no probe change in time: ${String(probes)} probes in ${String(waited)} ms, the slowest took ${String(Math.round(slowest))} ms`,
  );
};

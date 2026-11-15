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
 * Repeats `probe` until `seen` holds; rejects after `timeoutMs`. Asks `seen` again 10 ms after each answer.
 * The error names the probes made, the time waited, the slowest probe and the slowest `seen`, so a CI log
 * shows whether the probes, the check or the watcher took the time (#1668).
 */
export const untilWatching = async (options: ProbeOptions): Promise<void> => {
  const interval = options.intervalMs ?? 250;
  const start = performance.now();
  const deadline = start + (options.timeoutMs ?? 15_000);
  let probes = 0;
  let slowestProbe = 0;
  let slowestSeen = 0;
  const timed = async <T>(run: () => Promise<T>): Promise<{ value: T; ms: number }> => {
    const before = performance.now();
    const value = await run();
    return { value, ms: performance.now() - before };
  };
  while (performance.now() < deadline) {
    probes += 1;
    const attempt = probes;
    slowestProbe = Math.max(slowestProbe, (await timed(() => options.probe(attempt))).ms);
    const next = Math.min(performance.now() + interval, deadline);
    while (performance.now() < next) {
      const seen = await timed(options.seen);
      slowestSeen = Math.max(slowestSeen, seen.ms);
      if (seen.value) {
        return;
      }
      await pause(10);
    }
  }
  const waited = Math.round(performance.now() - start);
  throw new Error(
    `the watcher saw no probe change in time: ${String(probes)} probes in ${String(waited)} ms, the slowest probe took ${String(Math.round(slowestProbe))} ms, the slowest check ${String(Math.round(slowestSeen))} ms`,
  );
};

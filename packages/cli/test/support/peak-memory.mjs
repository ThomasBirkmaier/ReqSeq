// Preload for a spawned CLI of the performance suite (#277, review S6): when LOGREQ_PEAK_MEMORY names
// a file, samples heap in use and heap reserved every 10 ms while the process runs and writes the
// peaks and the peak resident memory (`maxRSS`, exact) there as JSON when the process exits. A
// synchronous stretch is sampled only when it returns to the event loop, so the heap peaks are lower
// bounds; heap reserved and resident memory keep most of such a stretch.
import { writeFileSync } from "node:fs";
import { setInterval } from "node:timers";

const file = process.env.LOGREQ_PEAK_MEMORY;
if (file !== undefined && file !== "") {
  const peak = { heapUsed: 0, heapTotal: 0 };
  const sample = () => {
    const now = process.memoryUsage();
    peak.heapUsed = Math.max(peak.heapUsed, now.heapUsed);
    peak.heapTotal = Math.max(peak.heapTotal, now.heapTotal);
  };
  setInterval(sample, 10).unref();
  process.on("exit", () => {
    sample();
    // `maxRSS` is in kilobytes (1024 bytes) on every platform.
    writeFileSync(file, JSON.stringify({ ...peak, maxRss: process.resourceUsage().maxRSS * 1024 }));
  });
}

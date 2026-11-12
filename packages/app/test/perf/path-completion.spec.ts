// SR-143 AK5 in the app's part of the performance suite (ADR-0011): in a folder of 10,000 entries the suggestions of
// the path completion are updated within 100 ms of a key. Here, and not in the Electron suite, because the 100 ms are
// evidence only on a runner at or below the reference machine, which the perf job runs on; the macOS runner of the
// Electron suite exceeded them at times (#1128). The Electron suite types the same keys without the threshold
// (test/path-completion.spec.ts). Times are taken in the window, from the keydown to the mutation that shows the
// expected first entry, so Playwright's own polling adds nothing.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { PerfMeasurement } from "@reqseq/testkit";
import { recordValue, thresholdMessage } from "@reqseq/testkit";
import type { RunningApp } from "../support/app.js";
import { launchApp } from "../support/app.js";
import { makeTenThousand, typeThroughTenThousand } from "../support/path-prompt.js";

/** SR-143 AK5: the suggestions after a key. */
const UPDATE_MS = 100;
const BASIS = "SR-143 AK5 (path completion in a folder of 10,000 entries; the app)";

test.describe("path completion in a folder of 10,000 entries (SR-143)", () => {
  let running: RunningApp;
  let dir: string;

  test.beforeEach(async () => {
    running = await launchApp({ fixture: "SR-069/filter", name: "kestrel" });
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-paths-")));
    await expect(running.window.getByRole("listbox", { name: "Overview" })).toBeVisible();
  });

  test.afterEach(async () => {
    await running.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  test("[SR-143/AK-rqjp] in a folder of 10,000 entries the suggestions are updated within 100 ms of a key", async () => {
    await makeTenThousand(dir);
    const times = await typeThroughTenThousand(running.window, dir);
    const recorded: PerfMeasurement[] = [
      await recordValue(
        "app: path completion, separator after a folder of 10,000 entries (Export ReqIF)",
        times.listed,
        {
          basis: BASIS,
          thresholdMs: UPDATE_MS,
        },
      ),
      await recordValue(
        "app: path completion, letter in a folder of 10,000 entries (Export ReqIF)",
        times.narrowed,
        {
          basis: BASIS,
          thresholdMs: UPDATE_MS,
        },
      ),
      await recordValue(
        "app: path completion, separator after a folder of 10,000 folders (Open workspace)",
        times.opened,
        { basis: BASIS, thresholdMs: UPDATE_MS },
      ),
      await recordValue(
        "app: path completion, letter in a folder of 10,000 folders (Open workspace)",
        times.chosen,
        {
          basis: BASIS,
          thresholdMs: UPDATE_MS,
        },
      ),
    ];
    // Soft, after every time was recorded, so that one time over its threshold does not hide the others.
    for (const measurement of recorded) {
      expect.soft(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(UPDATE_MS);
    }
  });
});

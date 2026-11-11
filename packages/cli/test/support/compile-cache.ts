// Vitest `globalSetup` of the CLI e2e suite (vitest.e2e.config.ts): one Node compile cache (#178) for
// every CLI the suite starts, filled once before the first test file runs (#1448).
//
// Without it, `support/reqseq.ts` gives each test file a fresh cache home, so the first CLI start of
// every file compiled ReqSeq from scratch and wrote the cache (about 2 MB of new files). On the Windows
// runner this start stalled now and then for 20 s or more inside the first test of a file: in
// hint-confirm (#1290) and in baseline-get (#1448) the other tests of the file kept their normal time.
// The app tests fill one compile cache before their first test for the same reason (#1356).
//
// The folder holds only compiled code, so sharing it keeps the tests apart; the model cache (SR-082) and
// the other files of the OS cache folder stay in each file's own home. The variable reaches the test
// workers through their environment, and the spawned CLIs through `cliEnv()`. So the e2e CLIs do not
// use the per-user folder that `bin.ts` picks as shipped; compile-cache.test.ts, which sets an empty
// NODE_COMPILE_CACHE itself, still checks that path. A NODE_COMPILE_CACHE of the outer environment is
// used (an empty one counts as unset, as in Node), warmed too and not removed.
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bin, reqseq } from "./reqseq.js";

/** Ends a hanging warm-up, which would otherwise hold the whole e2e step until the job's timeout. */
const WARM_UP_LIMIT_MS = 60_000;

const warm = async (folder: string): Promise<void> => {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`reqseq --version did not finish within ${String(WARM_UP_LIMIT_MS)} ms`));
    }, WARM_UP_LIMIT_MS);
  });
  try {
    const out = await Promise.race([reqseq(["--version"], { cwd: folder }), limit]);
    if (out.code !== 0) {
      throw new Error(`reqseq --version failed with exit code ${String(out.code)}: ${out.stderr}`);
    }
  } finally {
    clearTimeout(timer);
  }
};

export default async function setup(): Promise<() => Promise<void>> {
  const outer = process.env["NODE_COMPILE_CACHE"];
  const own = outer === undefined || outer === "";
  const folder = own ? await mkdtemp(path.join(os.tmpdir(), "reqseq-e2e-compile-cache-")) : outer;
  process.env["NODE_COMPILE_CACHE"] = folder;
  // Without a build there is nothing to warm: each file's `requireBuiltCli` names the missing command.
  if (existsSync(bin)) {
    await warm(folder);
  }
  return async () => {
    if (own) {
      process.env["NODE_COMPILE_CACHE"] = outer;
      if (outer === undefined) {
        delete process.env["NODE_COMPILE_CACHE"];
      }
      await rm(folder, { recursive: true, force: true, maxRetries: 3 });
    }
  };
}

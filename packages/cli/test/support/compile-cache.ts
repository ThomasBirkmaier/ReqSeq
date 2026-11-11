// Vitest `globalSetup` of the CLI e2e suite (vitest.e2e.config.ts): one Node compile cache (#178) for
// every CLI the suite starts, filled once before the first test file runs (#1448).
//
// Without it, `support/reqseq.ts` gives each test file a fresh cache home, so the first CLI start of
// every file compiled ReqSeq from scratch and wrote the cache (about 2 MB of new files). On the Windows
// runner this start stalled now and then for 20 s or more inside the first test of a file: in
// hint-confirm (#1290) and in baseline-get (#1448) the other tests of the file kept their normal time.
// The app tests share one compile cache per test process for the same reason (#1356).
//
// The folder holds only compiled code, so sharing it keeps the tests apart; the model cache (SR-082) and
// the other files of the OS cache folder stay in each file's own home. The variable reaches the test
// workers through their environment, and the spawned CLIs through `cliEnv()`. A test that sets
// NODE_COMPILE_CACHE itself (compile-cache.test.ts) keeps its own. A NODE_COMPILE_CACHE of the outer
// environment is kept and not removed.
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bin, reqseq } from "./reqseq.js";

export default async function setup(): Promise<(() => Promise<void>) | undefined> {
  if (process.env["NODE_COMPILE_CACHE"] !== undefined) {
    return undefined;
  }
  const folder = await mkdtemp(path.join(os.tmpdir(), "reqseq-e2e-compile-cache-"));
  process.env["NODE_COMPILE_CACHE"] = folder;
  // Without a build there is nothing to warm: each file's `requireBuiltCli` names the missing command.
  if (existsSync(bin)) {
    const out = await reqseq(["--version"], { cwd: folder });
    if (out.code !== 0) {
      throw new Error(`reqseq --version failed with exit code ${String(out.code)}: ${out.stderr}`);
    }
  }
  return async () => {
    delete process.env["NODE_COMPILE_CACHE"];
    await rm(folder, { recursive: true, force: true, maxRetries: 3 });
  };
}

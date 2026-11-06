#!/usr/bin/env node
// The `reqseq` binary (package.json "bin"). Everything it does is in runCli (main.ts) and connectProcess.
// It first lets Node cache the compiled code of the CLI (#178), and loads the rest only after that,
// so that the cache covers it. Node keeps a NODE_COMPILE_CACHE the user set and honours
// NODE_DISABLE_COMPILE_CACHE. A failure only costs the gain: enableCompileCache returns a status, and
// finding the folder can throw (`os.homedir()` without HOME and a passwd entry), so the CLI then runs
// without the cache.
import { enableCompileCache } from "node:module";
import { compileCacheFolder } from "@reqseq/core/os-cache";

try {
  enableCompileCache(compileCacheFolder());
} catch {
  // No cache folder: start without the cache.
}
const { EXIT, runCli } = await import("./main.js");
const { connectProcess } = await import("./process.js");
const { terminalOf } = await import("./style.js");

const io = connectProcess(process);
const exitCode = await runCli({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  stdin: process.stdin,
  stdout: io.stdout,
  stderr: io.stderr,
  signal: io.signal,
  // Styled only on a terminal without NO_COLOR (#988); asked once here, so the renderers stay pure.
  terminal: terminalOf(process.stdout, process.env),
});
process.exitCode = io.writeFailed ? EXIT.internal : exitCode;

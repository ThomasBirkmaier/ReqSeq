#!/usr/bin/env node
// The `reqseq` binary (package.json "bin"). Everything it does is in runCli (main.ts) and connectProcess.
// It first lets Node cache the compiled code of the CLI (#178), and loads the rest only after that,
// so that the cache covers it. Node keeps a NODE_COMPILE_CACHE the user set and honours
// NODE_DISABLE_COMPILE_CACHE; enableCompileCache never throws, and a failure only costs the gain.
import { enableCompileCache } from "node:module";
import { compileCacheFolder } from "@reqseq/core/os-cache";

enableCompileCache(compileCacheFolder());
const { EXIT, runCli } = await import("./main.js");
const { connectProcess } = await import("./process.js");

const io = connectProcess(process);
const exitCode = await runCli({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  stdin: process.stdin,
  stdout: io.stdout,
  stderr: io.stderr,
  signal: io.signal,
});
process.exitCode = io.writeFailed ? EXIT.internal : exitCode;

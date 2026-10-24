#!/usr/bin/env node
// The `logreq` binary (package.json "bin"). Everything it does is in runCli (main.ts) and connectProcess.
import { EXIT, runCli } from "./main.js";
import { connectProcess } from "./process.js";

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

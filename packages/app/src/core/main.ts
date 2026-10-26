// Entry of the core process (utility process, ADR-0010); everything it does is in serveCoreProcess.
import { getCommandRuntime } from "@logreq/core";
import { serveCoreProcess } from "./process.js";

serveCoreProcess({
  parentPort: process.parentPort,
  runtime: getCommandRuntime(),
  exit: (code) => process.exit(code),
  log: (line) => process.stderr.write(`${line}\n`),
});

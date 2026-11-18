// Entry of the core process (utility process, ADR-0010); everything it does is in serveCoreProcess.
import { getCommandRuntime } from "@reqseq/core";
import { installationFromArgv, setInstallation } from "@reqseq/core/installation";
import { serveCoreProcess } from "./process.js";

// The installation the app's main process hands over (SR-227 AK3): this process runs no bin.js of its own.
setInstallation(installationFromArgv(process.argv));

serveCoreProcess({
  parentPort: process.parentPort,
  runtime: getCommandRuntime(),
  exit: (code) => process.exit(code),
  log: (line) => process.stderr.write(`${line}\n`),
});

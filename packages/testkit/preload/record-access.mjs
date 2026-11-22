// Preload of the tests of SR-248 AK2 (ADR-0020 "Test seam"; test code, never shipped): `node --import <this file>`
// with REQSEQ_ACCESS_RECORD naming a file writes there one JSON line per program started and per file opened, with
// the step that started or opened it (`src/access-record.ts`, built into `dist/` by `pnpm build`). It runs in every
// thread of the process, worker threads included. Without the variable it does nothing.
import { createHook, executionAsyncResource } from "node:async_hooks";
import childProcess from "node:child_process";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import workerThreads from "node:worker_threads";
import { installAccessRecorder } from "../dist/access-record.js";

const file = process.env["REQSEQ_ACCESS_RECORD"];
if (file !== undefined && file !== "") {
  // The whole stack: the frame that names a step may lie far below the call.
  Error.stackTraceLimit = Infinity;
  const append = fs.appendFileSync;
  installAccessRecorder(
    { childProcess, fs, fsPromises, workerThreads, asyncHooks: { createHook, executionAsyncResource } },
    {
      write: (line) => {
        append(file, line);
      },
      thread: workerThreads.threadId,
      execPath: process.execPath,
      cwd: () => process.cwd(),
    },
  );
  // The named imports of the built-in modules (`import { spawn } from "node:child_process"`) take the wrappers.
  syncBuiltinESMExports();
}

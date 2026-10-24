#!/usr/bin/env node
// Test-only entry of the e2e suite: the built CLI (dist/main.js, the same runCli as dist/bin.js) with
// test implementations of real catalog commands, until the product commands of stage 1 exist.
// Never shipped: packages/cli/package.json publishes dist only.
import fs from "node:fs/promises";
import path from "node:path";
import { CommandError, createCommandRuntime, defineCommand } from "@logreq/core";
import { EXIT, runCli } from "../../../dist/main.js";
import { connectProcess } from "../../../dist/process.js";

/** Problems listed in `<root>/test-problems.json`, plus one info problem per `changedFiles` entry. */
const check = defineCommand({
  name: "workspace.check",
  async run(ctx, input) {
    const file = path.join(ctx.workspace.root, "test-problems.json");
    const listed = await fs.readFile(file, "utf8").then(JSON.parse, () => []);
    const changed = (input.changedFiles ?? []).map((changedFile) => ({
      code: "file.unreadable",
      severity: "info",
      message: `changed since ${input.changedSince ?? "(none)"}`,
      file: changedFile,
    }));
    const problems = [...listed, ...changed];
    return { ok: !problems.some((p) => p.severity === "error"), problems, checkedElements: 0 };
  },
});

const status = defineCommand({
  name: "workspace.status",
  run: (ctx) =>
    Promise.resolve({
      name: path.basename(ctx.workspace.root),
      repositories: [{ name: "main", available: true, path: ctx.workspace.root }],
      metamodel: { repository: "main", path: "model", valid: true },
      readOnly: false,
    }),
});

const get = defineCommand({
  name: "element.get",
  run: (_ctx, input) =>
    Promise.reject(new CommandError("element.not-found", `No element ${input.ref}`, { ref: input.ref })),
});

const crash = defineCommand({
  name: "metamodel.get",
  run: () => Promise.reject(new Error("internal detail at /secret/path")),
});

// Same wiring as dist/bin.js, with the test runtime.
const io = connectProcess(process);
const exitCode = await runCli({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  stdin: process.stdin,
  stdout: io.stdout,
  stderr: io.stderr,
  signal: io.signal,
  runtime: createCommandRuntime({ commands: [check, status, get, crash] }),
});
process.exitCode = io.writeFailed ? EXIT.internal : exitCode;

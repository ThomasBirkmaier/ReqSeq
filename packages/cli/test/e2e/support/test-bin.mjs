#!/usr/bin/env node
// Test-only entry of the e2e suite: the built CLI (dist/main.js, the same runCli as dist/bin.js) with
// test implementations of real catalog commands, until the product commands of stage 1 exist.
// Never shipped: packages/cli/package.json publishes dist only.
import fs from "node:fs/promises";
import path from "node:path";
import { CommandError, createCommandRuntime, defineCommand } from "@reqseq/core";
import { EXIT, runCli } from "../../../dist/main.js";
import { connectProcess } from "../../../dist/process.js";

/** Problems listed in `<root>/test-problems.json`, plus one info problem per `changedFiles` entry. */
// Each test command has an `answer` like its product command: the catalog output schemas require it
// (SR-224 AK1), and `invoke` adds it only from the command's `answer`.
const check = defineCommand({
  name: "workspace.check",
  answer: (output) => {
    const counts = ["error", "warning", "info"]
      .map((severity) => [output.problems.filter((p) => p.severity === severity).length, severity])
      .filter(([n]) => n > 0)
      .map(([n, severity]) => `${String(n)} ${severity}${n === 1 || severity === "info" ? "" : "s"}`);
    const found = counts.length === 0 ? "no problem" : counts.join(" and ");
    return `Checked ${String(output.checkedElements)} elements and found ${found}.`;
  },
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
  answer: (output) => `Workspace ${output.name} has 1 repository, 1 available.`,
  run: (ctx) =>
    Promise.resolve({
      name: path.basename(ctx.workspace.root),
      repositories: [{ name: "main", available: true, path: ctx.workspace.root }],
      metamodel: { repository: "main", path: "model", valid: true },
      evidence: [],
      readOnly: false,
    }),
});

const get = defineCommand({
  name: "element.get",
  answer: (output) => `Found ${output.element.title}.`,
  run: (_ctx, input) =>
    Promise.reject(new CommandError("element.not-found", `No element ${input.ref}`, { ref: input.ref })),
});

const crash = defineCommand({
  name: "metamodel.get",
  answer: () => "The metamodel has no types.",
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

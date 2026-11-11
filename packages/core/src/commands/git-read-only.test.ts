// SR-083 (D-036, ADR-0006): ReqSeq only reads Git. Every implemented command runs here, with the calls
// of scenarios.test-helper.ts, on a Git repository; afterwards every file of its Git folder has the
// bytes it had, and every process started was git with a read-only subcommand. A commit the local
// repository does not have is not fetched (AK2); no command of the catalog writes Git data, and only
// the git reader imports node:child_process (AK3).
// The processes are recorded by wrapping `execFile` and `spawn` of node:child_process, which only the
// git reader uses (ADR-0006); the fixture's own git calls happen before the recording starts.
import { createHash } from "node:crypto";
import type * as ChildProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { CommandError } from "../catalog.js";
import { loadContracts } from "../runtime/contracts.js";
import { createCommandRuntime } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { gitProgram } from "../git/program.js";
import { commands } from "./index.js";
import { FILES, GUSTS, SCENARIOS, WIND } from "./scenarios.test-helper.js";

/** Program and arguments of every process started through node:child_process, while recording. */
const started = vi.hoisted(() => ({ on: false, calls: [] as (readonly string[])[] }));

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof ChildProcess>();
  const record = (file: string, args: unknown): void => {
    if (started.on) {
      started.calls.push([file, ...(Array.isArray(args) ? args.map(String) : [])]);
    }
  };
  const { promisify } = await import("node:util");
  const execFile = (...args: Parameters<typeof original.execFile>): ReturnType<typeof original.execFile> => {
    record(args[0], args[1]);
    return original.execFile(...args);
  };
  // The promise form keeps git's own (the testkit's git calls use it, the git reader does not).
  Object.defineProperty(execFile, promisify.custom, { value: promisify(original.execFile) });
  return {
    ...original,
    execFile,
    spawn: (...args: Parameters<typeof original.spawn>) => {
      record(args[0], args[1]);
      return original.spawn(...args);
    },
  };
});

const contracts = loadContracts();
const runtime = createCommandRuntime({ commands });

/** Every implemented command with its calls: those of the helper and the two status commands. */
const CALLS: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>> = {
  ...SCENARIOS,
  "element.setStatus": [
    { refs: [WIND], status: "approved" },
    { refs: [WIND], status: "nope" },
  ],
  "element.supersede": [{ ref: GUSTS, status: "obsolete", successor: WIND, relation: "supersedes" }],
};

/** The git subcommands that only read (ADR-0006): no commit, push, pull, fetch, merge, checkout, branch. */
const READ_ONLY = new Set(["rev-parse", "log", "cat-file", "diff", "ls-files", "ls-tree"]);

/** The subcommand of a git command line: the first argument after the options (`-c` takes a value). */
const subcommand = (args: readonly string[]): string | undefined => {
  let i = 0;
  while (args[i]?.startsWith("-") === true) {
    i += args[i] === "-c" ? 2 : 1;
  }
  return args[i];
};

/** Program and subcommand of every process started since the recording began. */
const processes = (): (readonly [program: string, subcommand: string])[] =>
  started.calls.map(([file = "", ...args]) => [file, String(subcommand(args))]);

/** Records the processes started from now on, until the test ends. */
const recordProcesses = (): void => {
  started.calls = [];
  started.on = true;
  onTestFinished(() => {
    started.on = false;
  });
};

/** Every file below the Git folder of `root`, with the SHA-256 of its bytes. */
const gitFolder = (root: string): Record<string, string> => {
  const folder = path.join(root, ".git");
  const out: Record<string, string> = {};
  for (const entry of fs.readdirSync(folder, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const file = path.join(entry.parentPath, entry.name);
      out[path.relative(folder, file)] = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    }
  }
  return out;
};

const open = (root: string): Workspace => {
  const workspace = new Workspace(root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const fixture = async (options: Parameters<typeof createFixtureWorkspace>[0]): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace(options);
  onTestFinished(() => created.cleanup());
  return created;
};

describe("Git only read (SR-083, D-036)", () => {
  for (const [name, scenarios] of Object.entries(CALLS)) {
    it(`[SR-083/AK1] ${name} leaves the Git folder as it was and starts only git commands that read`, async () => {
      const repository = await fixture({ fixture: "SR-001/two-elements", files: FILES, git: true });
      const workspace = open(repository.root);
      if (name === "baseline.compare" || name === "baseline.get") {
        // A baseline to read, as in no-status-change.test.ts.
        await runtime.invoke("baseline.create", { name: "Base", selection: { ids: [WIND] } }, { workspace });
      }
      const before = gitFolder(repository.root);
      recordProcesses();
      for (const input of scenarios) {
        await runtime.invoke(name, input, { workspace }).catch(() => undefined);
      }
      expect(gitFolder(repository.root)).toEqual(before);
      // The git found on PATH by its absolute path, never a bare `git` (#940).
      for (const [program, sub] of processes()) {
        expect([sub, program, READ_ONLY.has(sub)]).toEqual([sub, gitProgram(), true]);
      }
    });
  }

  it("[SR-083/AK1] runs every implemented command above", () => {
    const implemented = contracts.commands.map((c) => c.name).filter((n) => runtime.commands.has(n));
    expect(Object.keys(CALLS).sort()).toEqual(implemented.sort());
  });

  it("[SR-083/AK2] reads a commit only from the local repository and fetches none", async () => {
    const origin = await fixture({ fixture: "SR-001/two-elements", git: true });
    const clone = await fixture({});
    await clone.git(["clone", "--quiet", pathToFileURL(origin.root).href, "."]);
    // A commit that only the origin has.
    await origin.write("needs/N-later.md", "Later.\n");
    const later = await origin.commit();
    const before = gitFolder(clone.root);
    const workspace = open(clone.root);
    recordProcesses();
    const code = await runtime.invoke("workspace.check", { changedSince: later }, { workspace }).then(
      () => "no error",
      (error: unknown) => (error instanceof CommandError ? error.code : String(error)),
    );
    expect(code).toBe("git.commit-not-found");
    expect(gitFolder(clone.root)).toEqual(before);
    // git was asked, and only to read: the recording sees the git reader's processes.
    expect(processes().length).toBeGreaterThan(0);
    expect(processes().filter(([, sub]) => !READ_ONLY.has(sub))).toEqual([]);
    // The commit the clone has is found.
    const head = (await clone.git(["rev-parse", "HEAD"])).trim();
    await expect(
      runtime.invoke("workspace.check", { changedSince: head }, { workspace }),
    ).resolves.toBeDefined();
  });

  it("[SR-083/AK1] asks the index whether a local file is tracked without writing to the Git folder (#1456)", async () => {
    const local = "reqseq-local: 1\n";
    const repository = await fixture({
      fixture: "SR-001/two-elements",
      files: { ...FILES, ".reqseq/local.yaml": local },
      git: true,
    });
    // A stat-dirty tracked file: a refresh of the index would write it.
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(repository.path("reqseq-workspace.yaml"), later, later);
    const before = gitFolder(repository.root);
    const workspace = open(repository.root);
    recordProcesses();
    const out = (await runtime.invoke("workspace.status", {}, { workspace })) as {
      problems?: readonly { file?: string; message: string }[];
    };
    expect(out.problems?.filter((p) => p.file === ".reqseq/local.yaml").map((p) => p.message)).toEqual([
      expect.stringContaining(".reqseq/local.yaml is tracked by Git"),
    ]);
    expect(gitFolder(repository.root)).toEqual(before);
    expect(processes().map(([, sub]) => sub)).toEqual(expect.arrayContaining(["cat-file", "ls-files"]));
    expect(processes().filter(([, sub]) => !READ_ONLY.has(sub))).toEqual([]);
  });

  it("[SR-083/AK3] starts processes only in the git reader: no other product module imports node:child_process", () => {
    const packages = path.resolve(import.meta.dirname, "../../..");
    const importers: string[] = [];
    for (const name of fs.readdirSync(packages)) {
      const src = path.join(packages, name, "src");
      // The testkit is test tooling: it makes the fixtures' commits. The docs package builds the documentation site and
      // is never shipped with the product (ADR-0017); it makes the commits of the command examples' workspace.
      if (name === "testkit" || name === "docs" || !fs.existsSync(src)) {
        continue;
      }
      for (const entry of fs.readdirSync(src, { recursive: true, withFileTypes: true })) {
        const file = path.join(entry.parentPath, entry.name);
        const product =
          entry.isFile() && /\.[cm]?tsx?$/.test(entry.name) && !/\.test(-helper)?\./.test(entry.name);
        if (product && /["'](node:)?child_process["']/.test(fs.readFileSync(file, "utf8"))) {
          importers.push(path.relative(packages, file).split(path.sep).join("/"));
        }
      }
    }
    expect(importers).toEqual(["core/src/git/reader.ts"]);
  });

  it("[SR-083/AK3] offers no command that writes Git data", () => {
    const writes = /commit|push|pull|fetch|merge|checkout|branch|rebase|reset|stash|tag|clone/i;
    expect(contracts.commands.map((c) => c.name).filter((name) => writes.test(name))).toEqual([]);
  });
});

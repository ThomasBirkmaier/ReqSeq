// SR-063 end to end: the guide `toolchain/junit/README.md` and its examples (D-054). The tests read the
// guide and run its marked command blocks (`<!-- tested: <name> -->` before a fenced block): every line
// that starts with `reqseq ` runs as written through the built binary, `export` lines set variables, and
// every other line must be one of the few lines this file knows (`STEPS`), done here with Node's own
// means, so a changed line of the guide fails the test. Vitest runs for real, from a copy of the example
// in a temporary folder (nothing is written into the repository), offline like the CLI (SR-077).
// Run after `pnpm build` with `pnpm test:e2e`.
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import YAML from "yaml";
import type { Run } from "../support/reqseq.js";
import { blockNetwork, reqseq, requireBuiltCli } from "../support/reqseq.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const exampleDir = path.join(repoRoot, "toolchain", "junit");
const guidePath = path.join(exampleDir, "README.md");
const vitestBin = path.join(repoRoot, "node_modules", "vitest", "vitest.mjs");

/** Vitest and a dozen CLI processes per test; slow CI machines need time. */
const TIMEOUT = 60_000;

const temps: string[] = [];
const fixtures: FixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
  await Promise.all(temps.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
  if (!existsSync(vitestBin)) {
    throw new Error(`${vitestBin} is missing: run pnpm install`);
  }
});

const tempDir = async (): Promise<string> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-sr063-"));
  temps.push(dir);
  return dir;
};

/** A copy of the example workspace `toolchain/junit/workspace`. */
const exampleWorkspace = async (): Promise<FixtureWorkspace> => {
  const ws = await createFixtureWorkspace({ fixturesDir: exampleDir, fixture: "workspace" });
  fixtures.push(ws);
  return ws;
};

/** The lines of the fenced block right after `<!-- tested: <name> -->` in the guide; throws without the mark. */
const guideBlock = async (name: string): Promise<string[]> => {
  const lines = (await fs.readFile(guidePath, "utf8")).split(/\r?\n/);
  const mark = lines.indexOf(`<!-- tested: ${name} -->`);
  if (mark < 0 || lines[mark + 1]?.startsWith("```") !== true) {
    throw new Error(`the guide has no block marked "tested: ${name}"`);
  }
  const end = lines.indexOf("```", mark + 2);
  if (end < 0) {
    throw new Error(`the block "tested: ${name}" of the guide is not closed`);
  }
  return lines.slice(mark + 2, end);
};

/** The lines of a shell block that do something: no empty lines, no comments. */
const commandLines = (block: readonly string[]): string[] =>
  block.map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#"));

type Vars = Readonly<Record<string, string>>;

/**
 * Splits one command line into arguments the way a POSIX shell would for the simple lines of the guide:
 * white space separates, double quotes group, `$NAME` is replaced from `vars`. Throws on anything else
 * (single quotes, globs, pipes, redirections, `${…}`, an unknown variable), so the guide stays simple.
 */
const argsOf = (line: string, vars: Vars): string[] => {
  if (/['*?\\`|&;<>(){}~]/.test(line)) {
    throw new Error(`line too complex for the test: ${line}`);
  }
  const args: string[] = [];
  for (const [, word = ""] of line.matchAll(/((?:"[^"]*"|[^\s"]+)+)/g)) {
    args.push(
      word.replaceAll('"', "").replaceAll(/\$([A-Za-z_][A-Za-z0-9_]*)|\$/g, (_match, name?: string) => {
        if (name === undefined) {
          throw new Error(`a lone $ in: ${line}`);
        }
        const value = vars[name];
        if (value === undefined) {
          throw new Error(`variable ${name} is not set in: ${line}`);
        }
        return value;
      }),
    );
  }
  if ((line.match(/"/g)?.length ?? 0) % 2 !== 0) {
    throw new Error(`unbalanced quotes in: ${line}`);
  }
  return args;
};

/** The environment of a nested Vitest: no trace of the outer run, and the network block preloaded. */
const vitestEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^(VITEST|NODE_OPTIONS$|NODE_V8_COVERAGE$|TEST$)/.test(key)) {
      env[key] = value;
    }
  }
  return { ...env, NODE_OPTIONS: `--import=${blockNetwork}` };
};

/**
 * Runs the Vitest example as the guide does (`vitest run --root toolchain/junit/vitest
 * --outputFile.junit=<file>`), from a copy in a temporary folder whose `node_modules` links to the
 * repository's, so Vitest's caches stay out of the repository. The example's own configuration
 * (`reporters`) is used; the flag only moves the JUnit file. That the guide's `--root` form finds the
 * example's configuration in place is checked by the dry run in `verification/SR-063.md`, not here.
 */
const runVitest = async (outputFile: string): Promise<Run> => {
  const dir = await tempDir();
  const ex = path.join(dir, "ex");
  await fs.cp(path.join(exampleDir, "vitest"), ex, {
    recursive: true,
    filter: (source) => path.basename(source) !== "node_modules",
  });
  await fs.symlink(path.join(repoRoot, "node_modules"), path.join(dir, "node_modules"), "junction");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [vitestBin, "run", `--outputFile.junit=${outputFile}`], {
      cwd: ex,
      stdio: "pipe",
      env: vitestEnv(),
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      });
    });
  });
};

interface Shell {
  vars: Record<string, string>;
  cwd: string;
  /** Every `reqseq` line run, with its result. */
  readonly runs: { readonly line: string; readonly run: Run }[];
}

/** The variable `name` of `shell`; throws when the guide has not set it. */
const v = (shell: Shell, name: string): string => {
  const value = shell.vars[name];
  if (value === undefined) {
    throw new Error(`the guide has not set ${name}`);
  }
  return value;
};

/** The lines of the try blocks that are not `reqseq` or `export`, each done here by its own means. */
const STEPS: Readonly<Record<string, (shell: Shell) => Promise<void>>> = {
  'mkdir -p "$EXAMPLE"': async (shell) => {
    await fs.mkdir(v(shell, "EXAMPLE"), { recursive: true });
  },
  'cp -R toolchain/junit/workspace "$REQSEQ_WORKSPACE"': async (shell) => {
    await fs.cp(path.join(shell.cwd, "toolchain", "junit", "workspace"), v(shell, "REQSEQ_WORKSPACE"), {
      recursive: true,
    });
  },
  'pnpm exec vitest run --root toolchain/junit/vitest --outputFile.junit="$EXAMPLE/results.xml"': async (
    shell,
  ) => {
    const run = await runVitest(path.join(v(shell, "EXAMPLE"), "results.xml"));
    expect(run.code, run.stdout + run.stderr).toBe(0);
  },
  'cd "$EXAMPLE"': (shell) => {
    shell.cwd = v(shell, "EXAMPLE");
    return Promise.resolve();
  },
  'cp "$CHECKOUT/toolchain/junit/pytest/results.xml" results.xml': async (shell) => {
    await fs.copyFile(
      path.join(v(shell, "CHECKOUT"), "toolchain", "junit", "pytest", "results.xml"),
      path.join(shell.cwd, "results.xml"),
    );
  },
};

/** Runs the lines of a marked block in `shell`; every `reqseq` line must exit with 0. */
const runBlock = async (name: string, shell: Shell): Promise<void> => {
  for (const line of commandLines(await guideBlock(name))) {
    const assignment = /^export ([A-Z_][A-Z0-9_]*)=(.+)$/.exec(line);
    if (assignment) {
      const value = argsOf(assignment[2] ?? "", shell.vars);
      if (value.length !== 1) {
        throw new Error(`export of one value expected: ${line}`);
      }
      shell.vars = { ...shell.vars, [assignment[1] ?? ""]: value[0] ?? "" };
    } else if (line.startsWith("reqseq ")) {
      const run = await reqseq(argsOf(line, shell.vars).slice(1), { cwd: shell.cwd });
      expect(run.code, `${line}\n${run.stdout}${run.stderr}`).toBe(0);
      shell.runs.push({ line, run });
    } else {
      const step = STEPS[line];
      if (step === undefined) {
        throw new Error(`the test does not know this line of "${name}": ${line}`);
      }
      await step(shell);
    }
  }
};

/** The one line of the block `pipeline-step`. */
const pipelineStep = async (): Promise<string> => {
  const lines = commandLines(await guideBlock("pipeline-step"));
  expect(lines).toHaveLength(1);
  return lines[0] ?? "";
};

/** The pipeline step of the guide, with `--json`, in `cwd`. */
const runPipelineStep = async (vars: Vars, cwd: string): Promise<Run> =>
  reqseq([...argsOf(await pipelineStep(), vars).slice(1), "--json"], { cwd });

interface EnrichOutput {
  readonly testCases: number;
  readonly unknown: readonly { readonly testCase: string; readonly ref: string }[];
  readonly files: readonly string[];
}

interface StatusOutput {
  readonly elements: readonly {
    readonly shortId: string;
    /** Not for the need the requirements derive from. */
    readonly verification?: readonly { readonly view: string; readonly status: string }[];
  }[];
}

interface CheckOutput {
  readonly ok: boolean;
  readonly problems: readonly { readonly code: string }[];
}

/** The core verification status of each element of the workspace, by short ID. */
const statusOf = async (workspace: string): Promise<Record<string, string | undefined>> => {
  const run = await reqseq(["evidence", "status", "--workspace", workspace, "--json"], { cwd: workspace });
  expect(run.code, run.stderr).toBe(0);
  return Object.fromEntries(
    (JSON.parse(run.stdout) as StatusOutput).elements.map((e) => [
      e.shortId,
      e.verification?.find((v) => v.view === "core")?.status,
    ]),
  );
};

const check = async (workspace: string): Promise<{ run: Run; output: CheckOutput }> => {
  const run = await reqseq(["workspace", "check", "--workspace", workspace, "--json"], { cwd: workspace });
  return { run, output: JSON.parse(run.stdout) as CheckOutput };
};

const git = async (args: readonly string[]): Promise<string> =>
  (await promisify(execFile)("git", [...args], { cwd: repoRoot })).stdout;

/** Every string value under the key `key`, at any depth of a parsed YAML document. */
const valuesOf = (node: unknown, key: string): unknown[] => {
  if (Array.isArray(node)) {
    return (node as unknown[]).flatMap((item) => valuesOf(item, key));
  }
  if (node === null || typeof node !== "object") {
    return [];
  }
  return Object.entries(node as Record<string, unknown>).flatMap(([k, value]) =>
    k === key ? [value] : valuesOf(value, key),
  );
};

describe("connecting a test tool by the guide toolchain/junit/README.md (SR-063)", () => {
  it(
    "[SR-063/AK1] a real Vitest run is connected by the one reqseq call of the guide, and its requirements get a status",
    async () => {
      const before = await git(["status", "--porcelain", "--ignored", "--", "toolchain/junit"]);
      const ws = await exampleWorkspace();
      const checkout = await tempDir();
      const vitest = await runVitest(path.join(checkout, "results.xml"));
      expect(vitest.code, vitest.stdout + vitest.stderr).toBe(0);

      const step = await runPipelineStep({ BUILD: "build-1", REQSEQ_WORKSPACE: ws.root }, checkout);
      expect(step.code, step.stdout + step.stderr).toBe(0);
      const out = JSON.parse(step.stdout) as EnrichOutput;
      expect(out.files).toEqual(["evidence/ci/results-build-1.xml"]);
      expect(out.unknown).toEqual([]);
      expect(out.testCases).toBe(4);

      expect(await statusOf(ws.root)).toEqual({
        "SR-a1c0de": "verified",
        "SR-b2c0de": "verified",
        "SR-c3c0de": "verified",
        // Named only by the skipped test.
        "SR-d4c0de": "open",
      });
      const { run, output } = await check(ws.root);
      expect(run.code, run.stdout).toBe(0);
      expect(output.problems.filter((p) => p.code.startsWith("evidence."))).toEqual([]);
      // The example in the repository is left as it was, ignored files included.
      expect(await git(["status", "--porcelain", "--ignored", "--", "toolchain/junit"])).toBe(before);
    },
    TIMEOUT,
  );

  it(
    "[SR-063/AK1] the JUnit file of a real pytest run is connected by the same call",
    async () => {
      const ws = await exampleWorkspace();
      const checkout = await tempDir();
      await fs.copyFile(path.join(exampleDir, "pytest", "results.xml"), path.join(checkout, "results.xml"));

      const step = await runPipelineStep({ BUILD: "build-2", REQSEQ_WORKSPACE: ws.root }, checkout);
      expect(step.code, step.stdout + step.stderr).toBe(0);
      const out = JSON.parse(step.stdout) as EnrichOutput;
      expect(out.files).toEqual(["evidence/ci/results-build-2.xml"]);
      expect(out.unknown).toEqual([]);
      expect(out.testCases).toBe(2);
      expect(await statusOf(ws.root)).toEqual({
        "SR-a1c0de": "verified",
        "SR-b2c0de": "verified",
        "SR-c3c0de": "open",
        "SR-d4c0de": "open",
      });
    },
    TIMEOUT,
  );

  it("[SR-063/AK1] the pipeline step of the guide is one reqseq call and the CI examples run exactly it", async () => {
    const step = await pipelineStep();
    expect(step).toMatch(/^reqseq evidence enrich-junit /);

    // GitHub Actions: the step line is the `run` of a step; GitLab CI: an entry of a `script`.
    for (const [name, key] of [
      ["ci-github", "run"],
      ["ci-gitlab", "script"],
    ] as const) {
      const block = await guideBlock(name);
      expect(
        block
          .filter((line) => line.includes("reqseq "))
          .map((line) => line.trim().replace(/^(- |run: )/, "")),
      ).toEqual([step]);
      const values = valuesOf(YAML.parse(block.join("\n")) as unknown, key).flat();
      expect(values).toContain(step);
    }

    // "ohne eigenen Code": the example holds tests, tool configuration, a recorded result and the
    // workspace, and no converter, script or plugin. A new file here has to be argued in review.
    const allowed = (file: string): boolean =>
      file.startsWith("toolchain/junit/workspace/") ||
      [
        "toolchain/junit/README.md",
        "toolchain/junit/vitest/vitest.config.mjs",
        "toolchain/junit/vitest/login.test.js",
        "toolchain/junit/pytest/pytest.ini",
        "toolchain/junit/pytest/test_login.py",
        "toolchain/junit/pytest/results.xml",
      ].includes(file);
    const files = (await git(["ls-files", "--", "toolchain/junit"])).split("\n").filter((f) => f !== "");
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((file) => !allowed(file))).toEqual([]);
  });

  it(
    "[SR-063/AK1] a test case with a typo in its ID makes the pipeline step exit with 1 and name it",
    async () => {
      const ws = await exampleWorkspace();
      const checkout = await tempDir();
      const results = path.join(checkout, "results.xml");
      const vitest = await runVitest(results);
      expect(vitest.code, vitest.stdout + vitest.stderr).toBe(0);
      const xml = await fs.readFile(results, "utf8");
      expect(xml).toContain("[SR-a1c0de]");
      await fs.writeFile(results, xml.replace("[SR-a1c0de]", "[SR-a1c0df]"));

      const step = await runPipelineStep({ BUILD: "build-3", REQSEQ_WORKSPACE: ws.root }, checkout);
      expect(step.code).toBe(1);
      const out = JSON.parse(step.stdout) as EnrichOutput;
      expect(out.unknown.map((u) => [u.testCase, u.ref])).toEqual([
        ["login > [SR-a1c0df] accepts a valid password", "SR-a1c0df"],
      ]);
    },
    TIMEOUT,
  );

  it(
    "[SR-063/AK2] every reqseq command of the guide runs as written on the example workspace",
    async () => {
      const home = await tempDir();
      const shell: Shell = { vars: { PWD: repoRoot, HOME: home }, cwd: repoRoot, runs: [] };
      const step = await pipelineStep();

      await runBlock("try-vitest", shell);
      expect(v(shell, "REQSEQ_WORKSPACE").startsWith(home)).toBe(true);
      const status = (): string => shell.runs.at(-1)?.run.stdout ?? "";
      expect(shell.runs.at(-1)?.line).toMatch(/^reqseq evidence status /);
      for (const [id, value] of [
        ["SR-a1c0de", "verified"],
        ["SR-b2c0de", "verified"],
        ["SR-c3c0de", "verified"],
        ["SR-d4c0de", "open"],
      ] as const) {
        expect(status()).toMatch(new RegExp(`${id}\\b.*\\[verification: core ${value}\\]`));
      }

      await runBlock("try-pytest", shell);
      expect(shell.runs.at(-1)?.line).toMatch(/^reqseq evidence status /);
      expect(status()).toMatch(/SR-a1c0de\b.*\[verification: core verified\]/);
      expect(status()).toMatch(/SR-b2c0de\b.*\[verification: core verified\]/);

      // The try blocks connect the examples with the very line of the pipeline step.
      const enriches = shell.runs.filter((r) => r.line.startsWith("reqseq evidence enrich-junit "));
      expect(enriches.map((r) => r.line)).toEqual([step, step]);
      const evidence = await fs.readdir(path.join(v(shell, "REQSEQ_WORKSPACE"), "evidence", "ci"));
      expect(evidence.sort()).toEqual([".gitkeep", "results-build-1.xml", "results-build-2.xml"]);
    },
    TIMEOUT,
  );

  it(
    "two JUnit files of one build, each with its own output name as the guide says, both count",
    async () => {
      const guide = await fs.readFile(guidePath, "utf8");
      const ws = await exampleWorkspace();
      const step = await pipelineStep();
      const vars = { BUILD: "build-4", REQSEQ_WORKSPACE: ws.root };
      const unit = await tempDir();
      const vitest = await runVitest(path.join(unit, "results.xml"));
      expect(vitest.code, vitest.stdout + vitest.stderr).toBe(0);
      const api = await tempDir();
      await fs.copyFile(path.join(exampleDir, "pytest", "results.xml"), path.join(api, "results.xml"));

      const outputs: string[] = [];
      for (const [name, cwd] of [
        ["unit", unit],
        ["api", api],
      ] as const) {
        // The names the guide gives for several files: `results-$BUILD-unit.xml`, `results-$BUILD-api.xml`.
        expect(guide).toContain(`results-$BUILD-${name}.xml`);
        const line = step.replace("results-$BUILD.xml", `results-$BUILD-${name}.xml`);
        expect(line).not.toBe(step);
        const run = await reqseq([...argsOf(line, vars).slice(1), "--json"], { cwd });
        expect(run.code, run.stdout + run.stderr).toBe(0);
        outputs.push(...(JSON.parse(run.stdout) as EnrichOutput).files);
      }
      expect(outputs).toEqual([
        "evidence/ci/results-build-4-unit.xml",
        "evidence/ci/results-build-4-api.xml",
      ]);
      // SR-c3c0de is named by the Vitest file only: it stays verified after the pytest file.
      expect(await statusOf(ws.root)).toEqual({
        "SR-a1c0de": "verified",
        "SR-b2c0de": "verified",
        "SR-c3c0de": "verified",
        "SR-d4c0de": "open",
      });

      // The guide's warning: the same output name twice keeps only the last file.
      const again = await runPipelineStep(vars, unit);
      expect(again.code).toBe(0);
      const last = await runPipelineStep(vars, api);
      expect(last.code).toBe(0);
      await fs.rm(path.join(ws.root, "evidence", "ci", "results-build-4-unit.xml"));
      expect((await statusOf(ws.root))["SR-c3c0de"]).toBe("open");
    },
    TIMEOUT,
  );

  it("the example workspace has no findings", async () => {
    const ws = await exampleWorkspace();
    const { run, output } = await check(ws.root);
    expect(run.code, run.stdout).toBe(0);
    expect(output.problems).toEqual([]);
  });
});

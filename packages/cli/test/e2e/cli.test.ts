// CLI end-to-end tests (ADR-0011): spawn the built `logreq` on fixture workspaces.
// Run after `pnpm build` with `pnpm test:e2e`; on Linux CI also inside `unshare -rn` (no network).
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { FixtureWorkspace } from "@logreq/testkit";
import { createFixtureWorkspace } from "@logreq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cliEnv } from "../support/logreq.js";

const cliDir = fileURLToPath(new URL("../../", import.meta.url));
const bin = path.join(cliDir, "dist", "bin.js");
const testBin = path.join(cliDir, "test", "e2e", "support", "test-bin.mjs");
// The spawned CLI fails any connection that leaves the machine, like the test process (SR-077).
const blockNetwork = pathToFileURL(
  path.join(cliDir, "..", "..", "scripts", "test-support", "block-network.mjs"),
).href;

interface Run {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutBytes: Buffer;
}

interface RunOptions {
  readonly cwd: string;
  /** Use the test entry with test-only command implementations instead of dist/bin.js. */
  readonly testCommands?: boolean;
  readonly stdin?: string;
  /** Close the read end of stdout after the first chunk, like `logreq ... | head -1`. */
  readonly closeStdoutEarly?: boolean;
}

const logreq = (args: readonly string[], options: RunOptions): Promise<Run> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", blockNetwork, options.testCommands === true ? testBin : bin, ...args],
      { cwd: options.cwd, stdio: "pipe", env: cliEnv() },
    );
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => {
      out.push(chunk);
      if (options.closeStdoutEarly === true) {
        child.stdout.destroy();
      }
    });
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const stdoutBytes = Buffer.concat(out);
      resolve({
        code,
        stdout: stdoutBytes.toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        stdoutBytes,
      });
    });
    child.stdin.end(options.stdin ?? "");
  });

const fixtures: FixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

const workspace = async (files: Record<string, string> = {}): Promise<FixtureWorkspace> => {
  const ws = await createFixtureWorkspace({
    files: { "logreq-workspace.yaml": "logreq-workspace: 1\nname: E2E\n", ...files },
    git: true,
  });
  fixtures.push(ws);
  return ws;
};

const problems = [
  {
    code: "file.invalid-yaml",
    severity: "error",
    message: "Größe – 測試 is not YAML",
    file: "product/a.md",
    line: 3,
  },
  { code: "file.yaml-warning", severity: "warning", message: "duplicate key", file: "product/b.md" },
];

beforeAll(() => {
  if (!existsSync(bin)) {
    throw new Error(`${bin} is missing: run pnpm build before pnpm test:e2e`);
  }
});

describe("logreq binary", () => {
  it("prints its version and help without colors", async () => {
    const ws = await workspace();
    const version = await logreq(["--version"], { cwd: ws.root });
    expect(version.code).toBe(0);
    expect(version.stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
    const help = await logreq(["--help"], { cwd: ws.root });
    expect(help.code).toBe(0);
    expect(help.stdout).toMatch(/workspace <action> \[options\]/);
    expect(help.stdout).toMatch(/reqif <action> \[options\]/);
    expect(help.stdout).not.toContain("\u001b[");
    const group = await logreq(["element", "--help"], { cwd: ws.root });
    expect(group.stdout).toMatch(/set-status <status> \[options\]/);
    // status: null removes the status line (#343); the command line gives null with --input.
    const setStatus = await logreq(["element", "set-status", "--help"], { cwd: ws.root });
    expect(setStatus.stdout).toMatch(/null only via\s+--input/);
  });

  it("exits 2 for usage errors and for commands that are not implemented yet", async () => {
    const ws = await workspace();
    const unknown = await logreq(["nope"], { cwd: ws.root });
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain("unknown command 'nope'");
    const planned = await logreq(["reqif", "export", "out.reqif", "--json"], { cwd: ws.root });
    expect(planned.code).toBe(2);
    expect(planned.stdout).toBe("");
    expect(JSON.parse(planned.stderr)).toEqual({
      code: "command.not-implemented",
      message: "Command reqif.export is not implemented yet",
      details: { command: "reqif.export" },
    });
    const usageJson = await logreq(["workspace", "nope", "--json"], { cwd: ws.root });
    expect(usageJson.code).toBe(2);
    expect(JSON.parse(usageJson.stderr)).toEqual({
      code: "input.invalid",
      message: "unknown command 'nope'",
    });
  });

  it("runs a product command on a fixture workspace, found from a subfolder", async () => {
    const ws = await createFixtureWorkspace({ fixture: "SR-004/one-repository", git: true });
    fixtures.push(ws);
    const result = await logreq(["workspace", "status", "--json"], { cwd: ws.path("requirements") });
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ name: "Weather station", readOnly: false });
  });

  it("shows one element with element get, and exits 2 for an unknown reference", async () => {
    const ws = await createFixtureWorkspace({ fixture: "SR-072/supersede", git: true });
    fixtures.push(ws);
    const supersede = await logreq(
      ["element", "supersede", "N-d4e5f6", "obsolete", "--successor", "N-e5f6a7", "--json"],
      { cwd: ws.root },
    );
    expect(supersede.code).toBe(0);
    const shown = await logreq(["element", "get", "N-d4e5f6", "--json"], { cwd: ws.root });
    expect(shown.stderr).toBe("");
    expect(shown.code).toBe(0);
    expect(JSON.parse(shown.stdout)).toMatchObject({
      element: {
        id: "7a1e0c2b-4d3f-4a5b-8c6d-a1b2c3d4e5f6",
        shortId: "N-d4e5f6",
        status: "obsolete",
        title: "See the wind",
        readOnly: false,
        relations: [
          { kind: "supersedes", direction: "in", shortId: "N-e5f6a7", title: "See wind and gusts" },
        ],
      },
    });
    // The version date only on request (D-013), from the fixture's commit. The supersede changed only
    // the status of N-d4e5f6, which is not in the version, so its date stays (ADR-0005).
    const element = (stdout: string): Record<string, unknown> =>
      (JSON.parse(stdout) as { element: Record<string, unknown> }).element;
    expect(element(shown.stdout)).not.toHaveProperty("versionDate");
    const dated = await logreq(["element", "get", "SR-f6a7b8", "--version-date", "--json"], { cwd: ws.root });
    expect(dated.code).toBe(0);
    expect(element(dated.stdout)["versionDate"]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    const changed = await logreq(["element", "get", "N-d4e5f6", "--version-date", "--json"], {
      cwd: ws.root,
    });
    expect(element(changed.stdout)["versionDate"]).toBe(element(dated.stdout)["versionDate"]);
    const unknown = await logreq(["element", "get", "N-ffffff", "--json"], { cwd: ws.root });
    expect(unknown.code).toBe(2);
    expect(unknown.stdout).toBe("");
    expect(JSON.parse(unknown.stderr)).toMatchObject({ code: "ref.unknown" });
  });

  it("creates an element with the title as argument or as --title, and prints each problem once (#310)", async () => {
    const ws = await createFixtureWorkspace({ fixture: "SR-004/one-repository" });
    fixtures.push(ws);
    const created = await logreq(["element", "create", "system-requirement", "--title", "Show gusts"], {
      cwd: ws.root,
    });
    expect([created.code, created.stderr]).toEqual([0, ""]);
    const lines = created.stdout.split("\n");
    expect(lines[0]).toMatch(/^SR-[0-9a-f]{6,} {2}draft {2}Show gusts$/);
    expect(lines[1]).toBe("files:");
    // Requirement type and acceptance criteria have no value: one line each, not twice.
    const missing = lines.filter((l) => l.startsWith("warning  element.missing-required  "));
    expect(missing).toHaveLength(2);
    expect(lines).toHaveLength(3 + missing.length + 1);
    const positional = await logreq(["element", "create", "system-requirement", "Show calm", "--json"], {
      cwd: ws.root,
    });
    expect(JSON.parse(positional.stdout)).toMatchObject({ element: { title: "Show calm" } });
    const shown = await logreq(["element", "get", lines[0]?.split("  ")[0] ?? ""], { cwd: ws.root });
    expect(shown.stdout).toMatch(
      /^SR-[0-9a-f]{6,} {2}draft {2}Show gusts {2}\[verification: core open\]\n {2}id: [0-9a-f-]{36}\n {2}type: system-requirement\n {2}file: /,
    );
  });

  it("names elements by their spec ID and shows it next to the short ID (#305)", async () => {
    const ws = await createFixtureWorkspace({ fixture: "enabler-305/identifiers" });
    fixtures.push(ws);
    const run = (...args: string[]): Promise<Run> => logreq(args, { cwd: ws.root });
    const shown = await run("element", "get", "sr-036");
    expect([shown.code, shown.stderr]).toEqual([0, ""]);
    expect(shown.stdout.split("\n")[0]).toBe(
      // SR-037 derives from it and has no record: the child that is missing (SR-034 AK2), by UUID.
      "SR-0b0036 (SR-036)  draft  Accept identifiers as references  [verification: core open (missing 30500000-0000-4000-8000-0000000b0037)]",
    );
    expect(shown.stdout).toContain(
      "    - -> derives-from  N-0a0001 (N-001)  Name elements by their spec ID\n",
    );
    const chain = await run("trace", "chain", "N-001");
    expect(chain.stdout).toBe(
      [
        "N-0a0001 (N-001)  draft  Name elements by their spec ID",
        "children:",
        "  1  SR-0b0036 (SR-036)  draft  Accept identifiers as references",
        "  2    SR-0b0037 (SR-037)  draft  Show identifiers next to short IDs  [gap: no evidence]",
        "total: 3",
        "No problems.",
        "",
      ].join("\n"),
    );
    const resolved = await run("element", "resolve", "D-047", "--json");
    expect(JSON.parse(resolved.stdout)).toMatchObject({
      element: { shortId: "D-0c0047", identifier: "D-047" },
    });
  });

  // Nine spawns of the binary and a Git fixture in one test: 5.5 to 6.7 s on an idle machine, 11 s next to a loaded CPU (#460).
  // That is above the 5 s default and too close to the 30 s of vitest.e2e.config.ts for a slow runner, so this test
  // has its own bound (about ten times the measured time); the global timeout stays.
  const SPAWN_HEAVY_TIMEOUT_MS = 60_000;
  it(
    "[SR-060/AK1] answers the input mistakes of the first dogfooding trial readably (#309)",
    async () => {
      const ws = await createFixtureWorkspace({ fixture: "SR-072/supersede", git: true });
      fixtures.push(ws);
      const run = (...args: string[]): Promise<Run> => logreq(args, { cwd: ws.root });
      const REF_FORM =
        "is not a reference to an element (a UUID, a short ID such as SR-3c90b0 or an identifier such as SR-036; at most 256 characters, without control characters or spaces at either end)";
      // SR-036 may be an identifier (#305); this workspace has none, so it names no element.
      const unknown = await run("element", "get", "SR-036");
      expect([unknown.code === 0, unknown.stderr]).toEqual([
        false,
        'error ref.unknown: No element has the identifier "SR-036"\n',
      ]);
      const malformed = await run("element", "get", " SR-036");
      expect([malformed.code, malformed.stderr]).toEqual([
        2,
        `error input.invalid: Invalid input for element.get: <ref> " SR-036" ${REF_FORM}\n`,
      ]);
      const lower = await run("element", "get", "n-D4E5F6");
      expect([lower.code, lower.stdout.split("\n")[0]]).toEqual([
        0,
        "N-d4e5f6  approved  See the wind  [validation: open]",
      ]);
      const named = await run("element", "supersede", "n-d4e5f6", "Obsolete");
      expect([named.code, named.stderr]).toEqual([0, ""]);
      expect(readFileSync(ws.path("needs/N-a1b2c3d4e5f6.md"), "utf8")).toContain("\nstatus: obsolete\n");
      const notInvalid = await run("element", "supersede", "N-e5f6a7", "Approved");
      expect([notInvalid.code, notInvalid.stderr]).toEqual([
        2,
        "error input.invalid: Approved is not marked invalid in the metamodel, so it cannot supersede an element; the invalid statuses are: obsolete (Obsolete)\n",
      ]);
      const pkg = await run("hint", "list", "--package", "Stufe 2 ");
      expect(pkg.stderr).toBe(
        `error input.invalid: Invalid input for hint.list: --package "Stufe 2 " ${REF_FORM}\n`,
      );
      const init = await logreq(["workspace", "init", "--workspace", ws.root], { cwd: ws.root });
      expect([init.code, init.stderr]).toEqual([
        2,
        "error input.invalid: Invalid input for workspace.init: <path> is required; <name> is required\n",
      ]);
      const choice = await run(
        "element",
        "create",
        "system-requirement",
        "Show gusts",
        "--input",
        '{"properties":{"requirement-type":"Functionall"}}',
      );
      expect([choice.code, choice.stdout]).toEqual([2, ""]);
      expect(choice.stderr).toMatch(
        /^error input\.invalid: properties\.requirement-type: Functionall is not a value of Requirement Type; the values are: functional \(Functional\), /,
      );
      const created = await run(
        "element",
        "create",
        "system-requirement",
        "Show gusts",
        "--input",
        '{"properties":{"requirement-type":"Functional"}}',
        "--json",
      );
      expect(JSON.parse(created.stdout)).toMatchObject({
        element: { properties: { "requirement-type": "functional" } },
      });
    },
    SPAWN_HEAVY_TIMEOUT_MS,
  );

  it("opens one copy of a UUID two files share with --file, and exits 2 without it (SR-088, #255)", async () => {
    const ws = await createFixtureWorkspace({ fixture: "SR-088/copied-file" });
    fixtures.push(ws);
    const cwd = ws.path("system");
    const both = await logreq(["element", "get", "N-cf2661", "--json"], { cwd });
    expect(both.code).toBe(2);
    expect(JSON.parse(both.stderr)).toMatchObject({ code: "ref.ambiguous" });
    const copy = await logreq(
      [
        "element",
        "get",
        "N-cf2661",
        "--repository",
        "system",
        "--file",
        "copies/N-00606ccf2661.md",
        "--json",
      ],
      { cwd },
    );
    expect(copy.stderr).toBe("");
    expect(copy.code).toBe(0);
    expect(JSON.parse(copy.stdout)).toMatchObject({
      element: { id: "948a10f1-05c3-4212-bd19-00606ccf2661", file: "copies/N-00606ccf2661.md" },
    });
  });

  it("adds and removes a relation with relation add and relation remove, with a hint on a cycle (#264, SR-067 AK3)", async () => {
    const ws = await createFixtureWorkspace({ fixture: "SR-090/cycle", git: true });
    fixtures.push(ws);
    const D = "5e9c0a7d-2b4f-4c61-9d08-0b0000000004";
    const added = await logreq(["relation", "add", "SR-b0000000001", "derives-from", D, "--json"], {
      cwd: ws.root,
    });
    expect(added.stderr).toBe("");
    expect(added.code).toBe(0);
    expect(JSON.parse(added.stdout)).toMatchObject({
      files: ["requirements/SR-0b0000000001.md"],
      problems: [
        { code: "trace.cycle", severity: "warning", file: "requirements/SR-0b0000000001.md", line: 12 },
        { code: "trace.cycle", severity: "warning", file: "requirements/SR-0b0000000004.md", line: 10 },
      ],
    });
    const shown = await logreq(["element", "get", "SR-b0000000001", "--json"], { cwd: ws.root });
    expect(JSON.parse(shown.stdout)).toMatchObject({
      element: {
        relations: [{ kind: "derives-from" }, { kind: "derives-from" }, { kind: "derives-from", id: D }],
      },
    });
    const removed = await logreq(["relation", "remove", "SR-b0000000001", "derives-from", D, "--json"], {
      cwd: ws.root,
    });
    expect(removed.code).toBe(0);
    expect(JSON.parse(removed.stdout)).toEqual({ files: ["requirements/SR-0b0000000001.md"], problems: [] });
    expect(await ws.git(["status", "--porcelain"])).toBe("");
    const refused = await logreq(["relation", "add", "N-a0000000001", "derives-from", D], { cwd: ws.root });
    expect(refused.code).not.toBe(0);
    expect(refused.stderr).toContain("is not allowed");
  });
});

describe("logreq with test commands", () => {
  it("exits 0 for a workspace without findings", async () => {
    const ws = await workspace();
    const result = await logreq(["workspace", "check"], { cwd: ws.root, testCommands: true });
    expect(result).toMatchObject({
      code: 0,
      stdout: "ok: true\ncheckedElements: 0\nNo problems.\n",
      stderr: "",
    });
  });

  it("exits 1 for error findings and lists each with severity, code, file:line and message", async () => {
    const ws = await workspace({ "test-problems.json": JSON.stringify(problems) });
    const result = await logreq(["workspace", "check"], { cwd: ws.root, testCommands: true });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe(
      [
        "ok: false",
        "checkedElements: 0",
        "error  file.invalid-yaml  product/a.md:3  Größe – 測試 is not YAML",
        "warning  file.yaml-warning  product/b.md  duplicate key",
        "",
      ].join("\n"),
    );
    // UTF-8 on stdout, whatever the console code page.
    expect(result.stdoutBytes.includes(Buffer.from("Größe – 測試", "utf8"))).toBe(true);
  });

  it("prints exactly the command output with --json", async () => {
    const ws = await workspace({ "test-problems.json": JSON.stringify(problems) });
    const result = await logreq(["workspace", "check", "--json"], { cwd: ws.root, testCommands: true });
    expect(result.code).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({ ok: false, problems, checkedElements: 0 });
  });

  it("ends quietly with the command's exit code when the reader closes the pipe early", async () => {
    const many = Array.from({ length: 20_000 }, (_, i) => ({
      code: "file.yaml-warning",
      severity: "warning",
      message: `warning number ${String(i)} with some text to make the output large`,
      file: `product/file-${String(i)}.md`,
    }));
    const ws = await workspace({ "test-problems.json": JSON.stringify(many) });
    const result = await logreq(["workspace", "check"], {
      cwd: ws.root,
      testCommands: true,
      closeStdoutEarly: true,
    });
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdoutBytes.length).toBeLessThan(Buffer.byteLength(JSON.stringify(many)));
  });

  it("exits 0 for warnings only", async () => {
    const ws = await workspace({ "test-problems.json": JSON.stringify(problems.slice(1)) });
    const result = await logreq(["workspace", "check", "--json"], { cwd: ws.root, testCommands: true });
    expect(result.code).toBe(0);
  });

  it("passes repeated flags, --input files and standard input to the command", async () => {
    const ws = await workspace({
      "input.json": JSON.stringify({ changedFiles: ["c.md"], changedSince: "main" }),
    });
    const flags = await logreq(
      [
        "workspace",
        "check",
        "--changed-files",
        "a.md",
        "--changed-files",
        "b.md",
        "--changed-since",
        "HEAD~1",
        "--json",
      ],
      { cwd: ws.root, testCommands: true },
    );
    const files = (run: Run): unknown =>
      (JSON.parse(run.stdout) as { problems: { file: string; message: string }[] }).problems.map((p) => [
        p.file,
        p.message,
      ]);
    // `changedFiles` are local paths: the CLI makes them absolute (ADR-0009), from every source.
    expect(files(flags)).toEqual([
      [ws.path("a.md"), "changed since HEAD~1"],
      [ws.path("b.md"), "changed since HEAD~1"],
    ]);
    const fromFile = await logreq(["workspace", "check", "--input", "@input.json", "--json"], {
      cwd: ws.root,
      testCommands: true,
    });
    expect(files(fromFile)).toEqual([[ws.path("c.md"), "changed since main"]]);
    const fromStdin = await logreq(["workspace", "check", "--input", "-", "--json"], {
      cwd: ws.root,
      testCommands: true,
      stdin: JSON.stringify({ changedFiles: ["d.md"] }),
    });
    expect(files(fromStdin)).toEqual([[ws.path("d.md"), "changed since (none)"]]);
  });

  it("finds the workspace from a subfolder, or takes --workspace", async () => {
    const ws = await workspace({
      "product/deep/x.md": "x",
      "other/logreq-workspace.yaml": "logreq-workspace: 1\n",
    });
    const nested = await logreq(["workspace", "status", "--json"], {
      cwd: ws.path("product/deep"),
      testCommands: true,
    });
    expect(nested.code).toBe(0);
    expect(JSON.parse(nested.stdout)).toMatchObject({ repositories: [{ path: ws.root }] });
    const explicit = await logreq(["workspace", "status", "--workspace", "../other", "--json"], {
      cwd: ws.path("product"),
      testCommands: true,
    });
    expect(JSON.parse(explicit.stdout)).toMatchObject({ repositories: [{ path: ws.path("other") }] });
  });

  it("exits 2 for command errors, with the error on stderr", async () => {
    const ws = await workspace();
    const human = await logreq(["element", "get", "SR-46fb54"], { cwd: ws.root, testCommands: true });
    expect(human).toMatchObject({
      code: 2,
      stdout: "",
      stderr: "error element.not-found: No element SR-46fb54\n",
    });
    const json = await logreq(["element", "get", "SR-46fb54", "--json"], {
      cwd: ws.root,
      testCommands: true,
    });
    expect(json.code).toBe(2);
    expect(JSON.parse(json.stderr)).toEqual({
      code: "element.not-found",
      message: "No element SR-46fb54",
      details: { ref: "SR-46fb54" },
    });
    const invalid = await logreq(["element", "get", "not a ref "], { cwd: ws.root, testCommands: true });
    expect(invalid.code).toBe(2);
    expect(invalid.stderr).toMatch(
      /^error input\.invalid: Invalid input for element\.get: <ref> "not a ref " is not a reference /,
    );
  });

  it("exits 3 for internal errors without their original text", async () => {
    const ws = await workspace();
    const result = await logreq(["metamodel", "get", "--json"], { cwd: ws.root, testCommands: true });
    expect(result.code).toBe(3);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      code: "internal",
      message: "Internal error in metamodel.get",
      details: { command: "metamodel.get" },
    });
    expect(result.stderr).not.toContain("secret");
  });
});

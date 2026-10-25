// `logreq workspace check` end to end (SR-019, ADR-0009): the built binary with the product commands on
// fixture workspaces, its exit code, its lines and its JSON. Also the CLI tests that SR-025, SR-085,
// SR-086, SR-088, SR-089 and SR-090 handed over to this command (#127 option 1).
// Run after `pnpm build` with `pnpm test:e2e`.
import fs from "node:fs/promises";
import type { FixtureWorkspace } from "@logreq/testkit";
import { createFixtureWorkspace } from "@logreq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Run } from "../support/logreq.js";
import { logreq as run, requireBuiltCli } from "../support/logreq.js";

const logreq = (args: readonly string[], cwd: string): Promise<Run> => run(args, { cwd });

interface Problem {
  readonly code: string;
  readonly severity: string;
  readonly repository?: string;
  readonly file?: string;
  readonly line?: number;
  readonly message?: string;
  readonly elementId?: string;
  readonly targetId?: string;
  readonly storedDate?: string | null;
  readonly currentDate?: string | null;
  readonly hintId?: string;
}

interface Output {
  readonly ok: boolean;
  readonly problems: readonly Problem[];
  readonly checkedElements: number;
}

const fixtures: FixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

const fixture = async (name: string, git = false): Promise<FixtureWorkspace> => {
  const ws = await createFixtureWorkspace(git ? { fixture: name, git: true } : { fixture: name });
  fixtures.push(ws);
  return ws;
};

/** Runs the check in `folder` of the fixture, as lines and as JSON. */
const checkBoth = async (cwd: string): Promise<{ human: Run; json: Run; output: Output }> => {
  const human = await logreq(["workspace", "check"], cwd);
  const json = await logreq(["workspace", "check", "--json"], cwd);
  return { human, json, output: JSON.parse(json.stdout) as Output };
};

/** Kind, file and element of each problem (SR-019 AK2). */
const kinds = (output: Output): (readonly [string, string | undefined, string | undefined])[] =>
  output.problems.map((p) => [p.code, p.file, p.elementId] as const);

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

const NEED = "1a1a1a1a-1111-4111-8111-a0000000000";
const SR = "2b2b2b2b-2222-4222-8222-b0000000000";
/** The elements of fixtures/SR-090/cycle: A (1), B (2) and C (3) form the cycle, D (4) derives from A. */
const CYCLE = "5e9c0a7d-2b4f-4c61-9d08-0b000000000";

describe("logreq workspace check (SR-019)", () => {
  it("[SR-019/AK1] ends with exit code 0 for a workspace without findings", async () => {
    const ws = await fixture("SR-072/supersede");
    const { human, json, output } = await checkBoth(ws.root);
    expect(human).toEqual({ code: 0, stdout: "ok: true\ncheckedElements: 5\nNo problems.\n", stderr: "" });
    expect(json.code).toBe(0);
    expect(output).toEqual({ ok: true, problems: [], checkedElements: 5 });
  });

  it("[SR-019/AK1] ends with exit code 0 when there is only info, such as a repository that is not here", async () => {
    const ws = await fixture("SR-089/missing-targets");
    const { human, output } = await checkBoth(ws.path("system"));
    expect(human.code).toBe(0);
    expect(human.stdout).toContain(
      "info  workspace.repository-missing  Repository vault is not available locally\n",
    );
    expect(output.ok).toBe(true);
  });

  it("[SR-019/AK2] reports every finding with kind, file and element and ends with exit code 1", async () => {
    const ws = await fixture("SR-019/findings");
    const { human, json, output } = await checkBoth(ws.root);
    expect([human.code, json.code, human.stderr, json.stderr]).toEqual([1, 1, "", ""]);
    expect(kinds(output)).toEqual([
      ["file.invalid-yaml", "requirements/SR-b00000000006.md", undefined],
      ["file.conflict-markers", "requirements/SR-b00000000007.md", undefined],
      ["element.missing-required", "requirements/SR-b00000000002.md", `${SR}2`],
      ["element.unknown-property", "requirements/SR-b00000000003.md", `${SR}3`],
      ["relation.target-superseded", "requirements/SR-b00000000008.md", `${SR}8`],
      ["variant.superseded-in-validity", "requirements/SR-b00000000009.md", `${SR}9`],
      ["element.wrong-value-kind", "requirements/SR-b00000000004.md", `${SR}4`],
      ["relation.not-allowed", "needs/N-a00000000002.md", `${NEED}2`],
      ["element.duplicate-id", "copies/N-a00000000003.md", `${NEED}3`],
      ["element.duplicate-id", "needs/N-a00000000003.md", `${NEED}3`],
      ["relation.missing-target", "requirements/SR-b00000000005.md", `${SR}5`],
    ]);
    const lines = human.stdout.split("\n");
    expect(lines.slice(0, 2)).toEqual(["ok: false", "checkedElements: 13"]);
    expect(lines).toContainEqual(
      expect.stringMatching(
        /^warning {2}element\.wrong-value-kind {2}system:requirements\/SR-b00000000004\.md:7 {2}.* {2}\(element 2b2b2b2b-2222-4222-8222-b00000000004\)$/,
      ),
    );
    expect(lines).toContainEqual(
      expect.stringMatching(
        /^error {2}file\.conflict-markers {2}system:requirements\/SR-b00000000007\.md:5 {2}/,
      ),
    );
    expect(lines.filter((line) => /^(error|warning) {2}/.test(line))).toHaveLength(output.problems.length);
  });

  it("[SR-019/AK2] reports a relation whose target was removed and ends with exit code 1 (SR-089)", async () => {
    const ws = await fixture("SR-089/missing-targets");
    await fs.rm(ws.path("system/needs/N-2c3d4e5f6a7b.md"));
    const { human, json, output } = await checkBoth(ws.path("system"));
    expect([human.code, json.code]).toEqual([1, 1]);
    const missing = output.problems.filter((p) => p.code === "relation.missing-target");
    expect(missing.length).toBeGreaterThan(0);
    expect(new Set(missing.map((p) => p.targetId))).toEqual(
      new Set(["3b8e1f2a-6c4d-4e7f-9a1b-2c3d4e5f6a7b"]),
    );
    expect(new Set(missing.map((p) => `${p.repository ?? ""}:${p.file ?? ""}`))).toEqual(
      new Set(["system:requirements/SR-c4d5e6f7a8b9.md", "sensor:anemometer/SR-1e0f9a8b7c6d.md"]),
    );
    expect(human.stdout).toContain("error  relation.missing-target  system:requirements/SR-c4d5e6f7a8b9.md:");
  });

  it("[SR-019/AK2] reports every element of a cycle in the derivations with kind, file and element and ends with exit code 1 (SR-090)", async () => {
    const ws = await fixture("SR-090/cycle");
    const { human, json, output } = await checkBoth(ws.root);
    expect([human.code, json.code, human.stderr, json.stderr]).toEqual([1, 1, "", ""]);
    expect(kinds(output)).toEqual([
      ["trace.cycle", "requirements/SR-0b0000000001.md", `${CYCLE}1`],
      ["trace.cycle", "requirements/SR-0b0000000002.md", `${CYCLE}2`],
      ["trace.cycle", "requirements/SR-0b0000000003.md", `${CYCLE}3`],
    ]);
    const lines = human.stdout.split("\n");
    expect(lines.slice(0, 2)).toEqual(["ok: false", "checkedElements: 5"]);
    expect(
      lines.filter((line) => line.startsWith("warning  trace.cycle  system:requirements/SR-0b000000000")),
    ).toHaveLength(3);
  });

  it("[SR-019/AK2] shows only errors with --severity error, and still ends with exit code 1 for warnings", async () => {
    const ws = await fixture("SR-085/value-kinds");
    const result = await logreq(["workspace", "check", "--severity", "error", "--json"], ws.path("system"));
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ ok: false, problems: [], checkedElements: 4 });
    const human = await logreq(["workspace", "check", "--severity", "error"], ws.path("system"));
    expect(human).toEqual({ code: 1, stdout: "ok: false\ncheckedElements: 4\nNo problems.\n", stderr: "" });
  });

  it("[SR-019/AK3] gives all findings as JSON, exactly the command output", async () => {
    const ws = await fixture("SR-019/findings");
    const { json, output } = await checkBoth(ws.root);
    expect(json.stdout.endsWith("\n")).toBe(true);
    expect(output.ok).toBe(false);
    expect(output.checkedElements).toBe(13);
    expect(output.problems).toHaveLength(11);
    for (const problem of output.problems) {
      expect(Object.keys(problem)).toEqual(expect.arrayContaining(["code", "severity", "message", "file"]));
    }
  });
});

describe("findings handed over to workspace check", () => {
  it("[SR-085/AK3] reports a value of the wrong kind as a finding with code, file and element", async () => {
    const ws = await fixture("SR-085/value-kinds");
    const { human, json, output } = await checkBoth(ws.path("system"));
    // SR-019 AK2: findings of SR-085 end the check with exit code 1.
    expect([human.code, json.code]).toEqual([1, 1]);
    expect(kinds(output)).toEqual([
      ["element.wrong-value-kind", "requirements/SR-9b0f1826503d.md", "234ae95e-f9e5-4d31-9ab2-9b0f1826503d"],
      ["element.wrong-value-kind", "requirements/SR-9b0f1826503d.md", "234ae95e-f9e5-4d31-9ab2-9b0f1826503d"],
      ["element.wrong-value-kind", "requirements/SR-9b0f1826503d.md", "234ae95e-f9e5-4d31-9ab2-9b0f1826503d"],
      ["element.wrong-value-kind", "requirements/SR-9b0f1826503d.md", "234ae95e-f9e5-4d31-9ab2-9b0f1826503d"],
      ["element.wrong-value-kind", "anemometer/SR-b69e094ad34c.md", "c0dcc639-0097-42b7-b926-b69e094ad34c"],
    ]);
    expect(human.stdout).toContain(
      'warning  element.wrong-value-kind  system:requirements/SR-9b0f1826503d.md:6  Property Weight (weight) expects a number; the value is the text "heavy"  (element 234ae95e-f9e5-4d31-9ab2-9b0f1826503d)\n',
    );
  });

  it("[SR-086/AK2] workspace check reports a relation between types that are not allowed as a finding", async () => {
    const ws = await fixture("SR-086/relation-types");
    const { human, json, output } = await checkBoth(ws.path("system"));
    expect([human.code, json.code]).toEqual([1, 1]);
    const relations = output.problems.filter((p) => p.code === "relation.not-allowed");
    expect(relations.map((p) => [p.repository, p.file, p.elementId, p.targetId])).toEqual([
      [
        "system",
        "needs/N-e3e85234824e.md",
        "22a972fd-f4f1-4b95-ba1d-e3e85234824e",
        expect.stringMatching(/b185f3$/),
      ],
      [
        "sensor",
        "anemometer/SSR-4aa95a8571ac.md",
        "67719da8-02aa-4c04-9637-4aa95a8571ac",
        expect.stringMatching(/b185f3$/),
      ],
    ]);
    expect(human.stdout).toContain("from Need N-34824e to System Requirement SR-b185f3 is not allowed");
    expect(human.stdout).toContain(
      "from Safety Requirement SSR-8571ac to System Requirement SR-b185f3 is not allowed",
    );
  });

  it("[SR-088/AK3] ends with exit code 1 for duplicate UUIDs and lists both files", async () => {
    const ws = await fixture("SR-088/copied-file");
    const { human, json, output } = await checkBoth(ws.path("system"));
    expect([human.code, json.code]).toEqual([1, 1]);
    expect(
      output.problems.filter((p) => p.code === "element.duplicate-id").map((p) => [p.severity, p.file]),
    ).toEqual([
      ["error", "copies/N-00606ccf2661.md"],
      ["error", "requirements/N-00606ccf2661.md"],
    ]);
  });

  it("[SR-090/AK1] reports the cycle of A, B and C, naming all three elements", async () => {
    const ws = await fixture("SR-090/cycle");
    const { human, output } = await checkBoth(ws.root);
    const cycle = output.problems.filter((p) => p.code === "trace.cycle");
    expect(cycle.map((p) => [p.elementId, p.targetId])).toEqual([
      [`${CYCLE}1`, `${CYCLE}2`],
      [`${CYCLE}2`, `${CYCLE}3`],
      [`${CYCLE}3`, `${CYCLE}1`],
    ]);
    // D only derives from A: it is no element of the cycle.
    expect(output.problems.map((p) => p.elementId)).not.toContain(`${CYCLE}4`);
    expect(human.stdout).toContain(
      "warning  trace.cycle  system:requirements/SR-0b0000000002.md:10  System Requirement SR-000002 is in a cycle of derivations with 3 elements (System Requirement SR-b0000000001, System Requirement SR-000002, System Requirement SR-000003): its relation Derives from to System Requirement SR-000003 leads back to it  (element 5e9c0a7d-2b4f-4c61-9d08-0b0000000002)\n",
    );
  });

  it("[SR-090/AK2] ends the check from the command line with exit code 1 for a cycle", async () => {
    const ws = await fixture("SR-090/cycle");
    const { human, json, output } = await checkBoth(ws.root);
    expect([human.code, json.code]).toEqual([1, 1]);
    expect(output.ok).toBe(false);
    // Only the cycle's own findings, so the exit code comes from them.
    expect(new Set(output.problems.map((p) => p.code))).toEqual(new Set(["trace.cycle"]));
    // Breaking the cycle ends the check with exit code 0 again: C derives from the need, with the
    // need's current version, so the relation is not outdated (SR-025).
    await fs.writeFile(
      ws.path("requirements/SR-0b0000000003.md"),
      (await fs.readFile(ws.path("requirements/SR-0b0000000003.md"), "utf8")).replace(
        `{ id: ${CYCLE}1, version: n1:bf80fe67ff43c803 }`,
        "{ id: 5e9c0a7d-2b4f-4c61-9d08-0a0000000001, version: n1:3e5f74ee1859b526 }",
      ),
    );
    const fixed = await logreq(["workspace", "check"], ws.root);
    expect(fixed.code).toBe(0);
  });
});

/** The elements of fixtures/SR-025/outdated: the need N, requirement A (derives from N, valid in V, references N) and the variant V. */
const OUTDATED = "5e025a7d-2b4f-4c61-9d08-0";
const N_ID = `${OUTDATED}a0000000001`;
const A_ID = `${OUTDATED}b0000000001`;
const V_ID = `${OUTDATED}c0000000001`;

/** The committer date of HEAD in `ws`, as ADR-0005 writes a version date. */
const headDate = async (ws: FixtureWorkspace): Promise<string> =>
  new Date(Number((await ws.git(["show", "-s", "--format=%ct", "HEAD"])).trim()) * 1000)
    .toISOString()
    .replace(".000Z", "Z");

describe("outdated relations in workspace check (SR-025)", () => {
  it("[SR-025/AK1] reports nothing and ends with exit code 0 when every relation is current", async () => {
    const ws = await fixture("SR-025/outdated", true);
    const { human, json, output } = await checkBoth(ws.root);
    expect(human).toEqual({ code: 0, stdout: "ok: true\ncheckedElements: 4\nNo problems.\n", stderr: "" });
    expect(json.code).toBe(0);
    expect(output).toEqual({ ok: true, problems: [], checkedElements: 4 });
  });

  it("[SR-025/AK2] [SR-019/AK2] names source, target and the dates of both versions and ends with exit code 1", async () => {
    const ws = await fixture("SR-025/outdated", true);
    const stored = await headDate(ws);
    // The need and the variant get a new text after A's relations to them were set, and are committed.
    for (const file of ["needs/N-0a0000000001.md", "variants/V-0c0000000001.md"]) {
      await fs.writeFile(ws.path(file), `${await fs.readFile(ws.path(file), "utf8")}Changed.\n`);
    }
    await ws.commit();
    const current = await headDate(ws);
    const { human, json, output } = await checkBoth(ws.root);
    expect([human.code, json.code, human.stderr, json.stderr]).toEqual([1, 1, "", ""]);
    expect(output.ok).toBe(false);
    expect(
      output.problems.map((p) => [
        p.code,
        p.file,
        p.line,
        p.elementId,
        p.targetId,
        p.storedDate,
        p.currentDate,
      ]),
    ).toEqual([
      ["relation.outdated", "requirements/SR-0b0000000001.md", 10, A_ID, V_ID, stored, current],
      ["relation.outdated", "requirements/SR-0b0000000001.md", 12, A_ID, N_ID, stored, current],
      ["relation.outdated", "requirements/SR-0b0000000001.md", 15, A_ID, N_ID, stored, current],
    ]);
    expect(output.problems.map((p) => p.hintId)).toEqual([
      expect.stringMatching(
        new RegExp(
          `^relation\\.outdated/system/requirements%2FSR-0b0000000001\\.md/${A_ID}/validity/${V_ID}\\?version=n1:`,
        ),
      ),
      expect.stringMatching(
        new RegExp(
          `^relation\\.outdated/system/requirements%2FSR-0b0000000001\\.md/${A_ID}/derives-from/${N_ID}\\?version=n1:`,
        ),
      ),
      expect.stringMatching(
        new RegExp(
          `^relation\\.outdated/system/requirements%2FSR-0b0000000001\\.md/${A_ID}/@text/${N_ID}\\?version=n1:.*&n=1$`,
        ),
      ),
    ]);
    expect(human.stdout).toContain(
      `warning  relation.outdated  system:requirements/SR-0b0000000001.md:12  Relation Derives from (derives-from) of System Requirement SR-b0000000001 points to an older version of Need N-a0000000001: stored version from ${stored}, current version from ${current}  (element ${A_ID})\n`,
    );
  });

  it("[SR-019/AK4] [SR-025/AK3] reports a confirmed hint no more, and ends with exit code 0 when nothing else is left", async () => {
    const ws = await fixture("SR-025/outdated", true);
    // The need gets a new text after A's derivation and reference to it were set.
    const need = "needs/N-0a0000000001.md";
    await fs.writeFile(ws.path(need), `${await fs.readFile(ws.path(need), "utf8")}Changed.\n`);
    const first = await checkBoth(ws.root);
    expect([first.human.code, first.json.code]).toEqual([1, 1]);
    const [derives, link] = first.output.problems;
    expect([derives?.line, link?.line]).toEqual([12, 15]);
    // Confirm the derivation: the check reports only the reference.
    const confirmed = await logreq(
      ["hint", "confirm", "--hint-ids", derives?.hintId ?? "", "--json"],
      ws.root,
    );
    expect([confirmed.code, confirmed.stderr]).toEqual([0, ""]);
    const second = await checkBoth(ws.root);
    expect([second.human.code, second.json.code]).toEqual([1, 1]);
    expect(second.output.problems.map((p) => p.hintId)).toEqual([link?.hintId]);
    expect(second.human.stdout).not.toContain("SR-0b0000000001.md:12");
    expect(second.human.stdout).toContain("SR-0b0000000001.md:15");
    // Confirm the reference too: A's text changes, so B's refinement of A is outdated now (ADR-0004).
    await logreq(["hint", "confirm", "--hint-ids", link?.hintId ?? ""], ws.root);
    const third = await checkBoth(ws.root);
    expect(third.output.problems.map((p) => [p.elementId, p.targetId])).toEqual([
      ["5e025a7d-2b4f-4c61-9d08-0b0000000002", A_ID],
    ]);
    // Confirm that one as well: nothing is left, and the check ends with exit code 0.
    await logreq(["hint", "confirm", "--hint-ids", third.output.problems[0]?.hintId ?? ""], ws.root);
    const last = await checkBoth(ws.root);
    expect([last.human.code, last.json.code, last.output]).toEqual([
      0,
      0,
      { ok: true, problems: [], checkedElements: 4 },
    ]);
    expect(last.human.stdout).toBe("ok: true\ncheckedElements: 4\nNo problems.\n");
  });
});

describe("workspace check restricted to a merge request (SR-092)", () => {
  const B_FILE = "requirements/SR-0b0000000002.md";

  it("[SR-092/AK1] reports only the findings of the changed element and its targets with --changed-since", async () => {
    const ws = await fixture("SR-025/outdated", true);
    // On the target branch: B gets a finding of its own; B has nothing to do with N.
    const b = await fs.readFile(ws.path(B_FILE), "utf8");
    await fs.writeFile(ws.path(B_FILE), b.replace("\ntitle: ", "\nodd-key: 1\ntitle: "));
    await ws.commit();
    await ws.git(["tag", "target"]);
    // The merge request changes the need N: A's relation and reference to it are outdated.
    await fs.writeFile(
      ws.path("needs/N-0a0000000001.md"),
      `${await fs.readFile(ws.path("needs/N-0a0000000001.md"), "utf8")}Changed in the merge request.\n`,
    );
    await ws.commit();
    const full = await logreq(["workspace", "check", "--json"], ws.root);
    expect(kinds(JSON.parse(full.stdout) as Output)).toEqual([
      ["element.unknown-property", B_FILE, `${OUTDATED}b0000000002`],
      ["relation.outdated", "requirements/SR-0b0000000001.md", A_ID],
      ["relation.outdated", "requirements/SR-0b0000000001.md", A_ID],
    ]);
    const json = await logreq(["workspace", "check", "--changed-since", "target", "--json"], ws.root);
    expect([json.code, json.stderr]).toEqual([1, ""]);
    const output = JSON.parse(json.stdout) as Output;
    expect(output.problems.map((p) => [p.code, p.elementId, p.targetId])).toEqual([
      ["relation.outdated", A_ID, N_ID],
      ["relation.outdated", A_ID, N_ID],
    ]);
    expect(output.checkedElements).toBe(1);
    // With a file named directly: the same restriction.
    const named = await logreq(
      ["workspace", "check", "--changed-files", "needs/N-0a0000000001.md", "--json"],
      ws.root,
    );
    expect((JSON.parse(named.stdout) as Output).problems).toEqual(output.problems);
    // Nothing changed since HEAD: exit code 0.
    const none = await logreq(["workspace", "check", "--changed-since", "HEAD"], ws.root);
    expect(none).toEqual({ code: 0, stdout: "ok: true\ncheckedElements: 0\nNo problems.\n", stderr: "" });
  });

  it("[SR-092/AK2] says that a commit is not available locally and ends with exit code 4", async () => {
    const ws = await fixture("SR-025/outdated", true);
    const missing = "0123456789abcdef0123456789abcdef01234567";
    const message = `Commit ${missing} is not available locally in any repository of the workspace: fetch it, or deepen a shallow clone`;
    const human = await logreq(["workspace", "check", "--changed-since", missing], ws.root);
    expect(human).toEqual({ code: 4, stdout: "", stderr: `error git.commit-not-found: ${message}\n` });
    const json = await logreq(["workspace", "check", "--changed-since", "no-such-branch", "--json"], ws.root);
    expect(json.code).toBe(4);
    expect(JSON.parse(json.stderr)).toMatchObject({ code: "git.commit-not-found" });
  });
});

// The gaps of verification of workspace.check (SR-230 AK1, AK2, `evidence/gaps.ts`): no evidence location
// while a requirement exists (a warning), else one info with the number of requirements with method test
// whose verification status is open in the core and the `element.list` call that lists exactly them.
// fixtures/SR-126/matrix (its README lists every element and its status) has an evidence location; in the
// core b04 (skipped test) and b06 (no evidence) are open, b10 is obsolete. Cross-access:
// packages/cli/test/cross-access/scenarios/workspace/check.ts.
import fs from "node:fs";
import type { FixtureOptions } from "@reqseq/testkit";
import { createFixtureWorkspace, defaultFixturesDir } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import path from "node:path";
import type { CommandOutput, Problem } from "../../catalog.js";
import { openRequirementsWhere } from "../../evidence/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Output = CommandOutput<"workspace.check">;

const GAPS = new Set(["evidence.no-location", "evidence.open-requirements"]);

const open = async (options: FixtureOptions): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const check = async (workspace: Workspace, input: Readonly<Record<string, unknown>> = {}): Promise<Output> =>
  (await invoke("workspace.check", input, { workspace })) as Output;

/** The gaps of verification among the problems of a check. */
const gaps = (out: Output): Problem[] => out.problems.filter((p) => GAPS.has(p.code));

/** The short IDs `element.list` gives for the `where` and `limit` of an info of AK2, read from its message. */
const listed = async (workspace: Workspace, problem: Problem | undefined): Promise<string[]> => {
  const [, where = "{}", limit] =
    /--where '(.*)'(?: --limit (\d+))? lists them$/.exec(problem?.message ?? "") ?? [];
  const out = (await invoke(
    "element.list",
    {
      selection: { where: JSON.parse(where) as unknown },
      ...(limit === undefined ? {} : { limit: Number(limit) }),
    },
    { workspace },
  )) as CommandOutput<"element.list">;
  return (out.elements ?? []).map((e) => e.shortId);
};

const MATRIX = "SR-126/matrix";
const fixtureFile = (fixture: string, file: string): string =>
  fs.readFileSync(path.join(defaultFixturesDir, fixture, file), "utf8");

/** A system requirement of the matrix without evidence, `b<tail>`, with `more` frontmatter lines. */
const requirement = (tail: string, more: string): string =>
  `---\nid: 5c0e1d2a-0126-4126-8126-000000126b${tail}\ntype: system-requirement\n${more}title: Added ${tail}\n---\n\nNo evidence.\n`;

/**
 * The matrix with b06 verified by inspection (no evidence), b11 with method test, b12 obsolete with
 * method test, b13 with an empty list as method, b14 with a list that holds test (a value of the wrong kind,
 * SR-085, read as the filter reads it), b15 with a list without test: open in the core are b04, b11, b13
 * and b14.
 */
const METHODS: FixtureOptions = {
  fixture: MATRIX,
  files: {
    "requirements/SR-000000126b06.md": fixtureFile(MATRIX, "requirements/SR-000000126b06.md").replace(
      "requirement-type: functional\n",
      "requirement-type: functional\nverification-method: inspection\n",
    ),
    "requirements/SR-000000126b11.md": requirement("11", "status: draft\nverification-method: test\n"),
    "requirements/SR-000000126b12.md": requirement("12", "status: obsolete\nverification-method: test\n"),
    "requirements/SR-000000126b13.md": requirement("13", "status: draft\nverification-method: []\n"),
    "requirements/SR-000000126b14.md": requirement(
      "14",
      "status: draft\nverification-method: [demonstration, test]\n",
    ),
    "requirements/SR-000000126b15.md": requirement("15", "status: draft\nverification-method: [analysis]\n"),
  },
};

const NO_LOCATION =
  'reqseq-workspace: 1\nname: Weather station\nrepositories:\n  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\nmetamodel: { repository: system, path: metamodel }\n';

describe("workspace.check without an evidence location (SR-230 AK1)", () => {
  it("[SR-230/AK-qymg] warns once at the workspace file, naming the entry for an evidence location", async () => {
    const workspace = await open({ fixture: "SR-001/two-elements" });
    const out = await check(workspace);
    expect(gaps(out)).toEqual([
      {
        code: "evidence.no-location",
        severity: "warning",
        file: "reqseq-workspace.yaml",
        message:
          "The workspace file names no evidence location, so no test result counts: add an entry under evidence, such as evidence: [{ repository: system, path: evidence }]",
      },
    ]);
    // A warning: it fails the check only with failOn warning (SR-019 AK2).
    expect(out.ok).toBe(true);
    expect((await check(workspace, { failOn: "warning" })).ok).toBe(false);
  });

  it("[SR-230/AK-qymg] warns with an empty list of evidence locations too", async () => {
    const workspace = await open({
      fixture: "SR-001/two-elements",
      files: { "reqseq-workspace.yaml": `${NO_LOCATION}evidence: []\n` },
    });
    expect(gaps(await check(workspace)).map((p) => p.code)).toEqual(["evidence.no-location"]);
  });

  it("[SR-230/AK-qymg] leaves the warning out of a check restricted to changed elements (SR-092)", async () => {
    const workspace = await open({ fixture: "SR-001/two-elements", git: true });
    expect(gaps(await check(workspace, { changedFiles: ["requirements/SR-6328cee88fb3.md"] }))).toEqual([]);
    expect(gaps(await check(workspace, { changedSince: "HEAD" }))).toEqual([]);
  });

  it("does not warn without a requirement, nor while the metamodel is not valid", async () => {
    const needs = await open({
      files: {
        "reqseq-workspace.yaml": NO_LOCATION,
        "metamodel/standard-model.yaml": fixtureFile(MATRIX, "metamodel/standard-model.yaml"),
        "needs/N-000000126a01.md": fixtureFile(MATRIX, "needs/N-000000126a01.md"),
      },
    });
    expect(gaps(await check(needs))).toEqual([]);
    const broken = await open({
      fixture: "SR-001/two-elements",
      files: { "metamodel/broken.yaml": "properties: [\n" },
    });
    const out = await check(broken);
    expect(out.problems[0]).toMatchObject({ severity: "error", file: "metamodel/broken.yaml" });
    expect(gaps(out)).toEqual([]);
  });

  it("does not warn for a location whose folder does not exist: the workspace file names one", async () => {
    const workspace = await open({
      fixture: "SR-001/two-elements",
      files: {
        "reqseq-workspace.yaml": `${NO_LOCATION}evidence:\n  - { repository: system, path: evidence }\n`,
      },
    });
    const codes = (await check(workspace)).problems.map((p) => p.code);
    expect(codes).toContain("evidence.folder-missing");
    expect(codes).not.toContain("evidence.no-location");
  });
});

describe("workspace.check with requirements whose verification status is open (SR-230 AK2)", () => {
  it("[SR-230/AK-k09q] gives one info at the workspace file with their number and the call that lists exactly them", async () => {
    const workspace = await open({ fixture: MATRIX });
    const out = await check(workspace);
    const where = JSON.stringify(openRequirementsWhere("verification-method"));
    expect(gaps(out)).toEqual([
      {
        code: "evidence.open-requirements",
        severity: "info",
        file: "reqseq-workspace.yaml",
        message: `2 requirement(s) with the verification method test have the verification status open in the core; reqseq element list --where '${where}' lists them`,
      },
    ]);
    expect(out.ok).toBe(true);
    expect((await check(workspace, { failOn: "info" })).ok).toBe(false);
    // b04 (skipped: no execution) and b06 (none); verified, indirect, failed, outdated and obsolete ones not.
    expect(await listed(workspace, gaps(out)[0])).toEqual(["SR-126b04", "SR-126b06"]);
  });

  it("[SR-230/AK-k09q] counts the method test or no value, and no requirement with an invalid status", async () => {
    const workspace = await open(METHODS);
    const [info] = gaps(await check(workspace));
    expect(info?.message.startsWith("4 requirement(s) with the verification method test have")).toBe(true);
    // b06 is verified by inspection, b12 obsolete, b15 verified by analysis.
    expect(await listed(workspace, info)).toEqual(["SR-126b04", "SR-126b11", "SR-126b13", "SR-126b14"]);
  });

  it("[SR-230/AK-k09q] counts every requirement when no property has the meaning verification method", async () => {
    const workspace = await open({
      ...METHODS,
      files: {
        ...METHODS.files,
        "metamodel/standard-model.yaml": fixtureFile(MATRIX, "metamodel/standard-model.yaml").replace(
          "    meaning: verification-method\n",
          "",
        ),
      },
    });
    const [info] = gaps(await check(workspace));
    const where = JSON.stringify(openRequirementsWhere(undefined));
    expect(info?.message).toBe(
      `6 requirement(s) have the verification status open in the core; reqseq element list --where '${where}' lists them`,
    );
    expect(await listed(workspace, info)).toEqual([
      "SR-126b04",
      "SR-126b06",
      "SR-126b11",
      "SR-126b13",
      "SR-126b14",
      "SR-126b15",
    ]);
  });

  it("[SR-230/AK-k09q] leaves the info out of a check restricted to changed elements (SR-092)", async () => {
    const workspace = await open({ fixture: MATRIX, git: true });
    expect(gaps(await check(workspace, { changedFiles: ["requirements/SR-000000126b04.md"] }))).toEqual([]);
    expect(gaps(await check(workspace, { changedSince: "HEAD" }))).toEqual([]);
  });

  it("[SR-230/AK-k09q] names a page that holds them all when they are more than the default page of element.list", async () => {
    // 201 requirements without evidence besides b04 and b06: 203.
    const added = Array.from({ length: 201 }, (_, n): [string, string] => {
      const tail = (0xd00 + n).toString(16);
      return [
        `requirements/SR-000000126${tail}.md`,
        `---\nid: 5c0e1d2a-0126-4126-8126-000000126${tail}\ntype: system-requirement\nstatus: draft\ntitle: Added ${tail}\n---\n`,
      ];
    });
    const workspace = await open({ fixture: MATRIX, files: Object.fromEntries(added) });
    const [info] = gaps(await check(workspace));
    expect(info?.message.startsWith("203 requirement(s)")).toBe(true);
    expect(info?.message.endsWith("' --limit 203 lists them")).toBe(true);
    expect(await listed(workspace, info)).toHaveLength(203);
  });

  it("gives no info when no requirement with method test is open", async () => {
    const workspace = await open({
      fixture: MATRIX,
      files: Object.fromEntries(
        ["b04", "b06"].map((tail) => {
          const file = `requirements/SR-000000126${tail}.md`;
          return [
            file,
            fixtureFile(MATRIX, file).replace(
              "requirement-type: functional\n",
              "requirement-type: functional\nverification-method: analysis\n",
            ),
          ];
        }),
      ),
    });
    expect(gaps(await check(workspace))).toEqual([]);
  });
});

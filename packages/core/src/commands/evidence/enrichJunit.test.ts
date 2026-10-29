// evidence.enrichJunit through `invoke` (SR-029) on fixtures/SR-029/enrich: one repository `system`
// with SR-46fb54, SR-0b0036, SR-0c0037 and SR-0d0038 (identifier SR-036), an empty evidence folder
// `evidence/` and the result files in `results/` (see the fixture's README). The same output on every
// access: packages/cli/test/cross-access.test.ts; the CLI: packages/cli/test/e2e/evidence-enrich-junit.test.ts.
import { writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { evidenceReadState, evidenceRecordsState, readJunitRecords } from "../../evidence/index.js";
import { resolverOf } from "../../evidence/enrich.js";
import { junitTestCases } from "../../evidence/junit-model.js";
import type { ElementRecord } from "../../model/index.js";
import { elementStoreState } from "../../model/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Output = CommandOutput<"evidence.enrichJunit">;

const LOGIN = "0b9e7a3c-1d2f-4a5b-8c6d-825b7146fb54";
const REPORT = "93000000-0000-4000-8000-0000000b0036";
const LOG = "93000000-0000-4000-8000-0000000c0037";
const SPEC = "29000000-0000-4000-8000-0000000d0038";
const DATE = "2026-10-27T10:00:00Z";

const open = async (
  files: Readonly<Record<string, string>> = {},
): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-029/enrich", files });
  const workspace = new Workspace(fixture.root);
  onTestFinished(async () => {
    await workspace.close();
    await fixture.cleanup();
  });
  return { fixture, workspace };
};

const enrich = (workspace: Workspace, input: Record<string, unknown>): Promise<Output> =>
  invoke(
    "evidence.enrichJunit",
    { item: "build-512", date: DATE, ...input },
    { workspace },
  ) as Promise<Output>;

const failure = async (workspace: Workspace, input: Record<string, unknown>): Promise<CommandError> => {
  try {
    await enrich(workspace, input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a CommandError");
};

const bytesOf = (fixture: FixtureWorkspace, file: string): Promise<Buffer> => fs.readFile(fixture.path(file));

/** Each test case of a JUnit file with its `reqseq:*` properties as `name=value`. */
const properties = (bytes: Uint8Array): [string, string[]][] => {
  const read = junitTestCases(bytes);
  if (read.kind !== "junit") {
    throw new Error(`expected JUnit, got ${read.kind}`);
  }
  return read.file.testCases.map((t) => [
    t.name,
    t.properties.filter((p) => p.name.startsWith("reqseq:")).map((p) => `${p.name}=${p.value}`),
  ]);
};

/** The test cases with UUID, version, item and date (N1: the set must be exactly those that name a requirement). */
const enrichedNames = (bytes: Uint8Array): string[] =>
  properties(bytes)
    .filter(([, list]) =>
      ["reqseq:element=", "reqseq:version=", "reqseq:item=build-512", `reqseq:date=${DATE}`].every((start) =>
        list.some((p) => p.startsWith(start)),
      ),
    )
    .map(([name]) => name);

/** The records the reader gives for a file, as [test case, element]. */
const recordsOf = (bytes: Uint8Array): [string | undefined, string][] =>
  readJunitRecords({ repository: "system", file: "x.xml" }, bytes).records.map((r) => [
    r.testCase,
    r.element,
  ]);

describe("evidence.enrichJunit (SR-029)", () => {
  it("[SR-029/AK1] enriches the pytest and Vitest files of the real tools: each test case that names a requirement has UUID, version, item and date", async () => {
    const { fixture, workspace } = await open();
    const pytest = await enrich(workspace, { file: "results/pytest.xml" });
    expect(pytest).toEqual({ testCases: 3, unknown: [], files: ["results/pytest.xml"], problems: [] });
    const pytestBytes = await bytesOf(fixture, "results/pytest.xml");
    expect(enrichedNames(pytestBytes)).toEqual([
      "test_login_by_property",
      "test_named[SR-46fb54]",
      "test_named[SR-036]",
    ]);
    expect(recordsOf(pytestBytes)).toEqual([
      ["test_login_by_property", LOGIN],
      ["test_named[SR-46fb54]", LOGIN],
      ["test_named[SR-036]", SPEC],
    ]);
    const vitest = await enrich(workspace, { file: "results/vitest.xml" });
    expect(vitest).toEqual({ testCases: 2, unknown: [], files: ["results/vitest.xml"], problems: [] });
    const vitestBytes = await bytesOf(fixture, "results/vitest.xml");
    expect(enrichedNames(vitestBytes)).toEqual([
      "login > [SR-46fb54/AK1] accepts a valid password",
      "login > [SR-036] reports a failure",
    ]);
    // The parameter lists stay as they were.
    expect(properties(vitestBytes).filter(([name]) => name.startsWith("login > adds"))).toEqual([
      ["login > adds [1, 2]", []],
      ["login > adds [3, 4]", []],
    ]);
  });

  it("[SR-029/AK2] reports each test case with an unknown short ID as an error and still enriches the known ones", async () => {
    const { fixture, workspace } = await open();
    const output = await enrich(workspace, { file: "results/unknown.xml" });
    expect(output.unknown).toEqual([
      { testCase: "[SR-ffffff] names no element", className: "station", line: 4, ref: "SR-ffffff" },
      { testCase: "a typo in the property", className: "station", line: 5, ref: "SR-0366" },
    ]);
    expect(output.problems.map((p) => [p.code, p.severity, p.file, p.line, p.message])).toEqual([
      [
        "evidence.unknown-element",
        "error",
        "results/unknown.xml",
        4,
        'Test case "[SR-ffffff] names no element" (line 4): no element has the reference "SR-ffffff"',
      ],
      [
        "evidence.unknown-element",
        "error",
        "results/unknown.xml",
        5,
        'Test case "a typo in the property" (line 5): no element has the reference "SR-0366"',
      ],
    ]);
    // The file is written with the known test case enriched (spec question #529 Q1).
    expect(output).toMatchObject({ testCases: 1, files: ["results/unknown.xml"] });
    expect(enrichedNames(await bytesOf(fixture, "results/unknown.xml"))).toEqual(["[SR-46fb54] logs in"]);
  });

  it("[SR-029/AK3] the same workspace reads the enriched file from its evidence folder without a reset", async () => {
    const { fixture, workspace } = await open();
    expect(await workspace.get(evidenceRecordsState)).toEqual([]);
    const before = await bytesOf(fixture, "results/two.xml");
    const output = await enrich(workspace, { file: "results/two.xml", output: "evidence/ci/two.xml" });
    expect(output).toEqual({ testCases: 3, unknown: [], files: ["evidence/ci/two.xml"], problems: [] });
    // The input stays as it was; the evidence folder now holds the records.
    expect(await bytesOf(fixture, "results/two.xml")).toEqual(before);
    const records = await workspace.get(evidenceRecordsState);
    expect(records.map((r) => [r.testCase, r.element, r.result, r.file])).toEqual([
      ["[SR-0b0036] [SR-0c0037] reports a failure", REPORT, "failed", "evidence/ci/two.xml"],
      ["[SR-0b0036] [SR-0c0037] reports a failure", LOG, "failed", "evidence/ci/two.xml"],
      ["[SR-46fb54] logs in", LOGIN, "passed", "evidence/ci/two.xml"],
    ]);
    expect(new Set(records.map((r) => r.version)).size).toBe(3);
    expect((await workspace.get(evidenceReadState)).skipped.map((s) => s.name)).toEqual([
      "[SR-46fb54] is skipped",
    ]);
  });

  it("keeps the byte order mark and CRLF of a hand-written file, and takes the time of the call for a suite timestamp without time zone", async () => {
    const { fixture, workspace } = await open();
    const output = await enrich(workspace, { file: "results/two.xml", date: undefined });
    expect(output.files).toEqual(["results/two.xml"]);
    const after = await bytesOf(fixture, "results/two.xml");
    expect([...after.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    // Nine lines as before, each ending in CRLF: the properties are written on the line of the test case.
    expect(after.toString("utf8").split("\r\n")).toHaveLength(10);
    expect(after.toString("utf8").replaceAll("\r\n", "")).not.toContain("\n");
    const dates = properties(after).flatMap(([, list]) => list.filter((p) => p.startsWith("reqseq:date=")));
    expect(dates).toHaveLength(3);
    for (const date of dates) {
      expect(Math.abs(Date.parse(date.slice("reqseq:date=".length)) - Date.now())).toBeLessThan(60_000);
    }
  });

  it("refuses an in-place enrich when the input changed after it was read, and keeps the change (N5 of the PR #584 review)", async () => {
    const { fixture, workspace } = await open();
    const file = fixture.path("results/pytest.xml");
    const changed = Buffer.concat([await fs.readFile(file), Buffer.from("<!-- changed meanwhile -->\n")]);
    // The store is first asked after the input is read: the input changes right then, before the write.
    const store = workspace.get(elementStoreState);
    let armed = false;
    const changing = new Proxy(await store, {
      get: (target, key, receiver): unknown => {
        if (armed) {
          armed = false;
          writeFileSync(file, changed);
        }
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    expect(await workspace.replace(elementStoreState, store, Promise.resolve(changing))).toBe(true);
    armed = true;
    const error = await failure(workspace, { file: "results/pytest.xml" });
    expect([error.code, armed]).toEqual(["file.changed-on-disk", false]);
    expect(await fs.readFile(file)).toEqual(changed);
  });

  it("is refused with workspace.read-only while the metamodel is faulty, and writes nothing (#142 point b)", async () => {
    const { fixture, workspace } = await open({
      "metamodel/broken.yaml": "reqseq-metamodel: 1\ntypes: [ { key: x } ]\n",
    });
    const before = await bytesOf(fixture, "results/pytest.xml");
    expect((await failure(workspace, { file: "results/pytest.xml" })).code).toBe("workspace.read-only");
    expect(await bytesOf(fixture, "results/pytest.xml")).toEqual(before);
  });

  it("replaces an existing JUnit output, and refuses one that is no JUnit file or no XML, leaving it unchanged", async () => {
    const { fixture, workspace } = await open({
      "evidence/ci/old.xml": "<testsuites/>",
      "pom.xml": "<project/>",
      "README.md": "# not XML\n",
    });
    expect(
      (await enrich(workspace, { file: "results/vitest.xml", output: "evidence/ci/old.xml" })).files,
    ).toEqual(["evidence/ci/old.xml"]);
    expect(enrichedNames(await bytesOf(fixture, "evidence/ci/old.xml"))).toHaveLength(2);
    for (const output of ["pom.xml", "README.md"]) {
      const before = await bytesOf(fixture, output);
      const error = await failure(workspace, { file: "results/vitest.xml", output });
      expect([error.code, error.message]).toEqual([
        "file.faulty",
        `Not written: ${output} is not a JUnit XML file; ReqSeq replaces only JUnit files`,
      ]);
      expect(await bytesOf(fixture, output)).toEqual(before);
    }
    await fs.symlink(fixture.path("evidence/ci/old.xml"), fixture.path("evidence/ci/link.xml"));
    const linked = await failure(workspace, { file: "results/vitest.xml", output: "evidence/ci/link.xml" });
    expect([linked.code, linked.message]).toEqual([
      "file.faulty",
      "Not written: link.xml cannot be replaced: Cannot read file: it is a symbolic link; ReqSeq does not follow links to its files",
    ]);
  });

  it("refuses an input that is missing, a link, not JUnit or not well-formed, and writes nothing", async () => {
    const { fixture, workspace } = await open({
      "results/pom.xml": "<project/>",
      "results/broken.xml": "<testsuites>\n<testsuite>\n",
    });
    await fs.symlink(fixture.path("results/pytest.xml"), fixture.path("results/link.xml"));
    const cases: [string, string, string][] = [
      ["results/gone.xml", "input.invalid", "The file gone.xml does not exist"],
      [
        "results/link.xml",
        "input.invalid",
        "Cannot enrich link.xml: Cannot read file: it is a symbolic link; ReqSeq does not follow links to its files",
      ],
      [
        "results/pom.xml",
        "input.invalid",
        "pom.xml is not a JUnit XML file: its root is <project>, not <testsuites> or <testsuite>",
      ],
    ];
    for (const [file, code, message] of cases) {
      const error = await failure(workspace, { file });
      expect([file, error.code, error.message]).toEqual([file, code, message]);
    }
    const broken = await failure(workspace, { file: "results/broken.xml" });
    expect([broken.code, broken.details]).toEqual(["file.faulty", { file: "broken.xml", line: 2 }]);
    expect((await bytesOf(fixture, "results/broken.xml")).toString("utf8")).toBe(
      "<testsuites>\n<testsuite>\n",
    );
  });

  it("writes a file outside the workspace and gives its absolute path, leaving the input unchanged", async () => {
    const { fixture, workspace } = await open();
    const outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-enrich-")));
    onTestFinished(() => fs.rm(outside, { recursive: true, force: true }));
    const target = path.join(outside, "enriched.xml");
    const before = await bytesOf(fixture, "results/pytest.xml");
    const output = await enrich(workspace, { file: "results/pytest.xml", output: target });
    expect(output.files).toEqual([target]);
    expect(enrichedNames(await fs.readFile(target))).toHaveLength(3);
    expect(await bytesOf(fixture, "results/pytest.xml")).toEqual(before);
    // An input outside the workspace is named by its absolute path in the problems.
    await fs.writeFile(path.join(outside, "unknown.xml"), await bytesOf(fixture, "results/unknown.xml"));
    const unknown = await enrich(workspace, { file: path.join(outside, "unknown.xml") });
    expect(new Set(unknown.problems.map((p) => p.file))).toEqual(
      new Set([path.join(outside, "unknown.xml")]),
    );
    expect(unknown.files).toEqual([path.join(outside, "unknown.xml")]);
  });

  it("never writes into a .git folder, in any case and through a linked folder (D-036)", async () => {
    const { fixture, workspace } = await open({ ".git/results.xml": "<testsuites/>", ".GIT/x/keep": "" });
    await fs.symlink(fixture.path(".git"), fixture.path("results/hooks"));
    for (const input of [
      { file: ".git/results.xml" },
      { file: "results/pytest.xml", output: ".GIT/x/out.xml" },
      { file: "results/pytest.xml", output: "results/hooks/out.xml" },
    ]) {
      const error = await failure(workspace, input);
      expect([error.code, error.details?.["reason"]]).toEqual(["input.invalid", "git-folder"]);
    }
    // On a case-insensitive file system (macOS, Windows) `.GIT/x` is the folder `x` inside `.git`.
    const inGit = (await fs.readdir(fixture.path(".git"))).filter((name) => name !== "x");
    expect(inGit).toEqual(["results.xml"]);
    expect(await fs.readdir(fixture.path(".GIT/x"))).toEqual(["keep"]);
  });

  it("refuses an output whose folder does not exist (file.folder-missing)", async () => {
    const { workspace } = await open();
    const error = await failure(workspace, { file: "results/pytest.xml", output: "nowhere/out.xml" });
    expect([error.code, error.message]).toEqual([
      "file.folder-missing",
      "Not written: the folder of out.xml does not exist",
    ]);
  });

  it("writes nothing when nothing changes: files is empty and the file keeps its time", async () => {
    const { fixture, workspace } = await open();
    await enrich(workspace, { file: "results/vitest.xml" });
    const { mtimeMs } = await fs.stat(fixture.path("results/vitest.xml"));
    const again = await enrich(workspace, { file: "results/vitest.xml", item: "build-513" });
    expect(again).toEqual({ testCases: 2, unknown: [], files: [], problems: [] });
    expect((await fs.stat(fixture.path("results/vitest.xml"))).mtimeMs).toBe(mtimeMs);
  });

  it("writes the input unchanged to a new output when nothing changes: an enriched input and one that names nothing", async () => {
    const { fixture, workspace } = await open({
      "results/plain.xml":
        '<testsuites><testsuite name="s"><testcase name="test_add[1-2]"/></testsuite></testsuites>\n',
    });
    await enrich(workspace, { file: "results/vitest.xml" });
    const enriched = await bytesOf(fixture, "results/vitest.xml");
    expect(await workspace.get(evidenceRecordsState)).toEqual([]);
    const again = await enrich(workspace, { file: "results/vitest.xml", output: "evidence/ci/vitest.xml" });
    expect(again).toEqual({ testCases: 2, unknown: [], files: ["evidence/ci/vitest.xml"], problems: [] });
    expect(await bytesOf(fixture, "evidence/ci/vitest.xml")).toEqual(enriched);
    expect((await workspace.get(evidenceRecordsState)).map((r) => r.element)).toEqual([LOGIN, SPEC]);
    const plain = await enrich(workspace, { file: "results/plain.xml", output: "evidence/ci/plain.xml" });
    expect(plain).toEqual({ testCases: 0, unknown: [], files: ["evidence/ci/plain.xml"], problems: [] });
    expect(await bytesOf(fixture, "evidence/ci/plain.xml")).toEqual(
      await bytesOf(fixture, "results/plain.xml"),
    );
  });

  it("writes nothing when the output already holds the same bytes", async () => {
    const { fixture, workspace } = await open();
    await enrich(workspace, { file: "results/vitest.xml", output: "evidence/ci/vitest.xml" });
    const { mtimeMs } = await fs.stat(fixture.path("evidence/ci/vitest.xml"));
    const again = await enrich(workspace, { file: "results/vitest.xml", output: "evidence/ci/vitest.xml" });
    expect(again).toEqual({ testCases: 2, unknown: [], files: [], problems: [] });
    expect((await fs.stat(fixture.path("evidence/ci/vitest.xml"))).mtimeMs).toBe(mtimeMs);
  });

  it("refuses an item that is blank, padded or holds a control character, and keeps tab, line feed and & < \" ' unchanged", async () => {
    const { fixture, workspace } = await open();
    for (const item of ["", "  ", " build", "build ", "a\u0001b"]) {
      expect([item, (await failure(workspace, { file: "results/vitest.xml", item })).code]).toEqual([
        item,
        "input.invalid",
      ]);
    }
    const item = "build\t1\n& <x> \"q\" 'a'";
    await enrich(workspace, { file: "results/vitest.xml", item });
    const read = readJunitRecords(
      { repository: "system", file: "x.xml" },
      await bytesOf(fixture, "results/vitest.xml"),
    );
    expect(read.records.map((r) => r.item)).toEqual([item, item]);
  });

  it("reports an element whose file no longer holds it as having no current version, and leaves its test case unchanged", async () => {
    const { fixture, workspace } = await open();
    await workspace.get(elementStoreState);
    await fixture.write(
      "requirements/SR-0000000c0037.md",
      "---\nid: 29000000-0000-4000-8000-0000000c0099\ntype: system-requirement\ntitle: Other\n---\n",
    );
    const output = await enrich(workspace, { file: "results/two.xml" });
    expect(output.problems.map((p) => [p.code, p.elementId, p.line])).toEqual([["file.faulty", LOG, 5]]);
    expect(output.testCases).toBe(2);
    const after = properties(await bytesOf(fixture, "results/two.xml"));
    expect(after[0]).toEqual(["[SR-0b0036] [SR-0c0037] reports a failure", []]);
  });

  it("reports a reference that names several copies of one UUID with the candidates, and notes a repository that is not on this machine", async () => {
    const workspaceFile = [
      "reqseq-workspace: 1",
      "name: Enrich JUnit",
      "repositories:",
      '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }',
      '  - { name: sensor, url: "git@git.example.com:ws/sensor.git" }',
      "metamodel: { repository: system, path: metamodel }",
      "evidence:",
      "  - { repository: system, path: evidence }",
      "",
    ].join("\n");
    const { fixture, workspace } = await open({ "reqseq-workspace.yaml": workspaceFile });
    await fs.mkdir(fixture.path("copy"));
    await fs.copyFile(
      fixture.path("requirements/SR-825b7146fb54.md"),
      fixture.path("copy/SR-825b7146fb54.md"),
    );
    const output = await enrich(workspace, { file: "results/unknown.xml" });
    expect(output.problems.map((p) => [p.code, p.line, p.message])).toEqual([
      [
        "evidence.unknown-element",
        4,
        'Test case "[SR-ffffff] names no element" (line 4): no element has the reference "SR-ffffff"; the workspace is incomplete, the element may lie in a repository that is not on this machine (sensor)',
      ],
      ["evidence.unknown-element", 5, expect.stringContaining('"SR-0366"; the workspace is incomplete')],
      [
        "evidence.ambiguous-element",
        10,
        `Test case "[SR-46fb54] logs in" (line 10): "SR-46fb54" names more than one element (${LOGIN} in system/copy/SR-825b7146fb54.md, ${LOGIN} in system/requirements/SR-825b7146fb54.md); give the full UUID`,
      ],
    ]);
    expect(output.files).toEqual([]);
  });

  it("passes on an error of the resolver other than ref.unknown and ref.ambiguous", () => {
    const failing = (): ElementRecord => {
      throw new CommandError("internal", "broken store");
    };
    expect(() => resolverOf(failing, new Map())("SR-46fb54")).toThrow("broken store");
  });
});

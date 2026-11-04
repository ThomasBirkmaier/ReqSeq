// A generated workspace for the timing of SR-111 AK6 (a graph of 500 nodes is laid out within a second),
// on top of fixtures/SR-111/graph (its metamodel and workspace file). It has three packages, each the
// root of a graph of exactly 500 nodes at depth 1, so each open is a new graph on a different root:
// - 24 decisions the package is based on, in three layers (the second eight are based on the first
//   eight, the third on the second);
// - 475 system requirements in the package: 300 only name it, 100 derive from one of those, 50 derive
//   from one of the 100 and from one of the 300 (a diamond), 25 derive from one of the 50; every tenth
//   is also based on one of the decisions, a long link past the package. So the graph has eight drawn
//   layers and about 790 links, not easier than real data.
// Every member has one passed JUnit test case (`evidence/ci/run.xml`, the evidence location of the
// workspace file), so with the evidence (SR-111 AK3) its graph has 475 evidence boxes besides its nodes.
// Every link stores the current version of its target, as in a real workspace: the files are written
// with an old version, and `reqseq hint confirm` writes the current ones (SR-027), so `trace.graph`
// computes the versions of the targets for its `outdated` mark as it does on real data.
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const FIXTURE = fileURLToPath(new URL("../../../../fixtures/SR-111/graph/", import.meta.url));
const CLI = fileURLToPath(new URL("../../../cli/dist/bin.js", import.meta.url));

const OLD = "n1:0000000000000000";
const DECISIONS = 24;
/** Titles no member title contains, so that Ctrl+P finds the package first. */
const PACKAGE_TITLES = ["Anemometer", "Rain gauge", "Thermometer"];
const MEMBERS = 475;

export interface GraphFixture {
  /** The workspace folder (launchApp copies it). */
  readonly folder: string;
  /** The three packages: UUID and title. */
  readonly roots: readonly { readonly id: string; readonly title: string }[];
  cleanup(): Promise<void>;
}

const uuid = (root: number, kind: number, index: number): string =>
  `5e111a7d-2b4f-4c61-9d08-${String(root)}${String(kind)}${index.toString(16).padStart(10, "0")}`;

const link = (id: string, title: string): string => `  - { id: ${id}, version: ${OLD}, title: ${title} }`;

const decisionFile = (root: number, index: number): string => {
  const below =
    index >= 8 ? [`based-on:`, link(uuid(root, 1, index - 8), `Decision ${String(index - 8)}`)] : [];
  return [
    "---",
    `id: ${uuid(root, 1, index)}`,
    "type: decision",
    "status: approved",
    `title: Decision ${String(index)}`,
    ...below,
    "---",
    `Decision ${String(index)} of package ${String(root)}.`,
    "",
  ].join("\n");
};

/** The members a member derives from (indices), by the tiers of the header. */
const parentsOf = (index: number): number[] => {
  if (index < 300) {
    return [];
  }
  if (index < 400) {
    return [index - 300];
  }
  if (index < 450) {
    return [index - 100, index - 400];
  }
  return [index - 50];
};

const memberFile = (root: number, index: number, packageTitle: string): string => {
  const derives = parentsOf(index);
  return [
    "---",
    `id: ${uuid(root, 2, index)}`,
    "type: system-requirement",
    "status: draft",
    `title: Requirement ${String(index)} of the package ${String(root)}`,
    "requirement-type: functional",
    "acceptance-criteria:",
    "  - Given the station runs, then it works.",
    "packages:",
    link(uuid(root, 0, 0), packageTitle),
    ...(derives.length === 0
      ? []
      : [
          "derives-from:",
          ...derives.map((parent) => link(uuid(root, 2, parent), `Requirement ${String(parent)}`)),
        ]),
    ...(index % 10 === 0
      ? ["based-on:", link(uuid(root, 1, index % DECISIONS), `Decision ${String(index % DECISIONS)}`)]
      : []),
    "---",
    `Requirement ${String(index)}.`,
    "",
  ].join("\n");
};

const packageFile = (root: number, title: string): string =>
  [
    "---",
    `id: ${uuid(root, 0, 0)}`,
    "type: package",
    "status: draft",
    `title: ${title}`,
    "based-on:",
    ...Array.from({ length: DECISIONS }, (_, index) =>
      link(uuid(root, 1, index), `Decision ${String(index)}`),
    ),
    "---",
    "",
  ].join("\n");

export const cli = async (folder: string, argv: readonly string[]): Promise<string> =>
  (
    await execFileAsync(process.execPath, [CLI, ...argv, "--workspace", folder, "--json"], {
      maxBuffer: 256 * 1024 * 1024,
    })
  ).stdout;

/**
 * Writes `evidence/ci/run.xml` into the workspace `folder`: one passed JUnit test case per element of
 * `ids` (UUIDs), named by its `reqseq:element` property with its current version (a test case without
 * one gives no record), in the evidence location of fixtures/SR-111/graph. Call it once the links hold
 * their current versions: confirming them changes the versions of the elements that store them.
 */
export const writeEvidence = async (folder: string, ids: readonly string[]): Promise<void> => {
  const listed = JSON.parse(await cli(folder, ["element", "list", "--limit", "5000", "--no-with-text"])) as {
    readonly elements: readonly { readonly id: string; readonly version?: string }[];
  };
  const versions = new Map(listed.elements.map((element) => [element.id, element.version ?? ""]));
  const cases = ids.map((id, index) =>
    [
      `    <testcase classname="tests.generated" name="test_${String(index)}" time="0.001">`,
      "      <properties>",
      `        <property name="reqseq:element" value="${id}"/>`,
      `        <property name="reqseq:version" value="${versions.get(id) ?? ""}"/>`,
      '        <property name="reqseq:item" value="build-1"/>',
      '        <property name="reqseq:date" value="2026-10-21T09:00:00Z"/>',
      "      </properties>",
      "    </testcase>",
    ].join("\n"),
  );
  await fs.mkdir(path.join(folder, "evidence", "ci"), { recursive: true });
  await fs.writeFile(
    path.join(folder, "evidence", "ci", "run.xml"),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<testsuites>",
      `  <testsuite name="generated" tests="${String(ids.length)}" failures="0" errors="0" skipped="0">`,
      ...cases,
      "  </testsuite>",
      "</testsuites>",
      "",
    ].join("\n"),
  );
};

/** Writes the workspace and stores the current versions in its links. */
export const writeGraphFixture = async (): Promise<GraphFixture> => {
  const top = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-graph-fixture-")));
  const folder = path.join(top, "workspace");
  await fs.mkdir(folder);
  await fs.cp(path.join(FIXTURE, "metamodel"), path.join(folder, "metamodel"), { recursive: true });
  await fs.copyFile(path.join(FIXTURE, "reqseq-workspace.yaml"), path.join(folder, "reqseq-workspace.yaml"));
  const roots = [1, 2, 3].map((root) => ({
    id: uuid(root, 0, 0),
    title: PACKAGE_TITLES[root - 1] ?? "",
  }));
  for (const [at, root] of roots.entries()) {
    const number = at + 1;
    for (const kind of ["packages", "decisions", "requirements"]) {
      await fs.mkdir(path.join(folder, kind, String(number)), { recursive: true });
    }
    await fs.writeFile(
      path.join(folder, "packages", String(number), "PKG.md"),
      packageFile(number, root.title),
    );
    for (let index = 0; index < DECISIONS; index += 1) {
      await fs.writeFile(
        path.join(folder, "decisions", String(number), `D-${String(index)}.md`),
        decisionFile(number, index),
      );
    }
    for (let index = 0; index < MEMBERS; index += 1) {
      await fs.writeFile(
        path.join(folder, "requirements", String(number), `SR-${String(index)}.md`),
        memberFile(number, index, root.title),
      );
    }
  }
  const hints = JSON.parse(
    await cli(folder, ["hint", "list", "--input", '{"kind":["relation.outdated"]}']),
  ) as {
    readonly hints: readonly { readonly hintId?: string }[];
  };
  const hintIds = hints.hints.flatMap((hint) => (hint.hintId === undefined ? [] : [hint.hintId]));
  // Too long for a command line: the input goes in a file next to the workspace.
  const input = path.join(top, "confirm.json");
  await fs.writeFile(input, JSON.stringify({ hintIds }));
  await cli(folder, ["hint", "confirm", "--input", `@${input}`]);
  await writeEvidence(
    folder,
    roots.flatMap((_, at) => Array.from({ length: MEMBERS }, (_unused, index) => uuid(at + 1, 2, index))),
  );
  return { folder, roots, cleanup: () => fs.rm(top, { recursive: true, force: true, maxRetries: 3 }) };
};

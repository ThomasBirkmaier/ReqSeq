// The affected elements of the trace block (SR-024): the walk over the incoming index with its edge
// cases (relations to itself, cycles, repositories, shared UUIDs) and the evidence seam (AK4, #127
// option 1). The command on the SR-024 fixture: commands/trace/affected.test.ts.
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { STANDARD_MODEL_TEXT } from "../metamodel/standard-model.js";
import type { ElementRecord } from "../model/index.js";
import { directLinks, directlyAffectedCount, elementStoreState, shortIdState } from "../model/index.js";
import { Workspace } from "../runtime/workspace.js";
import type { AffectedRecord } from "./affected.js";
import { affectedOutput, traceAffected } from "./affected.js";
import type { DerivationGraph } from "./graph.js";
import { derivationGraph, traceContext } from "./graph.js";

const V = "n1:1111111111111111";
const OLD = "n1:2222222222222222";
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const N1 = uuid(1);
const S1 = uuid(2);
const S2 = uuid(3);
const S3 = uuid(4);
const DUP = uuid(5);
const P1 = uuid(6);
const P2 = uuid(7);
const T1 = uuid(8);

const element = (id: string, type: string, frontmatter: readonly string[] = [], text = ""): string =>
  ["---", `id: ${id}`, `type: ${type}`, "status: draft", "title: T", ...frontmatter, "---", text].join("\n");

const FILES = {
  "system/reqseq-workspace.yaml": [
    "reqseq-workspace: 1",
    "name: Trace",
    "repositories:",
    "  - { name: system, url: git@example.com:system.git, main: true }",
    "  - { name: platform, url: git@example.com:platform.git, path: ../platform }",
    "metamodel: { repository: system, path: metamodel }",
    "",
  ].join("\n"),
  "system/metamodel/standard-model.yaml": STANDARD_MODEL_TEXT,
  "system/needs/N-000000000001.md": element(N1, "need"),
  // A relation and a reference to itself, and a derivation that closes a cycle with S2.
  "system/requirements/SR-000000000002.md": element(
    S1,
    "system-requirement",
    [
      `derives-from:\n  - { id: ${N1}, version: ${V} }\n  - { id: ${S1}, version: ${V} }\n  - { id: ${S2}, version: ${V} }`,
    ],
    `See [myself](reqseq:${S1}?version=${V}).\n`,
  ),
  // Points at S1 twice (a relation and a reference): one affected element.
  "system/requirements/SR-000000000003.md": element(
    S2,
    "system-requirement",
    [`derives-from:\n  - { id: ${S1}, version: ${V} }`],
    `Follows [S1](reqseq:${S1}?version=${V}).\n`,
  ),
  // Refines (another relation kind with the meaning derivation) S2.
  "system/requirements/SR-000000000004.md": element(S3, "system-requirement", [
    `refines:\n  - { id: ${S2}, version: ${V} }`,
  ]),
  // Two files with one UUID (SR-088), and an element that points at that UUID.
  "system/needs/N-000000000005.md": element(DUP, "need"),
  "system/needs/copy/N-000000000005.md": element(DUP, "need"),
  "system/requirements/SR-000000000008.md": element(T1, "system-requirement", [
    `derives-from:\n  - { id: ${DUP}, version: ${V} }`,
  ]),
  // A child in another repository, and one that names N1's UUID in its own repository.
  "platform/requirements/SR-000000000006.md": element(P1, "system-requirement", [
    `derives-from:\n  - { id: ${S2}, version: ${V}, repository: system }`,
  ]),
  "platform/requirements/SR-000000000007.md": element(P2, "system-requirement", [
    `derives-from:\n  - { id: ${N1}, version: ${V} }`,
  ]),
};

interface Opened {
  readonly workspace: Workspace;
  readonly graph: DerivationGraph;
  readonly record: (id: string, file?: string) => ElementRecord;
}

const open = async (files: Readonly<Record<string, string>> = FILES): Promise<Opened> => {
  const fixture = await createFixtureWorkspace({ files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.path("system"));
  onTestFinished(() => workspace.close());
  const graph = derivationGraph(await traceContext(workspace), "trace.affected");
  const store = await workspace.get(elementStoreState);
  const record = (id: string, file?: string): ElementRecord => {
    const found = (store.byId.get(id) ?? []).find((r) => file === undefined || r.file === file);
    if (found === undefined) {
      throw new Error(`no element ${id}`);
    }
    return found;
  };
  return { workspace, graph, record };
};

const output = async (opened: Opened, start: ElementRecord, records?: readonly AffectedRecord[]) =>
  affectedOutput(
    traceAffected(opened.graph, start, records === undefined ? {} : { evidence: { version: V, records } }),
    { metamodel: opened.graph.metamodel, shortIds: await opened.workspace.get(shortIdState) },
    { limit: 200, offset: 0 },
  );

const sys = (id: string): { id: string; repository: string } => ({ id, repository: "system" });

const record = (version: string, extra: Partial<AffectedRecord> = {}): AffectedRecord => ({
  element: S1,
  version,
  kind: "verification",
  method: "test",
  item: "build-1",
  result: "passed",
  date: "2026-10-20T10:00:00Z",
  ...extra,
});

describe("affected elements (SR-024)", () => {
  it("[SR-024/AK1] leaves out the element itself, its relations to itself and a cycle back to it", async () => {
    const opened = await open();
    const out = await output(opened, opened.record(S1));
    expect(out.affected.map((a) => [a.id, a.distance, a.path, a.via])).toEqual([
      [S2, 1, [sys(S1), sys(S2)], { kind: "relation", key: "derives-from" }],
      [S3, 2, [sys(S1), sys(S2), sys(S3)], { kind: "relation", key: "refines" }],
      // A child in another repository: the path names the repository of each element (D-058).
      [
        P1,
        2,
        [sys(S1), sys(S2), { id: P1, repository: "platform" }],
        { kind: "relation", key: "derives-from" },
      ],
    ]);
    expect(out.total).toBe(3);
    // S2 points at S1 with a relation and a reference: one affected element.
    expect(directLinks(opened.graph.incoming, opened.record(S1)).map((l) => [l.source.id, l.kind])).toEqual([
      [S2, "relation"],
      [S2, "reference"],
    ]);
    expect(directlyAffectedCount(opened.graph.incoming, opened.record(S1))).toBe(1);
    // S1 derives from S2, which derives from S1: the walk reaches S1 again and keeps it the start.
    const walked = traceAffected(opened.graph, opened.record(S1));
    expect([...walked.reached.values()].map((n) => [n.element.id, n.depth])).toEqual([
      [S1, 0],
      [S2, 1],
      [S3, 2],
      [P1, 2],
    ]);
  });

  it("[SR-024/AK1] counts the links into the element's repository only", async () => {
    const opened = await open();
    // P2 names N1 in its own repository (platform), not the need of the system repository.
    const out = await output(opened, opened.record(N1));
    expect(out.affected.map((a) => [a.id, a.distance])).toEqual([
      [S1, 1],
      [S2, 2],
      [S3, 3],
      [P1, 3],
    ]);
    expect(out.incomplete).toBe(false);
  });

  it("[SR-024/AK1] counts a link to a UUID that several files share for each of them (SR-088)", async () => {
    const opened = await open();
    for (const file of ["needs/N-000000000005.md", "needs/copy/N-000000000005.md"]) {
      const out = await output(opened, opened.record(DUP, file));
      expect(out.affected.map((a) => a.id)).toEqual([T1]);
    }
  });

  it("[SR-024/AK1] shows an empty title for a title that is no text or without the meaning title (SR-013 AK3)", async () => {
    const numbered = await open({
      ...FILES,
      "system/requirements/SR-000000000003.md": element(S2, "system-requirement", [
        `derives-from:\n  - { id: ${S1}, version: ${V} }`,
      ]).replace("title: T", "title: 42"),
    });
    expect((await output(numbered, numbered.record(S1))).affected.map((a) => [a.id, a.title])).toEqual([
      [S2, ""],
      [S3, "T"],
      [P1, "T"],
    ]);
    const untitled = await open({
      ...FILES,
      "system/metamodel/standard-model.yaml": STANDARD_MODEL_TEXT.replace("    meaning: title\n", ""),
    });
    expect((await output(untitled, untitled.record(S1))).affected.map((a) => a.title)).toEqual(["", "", ""]);
  });

  it("[SR-024/AK4] lists the evidence records of an older version of the element", async () => {
    const opened = await open();
    const old = record(OLD, { variant: P2, evidence: "reports/old.pdf", testCase: "speed shown" });
    const failed = record(OLD, { kind: "validation", result: "failed", date: "2026-10-21T10:00:00Z" });
    const out = await output(opened, opened.record(S1), [record(V), old, failed]);
    expect(out.records).toEqual([old, failed]);
    // Only records of the current version: none of an old one.
    expect((await output(opened, opened.record(S1), [record(V)])).records).toEqual([]);
    // Without evidence (stage 2, the command): none.
    expect((await output(opened, opened.record(S1))).records).toEqual([]);
  });
});

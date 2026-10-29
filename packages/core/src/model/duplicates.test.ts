import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { Problem } from "../catalog.js";
import { Workspace } from "../runtime/workspace.js";
import { duplicateIdFindings, duplicateIdProblemsState, resolveId } from "./duplicates.js";
import type { ElementStore } from "./store.js";
import { elementStoreState } from "./store.js";

const FIXTURE = "SR-088/copied-file";

/** The UUID of the need whose file was copied. */
const COPIED = "948a10f1-05c3-4212-bd19-00606ccf2661";
const OTHER_NEED = "69e28a4e-e2fb-44d0-ac3d-6f6a7469bd76";
const REQUIREMENT = "4f4f8db9-be88-4699-8641-6ae4d00fcab6";
const ORIGINAL_FILE = "requirements/N-00606ccf2661.md";
const COPY_FILE = "copies/N-00606ccf2661.md";
const REQUIREMENT_FILE = "requirements/SR-6ae4d00fcab6.md";
const FIXTURE_FILES = [COPY_FILE, ORIGINAL_FILE, "requirements/N-6f6a7469bd76.md", REQUIREMENT_FILE];

interface Opened {
  readonly ws: FixtureWorkspace;
  readonly workspace: Workspace;
}

const open = async (files: Readonly<Record<string, string>> = {}): Promise<Opened> => {
  const ws = await createFixtureWorkspace({ fixture: FIXTURE, files });
  onTestFinished(() => ws.cleanup());
  const workspace = new Workspace(ws.path("system"));
  onTestFinished(() => workspace.close());
  return { ws, workspace };
};

const duplicate = (repository: string, file: string, line: number, message: string): Problem => ({
  code: "element.duplicate-id",
  severity: "error",
  message,
  repository,
  file,
  line,
  elementId: COPIED,
});

const ALSO_IN = (where: string): string =>
  `Another element file has the same UUID: ${where}; relations to this UUID are ambiguous, and ReqSeq changes none of the files`;

const FIXTURE_PROBLEMS: readonly Problem[] = [
  duplicate("system", COPY_FILE, 2, ALSO_IN(`${ORIGINAL_FILE} (system)`)),
  duplicate("system", ORIGINAL_FILE, 2, ALSO_IN(`${COPY_FILE} (system)`)),
];

/** The UUIDs of the `derives-from` relations of the system requirement, in file order. */
const relationTargets = (store: ElementStore): readonly string[] => {
  const relations = store.byId.get(REQUIREMENT)?.[0]?.data["derives-from"];
  if (!Array.isArray(relations)) {
    throw new Error("the system requirement has no relations");
  }
  return relations.map((r: unknown) => (r as { readonly id: string }).id);
};

/** Content and modification time of every element file of the fixture. */
const snapshot = async (ws: FixtureWorkspace): Promise<readonly (readonly [string, number])[]> =>
  Promise.all(
    FIXTURE_FILES.map(async (file) => {
      const full = ws.path(`system/${file}`);
      return [await fs.readFile(full, "utf8"), (await fs.stat(full)).mtimeMs] as const;
    }),
  );

describe("duplicate IDs (SR-088)", () => {
  it("[SR-088/AK1] reports both files of a copied element file with the shared UUID", async () => {
    const { workspace } = await open();
    expect(await workspace.get(duplicateIdProblemsState)).toEqual(FIXTURE_PROBLEMS);
  });

  it("[SR-088/AK1] changes neither file", async () => {
    const { ws, workspace } = await open();
    const before = await snapshot(ws);
    await workspace.get(duplicateIdProblemsState);
    resolveId((await workspace.get(elementStoreState)).byId, COPIED);
    expect(await snapshot(ws)).toEqual(before);
  });

  it("[SR-088/AK1] reports every file when the UUID is in three files of two repositories", async () => {
    const third = "old/N-00606ccf2661.md";
    const { workspace } = await open({
      "system/logreq-workspace.yaml": [
        "logreq-workspace: 1",
        "name: Weather station",
        "repositories:",
        '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }',
        '  - { name: sensor, url: "git@git.example.com:ws/sensor.git" }',
        "metamodel: { repository: system, path: metamodel }",
        "",
      ].join("\n"),
      [`sensor/${third}`]: `---\nid: ${COPIED}\ntype: need\ntitle: Old copy\n---\n`,
    });
    const others = (a: string, b: string): string =>
      `Other element files have the same UUID: ${a}, ${b}; relations to this UUID are ambiguous, and ReqSeq changes none of the files`;
    expect(await workspace.get(duplicateIdProblemsState)).toEqual([
      duplicate("system", COPY_FILE, 2, others(`${ORIGINAL_FILE} (system)`, `${third} (sensor)`)),
      duplicate("system", ORIGINAL_FILE, 2, others(`${COPY_FILE} (system)`, `${third} (sensor)`)),
      duplicate("sensor", third, 2, others(`${COPY_FILE} (system)`, `${ORIGINAL_FILE} (system)`)),
    ]);
  });

  it("[SR-088/AK1] reports nothing when every UUID is in one file only", async () => {
    const { workspace } = await open({
      [`system/${COPY_FILE}`]:
        "---\nid: 69047954-e58b-41c1-bbb7-d177a39b9763\ntype: need\ntitle: Copy\n---\n",
    });
    expect(await workspace.get(duplicateIdProblemsState)).toEqual([]);
    expect(duplicateIdFindings(await workspace.get(elementStoreState))).toEqual([]);
  });

  it("[SR-088/AK1] reports nothing once the copy has a new UUID and the element store is read again", async () => {
    const { ws, workspace } = await open();
    expect(await workspace.get(duplicateIdProblemsState)).toHaveLength(2);
    await ws.write(
      `system/${COPY_FILE}`,
      "---\nid: 69047954-e58b-41c1-bbb7-d177a39b9763\ntype: need\ntitle: Copy\n---\n",
    );
    await workspace.reset(elementStoreState);
    expect(await workspace.get(duplicateIdProblemsState)).toEqual([]);
  });

  it("[SR-088/AK2] marks a relation to the shared UUID as ambiguous, with every file of it", async () => {
    const { workspace } = await open();
    const store = await workspace.get(elementStoreState);
    const [toCopied] = relationTargets(store);
    const match = resolveId(store.byId, toCopied ?? "");
    expect(match.kind).toBe("ambiguous");
    expect(match.kind === "ambiguous" ? match.elements.map((e) => e.file) : []).toEqual([
      COPY_FILE,
      ORIGINAL_FILE,
    ]);
  });

  it("[SR-088/AK2] does not mark a relation to a UUID of one file, and finds no element for an unknown UUID", async () => {
    const { workspace } = await open();
    const store = await workspace.get(elementStoreState);
    const [, toOther] = relationTargets(store);
    expect(toOther).toBe(OTHER_NEED);
    const match = resolveId(store.byId, OTHER_NEED);
    expect(match.kind === "found" ? match.element.file : undefined).toBe("requirements/N-6f6a7469bd76.md");
    expect(resolveId(store.byId, "4c3e1f54-0e3b-4c3f-9b6a-1d2e3f4a5b6c")).toEqual({ kind: "unknown" });
  });

  it("[SR-088/AK3] gives duplicate UUIDs a finding of severity error, so that the check fails", async () => {
    const { workspace } = await open();
    const problems = await workspace.get(duplicateIdProblemsState);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.every((p) => p.severity === "error" && p.code === "element.duplicate-id")).toBe(true);
  });
});

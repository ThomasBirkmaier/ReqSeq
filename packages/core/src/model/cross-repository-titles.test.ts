// A title stored across a repository boundary is a warning of the check (SR-005 AK4), on
// fixtures/SR-005/cross-repository: the source SR-7b9d0f in `system` derives from a need in `platform`.
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput, Problem } from "../catalog.js";
import { metamodelState } from "../metamodel/index.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { crossRepositoryTitleProblemsState } from "./cross-repository-titles.js";

const SOURCE = { id: "8f1e3d5c-7b9a-4c2e-a4f6-1a3c5e7b9d0f", file: "requirements/SR-1a3c5e7b9d0f.md" };
const NEED = "4c1d9e7a-8b2f-4a3c-9d5e-6f7a8b9c0d1e";
const PKG = "7e3a5c9b-1d2f-4e6a-8b0c-2d4e6f8a0b1c";
const VERSION = "n1:1111111111111111";

/** The source with `status`, its relations and properties as frontmatter lines. */
const source = (status: string, ...lines: string[]): string =>
  [
    "---",
    `id: ${SOURCE.id}`,
    "type: system-requirement",
    `status: ${status}`,
    "title: Show gusts in red",
    "requirement-type: functional",
    "acceptance-criteria:",
    "  - Given a gust, when it is measured, then the display shows it in red.",
    ...lines,
    "---",
    "",
    "The display shows gusts in red.",
    "",
  ].join("\n");

const open = async (files: Readonly<Record<string, string>>): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-005/cross-repository", files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.path("system"));
  onTestFinished(() => workspace.close());
  return workspace;
};

const titles = async (workspace: Workspace): Promise<Problem[]> =>
  ((await invoke("workspace.check", {}, { workspace })) as CommandOutput<"workspace.check">).problems.filter(
    (p) => p.code === "relation.cross-repository-title",
  );

describe("titles stored across a repository boundary (SR-005 AK4)", () => {
  it("[SR-005/AK-gx7c] workspace.check warns about a title on a relation into another repository, with file and line", async () => {
    const workspace = await open({
      [`system/${SOURCE.file}`]: source(
        "draft",
        "derives-from:",
        `  - { id: ${NEED}, version: ${VERSION}, repository: platform, title: Gusts stand out }`,
      ),
    });
    expect(await titles(workspace)).toEqual([
      {
        code: "relation.cross-repository-title",
        severity: "warning",
        message: `Relation Derives from (derives-from) of System Requirement SR-7b9d0f stores a title for ${NEED} in repository platform; across repositories only UUID, version and repository are stored`,
        repository: "system",
        file: SOURCE.file,
        line: 10,
        elementId: SOURCE.id,
        elementShortId: "SR-7b9d0f",
        elementTitle: "Show gusts in red",
        targetId: NEED,
        targetShortId: "N-9c0d1e",
        targetTitle: "Gusts stand out",
        targetRepository: "platform",
        key: "derives-from",
      },
    ]);
  });

  it("[SR-005/AK-gx7c] warns also when the source has an invalid status, and for a relation-valued property", async () => {
    const workspace = await open({
      [`system/${SOURCE.file}`]: source(
        "obsolete",
        "packages:",
        `  - { id: ${PKG}, version: ${VERSION}, repository: platform, title: Platform 2.0 }`,
      ),
    });
    expect((await titles(workspace)).map((p) => [p.key, p.targetId, p.line])).toEqual([
      ["packages", PKG, 10],
    ]);
  });

  it("is a hint in hint.list and at the element in element.get, as in the check (SR-026)", async () => {
    const workspace = await open({
      [`system/${SOURCE.file}`]: source(
        "draft",
        "derives-from:",
        `  - { id: ${NEED}, version: ${VERSION}, repository: platform, title: Gusts stand out }`,
      ),
    });
    const checked = await titles(workspace);
    const listed = (await invoke(
      "hint.list",
      { kind: ["relation.cross-repository-title"] },
      { workspace },
    )) as CommandOutput<"hint.list">;
    expect(listed.hints).toEqual(checked);
    const shown = (await invoke(
      "element.get",
      { ref: SOURCE.id },
      { workspace },
    )) as CommandOutput<"element.get">;
    expect(
      (shown.element.problems ?? []).filter((p) => p.code === "relation.cross-repository-title"),
    ).toEqual(checked);
  });

  it("warns about a title also when the target is missing or its repository is unknown, then without targetRepository", async () => {
    const missing = "4c1d9e7a-8b2f-4a3c-9d5e-000000000000";
    const workspace = await open({
      [`system/${SOURCE.file}`]: source(
        "draft",
        "derives-from:",
        `  - { id: ${NEED}, version: ${VERSION}, repository: nowhere, title: Gusts stand out }`,
        `  - { id: ${missing}, version: ${VERSION}, repository: platform, title: Gone }`,
      ),
    });
    const found = await titles(workspace);
    expect(found.map((p) => [p.targetId, p.line])).toEqual([
      [NEED, 10],
      [missing, 11],
    ]);
    for (const problem of found) {
      expect(problem).not.toHaveProperty("targetRepository");
      expect(problem).not.toHaveProperty("targetShortId");
    }
  });

  it("does not warn about a title within the source's repository, an entry without title, or a value that is no relation target", async () => {
    const workspace = await open({
      [`system/${SOURCE.file}`]: source(
        "draft",
        "derives-from:",
        `  - { id: ${NEED}, version: ${VERSION}, repository: platform }`,
        `  - { id: ${NEED}, version: ${VERSION}, repository: system, title: Same repository }`,
        `  - { id: ${NEED}, version: ${VERSION}, title: No repository }`,
        `  - { id: ${NEED}, version: ${VERSION}, repository: 7, title: Not a name }`,
        "  - just text",
      ),
    });
    expect(await titles(workspace)).toEqual([]);
  });

  it("reports nothing against a metamodel that is not valid", async () => {
    const workspace = await open({
      [`system/${SOURCE.file}`]: source(
        "draft",
        "derives-from:",
        `  - { id: ${NEED}, version: ${VERSION}, repository: platform, title: Gusts stand out }`,
      ),
      "system/metamodel/standard-model.yaml": "reqseq-metamodel: 1\ntypes: 7\n",
    });
    expect((await workspace.get(metamodelState)).valid).toBe(false);
    expect(await workspace.get(crossRepositoryTitleProblemsState)).toEqual([]);
  });
});

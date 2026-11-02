// #666: a repository of the workspace that is a workspace of its own with another metamodel.
import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../catalog.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { loadWorkspaceLayout } from "../workspace/index.js";
import { loadMetamodel } from "./load.js";
import { repositoryMetamodelProblems, versionDifferences } from "./repository-metamodels.js";
import { STANDARD_MODEL_TEXT } from "./standard-model.js";

const FUEL_MODEL = "fuel/metamodel/standard-model.yaml";

const fixture = async (options: FixtureOptions = {}): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace({ fixture: "SR-004/own-metamodel", ...options });
  onTestFinished(() => created.cleanup());
  return created;
};

/** The standard model with each `[from, to]` replaced once. */
const edited = (...edits: readonly (readonly [string, string])[]): string =>
  edits.reduce((text, [from, to]) => {
    expect(text).toContain(from);
    return text.replace(from, to);
  }, STANDARD_MODEL_TEXT);

const problemsOf = async (created: FixtureWorkspace): Promise<unknown> => {
  const layout = await loadWorkspaceLayout(path.join(created.root, "system"));
  return repositoryMetamodelProblems(layout, await loadMetamodel(layout));
};

const metamodelOf = async (root: string): Promise<Awaited<ReturnType<typeof loadMetamodel>>> =>
  loadMetamodel(await loadWorkspaceLayout(root));

describe("workspace.metamodel-mismatch (#666)", () => {
  it("workspace.check warns about a repository whose own metamodel counts another property", async () => {
    const created = await fixture();
    const workspace = new Workspace(path.join(created.root, "system"));
    onTestFinished(() => workspace.close());
    const out = (await invoke("workspace.check", {}, { workspace })) as CommandOutput<"workspace.check">;
    expect(out.problems.filter((p) => p.code === "workspace.metamodel-mismatch")).toEqual([
      {
        code: "workspace.metamodel-mismatch",
        severity: "warning",
        repository: "fuel",
        file: "reqseq-workspace.yaml",
        message:
          "Repository fuel has its own metamodel: need.stakeholder counts to the version there but is not in this workspace's metamodel; elements of fuel get other versions here",
      },
    ]);
  });

  it("names the first differences and counts the rest", async () => {
    const created = await fixture({
      files: {
        [FUEL_MODEL]: edited(
          // rationale counts there in need, use-case, system-requirement and decision
          [
            '    description: "Why the element exists or is as it is."\n',
            '    description: "Why."\n    content: true\n',
          ],
          // requirement-type does not count there
          ["    kind: choice\n    content: true\n", "    kind: choice\n"],
        ),
      },
    });
    expect(await problemsOf(created)).toEqual([
      expect.objectContaining({
        message:
          "Repository fuel has its own metamodel: need.rationale counts to the version there but not here, use-case.rationale counts to the version there but not here, system-requirement.rationale counts to the version there but not here and 2 more; elements of fuel get other versions here",
      }),
    ]);
  });

  it("tells a property or type that is not in the other metamodel and a relation in only one", async () => {
    const created = await fixture();
    const here = await metamodelOf(path.join(created.root, "system"));
    await created.write(
      FUEL_MODEL,
      edited(
        ["        acceptance-criteria,\n", ""],
        ["required: [title, requirement-type, acceptance-criteria]", "required: [title, requirement-type]"],
      ),
    );
    const without = await metamodelOf(path.join(created.root, "fuel"));
    expect(versionDifferences(without, here)).toEqual([
      "system-requirement.acceptance-criteria counts to the version here but is not in its metamodel",
    ]);
    const relation = edited([
      "    kind: choice\n    content: true\n",
      "    kind: relation\n    content: true\n",
    ]);
    await created.write(FUEL_MODEL, relation);
    const there = await metamodelOf(path.join(created.root, "fuel"));
    expect(versionDifferences(there, here)).toEqual([
      "system-requirement.requirement-type is a relation there but not here",
    ]);
    expect(versionDifferences(here, there)).toEqual([
      "system-requirement.requirement-type is a relation here but not there",
    ]);
    const typed = edited([
      "types:\n",
      "types:\n  - { key: hazard, name: Hazard, prefix: H, properties: [title, acceptance-criteria] }\n",
    ]);
    await created.write(FUEL_MODEL, typed);
    const more = await metamodelOf(path.join(created.root, "fuel"));
    expect([...versionDifferences(more, here), ...versionDifferences(here, more)]).toEqual([
      "hazard.acceptance-criteria counts to the version there but is not in this workspace's metamodel",
      "hazard.acceptance-criteria counts to the version here but is not in its metamodel",
    ]);
  });

  it("is silent for the same metamodel, a shared metamodel folder, no own workspace file or a missing repository", async () => {
    const same = await fixture({ files: { [FUEL_MODEL]: STANDARD_MODEL_TEXT } });
    expect(await problemsOf(same)).toEqual([]);
    const shared = await fixture({
      files: {
        "fuel/reqseq-workspace.yaml": [
          "reqseq-workspace: 1",
          "name: Fuel",
          "repositories:",
          '  - { name: fuel, url: "", main: true }',
          '  - { name: system, url: "" }',
          "metamodel: { repository: system, path: metamodel }",
          "",
        ].join("\n"),
      },
    });
    expect(await problemsOf(shared)).toEqual([]);
    const plain = await fixture();
    await fs.rm(path.join(plain.root, "fuel", "reqseq-workspace.yaml"));
    expect(await problemsOf(plain)).toEqual([]);
    const missing = await fixture();
    await fs.rm(path.join(missing.root, "fuel"), { recursive: true });
    expect(await problemsOf(missing)).toEqual([]);
  });

  it("gives info when the other workspace file or metamodel cannot be read", async () => {
    const faulty = await fixture({ files: { "fuel/reqseq-workspace.yaml": "reqseq-workspace: 1\n" } });
    expect(await problemsOf(faulty)).toEqual([
      {
        code: "workspace.metamodel-mismatch",
        severity: "info",
        repository: "fuel",
        file: "reqseq-workspace.yaml",
        message:
          "Repository fuel has its own reqseq-workspace.yaml, which cannot be read, so its metamodel is not compared with this workspace's",
      },
    ]);
    const invalid = await fixture({ files: { [FUEL_MODEL]: "reqseq-metamodel: 1\ntypes: 3\n" } });
    expect(await problemsOf(invalid)).toEqual([
      expect.objectContaining({
        severity: "info",
        message:
          "Repository fuel has its own metamodel, which is missing or not valid, so it is not compared with this workspace's",
      }),
    ]);
  });

  it("compares nothing while the workspace's own metamodel is not valid", async () => {
    const created = await fixture({ files: { "system/metamodel/standard-model.yaml": "types: 3\n" } });
    expect(await problemsOf(created)).toEqual([]);
  });
});

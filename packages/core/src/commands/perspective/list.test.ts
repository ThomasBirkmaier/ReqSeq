// perspective.list (SR-213 AK2, AK8) on fixtures/SR-069/filter.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import type { Problem } from "../../generated/types.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Listed = CommandOutput<"perspective.list">;

/** A perspective as a person writes it by hand: a comment, a short ID, a sort without `order`. */
const HAND_WRITTEN = [
  "# Drafts of the sensor package",
  "reqseq-perspective: 1",
  "name: Sensor drafts",
  "description: Drafts in the package Sensors",
  "filter: Mountain",
  "where:",
  "  all:",
  "    - { package: PKG-0000d1 }",
  "    - { status: [draft] }",
  "group: status",
  "sort: [{ by: title }]",
  "",
].join("\n");

const open = async (
  options: FixtureOptions,
): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const listed = async (
  workspace: Workspace,
): Promise<Omit<Listed, "problems"> & { readonly problems: readonly Problem[] }> => {
  const out = (await invoke("perspective.list", {}, { workspace })) as Listed;
  return { ...out, problems: out.problems ?? [] };
};

describe("perspective.list (SR-213)", () => {
  it("[SR-213/AK-dyjq] makes a saved perspective available to another person who opens the repository", async () => {
    const { fixture, workspace } = await open({ fixture: "SR-069/filter", git: true });
    const where = { all: [{ type: ["system-requirement"] }, { status: ["draft"] }] };
    const saved = await invoke(
      "perspective.save",
      { name: "Drafts by status", where, group: "status" },
      { workspace },
    );
    expect(saved).toEqual({ files: ["perspectives/drafts-by-status.yaml"], problems: [] });
    await fixture.commit();
    // Another person: a clone of the repository on another machine, opened by its own ReqSeq.
    const elsewhere = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-sr-213-"));
    onTestFinished(() => fs.rm(elsewhere, { recursive: true, force: true }));
    const clone = path.join(elsewhere, "system");
    await fixture.git(["clone", "--quiet", fixture.root, clone]);
    const theirs = new Workspace(clone);
    onTestFinished(() => theirs.close());
    expect(await listed(theirs)).toEqual({
      perspectives: [
        { name: "Drafts by status", file: "perspectives/drafts-by-status.yaml", where, group: "status" },
      ],
      problems: [],
      incomplete: false,
    });
  });

  it("[SR-213/AK-qp6d] names file and reason of each faulty perspective file, lists the others and never writes", async () => {
    const files = {
      "perspectives/a-sensor-drafts.yaml": HAND_WRITTEN,
      "perspectives/b-view.yaml": "reqseq-perspective: 1\nname: Seen\nview: core\nwhere: { all: [] }\n",
      "perspectives/c-unparsable.yaml": "reqseq-perspective: 1\nname: [unclosed\n",
      "perspectives/d-again.yaml": "reqseq-perspective: 1\nname: SENSOR DRAFTS\nwhere: { all: [] }\n",
      "perspectives/e-old.yml": "reqseq-perspective: 1\nname: Old\nwhere: { all: [] }\n",
      "perspectives/f-notes.txt": "not read\n",
      "perspectives/g-all.yaml": "reqseq-perspective: 1\nname: All\nwhere: { all: [] }\n",
    };
    const { fixture, workspace } = await open({ fixture: "SR-069/filter", files });
    const out = await listed(workspace);
    expect(out.perspectives).toEqual([
      {
        name: "Sensor drafts",
        file: "perspectives/a-sensor-drafts.yaml",
        description: "Drafts in the package Sensors",
        filter: "Mountain",
        where: { all: [{ package: "PKG-0000d1" }, { status: ["draft"] }] },
        group: "status",
        sort: [{ by: "title" }],
      },
      { name: "All", file: "perspectives/g-all.yaml", where: { all: [] } },
    ]);
    expect(out.problems.map((p) => [p.code, p.severity, p.file, p.line])).toEqual([
      ["perspective.invalid", "error", "perspectives/b-view.yaml", 1],
      ["file.invalid-yaml", "error", "perspectives/c-unparsable.yaml", 2],
      ["perspective.duplicate-name", "warning", "perspectives/d-again.yaml", 2],
      ["perspective.invalid", "warning", "perspectives/e-old.yml", undefined],
    ]);
    expect(out.problems[0]?.message).toMatch(/^Invalid perspective perspectives\/b-view\.yaml: /);
    expect(out.problems[0]?.message).toContain("view");
    expect(out.problems[2]?.message).toBe(
      'Perspective perspectives/d-again.yaml has the name "SENSOR DRAFTS" of perspectives/a-sensor-drafts.yaml, which is used; rename one',
    );
    expect(out.problems[3]?.message).toBe(
      "perspectives/e-old.yml is not read: perspective files end in .yaml",
    );
    expect(out.incomplete).toBe(false);
    for (const [file, text] of Object.entries(files)) {
      expect(await fs.readFile(fixture.path(file), "utf8")).toBe(text);
    }
  });

  it("[SR-008/AK-pm64] reports a perspective file of an unknown format number as faulty and uses none of it", async () => {
    const { workspace } = await open({
      fixture: "SR-069/filter",
      files: { "perspectives/next.yaml": "reqseq-perspective: 2\nname: Next\nwhere: { all: [] }\n" },
    });
    const out = await listed(workspace);
    expect(out.perspectives).toEqual([]);
    expect(out.problems.map((p) => [p.code, p.file, p.line])).toEqual([
      ["perspective.invalid", "perspectives/next.yaml", 1],
    ]);
  });

  it("lists nothing without a perspectives folder, and reports one that cannot be read", async () => {
    expect(await listed((await open({ fixture: "SR-069/filter" })).workspace)).toEqual({
      perspectives: [],
      problems: [],
      incomplete: false,
    });
    const blocked = await open({ fixture: "SR-069/filter", files: { perspectives: "a file" } });
    const out = await listed(blocked.workspace);
    expect(out.problems.map((p) => [p.code, p.file])).toEqual([["file.unreadable", "perspectives"]]);
    expect(out.problems[0]?.message).toMatch(/^Cannot read the perspectives folder perspectives: /);
  });
});

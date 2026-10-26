// filter.list (SR-070 AK2) and filters called by name in a selection (SR-070 AK3) on
// fixtures/SR-069/filter (see commands/element/list.test.ts for its elements).
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import type { EvidenceStatuses } from "../../query/index.js";
import { evidenceStatusState } from "../../query/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Listed = CommandOutput<"filter.list">;
type Elements = CommandOutput<"element.list">;

const P = "69069069-0000-4000-8000-0000000000";
const [N2, P2, B1, B2, B3, B4, B5, F1, F2, V2] = [
  "a2",
  "d2",
  "b1",
  "b2",
  "b3",
  "b4",
  "b5",
  "f1",
  "f2",
  "c2",
].map((tail) => `${P}${tail}`) as [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

/** A filter as a person writes it by hand: short IDs, a comment, a view by short ID. */
const HAND_WRITTEN = [
  "# Drafts of the sensor package",
  "logreq-filter: 1",
  "name: Sensor drafts",
  "description: Drafts in the package Sensors",
  "where:",
  "  all:",
  "    - { package: PKG-0000d1 }",
  "    - { status: [draft] }",
  "sort: [{ by: title, order: desc }]",
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

const run = async <T>(workspace: Workspace, name: string, input: Record<string, unknown>): Promise<T> =>
  (await invoke(name, input, { workspace })) as T;

const listed = (workspace: Workspace): Promise<Listed> => run<Listed>(workspace, "filter.list", {});

const elements = async (workspace: Workspace, input: Record<string, unknown>): Promise<string[]> =>
  (await run<Elements>(workspace, "element.list", { limit: 5000, ...input })).elements.map((e) => e.id);

const failure = async (workspace: Workspace, input: Record<string, unknown>): Promise<CommandError> => {
  try {
    await run(workspace, "element.list", input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("element.list did not fail");
};

describe("filter.list (SR-070)", () => {
  it("[SR-070/AK2] makes a saved filter available to another person who opens the repository", async () => {
    const { fixture, workspace } = await open({ fixture: "SR-069/filter", git: true });
    const where = { all: [{ type: ["system-requirement"] }, { status: ["draft"] }] };
    const saved = await run<CommandOutput<"filter.save">>(workspace, "filter.save", {
      name: "Draft requirements",
      where,
    });
    expect(saved.files).toEqual(["filters/draft-requirements.yaml"]);
    const mine = await elements(workspace, { selection: { filter: "Draft requirements" } });
    await fixture.commit();
    // Another person: a clone of the repository on another machine, opened by its own LogReq.
    const elsewhere = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-sr-070-"));
    onTestFinished(() => fs.rm(elsewhere, { recursive: true, force: true }));
    const clone = path.join(elsewhere, "system");
    await fixture.git(["clone", "--quiet", fixture.root, clone]);
    const theirs = new Workspace(clone);
    onTestFinished(() => theirs.close());
    expect(await listed(theirs)).toEqual({
      filters: [{ name: "Draft requirements", file: "filters/draft-requirements.yaml", where }],
      problems: [],
      incomplete: false,
    });
    expect(await elements(theirs, { selection: { filter: "draft requirements" } })).toEqual(mine);
    expect(mine).toEqual([B2, B3, F1]);
  });

  it("[SR-070/AK2] lists hand-written filter files, each with its definition, and reports faulty ones", async () => {
    const { workspace } = await open({
      fixture: "SR-069/filter",
      files: {
        "filters/sensor-drafts.yaml": HAND_WRITTEN,
        "filters/a-broken.yaml": "logreq-filter: 1\nname: Broken\nwhere:\n  nope: 1\n",
        "filters/b-not-yaml.yaml": "name: [unclosed\n",
        "filters/z-same-name.yaml": "logreq-filter: 1\nname: SENSOR DRAFTS\nwhere: { all: [] }\n",
        "filters/d-old.yml": "logreq-filter: 1\nname: Old\nwhere: { all: [] }\n",
        "filters/e-warning.yaml": "logreq-filter: 1\nname: !odd Odd\nwhere: { all: [] }\n",
        "filters/f-list.yaml": "- a\n",
        "filters/g-core.yaml": "logreq-filter: 1\nname: Core\nview: core\nwhere: { all: [] }\n",
        "filters/notes.md": "# Not a filter\n",
        "filters/.hidden.yaml": "logreq-filter: 1\nname: Hidden\nwhere: { all: [] }\n",
        "filters/sub/deeper.yaml": "logreq-filter: 1\nname: Deeper\nwhere: { all: [] }\n",
      },
    });
    const out = await listed(workspace);
    expect(out.filters).toEqual([
      { name: "Odd", file: "filters/e-warning.yaml", where: { all: [] } },
      { name: "Core", file: "filters/g-core.yaml", view: "core", where: { all: [] } },
      {
        name: "Sensor drafts",
        file: "filters/sensor-drafts.yaml",
        description: "Drafts in the package Sensors",
        where: { all: [{ package: "PKG-0000d1" }, { status: ["draft"] }] },
        sort: [{ by: "title", order: "desc" }],
      },
    ]);
    expect(out.incomplete).toBe(false);
    expect(out.problems).toEqual([
      {
        code: "filter.invalid",
        severity: "error",
        message:
          "Invalid saved filter filters/a-broken.yaml: where (an object) does not have the expected form",
        repository: "system",
        file: "filters/a-broken.yaml",
        line: 4,
      },
      expect.objectContaining({
        code: "file.invalid-yaml",
        repository: "system",
        file: "filters/b-not-yaml.yaml",
      }),
      {
        code: "filter.invalid",
        severity: "warning",
        message: "filters/d-old.yml is not read: saved filter files end in .yaml",
        repository: "system",
        file: "filters/d-old.yml",
      },
      expect.objectContaining({
        code: "file.yaml-warning",
        repository: "system",
        file: "filters/e-warning.yaml",
      }),
      {
        code: "filter.invalid",
        severity: "error",
        message: "Invalid saved filter filters/f-list.yaml: the file must be an object, not a list",
        repository: "system",
        file: "filters/f-list.yaml",
        line: 1,
      },
      {
        code: "filter.duplicate-name",
        severity: "warning",
        message:
          'Saved filter filters/z-same-name.yaml has the name "SENSOR DRAFTS" of filters/sensor-drafts.yaml, which is used; rename one',
        repository: "system",
        file: "filters/z-same-name.yaml",
        line: 2,
      },
    ]);
  });
});

/** A filter file with `lines` after `logreq-filter: 1`. */
const filterFile = (...lines: readonly string[]): string => ["logreq-filter: 1", ...lines, ""].join("\n");

/** Replaces the evidence provider of `workspace` (decision on #127, option 1). */
const withEvidence = async (workspace: Workspace, statuses: EvidenceStatuses): Promise<void> => {
  const before = workspace.get(evidenceStatusState);
  await before;
  expect(await workspace.replace(evidenceStatusState, before, Promise.resolve(statuses))).toBe(true);
};

describe("a saved filter called by name in a selection (SR-070 AK3)", () => {
  const FILES = {
    "filters/sensor-drafts.yaml": HAND_WRITTEN,
    "filters/drafts.yaml": filterFile(
      "name: Drafts",
      "where: { status: [draft] }",
      "sort: [{ by: title, order: desc }]",
    ),
    "filters/mountain.yaml": filterFile(
      "name: Mountain",
      "view: var-0000C2",
      "where: { type: [system-requirement] }",
    ),
    "filters/checked.yaml": filterFile(
      "name: Checked",
      "view: VAR-0000c2",
      "where: { verification: [verified] }",
    ),
    "filters/unchecked.yaml": filterFile("name: Unchecked", "where: { verification: [verified] }"),
    "filters/bad-package.yaml": filterFile("name: Bad package", "where: { package: SR-0000b1 }"),
    "filters/bad-view.yaml": filterFile("name: Bad view", "view: SR-0000b1", "where: { all: [] }"),
    "filters/bad-sort.yaml": filterFile("name: Bad sort", "where: { all: [] }", "sort: [{ by: packages }]"),
    "filters/broken.yaml": filterFile("name: Broken", "where: { nope: 1 }"),
  };

  it("[SR-070/AK3] gives the elements of its definition, in its order, as the same condition given inline", async () => {
    const { workspace } = await open({ fixture: "SR-069/filter", files: FILES });
    const drafts = await elements(workspace, { selection: { filter: "drafts" } });
    expect(drafts).toEqual(
      await elements(workspace, {
        selection: { where: { status: ["draft"] } },
        sort: [{ by: "title", order: "desc" }],
      }),
    );
    expect([...drafts].sort()).toEqual([N2, P2, B2, B3, F1, V2].sort());
    // The input's sort wins over the filter's.
    expect(await elements(workspace, { selection: { filter: "Drafts" }, sort: [{ by: "id" }] })).toEqual(
      await elements(workspace, { selection: { where: { status: ["draft"] } }, sort: [{ by: "id" }] }),
    );
    // Short IDs in a hand-written file resolve as in an input; its view holds as `view` does.
    expect(await elements(workspace, { selection: { filter: "Sensor drafts" } })).toEqual([B2]);
    expect(await elements(workspace, { selection: { filter: "mountain" } })).toEqual(
      await elements(workspace, { selection: { where: { type: ["system-requirement"] }, view: V2 } }),
    );
    expect(await elements(workspace, { selection: { filter: "mountain" } })).toEqual([
      B1,
      B3,
      B4,
      B5,
      F1,
      F2,
    ]);
    // Every other part of the selection must hold too (SR-101 AK2).
    expect(
      await elements(workspace, {
        selection: { filter: "Drafts", where: { type: ["system-requirement"] }, ids: [B2, B4] },
      }),
    ).toEqual([B2]);
    expect(await elements(workspace, { selection: { filter: "mountain", view: "core" } })).toEqual([
      B1,
      B4,
      B5,
      F1,
      F2,
    ]);
  });

  it("[SR-070/AK3] takes its own view for its verification conditions, else the view of the selection", async () => {
    const { workspace } = await open({ fixture: "SR-069/filter", files: FILES });
    await withEvidence(workspace, {
      verification: (_element, view) => (view.kind === "variant" ? "verified" : "open"),
      validation: () => undefined,
      hasEvidence: () => false,
    });
    expect(await elements(workspace, { selection: { filter: "Checked" } })).toEqual(
      await elements(workspace, { selection: { view: V2 } }),
    );
    expect(await elements(workspace, { selection: { filter: "Checked", view: "core" } })).toEqual(
      await elements(workspace, { selection: { view: "core", where: { validFor: V2 } } }),
    );
    expect(await elements(workspace, { selection: { filter: "Unchecked" } })).toEqual([]);
    expect(await elements(workspace, { selection: { filter: "Unchecked", view: V2 } })).toEqual(
      await elements(workspace, { selection: { view: V2 } }),
    );
  });

  it("[SR-070/AK3] works in every command that takes a selection, such as a bulk update", async () => {
    const { workspace } = await open({ fixture: "SR-069/filter", files: FILES });
    const preview = await run<CommandOutput<"element.bulkUpdate">>(workspace, "element.bulkUpdate", {
      selection: { filter: "sensor drafts" },
      property: "topic",
      operation: "set",
      value: "Sensors",
    });
    expect([preview.count, preview.affected.map((e) => e.id)]).toEqual([1, [B2]]);
  });

  it("names the filter and its file in the errors of a hand-written filter, and refuses an unknown name", async () => {
    const { workspace } = await open({ fixture: "SR-069/filter", files: FILES });
    const refused = async (input: Record<string, unknown>): Promise<unknown> => {
      const error = await failure(workspace, input);
      return { code: error.code, message: error.message, details: error.details };
    };
    expect(await refused({ selection: { filter: "Nope" } })).toEqual({
      code: "input.invalid",
      message: 'selection.filter: no saved filter is named "Nope"; filter.list lists the saved filters',
      details: { command: "element.list", fields: ["selection.filter"] },
    });
    expect(await refused({ selection: { filter: "broken" } })).toEqual({
      code: "file.faulty",
      message:
        'The saved filter "broken" is in a faulty file (filters/broken.yaml); fix it by hand before it can be used',
      details: { files: ["filters/broken.yaml"] },
    });
    expect(await refused({ selection: { filter: "Bad package" } })).toEqual({
      code: "input.invalid",
      message:
        'Saved filter "Bad package" (filters/bad-package.yaml): where.package: SR-0000b1 is no package: an element whose type has the meaning package',
      details: { command: "element.list", fields: ["where.package"] },
    });
    expect(((await refused({ selection: { filter: "Bad view" } })) as { message: string }).message).toMatch(
      /^Saved filter "Bad view" \(filters\/bad-view\.yaml\): SR-0000b1 is no variant/,
    );
    expect(((await refused({ selection: { filter: "Bad sort" } })) as { message: string }).message).toMatch(
      /^Saved filter "Bad sort" \(filters\/bad-sort\.yaml\): sort\[0\]\.by: /,
    );
    // Its sort applies only without a sort in the input.
    expect(await elements(workspace, { selection: { filter: "Bad sort" }, sort: [] })).toHaveLength(14);
  });

  it("says when the filters folder is in a repository that is not on this machine (SR-006)", async () => {
    const { workspace } = await open({
      fixture: "SR-069/filter",
      files: {
        "logreq-workspace.yaml":
          "logreq-workspace: 1\nname: Weather station\nrepositories:\n" +
          '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
          '  - { name: vault, url: "ssh://example.com/vault.git", path: ../vault }\n' +
          "metamodel: { repository: system, path: metamodel }\n" +
          "filters: { repository: vault, path: filters }\n",
      },
    });
    expect((await failure(workspace, { selection: { filter: "Drafts" } })).message).toBe(
      'selection.filter: no saved filter is named "Drafts"; its folder is in repository vault, which is not on this machine',
    );
  });
});

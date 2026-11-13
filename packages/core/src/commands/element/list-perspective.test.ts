// element.list with `perspective` (SR-213 AK4 to AK7) on fixtures/SR-069/filter (see list.test.ts for
// its elements). Titles in order: f1 "Filter the sensor signal", f2 "Log the raw values", b2 "Measure
// every second", b1 "Measure wind speed", b5 "Send data to the cloud", b4 "Show a dial", b3 "Survive icing".
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { CommandError } from "../../catalog.js";
import { evidenceStatusState } from "../../query/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
import type { FullList } from "../list.test-helper.js";

/** A saved filter of the system requirements (with SWR), sorted by title descending. */
const REQUIREMENTS =
  "reqseq-filter: 1\nname: Requirements\nwhere: { type: [system-requirement] }\nsort: [{ by: title, order: desc }]\n";
/** The perspective the AK4 and AK5 tests call: drafts and approved ones of REQUIREMENTS, by package and title. */
const BY_PACKAGE =
  "# Open and done work\nreqseq-perspective: 1\nname: Requirements by package\nfilter: Requirements\n" +
  "where: { status: [draft, approved] }   # no obsolete ones\ngroup: package\nsort: [{ by: title }]\n";

const perspective = (name: string, rest: string): string => `reqseq-perspective: 1\nname: ${name}\n${rest}`;

const BASE: Record<string, string> = {
  "filters/requirements.yaml": REQUIREMENTS,
  "filters/unsorted.yaml": "reqseq-filter: 1\nname: Unsorted\nwhere: { type: [system-requirement] }\n",
  "filters/mountain.yaml":
    "reqseq-filter: 1\nname: Mountain\nview: VAR-0000c2\nwhere: { type: [system-requirement] }\n",
  "filters/by-id.yaml":
    "reqseq-filter: 1\nname: By ID\nwhere: { all: [] }\nsort: [{ by: id, order: desc }]\n",
  "filters/broken.yaml": "reqseq-filter: 1\nname: Broken\nwhere: { nope: 1 }\n",
  "perspectives/by-package.yaml": BY_PACKAGE,
};

const open = async (
  files: Record<string, string> = {},
  options: Partial<FixtureOptions> = {},
): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> => {
  const fixture = await createFixtureWorkspace({
    fixture: "SR-069/filter",
    ...options,
    files: { ...BASE, ...files },
  });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const list = async (workspace: Workspace, input: Record<string, unknown>): Promise<FullList> =>
  (await invoke("element.list", { limit: 5000, ...input }, { workspace })) as FullList;

const shortIds = (output: FullList): string[] => output.elements.map((e) => e.shortId);

/** The groups as `value: short IDs` lines, `-` for the last group. */
const groupLines = (output: FullList): string[] =>
  (output.groups ?? []).map(
    ({ value, count, offset }) =>
      `${value === undefined ? "-" : String(value)}: ${shortIds(output)
        .slice(offset, offset + count)
        .join(" ")}`,
  );

const failure = async (workspace: Workspace, input: Record<string, unknown>): Promise<CommandError> => {
  try {
    await list(workspace, input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("element.list did not fail");
};

const refusal = async (
  workspace: Workspace,
  input: Record<string, unknown>,
): Promise<{ code: string; message: string; fields: unknown }> => {
  const error = await failure(workspace, input);
  return { code: error.code, message: error.message, fields: error.details?.["fields"] };
};

/** The list a call without the perspective gives with its stored selection, grouping and sort. */
const STORED = {
  selection: { filter: "Requirements", where: { status: ["draft", "approved"] } },
  group: "package",
  sort: [{ by: "title" }],
};

describe("element.list with a perspective (SR-213)", () => {
  it("[SR-213/AK-gcgz] gives the elements, groups and order of the perspective, as its stored parts give them, in a view too", async () => {
    const { workspace } = await open();
    const out = await list(workspace, { perspective: "requirements BY PACKAGE" });
    expect(groupLines(out)).toEqual([
      "PKG-0000d2: SR-0000b2",
      "PKG-0000d1: SR-0000b2 SR-0000b1",
      "-: SWR-0000f1 SWR-0000f2 SR-0000b5 SR-0000b3",
    ]);
    expect(out).toEqual({ ...(await list(workspace, STORED)), problems: [] });
    // In the view of a window, given as `selection.view`: the same as the stored parts in that view.
    const inView = await list(workspace, {
      perspective: "Requirements by package",
      selection: { view: "VAR-0000c2" },
    });
    expect(inView).toEqual({
      ...(await list(workspace, { ...STORED, selection: { ...STORED.selection, view: "VAR-0000c2" } })),
      problems: [],
    });
    expect(shortIds(inView)).not.toContain("SR-0000b2");
  });

  it("[SR-213/AK-ynyk] adds the input's selection to the perspective's, and its sort and grouping replace the stored ones", async () => {
    const { workspace } = await open();
    const name = "Requirements by package";
    // Selection: every part holds, the perspective's and the input's.
    const drafts = await list(workspace, { perspective: name, selection: { where: { status: ["draft"] } } });
    expect(groupLines(drafts)).toEqual([
      "PKG-0000d2: SR-0000b2",
      "PKG-0000d1: SR-0000b2",
      "-: SWR-0000f1 SR-0000b3",
    ]);
    expect(drafts.total).toBe(3);
    // Sort: the input's, also an empty one (workspace order), instead of the stored one.
    const desc = await list(workspace, { perspective: name, sort: [{ by: "title", order: "desc" }] });
    expect(groupLines(desc).at(-1)).toBe("-: SR-0000b3 SR-0000b5 SWR-0000f2 SWR-0000f1");
    const unsorted = await list(workspace, { perspective: name, sort: [] });
    expect(groupLines(unsorted).at(-1)).toBe("-: SR-0000b3 SR-0000b5 SWR-0000f1 SWR-0000f2");
    // Grouping: the input's instead of the stored one.
    const byStatus = await list(workspace, { perspective: name, group: "status" });
    expect(groupLines(byStatus)).toEqual([
      "draft: SWR-0000f1 SR-0000b2 SR-0000b3",
      "approved: SWR-0000f2 SR-0000b1 SR-0000b5",
    ]);
    expect(byStatus.problems).toEqual([]);
  });

  it("[SR-213/AK-ynyk] without an input sort: the selection filter's, then the perspective's, then its filter's, else workspace order", async () => {
    const { workspace } = await open({
      "perspectives/own.yaml": perspective(
        "Own",
        "filter: Requirements\nwhere: { all: [] }\nsort: [{ by: title }]\n",
      ),
      "perspectives/its.yaml": perspective("Its", "filter: Requirements\nwhere: { all: [] }\n"),
      "perspectives/kept.yaml": perspective("Kept", "filter: Requirements\nwhere: { all: [] }\nsort: []\n"),
      "perspectives/none.yaml": perspective("None", "filter: Unsorted\nwhere: { status: [draft] }\n"),
      "perspectives/plain.yaml": perspective("Plain", "where: { status: [draft] }\n"),
    });
    const order = async (input: Record<string, unknown>): Promise<string[]> =>
      shortIds(await list(workspace, input));
    const byTitle = [
      "SWR-0000f1",
      "SWR-0000f2",
      "SR-0000b2",
      "SR-0000b1",
      "SR-0000b5",
      "SR-0000b4",
      "SR-0000b3",
    ];
    expect(await order({ perspective: "Own" })).toEqual(byTitle);
    expect(await order({ perspective: "Its" })).toEqual([...byTitle].reverse());
    // A stored `sort: []` is a sort too: workspace order, not the filter's.
    expect(await order({ perspective: "Kept" })).toEqual([
      "SR-0000b1",
      "SR-0000b2",
      "SR-0000b3",
      "SR-0000b4",
      "SR-0000b5",
      "SWR-0000f1",
      "SWR-0000f2",
    ]);
    expect(await order({ perspective: "None" })).toEqual(["SR-0000b2", "SR-0000b3", "SWR-0000f1"]);
    expect(await order({ perspective: "Plain" })).toEqual([
      "N-0000a2",
      "PKG-0000d2",
      "SR-0000b2",
      "SR-0000b3",
      "SWR-0000f1",
      "VAR-0000c2",
    ]);
    // The sort of the input's saved filter ranks as the input's, above the perspective's.
    expect(await order({ perspective: "Own", selection: { filter: "By ID" } })).toEqual(
      [...byTitle].sort().reverse(),
    );
    // An input's saved filter without a sort leaves the perspective's.
    expect(await order({ perspective: "Own", selection: { filter: "Unsorted" } })).toEqual(byTitle);
  });

  it("[SR-213/AK-tj6p] applies the filter's new condition at the next call, and refuses a missing or faulty filter naming perspective and filter", async () => {
    const { workspace } = await open({
      "perspectives/gone.yaml": perspective("Gone", "filter: Old ones\nwhere: { all: [] }\n"),
      "perspectives/faulty.yaml": perspective("Faulty", "filter: Broken\nwhere: { all: [] }\n"),
    });
    const name = "Requirements by package";
    expect((await list(workspace, { perspective: name })).total).toBe(6);
    await invoke(
      "filter.save",
      {
        name: "Requirements",
        where: { type: ["software-requirement"] },
        sort: [{ by: "title", order: "desc" }],
      },
      { workspace },
    );
    expect(groupLines(await list(workspace, { perspective: name }))).toEqual(["-: SWR-0000f1 SWR-0000f2"]);
    expect(await refusal(workspace, { perspective: "Gone" })).toEqual({
      code: "input.invalid",
      message:
        'Perspective "Gone" (perspectives/gone.yaml): perspective: its saved filter "Old ones" does not exist; filter.list lists them',
      fields: ["perspective"],
    });
    expect(await refusal(workspace, { perspective: "Faulty" })).toEqual({
      code: "file.faulty",
      message:
        'Perspective "Faulty" (perspectives/faulty.yaml): The saved filter "Broken" is in a faulty file (filters/broken.yaml); fix it by hand before it can be used',
      fields: undefined,
    });
  });

  it("[SR-213/AK-zz87] gives the list without groups and a warning when the stored property's values can no longer be chosen", async () => {
    const shared = {
      "requirements/SR-0000000000b6.md": `---\nid: 69069069-0000-4000-8000-0000000000b6\ntype: system-requirement\nstatus: draft\ntitle: Measure the rain\nrequirement-type: functional\nacceptance-criteria: [Given rain, then it holds.]\ntopic: Timing\n---\n`,
      "perspectives/by-topic.yaml": perspective(
        "By topic",
        "where: { type: [system-requirement], subtypes: false }\ngroup: topic\nsort: [{ by: title }]\n",
      ),
    };
    const { fixture, workspace } = await open(shared);
    expect(groupLines(await list(workspace, { perspective: "By topic" }))).toEqual([
      "Timing: SR-0000b2 SR-0000b6",
      "Wind: SR-0000b1",
      "-: SR-0000b5 SR-0000b4 SR-0000b3",
    ]);
    // The topic of the rain is changed by hand: no topic is shared any more, so it offers no values.
    const rain = fixture.path("requirements/SR-0000000000b6.md");
    await fs.writeFile(rain, (await fs.readFile(rain, "utf8")).replace("topic: Timing", "topic: Rain"));
    const later = new Workspace(fixture.root);
    onTestFinished(() => later.close());
    const out = await list(later, { perspective: "By topic" });
    expect(out.groups).toBeUndefined();
    expect(shortIds(out)).toEqual([
      "SR-0000b2",
      "SR-0000b6",
      "SR-0000b1",
      "SR-0000b5",
      "SR-0000b4",
      "SR-0000b3",
    ]);
    expect(out.problems).toEqual([
      {
        code: "perspective.group-unavailable",
        severity: "warning",
        message:
          'Perspective "By topic" (perspectives/by-topic.yaml) groups by topic, whose values can no longer be chosen (more than 30 different values, or none that two elements share); the list is not grouped',
        repository: "system",
        file: "perspectives/by-topic.yaml",
        line: 4,
      },
    ]);
    // With a grouping of its own, the input's holds and nothing is reported.
    const byStatus = await list(later, { perspective: "By topic", group: "status" });
    expect(groupLines(byStatus)[0]).toBe("draft: SR-0000b2 SR-0000b6 SR-0000b3");
    expect(byStatus.problems).toEqual([]);
  });

  it("refuses a stored grouping that is no property with values, naming the perspective and its file", async () => {
    const { workspace } = await open({
      "perspectives/nope.yaml": perspective("Nope", "where: { all: [] }\ngroup: nope\n"),
      "perspectives/kind.yaml": perspective("Kind", "where: { all: [] }\ngroup: derives-from\n"),
    });
    expect(await refusal(workspace, { perspective: "Nope" })).toEqual({
      code: "input.invalid",
      message:
        'Perspective "Nope" (perspectives/nope.yaml): group: nope is no property with values to choose (as element.facets offers them); group by type, status, package or such a property',
      fields: ["group"],
    });
    expect((await refusal(workspace, { perspective: "Kind" })).message).toMatch(
      /^Perspective "Kind" \(perspectives\/kind\.yaml\): group: derives-from is a relation kind/,
    );
    // The input's grouping replaces the stored one before it is read.
    expect((await list(workspace, { perspective: "Nope", group: "status" })).groups?.length).toBe(3);
  });

  it("refuses an unknown or faulty perspective, and errors of its stored where and sort name it", async () => {
    const { workspace } = await open({
      "perspectives/faulty.yaml": perspective("Seen", "view: core\nwhere: { all: [] }\n"),
      "perspectives/where.yaml": perspective("Where", "where: { package: PKG-999999 }\n"),
      "perspectives/sort.yaml": perspective("Sort", "where: { all: [] }\nsort: [{ by: derives-from }]\n"),
      "perspectives/its-sort.yaml": perspective("Its sort", "filter: Bad sort\nwhere: { all: [] }\n"),
      "filters/bad-sort.yaml":
        "reqseq-filter: 1\nname: Bad sort\nwhere: { all: [] }\nsort: [{ by: derives-from }]\n",
    });
    expect(await refusal(workspace, { perspective: "Open ones" })).toEqual({
      code: "input.invalid",
      message: 'perspective: no perspective is named "Open ones"; perspective.list lists them',
      fields: ["perspective"],
    });
    expect(await refusal(workspace, { perspective: "seen" })).toMatchObject({
      code: "file.faulty",
      message:
        'The perspective "seen" is in a faulty file (perspectives/faulty.yaml); fix it by hand before it can be used',
    });
    const where = await refusal(workspace, { perspective: "Where" });
    expect(where.message).toMatch(/^Perspective "Where" \(perspectives\/where\.yaml\): /);
    expect(where.message).toContain("PKG-999999");
    expect((await refusal(workspace, { perspective: "Sort" })).message).toMatch(
      /^Perspective "Sort" \(perspectives\/sort\.yaml\): .*derives-from/,
    );
    expect((await refusal(workspace, { perspective: "Its sort" })).message).toMatch(
      /^Perspective "Its sort" \(perspectives\/its-sort\.yaml\): Saved filter "Bad sort" \(filters\/bad-sort\.yaml\): .*derives-from/,
    );
  });

  it("keeps the view of the perspective's saved filter and reads its where in the selection's view", async () => {
    const { workspace } = await open({
      "perspectives/mountain.yaml": perspective(
        "Mountain drafts",
        "filter: Mountain\nwhere: { status: [draft] }\n",
      ),
    });
    // The filter's view V2 Mountain: b2, valid only for V1, is not in it.
    expect(shortIds(await list(workspace, { perspective: "Mountain drafts" }))).toEqual([
      "SR-0000b3",
      "SWR-0000f1",
    ]);
    // The selection's view holds as well: V1 Coastal leaves out b3, valid only for V2.
    expect(
      shortIds(await list(workspace, { perspective: "Mountain drafts", selection: { view: "VAR-0000c1" } })),
    ).toEqual(["SWR-0000f1"]);
  });

  it("reads the perspective's where in the view of the selection's saved filter, as the selection's where", async () => {
    const { workspace } = await open({
      "perspectives/verified.yaml": perspective("Verified", "where: { verification: [verified] }\n"),
    });
    // Verified in every variant, open in the core.
    const before = workspace.get(evidenceStatusState);
    await before;
    await workspace.replace(
      evidenceStatusState,
      before,
      Promise.resolve({
        verification: (_element, view) => (view.kind === "variant" ? "verified" : "open"),
        validation: () => undefined,
        hasEvidence: () => false,
      }),
    );
    const mountain = await list(workspace, { selection: { filter: "Mountain" } });
    expect(mountain.total).toBeGreaterThan(0);
    // In the view of the filter Mountain (V2): every element of it is verified.
    expect(
      shortIds(await list(workspace, { perspective: "Verified", selection: { filter: "Mountain" } })),
    ).toEqual(shortIds(mountain));
    // The selection's own view wins over its filter's: in the core, none is verified.
    expect(
      (await list(workspace, { perspective: "Verified", selection: { filter: "Mountain", view: "core" } }))
        .total,
    ).toBe(0);
  });

  it("refuses a stored group by package when no property has the meaning packages, naming the perspective", async () => {
    const bare =
      "reqseq-metamodel: 1\ntypes:\n  - { key: need, name: Need, prefix: N, properties: [title] }\nproperties:\n" +
      "  - { key: title, name: Title, kind: text, meaning: title }\nstatuses:\n  - { key: draft, name: Draft, initial: true }\n";
    const { workspace } = await open(
      {
        "metamodel/standard-model.yaml": bare,
        "metamodel/area.yaml": "reqseq-metamodel: 1\n",
        "perspectives/by-package.yaml": perspective("By package", "where: { all: [] }\ngroup: package\n"),
      },
      { fixture: "SR-149/group" },
    );
    const error = await failure(workspace, { perspective: "By package" });
    expect([error.code, error.details?.["meaning"]]).toEqual(["metamodel.meaning-unassigned", "packages"]);
    expect(error.message).toMatch(/^Perspective "By package" \(perspectives\/by-package\.yaml\): /);
  });

  it("says when the perspectives or filters folder is in a repository that is not on this machine (SR-006)", async () => {
    const workspaceFile = (place: string): string =>
      "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
      '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
      '  - { name: vault, url: "ssh://example.com/vault.git", path: ../vault }\n' +
      `metamodel: { repository: system, path: metamodel }\n${place}: { repository: vault, path: ${place} }\n`;
    const perspectives = await open({ "reqseq-workspace.yaml": workspaceFile("perspectives") });
    expect((await refusal(perspectives.workspace, { perspective: "Requirements by package" })).message).toBe(
      'perspective: no perspective is named "Requirements by package"; its folder is in repository vault, which is not on this machine',
    );
    const filters = await open({ "reqseq-workspace.yaml": workspaceFile("filters") });
    expect((await refusal(filters.workspace, { perspective: "Requirements by package" })).message).toBe(
      'Perspective "Requirements by package" (perspectives/by-package.yaml): perspective: its saved filter "Requirements" does not exist; its folder is in repository vault, which is not on this machine',
    );
  });
});

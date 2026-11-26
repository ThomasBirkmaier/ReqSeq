// element.list sorted by the time of the version (SR-075, D-013) on fixtures/SR-075/sort (store
// order N1, N2, b1, b2, b3, b4, f1, f2, f3; see sort.test.ts) as one Git repository: the first
// commit has every file, then b2 and f1 change in a commit each, and b1 changes and goes back to its
// first text in the working copy. b3 holds a counted value without a normal form, so it has no
// version and no time.
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type * as Reader from "../../git/reader.js";
import { fileHistory } from "../../git/reader.js";
import { resolveSelection, sortElements } from "../../query/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
import type { FullList } from "../list.test-helper.js";

vi.mock("../../git/reader.js", async (importOriginal) => {
  const original = await importOriginal<typeof Reader>();
  return { ...original, fileHistory: vi.fn(original.fileHistory) };
});

const P = "75075075-0000-4000-8000-0000000000";
const name = (id: string): string => id.slice(P.length);

const B1 = "requirements/SR-0000000000b1.md";
const B2 = "requirements/SR-0000000000b2.md";
const B4 = "requirements/SR-0000000000b4.md";
const F1 = "requirements/SWR-0000000000f1.md";
/** A new element in no commit; in store order after b4. */
const B5 = "requirements/SR-0000000000b5.md";

/** b3 with a counted value that has no normal form (`.inf`, ADR-0005): it has no version. */
const ENDLESS: FixtureOptions["files"] = {
  "requirements/SR-0000000000b3.md": `---\nid: ${P}b3\ntype: system-requirement\nstatus: obsolete\ntitle: Alarm\nacceptance-criteria: .inf\n---\n\nb3.\n`,
};

const open = async (
  options: FixtureOptions,
): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const append = async (fixture: FixtureWorkspace, file: string, text: string): Promise<void> => {
  await fs.appendFile(fixture.path(file), text);
};

/** The workspace described in the file comment. */
const history = async (): Promise<Workspace> => {
  const { fixture, workspace } = await open({ fixture: "SR-075/sort", git: true, files: ENDLESS });
  await append(fixture, B2, "Changed second.\n");
  await fixture.commit();
  await append(fixture, F1, "Changed third.\n");
  const first = await fs.readFile(fixture.path(B1), "utf8");
  await append(fixture, B1, "Changed last.\n");
  await fixture.commit();
  // Back to the text of the first commit in the working copy only; b4 changed, b5 new.
  await fixture.write(B1, first);
  await append(fixture, B4, "Not committed.\n");
  await fixture.write(
    B5,
    `---\nid: ${P}b5\ntype: system-requirement\nstatus: draft\ntitle: New\n---\n\nb5.\n`,
  );
  return workspace;
};

const list = async (workspace: Workspace, input: Record<string, unknown>): Promise<FullList> =>
  (await invoke("element.list", { limit: 5000, ...input }, { workspace })) as FullList;

const order = async (workspace: Workspace, sort: unknown): Promise<string[]> =>
  (await list(workspace, { sort })).elements.map((e) => name(e.id));

describe("element.list by the time of the version (SR-075)", () => {
  it("[SR-075/AK-qr2j] sorts oldest first or newest first, uncommitted content newer than any commit and elements without a time last", async () => {
    const workspace = await history();
    // Equal times keep the workspace order (AK1).
    expect(await order(workspace, [{ by: "versionDate" }])).toEqual([
      "a1",
      "a2",
      "f2",
      "f3",
      "b2",
      "f1",
      "b1",
      "b4",
      "b5",
      "b3",
    ]);
    expect(await order(workspace, [{ by: "versionDate", order: "desc" }])).toEqual([
      "b1",
      "b4",
      "b5",
      "f1",
      "b2",
      "a1",
      "a2",
      "f2",
      "f3",
      "b3",
    ]);
    // Equal times go to the next key (AK1).
    // Titles descending: "Zero", "New", "Measure wind"; "wind", "Storms", "Log", "Buffer".
    expect(
      await order(workspace, [
        { by: "versionDate", order: "desc" },
        { by: "title", order: "desc" },
      ]),
    ).toEqual(["b4", "b5", "b1", "f1", "b2", "a1", "a2", "f2", "f3", "b3"]);
    // Grouped, each group in that order.
    const grouped = await list(workspace, { group: "type", sort: [{ by: "versionDate" }] });
    expect(grouped.elements.map((e) => name(e.id))).toEqual([
      "f2",
      "f3",
      "f1",
      "a1",
      "a2",
      "b2",
      "b1",
      "b4",
      "b5",
      "b3",
    ]);
    expect(grouped).not.toHaveProperty("problems");
  });

  it("[SR-075/AK-qr2j] puts every element last without Git, ordered as AK1 orders equal values, and says why on each page", async () => {
    const { workspace } = await open({ fixture: "SR-075/sort" });
    const byTitle = await order(workspace, [{ by: "title" }]);
    expect(await order(workspace, [{ by: "versionDate" }, { by: "title" }])).toEqual(byTitle);
    expect(await order(workspace, [{ by: "versionDate", order: "desc" }, { by: "title" }])).toEqual(byTitle);
    const why = [
      {
        code: "version.date-unavailable",
        severity: "warning",
        repository: "system",
        message:
          "Git cannot read repository system (no Git repository there, no git program, or Git refuses it), so the dates of its versions are unknown",
      },
    ];
    for (const offset of [0, 4]) {
      expect((await list(workspace, { sort: [{ by: "versionDate" }], limit: 4, offset })).problems).toEqual(
        why,
      );
    }
    // No sort by the version date: no warning.
    expect(await list(workspace, { sort: [{ by: "title" }] })).not.toHaveProperty("problems");
  });

  it("[SR-075/AK-qr2j] in a shallow clone lists changed elements newest and the committed ones last, naming the shallow clone on each page", async () => {
    const { fixture: origin } = await open({ fixture: "SR-075/sort", git: true, files: ENDLESS });
    const { fixture, workspace } = await open({});
    await fixture.git(["clone", "--quiet", "--depth", "1", pathToFileURL(origin.root).href, "."]);
    await append(fixture, B4, "Not committed.\n");
    const shallow = {
      code: "version.date-unavailable",
      severity: "warning",
      repository: "system",
      message:
        "Repository system is a shallow clone, so Git cannot give the dates of its versions; a clone with the full Git history gives the dates of committed versions",
    };
    const first = await list(workspace, { sort: [{ by: "versionDate", order: "desc" }], limit: 3 });
    expect([first.elements.map((e) => name(e.id)), first.problems]).toEqual([["b4", "a1", "a2"], [shallow]]);
    const next = await list(workspace, { sort: [{ by: "versionDate", order: "desc" }], limit: 3, offset: 3 });
    expect(next.problems).toEqual([shallow]);
    // Only the changed element: no element is last for a reason of SR-254 AK2, so no warning.
    const changed = await list(workspace, { selection: { ids: [`${P}b4`] }, sort: [{ by: "versionDate" }] });
    expect(changed).not.toHaveProperty("problems");
  });

  it("[SR-075/AK-qr2j] lists the elements Git did not date in time last and says the order is not completely determined", async () => {
    const workspace = await history();
    vi.mocked(fileHistory).mockResolvedValueOnce({ known: false, reason: "timeout", detail: "killed" });
    const late = await list(workspace, { sort: [{ by: "versionDate", order: "desc" }] });
    // Every element with a version is late, so all are without a time: the workspace order (AK1).
    expect(late.elements.map((e) => name(e.id))).toEqual([
      "a1",
      "a2",
      "b1",
      "b2",
      "b3",
      "b4",
      "b5",
      "f1",
      "f2",
      "f3",
    ]);
    expect(late.problems).toEqual([
      {
        code: "sort.incomplete",
        severity: "warning",
        repository: "system",
        message:
          "Git did not give the version dates of 9 elements of repository system in time, so the order by versionDate is not completely determined: they are listed last; a new call asks Git again",
      },
    ]);
    vi.mocked(fileHistory).mockResolvedValueOnce({ known: false, reason: "timeout", detail: "killed" });
    const one = await list(workspace, { selection: { ids: [`${P}b1`] }, sort: [{ by: "versionDate" }] });
    expect(one.problems?.map((p) => p.message)).toEqual([
      "Git did not give the version dates of 1 element of repository system in time, so the order by versionDate is not completely determined: they are listed last; a new call asks Git again",
    ]);
    // Asked again, Git answers.
    const again = await list(workspace, { sort: [{ by: "versionDate", order: "desc" }] });
    expect(again.elements.map((e) => name(e.id)).slice(0, 3)).toEqual(["b1", "b4", "b5"]);
    expect(again).not.toHaveProperty("problems");
  });

  it("[SR-075/AK-qr2j] says so in reqif.export too when a stored sort by the version date is not completely determined", async () => {
    const workspace = await history();
    await invoke(
      "filter.save",
      { name: "Newest", where: { all: [] }, sort: [{ by: "versionDate", order: "desc" }] },
      { workspace },
    );
    vi.mocked(fileHistory).mockResolvedValueOnce({ known: false, reason: "timeout", detail: "killed" });
    const exported = (await invoke(
      "reqif.export",
      { output: "newest.reqif", selection: { filter: "Newest" } },
      { workspace },
    )) as { problems: { code: string; repository?: string }[] };
    expect(exported.problems.map((p) => [p.code, p.repository])).toEqual([["sort.incomplete", "system"]]);
  });

  it("[SR-254/AK-v8kj] gives no warning on missing version dates in reqif.export, which names no version date", async () => {
    const { workspace } = await open({ fixture: "SR-075/sort" });
    await invoke(
      "filter.save",
      { name: "Newest", where: { all: [] }, sort: [{ by: "versionDate", order: "desc" }] },
      { workspace },
    );
    const exported = (await invoke(
      "reqif.export",
      { output: "newest.reqif", selection: { filter: "Newest" } },
      { workspace },
    )) as { problems: { code: string }[] };
    expect(exported.problems.map((p) => p.code)).toEqual([]);
    // element.list of the same filter names why (SR-075 AK5).
    expect((await list(workspace, { selection: { filter: "Newest" } })).problems?.map((p) => p.code)).toEqual(
      ["version.date-unavailable"],
    );
  });

  it("needs the times to sort elements by them, not to check the keys", async () => {
    const { workspace } = await open({ fixture: "SR-075/sort" });
    const readOutputElements = (): Promise<never> => Promise.reject(new Error("no selection.output here"));
    const selected = await resolveSelection({ workspace, readOutputElements }, {}, "element.list");
    const context = { ...selected, command: "element.list" } as const;
    const keys = [{ by: "versionDate", order: "asc" }] as const;
    expect(sortElements(context, [], keys).elements).toEqual([]);
    expect(() => sortElements(context, selected.elements, keys)).toThrow(/needs context.values.versionDate/);
  });
});

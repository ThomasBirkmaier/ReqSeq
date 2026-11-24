// baseline.list, baseline.get and baseline.compare through `invoke` (SR-051) on fixtures/SR-061/export
// (Git repositories `system` and `sensor`; its README lists the elements and versions). Each test
// writes the baseline „Release 2“ of PKG-0000d1 at the first commit, then a second commit changes
// SR-0000b1, supersedes and changes SR-0000b2, adds SR-0000b3 to the package and changes N-0000a1.
// The fixture's own `release-1.yaml` stores no selection. CLI end to end: baseline-get.test.ts.
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import fs, { readFile, rm, symlink } from "node:fs/promises";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandName, CommandOutput, InvokedOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import * as files from "../../files/index.js";
import * as model from "../../model/index.js";
import * as query from "../../query/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
import { WRITTEN_VERSION } from "../../model/version-forms.test-helper.js";

vi.mock("../../model/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof model>();
  return { ...original, filesAtCommit: vi.fn(original.filesAtCommit) };
});
vi.mock("../../files/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof files>();
  return { ...original, readElementText: vi.fn(original.readElementText) };
});
vi.mock("../../query/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof query>();
  return { ...original, resolveSelection: vi.fn(original.resolveSelection) };
});

const ID = "61061061-0000-4000-8000-0000000000";
const V = { a1: "n1:9d97d0ccf9b75591", b1: "n1:697a2ad17ed49170", b2: "n1:077d46fbf1a6a93d" };

interface Made {
  readonly ws: FixtureWorkspace;
  /** The commit of the baseline and the one after it, in `system`. */
  readonly first: string;
  readonly second: string;
  /** The committer date of `first`, as version dates are written. */
  readonly firstDate: string;
}

/** A baseline file in the layout of ADR-0018. */
const baselineText = (name: string, selection: string[], commits: string[], elements: string[]): string =>
  [
    "reqseq-baseline: 1",
    `name: ${name}`,
    "date: 2026-11-02T13:00:00Z",
    ...(selection.length === 0 ? [] : ["selection:", ...selection]),
    "repositories:",
    ...commits,
    elements.length === 0 ? "elements: []" : "elements:",
    ...elements,
    "",
  ].join("\n");

const edit = async (ws: FixtureWorkspace, file: string, from: string, to: string): Promise<void> => {
  await ws.write(`system/${file}`, (await readFile(ws.path(`system/${file}`), "utf8")).replace(from, to));
};

/** The fixture with „Release 2“ at the first commit and the changes of the file comment committed. */
const made = async (extra: Readonly<Record<string, (first: string) => string>> = {}): Promise<Made> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-061/export", git: ["system", "sensor"] });
  onTestFinished(() => ws.cleanup());
  const first = await ws.head("system");
  const sensor = await ws.head("sensor");
  const commits = [`  - { name: system, commit: ${first} }`, `  - { name: sensor, commit: ${sensor} }`];
  await ws.write(
    "system/baselines/Release-2.yaml",
    baselineText("Release 2", [`  package: { id: ${ID}d1, title: Display }`], commits, [
      `  - { id: ${ID}a1, version: ${V.a1} }`,
      `  - { id: ${ID}b1, version: ${V.b1} }`,
      `  - { id: ${ID}b2, version: ${V.b2} }`,
      `  - { id: ${ID}e1, version: n1:31d60ac7c791e279 }`,
      `  - { id: ${ID}fe, version: n1:3333333333333333, repository: sensor }`,
    ]),
  );
  for (const [file, text] of Object.entries(extra)) {
    await ws.write(`system/baselines/${file}`, text(first));
  }
  await edit(ws, "requirements/SR-0000000000b1.md", "shows the speed.", "shows the speed in knots.");
  await edit(ws, "requirements/SR-0000000000b2.md", "status: draft", "status: obsolete");
  await edit(ws, "requirements/SR-0000000000b2.md", "within a second", "within two seconds");
  await edit(
    ws,
    "requirements/SR-0000000000b3.md",
    "validity:",
    `packages:\n  - { id: ${ID}d1, version: n1:5862e4d618683af6 }\nvalidity:`,
  );
  await edit(ws, "needs/N-0000000000a1.md", "a1: the need", "a1: the changed need");
  const second = await ws.commit("system", "change");
  const seconds = Number((await ws.git(["log", "-1", "--format=%ct", first], "system")).trim());
  return { ws, first, second, firstDate: `${new Date(seconds * 1000).toISOString().slice(0, 19)}Z` };
};

const call = async <N extends CommandName>(
  ws: FixtureWorkspace,
  name: N,
  input: object,
): Promise<InvokedOutput<N>> => {
  const workspace = new Workspace(ws.path("system"));
  try {
    return (await invoke(name, input, { workspace })) as InvokedOutput<N>;
  } finally {
    await workspace.close();
  }
};

const failure = async (ws: FixtureWorkspace, name: CommandName, input: object): Promise<CommandError> => {
  const error = await call(ws, name, input).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(CommandError);
  return error as CommandError;
};

type Row = CommandOutput<"baseline.get">["elements"][number];
const byId = (rows: readonly Row[]): Record<string, Row> =>
  Object.fromEntries(rows.map((r) => [r.id.slice(-2), r]));

describe("baseline.get", () => {
  it("[SR-051/AK-n6cm] baseline.get shows each element with its baseline version and that version's date", async () => {
    const { ws, first, firstDate } = await made();
    const out = await call(ws, "baseline.get", { baseline: "Release 2" });
    expect(out).toMatchObject({
      name: "Release 2",
      file: "baselines/Release-2.yaml",
      repository: "system",
      date: "2026-11-02T13:00:00Z",
      repositories: [{ name: "system", commit: first }, { name: "sensor" }],
    });
    const rows = byId(out.elements);
    // SR-0000b1 with its version in the baseline and the date of the commit that started it.
    expect(rows["b1"]).toMatchObject({ version: V.b1, versionDate: firstDate });
    expect(rows["a1"]).toMatchObject({ version: V.a1, versionDate: firstDate });
    // The element whose only copy lies in sensor; an entry no file holds has no date.
    expect(rows["e1"]).toMatchObject({ repository: "sensor", version: "n1:31d60ac7c791e279" });
    expect(String(rows["e1"]?.versionDate)).toMatch(/^2026-01-01T/);
    expect(rows["fe"]).toEqual({
      id: `${ID}fe`,
      repository: "sensor",
      state: "missing",
      version: "n1:3333333333333333",
      versionDate: null,
    });
    expect(out.names.map((n) => n.shortId)).toEqual([
      "N-0000a1",
      "SR-0000b1",
      "SR-0000b2",
      "SR-0000e1",
      "SR-0000b3",
    ]);
    // No content of the old version (D-033): only the fields of the catalog.
    expect(Object.keys(rows["b1"] as object).sort()).toEqual([
      "current",
      "id",
      "repository",
      "state",
      "version",
      "versionDate",
    ]);
  });

  it("[SR-051/AK-c0xb] baseline.get marks SR-X changed, SR-Y superseded, SR-Z added; without stored selection no added and it says so", async () => {
    const { ws } = await made();
    const out = await call(ws, "baseline.get", { baseline: "Release 2" });
    const rows = byId(out.elements);
    expect(rows["b1"]).toMatchObject({ state: "changed", version: V.b1 });
    expect(rows["b1"]?.current).not.toBe(V.b1);
    // Changed and superseded is superseded.
    expect(rows["b2"]).toMatchObject({ state: "superseded", version: V.b2 });
    expect(rows["b2"]?.current).toMatch(WRITTEN_VERSION);
    expect(rows["b3"]).toEqual({
      id: `${ID}b3`,
      repository: "system",
      state: "added",
      current: (await call(ws, "element.get", { ref: `${ID}b3` })).element.version,
    });
    expect(out).toMatchObject({ selectionKnown: true, total: 6 });
    expect(out.counts).toEqual({
      unchanged: 0,
      changed: 1,
      superseded: 1,
      removed: 2,
      added: 1,
      missing: 1,
      inaccessible: 0,
    });
    // release-1.yaml stores no selection: nothing added, and selectionKnown says so.
    const without = await call(ws, "baseline.get", { baseline: "release-1" });
    expect(without.selectionKnown).toBe(false);
    expect(without.counts.added).toBe(0);
    expect(without.elements.map((r) => r.state)).toEqual(["changed", "changed", "changed", "missing"]);
  });

  it("[SR-051/AK-ntjw] baseline.get marks SR-W removed; without stored selection no removed", async () => {
    const { ws } = await made();
    const rows = byId((await call(ws, "baseline.get", { baseline: "Release 2" })).elements);
    // Not superseded, no longer in PKG-0000d1, and changed: only removed, with the current version.
    expect(rows["a1"]).toMatchObject({ state: "removed", version: V.a1 });
    expect(rows["a1"]?.current).toMatch(WRITTEN_VERSION);
    expect(rows["a1"]?.current).not.toBe(V.a1);
    // Not changed and not in the package: removed without current.
    expect(rows["e1"]).toMatchObject({ state: "removed" });
    expect(rows["e1"]).not.toHaveProperty("current");
    const without = await call(ws, "baseline.get", { baseline: "release-1" });
    expect(without.counts.removed).toBe(0);
    expect(byId(without.elements)["a1"]).toMatchObject({ state: "changed" });
  });

  it("pages the entries and the added elements and counts them all", async () => {
    const { ws } = await made();
    const out = await call(ws, "baseline.get", { baseline: "Release 2", limit: 2, offset: 4 });
    expect(out.elements.map((r) => [r.id.slice(-2), r.state])).toEqual([
      ["fe", "missing"],
      ["b3", "added"],
    ]);
    expect(out.total).toBe(6);
    expect(out.names.map((n) => n.shortId)).toEqual(["SR-0000b3"]);
  });

  it("resolves a stored view, ids by UUID, copy or short ID, and reports a selection that cannot be resolved now", async () => {
    const commit = (first: string): string[] => [`  - { name: system, commit: ${first} }`];
    const b1 = `  - { id: ${ID}b1, version: ${V.b1} }`;
    const { ws } = await made({
      "Coast.yaml": (first) =>
        baselineText("Coast", [`  view: { id: ${ID}c1, title: Coast }`], commit(first), [
          b1,
          `  - { id: ${ID}e1, version: n1:31d60ac7c791e279, repository: sensor }`,
        ]),
      "Ids.yaml": (first) =>
        baselineText(
          "Ids",
          [
            "  ids:",
            `    - ${ID}b1`,
            `    - { id: ${ID}e1, repository: sensor }`,
            `    - ${ID}e1`,
            "    - SR-0000b4",
          ],
          commit(first),
          [b1],
        ),
      "Gone.yaml": (first) =>
        baselineText(
          "Gone",
          ["  ids:", `    - { id: ${ID}ff, repository: sensor }`, "  package: PKG-0000d1"],
          commit(first),
          [b1],
        ),
      "Nope.yaml": (first) => baselineText("Nope", ["  filter: nope"], commit(first), [b1]),
    });
    // A value that counts and has no normal form: SR-0000b4 has no current version (ADR-0005).
    await edit(
      ws,
      "requirements/SR-0000000000b4.md",
      "requirement-type: functional",
      "requirement-type: .inf",
    );
    const coast = await call(ws, "baseline.get", { baseline: "Coast" });
    expect(coast.view).toBe(`${ID}c1`);
    expect(byId(coast.elements)["e1"]).toMatchObject({ state: "unchanged", repository: "sensor" });
    expect(coast.elements.some((r) => r.id === `${ID}b3`)).toBe(false);
    expect(coast.names.map((n) => n.shortId)).toContain("VAR-0000c1");
    const ids = await call(ws, "baseline.get", { baseline: "Ids" });
    expect(ids.elements.map((r) => [r.id.slice(-2), r.state])).toEqual([
      ["b1", "changed"],
      ["b4", "added"],
      ["e1", "added"],
    ]);
    expect(byId(ids.elements)["b4"]).not.toHaveProperty("current");
    expect(ids.problems).toEqual([
      expect.objectContaining({ code: "baseline.repository-commit-differs", repository: "system" }),
      expect.objectContaining({
        code: "file.faulty",
        severity: "warning",
        file: "requirements/SR-0000000000b4.md",
      }),
    ]);
    const nope = await call(ws, "baseline.get", { baseline: "Nope" });
    expect(nope.problems?.find((p) => p.code === "baseline.invalid")).toBeDefined();
    const gone = await call(ws, "baseline.get", { baseline: "Gone" });
    expect(gone.selectionKnown).toBe(false);
    expect(gone.problems).toEqual([
      expect.objectContaining({ code: "baseline.repository-commit-differs" }),
      expect.objectContaining({ code: "baseline.invalid", severity: "warning", file: "baselines/Gone.yaml" }),
    ]);
  });

  it("refuses an unknown, ambiguous or faulty baseline", async () => {
    const { ws } = await made({
      "Copy.yaml": (first) => baselineText("Release 2", [], [`  - { name: system, commit: ${first} }`], []),
    });
    expect((await failure(ws, "baseline.get", { baseline: "nope" })).details).toMatchObject({
      reason: "unknown-baseline",
    });
    expect((await failure(ws, "baseline.get", { baseline: "Release 2" })).details).toMatchObject({
      reason: "ambiguous-baseline",
    });
    expect((await failure(ws, "baseline.get", { baseline: "broken" })).code).toBe("file.faulty");
  });

  it("warns of each repository here whose HEAD is not the baseline's commit, with and without evidence (#668)", async () => {
    const { ws, first, second } = await made();
    const sensor = await ws.head("sensor");
    await ws.write(
      "system/baselines/Head.yaml",
      baselineText(
        "Head",
        [],
        [
          `  - { name: system, commit: ${second} }`,
          `  - { name: sensor, commit: ${sensor} }`,
          `  - { name: elsewhere, commit: ${first} }`,
        ],
        [],
      ),
    );
    const differs = {
      code: "baseline.repository-commit-differs",
      severity: "warning",
      repository: "system",
      message: `Repository system is at ${second.slice(0, 7)}, the baseline names ${first.slice(0, 7)}; the result reads the files on disk`,
    };
    expect((await call(ws, "baseline.get", { baseline: "Release 2" })).problems).toEqual([differs]);
    const evidence = await call(ws, "baseline.get", { baseline: "Release 2", withEvidence: true });
    expect(evidence.problems).toEqual([differs]);
    // At the baseline's commits, and a repository the workspace does not list: nothing.
    expect((await call(ws, "baseline.get", { baseline: "Head" })).problems).toBeUndefined();
    // sensor at another commit; then without Git, then not here: nothing for it.
    await ws.write("sensor/notes.txt", "later\n");
    const later = await ws.commit("sensor", "later");
    expect((await call(ws, "baseline.get", { baseline: "Head" })).problems).toEqual([
      expect.objectContaining({
        repository: "sensor",
        message: `Repository sensor is at ${later.slice(0, 7)}, the baseline names ${sensor.slice(0, 7)}; the result reads the files on disk`,
      }),
    ]);
    await rm(ws.path("sensor/.git"), { recursive: true });
    expect((await call(ws, "baseline.get", { baseline: "Head" })).problems).toBeUndefined();
    await rm(ws.path("sensor"), { recursive: true });
    expect((await call(ws, "baseline.get", { baseline: "Head" })).problems).toBeUndefined();
  });

  it("is incomplete while a repository is not here, and gives a programming error as it is", async () => {
    const { ws } = await made({
      // An entry naming a repository the workspace file does not list is missing, not inaccessible.
      "Elsewhere.yaml": (first) =>
        baselineText(
          "Elsewhere",
          [],
          [`  - { name: system, commit: ${first} }`],
          [`  - { id: ${ID}fe, version: n1:3333333333333333, repository: elsewhere }`],
        ),
    });
    vi.mocked(query.resolveSelection).mockRejectedValueOnce(new Error("bug"));
    await expect(call(ws, "baseline.get", { baseline: "Release 2" })).rejects.toThrow(
      "Internal error in baseline.get",
    );
    await rm(ws.path("sensor"), { recursive: true });
    const out = await call(ws, "baseline.get", { baseline: "Release 2" });
    expect(out.incomplete).toBe(true);
    // Without `repository` nothing tells it from a deleted element; with it, the entry is inaccessible (D-058, #675).
    expect(byId(out.elements)["e1"]).toMatchObject({ state: "missing" });
    expect(byId(out.elements)["fe"]).toEqual({
      id: `${ID}fe`,
      repository: "sensor",
      state: "inaccessible",
      version: "n1:3333333333333333",
      versionDate: null,
    });
    expect(out.counts).toMatchObject({ missing: 1, inaccessible: 1 });
    const elsewhere = await call(ws, "baseline.get", { baseline: "Elsewhere" });
    expect(elsewhere.elements[0]).toMatchObject({ repository: "elsewhere", state: "missing" });
  });
});

describe("baseline.get: superseded since the baseline, by the status at its commit (SR-051 AK2, #2514)", () => {
  // SR-0000b4 is obsolete in the fixture already at the first commit; SR-0000b2 is superseded (and changed) after it.
  const B4 = "n1:1e68aa41d13d05b1";
  const entries = [`  - { id: ${ID}b2, version: ${V.b2} }`, `  - { id: ${ID}b4, version: ${B4} }`];
  const old =
    (commits: (first: string) => string[]) =>
    (first: string): string =>
      baselineText("Old", [], commits(first), entries);
  const atFirst = old((first) => [`  - { name: system, commit: ${first} }`]);
  const problemsOf = (out: CommandOutput<"baseline.get">): readonly (readonly [string, string])[] =>
    (out.problems ?? []).filter((p) => p.code.startsWith("git.")).map((p) => [p.code, p.message] as const);

  it("[SR-051/AK-c0xb] an element already superseded at the baseline counts as unchanged, one superseded since as superseded", async () => {
    const { ws } = await made({ "old.yaml": atFirst });
    const out = await call(ws, "baseline.get", { baseline: "Old" });
    expect(out.elements.map((r) => [r.id.slice(-2), r.state])).toEqual([
      ["b2", "superseded"],
      ["b4", "unchanged"],
    ]);
    expect(out.counts).toMatchObject({ superseded: 1, unchanged: 1, changed: 0 });
    expect(problemsOf(out)).toEqual([]);
    // baseline.changes, whose counts the overview adds up (#2450), counts the same.
    const changes = await call(ws, "baseline.changes", { baseline: "Old" });
    expect(changes.baseline?.counts).toMatchObject({ superseded: 1, unchanged: 1 });
  });

  it("reads the commit once per workspace, and counts an element no file held then as superseded", async () => {
    const { ws } = await made({ "old.yaml": atFirst });
    // SR-0000b6 is written and superseded after the baseline's commit.
    await ws.write(
      "system/requirements/SR-0000000000b6.md",
      `---\nid: ${ID}b6\ntype: system-requirement\nstatus: obsolete\ntitle: Gone\n---\n\nb6.\n`,
    );
    await ws.commit("system", "b6");
    await ws.write(
      "system/baselines/new.yaml",
      baselineText(
        "New",
        [],
        [`  - { name: system, commit: ${await ws.head("system")} }`],
        [...entries, `  - { id: ${ID}b6, version: n1:6666666666666666 }`],
      ),
    );
    await ws.write(
      "system/baselines/old.yaml",
      (await readFile(ws.path("system/baselines/old.yaml"), "utf8")).replace(
        "elements:\n",
        `elements:\n  - { id: ${ID}b6, version: n1:6666666666666666 }\n`,
      ),
    );
    const workspace = new Workspace(ws.path("system"));
    onTestFinished(() => workspace.close());
    const read = vi.mocked(model.filesAtCommit);
    read.mockClear();
    const get = async (name: string): Promise<CommandOutput<"baseline.get">> =>
      (await invoke("baseline.get", { baseline: name }, { workspace })) as CommandOutput<"baseline.get">;
    const states = (out: CommandOutput<"baseline.get">): string[] =>
      out.elements.map((r) => `${r.id.slice(-2)} ${r.state}`);
    expect(states(await get("Old"))).toEqual(["b6 superseded", "b2 superseded", "b4 unchanged"]);
    expect(states(await get("Old"))).toEqual(["b6 superseded", "b2 superseded", "b4 unchanged"]);
    // One read, and only of the files that differ from the commit: SR-0000b4's bytes are the blob it holds.
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]?.[2].map((a) => a.id.slice(-2))).toEqual(["b6", "b2"]);
    // At the later commit all three files were as they are now, obsolete: the next state that holds (SR-0000b2
    // changed since the version listed), and no file parsed.
    expect(states(await get("New"))).toEqual(["b2 changed", "b4 unchanged", "b6 changed"]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("counts an entry as superseded, with a warning, while its status then cannot be read", async () => {
    const { ws } = await made({
      "none.yaml": (f) =>
        old(() => [`  - { name: sensor, commit: ${f} }`])(f).replace("name: Old", "name: None"),
      "absent.yaml": old(() => [`  - { name: system, commit: ${"e".repeat(40)} }`]),
    });
    const superseded = ["superseded", "superseded"];
    const none = await call(ws, "baseline.get", { baseline: "None" });
    expect(none.elements.map((r) => r.state)).toEqual(superseded);
    expect(problemsOf(none)).toEqual([
      [
        "git.revision-missing",
        "baselines/none.yaml: it names no commit for repository system, so the status of 2 elements of system at the baseline cannot be read; they count as superseded since the baseline",
      ],
    ]);
    const absent = await call(ws, "baseline.get", { baseline: "Old" });
    expect(absent.elements.map((r) => r.state)).toEqual(superseded);
    expect(problemsOf(absent)).toEqual([
      [
        "git.revision-missing",
        "baselines/absent.yaml: repository system has no commit eeeeeee, so the status of 2 elements of system at the baseline cannot be read; they count as superseded since the baseline",
      ],
    ]);
  });

  it("counts an entry as superseded, with a warning, when Git fails or does not have its file", async () => {
    const { ws } = await made({ "old.yaml": atFirst });
    vi.mocked(model.filesAtCommit).mockResolvedValueOnce({
      known: false,
      reason: "refused",
      detail: "dubious ownership",
    });
    // SR-0000b4 is as at the commit (unchanged); SR-0000b2 has to be read.
    const failed = await call(ws, "baseline.get", { baseline: "Old" });
    expect(failed.elements.map((r) => r.state)).toEqual(["superseded", "unchanged"]);
    expect(problemsOf(failed)).toEqual([
      [
        "git.unavailable",
        expect.stringMatching(
          /^baselines\/old\.yaml: Git cannot read commit [0-9a-f]{7} of system \(dubious ownership\), so the status of 1 element of system at the baseline cannot be read; it counts as superseded since the baseline$/,
        ) as unknown as string,
      ],
    ]);
    // A partial clone without the blob of SR-0000b2.
    vi.mocked(model.filesAtCommit).mockResolvedValueOnce({
      known: true,
      kind: "found",
      files: [undefined],
      unread: [0],
    });
    const partial = await call(ws, "baseline.get", { baseline: "Old" });
    expect(partial.elements.map((r) => r.state)).toEqual(["superseded", "unchanged"]);
    expect(problemsOf(partial)).toEqual([
      [
        "git.unavailable",
        expect.stringMatching(
          /^baselines\/old\.yaml: Git does not have the files of commit [0-9a-f]{7} of system here \(a partial clone, or Git refuses to list the commit\), so the status of 1 element of system at the baseline cannot be read; it counts as superseded since the baseline$/,
        ) as unknown as string,
      ],
    ]);
  });
});

describe("baseline.get: when the files on disk cannot be compared with the commit (#2514)", () => {
  const B4 = "n1:1e68aa41d13d05b1";
  const atFirst = (first: string): string =>
    baselineText(
      "Old",
      [],
      [`  - { name: system, commit: ${first} }`],
      [`  - { id: ${ID}b2, version: ${V.b2} }`, `  - { id: ${ID}b4, version: ${B4} }`],
    );
  const asked = (): string[] =>
    (vi.mocked(model.filesAtCommit).mock.calls.at(-1)?.[2] ?? []).map((a) => a.id.slice(-2));

  it("parses a file that cannot be read now, or whose bytes are not those of its record, at the commit", async () => {
    const { ws } = await made({ "old.yaml": atFirst });
    const original = fs.readFile.bind(fs);
    const isB4 = (file: unknown): boolean => String(file).endsWith("SR-0000000000b4.md");
    for (const answer of [
      (): Promise<Buffer> => Promise.reject(new Error("gone")),
      (): Promise<Buffer> => Promise.resolve(Buffer.from("other bytes")),
    ]) {
      // The store is read first; then only the comparison with the commit sees the answer.
      const workspace = new Workspace(ws.path("system"));
      onTestFinished(() => workspace.close());
      await invoke("element.get", { ref: `${ID}b4` }, { workspace });
      const read = vi
        .spyOn(fs, "readFile")
        .mockImplementation(((file: Parameters<typeof fs.readFile>[0], ...rest: unknown[]) =>
          isB4(file)
            ? answer()
            : (original as (...a: unknown[]) => unknown)(file, ...rest)) as typeof fs.readFile);
      try {
        const out = (await invoke(
          "baseline.get",
          { baseline: "Old" },
          { workspace },
        )) as CommandOutput<"baseline.get">;
        expect(out.elements.map((r) => r.state)).toEqual(["superseded", "unchanged"]);
        expect(asked()).toEqual(["b2", "b4"]);
      } finally {
        read.mockRestore();
      }
    }
  });

  it("counts an element no file is found for as not readable while Git refuses to list the commit", async () => {
    const { ws } = await made({ "old.yaml": atFirst });
    vi.spyOn(model.DEFAULT_STATE_READER, "blobs").mockResolvedValueOnce({
      known: false,
      reason: "refused",
      detail: "no trees",
    });
    vi.mocked(model.filesAtCommit).mockResolvedValueOnce({
      known: true,
      kind: "found",
      files: [undefined, undefined],
    });
    const out = await call(ws, "baseline.get", { baseline: "Old" });
    expect(out.elements.map((r) => r.state)).toEqual(["superseded", "superseded"]);
    expect(out.problems?.filter((p) => p.code === "git.unavailable").map((p) => p.message)).toEqual([
      expect.stringContaining(
        "so the status of 2 elements of system at the baseline cannot be read",
      ) as unknown as string,
    ]);
  });
});

describe("baseline.list", () => {
  it("lists the valid baselines with date, number of elements and the variant of a view-only selection", async () => {
    const commit = (first: string): string[] => [`  - { name: system, commit: ${first} }`];
    const { ws } = await made({
      "Coast.yaml": (first) => baselineText("Coast", ["  view: VAR-0000c1"], commit(first), []),
      "Core.yaml": (first) => baselineText("Core", ["  view: core"], commit(first), []),
      "Lost.yaml": (first) => baselineText("Lost", ["  view: VAR-0000ff"], commit(first), []),
      "Mountain.yaml": (first) =>
        baselineText("Mountain", [`  view: { id: ${ID}c2, title: Mountain }`], commit(first), []),
      "Need.yaml": (first) =>
        baselineText("Need", [`  view: { id: ${ID}a1, title: Need }`], commit(first), []),
    });
    const out = await call(ws, "baseline.list", {});
    expect(out.baselines.map((b) => [b.name, b.view, b.elements])).toEqual([
      ["Coast", `${ID}c1`, 0],
      ["Core", undefined, 0],
      ["Lost", undefined, 0],
      ["Mountain", `${ID}c2`, 0],
      ["Need", undefined, 0],
      ["Release 2", undefined, 5],
      ["Release 1", undefined, 4],
    ]);
    expect(out.baselines[5]).toMatchObject({
      file: "baselines/Release-2.yaml",
      repository: "system",
      date: "2026-11-02T13:00:00Z",
    });
    expect(out.location).toEqual({ repository: "system", path: "baselines" });
    expect(out.problems?.map((p) => p.file)).toEqual([
      "baselines/broken.yaml",
      "baselines/broken.yaml",
      "baselines/broken.yaml",
    ]);
    expect(out).not.toHaveProperty("incomplete");
  });
});

describe("copies of one UUID in several repositories (SR-088)", () => {
  /** `made()` plus a repository `extra`, SR-0000f1 in sensor and extra, and a copy of SR-0000b1 in sensor. */
  const withCopies = async (): Promise<Made & { readonly sensor: string }> => {
    const base = await made();
    const { ws } = base;
    await edit(ws, "reqseq-workspace.yaml", "metamodel:", '  - { name: extra, url: "x" }\nmetamodel:');
    const f1 = (await readFile(ws.path("sensor/requirements/SR-0000000000e1.md"), "utf8")).replace(
      `${ID}e1`,
      `${ID}f1`,
    );
    await ws.write("sensor/requirements/SR-0000000000f1.md", f1);
    await ws.write("extra/requirements/SR-0000000000f1.md", f1);
    await ws.write(
      "sensor/requirements/SR-b1.md",
      await readFile(ws.path("system/requirements/SR-0000000000b1.md")),
    );
    const sensor = await ws.commit("sensor", "copies");
    const commits = [
      `  - { name: system, commit: ${base.second} }`,
      `  - { name: sensor, commit: ${sensor} }`,
    ];
    const text = (name: string, elements: string[]): string => baselineText(name, [], commits, elements);
    const e1 = `  - { id: ${ID}e1, version: n1:31d60ac7c791e279`;
    await ws.write(
      "system/baselines/Dup.yaml",
      text("Dup", [`${e1} }`, `${e1}, repository: sensor }`, `  - { id: ${ID}f1, version: ${V.b1} }`]),
    );
    const b1 = `  - { id: ${ID}b1, version: ${V.b1}`;
    await ws.write("system/baselines/Twins.yaml", text("Twins", [`${b1} }`, `${b1}, repository: sensor }`]));
    await ws.write("system/baselines/Sensor.yaml", text("Sensor", [`${b1}, repository: sensor }`]));
    return { ...base, sensor };
  };

  it("shows one row per copy and warns of an entry listed twice or naming no copy", async () => {
    const { ws } = await withCopies();
    const out = await call(ws, "baseline.get", { baseline: "Dup" });
    expect(out.elements.map((r) => [r.id.slice(-2), r.state])).toEqual([
      ["e1", "unchanged"],
      ["f1", "missing"],
    ]);
    expect(out.total).toBe(2);
    expect(
      out.problems?.map((p) => [p.code, p.severity, p.message.includes(`${ID}e1`) ? "e1" : "f1"]),
    ).toEqual([
      ["baseline.invalid", "warning", "e1"],
      ["baseline.invalid", "warning", "f1"],
    ]);
  });

  it("compares the one copy the baseline lists and names the repositories when it lists several", async () => {
    const { ws, sensor } = await withCopies();
    expect(await call(ws, "baseline.compare", { baseline: "Sensor", ref: "SR-0000b1" })).toMatchObject({
      repository: "sensor",
      from: sensor,
      file: "requirements/SR-b1.md",
      command: ["git", "-C", "../sensor", "diff", sensor, sensor, "--", "requirements/SR-b1.md"],
    });
    const twins = await failure(ws, "baseline.compare", { baseline: "Twins", ref: "SR-0000b1" });
    expect([twins.code, twins.details]).toEqual([
      "ref.ambiguous",
      { ref: "SR-0000b1", repositories: ["system", "sensor"] },
    ]);
    const f1 = await failure(ws, "baseline.compare", { baseline: "Dup", ref: `${ID}f1` });
    expect(f1.message).toContain("without repository");
    // The listed copy's file is gone while system still holds SR-0000b1: the listed copy, refused.
    await ws.git(["rm", "-q", "requirements/SR-b1.md"], "sensor");
    const gone = await failure(ws, "baseline.compare", { baseline: "Sensor", ref: "SR-0000b1" });
    expect([gone.code, gone.details]).toMatchObject([
      "element.not-found",
      { repository: "sensor", file: "requirements/SR-b1.md", reason: "missing" },
    ]);
  });
});

describe("baseline.list in a repository that is not here", () => {
  it("lists nothing and says it is incomplete", async () => {
    const { ws } = await made();
    await edit(
      ws,
      "reqseq-workspace.yaml",
      "evidence:",
      "baselines: { repository: sensor, path: baselines }\nevidence:",
    );
    await rm(ws.path("sensor"), { recursive: true });
    expect(await call(ws, "baseline.list", {})).toEqual({
      answer: "Found 0 baselines; incomplete, as a repository is not available.",
      baselines: [],
      location: { repository: "sensor", path: "baselines" },
      incomplete: true,
    });
  });
});

describe("baseline.compare", () => {
  const B1 = "requirements/SR-0000000000b1.md";
  const OLD_B1 = "Given wind, when the station measures it, then it shows the speed.";
  const NEW_B1 = "Given wind, when the station measures it, then it shows the speed in knots.";

  it("[SR-051/AK-dcx7] baseline.compare gives both commits and the git command", async () => {
    const { ws, first, second } = await made();
    expect(await call(ws, "baseline.compare", { baseline: "Release 2", ref: "SR-0000b1" })).toEqual({
      answer:
        "Found 1 difference in text, acceptance criteria, properties and relations of requirements/SR-0000000000b1.md in system from commit be3a664c1ea9 to commit 29b78339451d; the Git command of this output shows the whole diff of the file.",
      repository: "system",
      from: first,
      to: second,
      file: B1,
      command: ["git", "-C", ".", "diff", first, second, "--", B1],
      difference: {
        // The fixture's metamodel gives no property the meaning acceptance-criteria.
        criteria: [],
        properties: [{ key: "acceptance-criteria", before: `- ${OLD_B1}`, after: `- ${NEW_B1}` }],
        addedRelations: [],
        removedRelations: [],
      },
    });
    // Moved since: both paths. Not committed: the working copy (`to: null`).
    await ws.git(["mv", "requirements/SR-0000000000b2.md", "requirements/SR-b2.md"], "system");
    const third = await ws.commit("system", "move");
    await edit(ws, B1, "in knots", "in metres per second");
    expect(await call(ws, "baseline.compare", { baseline: "Release 2", ref: "SR-0000b2" })).toMatchObject({
      to: third,
      file: "requirements/SR-b2.md",
      oldFile: "requirements/SR-0000000000b2.md",
      command: [
        "git",
        "-C",
        ".",
        "diff",
        first,
        third,
        "--",
        "requirements/SR-0000000000b2.md",
        "requirements/SR-b2.md",
      ],
    });
    expect(await call(ws, "baseline.compare", { baseline: "Release 2", ref: "SR-0000b1" })).toMatchObject({
      to: null,
      command: ["git", "-C", ".", "diff", first, "--", B1],
    });
    // The element in sensor: its repository folder relative to the workspace root.
    expect(
      (await call(ws, "baseline.compare", { baseline: "Release 2", ref: "SR-0000e1" })).command.slice(0, 3),
    ).toEqual(["git", "-C", "../sensor"]);
  });

  it("[SR-051/AK-v9hv] baseline.compare gives the old and new wording of each changed text, criterion and property, and the relations added and removed", async () => {
    const { ws, first } = await made();
    // Not committed: the file in the local copy counts. A criterion added, the text, a property and the
    // relations changed; SR-0000b2 only gets a newer stored version of its derives-from target. The
    // metamodel of the local copy decides what counts: here it marks the acceptance criteria.
    await edit(
      ws,
      "metamodel/standard-model.yaml",
      "  - key: acceptance-criteria\n    name: Acceptance Criteria\n",
      "  - key: acceptance-criteria\n    name: Acceptance Criteria\n    meaning: acceptance-criteria\n",
    );
    await edit(
      ws,
      B1,
      "speed in knots.\n",
      'speed in knots.\n  - { key: c4lm, text: "Given calm, then it shows 0." }\n',
    );
    await edit(ws, B1, "b1: valid for", "b1: still valid for");
    await edit(ws, B1, "requirement-type: functional", "requirement-type: performance");
    await edit(
      ws,
      B1,
      `derives-from:\n  - { id: ${ID}a1, version: ${V.a1} }`,
      `refines:\n  - { id: ${ID}b2 }`,
    );
    await edit(ws, "requirements/SR-0000000000b2.md", "n1:0000000000000000", V.a1);
    const out = await call(ws, "baseline.compare", { baseline: "Release 2", ref: "SR-0000b1" });
    expect(out).toMatchObject({ from: first, to: null });
    expect(out.difference).toEqual({
      text: {
        before: "b1: valid for VAR-0000c1, in PKG-0000d1, with an unknown property.\n",
        after: "b1: still valid for VAR-0000c1, in PKG-0000d1, with an unknown property.\n",
      },
      criteria: [
        { numberBefore: 1, numberAfter: 1, before: OLD_B1, after: NEW_B1 },
        { key: "c4lm", numberAfter: 2, after: "Given calm, then it shows 0." },
      ],
      properties: [{ key: "requirement-type", before: "functional", after: "performance" }],
      addedRelations: [{ kind: "refines", id: `${ID}b2` }],
      removedRelations: [{ kind: "derives-from", id: `${ID}a1` }],
    });
    expect(out.answer).toMatch(/^Found 6 differences in text/u);
    const b2 = await call(ws, "baseline.compare", { baseline: "Release 2", ref: "SR-0000b2" });
    expect([
      b2.difference.criteria.length,
      b2.difference.addedRelations,
      b2.difference.removedRelations,
    ]).toEqual([1, [], []]);
    // Unchanged since the baseline: no difference, and the answer says so.
    const e1 = await call(ws, "baseline.compare", { baseline: "Release 2", ref: "SR-0000e1" });
    expect(e1.difference).toEqual({ criteria: [], properties: [], addedRelations: [], removedRelations: [] });
    expect(e1.answer).toMatch(
      /^Found no difference in text, acceptance criteria, properties or relations of /u,
    );
  });

  it("[SR-051/AK-w2b9] baseline.compare refuses a commit of the baseline that is not in the local history and names it", async () => {
    const { ws } = await made();
    const error = await failure(ws, "baseline.compare", { baseline: "release-1", ref: "SR-0000b1" });
    expect([error.code, error.details]).toEqual([
      "git.commit-not-found",
      { repository: "system", commit: "61aa061aa061aa061aa061aa061aa061aa061aa0" },
    ]);
    expect(error.message).toContain("61aa061aa061aa061aa061aa061aa061aa061aa0");
    expect(error.message).toContain("fetch it");
  });

  it("[SR-051/AK-x9z6] baseline.compare refuses, with the reason, what the baseline does not list, a repository without commit or Git, an element no file held, and a file missing or faulty in the local copy", async () => {
    const { ws } = await made({
      "Partial.yaml": (head) =>
        baselineText(
          "Partial",
          [],
          [`  - { name: system, commit: ${head} }`],
          [
            `  - { id: ${ID}e1, version: n1:31d60ac7c791e279, repository: sensor }`,
            `  - { id: ${ID}fd, version: n1:31d60ac7c791e279, repository: nowhere }`,
          ],
        ),
    });
    const refused = async (baseline: string, ref: string): Promise<[string, unknown]> => {
      const error = await failure(ws, "baseline.compare", { baseline, ref });
      return [error.code, error.details];
    };
    expect(await refused("Release 2", "SR-0000b3")).toEqual([
      "input.invalid",
      { command: "baseline.compare", fields: ["ref"], reason: "not-in-baseline" },
    ]);
    expect(await refused("Partial", "SR-0000e1")).toEqual(["git.commit-not-found", { repository: "sensor" }]);
    expect(await refused("Partial", `${ID}fd`)).toEqual(["git.unavailable", { repository: "nowhere" }]);
    // Listed in sensor, but no file there held it at the commit, nor holds it now.
    expect(await refused("Release 2", `${ID}fe`)).toEqual(["ref.unknown", { ref: `${ID}fe` }]);
    expect((await failure(ws, "baseline.compare", { baseline: "Release 2", ref: "SR-0000ff" })).code).toBe(
      "ref.unknown",
    );
    // The file in the local copy cannot be read as an element, then is gone.
    await ws.write("system/needs/N-0000000000a1.md", "---\nid: [\n---\n");
    expect(await refused("Release 2", `${ID}a1`)).toEqual([
      "file.faulty",
      { repository: "system", file: "needs/N-0000000000a1.md", reason: "file.invalid-yaml" },
    ]);
    // A link the store skips at that path.
    await rm(ws.path("system/needs/N-0000000000a1.md"));
    await symlink("N-elsewhere.md", ws.path("system/needs/N-0000000000a1.md"));
    expect(await refused("Release 2", `${ID}a1`)).toEqual([
      "file.faulty",
      { repository: "system", file: "needs/N-0000000000a1.md", reason: "file.skipped" },
    ]);
    await ws.git(["rm", "-qf", "needs/N-0000000000a1.md"], "system");
    const gone = await failure(ws, "baseline.compare", { baseline: "Release 2", ref: `${ID}A1` });
    expect([gone.code, gone.details]).toEqual([
      "element.not-found",
      { ref: `${ID}A1`, repository: "system", file: "needs/N-0000000000a1.md", reason: "missing" },
    ]);
    expect(gone.message).toContain("needs/N-0000000000a1.md");
    await rm(ws.path("sensor/.git"), { recursive: true });
    const noGit = await failure(ws, "baseline.compare", { baseline: "Release 2", ref: "SR-0000e1" });
    expect([noGit.code, (noGit.details as { repository: string }).repository]).toEqual([
      "git.unavailable",
      "sensor",
    ]);
  });

  it("gives a relation target the file at the baseline commit names by another ID than a UUID as stored", async () => {
    const { ws, second } = await made();
    const stored = `derives-from:\n  - { id: ${ID}a1, version: ${V.a1} }`;
    await edit(ws, B1, stored, "derives-from:\n  - { id: SR-0000a1 }");
    const odd = await ws.commit("system", "odd target");
    await ws.write(
      "system/baselines/Odd.yaml",
      baselineText(
        "Odd",
        [],
        [`  - { name: system, commit: ${odd} }`],
        [`  - { id: ${ID}b1, version: ${V.b1} }`],
      ),
    );
    await edit(ws, B1, "derives-from:\n  - { id: SR-0000a1 }", stored);
    // The output is checked against its schema in tests (REQSEQ_VALIDATE_OUTPUT).
    const out = await call(ws, "baseline.compare", { baseline: "Odd", ref: "SR-0000b1" });
    expect([out.difference.removedRelations, out.difference.addedRelations]).toEqual([
      [{ kind: "derives-from", id: "SR-0000a1" }],
      [{ kind: "derives-from", id: `${ID}a1` }],
    ]);
    expect(out.from).not.toBe(second);
  });

  it("refuses when Git or the file changes between its reads", async () => {
    const { ws } = await made();
    const compare = async (): Promise<[string, unknown]> => {
      const error = await failure(ws, "baseline.compare", { baseline: "Release 2", ref: "SR-0000b1" });
      return [error.code, error.details];
    };
    vi.mocked(model.filesAtCommit).mockResolvedValueOnce({
      known: false,
      reason: "timeout",
      detail: "stopped",
    });
    expect(await compare()).toEqual(["git.unavailable", { repository: "system", reason: "timeout" }]);
    vi.mocked(model.filesAtCommit).mockResolvedValueOnce({ known: true, kind: "no-commit" });
    expect(await compare()).toEqual([
      "file.faulty",
      { repository: "system", file: "requirements/SR-0000000000b1.md", reason: "changed" },
    ]);
    vi.mocked(files.readElementText).mockResolvedValueOnce(undefined);
    expect(await compare()).toEqual([
      "file.faulty",
      { repository: "system", file: "requirements/SR-0000000000b1.md", reason: "changed" },
    ]);
  });
});

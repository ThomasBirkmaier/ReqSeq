// baseline.list, baseline.get and baseline.compare through `invoke` (SR-051) on fixtures/SR-061/export
// (Git repositories `system` and `sensor`; its README lists the elements and versions). Each test
// writes the baseline „Release 2“ of PKG-0000d1 at the first commit, then a second commit changes
// SR-0000b1, supersedes and changes SR-0000b2, adds SR-0000b3 to the package and changes N-0000a1.
// The fixture's own `release-1.yaml` stores no selection. CLI end to end: baseline-get.test.ts.
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { readFile, rm } from "node:fs/promises";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandName, CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import * as query from "../../query/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

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
): Promise<CommandOutput<N>> => {
  const workspace = new Workspace(ws.path("system"));
  try {
    return (await invoke(name, input, { workspace })) as CommandOutput<N>;
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
  it("[SR-051/AK1] baseline.get shows each element with its baseline version and that version's date", async () => {
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

  it("[SR-051/AK2] baseline.get marks SR-X changed, SR-Y superseded, SR-Z added; without stored selection no added and it says so", async () => {
    const { ws } = await made();
    const out = await call(ws, "baseline.get", { baseline: "Release 2" });
    const rows = byId(out.elements);
    expect(rows["b1"]).toMatchObject({ state: "changed", version: V.b1 });
    expect(rows["b1"]?.current).not.toBe(V.b1);
    // Changed and superseded is superseded.
    expect(rows["b2"]).toMatchObject({ state: "superseded", version: V.b2 });
    expect(rows["b2"]?.current).toMatch(/^n1:/);
    expect(rows["b3"]).toEqual({
      id: `${ID}b3`,
      repository: "system",
      state: "added",
      current: "n1:4b17a5494b8e80e5",
    });
    expect(out).toMatchObject({ selectionKnown: true, total: 6 });
    expect(out.counts).toEqual({ unchanged: 0, changed: 1, superseded: 1, removed: 2, added: 1, missing: 1 });
    // release-1.yaml stores no selection: nothing added, and selectionKnown says so.
    const without = await call(ws, "baseline.get", { baseline: "release-1" });
    expect(without.selectionKnown).toBe(false);
    expect(without.counts.added).toBe(0);
    expect(without.elements.map((r) => r.state)).toEqual(["changed", "changed", "changed", "missing"]);
  });

  it("[SR-051/AK3] baseline.get marks SR-W removed; without stored selection no removed", async () => {
    const { ws } = await made();
    const rows = byId((await call(ws, "baseline.get", { baseline: "Release 2" })).elements);
    // Not superseded, no longer in PKG-0000d1, and changed: only removed, with the current version.
    expect(rows["a1"]).toMatchObject({ state: "removed", version: V.a1 });
    expect(rows["a1"]?.current).toMatch(/^n1:/);
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
      expect.objectContaining({
        code: "file.faulty",
        severity: "warning",
        file: "requirements/SR-0000000000b4.md",
      }),
    ]);
    expect((await call(ws, "baseline.get", { baseline: "Nope" })).problems?.[0]?.code).toBe(
      "baseline.invalid",
    );
    const gone = await call(ws, "baseline.get", { baseline: "Gone" });
    expect(gone.selectionKnown).toBe(false);
    expect(gone.problems).toEqual([
      expect.objectContaining({ code: "baseline.invalid", severity: "warning", file: "baselines/Gone.yaml" }),
    ]);
  });

  it("refuses an unknown, ambiguous or faulty baseline and withEvidence", async () => {
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
    expect(
      (await failure(ws, "baseline.get", { baseline: "Copy", withEvidence: true })).details,
    ).toMatchObject({ fields: ["withEvidence"] });
  });

  it("is incomplete while a repository is not here, and gives a programming error as it is", async () => {
    const { ws } = await made();
    vi.mocked(query.resolveSelection).mockRejectedValueOnce(new Error("bug"));
    await expect(call(ws, "baseline.get", { baseline: "Release 2" })).rejects.toThrow(
      "Internal error in baseline.get",
    );
    await rm(ws.path("sensor"), { recursive: true });
    const out = await call(ws, "baseline.get", { baseline: "Release 2" });
    expect(out.incomplete).toBe(true);
    expect(byId(out.elements)["e1"]).toMatchObject({ state: "missing" });
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
    // The listed copy's file is gone while system still holds SR-0000b1: the listed copy, at its old path.
    await ws.git(["rm", "-q", "requirements/SR-b1.md"], "sensor");
    expect(await call(ws, "baseline.compare", { baseline: "Sensor", ref: "SR-0000b1" })).toMatchObject({
      repository: "sensor",
      to: null,
      file: "requirements/SR-b1.md",
    });
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
      baselines: [],
      location: { repository: "sensor", path: "baselines" },
      incomplete: true,
    });
  });
});

describe("baseline.compare", () => {
  it("[SR-051/AK4] baseline.compare gives both commits and the git command", async () => {
    const { ws, first, second } = await made();
    const file = "requirements/SR-0000000000b1.md";
    expect(await call(ws, "baseline.compare", { baseline: "Release 2", ref: "SR-0000b1" })).toEqual({
      repository: "system",
      from: first,
      to: second,
      file,
      command: ["git", "-C", ".", "diff", first, second, "--", file],
    });
    // Moved since: both paths. Not committed: the working copy (`to: null`).
    await ws.git(["mv", "requirements/SR-0000000000b2.md", "requirements/SR-b2.md"], "system");
    const third = await ws.commit("system", "move");
    await edit(ws, file, "in knots", "in metres per second");
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
      command: ["git", "-C", ".", "diff", first, "--", file],
    });
    // The element in sensor: its repository folder relative to the workspace root.
    expect(
      (await call(ws, "baseline.compare", { baseline: "Release 2", ref: "SR-0000e1" })).command.slice(0, 3),
    ).toEqual(["git", "-C", "../sensor"]);
  });

  it("takes a listed UUID whose file is gone and refuses what the baseline does not list or has no commit of", async () => {
    const { ws, first } = await made({
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
    await ws.git(["rm", "-q", "needs/N-0000000000a1.md"], "system");
    expect(await call(ws, "baseline.compare", { baseline: "Release 2", ref: `${ID}A1` })).toEqual({
      repository: "system",
      from: first,
      to: null,
      file: "needs/N-0000000000a1.md",
      command: ["git", "-C", ".", "diff", first, "--", "needs/N-0000000000a1.md"],
    });
    expect((await failure(ws, "baseline.compare", { baseline: "Release 2", ref: `${ID}fe` })).code).toBe(
      "ref.unknown",
    );
    expect((await failure(ws, "baseline.compare", { baseline: "Release 2", ref: "SR-0000ff" })).code).toBe(
      "ref.unknown",
    );
    expect(
      (await failure(ws, "baseline.compare", { baseline: "Release 2", ref: "SR-0000b3" })).details,
    ).toMatchObject({ reason: "not-in-baseline" });
    expect((await failure(ws, "baseline.compare", { baseline: "release-1", ref: "SR-0000b1" })).code).toBe(
      "git.commit-not-found",
    );
    expect(
      (await failure(ws, "baseline.compare", { baseline: "release-1", ref: "SR-0000b1" })).details,
    ).toEqual({ repository: "system", commit: "61aa061aa061aa061aa061aa061aa061aa061aa0" });
    expect(
      (await failure(ws, "baseline.compare", { baseline: "Partial", ref: "SR-0000e1" })).details,
    ).toEqual({
      repository: "sensor",
    });
    expect((await failure(ws, "baseline.compare", { baseline: "Partial", ref: `${ID}fd` })).details).toEqual({
      repository: "nowhere",
    });
    await rm(ws.path("sensor/.git"), { recursive: true });
    expect((await failure(ws, "baseline.compare", { baseline: "Release 2", ref: "SR-0000e1" })).code).toBe(
      "git.unavailable",
    );
  });
});

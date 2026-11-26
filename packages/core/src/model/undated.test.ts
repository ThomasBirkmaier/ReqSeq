// Why a version has no date (SR-254), through `invoke` on fixtures/SR-001/two-elements (SR-e88fb3 and SR-4a5b6c in
// the repository `system`) and fixtures/SR-061/export (Git repositories `system` and `sensor`; `release-1.yaml` lists
// a1 and b1 at their current versions, b3 at a version no commit holds and ff, which no element file holds), and
// `classifyUndated` for the answers of Git a fixture cannot give. The sort of SR-075 AK5: sort-version-date.test.ts.
import { readFile, rm, unlink } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandName, InvokedOutput } from "../catalog.js";
import type * as Reader from "../git/reader.js";
import { changedPaths, headCommit, headFiles, openObjectReader, symbolicHead } from "../git/reader.js";
import type { Problem } from "../generated/types.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { elementStoreState } from "./store.js";
import type * as Uncommitted from "./uncommitted.js";
import { uncommittedFiles } from "./uncommitted.js";
import { classifyUndated, undatedProblems } from "./undated.js";

vi.mock("../git/reader.js", async (importOriginal) => {
  const original = await importOriginal<typeof Reader>();
  return {
    ...original,
    headCommit: vi.fn(original.headCommit),
    headFiles: vi.fn(original.headFiles),
    symbolicHead: vi.fn(original.symbolicHead),
    changedPaths: vi.fn(original.changedPaths),
    openObjectReader: vi.fn(original.openObjectReader),
  };
});
vi.mock("./uncommitted.js", async (importOriginal) => {
  const original = await importOriginal<typeof Uncommitted>();
  return { ...original, uncommittedFiles: vi.fn(original.uncommittedFiles) };
});

const WIND = "requirements/SR-6328cee88fb3.md";
const ID = "61061061-0000-4000-8000-0000000000";

const fixture = async (options: FixtureOptions): Promise<FixtureWorkspace> => {
  const ws = await createFixtureWorkspace(options);
  onTestFinished(() => ws.cleanup());
  return ws;
};

const open = (root: string): Workspace => {
  const workspace = new Workspace(root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const call = async <N extends CommandName>(
  workspace: Workspace,
  name: N,
  input: object,
): Promise<InvokedOutput<N>> => (await invoke(name, input, { workspace })) as InvokedOutput<N>;

/** The warnings of SR-254 among `problems`, as code, repository and message. */
const undated = (problems: readonly Problem[] | undefined): string[][] =>
  (problems ?? [])
    .filter((p) => p.code.startsWith("version."))
    .map((p) => [p.code, String(p.repository), p.message]);

/** The SR-254 warnings of element.get with the version date of `ref`. */
const dated = async (workspace: Workspace, ref = "SR-e88fb3", command: CommandName = "element.get") => {
  const out = (await call(workspace, command as "element.get", { ref, versionDate: true })).element;
  return { date: out.versionDate, warnings: undated(out.problems) };
};

const SHALLOW =
  "Repository system is a shallow clone, so Git cannot give the dates of its versions; a clone with the full Git history gives the dates of committed versions";
const NO_GIT =
  "Git cannot read repository system (no Git repository there, no git program, or Git refuses it), so the dates of its versions are unknown";

/**
 * A shallow clone of fixtures/SR-001/two-elements with SR-e88fb3 embedding an image, and one in a nested repository
 * that does not count (ADR-0005).
 */
const shallowClone = async (): Promise<FixtureWorkspace> => {
  const origin = await fixture({
    fixture: "SR-001/two-elements",
    git: true,
    files: {
      [WIND]:
        "---\nid: e8df96ea-a168-4d90-8d65-6328cee88fb3\ntype: system-requirement\nstatus: draft\ntitle: Show wind speed\n---\n\nThe station shows the current wind speed. ![Map](../images/map.png) ![Inner](../inner/pic.png)\n",
      "images/map.png": "map",
    },
  });
  const shallow = await fixture({});
  await shallow.git(["clone", "--quiet", "--depth", "1", pathToFileURL(origin.root).href, "."]);
  await shallow.write("inner/pic.png", "inner");
  await shallow.git(["init", "--quiet"], "inner");
  return shallow;
};

describe("why a version has no date (SR-254)", () => {
  it("[SR-254/AK-j540] says once per repository that Git cannot read it, also for several elements", async () => {
    const ws = await fixture({ fixture: "SR-001/two-elements" });
    const workspace = open(ws.root);
    expect(await dated(workspace)).toEqual({
      date: null,
      warnings: [["version.date-unavailable", "system", NO_GIT]],
    });
    const [system] = await classifyUndated(
      workspace,
      (await workspace.get(elementStoreState)).elements.map((element) => ({
        repository: "system",
        id: element.id,
        element,
        version: "n1:0123456789abcdef",
      })),
    );
    expect(undatedProblems(system === undefined ? [] : [system]).map((p) => p.message)).toEqual([NO_GIT]);
  });

  it("[SR-254/AK-j540] names a shallow clone and what gives the dates of committed versions", async () => {
    const ws = await shallowClone();
    expect(await dated(open(ws.root))).toEqual({
      date: null,
      warnings: [["version.date-unavailable", "system", SHALLOW]],
    });
  });

  it("[SR-254/AK-j540] names a repository that is not on this machine", async () => {
    const ws = await fixture({ fixture: "SR-061/export", git: ["system", "sensor"] });
    await ws.write(
      "system/baselines/sensor.yaml",
      `reqseq-baseline: 1\nname: Sensor\ndate: 2026-11-02T13:00:00Z\nrepositories:\n  - { name: system, commit: 61aa061aa061aa061aa061aa061aa061aa061aa0 }\nelements:\n  - { id: ${ID}e1, version: n1:31d60ac7c791e279, repository: sensor }\n`,
    );
    await rm(ws.path("sensor"), { recursive: true });
    const got = await call(open(ws.path("system")), "baseline.get", { baseline: "Sensor" });
    expect(got.elements.map((r) => [r.state, r.versionDate])).toEqual([["inaccessible", null]]);
    expect(undated(got.problems)).toEqual([
      [
        "version.date-unavailable",
        "sensor",
        "Repository sensor is not on this machine, so the dates of its versions are unknown",
      ],
    ]);
  });

  it("[SR-254/AK-j540] tells Git that is missing or refuses the repository from one that did not answer in time", async () => {
    const ws = await fixture({ fixture: "SR-001/two-elements", git: true });
    const workspace = open(ws.root);
    const [element] = (await workspace.get(elementStoreState)).elements;
    const reasonOf = async (): Promise<string[]> =>
      undatedProblems(
        await classifyUndated(workspace, [
          { repository: "system", id: String(element?.id), version: "n1:0123456789abcdef" },
        ]),
      ).map((p) => p.code);
    const unknown = (reason: Reader.GitUnknownReason): Reader.GitUnknown => ({
      known: false,
      reason,
      detail: "",
    });
    vi.mocked(headCommit).mockResolvedValueOnce(unknown("no-git"));
    expect(await reasonOf()).toEqual(["version.date-unavailable"]);
    vi.mocked(headCommit).mockResolvedValueOnce(unknown("refused"));
    expect(await reasonOf()).toEqual(["version.date-unavailable"]);
    // A HEAD that names no commit: unreadable unless it names a branch that has none yet.
    vi.mocked(headCommit).mockResolvedValueOnce(unknown("not-a-repository"));
    vi.mocked(symbolicHead).mockResolvedValueOnce(unknown("refused"));
    expect(await reasonOf()).toEqual(["version.date-unavailable"]);
    vi.mocked(headCommit).mockResolvedValueOnce(unknown("not-a-repository"));
    vi.mocked(symbolicHead).mockResolvedValueOnce({ known: true });
    vi.mocked(headFiles).mockResolvedValueOnce({ stamp: "", shallow: false, commit: "0".repeat(40) });
    expect(await reasonOf()).toEqual(["version.date-unavailable"]);
    // Late: no reason is claimed.
    vi.mocked(headCommit).mockResolvedValueOnce(unknown("timeout"));
    expect(await reasonOf()).toEqual(["version.date-unknown"]);
    vi.mocked(headCommit).mockResolvedValueOnce(unknown("not-a-repository"));
    vi.mocked(symbolicHead).mockResolvedValueOnce(unknown("timeout"));
    expect(await reasonOf()).toEqual(["version.date-unknown"]);
    // A version without an element file is never committed; nothing at all asks nothing.
    expect(await classifyUndated(workspace, [])).toEqual([]);
  });

  it("[SR-254/AK-j82g] counts the elements not committed, also in a shallow clone and a repository without a commit", async () => {
    const ws = await fixture({ fixture: "SR-001/two-elements", git: true });
    await ws.write(WIND, `${await readFile(ws.path(WIND), "utf8")}Changed.\n`);
    await ws.write(
      "requirements/SR-00000000f001.md",
      "---\nid: 25425425-0000-4000-8000-00000000f001\ntype: system-requirement\nstatus: draft\ntitle: New\n---\n\nNew.\n",
    );
    const workspace = open(ws.root);
    const one = [
      "version.uncommitted",
      "system",
      "1 element of repository system has no version date: the version is not committed (its content differs from the last commit, or its file is in no commit)",
    ];
    expect(await dated(workspace)).toEqual({ date: null, warnings: [one] });
    expect(await dated(workspace, "SR-00f001")).toEqual({ date: null, warnings: [one] });
    // The other element is committed and dated: nothing (AK4).
    expect((await dated(workspace, "SR-4a5b6c")).warnings).toEqual([]);

    // A shallow clone: a changed text, a new file, or only a changed image, is not committed; no shallow warning then.
    const shallow = await shallowClone();
    const other = "requirements/SR-1d2e3f4a5b6c.md";
    await shallow.write(other, `${await readFile(shallow.path(other), "utf8")}Changed.\n`);
    await shallow.write("images/map.png", "another map");
    await shallow.write(
      "requirements/SR-00000000f001.md",
      "---\nid: 25425425-0000-4000-8000-00000000f001\ntype: system-requirement\nstatus: draft\ntitle: New\n---\n\nNew.\n",
    );
    const clone = open(shallow.root);
    expect(await dated(clone, "SR-4a5b6c")).toEqual({ date: null, warnings: [one] });
    expect(await dated(clone, "SR-00f001")).toEqual({ date: null, warnings: [one] });
    expect(await dated(clone)).toEqual({ date: null, warnings: [one] });
    // Where Git cannot tell the files, the images or the committed texts, the shallow clone is named.
    const timeout = { known: false, reason: "timeout", detail: "" } as const;
    vi.mocked(changedPaths).mockResolvedValueOnce(timeout);
    expect((await dated(clone)).warnings).toEqual([["version.date-unavailable", "system", SHALLOW]]);
    vi.mocked(uncommittedFiles).mockResolvedValueOnce(timeout);
    expect((await dated(clone)).warnings).toEqual([["version.date-unavailable", "system", SHALLOW]]);
    vi.mocked(openObjectReader).mockReturnValueOnce({
      info: () => Promise.resolve(timeout),
      read: () => Promise.resolve(timeout),
      close: () => undefined,
    });
    expect((await dated(clone, "SR-4a5b6c")).warnings).toEqual([
      ["version.date-unavailable", "system", SHALLOW],
    ]);
    // An element file gone since the workspace read it is not committed.
    const kept = (await clone.get(elementStoreState)).elements.filter((e) => e.file === other);
    const version = String((await call(clone, "element.get", { ref: "SR-4a5b6c" })).element.version);
    const classify = async (): Promise<number[]> =>
      (
        await classifyUndated(
          clone,
          kept.map((element) => ({ repository: "system", id: element.id, element, version })),
        )
      ).map((r) => r.uncommitted.length);
    // HEAD files that name another commit than git does: the diff is asked again for that of git.
    vi.mocked(headFiles).mockResolvedValueOnce({ stamp: "", shallow: true, commit: "0".repeat(40) });
    expect(await classify()).toEqual([1]);
    await unlink(shallow.path(other));
    expect(await classify()).toEqual([1]);

    // A Git repository without a commit: every current version is not committed.
    const empty = await fixture({ fixture: "SR-001/two-elements" });
    await empty.git(["init", "--quiet"]);
    const opened = open(empty.root);
    expect(await dated(opened, "SR-4a5b6c", "element.resolve")).toEqual({
      date: null,
      warnings: [one],
    });
    // Two of them, counted in the text.
    const elements = (await opened.get(elementStoreState)).elements;
    const versions = await Promise.all(
      elements.map(
        async (element) => (await call(opened, "element.get", { ref: element.id })).element.version,
      ),
    );
    const both = await classifyUndated(
      opened,
      elements.map((element, i) => ({
        repository: "system",
        id: element.id,
        element,
        version: String(versions[i]),
      })),
    );
    expect(undatedProblems(both).map((p) => p.message)).toEqual([
      "2 elements of repository system have no version date: the version is not committed (its content differs from the last commit, or its file is in no commit)",
    ]);
  });

  it("[SR-254/AK-j82g] does not count a text re-saved with other line endings or spaces at line ends in a shallow clone", async () => {
    const shallow = await shallowClone();
    const text = await readFile(shallow.path(WIND), "utf8");
    await shallow.write(WIND, text.replace(/\)\n$/, ")   \n").replace(/\n/g, "\r\n"));
    expect(await dated(open(shallow.root))).toEqual({
      date: null,
      warnings: [["version.date-unavailable", "system", SHALLOW]],
    });
  });

  it("[SR-254/AK-j82g] counts the versions Git cannot date, and the elements not committed apart", async () => {
    const ws = await fixture({ fixture: "SR-061/export", git: ["system", "sensor"] });
    const b1 = `system/requirements/SR-0000000000b1.md`;
    await ws.write(
      "system/baselines/now.yaml",
      [
        "reqseq-baseline: 1",
        "name: Now",
        "date: 2026-11-02T13:00:00Z",
        "repositories:",
        "  - { name: system, commit: 61aa061aa061aa061aa061aa061aa061aa061aa0 }",
        "elements:",
        `  - { id: ${ID}a1, version: n1:0000000000000001 }`,
        `  - { id: ${ID}b3, version: n1:1111111111111111 }`,
        `  - { id: ${ID}ff, version: n1:2222222222222222 }`,
        "",
      ].join("\n"),
    );
    await ws.write(b1, `${await readFile(ws.path(b1), "utf8")}Changed.\n`);
    const workspace = open(ws.path("system"));
    const got = await call(workspace, "baseline.get", { baseline: "Now" });
    expect(got.elements.map((r) => r.versionDate)).toEqual([null, null, null]);
    expect(undated(got.problems)).toEqual([
      [
        "version.date-unknown",
        "system",
        "Git cannot give the version date of 3 elements of repository system: no commit holds the version, or a Git call failed or did not answer in time",
      ],
    ]);
    // The current version of b1, not committed: its own warning.
    const version = (await call(workspace, "element.get", { ref: "SR-0000b1" })).element.version;
    await ws.write(
      "system/baselines/current.yaml",
      `reqseq-baseline: 1\nname: Current\ndate: 2026-11-02T13:00:00Z\nrepositories:\n  - { name: system, commit: 61aa061aa061aa061aa061aa061aa061aa061aa0 }\nelements:\n  - { id: ${ID}b1, version: ${String(version)} }\n  - { id: ${ID}b3, version: n1:1111111111111111 }\n`,
    );
    const current = await call(open(ws.path("system")), "baseline.get", { baseline: "Current" });
    expect(undated(current.problems).map(([code, , message]) => [code, message])).toEqual([
      [
        "version.uncommitted",
        "1 element of repository system has no version date: the version is not committed (its content differs from the last commit, or its file is in no commit)",
      ],
      [
        "version.date-unknown",
        "Git cannot give the version date of 1 element of repository system: no commit holds the version, or a Git call failed or did not answer in time",
      ],
    ]);
  });

  it("[SR-254/AK-mnrr] warns for no repository whose versions all have a date, also beside one that does not", async () => {
    const ws = await fixture({ fixture: "SR-061/export", git: ["system", "sensor"] });
    const text = (name: string, e1: string): string =>
      `reqseq-baseline: 1\nname: ${name}\ndate: 2026-11-02T13:00:00Z\nrepositories:\n  - { name: system, commit: 61aa061aa061aa061aa061aa061aa061aa061aa0 }\nelements:\n  - { id: ${ID}a1, version: n1:9d97d0ccf9b75591 }\n  - { id: ${ID}e1, version: ${e1}, repository: sensor }\n`;
    await ws.write("system/baselines/dated.yaml", text("Dated", "n1:31d60ac7c791e279"));
    await ws.write("system/baselines/sensor.yaml", text("Sensor", "n1:3333333333333333"));
    const workspace = open(ws.path("system"));
    const all = await call(workspace, "baseline.get", { baseline: "Dated" });
    expect(all.elements.every((r) => typeof r.versionDate === "string")).toBe(true);
    expect(undated(all.problems)).toEqual([]);
    const one = await call(workspace, "baseline.get", { baseline: "Sensor" });
    expect(undated(one.problems).map(([code, repository]) => [code, repository])).toEqual([
      ["version.date-unknown", "sensor"],
    ]);
    // A dated element: nothing.
    expect((await dated(workspace, "N-0000a1")).warnings).toEqual([]);
  });

  it("[SR-254/AK-v8kj] gives the warnings only where the output names the date of a version itself", async () => {
    const ws = await fixture({
      fixture: "SR-001/two-elements",
      files: {
        "requirements/SR-00000000f002.md":
          "---\nid: 25425425-0000-4000-8000-00000000f002\ntype: system-requirement\nstatus: draft\ntitle: Endless\nacceptance-criteria: .inf\n---\n\nEndless.\n",
      },
    });
    const workspace = open(ws.root);
    const codes = (problems: readonly Problem[] | undefined): string[] =>
      (problems ?? []).map((p) => p.code).filter((code) => code.startsWith("version."));
    // element.get and element.resolve with the date; without it, or with the hint dates only, none.
    expect((await dated(workspace)).warnings).toHaveLength(1);
    expect((await dated(workspace, "SR-e88fb3", "element.resolve")).warnings).toHaveLength(1);
    expect(codes((await call(workspace, "element.get", { ref: "SR-e88fb3" })).element.problems)).toEqual([]);
    expect(
      codes((await call(workspace, "element.get", { ref: "SR-e88fb3", hintDates: true })).element.problems),
    ).toEqual([]);
    // An element without a version has its file.faulty, not a warning on its date.
    const endless = (await call(workspace, "element.get", { ref: "SR-00f002", versionDate: true })).element;
    expect([endless.version, codes(endless.problems)]).toEqual([undefined, []]);
    expect(endless.problems?.map((p) => p.code)).toContain("file.faulty");
    // Other outputs give none.
    expect(codes((await call(workspace, "element.list", {})).problems)).toEqual([]);
    expect(codes((await call(workspace, "workspace.check", {})).problems)).toEqual([]);
  });

  it("[SR-254/AK-v8kj] gives each warning of html.export once for all pages, and the pages do not change", async () => {
    const ws = await fixture({ fixture: "SR-061/export", git: ["system", "sensor"] });
    const baseline = (name: string, b3: string): string =>
      `reqseq-baseline: 1\nname: ${name}\ndate: 2026-11-02T13:00:00Z\nselection:\n  ids: [${ID}b3]\nrepositories:\n  - { name: system, commit: 61aa061aa061aa061aa061aa061aa061aa061aa0 }\nelements:\n  - { id: ${ID}b3, version: ${b3} }\n`;
    await rm(ws.path("system/baselines/release-1.yaml"));
    await ws.write("system/baselines/one.yaml", baseline("One", "n1:1111111111111111"));
    await ws.write("system/baselines/two.yaml", baseline("Two", "n1:4444444444444444"));
    const workspace = open(ws.path("system"));
    for (const name of ["One", "Two"]) {
      expect(undated((await call(workspace, "baseline.get", { baseline: name })).problems)).toHaveLength(1);
    }
    const out = await call(workspace, "html.export", { output: "site" });
    // b3 in two baselines at two versions without date: one element, one warning.
    expect(undated(out.problems)).toEqual([
      [
        "version.date-unknown",
        "system",
        "Git cannot give the version date of 1 element of repository system: no commit holds the version, or a Git call failed or did not answer in time",
      ],
    ]);
    const page = await readFile(ws.path(`system/site/elements/${ID}b3.html`), "utf8");
    expect(page).toContain("version in the baseline n1:1111111111111111</p>");
    expect(page).not.toContain("Git cannot give");
  });
});

// The date of a version (D-013, ADR-0005 "Version date"). Every history is made with one
// `git fast-import` (`commitHistory`) and checked out with one reset, so each test starts few git
// processes (slow Windows runners, ThomasBirkmaier/ReqSeq-archive#206, ThomasBirkmaier/ReqSeq-archive#226).
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace, HistoryCommitSpec, MadeCommit } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { CommandError } from "../catalog.js";
import type { CommandOutput } from "../catalog.js";
import { parseFileBytes } from "../files/index.js";
import type * as Reader from "../git/reader.js";
import type { GitUnknown, ObjectInfos, ObjectReader } from "../git/reader.js";
import {
  commitBlobs,
  commitsBetween,
  fileHistory,
  firstParentChanges,
  fileMoves,
  headCommit,
  headFiles,
  historyRange,
  openObjectReader,
} from "../git/reader.js";
import { metamodelState } from "../metamodel/index.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type * as Images from "./images.js";
import { inNestedRepository } from "./images.js";
import type { VersionDateContext, VersionDateRequest } from "./version-date.js";
import {
  metamodelChange,
  prepareVersionDates,
  undatedCause,
  versionDates,
  versionStarts,
  versionTimes,
} from "./version-date.js";
import { elementVersion, elementVersions } from "./view.js";

// The real reader and nested check, wrapped so that tests count git calls and make one fail.
vi.mock("../git/reader.js", async (importOriginal) => {
  const original = await importOriginal<typeof Reader>();
  return {
    ...original,
    headCommit: vi.fn(original.headCommit),
    headFiles: vi.fn(original.headFiles),
    fileHistory: vi.fn(original.fileHistory),
    fileMoves: vi.fn(original.fileMoves),
    firstParentChanges: vi.fn(original.firstParentChanges),
    historyRange: vi.fn(original.historyRange),
    commitBlobs: vi.fn(original.commitBlobs),
    commitsBetween: vi.fn(original.commitsBetween),
    openObjectReader: vi.fn(original.openObjectReader),
  };
});
vi.mock("./images.js", async (importOriginal) => {
  const original = await importOriginal<typeof Images>();
  return { ...original, inNestedRepository: vi.fn(original.inNestedRepository) };
});

const actual = await vi.importActual<typeof Reader>("../git/reader.js");

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const FILE = "requirements/SR-111111111111.md";
const FILE2 = "requirements/SR-222222222222.md";
const THIRD = "33333333-3333-4333-8333-333333333333";
/** An element file in another folder than `FILE`: git is then asked with another path (#252). */
const ELSEWHERE = "needs/N-333333333333.md";

/** An element file of the standard model; `more` adds frontmatter lines. */
const element = (text: string, more = "", id = ID, title = "Wind", status = "draft"): string =>
  `---\nid: ${id}\ntype: system-requirement\nstatus: ${status}\ntitle: ${title}\n${more}---\n\n${text}\n`;

interface Repository {
  readonly fixture: FixtureWorkspace;
  readonly workspace: Workspace;
  readonly made: Readonly<Record<string, MadeCommit>>;
}

/** The workspace of `SR-001/two-elements` as a repository with `commits`, the last one checked out. */
const repository = async (commits: readonly HistoryCommitSpec[]): Promise<Repository> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-001/two-elements" });
  onTestFinished(() => fixture.cleanup());
  await fixture.git(["init", "--quiet", "--initial-branch=main"]);
  const made = commits.length === 0 ? {} : await fixture.commitHistory(commits, { branch: "main" });
  if (commits.length > 0) {
    await fixture.git(["reset", "--hard", "--quiet"]);
  }
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  vi.clearAllMocks();
  return { fixture, workspace, made };
};

/** The committer date of a made commit as ADR-0005 gives it: UTC with `Z`, whole seconds. */
const at = (repo: Repository, name: string): string =>
  String(repo.made[name]?.date.toISOString().replace(".000Z", "Z"));

const context = async (workspace: Workspace): Promise<VersionDateContext> => ({
  workspace,
  layout: await workspace.get(workspaceLayoutState),
  metamodel: await workspace.get(metamodelState),
});

const dates = async (
  workspace: Workspace,
  requests: readonly Partial<VersionDateRequest>[],
): Promise<(string | null)[]> =>
  versionDates(
    await context(workspace),
    requests.map((r) => ({ repository: "system", file: FILE, id: ID, version: "", ...r })),
  );

const sha256 = (content: string | Uint8Array): string => createHash("sha256").update(content).digest("hex");

/**
 * The version of the element in `text` (ADR-0005) with the images by their path in the text:
 * content, or null for missing. In `form`, or by default in the form the tool writes.
 */
const versionOf = async (
  workspace: Workspace,
  text: string,
  images: Readonly<Record<string, string | null>> = {},
  form?: "n1" | "n2",
): Promise<string> => {
  const parsed = parseFileBytes(FILE, Buffer.from(text));
  if (parsed.kind !== "parsed") {
    throw new Error("not an element file");
  }
  const data = parsed.content.data as Readonly<Record<string, unknown>>;
  const record = { type: String(data["type"]), data };
  const metamodel = await workspace.get(metamodelState);
  const files = Object.entries(images).map(([path, content]) => ({
    path,
    sha256: content === null ? null : sha256(content),
  }));
  return form === undefined
    ? elementVersion(record, parsed.content.body, metamodel, files)
    : elementVersions(record, parsed.content.body, metamodel, files)[form];
};

type Shown = CommandOutput<"element.get">["element"];

const get = async (workspace: Workspace, ref = ID): Promise<Shown> =>
  ((await invoke("element.get", { ref, versionDate: true }, { workspace })) as CommandOutput<"element.get">)
    .element;

/**
 * Makes the next reader answer its `info` or `read` rounds with `answer` where it gives one
 * (round counted from 1), and as Git does otherwise.
 */
const nextReader = (answer: (round: number, kind: "info" | "read") => ObjectInfos | undefined): void => {
  vi.mocked(openObjectReader).mockImplementationOnce((folder, options): ObjectReader => {
    const real = actual.openObjectReader(folder, options);
    let rounds = 0;
    return {
      info: async (names) => answer(++rounds, "info") ?? real.info(names),
      read: async (names, open) => answer(++rounds, "read") ?? real.read(names, open),
      close: () => {
        real.close();
      },
    };
  });
};

const TIMEOUT: GitUnknown = { known: false, reason: "timeout", detail: "killed" };
const BROKEN: GitUnknown = { known: false, reason: "not-a-repository", detail: "bad object" };

describe("version date", () => {
  it("dates the version shown by the newest commit that made it, and an older version by its own", async () => {
    const repo = await repository([
      { name: "one", files: { [FILE]: element("One.") } },
      { name: "two", files: { [FILE]: element("Two.") } },
      { name: "other", files: { "notes.md": "no element\n" } },
    ]);
    const shown = await get(repo.workspace);
    expect(shown.version).toBe(await versionOf(repo.workspace, element("Two.")));
    expect(shown.versionDate).toBe(at(repo, "two"));
    expect(shown.versionDate).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(
      await dates(repo.workspace, [
        { version: await versionOf(repo.workspace, element("One.")) },
        { version: await versionOf(repo.workspace, element("Two.")) },
        // A version no commit has, in either normal form.
        { version: "n1:0123456789abcdef" },
        { version: "n2:0123456789abcdef" },
      ]),
    ).toEqual([at(repo, "one"), at(repo, "two"), null, null]);
    // HEAD came from the files of the Git folder.
    expect(headCommit).not.toHaveBeenCalled();
  });

  it("dates a version of normal form 2 by the commit that started it, over a change of an inline version only (ADR-0005)", async () => {
    const link = (version: string): string =>
      element(`See [it](reqseq:22222222-2222-4222-8222-222222222222?version=${version}).`);
    const repo = await repository([
      { name: "one", files: { [FILE]: link("n1:0000000000000001") } },
      { name: "two", files: { [FILE]: link("n1:0000000000000002") } },
    ]);
    const n2 = await versionOf(repo.workspace, link("n1:0000000000000002"), {}, "n2");
    expect(n2).toBe(await versionOf(repo.workspace, link("n1:0000000000000001"), {}, "n2"));
    expect(
      await dates(repo.workspace, [
        { version: n2 },
        { version: await versionOf(repo.workspace, link("n1:0000000000000002"), {}, "n1") },
      ]),
    ).toEqual([at(repo, "one"), at(repo, "two")]);
  });

  it("is left out of element.get unless asked for, and then no git runs", async () => {
    const repo = await repository([{ name: "one", files: { [FILE]: element("One.") } }]);
    const plain = (await invoke(
      "element.get",
      { ref: ID },
      { workspace: repo.workspace },
    )) as CommandOutput<"element.get">;
    expect(plain.element).not.toHaveProperty("versionDate");
    expect(plain.element.version).toBe(await versionOf(repo.workspace, element("One.")));
    expect(headFiles).not.toHaveBeenCalled();
    expect(fileHistory).not.toHaveBeenCalled();
    expect(openObjectReader).not.toHaveBeenCalled();
    expect({ ...(await get(repo.workspace)), versionDate: undefined }).toEqual({
      ...plain.element,
      versionDate: undefined,
    });
  });

  it("gives the newest commit when a version comes back (a revert)", async () => {
    const repo = await repository([
      { name: "one", files: { [FILE]: element("One.") } },
      { name: "two", files: { [FILE]: element("Two.") } },
      { name: "back", files: { [FILE]: element("One.") } },
    ]);
    expect(
      await dates(repo.workspace, [
        { version: await versionOf(repo.workspace, element("One.")) },
        { version: await versionOf(repo.workspace, element("Two.")) },
      ]),
    ).toEqual([at(repo, "back"), at(repo, "two")]);
  });

  it("gives the start with the greatest object name among commits of one second, whatever else the call walks (#252, D-029)", async () => {
    // Two branches set the same text within one second (a rebase restamps them), then a merge adds a
    // file in another folder, so a call that dates both files asks git with other paths.
    const repo = await repository([
      { name: "base", files: { [FILE]: element("One.") } },
      { name: "left", files: { [FILE]: element("Two.") } },
      { name: "right", parents: ["base"], files: { [FILE]: element("Two.") }, sameSecond: true },
      { name: "merge", parents: ["left", "right"], files: { [ELSEWHERE]: element("Third.", "", THIRD) } },
    ]);
    const two = await versionOf(repo.workspace, element("Two."));
    const third = { file: ELSEWHERE, id: THIRD, version: await versionOf(repo.workspace, element("Third.")) };
    const newest = [String(repo.made["left"]?.id), String(repo.made["right"]?.id)].sort()[1];
    const starts = async (workspace: Workspace, requests: readonly Partial<VersionDateRequest>[]) =>
      versionStarts(
        await context(workspace),
        requests.map((r) => ({ repository: "system", file: FILE, id: ID, version: "", ...r })),
      );
    expect(at(repo, "left")).toBe(at(repo, "right"));
    expect(await starts(repo.workspace, [{ version: two }])).toEqual([
      { date: at(repo, "left"), commit: newest },
    ]);
    const other = new Workspace(repo.fixture.root);
    onTestFinished(() => other.close());
    expect(await starts(other, [third, { version: two }])).toEqual([
      { date: at(repo, "merge"), commit: String(repo.made["merge"]?.id) },
      { date: at(repo, "left"), commit: newest },
    ]);
  });

  it("keeps the date over commits that changed only the status or the title", async () => {
    // Many such commits: the walk asks for more of them round by round.
    const repo = await repository([
      { name: "one", files: { [FILE]: element("One.") } },
      ...Array.from({ length: 12 }, (_, i): HistoryCommitSpec => ({
        name: `status-${String(i)}`,
        files: { [FILE]: element("One.", "", ID, "Wind", i % 2 === 0 ? "approved" : "draft") },
      })),
      { name: "title", files: { [FILE]: element("One.", "", ID, "Gust", "draft") } },
      { name: "other", files: { "notes.md": "no element\n" } },
    ]);
    const shown = await get(repo.workspace);
    expect([shown.title, shown.versionDate]).toEqual(["Gust", at(repo, "one")]);
    expect(fileHistory).toHaveBeenCalledTimes(1);
  });

  it("has no date for uncommitted content, and keeps it for a change outside the version", async () => {
    const repo = await repository([{ name: "one", files: { [FILE]: element("One.") } }]);
    await repo.fixture.write(FILE, element("Changed."));
    expect((await get(repo.workspace)).versionDate).toBeNull();
    // The title does not count to the version (SR-021 AK3), so the date stays.
    await repo.fixture.write(FILE, element("One.", "", ID, "Another title"));
    const shown = await get(repo.workspace);
    expect([shown.title, shown.versionDate]).toEqual(["Another title", at(repo, "one")]);
    // One walk for both: the history did not change.
    expect(fileHistory).toHaveBeenCalledTimes(1);
  });

  it("counts embedded images as each commit had them, also commits that changed only an image", async () => {
    const text = element("See ![d](d.png).");
    const repo = await repository([
      { name: "one", files: { [FILE]: text, "requirements/d.png": "v1" } },
      { name: "image", files: { "requirements/d.png": "v2" } },
      { name: "other", files: { "notes.md": "no element\n" } },
    ]);
    expect((await get(repo.workspace)).versionDate).toBe(at(repo, "image"));
    expect(
      await dates(repo.workspace, [
        { version: await versionOf(repo.workspace, text, { "d.png": "v1" }) },
        { version: await versionOf(repo.workspace, text, { "d.png": "v2" }) },
      ]),
    ).toEqual([at(repo, "one"), at(repo, "image")]);
  });

  it("still counts the images of a text it parsed at an earlier HEAD", async () => {
    const text = element("See ![d](d.png).");
    const repo = await repository([
      { name: "one", files: { [FILE]: text, "requirements/d.png": "v1" } },
      { name: "image", files: { "requirements/d.png": "v2" } },
    ]);
    const version = await versionOf(repo.workspace, text, { "d.png": "v2" });
    expect(await dates(repo.workspace, [{ version }])).toEqual([at(repo, "image")]);
    await repo.fixture.commitHistory(
      [{ name: "other", parents: [await repo.fixture.head()], files: { "notes.md": "x\n" } }],
      { branch: "main" },
    );
    expect(await dates(repo.workspace, [{ version }])).toEqual([at(repo, "image")]);
  });

  it("follows an image that only an older text embeds", async () => {
    const old = element("![o](old.png)");
    const now = element("![n](new.png)");
    const repo = await repository([
      { name: "one", files: { [FILE]: old, "requirements/old.png": "o1" } },
      { name: "image", files: { "requirements/old.png": "o2" } },
      { name: "now", files: { [FILE]: now, "requirements/new.png": "n" } },
    ]);
    expect(
      await dates(repo.workspace, [
        { version: await versionOf(repo.workspace, old, { "old.png": "o1" }) },
        { version: await versionOf(repo.workspace, old, { "old.png": "o2" }) },
        { version: await versionOf(repo.workspace, now, { "new.png": "n" }) },
      ]),
    ).toEqual([at(repo, "one"), at(repo, "image"), at(repo, "now")]);
    // The history is read again once, with the paths of both images.
    expect(fileHistory).toHaveBeenCalledTimes(2);
  });

  it("counts a missing image as missing, a link by its link text and a name in another Unicode form", async () => {
    const nfc = "Bild-ä.png";
    const text = element(`![a](later.png) ![l](link.png) ![u](${nfc}) ![x](a%5Cb.png)`);
    const repo = await repository([
      {
        name: "one",
        files: {
          [FILE]: text,
          "requirements/link.png": { link: "d.png" },
          [`requirements/${nfc.normalize("NFD")}`]: "u",
        },
      },
      { name: "later", files: { "requirements/later.png": "l" } },
    ]);
    // The working copy gives the same version as Git at the last commit.
    expect((await get(repo.workspace)).versionDate).toBe(at(repo, "later"));
    expect(
      await dates(repo.workspace, [
        {
          version: await versionOf(repo.workspace, text, {
            "later.png": null,
            "link.png": "d.png",
            [nfc]: "u",
            "a\\b.png": null,
          }),
        },
      ]),
    ).toEqual([at(repo, "one")]);
  });

  it("counts an image as missing where the commit has it not as spelled but in both NFC and NFD, or as a folder", async () => {
    // Spelled in neither form: a decomposed and a precomposed letter.
    const mixed = "a\u0308\u00e4.png";
    const text = element(`![m](${mixed}) ![f](folder.png)`);
    const repo = await repository([
      {
        name: "both",
        files: {
          [FILE]: text,
          [`requirements/${mixed.normalize("NFC")}`]: "nfc",
          [`requirements/${mixed.normalize("NFD")}`]: "nfd",
          "requirements/folder.png/inside.txt": "x",
        },
      },
      // Only one form is left, so a checkout on macOS (one name for both forms) works.
      { name: "one", deleted: [`requirements/${mixed.normalize("NFD")}`] },
    ]);
    expect((await get(repo.workspace)).versionDate).toBe(at(repo, "one"));
    expect(
      await dates(repo.workspace, [
        { version: await versionOf(repo.workspace, text, { [mixed]: null, "folder.png": null }) },
        { version: await versionOf(repo.workspace, text, { [mixed]: "nfc", "folder.png": null }) },
      ]),
    ).toEqual([at(repo, "both"), at(repo, "one")]);
  });

  it("does not count an image inside a nested repository at any commit, as the working copy does not", async () => {
    const text = element("![s](../sub/s.png)");
    const repo = await repository([{ name: "one", files: { [FILE]: text, "sub/s.png": "s" } }]);
    await repo.fixture.write("sub/.git", "gitdir: elsewhere\n");
    const shown = await get(repo.workspace);
    expect(shown.version).toBe(await versionOf(repo.workspace, text));
    expect(shown.versionDate).toBe(at(repo, "one"));
  });

  it("skips commits where the file held another element, did not parse or had no version", async () => {
    const repo = await repository([
      { name: "other", files: { [FILE]: element("Only the other.", "", OTHER) } },
      { name: "faulty", files: { [FILE]: "---\nid: [\n---\n" } },
      { name: "list", files: { [FILE]: "---\n- a\n---\n" } },
      { name: "plain", files: { [FILE]: "No frontmatter.\n" } },
      { name: "number", files: { [FILE]: element("Type 5.").replace("system-requirement", "5") } },
      { name: "empty", files: { [FILE]: element("Type empty.").replace("system-requirement", '""') } },
      { name: "infinite", files: { [FILE]: element("Infinite.", "acceptance-criteria: .inf\n") } },
      { name: "deleted", deleted: [FILE] },
      { name: "one", files: { [FILE]: element("One.") } },
    ]);
    expect(
      await dates(repo.workspace, [
        { version: await versionOf(repo.workspace, element("Only the other.")) },
        { version: await versionOf(repo.workspace, element("Type 5.")) },
        { version: await versionOf(repo.workspace, element("Type empty.")) },
        { version: await versionOf(repo.workspace, element("One.")) },
      ]),
    ).toEqual([null, null, null, at(repo, "one")]);
  });

  it("dates a version by the next commit when the commit before holds frontmatter that is null, a list or a scalar", async () => {
    for (const frontmatter of ["null", "- a", "foo"]) {
      const repo = await repository([
        { name: "before", files: { [FILE]: `---\n${frontmatter}\n---\n` } },
        { name: "one", files: { [FILE]: element("One.") } },
      ]);
      expect(
        await dates(repo.workspace, [{ version: await versionOf(repo.workspace, element("One.")) }]),
      ).toEqual([at(repo, "one")]);
    }
  });

  it("follows moves of the file to the commit that started its version (#460)", async () => {
    const OLDEST = "drafts/SR-111111111111.md";
    const OLD = "old/SR-111111111111.md";
    // Git cannot take a path with a leading space on a line, so that move is not followed.
    const SPACE = " lead/SR-222222222222.md";
    const repo = await repository([
      { name: "one", files: { [OLDEST]: element("One."), [SPACE]: element("Second.", "", OTHER) } },
      { name: "two", files: { [OLDEST]: element("Two.") } },
      { name: "moved", deleted: [OLDEST], files: { [OLD]: element("Two.") } },
      // A move that also changed the title, which is not part of the version.
      {
        name: "again",
        deleted: [OLD, SPACE],
        files: { [FILE]: element("Two.", "", ID, "Gust"), [FILE2]: element("Second.", "", OTHER) },
      },
      { name: "other", files: { "notes.md": "no element\n" } },
    ]);
    const shown = await get(repo.workspace);
    expect([shown.title, shown.versionDate]).toEqual(["Gust", at(repo, "two")]);
    expect(
      await dates(repo.workspace, [
        // A version from before the moves.
        { version: await versionOf(repo.workspace, element("One.")) },
        { file: FILE2, id: OTHER, version: await versionOf(repo.workspace, element("Second.")) },
      ]),
    ).toEqual([at(repo, "one"), at(repo, "again")]);
    // The moves of the commits that changed a name, each commit once: the history of each new
    // name is read and its commits looked up in turn (the moves of `again` serve the second file).
    const named = (commits: readonly string[]): string[] =>
      commits.map((c) => Object.keys(repo.made).find((n) => repo.made[n]?.id === c) ?? c).sort();
    expect(vi.mocked(fileMoves).mock.calls.map(([, commits]) => named(commits))).toEqual([
      ["again"],
      ["moved"],
      ["one", "two"],
    ]);
  });

  it("follows a move to a path that held another element before", async () => {
    const OLD = "old/SR-111111111111.md";
    const repo = await repository([
      { name: "one", files: { [OLD]: element("One."), [FILE]: element("Else.", "", OTHER) } },
      { name: "gone", deleted: [FILE] },
      { name: "moved", deleted: [OLD], files: { [FILE]: element("One.") } },
    ]);
    expect((await get(repo.workspace)).versionDate).toBe(at(repo, "one"));
  });

  it("gives the same date whatever versions earlier calls asked for (D-029)", async () => {
    const OLD = "old/SR-111111111111.md";
    // A branch changed the version under the old name; the merge took it.
    const repo = await repository([
      { name: "base", files: { [OLD]: element("Zero.") } },
      { name: "moved", deleted: [OLD], files: { [FILE]: element("Zero.") } },
      { name: "k1", files: { [FILE]: element("Kay.") } },
      { name: "edit", parents: ["base"], files: { [OLD]: element("One.") } },
      { name: "merge", parents: ["k1", "edit"], files: { [FILE]: element("One.") } },
    ]);
    const one = { version: await versionOf(repo.workspace, element("One.")) };
    const zero = { version: await versionOf(repo.workspace, element("Zero.")) };
    const fresh = (): Workspace => {
      const workspace = new Workspace(repo.fixture.root);
      onTestFinished(() => workspace.close());
      return workspace;
    };
    expect(await dates(repo.workspace, [one])).toEqual([at(repo, "edit")]);
    const zeroFirst = fresh();
    expect(await dates(zeroFirst, [zero])).toEqual([at(repo, "base")]);
    expect(await dates(zeroFirst, [one])).toEqual([at(repo, "edit")]);
    expect(await dates(fresh(), [one, zero])).toEqual([at(repo, "edit"), at(repo, "base")]);
  });

  it("is null when git times out looking up a move or reading the texts after it, and right next time", async () => {
    const repo = await repository([
      { name: "one", files: { "old/SR-111111111111.md": element("One.") } },
      { name: "moved", deleted: ["old/SR-111111111111.md"], files: { [FILE]: element("One.") } },
    ]);
    const version = await versionOf(repo.workspace, element("One."));
    vi.mocked(fileMoves).mockResolvedValueOnce(TIMEOUT);
    expect(await dates(repo.workspace, [{ version }])).toEqual([null]);
    // The names grew, then the texts time out: nothing of that walk is kept.
    nextReader((round) => (round === 1 ? TIMEOUT : undefined));
    expect(await dates(repo.workspace, [{ version }])).toEqual([null]);
    expect(await dates(repo.workspace, [{ version }])).toEqual([at(repo, "one")]);
  });

  it("does not follow a move where Git cannot look it up for another reason (a partial clone)", async () => {
    const repo = await repository([
      { name: "one", files: { "old/SR-111111111111.md": element("One.") } },
      { name: "moved", deleted: ["old/SR-111111111111.md"], files: { [FILE]: element("One.") } },
    ]);
    vi.mocked(fileMoves).mockResolvedValueOnce(BROKEN);
    expect(
      await dates(repo.workspace, [{ version: await versionOf(repo.workspace, element("One.")) }]),
    ).toEqual([at(repo, "moved")]);
  });

  it("walks again after git timed out reading the history for an image an older text embeds", async () => {
    const old = element("![o](old.png)");
    const repo = await repository([
      { name: "one", files: { [FILE]: old, "requirements/old.png": "o1" } },
      { name: "image", files: { "requirements/old.png": "o2" } },
      { name: "now", files: { [FILE]: element("Now.") } },
    ]);
    const version = await versionOf(repo.workspace, old, { "old.png": "o1" });
    vi.mocked(fileHistory).mockImplementationOnce(actual.fileHistory).mockResolvedValueOnce(TIMEOUT);
    expect(await dates(repo.workspace, [{ version }])).toEqual([null]);
    expect(await dates(repo.workspace, [{ version }])).toEqual([at(repo, "one")]);
  });

  it("reads the file only at the commits that changed it, and at a merge whose sides differ for it", async () => {
    const repo = await repository([
      { name: "one", files: { [FILE]: element("One."), "notes.md": "a\n" } },
      { name: "notes", files: { "notes.md": "b\n" } },
      { name: "side", parents: ["one"], files: { "notes.md": "c\n" } },
      // Both sides lead to "one" for the file: the merge is not evaluated.
      { name: "merged", parents: ["notes", "side"], files: { "notes.md": "d\n" } },
      { name: "two", files: { [FILE]: element("Two.") } },
      { name: "branch", parents: ["one"], files: { [FILE]: element("Branch.") } },
      // The sides differ for the file: the merge is evaluated, though it changed only the notes.
      { name: "differ", parents: ["two", "branch"], files: { "notes.md": "e\n" } },
    ]);
    /** The commits whose file was asked about (`<commit>:<path>`); blobs are read by ID and not counted. */
    const asked = new Set<string>();
    const note = (names: readonly string[]): void => {
      for (const name of names) {
        if (name.includes(":")) {
          asked.add(name.slice(0, name.indexOf(":")));
        }
      }
    };
    vi.mocked(openObjectReader).mockImplementationOnce((folder, options): ObjectReader => {
      const real = actual.openObjectReader(folder, options);
      return {
        info: (names) => {
          note(names);
          return real.info(names);
        },
        read: (names, open) => {
          note(names);
          return real.read(names, open);
        },
        close: () => {
          real.close();
        },
      };
    });
    expect(
      await dates(repo.workspace, [{ version: await versionOf(repo.workspace, element("Two.")) }]),
    ).toEqual([at(repo, "two")]);
    expect(openObjectReader).toHaveBeenCalledTimes(1);
    const commits = (names: readonly string[]): string[] => names.map((n) => String(repo.made[n]?.id)).sort();
    expect([...asked].sort()).toEqual(commits(["one", "two", "branch", "differ"]));
  });

  it("dates a version that a merge resolved or put together from both sides by the merge", async () => {
    const base = element("Base. ![d](d.png)");
    const left = element("Left. ![d](d.png)");
    const repo = await repository([
      { name: "base", files: { [FILE]: base, "requirements/d.png": "1" } },
      { name: "left", files: { [FILE]: left } },
      { name: "right", parents: ["base"], files: { "requirements/d.png": "2" } },
      // The file from the left, the image from the right: a version only the merge has.
      { name: "together", parents: ["left", "right"], files: { "requirements/d.png": "2" } },
      { name: "a", files: { [FILE]: element("A.") } },
      { name: "b", parents: ["together"], files: { [FILE]: element("B.") } },
      { name: "resolved", parents: ["a", "b"], files: { [FILE]: element("AB.") } },
      // A merge that takes the version of one side starts nothing.
      { name: "side", parents: ["resolved"], files: { "notes.md": "x\n" } },
      { name: "taken", parents: ["resolved", "side"], files: {} },
    ]);
    expect(
      await dates(repo.workspace, [
        { version: await versionOf(repo.workspace, element("AB.")) },
        { version: await versionOf(repo.workspace, left, { "d.png": "1" }) },
        { version: await versionOf(repo.workspace, left, { "d.png": "2" }) },
        { version: await versionOf(repo.workspace, base, { "d.png": "2" }) },
      ]),
    ).toEqual([at(repo, "resolved"), at(repo, "left"), at(repo, "together"), at(repo, "right")]);
  });

  it("gives the same date whatever other files share the call (both sides of every merge)", async () => {
    // Both sides set the same text; the merge changed only another file. Git's history
    // simplification would follow only the first side for this file alone.
    const repo = await repository([
      { name: "c1", files: { [FILE]: element("One.") } },
      { name: "m1", files: { [FILE]: element("Two.") } },
      { name: "b1", parents: ["c1"], files: { [FILE]: element("Two.") } },
      { name: "M", parents: ["m1", "b1"], files: { [FILE2]: element("Second.", "", OTHER) } },
    ]);
    const two = await versionOf(repo.workspace, element("Two."));
    const second = { file: FILE2, id: OTHER, version: await versionOf(repo.workspace, element("Second.")) };
    // Alone first, then with the other file.
    expect((await get(repo.workspace)).versionDate).toBe(at(repo, "b1"));
    expect(await dates(repo.workspace, [{ version: two }, second])).toEqual([at(repo, "b1"), at(repo, "M")]);
    // With the other file first, then alone.
    const other = new Workspace(repo.fixture.root);
    onTestFinished(() => other.close());
    expect(await dates(other, [{ version: two }, second])).toEqual([at(repo, "b1"), at(repo, "M")]);
    expect((await get(other)).versionDate).toBe(at(repo, "b1"));
  });

  it("gives the same dates whether other files of the same folder are walked or not", async () => {
    // Git is asked for the folder: the other file changes on both sides of a merge, and an image
    // at the top level is asked for as itself.
    const one = element("One. ![t](../top.png)");
    const two = element("Two. ![t](../top.png)");
    const repo = await repository([
      { name: "c1", files: { [FILE]: one, [FILE2]: element("A.", "", OTHER), "top.png": "1" } },
      { name: "s1", files: { [FILE2]: element("B.", "", OTHER) } },
      { name: "m1", parents: ["c1"], files: { [FILE]: two } },
      { name: "M", parents: ["m1", "s1"], files: {} },
      { name: "image", files: { "top.png": "2" } },
      { name: "b1", files: { [FILE2]: element("C.", "", OTHER) } },
    ]);
    const versions = [
      { version: await versionOf(repo.workspace, one, { "../top.png": "1" }) },
      { version: await versionOf(repo.workspace, two, { "../top.png": "1" }) },
      { version: await versionOf(repo.workspace, two, { "../top.png": "2" }) },
    ];
    const others = ["A.", "B.", "C."].map(async (text) => ({
      file: FILE2,
      id: OTHER,
      version: await versionOf(repo.workspace, element(text, "", OTHER)),
    }));
    const expected = [at(repo, "c1"), at(repo, "m1"), at(repo, "image")];
    expect(await dates(repo.workspace, versions)).toEqual(expected);
    const both = new Workspace(repo.fixture.root);
    onTestFinished(() => both.close());
    expect(await dates(both, [...versions, ...(await Promise.all(others))])).toEqual([
      ...expected,
      at(repo, "c1"),
      at(repo, "s1"),
      at(repo, "b1"),
    ]);
    expect(vi.mocked(fileHistory).mock.calls.map((c) => c[2])).toContainEqual(["requirements/", "top.png"]);
  });

  it("walks each file once per HEAD for any number of versions, files and callers", async () => {
    const repo = await repository([
      { name: "one", files: { [FILE]: element("One. ![d](d.png)"), "requirements/d.png": "1" } },
      { name: "two", files: { [FILE]: element("Two. ![d](d.png)"), [FILE2]: element("Second.", "", OTHER) } },
      // Listed for the other file too, where it changed nothing.
      { name: "three", files: { [FILE]: element("Three. ![d](d.png)") } },
    ]);
    const first = await versionOf(repo.workspace, element("One. ![d](d.png)"), { "d.png": "1" });
    const second = await versionOf(repo.workspace, element("Second.", "", OTHER));
    const many = [
      ...Array.from({ length: 50 }, () => ({ version: first })),
      ...Array.from({ length: 50 }, () => ({ file: FILE2, id: OTHER, version: second })),
    ];
    const [a, b] = await Promise.all([dates(repo.workspace, many), dates(repo.workspace, many)]);
    expect(a).toEqual([
      ...Array<string>(50).fill(at(repo, "one")),
      ...Array<string>(50).fill(at(repo, "two")),
    ]);
    expect(b).toEqual(a);
    // The history twice (again with the image path the texts embed).
    expect(fileHistory).toHaveBeenCalledTimes(2);
    await dates(repo.workspace, many);
    expect(fileHistory).toHaveBeenCalledTimes(2);
    expect(headCommit).not.toHaveBeenCalled();
    // Packed refs: the stamp changes, HEAD does not, the walks stay.
    await repo.fixture.git(["pack-refs", "--all"]);
    expect(await dates(repo.workspace, [{ version: first }])).toEqual([at(repo, "one")]);
    expect(fileHistory).toHaveBeenCalledTimes(2);
    // A new HEAD carries the walks over with one range (SR-082 AK4); a metamodel read again starts new walks.
    await repo.fixture.commitHistory(
      [{ name: "four", parents: [await repo.fixture.head()], files: { "notes.md": "x\n" } }],
      { branch: "main" },
    );
    expect(await dates(repo.workspace, [{ version: first }])).toEqual([at(repo, "one")]);
    expect(fileHistory).toHaveBeenCalledTimes(2);
    expect(historyRange).toHaveBeenCalledTimes(1);
    expect(commitsBetween).not.toHaveBeenCalled();
    await repo.workspace.reset(metamodelState);
    await dates(repo.workspace, [{ version: first }]);
    expect(fileHistory).toHaveBeenCalledTimes(4);
  });

  it("asks rev-parse for HEAD where the files of the Git folder cannot tell", async () => {
    const repo = await repository([{ name: "one", files: { [FILE]: element("One.") } }]);
    const version = await versionOf(repo.workspace, element("One."));
    vi.mocked(headFiles).mockResolvedValueOnce(undefined);
    expect(await dates(repo.workspace, [{ version }])).toEqual([at(repo, "one")]);
    expect(headCommit).toHaveBeenCalledTimes(1);
    // Then the files can tell again: same commit, same walk.
    expect(await dates(repo.workspace, [{ version }])).toEqual([at(repo, "one")]);
    expect(fileHistory).toHaveBeenCalledTimes(1);
  });

  it("dates the versions of a workspace in a subfolder of a Git repository (ThomasBirkmaier/ReqSeq-archive#377)", async () => {
    const outer = await createFixtureWorkspace();
    onTestFinished(() => outer.cleanup());
    await outer.git(["init", "--quiet", "--initial-branch=main"]);
    // The workspace two folders below the top level of the work tree.
    const inner = await createFixtureWorkspace({ fixture: "SR-001/two-elements", tempDir: outer.root });
    onTestFinished(() => inner.cleanup());
    const prefix = path.relative(outer.root, inner.root).split(path.sep).join("/");
    const made = await outer.commitHistory(
      [
        { name: "one", files: { [`${prefix}/${FILE}`]: element("One."), "top.md": "1\n" } },
        { name: "two", files: { [`${prefix}/${FILE}`]: element("Two.![d](d.png)") } },
        { name: "image", files: { [`${prefix}/requirements/d.png`]: "d\n" } },
        { name: "outside", files: { "top.md": "2\n", [FILE]: element("Outside.") } },
      ],
      { branch: "main" },
    );
    await outer.git(["reset", "--hard", "--quiet"]);
    const workspace = new Workspace(inner.root);
    onTestFinished(() => workspace.close());
    vi.clearAllMocks();
    const date = (name: string): string => String(made[name]?.date.toISOString().replace(".000Z", "Z"));
    // The image counts from the commit that added it; the commit outside the folder does not.
    expect((await get(workspace)).versionDate).toBe(date("image"));
    expect(
      await dates(workspace, [
        { version: await versionOf(workspace, element("One.")) },
        { version: await versionOf(workspace, element("Two.![d](d.png)"), { "d.png": null }) },
        // The text of the file of the same path at the top level is no version of this element here.
        { version: await versionOf(workspace, element("Outside.")) },
      ]),
    ).toEqual([date("one"), date("two"), null]);
    expect(headCommit).not.toHaveBeenCalled();
    // HEAD from rev-parse where the files of the Git folder cannot tell.
    const fresh = new Workspace(inner.root);
    onTestFinished(() => fresh.close());
    vi.mocked(headFiles).mockResolvedValueOnce(undefined);
    expect((await get(fresh)).versionDate).toBe(date("image"));
    expect(headCommit).toHaveBeenCalledTimes(1);
  });

  it("reads the history once when the caller gives the current text with its images", async () => {
    const text = element("![d](d.png)");
    const repo = await repository([
      { name: "one", files: { [FILE]: text, "requirements/d.png": "1" } },
      { name: "image", files: { "requirements/d.png": "2" } },
    ]);
    const body = text.slice(text.indexOf("---\n", 4) + 4);
    expect(
      await dates(repo.workspace, [
        { version: await versionOf(repo.workspace, text, { "d.png": "1" }), text: body },
      ]),
    ).toEqual([at(repo, "one")]);
    expect(fileHistory).toHaveBeenCalledTimes(1);
    // element.get gives it too.
    const fresh = new Workspace(repo.fixture.root);
    onTestFinished(() => fresh.close());
    expect((await get(fresh)).versionDate).toBe(at(repo, "image"));
    expect(fileHistory).toHaveBeenCalledTimes(2);
  });

  it("starts the walks ahead of the versions, and only once", async () => {
    const repo = await repository([{ name: "one", files: { [FILE]: element("One.") } }]);
    const ctx = await context(repo.workspace);
    const walk = { repository: "system", file: FILE, id: ID };
    await prepareVersionDates(ctx, [walk, walk, { ...walk, repository: "nope" }]);
    await prepareVersionDates(ctx, [walk]);
    expect(fileHistory).toHaveBeenCalledTimes(1);
    expect(
      await dates(repo.workspace, [{ version: await versionOf(repo.workspace, element("One.")) }]),
    ).toEqual([at(repo, "one")]);
    expect(fileHistory).toHaveBeenCalledTimes(1);
  });

  it("waits for a slow walk, which every caller shares, and stops git when the state goes", async () => {
    const repo = await repository([{ name: "one", files: { [FILE]: element("One.") } }]);
    const version = await versionOf(repo.workspace, element("One."));
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(fileHistory).mockImplementationOnce(async (...args) => {
      await held;
      return actual.fileHistory(...args);
    });
    const first = dates(repo.workspace, [{ version }]);
    const second = dates(repo.workspace, [{ version }]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    // The same answer for both, however long git takes (D-029).
    expect(await Promise.all([first, second])).toEqual([[at(repo, "one")], [at(repo, "one")]]);
    expect(fileHistory).toHaveBeenCalledTimes(1);
    const signal = vi.mocked(fileHistory).mock.calls[0]?.[3]?.signal;
    expect(signal?.aborted).toBe(false);
    await repo.workspace.reset(metamodelState);
    expect(signal?.aborted).toBe(true);
  });

  it("is null without a repository, a commit or the whole history, and starts no git without .git", async () => {
    const plain = await createFixtureWorkspace({ fixture: "SR-001/two-elements" });
    onTestFinished(() => plain.cleanup());
    const workspace = new Workspace(plain.root);
    onTestFinished(() => workspace.close());
    vi.clearAllMocks();
    expect((await get(workspace, "SR-e88fb3")).versionDate).toBeNull();
    expect(await dates(workspace, [{ repository: "nope", version: "n1:0123456789abcdef" }])).toEqual([null]);
    expect(headFiles).not.toHaveBeenCalled();

    const empty = await repository([]);
    expect((await get(empty.workspace, "SR-e88fb3")).versionDate).toBeNull();

    // A shallow clone of a repository whose element is committed.
    const origin = await createFixtureWorkspace({ fixture: "SR-001/two-elements", git: true });
    onTestFinished(() => origin.cleanup());
    const shallow = await createFixtureWorkspace();
    onTestFinished(() => shallow.cleanup());
    await shallow.git(["clone", "--quiet", "--depth", "1", pathToFileURL(origin.root).href, "."]);
    const deep = new Workspace(origin.root);
    onTestFinished(() => deep.close());
    const clone = new Workspace(shallow.root);
    onTestFinished(() => clone.close());
    expect((await get(deep, "SR-e88fb3")).versionDate).toEqual(expect.any(String));
    expect((await get(clone, "SR-e88fb3")).versionDate).toBeNull();

    // Why there is no date, as a message names it once (#252).
    const cause = async (on: Workspace, name = "system"): Promise<string> =>
      undatedCause(await context(on), name);
    expect(await cause(workspace)).toBe("no-git");
    expect(await cause(workspace, "nope")).toBe("no-git");
    expect(await cause(empty.workspace)).toBe("no-git");
    expect(await cause(clone)).toBe("shallow");
    expect(await cause(deep)).toBe("unknown");
    // Without what HEAD files say, `rev-parse` tells.
    vi.mocked(headFiles).mockResolvedValueOnce(undefined);
    expect(await cause(clone)).toBe("shallow");
    // A git call that timed out tells nothing: no cause is claimed.
    vi.mocked(headFiles).mockResolvedValueOnce(undefined);
    vi.mocked(headCommit).mockResolvedValueOnce(TIMEOUT);
    expect(await cause(clone)).toBe("unknown");

    // The last change of the metamodel folder (#252, P-2-09): none where Git cannot tell.
    const change = async (on: Workspace): Promise<string | null> => {
      const found = await metamodelChange(await context(on));
      return found === null ? null : `${found.commit} ${found.date}`;
    };
    const DATE = String.raw`\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ`;
    expect(await change(workspace)).toBeNull();
    expect(await change(empty.workspace)).toBeNull();
    expect(await change(clone)).toBeNull();
    const head = (await origin.git(["rev-parse", "HEAD"])).trim();
    expect(await change(deep)).toMatch(new RegExp(`^${head} ${DATE}$`));
    vi.mocked(headFiles).mockResolvedValueOnce(undefined);
    expect(await change(deep)).toMatch(new RegExp(`^${head} ${DATE}$`));
    vi.mocked(fileHistory).mockResolvedValueOnce(TIMEOUT);
    expect(await change(deep)).toBeNull();
    // A metamodel at the top of its repository, or in a repository not in the workspace, has none.
    const layout = await deep.get(workspaceLayoutState);
    const moved = (where: Partial<typeof layout.metamodel>) => ({
      layout: { ...layout, metamodel: { ...layout.metamodel, ...where } },
    });
    expect(await metamodelChange(moved({ path: "./" }))).toBeNull();
    expect(await metamodelChange(moved({ repository: "nope" }))).toBeNull();
    // A folder no commit changed.
    expect(await metamodelChange(moved({ path: "nothing/here" }))).toBeNull();
  });

  it("is null for a repository that is not on this machine", async () => {
    const fixture = await createFixtureWorkspace({
      fixture: "SR-001/two-elements",
      files: {
        "reqseq-workspace.yaml": [
          "reqseq-workspace: 1",
          "name: Weather station",
          "repositories:",
          '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }',
          '  - { name: sensor, url: "git@git.example.com:ws/sensor.git" }',
          "metamodel: { repository: system, path: metamodel }",
          "",
        ].join("\n"),
      },
    });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    expect(await dates(workspace, [{ repository: "sensor", version: "n1:0123456789abcdef" }])).toEqual([
      null,
    ]);
    expect(await undatedCause(await context(workspace), "sensor")).toBe("no-git");
  });

  it("is null when git times out or is missing during a walk, and walks again next time", async () => {
    const text = element("![d](d.png)");
    const repo = await repository([{ name: "one", files: { [FILE]: text, "requirements/d.png": "1" } }]);
    const version = await versionOf(repo.workspace, text, { "d.png": "1" });
    vi.mocked(fileHistory).mockResolvedValueOnce(TIMEOUT);
    expect(await dates(repo.workspace, [{ version }])).toEqual([null]);
    // The info of the texts, their contents, then the image blobs fail.
    for (const failing of [1, 2, 4]) {
      nextReader((round) => (round === failing ? { ...TIMEOUT, reason: "no-git" } : undefined));
      expect(await dates(repo.workspace, [{ version }])).toEqual([null]);
    }
    // A folder of the working copy that cannot be listed (`file.faulty`) is unknown too.
    vi.mocked(inNestedRepository).mockRejectedValueOnce(
      new CommandError("file.faulty", "Cannot read folder"),
    );
    expect(await dates(repo.workspace, [{ version }])).toEqual([null]);
    expect(await dates(repo.workspace, [{ version }])).toEqual([at(repo, "one")]);
  });

  it("keeps what Git could not tell for another reason until HEAD moves", async () => {
    const repo = await repository([
      { name: "one", files: { [FILE]: element("One."), [FILE2]: element("Second.", "", OTHER) } },
    ]);
    const version = await versionOf(repo.workspace, element("One."));
    const second = { file: FILE2, id: OTHER, version: await versionOf(repo.workspace, element("Second.")) };
    // A walk whose objects Git could not read.
    nextReader((round) => (round === 1 ? BROKEN : undefined));
    expect(await dates(repo.workspace, [{ version }])).toEqual([null]);
    let asked = false;
    nextReader(() => {
      asked = true;
      return undefined;
    });
    expect(await dates(repo.workspace, [{ version }])).toEqual([null]);
    expect(asked).toBe(false);
    // A walk whose history Git could not read.
    vi.mocked(fileHistory).mockResolvedValueOnce(BROKEN);
    expect(await dates(repo.workspace, [second])).toEqual([null]);
    expect(await dates(repo.workspace, [second])).toEqual([null]);
    expect(fileHistory).toHaveBeenCalledTimes(2);
    await repo.fixture.commitHistory(
      [{ name: "two", parents: [await repo.fixture.head()], files: { "notes.md": "x\n" } }],
      { branch: "main" },
    );
    expect(await dates(repo.workspace, [{ version }, second])).toEqual([at(repo, "one"), at(repo, "one")]);
  });

  it("has no date for a version whose image blob Git no longer has", async () => {
    const text = element("![d](d.png)");
    const repo = await repository([{ name: "one", files: { [FILE]: text, "requirements/d.png": "1" } }]);
    // The second read is the one of the image blobs.
    nextReader((round, kind) =>
      kind === "read" && round === 4 ? { known: true, objects: [null] } : undefined,
    );
    expect(
      await dates(repo.workspace, [{ version: await versionOf(repo.workspace, text, { "d.png": "1" }) }]),
    ).toEqual([null]);
  });

  it("passes on an error that is not Git's or the file system's, and asks again next time", async () => {
    const text = element("![d](d.png)");
    const repo = await repository([{ name: "one", files: { [FILE]: text, "requirements/d.png": "1" } }]);
    const version = await versionOf(repo.workspace, text, { "d.png": "1" });
    vi.mocked(inNestedRepository).mockRejectedValueOnce(new Error("bug"));
    await expect(dates(repo.workspace, [{ version }])).rejects.toThrow("bug");
    vi.mocked(fileHistory).mockRejectedValueOnce(new Error("bug in the history"));
    await expect(dates(repo.workspace, [{ file: FILE2, id: OTHER, version }])).rejects.toThrow(
      "bug in the history",
    );
    expect(await dates(repo.workspace, [{ version }])).toEqual([at(repo, "one")]);
  });

  it("has no date for a file or an image Git cannot be asked about", async () => {
    // An image at the repository root whose name starts with a space: git would not take the line.
    const space = element("![s](../%20lead.png)");
    const repo = await repository([
      { name: "space", files: { [FILE]: space } },
      { name: "one", files: { [FILE]: element("One.") } },
    ]);
    expect(await dates(repo.workspace, [{ file: " lead.md", version: "n1:0123456789abcdef" }])).toEqual([
      null,
    ]);
    expect(fileHistory).not.toHaveBeenCalled();
    expect(
      await dates(repo.workspace, [
        { version: await versionOf(repo.workspace, space, { "../ lead.png": null }) },
        { version: await versionOf(repo.workspace, element("One.")) },
      ]),
    ).toEqual([null, at(repo, "one")]);
    // Nothing was written.
    expect(await fs.readFile(repo.fixture.path(FILE), "utf8")).toBe(element("One."));
  });

  describe("as a sort reads it (SR-075 AK6)", () => {
    const times = async (
      workspace: Workspace,
      requests: readonly Partial<VersionDateRequest>[],
    ): Promise<string[]> =>
      (
        await versionTimes(
          await context(workspace),
          requests.map((r) => ({ repository: "system", file: FILE, id: ID, version: "", ...r })),
        )
      ).map((time) => (time.kind === "dated" ? time.date : time.kind));

    it("dates the version of the last commit, and counts any other as uncommitted", async () => {
      const repo = await repository([
        { name: "one", files: { [FILE]: element("One.") } },
        { name: "two", files: { [FILE]: element("Two.") } },
      ]);
      const one = await versionOf(repo.workspace, element("One."));
      const two = await versionOf(repo.workspace, element("Two."));
      const never = await versionOf(repo.workspace, element("Never."));
      // An older commit has "One.", but the last one does not: newer than every commit, as a new file.
      expect(
        await times(repo.workspace, [
          { version: two },
          { version: one },
          { version: never },
          { file: FILE2, id: OTHER, version: never },
          { file: ELSEWHERE, id: THIRD, version: never },
          { version: "x1:nope" },
          { repository: "nope", version: two },
        ]),
      ).toEqual([
        at(repo, "two"),
        "uncommitted",
        "uncommitted",
        "uncommitted",
        "uncommitted",
        "undated",
        "undated",
      ]);
      // Alone, the folder no commit changed has no history at all.
      const alone = await repository([{ name: "one", files: { [FILE]: element("One.") } }]);
      expect(await times(alone.workspace, [{ file: ELSEWHERE, id: THIRD, version: never }])).toEqual([
        "uncommitted",
      ]);
    });

    it("takes the version of HEAD's file by the parents, not by the committer dates", async () => {
      const repo = await repository([{ name: "one", files: { [FILE]: element("One.") } }]);
      // A child whose committer date is older than its parent's (a clock that was behind).
      const seconds = 1_000_000_000;
      const text = element("Two.");
      const stream = [
        "commit refs/heads/main",
        `committer ReqSeq Test <test@reqseq.invalid> ${String(seconds)} +0000`,
        "data 4",
        "skew",
        `from ${String(repo.made["one"]?.id)}`,
        `M 100644 inline ${FILE}`,
        `data ${String(Buffer.byteLength(text))}`,
        text,
      ].join("\n");
      await repo.fixture.git(["fast-import", "--quiet", "--force"], ".", Buffer.from(stream));
      await repo.fixture.git(["reset", "--hard", "--quiet"]);
      const two = await versionOf(repo.workspace, text);
      const one = await versionOf(repo.workspace, element("One."));
      expect(await times(repo.workspace, [{ version: two }, { version: one }])).toEqual([
        new Date(seconds * 1000).toISOString().replace(".000Z", "Z"),
        "uncommitted",
      ]);
    });

    it("has no time where Git could not tell a version: a text or an image blob it does not have", async () => {
      const text = element("![d](d.png)");
      const repo = await repository([{ name: "one", files: { [FILE]: text, "requirements/d.png": "1" } }]);
      const version = await versionOf(repo.workspace, text, { "d.png": "1" });
      // The image blob (round 4: text info, text, image info, image).
      nextReader((round) => (round === 4 ? { known: true, objects: [null] } : undefined));
      expect(await times(repo.workspace, [{ version }])).toEqual(["undated"]);
      const plain = await repository([{ name: "one", files: { [FILE]: element("One.") } }]);
      const one = await versionOf(plain.workspace, element("One."));
      // The text blob (round 2).
      nextReader((round) => (round === 2 ? { known: true, objects: [null] } : undefined));
      expect(await times(plain.workspace, [{ version: one }])).toEqual(["undated"]);
      // Only HEAD's text blob: an older commit has the version, but whether HEAD has it is unknown.
      const two = await repository([
        { name: "one", files: { [FILE]: element("One.") } },
        { name: "two", files: { [FILE]: element("Two.") } },
      ]);
      const blob = (await two.fixture.git(["rev-parse", `HEAD:${FILE}`])).trim();
      vi.mocked(openObjectReader).mockImplementationOnce((folder, options): ObjectReader => {
        const real = actual.openObjectReader(folder, options);
        return {
          info: (names) => real.info(names),
          read: async (names, open) => {
            const lost = names.indexOf(blob);
            const read = await real.read(names, (info, i) => (i === lost ? () => undefined : open(info, i)));
            return read.known
              ? { known: true, objects: read.objects.map((o, i) => (i === lost ? null : o)) }
              : read;
          },
          close: () => {
            real.close();
          },
        };
      });
      expect(
        await times(two.workspace, [{ version: await versionOf(two.workspace, element("One.")) }]),
      ).toEqual(["undated"]);
    });

    it("finds an answer again when the history grows, and is late where git then stops", async () => {
      // The image of the oldest text is found only once that text is read: the history grows then.
      const repo = await repository([
        { name: "one", files: { [FILE]: element("![o](old.png)"), "requirements/old.png": "o1" } },
        { name: "mid", files: { [FILE]: element("Mid.") } },
        { name: "now", files: { [FILE]: element("Now.") } },
        { name: "image", files: { "requirements/old.png": "o2" } },
      ]);
      const requests = [
        { version: await versionOf(repo.workspace, element("Now.")) },
        { version: await versionOf(repo.workspace, element("![o](old.png)"), { "old.png": "o1" }) },
      ];
      // Every reader round after the one that read the oldest text (round 8) times out: the answer
      // for "Now." found before the history grew is not kept with the new HEAD source unchecked.
      nextReader((round) => (round >= 9 ? TIMEOUT : undefined));
      expect(await times(repo.workspace, requests)).toEqual(["late", "late"]);
      expect(fileHistory).toHaveBeenCalledTimes(2);
      expect(await times(repo.workspace, requests)).toEqual([at(repo, "now"), "uncommitted"]);
    });

    it("waits for the history another call reads again after the tracked paths grew (#2408)", async () => {
      // HEAD changed only the image its text embeds: the first history read, without the text,
      // lists only "one", so HEAD's version is found once the history is read with the image path.
      const text = element("![d](d.png)");
      const repo = await repository([
        { name: "one", files: { [FILE]: text, "requirements/d.png": "1" } },
        { name: "image", files: { "requirements/d.png": "2" } },
      ]);
      const version = await versionOf(repo.workspace, text, { "d.png": "2" });
      let release = (): void => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      vi.mocked(fileHistory)
        .mockImplementationOnce(actual.fileHistory)
        .mockImplementationOnce(async (...args) => {
          await gate;
          return actual.fileHistory(...args);
        });
      const first = times(repo.workspace, [{ version }]);
      // The first call reads the history again; the others start meanwhile, on the same walk.
      await vi.waitFor(() => {
        expect(fileHistory).toHaveBeenCalledTimes(2);
      });
      const sort = times(repo.workspace, [{ version }]);
      const date = dates(repo.workspace, [{ version }]);
      await vi.waitFor(() => {
        expect(openObjectReader).toHaveBeenCalledTimes(3);
      });
      // Whatever needs no git has run by now.
      await new Promise((resolve) => setImmediate(resolve));
      release();
      expect(await Promise.all([first, sort, date])).toEqual([
        [at(repo, "image")],
        [at(repo, "image")],
        [at(repo, "image")],
      ]);
      expect(fileHistory).toHaveBeenCalledTimes(2);
    });

    it("is late where git did not answer in time, and undated where git is missing", async () => {
      const repo = await repository([{ name: "one", files: { [FILE]: element("One.") } }]);
      const version = await versionOf(repo.workspace, element("One."));
      // The history, HEAD and the objects in turn.
      vi.mocked(fileHistory).mockResolvedValueOnce(TIMEOUT);
      expect(await times(repo.workspace, [{ version }])).toEqual(["late"]);
      vi.mocked(headFiles).mockResolvedValueOnce(undefined);
      vi.mocked(headCommit).mockResolvedValueOnce(TIMEOUT);
      expect(await times(repo.workspace, [{ version }])).toEqual(["late"]);
      nextReader((round) => (round === 1 ? TIMEOUT : undefined));
      expect(await times(repo.workspace, [{ version }])).toEqual(["late"]);
      vi.mocked(fileHistory).mockResolvedValueOnce({ ...TIMEOUT, reason: "no-git" });
      expect(await times(repo.workspace, [{ version }])).toEqual(["undated"]);
      nextReader((round) => (round === 1 ? { ...TIMEOUT, reason: "no-git" } : undefined));
      expect(await times(repo.workspace, [{ version }])).toEqual(["undated"]);
      nextReader((round) => (round === 1 ? BROKEN : undefined));
      expect(await times(repo.workspace, [{ version }])).toEqual(["undated"]);
      // A walk that failed for good stays without a date at this HEAD.
      expect(await times(repo.workspace, [{ version }])).toEqual(["undated"]);
    });
  });
});

describe("version date after HEAD moved (SR-082 AK4)", () => {
  const one = element("One.");
  const two = element("Two.");
  const three = element("Three.");
  const b1 = element("B1.", "", OTHER);
  const b2 = element("B2.", "", OTHER);

  /** `one`, `two` (with `b1`) and `notes` on main, walked at that HEAD. */
  const walked = async (): Promise<Repository> => {
    const repo = await repository([
      { name: "one", files: { [FILE]: one } },
      { name: "two", files: { [FILE]: two, [FILE2]: b1 } },
      { name: "notes", files: { "notes.md": "n\n" } },
    ]);
    await answers(repo.workspace);
    vi.clearAllMocks();
    walksAgain = 0;
    return repo;
  };

  /** Every version of the scenario, of both files, current and older ones. */
  const requests = async (workspace: Workspace): Promise<VersionDateRequest[]> => [
    ...(await Promise.all([one, two, three].map((t) => versionOf(workspace, t)))).map((version) => ({
      repository: "system",
      file: FILE,
      id: ID,
      version,
    })),
    ...(await Promise.all([b1, b2].map((t) => versionOf(workspace, t)))).map((version) => ({
      repository: "system",
      file: FILE2,
      id: OTHER,
      version,
    })),
  ];

  const answers = async (workspace: Workspace): Promise<unknown> => {
    const asked = await requests(workspace);
    const ctx = await context(workspace);
    return [await versionStarts(ctx, asked), await versionTimes(ctx, asked)];
  };

  /** The history reads of the workspace under test (not of the fresh ones `sameAsFresh` opens). */
  let walksAgain = 0;

  /** The answers after the move, which a new workspace on the same folder (a full walk) also gives. */
  const sameAsFresh = async (repo: Repository): Promise<unknown> => {
    const before = vi.mocked(fileHistory).mock.calls.length;
    const carried = await answers(repo.workspace);
    walksAgain += vi.mocked(fileHistory).mock.calls.length - before;
    const fresh = new Workspace(repo.fixture.root);
    onTestFinished(() => fresh.close());
    expect(carried).toEqual(await answers(fresh));
    return carried;
  };

  /** Makes `commits` on no branch; their IDs by name. */
  const made = async (
    repo: Repository,
    commits: readonly HistoryCommitSpec[],
  ): Promise<Record<string, string>> =>
    Object.fromEntries(
      Object.entries(await repo.fixture.commitHistory(commits)).map(([name, commit]) => [name, commit.id]),
    );

  const moveTo = async (repo: Repository, commit: string): Promise<void> => {
    await repo.fixture.git(["update-ref", "refs/heads/main", commit]);
  };

  it("reads one range for a commit on top and walks nothing again", async () => {
    const repo = await walked();
    const head = await repo.fixture.head();
    const ids = await made(repo, [{ name: "top", parents: [head], files: { "notes.md": "m\n" } }]);
    await moveTo(repo, String(ids["top"]));
    const before = await answers(repo.workspace);
    expect(fileHistory).not.toHaveBeenCalled();
    expect(historyRange).toHaveBeenCalledTimes(1);
    expect(commitsBetween).not.toHaveBeenCalled();
    expect(await sameAsFresh(repo)).toEqual(before);
  });

  it("dates a version a commit on top makes, and keeps the older ones", async () => {
    const repo = await walked();
    const head = await repo.fixture.head();
    const ids = await made(repo, [
      { name: "three", parents: [head], files: { [FILE]: three } },
      { name: "back", files: { [FILE]: two, [FILE2]: b2 } },
    ]);
    await moveTo(repo, String(ids["back"]));
    await sameAsFresh(repo);
    expect(walksAgain).toBe(0);
  });

  it("carries the walks over a merge of a branch from HEAD and of one from an older commit", async () => {
    const repo = await walked();
    const head = await repo.fixture.head();
    const ids = await made(repo, [
      { name: "side", parents: [head], files: { [FILE]: three } },
      { name: "merge", parents: [head, "side"], files: { [FILE]: three } },
      { name: "old", parents: [String(repo.made["one"]?.id)], files: { [FILE2]: b2 } },
      { name: "older", parents: ["merge", "old"], files: { [FILE2]: b2 } },
    ]);
    await moveTo(repo, String(ids["merge"]));
    await sameAsFresh(repo);
    await moveTo(repo, String(ids["older"]));
    await sameAsFresh(repo);
    expect(walksAgain).toBe(0);
    // The first merge's only parent outside the range is the old HEAD; the second has `one` too.
    expect(commitsBetween).toHaveBeenCalledTimes(1);
  });

  it("carries the walks over an amend, a rebase, a reset and a switch to another branch and back", async () => {
    const repo = await walked();
    const ids = await made(repo, [
      // `two` amended: the same parent, another text.
      { name: "amended", parents: [String(repo.made["one"]?.id)], files: { [FILE]: three, [FILE2]: b1 } },
      // `two` and `notes` rebased on a new commit.
      { name: "base", parents: [String(repo.made["one"]?.id)], files: { "other.md": "o\n" } },
      { name: "two again", files: { [FILE]: two, [FILE2]: b1 } },
      { name: "notes again", files: { "notes.md": "n\n" } },
      // Another branch from `one`.
      { name: "branch", parents: [String(repo.made["one"]?.id)], files: { [FILE2]: b2 } },
    ]);
    for (const target of ["amended", "notes again", "branch"]) {
      await moveTo(repo, String(ids[target]));
      await sameAsFresh(repo);
    }
    await moveTo(repo, String(repo.made["notes"]?.id));
    await sameAsFresh(repo);
    // Back to `one`: the range is empty, and `two` is no longer reachable.
    await moveTo(repo, String(repo.made["one"]?.id));
    expect(await sameAsFresh(repo)).toEqual(expect.arrayContaining([expect.arrayContaining([null])]));
    expect(walksAgain).toBe(0);
    await repo.fixture.git(["symbolic-ref", "HEAD", "refs/heads/other"]);
    await repo.fixture.git(["update-ref", "refs/heads/other", String(ids["branch"])]);
    await sameAsFresh(repo);
    expect(walksAgain).toBe(0);
  });

  it("carries the walks over a merge of an unrelated history, also with log.showRoot=false and diff.relative=true", async () => {
    const repo = await walked();
    await repo.fixture.git(["config", "log.showRoot", "false"]);
    await repo.fixture.git(["config", "diff.relative", "true"]);
    const head = await repo.fixture.head();
    const ids = await made(repo, [
      { name: "root", parents: [], files: { [FILE2]: b2 } },
      { name: "joined", parents: [head, "root"], files: { [FILE2]: b2 } },
    ]);
    await moveTo(repo, String(ids["joined"]));
    await sameAsFresh(repo);
    expect(walksAgain).toBe(0);
  });

  it("walks a file again whose name a move in the range adds, and one whose text embeds a new image", async () => {
    const repo = await walked();
    const head = await repo.fixture.head();
    const ids = await made(repo, [
      { name: "gone", parents: [head], deleted: [FILE] },
      { name: "moved", files: { "requirements/moved.md": three } },
      { name: "back", deleted: ["requirements/moved.md"], files: { [FILE]: three } },
      { name: "image", files: { [FILE2]: b2, "requirements/d.png": "1" } },
      { name: "embeds", files: { [FILE2]: element("![d](d.png)", "", OTHER) } },
    ]);
    await moveTo(repo, String(ids["back"]));
    await sameAsFresh(repo);
    await moveTo(repo, String(ids["embeds"]));
    await sameAsFresh(repo);
    // The image's own commit made the version the file shows.
    const version = await versionOf(repo.workspace, element("![d](d.png)", "", OTHER), { "d.png": "1" });
    expect(await dates(repo.workspace, [{ file: FILE2, id: OTHER, version }])).not.toEqual([null]);
  });

  it("walks again where git does not give the range or a list in time, refuses or has too many commits", async () => {
    const repo = await walked();
    const head = await repo.fixture.head();
    const ids = await made(repo, [
      { name: "old", parents: [String(repo.made["one"]?.id)], files: { [FILE2]: b2 } },
      { name: "merge", parents: [head, "old"], files: { [FILE2]: b2 } },
    ]);
    for (const [mocked, answer] of [
      [historyRange, TIMEOUT],
      [historyRange, BROKEN],
      [historyRange, { known: true, commits: [], more: true }],
      [commitsBetween, TIMEOUT],
      [commitsBetween, BROKEN],
      [commitsBetween, { known: true, commits: [], more: true }],
    ] as const) {
      await moveTo(repo, head);
      await answers(repo.workspace);
      vi.clearAllMocks();
      walksAgain = 0;
      await moveTo(repo, String(ids["merge"]));
      vi.mocked(mocked).mockResolvedValueOnce(answer);
      // A full walk of both files, with answers, never late for good.
      await sameAsFresh(repo);
      expect(walksAgain).toBeGreaterThan(0);
    }
  });

  it("walks again where git does not give the moves of the range in time, or is missing", async () => {
    const repo = await walked();
    const head = await repo.fixture.head();
    // One commit per case: the moves of a commit are looked up once.
    const ids = await made(repo, [
      { name: "late", parents: [head], files: { [FILE]: three } },
      { name: "gone", parents: [head], files: { [FILE]: three, "x.md": "x\n" } },
    ]);
    for (const [target, answer] of [
      ["late", TIMEOUT],
      ["gone", { known: false, reason: "no-git", detail: "gone" }],
    ] as const) {
      await moveTo(repo, head);
      await answers(repo.workspace);
      walksAgain = 0;
      await moveTo(repo, String(ids[target]));
      vi.mocked(fileMoves).mockResolvedValueOnce(answer);
      await sameAsFresh(repo);
      expect(walksAgain).toBeGreaterThan(0);
    }
  });

  it("fails the call on a programming error while it carries, and carries on the next one", async () => {
    const repo = await walked();
    const ids = await made(repo, [
      { name: "three", parents: [await repo.fixture.head()], files: { [FILE]: three } },
    ]);
    await moveTo(repo, String(ids["three"]));
    vi.mocked(fileMoves).mockRejectedValueOnce(new Error("a bug"));
    await expect(answers(repo.workspace)).rejects.toThrow("a bug");
    await sameAsFresh(repo);
    expect(walksAgain).toBe(0);
  });

  it("keeps the later of two moves that are carried at the same time", async () => {
    const repo = await walked();
    const head = await repo.fixture.head();
    const ids = await made(repo, [
      { name: "three", parents: [head], files: { [FILE]: three } },
      { name: "b2", files: { [FILE2]: b2 } },
    ]);
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(historyRange).mockImplementationOnce(async (...args) => {
      await gate;
      return actual.historyRange(...args);
    });
    await moveTo(repo, String(ids["three"]));
    const first = answers(repo.workspace);
    // The first range has started; HEAD moves on, and the next call carries from the same walks.
    await vi.waitFor(() => {
      expect(historyRange).toHaveBeenCalledTimes(1);
    });
    await moveTo(repo, String(ids["b2"]));
    const second = await answers(repo.workspace);
    release();
    await first;
    expect(await sameAsFresh(repo)).toEqual(second);
    // The first carry, done last, did not replace the walks of the later HEAD.
    expect(historyRange).toHaveBeenCalledTimes(2);
  });

  it("answers a sort from HEAD's version first: undated only where Git could not tell HEAD's own, newer where HEAD has another, whichever call came first (SR-075 AK6)", async () => {
    const repo = await repository([
      { name: "one", files: { [FILE]: one } },
      { name: "two", files: { [FILE]: two } },
    ]);
    const version = await versionOf(repo.workspace, two);
    const blob = (await repo.fixture.git(["rev-parse", `HEAD:${FILE}`])).trim();
    // The next reader cannot read the text of `two`.
    const lose = (): void => {
      vi.mocked(openObjectReader).mockImplementationOnce((folder, options): ObjectReader => {
        const real = actual.openObjectReader(folder, options);
        return {
          info: (names) => real.info(names),
          read: async (names, open) => {
            const lost = names.indexOf(blob);
            const read = await real.read(names, (info, i) => (i === lost ? () => undefined : open(info, i)));
            return read.known
              ? { known: true, objects: read.objects.map((o, i) => (i === lost ? null : o)) }
              : read;
          },
          close: () => {
            real.close();
          },
        };
      });
    };
    const kinds = async (workspace = repo.workspace): Promise<string[]> =>
      (
        await versionTimes(await context(workspace), [{ repository: "system", file: FILE, id: ID, version }])
      ).map((t) => t.kind);
    lose();
    expect(await kinds()).toEqual(["undated"]);
    // Nor does a start of an older version count where Git could not tell HEAD's.
    const starts = new Workspace(repo.fixture.root);
    onTestFinished(() => starts.close());
    lose();
    const older = await versionOf(repo.workspace, one);
    expect(await dates(starts, [{ version: older }])).toEqual([null]);
    // A sort after it reads the same from what the walk kept.
    expect(
      (
        await versionTimes(await context(starts), [
          { repository: "system", file: FILE, id: ID, version: older },
        ])
      ).map((t) => t.kind),
    ).toEqual(["undated"]);
    // A commit on top: `two` is still reached and unknown, but HEAD's version is known and another,
    // so the content counts as newer than every commit.
    const ids = await made(repo, [
      { name: "three", parents: [await repo.fixture.head()], files: { [FILE]: three } },
    ]);
    await moveTo(repo, String(ids["three"]));
    expect(await kinds()).toEqual(["uncommitted"]);
    // The same where the start was looked up first (it kept no date: Git could not tell `two`).
    const after = new Workspace(repo.fixture.root);
    onTestFinished(() => after.close());
    lose();
    expect(await dates(after, [{ version }])).toEqual([null]);
    expect(await kinds(after)).toEqual(["uncommitted"]);
    // Back to `one`: `two` is not reached, and no commit has its version.
    await moveTo(repo, String(repo.made["one"]?.id));
    expect(await kinds()).toEqual(["uncommitted"]);
  });

  it("sorts as late, not as newer, where the history read for an image HEAD's text embeds did not answer in time", async () => {
    const text = element("![i](img.png)");
    const repo = await repository([
      { name: "one", files: { [FILE]: text, "requirements/img.png": "1" } },
      { name: "two", files: { "requirements/img.png": "2" } },
    ]);
    const asked = [
      {
        repository: "system",
        file: FILE,
        id: ID,
        version: await versionOf(repo.workspace, text, { "img.png": "2" }),
      },
    ];
    // HEAD's text is read, it embeds the image, and the history read for it times out.
    vi.mocked(fileHistory).mockImplementationOnce(actual.fileHistory).mockResolvedValueOnce(TIMEOUT);
    expect(await versionTimes(await context(repo.workspace), asked)).toEqual([{ kind: "late" }]);
    expect(await versionTimes(await context(repo.workspace), asked)).toEqual([
      { kind: "dated", date: at(repo, "two") },
    ]);
  });

  it("finds the start of a version HEAD does not have after a sort of it, and sorts it as newer after its start was found", async () => {
    const repo = await repository([
      { name: "one", files: { [FILE]: one } },
      { name: "two", files: { [FILE]: two } },
    ]);
    const version = await versionOf(repo.workspace, one);
    const asked = [
      { repository: "system", file: FILE, id: ID, version },
      { repository: "system", file: FILE, id: ID, version: await versionOf(repo.workspace, two) },
    ];
    const sorted = [{ kind: "uncommitted" }, { kind: "dated", date: at(repo, "two") }];
    expect(await versionTimes(await context(repo.workspace), asked)).toEqual(sorted);
    // Again, from what the walk keeps.
    expect(await versionTimes(await context(repo.workspace), asked)).toEqual(sorted);
    expect(await dates(repo.workspace, [{ version }])).toEqual([at(repo, "one")]);
    const fresh = new Workspace(repo.fixture.root);
    onTestFinished(() => fresh.close());
    expect(await dates(fresh, [{ version }])).toEqual([at(repo, "one")]);
    expect(await versionTimes(await context(fresh), asked)).toEqual(sorted);
  });

  it("walks again a walk Git refused at the old HEAD, and one an answer still holds", async () => {
    const repo = await repository([
      { name: "one", files: { [FILE]: one, [FILE2]: b1 } },
      { name: "two", files: { [FILE]: two } },
    ]);
    const version = await versionOf(repo.workspace, two);
    nextReader(() => BROKEN);
    expect(await dates(repo.workspace, [{ version }])).toEqual([null]);
    // An answer at the old HEAD that waits in its reader while HEAD moves.
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached = (): void => undefined;
    const waiting = new Promise<void>((resolve) => {
      reached = resolve;
    });
    vi.mocked(openObjectReader).mockImplementationOnce((folder, options): ObjectReader => {
      const real = actual.openObjectReader(folder, options);
      return {
        info: async (names) => {
          reached();
          await gate;
          return real.info(names);
        },
        read: (names, open) => real.read(names, open),
        close: () => {
          real.close();
        },
      };
    });
    const held = dates(repo.workspace, [
      { file: FILE2, id: OTHER, version: await versionOf(repo.workspace, b1) },
    ]);
    await waiting;
    vi.clearAllMocks();
    const ids = await made(repo, [
      { name: "b2", parents: [await repo.fixture.head()], files: { [FILE2]: b2 } },
    ]);
    await moveTo(repo, String(ids["b2"]));
    await sameAsFresh(repo);
    // Both walks were walked again.
    expect(walksAgain).toBeGreaterThan(0);
    release();
    await held;
  });

  it("reads the range once for calls that see the same move together", async () => {
    const repo = await walked();
    const ids = await made(repo, [
      { name: "top", parents: [await repo.fixture.head()], files: { [FILE]: three } },
    ]);
    await moveTo(repo, String(ids["top"]));
    const [a, b] = await Promise.all([answers(repo.workspace), answers(repo.workspace)]);
    expect(a).toEqual(b);
    expect(historyRange).toHaveBeenCalledTimes(1);
  });

  it("lists the tree of a commit where many files are asked at it, and is late where git does not list it in time", async () => {
    const ids = Array.from(
      { length: 500 },
      (_, i) => `44444444-4444-4444-8444-${i.toString(16).padStart(12, "0")}`,
    );
    // The first in NFC: its NFD form, asked too, is no blob in the listing.
    const file = (id: string): string =>
      `requirements/${id === ids[0] ? "Bild-\u00e4" : "SR"}-${id.slice(-12)}.md`;
    const repo = await repository([
      { name: "all", files: Object.fromEntries(ids.map((id) => [file(id), element("Many.", "", id)])) },
    ]);
    const version = await versionOf(repo.workspace, element("Many."));
    // One more file the commit does not have: the listing names no blob for it.
    const asked = [...ids, OTHER].map((id) => ({
      file: id === OTHER ? FILE2.replace("SR-", "SR-x") : file(id),
      id,
      version,
    }));
    vi.mocked(commitBlobs).mockResolvedValueOnce(TIMEOUT);
    expect(
      new Set(
        (
          await versionTimes(
            await context(repo.workspace),
            asked.map((a) => ({ repository: "system", ...a })),
          )
        ).map((t) => t.kind),
      ),
    ).toEqual(new Set(["late", "uncommitted"]));
    expect(await dates(repo.workspace, asked)).toEqual([...ids.map(() => at(repo, "all")), null]);
    expect(commitBlobs).toHaveBeenCalledTimes(2);
  });

  it("walks a file again whose old name came from a commit HEAD no longer reaches", async () => {
    const before = "requirements/before.md";
    const repo = await repository([
      { name: "one", files: { [before]: two } },
      // A rename of `before` to the file: its old name is followed.
      { name: "renamed", deleted: [before], files: { [FILE]: two } },
    ]);
    await answers(repo.workspace);
    walksAgain = 0;
    // The rename amended into a copy: `before` stays, the file is new.
    const ids = await made(repo, [
      { name: "copied", parents: [String(repo.made["one"]?.id)], files: { [FILE]: two } },
    ]);
    await moveTo(repo, String(ids["copied"]));
    await sameAsFresh(repo);
    expect(await dates(repo.workspace, [{ version: await versionOf(repo.workspace, two) }])).not.toEqual([
      at(repo, "one"),
    ]);
  });

  it("answers names at one commit alike whether it lists the tree or asks each, also where Git refuses the listing", async () => {
    const ids = Array.from(
      { length: 500 },
      (_, i) => `55555555-5555-4555-8555-${i.toString(16).padStart(12, "0")}`,
    );
    const file = (id: string): string => `requirements/SR-${id.slice(-12)}.md`;
    // The file as spelled (NFC) is a folder; only its NFD form holds the element.
    const spelled = "requirements/Bild-\u00e4.md";
    const repo = await repository([
      {
        name: "all",
        files: {
          ...Object.fromEntries(ids.map((id) => [file(id), element("Many.", "", id)])),
          [`${spelled}/inside.txt`]: "x",
          [spelled.normalize("NFD")]: two,
        },
      },
    ]);
    const version = await versionOf(repo.workspace, two);
    const alone = await dates(repo.workspace, [{ file: spelled, version }]);
    const fresh = new Workspace(repo.fixture.root);
    onTestFinished(() => fresh.close());
    const versionMany = await versionOf(repo.workspace, element("Many."));
    const many = [
      { file: spelled, version },
      ...ids.map((id) => ({ file: file(id), id, version: versionMany })),
    ];
    expect((await dates(fresh, many))[0]).toEqual(alone[0]);
    expect(commitBlobs).toHaveBeenCalledTimes(1);
    // Git refuses the listing (a partial clone without trees): each name is asked instead.
    const refused = new Workspace(repo.fixture.root);
    onTestFinished(() => refused.close());
    vi.mocked(commitBlobs).mockResolvedValueOnce(BROKEN);
    expect(
      await dates(
        refused,
        ids.map((id) => ({ file: file(id), id, version: versionMany })),
      ),
    ).toEqual(ids.map(() => at(repo, "all")));
  });
});

describe("version date at a merge, against its first parent (SR-082 AK4)", () => {
  /** Enough files open at one merge that it is compared with its first parent (`MERGES_FROM`). */
  const MANY = 100;
  const ids = Array.from(
    { length: MANY },
    (_, i) => `66666666-6666-4666-8666-${i.toString(16).padStart(12, "0")}`,
  );
  const file = (i: number): string => `requirements/SR-${String(ids[i]).slice(-12)}.md`;
  const texts = (text: (i: number) => string): Record<string, string> =>
    Object.fromEntries(ids.map((id, i) => [file(i), element(text(i), "", id)]));
  // The first file embeds an image.
  const top = (i: number): string => (i === 0 ? "Top ![i](img.png)." : `Top ${String(i)}.`);

  /**
   * `base` and `top` on main (the working copy), a side from `base` with `side`, and a merge of it
   * into `top` that takes `taken` of the side: sorted at `top` first, then HEAD is moved to the merge.
   */
  const merged = async (
    side: HistoryCommitSpec["files"],
    taken: HistoryCommitSpec["files"],
    deleted: readonly string[] = [],
    config: readonly (readonly [string, string])[] = [],
  ): Promise<{ readonly repo: Repository; readonly asked: VersionDateRequest[] }> => {
    const repo = await repository([
      { name: "base", files: { ...texts((i) => `Base ${String(i)}.`), "requirements/img.png": "1" } },
      { name: "top", files: texts(top) },
    ]);
    for (const [key, value] of config) {
      await repo.fixture.git(["config", key, value]);
    }
    const asked: VersionDateRequest[] = [
      ...(
        await Promise.all(
          ids.map((_, i) =>
            versionOf(repo.workspace, element(top(i), "", ids[i]), i === 0 ? { "img.png": "1" } : {}),
          ),
        )
      ).map((version, i) => ({ repository: "system", file: file(i), id: String(ids[i]), version })),
      // A file of the working copy that only the side has.
      {
        repository: "system",
        file: FILE,
        id: ID,
        version: await versionOf(repo.workspace, element("Side.")),
      },
    ];
    expect(new Set((await versionTimes(await context(repo.workspace), asked)).map((t) => t.kind))).toEqual(
      new Set(["dated", "uncommitted"]),
    );
    const head = await repo.fixture.head();
    const made = await repo.fixture.commitHistory([
      {
        name: "side",
        parents: [String(repo.made["base"]?.id)],
        files: { [FILE]: element("Side."), ...side },
      },
      { name: "merge", parents: [head, "side"], files: { "side.txt": "s\n", ...taken }, deleted },
    ]);
    await repo.fixture.git(["update-ref", "refs/heads/main", String(made["merge"]?.id)]);
    vi.clearAllMocks();
    return { repo, asked };
  };

  /** The answers of a sort and of the starts, carried and fresh: the same. */
  const sameAsFresh = async (repo: Repository, asked: readonly VersionDateRequest[]): Promise<unknown> => {
    const answers = async (workspace: Workspace): Promise<unknown> => {
      const ctx = await context(workspace);
      return [await versionTimes(ctx, asked), await versionStarts(ctx, asked)];
    };
    const carried = await answers(repo.workspace);
    const fresh = new Workspace(repo.fixture.root);
    onTestFinished(() => fresh.close());
    expect(carried).toEqual(await answers(fresh));
    return carried;
  };

  it("takes the version of the first parent's side where the merge changed none of the file's paths, and reads the others", async () => {
    // The side changes two texts and the image; the merge takes one text and the image.
    const { repo, asked } = await merged(
      {
        [file(1)]: element("Side 1.", "", ids[1]),
        [file(2)]: element("Side 2.", "", ids[2]),
        "requirements/img.png": "2",
      },
      { [file(1)]: element("Side 1.", "", ids[1]), "requirements/img.png": "2" },
    );
    // The names the carried sort asks Git for at the merge: only those of the files it changed.
    const names: string[] = [];
    vi.mocked(openObjectReader).mockImplementationOnce((folder, options): ObjectReader => {
      const real = actual.openObjectReader(folder, options);
      return {
        info: (asked) => {
          names.push(...asked);
          return real.info(asked);
        },
        read: (asked, open) => real.read(asked, open),
        close: () => {
          real.close();
        },
      };
    });
    const times = (await sameAsFresh(repo, asked)) as [{ kind: string }[]];
    expect(firstParentChanges).toHaveBeenCalledTimes(1);
    const merge = await repo.fixture.head();
    expect(new Set(names.filter((n) => n.startsWith(merge)).map((n) => n.slice(merge.length + 1)))).toEqual(
      new Set([file(0), file(1), "requirements/img.png"]),
    );
    // The texts and the image the merge took, and the file only the side had, which it did not take.
    expect(times[0].map((t, i) => (t.kind === "dated" ? [] : [i])).flat()).toEqual([0, 1, MANY]);
  });

  it("reads where git lists a move by both paths, whatever log.diffMerges and diff.renames say", async () => {
    const moved = file(3).replace(".md", "-moved.md");
    const { repo, asked } = await merged(
      { [moved]: element(top(3), "", ids[3]), [file(4)]: element("Side 4.", "", ids[4]) },
      { [moved]: element(top(3), "", ids[3]), [file(4)]: element("Side 4.", "", ids[4]) },
      [file(3)],
      [
        ["log.diffMerges", "combined"],
        ["diff.renames", "true"],
      ],
    );
    const times = (await sameAsFresh(repo, asked)) as [{ kind: string }[]];
    expect(firstParentChanges).toHaveBeenCalledTimes(1);
    expect(times[0].map((t, i) => (t.kind === "dated" ? [] : [i])).flat()).toEqual([3, 4, MANY]);
  });

  it("reads the merge where git refuses the list or leaves the merge out, and is late where it does not answer in time", async () => {
    for (const answer of [BROKEN, { known: true, changes: new Map() }] as const) {
      const { repo, asked } = await merged({}, {});
      vi.mocked(firstParentChanges).mockResolvedValueOnce(answer);
      await sameAsFresh(repo, asked);
      expect(firstParentChanges).toHaveBeenCalledTimes(1);
    }
    const { repo, asked } = await merged({}, {});
    vi.mocked(firstParentChanges).mockResolvedValueOnce(TIMEOUT);
    expect(new Set((await versionTimes(await context(repo.workspace), asked)).map((t) => t.kind))).toContain(
      "late",
    );
    // The next call asks again.
    const [times] = (await sameAsFresh(repo, asked)) as [{ kind: string }[]];
    expect(times.map((t) => t.kind)).not.toContain("late");
  });
});

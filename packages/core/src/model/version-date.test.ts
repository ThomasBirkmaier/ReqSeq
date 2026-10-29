// The date of a version (D-013, ADR-0005 "Version date"). Every history is made with one
// `git fast-import` (`commitHistory`) and checked out with one reset, so each test starts few git
// processes (slow Windows runners, #206, #226).
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
import { fileHistory, headCommit, headFiles, openObjectReader } from "../git/reader.js";
import { metamodelState } from "../metamodel/index.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type * as Images from "./images.js";
import { inNestedRepository } from "./images.js";
import type { VersionDateContext, VersionDateRequest } from "./version-date.js";
import { prepareVersionDates, versionDates } from "./version-date.js";
import { elementVersion } from "./view.js";

// The real reader and nested check, wrapped so that tests count git calls and make one fail.
vi.mock("../git/reader.js", async (importOriginal) => {
  const original = await importOriginal<typeof Reader>();
  return {
    ...original,
    headCommit: vi.fn(original.headCommit),
    headFiles: vi.fn(original.headFiles),
    fileHistory: vi.fn(original.fileHistory),
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
 * content, or null for missing.
 */
const versionOf = async (
  workspace: Workspace,
  text: string,
  images: Readonly<Record<string, string | null>> = {},
): Promise<string> => {
  const parsed = parseFileBytes(FILE, Buffer.from(text));
  if (parsed.kind !== "parsed") {
    throw new Error("not an element file");
  }
  const data = parsed.content.data as Readonly<Record<string, unknown>>;
  return elementVersion(
    { type: String(data["type"]), data },
    parsed.content.body,
    await workspace.get(metamodelState),
    Object.entries(images).map(([path, content]) => ({
      path,
      sha256: content === null ? null : sha256(content),
    })),
  );
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
        // A version no commit has, and one of another normal form.
        { version: "n1:0123456789abcdef" },
        { version: "n2:0123456789abcdef" },
      ]),
    ).toEqual([at(repo, "one"), at(repo, "two"), null, null]);
    // HEAD came from the files of the Git folder.
    expect(headCommit).not.toHaveBeenCalled();
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
    // A new HEAD, and a metamodel read again, start new walks.
    await repo.fixture.commitHistory(
      [{ name: "four", parents: [await repo.fixture.head()], files: { "notes.md": "x\n" } }],
      { branch: "main" },
    );
    expect(await dates(repo.workspace, [{ version: first }])).toEqual([at(repo, "one")]);
    expect(fileHistory).toHaveBeenCalledTimes(4);
    await repo.workspace.reset(metamodelState);
    await dates(repo.workspace, [{ version: first }]);
    expect(fileHistory).toHaveBeenCalledTimes(6);
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

  it("dates the versions of a workspace in a subfolder of a Git repository (#377)", async () => {
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
  });

  it("is null for a repository that is not on this machine", async () => {
    const fixture = await createFixtureWorkspace({
      fixture: "SR-001/two-elements",
      files: {
        "logreq-workspace.yaml": [
          "logreq-workspace: 1",
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
});

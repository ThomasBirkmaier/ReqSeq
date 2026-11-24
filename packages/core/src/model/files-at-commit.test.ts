// `filesAtCommit` (SR-232 AK7): the files of elements at a commit, also at an old path, none where no file held the
// element or at a path git cannot name, `no-commit` for a commit the repository does not have, and the unknown answer
// of each git call that fails; from `LISTED_FROM` paths by blob ID after one tree listing, and `unread` for a blob git
// does not have here (#2514).
// The export's use of it: commands/html/export-baselines.test.ts.
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { GitUnknown, ObjectReader } from "../git/reader.js";
import * as reader from "../git/reader.js";
import { LISTED_FROM, filesAtCommit } from "./files-at-commit.js";

vi.mock("../git/reader.js", async (importOriginal) => {
  const original = await importOriginal<typeof reader>();
  return {
    ...original,
    changedPaths: vi.fn(original.changedPaths),
    commitBlobs: vi.fn(original.commitBlobs),
    openObjectReader: vi.fn(original.openObjectReader),
    resolveCommit: vi.fn(original.resolveCommit),
  };
});

const UNKNOWN: GitUnknown = { known: false, reason: "refused", detail: "refused" };
const A = "61061061-0000-4000-8000-0000000000a1";
const B = "61061061-0000-4000-8000-0000000000b1";

describe("filesAtCommit", () => {
  it("reads each file at the commit, follows a moved one, and gives the unknown answer of each git call that fails", async () => {
    const ws = await createFixtureWorkspace({
      files: {
        "a.md": `---\nid: ${A}\ntype: x\n---\n\nOld a.\n`,
        "b.md": `---\nid: ${B}\ntype: y\n---\n`,
        "list.md": "---\n- not a mapping\n---\n",
        "plain.md": "No frontmatter.\n",
      },
      git: true,
    });
    onTestFinished(() => ws.cleanup());
    const first = await ws.head();
    await ws.git(["mv", "a.md", "moved.md"]);
    await ws.write("c.md", `---\nid: ${B}c\ntype: x\n---\n`);
    // Changed since, and read in the second round: neither holds an element.
    await ws.write("list.md", "---\n- still not a mapping\n---\n");
    await ws.write("plain.md", "Still no frontmatter.\n");
    await ws.commit(".", "move");
    const asked = [
      { file: "moved.md", id: A },
      { file: "b.md", id: B },
      { file: "c.md", id: `${B}c` },
    ];
    const at = (): ReturnType<typeof filesAtCommit> => filesAtCommit(ws.root, first, asked);
    expect(await at()).toEqual({
      known: true,
      kind: "found",
      files: [
        { path: "a.md", type: "x", data: { id: A, type: "x" }, text: "Old a.\n" },
        { path: "b.md", type: "y", data: { id: B, type: "y" }, text: "" },
        undefined,
      ],
    });
    // Every file where it is now: one round.
    expect(await filesAtCommit(ws.root, first, [{ file: "b.md", id: B }])).toMatchObject({
      files: [{ path: "b.md" }],
    });
    expect(await filesAtCommit(ws.root, "0".repeat(40), asked)).toEqual({ known: true, kind: "no-commit" });
    vi.mocked(reader.resolveCommit).mockResolvedValueOnce(UNKNOWN);
    expect(await at()).toBe(UNKNOWN);
    vi.mocked(reader.changedPaths).mockResolvedValueOnce(UNKNOWN);
    expect(await at()).toBe(UNKNOWN);
    const close = vi.fn();
    const failing: ObjectReader = { info: vi.fn(), read: vi.fn(() => Promise.resolve(UNKNOWN)), close };
    vi.mocked(reader.openObjectReader).mockReturnValueOnce(failing);
    expect(await at()).toBe(UNKNOWN);
    expect(close).toHaveBeenCalled();
    // The second round fails.
    const real = vi.mocked(reader.openObjectReader).getMockImplementation() as typeof reader.openObjectReader;
    vi.mocked(reader.openObjectReader).mockImplementationOnce((folder) => {
      const opened = real(folder);
      let rounds = 0;
      return {
        info: (names) => opened.info(names),
        close: () => {
          opened.close();
        },
        read: (names, open) => (++rounds === 1 ? opened.read(names, open) : Promise.resolve(UNKNOWN)),
      };
    });
    expect(await at()).toBe(UNKNOWN);
  });

  it("gives no file for an element at a path git cannot name, and still reads the others", async () => {
    const ws = await createFixtureWorkspace({
      files: {
        " drafts/a.md": `---\nid: ${A}\ntype: x\n---\n`,
        "b.md": `---\nid: ${B}\ntype: y\n---\n`,
      },
      git: true,
    });
    onTestFinished(() => ws.cleanup());
    const first = await ws.head();
    expect(
      await filesAtCommit(ws.root, first, [
        { file: " drafts/a.md", id: A },
        { file: "b.md", id: B },
      ]),
    ).toEqual({
      known: true,
      kind: "found",
      files: [undefined, { path: "b.md", type: "y", data: { id: B, type: "y" }, text: "" }],
    });
  });

  it("reads many paths by blob ID after one listing, by path where the listing lacks one or is refused, and names the blobs git does not have", async () => {
    const ws = await createFixtureWorkspace({
      files: {
        "a.md": `---\nid: ${A}\ntype: x\n---\n`,
        "b.md": `---\nid: ${B}\ntype: y\n---\n`,
      },
      git: true,
    });
    onTestFinished(() => ws.cleanup());
    const first = await ws.head();
    // Swapped since: a.md holds B now and b.md A, so both are found by the changed files.
    await ws.write("a.md", `---\nid: ${B}\ntype: y\n---\n`);
    await ws.write("b.md", `---\nid: ${A}\ntype: x\n---\n`);
    await ws.commit(".", "swap");
    // Paths no file holds fill the round up to the listing threshold.
    const filler = Array.from({ length: LISTED_FROM }, (_, i) => ({
      file: `none/${String(i)}.md`,
      id: `${A}${String(i)}`,
    }));
    const asked = [{ file: "a.md", id: B }, { file: "b.md", id: A }, ...filler];
    const files = [
      { path: "b.md", type: "y", data: { id: B, type: "y" }, text: "" },
      { path: "a.md", type: "x", data: { id: A, type: "x" }, text: "" },
      ...filler.map(() => undefined),
    ];
    const listing = vi.mocked(reader.commitBlobs);
    expect(await filesAtCommit(ws.root, first, asked)).toEqual({ known: true, kind: "found", files });
    expect(listing).toHaveBeenCalledTimes(1);
    // A refused listing (a partial clone without trees): every path by `<commit>:<path>`, with the same answer.
    listing.mockResolvedValueOnce(UNKNOWN);
    expect(await filesAtCommit(ws.root, first, asked)).toEqual({ known: true, kind: "found", files });
    // A listing that times out is unknown.
    const timeout: GitUnknown = { known: false, reason: "timeout", detail: "slow" };
    listing.mockResolvedValueOnce(timeout);
    expect(await filesAtCommit(ws.root, first, asked)).toBe(timeout);
    // A blob the listing names that git does not have: that element is unread and not looked for elsewhere.
    const absent = "1".repeat(40);
    listing.mockResolvedValueOnce({ known: true, ids: new Map([["a.md", absent]]) });
    expect(await filesAtCommit(ws.root, first, asked)).toEqual({
      known: true,
      kind: "found",
      files: [undefined, files[1], ...filler.map(() => undefined)],
      unread: [0],
    });
    // Every element found or unread in the first round: no second round.
    const changed = vi.mocked(reader.changedPaths);
    changed.mockClear();
    const unreadOnly = filler.map((a) => ({ ...a, file: "a.md" }));
    listing.mockResolvedValueOnce({ known: true, ids: new Map([["a.md", absent]]) });
    expect(await filesAtCommit(ws.root, first, unreadOnly)).toEqual({
      known: true,
      kind: "found",
      files: filler.map(() => undefined),
      unread: filler.map((_, i) => i),
    });
    expect(changed).not.toHaveBeenCalled();
    // A changed file git does not have in the second round: the elements not found are unread.
    const many = Array.from({ length: LISTED_FROM }, (_, i) => `gone/${String(i)}.md`);
    changed.mockResolvedValueOnce({ known: true, paths: many });
    listing.mockImplementationOnce(listing.getMockImplementation() as typeof reader.commitBlobs);
    listing.mockResolvedValueOnce({ known: true, ids: new Map([["gone/0.md", absent]]) });
    // The swapped files are found among the blobs of the first round; the others may lie in the unread blob.
    expect(await filesAtCommit(ws.root, first, asked)).toEqual({
      known: true,
      kind: "found",
      files,
      unread: filler.map((_, i) => i + 2),
    });
  });
});

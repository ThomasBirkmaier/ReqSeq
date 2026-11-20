// `filesAtCommit` (SR-232 AK7): the files of elements at a commit, also at an old path, none where no file held the
// element, `no-commit` for a commit the repository does not have, and the unknown answer of each git call that fails.
// The export's use of it: commands/html/export-baselines.test.ts.
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { GitUnknown, ObjectReader } from "../git/reader.js";
import * as reader from "../git/reader.js";
import { filesAtCommit } from "./files-at-commit.js";

vi.mock("../git/reader.js", async (importOriginal) => {
  const original = await importOriginal<typeof reader>();
  return {
    ...original,
    changedPaths: vi.fn(original.changedPaths),
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
});

// `fileSince` when Git cannot tell (SR-051 AK4): every git call that fails gives its unknown answer.
// The answers of a working Git: commands/baseline/get.test.ts (baseline.compare).
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { GitUnknown, ObjectReader } from "../git/reader.js";
import * as reader from "../git/reader.js";
import { fileSince } from "./file-since.js";

vi.mock("../git/reader.js", async (importOriginal) => {
  const original = await importOriginal<typeof reader>();
  return {
    ...original,
    changedPaths: vi.fn(original.changedPaths),
    headCommit: vi.fn(original.headCommit),
    openObjectReader: vi.fn(original.openObjectReader),
    resolveCommit: vi.fn(original.resolveCommit),
  };
});

const UNKNOWN: GitUnknown = { known: false, reason: "refused", detail: "refused" };
const ID = "61061061-0000-4000-8000-0000000000b1";

describe("fileSince", () => {
  it("gives the unknown answer of each git call that fails", async () => {
    const ws = await createFixtureWorkspace({
      files: { "a.md": `---\nid: ${ID}\ntype: x\n---\n` },
      git: true,
    });
    onTestFinished(() => ws.cleanup());
    const head = await ws.head();
    await ws.git(["mv", "a.md", "b.md"]);
    const since = (): ReturnType<typeof fileSince> => fileSince(ws.root, head, "b.md", ID);
    expect(await since()).toEqual({ known: true, kind: "found", head, before: "a.md", uncommitted: true });
    vi.mocked(reader.resolveCommit).mockResolvedValueOnce(UNKNOWN);
    expect(await since()).toBe(UNKNOWN);
    vi.mocked(reader.headCommit).mockResolvedValueOnce(UNKNOWN);
    expect(await since()).toBe(UNKNOWN);
    vi.mocked(reader.changedPaths).mockResolvedValueOnce(UNKNOWN);
    expect(await since()).toBe(UNKNOWN);
    const close = vi.fn();
    const failing: ObjectReader = { info: vi.fn(), read: vi.fn(() => Promise.resolve(UNKNOWN)), close };
    vi.mocked(reader.openObjectReader).mockReturnValueOnce(failing);
    expect(await since()).toBe(UNKNOWN);
    expect(close).toHaveBeenCalled();
    const real = vi.mocked(reader.changedPaths).getMockImplementation() as typeof reader.changedPaths;
    vi.mocked(reader.changedPaths).mockImplementationOnce(real).mockResolvedValueOnce(UNKNOWN);
    expect(await since()).toBe(UNKNOWN);
  });
});

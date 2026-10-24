// writeElementFiles (src/model/write.ts): the rollback when a write fails after others were written,
// with failures the file system cannot be made to produce on demand (a restore that is refused, an
// error that is no CommandError). The writer is wrapped so a test can make chosen calls fail.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { CommandError } from "../catalog.js";
import type * as files from "../files/index.js";
import { Workspace } from "../runtime/workspace.js";
import { setElementStatus } from "./status.js";

interface Control {
  /** Called before each write with its 1-based number; may throw to make that write fail. */
  before: (call: number) => void;
  calls: number;
  /** Paths whose bytes, parsed outside the files block (the check of written bytes), read back as no element. */
  unreadable: readonly string[];
}

const control: Control = vi.hoisted(() => ({ before: () => undefined, calls: 0, unreadable: [] }));

vi.mock("../files/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof files>();
  return {
    ...actual,
    writeFileAtomic: async (...args: Parameters<typeof files.writeFileAtomic>) => {
      control.calls += 1;
      control.before(control.calls);
      return actual.writeFileAtomic(...args);
    },
    parseFileBytes: (...args: Parameters<typeof files.parseFileBytes>) =>
      control.unreadable.includes(args[0])
        ? { kind: "no-frontmatter" as const }
        : actual.parseFileBytes(...args),
  };
});

const WIND = { id: "e8df96ea-a168-4d90-8d65-6328cee88fb3", file: "requirements/REQ-6328cee88fb3.md" };
const GUSTS = { id: "3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c", file: "requirements/REQ-1d2e3f4a5b6c.md" };
const BARE = { id: "0b7c6e1a-1111-4222-8333-444455556666", file: "requirements/REQ-444455556666.md" };

const open = async (): Promise<{ workspace: Workspace; read: (file: string) => Promise<string> }> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-017/own-statuses" });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  control.calls = 0;
  control.before = () => undefined;
  control.unreadable = [];
  return { workspace, read: (file) => fs.readFile(fixture.path(file), "utf8") };
};

const failure = async (workspace: Workspace): Promise<unknown> =>
  setElementStatus(workspace, { refs: [WIND.id, GUSTS.id, BARE.id], status: "in-change" }).then(
    () => {
      throw new Error("expected element.setStatus to fail");
    },
    (e: unknown) => e,
  );

describe("writeElementFiles rolls back the files it wrote", () => {
  it("lists the files it could not restore in details.written and keeps the code", async () => {
    const { workspace, read } = await open();
    // Writes: 1 WIND, 2 GUSTS, 3 BARE (fails); restores: 4 GUSTS (refused), 5 WIND.
    control.before = (call) => {
      if (call === 3) {
        throw new CommandError("file.read-only", "Not written: read-only", { file: BARE.file });
      }
      if (call === 4) {
        throw new CommandError("internal", "disk full");
      }
    };
    const wind = await read(WIND.file);
    const error = await failure(workspace);
    expect(error).toBeInstanceOf(CommandError);
    expect([(error as CommandError).code, (error as CommandError).details]).toEqual([
      "file.read-only",
      { file: BARE.file, written: [GUSTS.file] },
    ]);
    expect(control.calls).toBe(5);
    expect(await read(WIND.file)).toBe(wind);
    expect(await read(GUSTS.file)).toMatch(/^status: in-change /m);
  });

  it("throws an error that is no CommandError again as it is, after restoring", async () => {
    const { workspace, read } = await open();
    const wind = await read(WIND.file);
    const gusts = await read(GUSTS.file);
    const plain = new Error("unexpected");
    control.before = (call) => {
      if (call === 3) {
        throw plain;
      }
    };
    expect(await failure(workspace)).toBe(plain);
    expect([await read(WIND.file), await read(GUSTS.file)]).toEqual([wind, gusts]);
  });

  it("throws an error that is no CommandError as it is, also when a file stays written", async () => {
    const { workspace, read } = await open();
    const plain = new Error("unexpected");
    control.before = (call) => {
      if (call === 3) {
        throw plain;
      }
      if (call === 4) {
        throw new Error("restore refused");
      }
    };
    expect(await failure(workspace)).toBe(plain);
    expect(await read(GUSTS.file)).toMatch(/^status: in-change /m);
  });

  it("restores a written file whose bytes do not read back as an element", async () => {
    const { workspace, read } = await open();
    const before = await Promise.all([WIND.file, GUSTS.file, BARE.file].map(read));
    control.unreadable = [GUSTS.file];
    const error = await failure(workspace);
    expect(error).toBeInstanceOf(CommandError);
    expect([(error as CommandError).code, (error as CommandError).details]).toEqual(["internal", undefined]);
    // Writes: 1 WIND, 2 GUSTS (does not read back); restores: 3 GUSTS, 4 WIND. BARE is never written.
    expect(control.calls).toBe(4);
    expect(await Promise.all([WIND.file, GUSTS.file, BARE.file].map(read))).toEqual(before);
  });
});

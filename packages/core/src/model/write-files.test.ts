// writeElementFiles (src/model/write.ts): the rollback when a write fails after others were written,
// with failures the file system cannot be made to produce on demand (a restore that is refused, an
// error that is no CommandError). The writer is wrapped so a test can make chosen calls fail.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { CommandError } from "../catalog.js";
import type * as files from "../files/index.js";
import { Workspace } from "../runtime/workspace.js";
import { editElementFile } from "../files/index.js";
import { metamodelState } from "../metamodel/index.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { setElementStatus } from "./status.js";
import { elementStoreState } from "./store.js";
import type { ElementFileWrite } from "./write.js";
import { readUnchanged, writeElementFiles } from "./write.js";

interface Control {
  /** Called before each write with its 1-based number; may throw to make that write fail. */
  before: (call: number) => void;
  /** Called with what each write gives, by its 1-based number; may give something else. */
  after: (call: number, snapshot: files.FileSnapshot) => files.FileSnapshot;
  calls: number;
  /** Paths whose bytes, parsed outside the files block (the check of written bytes), read back as no element. */
  unreadable: readonly string[];
}

const control: Control = vi.hoisted(() => ({
  before: () => undefined,
  after: (_call, snapshot) => snapshot,
  calls: 0,
  unreadable: [],
}));

vi.mock("../files/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof files>();
  return {
    ...actual,
    writeFileAtomic: async (...args: Parameters<typeof files.writeFileAtomic>) => {
      control.calls += 1;
      const call = control.calls;
      control.before(call);
      return control.after(call, await actual.writeFileAtomic(...args));
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
  control.after = (_call, snapshot) => snapshot;
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

  it("lists a restored file that does not hold the bytes as read afterwards, and names the failure as the cause", async () => {
    const { workspace, read } = await open();
    const refused = new CommandError("file.read-only", "Not written: read-only", { file: BARE.file });
    control.before = (call) => {
      if (call === 3) {
        throw refused;
      }
    };
    // Restore 4 (GUSTS) is written, but what is read back is not the file as read.
    control.after = (call, snapshot) => (call === 4 ? { ...snapshot, sha256: "0".repeat(64) } : snapshot);
    const before = await Promise.all([WIND.file, GUSTS.file].map(read));
    const error = await failure(workspace);
    expect(error).toBeInstanceOf(CommandError);
    expect([(error as CommandError).code, (error as CommandError).details]).toEqual([
      "file.read-only",
      { file: BARE.file, written: [GUSTS.file] },
    ]);
    expect((error as CommandError).cause).toBe(refused);
    expect(control.calls).toBe(5);
    expect(await Promise.all([WIND.file, GUSTS.file].map(read))).toEqual(before);
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

  it("writes several files at a time on request, and reports the first of several failures", async () => {
    const { workspace, read } = await open();
    const before = await Promise.all([WIND.file, GUSTS.file, BARE.file].map(read));
    const layout = await workspace.get(workspaceLayoutState);
    const store = await workspace.get(elementStoreState);
    const metamodel = await workspace.get(metamodelState);
    const writes: ElementFileWrite[] = [];
    for (const element of [WIND, GUSTS, BARE]) {
      const record = store.elements.find((e) => e.id === element.id);
      if (record === undefined) {
        throw new Error(`no element ${element.id}`);
      }
      const read = await readUnchanged(workspace, layout, record);
      writes.push({ ...read, bytes: editElementFile(read.current.file, { body: "Changed.\n" }).bytes });
    }
    // Writes 1 WIND and 2 GUSTS start together and both fail; BARE is never written.
    control.before = (call) => {
      if (call === 1) {
        throw new CommandError("file.read-only", "Not written: first");
      }
      if (call === 2) {
        throw new CommandError("file.read-only", "Not written: second");
      }
    };
    const error = await writeElementFiles(workspace, layout, writes, {
      concurrency: 2,
      titles: { metamodel, store },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CommandError);
    expect((error as CommandError).message).toBe("Not written: first");
    expect(control.calls).toBe(2);
    expect(await Promise.all([WIND.file, GUSTS.file, BARE.file].map(read))).toEqual(before);
    // Without a failure every file is written, in the order of the writes.
    control.before = () => undefined;
    const fresh = await workspace.get(elementStoreState);
    const again: ElementFileWrite[] = [];
    for (const record of fresh.elements.filter((e) => [WIND.id, GUSTS.id, BARE.id].includes(e.id))) {
      const read = await readUnchanged(workspace, layout, record);
      again.push({ ...read, bytes: editElementFile(read.current.file, { body: "Changed.\n" }).bytes });
    }
    const written = await writeElementFiles(workspace, layout, again, {
      concurrency: 3,
      titles: { metamodel, store: fresh },
    });
    expect(written.map((w) => w.written.record.id)).toEqual(again.map((w) => w.current.record.id));
  });
});

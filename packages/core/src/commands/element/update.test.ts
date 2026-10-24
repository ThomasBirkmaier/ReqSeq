import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { editElementFile, parseFileBytes } from "../../files/index.js";
import type { ElementRecord, ElementStore } from "../../model/index.js";
import { elementStoreState, loadElements, shortIdState } from "../../model/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
import { workspaceLayoutState } from "../../workspace/index.js";

type Output = CommandOutput<"element.update">;

/** The two elements of fixtures/SR-001/two-elements. */
const WIND = { id: "e8df96ea-a168-4d90-8d65-6328cee88fb3", file: "requirements/SR-6328cee88fb3.md" };
const GUSTS = { id: "3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c", file: "requirements/SR-1d2e3f4a5b6c.md" };

interface Opened {
  readonly fixture: FixtureWorkspace;
  readonly workspace: Workspace;
}

const open = async (options: FixtureOptions = {}): Promise<Opened> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-001/two-elements", ...options });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const update = async (opened: Opened, input: Record<string, unknown>): Promise<Output> =>
  (await invoke("element.update", input, { workspace: opened.workspace })) as Output;

const updateError = async (opened: Opened, input: Record<string, unknown>): Promise<CommandError> => {
  try {
    await update(opened, input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected element.update to fail");
};

const read = (opened: Opened, file: string): Promise<string> =>
  fs.readFile(opened.fixture.path(file), "utf8");

const filesBelow = async (folder: string): Promise<string[]> => {
  const entries = await fs.readdir(folder, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && !e.parentPath.split(path.sep).includes(".git"))
    .map((e) => path.relative(folder, path.join(e.parentPath, e.name)).split(path.sep).join("/"))
    .sort();
};

/** The lines of `before` that `after` changes, as `git diff` would show them for a single change. */
const changedLines = (before: string, after: string): { removed: string[]; added: string[] } => {
  const a = before.split("\n");
  const b = after.split("\n");
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) {
    p++;
  }
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) {
    s++;
  }
  return { removed: a.slice(p, a.length - s), added: b.slice(p, b.length - s) };
};

describe("element.update", () => {
  it("[SR-001/AK2] keeps the file name when the element is renamed", async () => {
    const opened = await open();
    const files = await filesBelow(opened.fixture.root);
    const before = await read(opened, GUSTS.file);
    const out = await update(opened, { ref: "SR-4a5b6c", title: "Show gusts and squalls" });
    expect(out.files).toEqual([GUSTS.file]);
    expect(out.element).toMatchObject({ id: GUSTS.id, file: GUSTS.file, title: "Show gusts and squalls" });
    expect(await filesBelow(opened.fixture.root)).toEqual(files);
    expect(changedLines(before, await read(opened, GUSTS.file))).toEqual({
      removed: ["title:   'Show gusts'           # aligned by hand"],
      added: ["title:   Show gusts and squalls           # aligned by hand"],
    });
  });

  it("[SR-002/AK2] keeps the UUID when title and text change", async () => {
    const opened = await open();
    const out = await update(opened, { ref: WIND.id, title: "Show wind", text: "\nNew text.\n" });
    expect(out.element).toMatchObject({ id: WIND.id, title: "Show wind", text: "\nNew text.\n" });
    expect(await read(opened, WIND.file)).toBe(
      `---\nid: ${WIND.id}\ntype: system-requirement\nstatus: draft\ntitle: Show wind\n---\n\nNew text.\n`,
    );
    const again = await update(opened, { ref: "SR-e88fb3", title: "Show wind speed" });
    expect(again.element.id).toBe(WIND.id);
  });

  it("the writer keeps the id line when type or status are set (support for SR-002 AK2)", async () => {
    // Not the AK itself: element.setStatus (SR-017, #29) adds the SR-002 AK2 test for a status
    // change; how a type changes is spec question #165.
    const text = await fs.readFile(
      new URL("../../../../../fixtures/SR-001/two-elements/requirements/SR-1d2e3f4a5b6c.md", import.meta.url),
      "utf8",
    );
    const parsed = parseFileBytes("a.md", new TextEncoder().encode(text));
    if (parsed.kind !== "parsed") {
      throw new Error("fixture does not parse");
    }
    const { bytes } = editElementFile(parsed.content, {
      edits: [
        { kind: "set", key: "type", value: "need" },
        { kind: "set", key: "status", value: "approved" },
      ],
    });
    const after = new TextDecoder().decode(bytes);
    expect(after).toContain(`\nid: ${GUSTS.id}\n`);
    expect(changedLines(text, after).removed).not.toContain(`id: ${GUSTS.id}`);
    const reread = parseFileBytes("a.md", bytes);
    expect(reread.kind === "parsed" ? reread.content.data : undefined).toMatchObject({
      id: GUSTS.id,
      type: "need",
      status: "approved",
    });
  });

  it("[SR-001/AK3] changes of different elements on two branches merge without a conflict", async () => {
    const opened = await open({ git: true });
    const { fixture } = opened;
    const onBranch = async (
      branch: string,
      input: Record<string, unknown>,
      extra?: Record<string, unknown>,
    ): Promise<void> => {
      await fixture.git(["checkout", "--quiet", "-b", branch, "main"]);
      const workspace = new Workspace(fixture.root);
      try {
        await invoke("element.update", input, { workspace });
        if (extra !== undefined) {
          await invoke("element.create", extra, { workspace });
        }
      } finally {
        await workspace.close();
      }
      await fixture.commit(".", `change on ${branch}`);
    };
    await onBranch(
      "alice",
      { ref: WIND.id, title: "Show the wind speed" },
      { type: "need", title: "Alice's need" },
    );
    await onBranch(
      "bob",
      { ref: GUSTS.id, text: "\nThe station shows gusts above 12 m/s.\n", set: { rationale: "Safety" } },
      { type: "need", title: "Bob's need" },
    );
    await fixture.git(["checkout", "--quiet", "main"]);
    await fixture.git(["merge", "--quiet", "--no-edit", "alice"]);
    // Throws on a conflict (exit code 1).
    await fixture.git(["merge", "--quiet", "--no-edit", "bob"]);
    expect(await fixture.git(["status", "--porcelain"])).toBe("");
    expect(await read(opened, WIND.file)).toContain("title: Show the wind speed\n");
    const gusts = await read(opened, GUSTS.file);
    expect(gusts).toContain("gusts above 12 m/s");
    expect(gusts).toContain("\nrationale: Safety\n---");
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    const store = await workspace.get(elementStoreState);
    expect(store.elements).toHaveLength(4);
  });

  it("changes only the lines of a changed property and keeps unknown properties and comments", async () => {
    const opened = await open();
    const before = await read(opened, GUSTS.file);
    const out = await update(opened, { ref: GUSTS.id, set: { "requirement-type": "performance" } });
    const after = await read(opened, GUSTS.file);
    expect(changedLines(before, after)).toEqual({
      removed: ["requirement-type: functional"],
      added: ["requirement-type: performance"],
    });
    expect(after).toContain("customer-id: 00815              # unknown to the metamodel (SR-016)\n");
    expect(out.element.properties).toEqual({
      "customer-id": 815,
      "requirement-type": "performance",
      "acceptance-criteria": ["Given a gust, when it is measured, then the station shows it."],
    });
    expect(out.element.relations).toEqual([
      {
        kind: "derives-from",
        meaning: "derivation",
        direction: "out",
        id: WIND.id,
        shortId: "SR-e88fb3",
        title: "Show wind speed",
        accessible: true,
        storedVersion: "n1:0000000000000000",
      },
    ]);
  });

  it("appends new keys in the order of the type and removes unset keys", async () => {
    const opened = await open();
    await update(opened, {
      ref: WIND.id,
      set: { "verification-method": "test", rationale: "Pilots need it" },
    });
    expect(await read(opened, WIND.file)).toBe(
      `---\nid: ${WIND.id}\ntype: system-requirement\nstatus: draft\ntitle: Show wind speed\nrationale: Pilots need it\nverification-method: test\n---\n\nThe station shows the current wind speed.\n`,
    );
    const before = await read(opened, GUSTS.file);
    await update(opened, { ref: GUSTS.id, unset: ["acceptance-criteria"] });
    expect(changedLines(before, await read(opened, GUSTS.file)).removed).toEqual([
      "acceptance-criteria:",
      "  - Given a gust, when it is measured, then the station shows it.",
    ]);
  });

  it("writes nothing when nothing changes and keeps the element store", async () => {
    const opened = await open();
    const before = await read(opened, GUSTS.file);
    const store = await opened.workspace.get(elementStoreState);
    const out = await update(opened, {
      ref: GUSTS.id,
      title: "Show gusts",
      text: "\nThe station shows gusts above 10 m/s.\n",
      set: { "requirement-type": "functional" },
      unset: ["rationale"],
    });
    expect(out.files).toEqual([]);
    expect(out.element.title).toBe("Show gusts");
    expect(await read(opened, GUSTS.file)).toBe(before);
    expect(await opened.workspace.get(elementStoreState)).toBe(store);
  });

  it("updates the element store in place after a write, equal to a full read (#166)", async () => {
    const opened = await open();
    const store = await opened.workspace.get(elementStoreState);
    const shortIds = await opened.workspace.get(shortIdState);
    await update(opened, { ref: WIND.id, title: "Renamed" });
    const after = opened.workspace.peek(elementStoreState);
    expect(after).toBeDefined();
    const now = await after;
    expect(now).not.toBe(store);
    expect(now?.byId.get(WIND.id)?.[0]?.data["title"]).toBe("Renamed");
    // The other element was not read again, and the store is what a full read gives.
    expect(now?.byId.get(GUSTS.id)?.[0]).toBe(store.byId.get(GUSTS.id)?.[0]);
    expect(now).toEqual(await loadElements(await opened.workspace.get(workspaceLayoutState)));
    // The states built on the store follow it.
    const rebuilt = await opened.workspace.get(shortIdState);
    expect(rebuilt).not.toBe(shortIds);
    expect(rebuilt.find("SR-e88fb3")).toMatchObject({
      kind: "found",
      element: { data: { title: "Renamed" } },
    });
  });

  it("keeps CRLF line endings and the byte order mark", async () => {
    const crlf = `\ufeff---\r\nid: ${WIND.id}\r\ntype: system-requirement\r\nstatus: draft\r\ntitle: Show wind speed\r\n---\r\nText\r\n`;
    const opened = await open({ files: { [WIND.file]: crlf } });
    await update(opened, { ref: WIND.id, title: "Wind", text: "Text\nMore\n" });
    expect(await read(opened, WIND.file)).toBe(
      `\ufeff---\r\nid: ${WIND.id}\r\ntype: system-requirement\r\nstatus: draft\r\ntitle: Wind\r\n---\r\nText\r\nMore\r\n`,
    );
  });

  it("refuses unknown and ambiguous references", async () => {
    const opened = await open({
      files: {
        "copy/SR-1d2e3f4a5b6c.md": await fs.readFile(
          new URL(`../../../../../fixtures/SR-001/two-elements/${GUSTS.file}`, import.meta.url),
        ),
      },
    });
    const unknownId = await updateError(opened, { ref: "0b7c6e1a-1111-4222-8333-444455556666", title: "x" });
    expect([unknownId.code, unknownId.details]).toEqual([
      "ref.unknown",
      { ref: "0b7c6e1a-1111-4222-8333-444455556666" },
    ]);
    expect((await updateError(opened, { ref: "SR-ffffff", title: "x" })).code).toBe("ref.unknown");
    const duplicate = await updateError(opened, { ref: GUSTS.id, title: "x" });
    expect([duplicate.code, duplicate.details]).toEqual([
      "ref.ambiguous",
      {
        ref: GUSTS.id,
        candidates: [
          { id: GUSTS.id, repository: "system", file: "copy/SR-1d2e3f4a5b6c.md" },
          { id: GUSTS.id, repository: "system", file: GUSTS.file },
        ],
      },
    ]);
    expect((await updateError(opened, { ref: "SR-4a5b6c", title: "x" })).code).toBe("ref.ambiguous");
  });

  it("only reads an element of an unknown type (SR-016 AK3)", async () => {
    const opened = await open({
      files: {
        "requirements/X-aaaaaaaaaaaa.md": `---\nid: 0b7c6e1a-1111-4222-8333-aaaaaaaaaaaa\ntype: gadget\nstatus: draft\n---\n`,
      },
    });
    const error = await updateError(opened, { ref: "0b7c6e1a-1111-4222-8333-aaaaaaaaaaaa", title: "x" });
    expect([error.code, error.details]).toEqual([
      "element.read-only",
      { id: "0b7c6e1a-1111-4222-8333-aaaaaaaaaaaa", type: "gadget", reason: "unknown-type" },
    ]);
  });

  it("refuses keys that are no property of the type, the title key, structural keys and a key in set and unset", async () => {
    const opened = await open();
    const before = await read(opened, GUSTS.file);
    const cases: [Record<string, unknown>, string, string | undefined][] = [
      [{ set: { "customer-id": "WS-1" } }, "input.invalid", "not-a-property"],
      [{ unset: ["customer-id"] }, "input.invalid", "not-a-property"],
      [{ set: { "derives-from": [] } }, "input.invalid", "relation"],
      [{ set: { title: "x" } }, "input.invalid", "title"],
      [{ unset: ["title"] }, "input.invalid", "title"],
      [{ set: { rationale: "a" }, unset: ["rationale"] }, "input.invalid", "set-and-unset"],
      [{ set: { status: "approved" } }, "input.invalid", undefined],
      [{ unset: ["type"] }, "input.invalid", undefined],
    ];
    for (const [input, code, reason] of cases) {
      const error = await updateError(opened, { ref: GUSTS.id, ...input });
      expect([error.code, error.details?.["reason"]]).toEqual([code, reason]);
    }
    expect(await read(opened, GUSTS.file)).toBe(before);
  });

  it("refuses a file that changed on disk since it was read and works again on the next call", async () => {
    const opened = await open();
    await opened.workspace.get(elementStoreState);
    const changed = (await read(opened, WIND.file)).replace("Show wind speed", "Changed elsewhere");
    await fs.writeFile(opened.fixture.path(WIND.file), changed);
    const error = await updateError(opened, { ref: WIND.id, text: "Mine\n" });
    expect([error.code, error.details]).toEqual([
      "file.changed-on-disk",
      { file: WIND.file, repository: "system" },
    ]);
    expect(await read(opened, WIND.file)).toBe(changed);
    const out = await update(opened, { ref: WIND.id, text: "Mine\n" });
    expect(out.element).toMatchObject({ title: "Changed elsewhere", text: "Mine\n" });
  });

  it("refuses a file that became faulty or was removed since it was read", async () => {
    const opened = await open();
    await opened.workspace.get(elementStoreState);
    await fs.writeFile(opened.fixture.path(WIND.file), "---\nid: [\n---\n");
    expect((await updateError(opened, { ref: WIND.id, title: "x" })).code).toBe("file.changed-on-disk");
    await opened.workspace.get(elementStoreState);
    await fs.rm(opened.fixture.path(GUSTS.file));
    expect((await updateError(opened, { ref: GUSTS.id, title: "x" })).code).toBe("file.changed-on-disk");
    await fs.writeFile(opened.fixture.path(GUSTS.file), "---\ntitle: no longer an element\n---\n");
    await opened.workspace.reset(elementStoreState);
    await fs.writeFile(
      opened.fixture.path(WIND.file),
      `---\nid: ${WIND.id}\ntype: need\nstatus: draft\n---\n`,
    );
    await opened.workspace.get(elementStoreState);
    await fs.writeFile(opened.fixture.path(WIND.file), "---\ntitle: no longer an element\n---\n");
    expect((await updateError(opened, { ref: WIND.id, title: "x" })).code).toBe("file.changed-on-disk");
  });
});

describe("element.update in a workspace of 50,000 elements (#166, N-036)", () => {
  /**
   * A sanity bound only. What this test checks is that a save reads no other file and keeps the
   * other records; wall-clock time in a parallel suite with coverage varies too much between
   * machines (about 140 ms alone on 4 cores with Linux, up to 370 ms in the suite on macOS). The
   * strict 200 ms check of SR-082 AK3 on the reference machine belongs to the nightly performance
   * job (ADR-0008, #94). A full read of 50,000 files, which every save cost before #166, takes
   * seconds.
   */
  const SANITY_BOUND_MS = 1500;

  /** `count` elements that exist in the store only, as if read from files (none is read). */
  const generated = (count: number): ElementRecord[] =>
    Array.from({ length: count }, (_, n) => {
      const id = `0f1e2d3c-4b5a-4968-8776-${n.toString(16).padStart(12, "0")}`;
      const file = `generated/SR-${id.slice(-12)}.md`;
      return {
        id,
        type: "system-requirement",
        repository: "system",
        file,
        data: { id, type: "system-requirement", status: "draft", title: `Generated ${String(n)}` },
        eol: "\n",
        closingEol: "\n",
        bom: false,
        snapshot: { path: file, size: 100, mtimeMs: 0, sha256: "0".repeat(64) },
      };
    });

  it("updates one element, then has store and short IDs current, reading no other file", async () => {
    const opened = await open();
    const current = opened.workspace.get(elementStoreState);
    const small = await current;
    const records = generated(50_000);
    const [contents] = small.repositories ?? [];
    if (contents === undefined) {
      throw new Error("no repository contents");
    }
    const files = new Map(contents.files);
    for (const record of records) {
      files.set(record.file, { kind: "element", element: record, warnings: [], snapshot: record.snapshot });
    }
    const elements = [...small.elements, ...records];
    const big: ElementStore = {
      ...small,
      elements,
      byId: new Map(elements.map((e) => [e.id, [e]])),
      repositories: [
        { ...contents, files: new Map([...files].sort(([a], [b]) => Number(a > b) - Number(a < b))) },
      ],
    };
    expect(await opened.workspace.replace(elementStoreState, current, Promise.resolve(big))).toBe(true);
    // An editing session: a first save compiles the schemas once; then saves are measured, the
    // best of three, so that a pause of the machine (GC, CI neighbours) does not decide.
    await update(opened, { ref: GUSTS.id, title: "Show gusts now" });
    await opened.workspace.get(shortIdState);
    const reads = vi.spyOn(fs, "readFile");
    onTestFinished(() => {
      reads.mockRestore();
    });
    const times: number[] = [];
    for (const title of ["Show wind", "Show the wind", "Show wind speed again"]) {
      reads.mockClear();
      const start = performance.now();
      await update(opened, { ref: WIND.id, title });
      // What element.get will read: the store and the short IDs.
      const after = await opened.workspace.get(elementStoreState);
      const found = (await opened.workspace.get(shortIdState)).find("SR-e88fb3");
      times.push(performance.now() - start);
      expect(found).toMatchObject({ kind: "found", element: { data: { title } } });
      expect(after.elements).toHaveLength(50_002);
      expect(after.byId.get(records[0]?.id ?? "")?.[0]).toBe(records[0]);
      // The element's own file only: read before the write and checked by the write itself.
      expect(reads.mock.calls.map(([file]) => path.basename(file as string))).toEqual([
        path.basename(WIND.file),
        path.basename(WIND.file),
      ]);
    }
    expect(Math.min(...times)).toBeLessThan(SANITY_BOUND_MS);
  });
});

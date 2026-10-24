import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { editElementFile, parseFileBytes } from "../../files/index.js";
import { elementStoreState } from "../../model/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

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

  it("resets the element store after a write so the next read sees the change", async () => {
    const opened = await open();
    const store = await opened.workspace.get(elementStoreState);
    await update(opened, { ref: WIND.id, title: "Renamed" });
    const after = await opened.workspace.get(elementStoreState);
    expect(after).not.toBe(store);
    expect(after.byId.get(WIND.id)?.[0]?.data["title"]).toBe("Renamed");
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

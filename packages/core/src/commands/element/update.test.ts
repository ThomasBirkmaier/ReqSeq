import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { editElementFile, parseFileBytes } from "../../files/index.js";
import { STANDARD_MODEL_TEXT as STANDARD } from "../../metamodel/standard-model.js";
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
    const out = await update(opened, { ref: WIND.id, title: "Show wind", text: "New text.\n" });
    expect(out.element).toMatchObject({ id: WIND.id, title: "Show wind", text: "New text.\n" });
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
      { ref: GUSTS.id, text: "The station shows gusts above 12 m/s.\n", set: { rationale: "Safety" } },
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
        repository: "system",
        shortId: "SR-e88fb3",
        title: "Show wind speed",
        accessible: true,
        targetState: "available",
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

  it("[SR-064/AK2] saves an emptied title as the empty title, keeping its key, and gives its element.missing-required hint; the title is never unset (#621)", async () => {
    const opened = await open();
    const before = await read(opened, WIND.file);
    const out = await update(opened, { ref: WIND.id, title: "" });
    expect(out.element.title).toBe("");
    expect(changedLines(before, await read(opened, WIND.file))).toEqual({
      removed: ["title: Show wind speed"],
      added: ['title: ""'],
    });
    // The element lacks its other required properties too (requirement type, acceptance criteria).
    const hints = (out.problems ?? []).filter(
      (problem) => problem.code === "element.missing-required" && problem.message.includes("(title)"),
    );
    expect(hints).toEqual([
      expect.objectContaining({
        severity: "warning",
        message: expect.stringContaining("Required property Title (title)") as unknown,
        elementId: WIND.id,
        line: 5,
      }),
    ]);
    expect(out.element.problems).toEqual(out.problems);
    const refused = await updateError(opened, { ref: WIND.id, unset: ["title"] });
    expect(refused.code).toBe("input.invalid");
    expect(await read(opened, WIND.file)).toContain('title: ""\n');
  });

  it("[SR-064/AK3] an element created with only its title takes every other property of its type when opened again, required and optional (the origin aside, SR-057), in type order; the hints of the filled required properties are gone", async () => {
    const opened = await open();
    const create = async (input: Record<string, unknown>): Promise<CommandOutput<"element.create">> =>
      (await invoke("element.create", input, {
        workspace: opened.workspace,
      })) as CommandOutput<"element.create">;
    const variant = await create({ type: "variant", title: "Mountain" });
    const pkg = await create({ type: "package", title: "Sensors" });
    const created = await create({ type: "system-requirement", title: "Show gusts" });
    expect(created.problems).toEqual([
      expect.objectContaining({
        code: "element.missing-required",
        message: expect.stringContaining("(requirement-type)") as unknown,
      }),
      expect.objectContaining({
        code: "element.missing-required",
        message: expect.stringContaining("(acceptance-criteria)") as unknown,
      }),
      expect.objectContaining({ code: "trace.no-parent" }),
    ]);
    await opened.workspace.close();

    // Opened again: a new workspace reads the saved file.
    const again = new Workspace(opened.fixture.root);
    onTestFinished(() => again.close());
    const out = (await invoke(
      "element.update",
      {
        ref: created.element.id,
        // Given in reverse type order: the file gets them in the order of the type (ADR-0004).
        set: {
          // The origin is left out: only reqif.import writes it (SR-057 AK3).
          topic: "Wind",
          statement: "Gusts are shown.",
          "verification-method": "test",
          emergent: "no",
          packages: [{ id: pkg.element.id }],
          validity: [{ id: variant.element.id }],
          "acceptance-criteria": ["Given a gust, then it is shown."],
          "requirement-type": "functional",
          rationale: "Pilots need it",
        },
      },
      { workspace: again },
    )) as Output;
    // The required properties are filled; the parent is still missing (SR-022 AK6).
    expect(out.problems?.map((p) => p.code)).toEqual(["trace.no-parent"]);
    const file = await read(opened, created.files[0] ?? "");
    const keys = file
      .split("\n")
      .slice(1, file.split("\n").indexOf("---", 1))
      .filter((line) => /^[a-z]/.test(line))
      .map((line) => line.slice(0, line.indexOf(":")));
    expect(keys).toEqual([
      "id",
      "type",
      "status",
      "title",
      "rationale",
      "requirement-type",
      "acceptance-criteria",
      "validity",
      "packages",
      "emergent",
      "verification-method",
      "statement",
      "topic",
    ]);
    expect(out.element.properties).toMatchObject({
      rationale: "Pilots need it",
      "requirement-type": "functional",
      "acceptance-criteria": ["Given a gust, then it is shown."],
      validity: [expect.objectContaining({ id: variant.element.id, title: "Mountain" })],
      packages: [expect.objectContaining({ id: pkg.element.id, title: "Sensors" })],
      emergent: "no",
      "verification-method": "test",
      statement: "Gusts are shown.",
      topic: "Wind",
    });
  });

  it("writes nothing when nothing changes and keeps the element store", async () => {
    const opened = await open();
    const before = await read(opened, GUSTS.file);
    const store = await opened.workspace.get(elementStoreState);
    const out = await update(opened, {
      ref: GUSTS.id,
      title: "Show gusts",
      text: "The station shows gusts above 10 m/s.\n",
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

  it("refuses with workspace.read-only while the metamodel is not valid, even for an unknown key (#208)", async () => {
    const opened = await open({ files: { "metamodel/broken.yaml": "properties: [\n" } });
    const before = await filesBelow(opened.fixture.root);
    // The command refuses before element.update looks at the keys against the partial metamodel.
    const error = await updateError(opened, { ref: GUSTS.id, set: { bogus: 1 } });
    expect(error.code).toBe("workspace.read-only");
    expect(await filesBelow(opened.fixture.root)).toEqual(before);
  });

  it("[SR-086/AK1] gives the hint on a relation between types that are not allowed for the element it writes", async () => {
    const fixture = await createFixtureWorkspace({ fixture: "SR-086/relation-types" });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.path("system"));
    onTestFinished(() => workspace.close());
    const out = await update(
      { fixture, workspace },
      { ref: "22a972fd-f4f1-4b95-ba1d-e3e85234824e", text: "Changed.\n" },
    );
    expect((out.problems ?? []).filter((p) => p.code === "relation.not-allowed")).toEqual([
      expect.objectContaining({
        severity: "warning",
        elementId: "22a972fd-f4f1-4b95-ba1d-e3e85234824e",
        targetId: "fa1e252c-ae4a-43c5-b53c-c03e4db185f3",
        line: 7,
      }),
    ]);
    expect(out.element.problems).toEqual(out.problems);
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

  it("[SR-012/AK3] writes the key of a choice value given by its display name, in any case (#309)", async () => {
    const opened = await open();
    const out = await update(opened, { ref: GUSTS.id, set: { "requirement-type": "performance" } });
    expect(out.element.properties["requirement-type"]).toBe("performance");
    await update(opened, { ref: GUSTS.id, set: { "requirement-type": "Quality" } });
    expect(await read(opened, GUSTS.file)).toContain("\nrequirement-type: quality\n");
    await update(opened, { ref: GUSTS.id, set: { "requirement-type": "interface" } });
    expect(await read(opened, GUSTS.file)).toContain("\nrequirement-type: interface\n");
    // An empty value is no choice to look up.
    await update(opened, { ref: GUSTS.id, set: { "requirement-type": null } });
    expect(await read(opened, GUSTS.file)).not.toContain("requirement-type: interface");
  });

  it("refuses a choice value that names no choice and leaves the file as it is (#309, spec question #316)", async () => {
    const opened = await open();
    const before = await read(opened, GUSTS.file);
    const error = await updateError(opened, { ref: GUSTS.id, set: { "requirement-type": "Sometimes" } });
    expect([error.code, error.details]).toMatchObject([
      "input.invalid",
      { key: "requirement-type", reason: "unknown-choice" },
    ]);
    expect(error.message).toMatch(
      /^set\.requirement-type: Sometimes is not a value of Requirement Type; the values are: functional \(Functional\), /,
    );
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

/** The SHA-256 of a file of the fixture as it is on disk now, as `fileSha256` gives it. */
const sha256Of = async (opened: Opened, file: string): Promise<string> =>
  createHash("sha256")
    .update(await fs.readFile(opened.fixture.path(file)))
    .digest("hex");

describe("element.update: the write precondition expectedFileSha256 (SR-106)", () => {
  const OLD = "0".repeat(64);

  it("gives the SHA-256 of the file as written, or as read when nothing changed (SR-106)", async () => {
    const opened = await open();
    const unchanged = await update(opened, { ref: WIND.id });
    expect([unchanged.files, unchanged.fileSha256]).toEqual([[], await sha256Of(opened, WIND.file)]);
    const written = await update(opened, { ref: WIND.id, text: "Mine\n" });
    expect(written.files).toEqual([WIND.file]);
    expect(written.fileSha256).toBe(await sha256Of(opened, WIND.file));
    expect(written.fileSha256).not.toBe(unchanged.fileSha256);
  });

  it("writes with the hash element.get gave, and chains saves on the hash each save gives (SR-106)", async () => {
    const opened = await open();
    const shown = (await invoke(
      "element.get",
      { ref: WIND.id },
      { workspace: opened.workspace },
    )) as CommandOutput<"element.get">;
    expect(shown.fileSha256).toBe(await sha256Of(opened, WIND.file));
    const first = await update(opened, { ref: WIND.id, text: "One\n", expectedFileSha256: shown.fileSha256 });
    const second = await update(opened, {
      ref: WIND.id,
      text: "Two\n",
      expectedFileSha256: first.fileSha256,
    });
    expect(second.element.text).toBe("Two\n");
    expect(await read(opened, WIND.file)).toContain("\nTwo\n");
    // The hash of a save that changed nothing is the file's, so the chain goes on.
    const same = await update(opened, { ref: WIND.id, expectedFileSha256: second.fileSha256 });
    expect([same.files, same.fileSha256]).toEqual([[], second.fileSha256]);
  });

  it("refuses with file.changed-on-disk and writes nothing when the store already read the change (SR-106)", async () => {
    const opened = await open();
    const before = await sha256Of(opened, WIND.file);
    await opened.workspace.get(elementStoreState);
    // Someone else changes the title, which does not count to the version, and the store reads it.
    const changed = (await read(opened, WIND.file)).replace(
      "title: Show wind speed",
      "title: Changed elsewhere",
    );
    await fs.writeFile(opened.fixture.path(WIND.file), changed);
    await opened.workspace.reset(elementStoreState);
    const store = await opened.workspace.get(elementStoreState);
    const reset = vi.spyOn(opened.workspace, "reset");
    const error = await updateError(opened, {
      ref: WIND.id,
      title: "Show wind speed",
      expectedFileSha256: before,
    });
    expect([error.code, error.details, error.message]).toEqual([
      "file.changed-on-disk",
      { file: WIND.file, repository: "system" },
      `Not written: ${WIND.file} changed on disk since it was read. Read it again first.`,
    ]);
    expect(await read(opened, WIND.file)).toBe(changed);
    // Store and file agree, only the caller's hash is old: the element store is not read again (N-036).
    expect(reset).not.toHaveBeenCalled();
    await invoke("element.get", { ref: WIND.id }, { workspace: opened.workspace });
    expect(await opened.workspace.get(elementStoreState)).toBe(store);
  });

  it("refuses an old hash also when the input would change nothing (SR-106)", async () => {
    const opened = await open();
    const before = await read(opened, WIND.file);
    const error = await updateError(opened, { ref: WIND.id, expectedFileSha256: OLD });
    expect([error.code, error.details]).toEqual([
      "file.changed-on-disk",
      { file: WIND.file, repository: "system" },
    ]);
    expect(await read(opened, WIND.file)).toBe(before);
  });

  it("refuses with file.changed-on-disk when the store has not read the change yet, and reads it again (SR-106)", async () => {
    const opened = await open();
    const before = await sha256Of(opened, WIND.file);
    await opened.workspace.get(elementStoreState);
    const changed = (await read(opened, WIND.file)).replace("Show wind speed", "Changed elsewhere");
    await fs.writeFile(opened.fixture.path(WIND.file), changed);
    const error = await updateError(opened, { ref: WIND.id, text: "Mine\n", expectedFileSha256: before });
    expect([error.code, error.details]).toEqual([
      "file.changed-on-disk",
      { file: WIND.file, repository: "system" },
    ]);
    expect(await read(opened, WIND.file)).toBe(changed);
    // With the hash of the file as it is now, the save goes through.
    const out = await update(opened, {
      ref: WIND.id,
      text: "Mine\n",
      expectedFileSha256: await sha256Of(opened, WIND.file),
    });
    expect(out.element).toMatchObject({ title: "Changed elsewhere", text: "Mine\n" });
  });

  it("checks the input before the precondition", async () => {
    const opened = await open();
    const error = await updateError(opened, { ref: WIND.id, set: { nope: "x" }, expectedFileSha256: OLD });
    expect(error.code).toBe("input.invalid");
    for (const hash of ["", "A".repeat(64), "0".repeat(63)]) {
      expect((await updateError(opened, { ref: WIND.id, expectedFileSha256: hash })).code).toBe(
        "input.invalid",
      );
    }
  });
});

describe("element.update: one copy of a duplicate by its repository (SR-088, #255)", () => {
  /** SR-004/three-repositories, with a copy of the system requirement in the sensor repository. */
  const SPEED = { id: "2525fbab-1344-4bcf-8a35-4b4da63a2dd1", file: "requirements/SR-4b4da63a2dd1.md" };
  const COPY = "sensor/copies/SR-4b4da63a2dd1.md";

  const openCopies = async (): Promise<Opened> => {
    const fixture = await createFixtureWorkspace({
      fixture: "SR-004/three-repositories",
      files: {
        [COPY]: await fs.readFile(
          new URL(`../../../../../fixtures/SR-004/three-repositories/system/${SPEED.file}`, import.meta.url),
        ),
      },
    });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.path("system"));
    onTestFinished(() => workspace.close());
    return { fixture, workspace };
  };

  it("changes only the copy in the repository given, as element.get picks it", async () => {
    const opened = await openCopies();
    const original = await fs.readFile(opened.fixture.path(`system/${SPEED.file}`), "utf8");
    expect((await updateError(opened, { ref: SPEED.id, title: "x" })).code).toBe("ref.ambiguous");
    const out = await update(opened, { ref: SPEED.id, repository: "sensor", title: "The copy" });
    expect([out.element.repository, out.element.file, out.element.title]).toEqual([
      "sensor",
      "copies/SR-4b4da63a2dd1.md",
      "The copy",
    ]);
    expect(await fs.readFile(opened.fixture.path(COPY), "utf8")).toContain("title: The copy");
    expect(await fs.readFile(opened.fixture.path(`system/${SPEED.file}`), "utf8")).toBe(original);
    const shown = await invoke(
      "element.get",
      { ref: SPEED.id, repository: "sensor" },
      { workspace: opened.workspace },
    );
    expect(shown).toMatchObject({ element: { title: "The copy" }, fileSha256: out.fileSha256 });
    const elsewhere = await updateError(opened, { ref: SPEED.id, repository: "product", title: "x" });
    expect([elsewhere.code, elsewhere.details]).toMatchObject([
      "ref.unknown",
      { ref: SPEED.id, repository: "product" },
    ]);
  });
});

describe("element.update: directly affected elements (SR-024)", () => {
  /** fixtures/SR-024/affected: b002 derives from b001, b003 refers to it in its text, b004 derives from b002, b005 replaces b002. */
  const AFFECTED: FixtureOptions = { fixture: "SR-024/affected" };
  const SPEED = "SR-00b001";
  const SPEED_FILE = "requirements/SR-00000000b001.md";

  it("[SR-024/AK2] shows the number of directly affected elements when the content changed", async () => {
    const opened = await open(AFFECTED);
    const text = await update(opened, { ref: SPEED, text: "The station shows the wind speed in knots.\n" });
    expect([text.files, text.affected]).toEqual([["requirements/SR-00000000b001.md"], 2]);
    // A property that counts to the version (D-013): the same two.
    expect((await update(opened, { ref: SPEED, set: { "requirement-type": "quality" } })).affected).toBe(2);
    // A relation and a replacement point at the gusts; the storm warning derived from them is not direct.
    expect((await update(opened, { ref: "SR-00b002", text: "Gusts.\n" })).affected).toBe(2);
    // Nothing points at the storm warning.
    const storms = await update(opened, { ref: "SR-00b004", text: "Warn.\n" });
    expect([storms.files.length, storms.affected]).toEqual([1, 0]);
  });

  it("[SR-024/AK2] counts an element with a relation and a reference to it once", async () => {
    const opened = await open(AFFECTED);
    const gusts = await read(opened, "requirements/SR-00000000b002.md");
    await fs.writeFile(
      opened.fixture.path("requirements/SR-00000000b002.md"),
      gusts.replace(
        "The station shows gusts.",
        "Gusts beside [Show wind speed](reqseq:5c0e1d2a-0024-4024-8024-00000000b001?version=n1:0000000000000000).",
      ),
    );
    expect((await update(opened, { ref: SPEED, text: "Speed.\n" })).affected).toBe(2);
  });

  it("[SR-024/AK2] counts a save of an element whose old version had no normal form as a change", async () => {
    const model = STANDARD.replace(
      "\nrelations:",
      "  - { key: weight, name: Weight, kind: number, content: true }\n\nrelations:",
    ).replace("        topic,\n      ]", "        topic,\n        weight,\n      ]");
    const opened = await open({ ...AFFECTED, files: { "metamodel/standard-model.yaml": model } });
    const file = "requirements/SR-00000000b001.md";
    await fs.writeFile(
      opened.fixture.path(file),
      (await read(opened, file)).replace("status: draft", "status: draft\nweight: .inf"),
    );
    const out = await update(opened, { ref: SPEED, unset: ["weight"] });
    expect([out.files, out.affected]).toEqual([[file], 2]);
  });

  /** SPEED with an acceptance criterion `.inf`, which counts and has no normal form: no version (#276). */
  const openEndless = async (): Promise<Opened> => {
    const opened = await open(AFFECTED);
    await fs.writeFile(
      opened.fixture.path(SPEED_FILE),
      (await read(opened, SPEED_FILE)).replace(
        "  - Given wind, when it is measured, then the station shows its speed.\n",
        "  - .inf\n",
      ),
    );
    return opened;
  };

  it("[SR-024/AK2] counts a change of the content of an element that keeps a value without a normal form (#276)", async () => {
    const opened = await openEndless();
    // The text changes and the value stays: neither the old nor the new element has a version.
    const text = await update(opened, { ref: SPEED, text: "The station shows the wind speed in knots.\n" });
    expect([text.files, text.affected]).toEqual([[SPEED_FILE], 2]);
    expect(text.element).not.toHaveProperty("version");
    expect(text.problems?.at(-1)).toMatchObject({
      code: "file.faulty",
      severity: "warning",
      message: `No version: ${SPEED_FILE} of repository system: version: Infinity is not a valid number`,
    });
    expect(text.element.problems).toEqual(text.problems);
    // A property that counts changes, the value stays.
    const counted = await update(opened, { ref: SPEED, set: { "requirement-type": "quality" } });
    expect([counted.files, counted.affected]).toEqual([[SPEED_FILE], 2]);
  });

  it("[SR-024/AK3] shows no affected elements when only the title of an element without a version changed (#276)", async () => {
    const opened = await openEndless();
    const title = await update(opened, { ref: SPEED, title: "Show the wind speed" });
    expect([title.files, title.affected]).toEqual([[SPEED_FILE], 0]);
    expect(title.element).not.toHaveProperty("version");
    expect(title.element.title).toBe("Show the wind speed");
    // Nothing written: nothing affected, still without a version.
    const same = await update(opened, { ref: SPEED, title: "Show the wind speed" });
    expect([same.files, same.affected]).toEqual([[], 0]);
    expect(same.element).not.toHaveProperty("version");
  });

  it("[SR-024/AK3] shows no affected elements when only the title or a property outside the content changed", async () => {
    const opened = await open(AFFECTED);
    const title = await update(opened, { ref: SPEED, title: "Show the wind speed" });
    expect([title.files.length, title.affected]).toEqual([1, 0]);
    // The rationale does not count to the version (D-013, standard model).
    const rationale = await update(opened, { ref: SPEED, set: { rationale: "Sailors ask for it." } });
    expect([rationale.files.length, rationale.affected]).toEqual([1, 0]);
    // Nothing changed at all.
    const same = await update(opened, { ref: SPEED, title: "Show the wind speed" });
    expect([same.files, same.affected]).toEqual([[], 0]);
    // A status changes only through element.setStatus, whose output has no affected elements.
    const status = await invoke(
      "element.setStatus",
      { refs: [SPEED], status: "approved" },
      { workspace: opened.workspace },
    );
    expect(status).toEqual({ files: ["requirements/SR-00000000b001.md"], problems: [] });
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

describe("element.update text layout (#308)", () => {
  const get = async (opened: Opened, ref: string): Promise<CommandOutput<"element.get">> =>
    (await invoke("element.get", { ref }, { workspace: opened.workspace })) as CommandOutput<"element.get">;

  const HEAD = `---\nid: ${WIND.id}\ntype: system-requirement\nstatus: draft\n`;

  it("adds the final newline to a text without one, as element.create does", async () => {
    const opened = await open();
    const out = await update(opened, { ref: WIND.id, text: "New text." });
    expect(await read(opened, WIND.file)).toBe(`${HEAD}title: Show wind speed\n---\n\nNew text.\n`);
    expect(out.element.text).toBe("New text.\n");
  });

  it("gives the text without the blank line after the frontmatter", async () => {
    const opened = await open();
    expect((await get(opened, WIND.id)).element.text).toBe("The station shows the current wind speed.\n");
    expect((await get(opened, GUSTS.id)).element.text).toBe("The station shows gusts above 10 m/s.\n");
  });

  it("[SR-102/AK1] a new title with the text element.get gave changes only the title line, in every layout", async () => {
    const layouts = {
      blank: `${HEAD}title: Show wind speed\n---\n\nText.\n`,
      none: `${HEAD}title: Show wind speed\n---\nText.\n`,
      unterminated: `${HEAD}title: Show wind speed\n---\n\nText.`,
      crlf: `${HEAD}title: Show wind speed\n---\n\nOne\nTwo\n`.replace(/\n/g, "\r\n"),
      empty: `${HEAD}title: Show wind speed\n---\n`,
      closing: `${HEAD}title: Show wind speed\n---`,
    };
    for (const [layout, file] of Object.entries(layouts)) {
      const opened = await open({ files: { [WIND.file]: file } });
      const { element } = await get(opened, WIND.id);
      const out = await update(opened, { ref: WIND.id, title: "Wind", text: element.text });
      expect(await read(opened, WIND.file), layout).toBe(
        file.replace("title: Show wind speed", "title: Wind"),
      );
      expect(out.element.text, layout).toBe(element.text);
      expect(out.element.version, layout).toBe(element.version);
    }
  });

  it("passing the text element.get gave back unchanged changes no byte", async () => {
    const opened = await open();
    for (const ref of [WIND.id, GUSTS.id]) {
      const { element } = await get(opened, ref);
      const out = await update(opened, { ref, text: element.text });
      expect(out.files).toEqual([]);
    }
  });

  it("keeps the layout of the file: the blank line stays, a file written without it stays without", async () => {
    const without = `${HEAD}title: Show wind speed\n---\nOld.\n`;
    const opened = await open({ files: { [WIND.file]: without } });
    await update(opened, { ref: WIND.id, text: "New." });
    expect(await read(opened, WIND.file)).toBe(`${HEAD}title: Show wind speed\n---\nNew.\n`);
    await update(opened, { ref: GUSTS.id, text: "Gusts." });
    expect(await read(opened, GUSTS.file)).toMatch(/\n---\n\nGusts\.\n$/);
  });

  it("gives a file without text the blank line, and writes an empty text as nothing", async () => {
    const opened = await open({ files: { [WIND.file]: `${HEAD}title: Show wind speed\n---\n` } });
    await update(opened, { ref: WIND.id, text: "New." });
    expect(await read(opened, WIND.file)).toBe(`${HEAD}title: Show wind speed\n---\n\nNew.\n`);
    await update(opened, { ref: WIND.id, text: "" });
    expect(await read(opened, WIND.file)).toBe(`${HEAD}title: Show wind speed\n---\n`);
  });

  it("keeps the version: neither the blank line nor the final newline counts (ADR-0005)", async () => {
    const opened = await open({ files: { [WIND.file]: `${HEAD}title: Show wind speed\n---\nText.` } });
    const before = await get(opened, WIND.id);
    const out = await update(opened, { ref: WIND.id, text: "\nText.\n" });
    expect(out.files).toEqual([WIND.file]);
    expect(out.element.version).toBe(before.element.version);
  });
});

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput, Problem } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { metamodelState } from "../../metamodel/index.js";
import { elementStoreState, showElement, shortIdState } from "../../model/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
import { workspaceLayoutState } from "../../workspace/index.js";

type Element = CommandOutput<"element.get">["element"];

interface Opened {
  readonly fixture: FixtureWorkspace;
  readonly workspace: Workspace;
}

const open = async (options: FixtureOptions, root = ""): Promise<Opened> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(root === "" ? fixture.root : fixture.path(root));
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

/** The hints of a shown element; element.get always gives them. */
const hints = (element: Element): readonly Problem[] => element.problems ?? [];

const get = async (opened: Opened, input: Record<string, unknown>): Promise<Element> =>
  ((await invoke("element.get", input, { workspace: opened.workspace })) as CommandOutput<"element.get">)
    .element;

const getError = async (opened: Opened, input: Record<string, unknown>): Promise<CommandError> => {
  try {
    await get(opened, input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected element.get to fail");
};

/** The elements of fixtures/SR-001/two-elements. */
const WIND = { id: "e8df96ea-a168-4d90-8d65-6328cee88fb3", file: "requirements/SR-6328cee88fb3.md" };
const GUSTS = { id: "3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c", file: "requirements/SR-1d2e3f4a5b6c.md" };
const TWO: FixtureOptions = { fixture: "SR-001/two-elements" };

/** GUSTS with a counted value that has no normal form (`.inf`, ADR-0005): it has no version (#276). */
const ENDLESS_GUSTS = `---\nid: ${GUSTS.id}\ntype: system-requirement\nstatus: draft\ntitle: Show gusts\nrequirement-type: functional\nacceptance-criteria: .inf\n---\n\nGusts.\n`;

/** Every file below `folder` with its content, for "nothing written". */
const snapshot = async (folder: string): Promise<Record<string, string>> => {
  const entries = await fs.readdir(folder, { recursive: true, withFileTypes: true });
  const files = entries.filter((e) => e.isFile()).map((e) => `${e.parentPath}/${e.name}`);
  return Object.fromEntries(
    await Promise.all(files.map(async (f): Promise<[string, string]> => [f, await fs.readFile(f, "utf8")])),
  );
};

describe("element.get", () => {
  it("[SR-084/AK1] shows the element with the type prefix and at least 6 characters of its UUID, by UUID or short ID", async () => {
    const opened = await open(TWO);
    const byId = await get(opened, { ref: WIND.id });
    expect(byId).toMatchObject({
      id: WIND.id,
      shortId: "SR-e88fb3",
      type: "system-requirement",
      status: "draft",
      repository: expect.any(String) as string,
      file: WIND.file,
      readOnly: false,
    });
    expect(hints(byId).map((p) => p.code)).toEqual(["element.missing-required", "element.missing-required"]);
    expect(byId.version).toMatch(/^n1:[0-9a-f]{16}$/);
    expect(byId.text).toBe((await fs.readFile(opened.fixture.path(WIND.file), "utf8")).split("---\n\n")[1]);
    // The date only on request (D-013, ADR-0005 "Version date"); not in a Git repository: none.
    expect(byId).not.toHaveProperty("versionDate");
    expect(await get(opened, { ref: WIND.id, versionDate: true })).toEqual({ ...byId, versionDate: null });
    expect(await get(opened, { ref: "SR-e88fb3" })).toEqual(byId);
    expect(await get(opened, { ref: "SR-6328cee88fb3" })).toEqual(byId);
  });

  it("gives the SHA-256 of the element file it was read from, the write precondition of element.update (SR-106)", async () => {
    const opened = await open(TWO);
    const sha256 = async (): Promise<string> =>
      createHash("sha256")
        .update(await fs.readFile(opened.fixture.path(WIND.file)))
        .digest("hex");
    const shown = async (): Promise<CommandOutput<"element.get">> =>
      (await invoke(
        "element.get",
        { ref: WIND.id },
        { workspace: opened.workspace },
      )) as CommandOutput<"element.get">;
    const first = await shown();
    expect(first.fileSha256).toBe(await sha256());
    // A change that does not count to the version (the title) still changes the hash, read from the file now.
    await opened.workspace.get(elementStoreState);
    const file = opened.fixture.path(WIND.file);
    await fs.writeFile(
      file,
      (await fs.readFile(file, "utf8")).replace("title: Show wind speed", "title: Other"),
    );
    const second = await shown();
    expect(second.element.version).toBe(first.element.version);
    expect(second.fileSha256).toBe(await sha256());
    expect(second.fileSha256).not.toBe(first.fileSha256);
  });

  it("writes no file and changes no status", async () => {
    const opened = await open({ ...TWO, git: true });
    const before = await snapshot(opened.fixture.root);
    await get(opened, { ref: WIND.id });
    await get(opened, { ref: GUSTS.id });
    expect(await snapshot(opened.fixture.root)).toEqual(before);
  });

  it("refuses unknown and ambiguous references and a view (SR-043, stage 5)", async () => {
    const opened = await open(TWO);
    expect((await getError(opened, { ref: "SR-ffffff" })).code).toBe("ref.unknown");
    expect((await getError(opened, { ref: WIND.id.replace("e8df", "0000") })).code).toBe("ref.unknown");
    const view = await getError(opened, { ref: WIND.id, view: "core" });
    expect([view.code, view.details]).toEqual([
      "input.invalid",
      { command: "element.get", fields: ["view"] },
    ]);
  });

  it("[SR-005/AK2] shows the title of a target in another repository that is on this machine", async () => {
    const opened = await open({ fixture: "SR-089/missing-targets" }, "system");
    const element = await get(opened, { ref: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d" });
    expect(element.repository).toBe("sensor");
    expect(element.relations.filter((r) => r.kind === "derives-from")).toEqual([
      expect.objectContaining({
        id: "7d2c9e4f-1a3b-4c5d-8e6f-0a1b2c3d4e5f",
        title: "Gusts visible",
        accessible: true,
        targetState: "available",
      }),
      expect.objectContaining({
        id: "3b8e1f2a-6c4d-4e7f-9a1b-2c3d4e5f6a7b",
        title: "Wind speed visible at a glance",
        accessible: true,
        targetState: "available",
      }),
    ]);
  });

  it("[SR-006/AK1] shows a target in a repository that is not on this machine only by short ID, as not accessible", async () => {
    const opened = await open({ fixture: "SR-089/missing-targets" }, "system");
    const element = await get(opened, { ref: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d" });
    const [vault] = element.relations.filter((r) => r.kind === "based-on");
    expect(vault).toEqual({
      kind: "based-on",
      direction: "out",
      ...(vault?.meaning === undefined ? {} : { meaning: vault.meaning }),
      id: "41b29219-7bc1-41c2-96a3-ed3a9c39dbb8",
      repository: "vault",
      shortId: "UNKNOWN-39dbb8",
      accessible: false,
      targetState: "inaccessible",
      storedVersion: "n1:5f3b4a1e0c9d2e71",
    });
  });

  it("[SR-088/AK2] marks a relation to a UUID that two files share as ambiguous; that UUID itself is ambiguous", async () => {
    const opened = await open({ fixture: "SR-088/copied-file" }, "system");
    const element = await get(opened, { ref: "4f4f8db9-be88-4699-8641-6ae4d00fcab6" });
    const [copied] = element.relations;
    expect(copied).toMatchObject({
      id: "948a10f1-05c3-4212-bd19-00606ccf2661",
      accessible: false,
      targetState: "ambiguous",
    });
    expect(copied).not.toHaveProperty("title");
    const error = await getError(opened, { ref: "948a10f1-05c3-4212-bd19-00606ccf2661" });
    expect(error.code).toBe("ref.ambiguous");
    expect((error.details as { candidates: unknown[] }).candidates).toHaveLength(2);
  });

  describe("one copy of a duplicate (#255)", () => {
    const COPIED = "948a10f1-05c3-4212-bd19-00606ccf2661";
    const ORIGINAL = "requirements/N-00606ccf2661.md";
    const COPY = "copies/N-00606ccf2661.md";

    it("opens each copy of a UUID two files share by its file, and with its repository", async () => {
      const opened = await open({ fixture: "SR-088/copied-file" }, "system");
      const before = await snapshot(opened.fixture.root);
      const original = await get(opened, { ref: COPIED, file: ORIGINAL });
      const copy = await get(opened, { ref: "N-cf2661", file: COPY });
      expect([original.id, original.file, original.repository]).toEqual([COPIED, ORIGINAL, "system"]);
      expect([copy.id, copy.file, copy.repository]).toEqual([COPIED, COPY, "system"]);
      // Opening a copy changes neither file (SR-088): a person gives one of them a new UUID.
      expect(await get(opened, { ref: COPIED, repository: "system", file: COPY })).toEqual(copy);
      expect(await snapshot(opened.fixture.root)).toEqual(before);
    });

    it("stays ambiguous when the repository alone leaves both copies", async () => {
      const opened = await open({ fixture: "SR-088/copied-file" }, "system");
      const error = await getError(opened, { ref: COPIED, repository: "system" });
      expect(error.code).toBe("ref.ambiguous");
      expect(error.details).toEqual({
        ref: COPIED,
        repository: "system",
        candidates: expect.arrayContaining([
          { id: COPIED, repository: "system", file: ORIGINAL },
          { id: COPIED, repository: "system", file: COPY },
        ]) as unknown,
      });
      expect((error.details as { candidates: unknown[] }).candidates).toHaveLength(2);
      expect(error.message).toContain("give the repository and file of one of the candidates");
    });

    it("is ref.unknown with the elements ref names when the file or repository fits none", async () => {
      const opened = await open({ fixture: "SR-088/copied-file" }, "system");
      const elsewhere = await getError(opened, { ref: COPIED, file: "needs/N-00606ccf2661.md" });
      expect(elsewhere.code).toBe("ref.unknown");
      expect(elsewhere.details).toEqual({
        ref: COPIED,
        file: "needs/N-00606ccf2661.md",
        candidates: expect.arrayContaining([
          { id: COPIED, repository: "system", file: ORIGINAL },
          { id: COPIED, repository: "system", file: COPY },
        ]) as unknown,
      });
      expect(elsewhere.message).toContain("names no element in needs/N-00606ccf2661.md");
      const other = await getError(opened, { ref: COPIED, repository: "sensor", file: COPY });
      expect([other.code, other.message]).toEqual([
        "ref.unknown",
        expect.stringContaining(`in ${COPY} of repository sensor`) as unknown,
      ]);
      const repository = await getError(opened, { ref: COPIED, repository: "sensor" });
      expect([repository.code, repository.message]).toEqual([
        "ref.unknown",
        expect.stringContaining("names no element in repository sensor;") as unknown,
      ]);
      expect(repository.details).toMatchObject({ ref: COPIED, repository: "sensor" });
      expect(repository.details).not.toHaveProperty("file");
      // A reference that names nothing stays as before, whatever the copy.
      const none = await getError(opened, { ref: "N-ffffff", file: COPY });
      expect([none.code, none.details]).toEqual(["ref.unknown", { ref: "N-ffffff" }]);
    });

    it("checks the file of an element its reference names alone, and never finds another by file", async () => {
      const opened = await open(TWO);
      expect(await get(opened, { ref: "SR-e88fb3", file: WIND.file })).toEqual(
        await get(opened, { ref: WIND.id }),
      );
      for (const empty of [{ file: "" }, { repository: "" }]) {
        expect((await getError(opened, { ref: "SR-e88fb3", ...empty })).code).toBe("input.invalid");
      }
      const error = await getError(opened, { ref: "SR-e88fb3", file: GUSTS.file });
      expect([error.code, error.details]).toEqual([
        "ref.unknown",
        {
          ref: "SR-e88fb3",
          file: GUSTS.file,
          candidates: [{ id: WIND.id, repository: expect.any(String) as string, file: WIND.file }],
        },
      ]);
    });

    it("picks one of the elements a short short ID names by its file", async () => {
      const a = "a1b2c3d4-0000-4000-8000-000001abc123";
      const b = "b1b2c3d4-0000-4000-9000-000002abc123";
      const element = (id: string, title: string): string =>
        `---\nid: ${id}\ntype: system-requirement\nstatus: draft\ntitle: ${title}\n---\n`;
      const opened = await open({
        fixture: "SR-001/two-elements",
        files: {
          "requirements/SR-000001abc123.md": element(a, "First"),
          "requirements/SR-000002abc123.md": element(b, "Second"),
        },
      });
      expect((await getError(opened, { ref: "SR-abc123" })).code).toBe("ref.ambiguous");
      expect(await get(opened, { ref: "SR-abc123", file: "requirements/SR-000002abc123.md" })).toMatchObject({
        id: b,
        title: "Second",
      });
    });

    it("picks a copy in another repository by its repository", async () => {
      const id = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
      const file = "anemometer/SR-1e0f9a8b7c6d.md";
      const fixture = await createFixtureWorkspace({ fixture: "SR-089/missing-targets" });
      onTestFinished(() => fixture.cleanup());
      await fs.mkdir(fixture.path("system/anemometer"), { recursive: true });
      await fs.copyFile(fixture.path(`sensor/${file}`), fixture.path(`system/${file}`));
      const workspace = new Workspace(fixture.path("system"));
      onTestFinished(() => workspace.close());
      const opened = { fixture, workspace };
      const both = await getError(opened, { ref: id, file });
      expect(both.details).toMatchObject({ ref: id, file });
      expect([both.code, (both.details as { candidates: unknown[] }).candidates.length]).toEqual([
        "ref.ambiguous",
        2,
      ]);
      for (const repository of ["system", "sensor"]) {
        expect(await get(opened, { ref: id, repository })).toMatchObject({ id, repository, file });
        expect(await get(opened, { ref: id, repository, file })).toMatchObject({ id, repository, file });
      }
    });
  });

  it("[SR-016/AK3] shows an element of an unknown type with a hint and only for reading", async () => {
    const opened = await open({ fixture: "SR-016/unknown" });
    const element = await get(opened, { ref: "2c9e4b71-6d58-4f03-a1e7-0f6a7b8c9d0e" });
    expect(element).toMatchObject({ type: "gadget", title: "Wind vane", readOnly: true });
    expect(hints(element)).toContainEqual(expect.objectContaining({ code: "element.unknown-type", line: 3 }));
  });

  it("[SR-016/AK1] gives a hint with the key of each unknown property and keeps it under properties", async () => {
    const opened = await open({ fixture: "SR-016/unknown" });
    const element = await get(opened, { ref: "5e0b8c2d-7f14-4a39-b6d2-8e9f0a1b2c3d" });
    expect(element.readOnly).toBe(false);
    expect(element.properties).toMatchObject({ "customer-id": 815, legacy: { source: "DOORS" } });
    const unknown = hints(element).filter((p) => p.code === "element.unknown-property");
    expect(unknown.map((p) => [p.line, p.message.includes("customer-id")])).toContainEqual([6, true]);
    expect(unknown.some((p) => p.message.includes("legacy"))).toBe(true);
  });

  it("[SR-085/AK2] gives a hint with the allowed values for a choice value that is not one of them", async () => {
    const opened = await open({ fixture: "SR-085/value-kinds" }, "system");
    const element = await get(opened, { ref: "c0dcc639-0097-42b7-b926-b69e094ad34c" });
    const [hint] = hints(element);
    expect(hints(element)).toHaveLength(1);
    expect(hint).toMatchObject({ severity: "warning", file: "anemometer/SR-b69e094ad34c.md", line: 6 });
    expect(hint?.message).toMatch(/low.*medium.*high/);
  });

  it("[SR-085/AK2] keeps a display name written by hand in a file as it is and gives the hint (SR-012 AK3, #309)", async () => {
    const file = "requirements/SR-00000000c309.md";
    const text =
      "---\nid: 0b7c6e1a-1111-4222-8333-00000000c309\ntype: system-requirement\nstatus: draft\ntitle: By hand\nrequirement-type: Functional\n---\n\nText.\n";
    const opened = await open({ fixture: "SR-001/two-elements", files: { [file]: text } });
    const element = await get(opened, { ref: "SR-00c309" });
    // Reading is lenient: the name is not mapped to its key, neither in the view nor in the file.
    expect(element.properties["requirement-type"]).toBe("Functional");
    expect(hints(element).filter((p) => p.code === "element.wrong-value-kind")).toEqual([
      expect.objectContaining({
        severity: "warning",
        line: 6,
        message: expect.stringContaining("functional (Functional)") as string,
      }),
    ]);
    expect(await fs.readFile(opened.fixture.path(file), "utf8")).toBe(text);
  });

  it("[SR-086/AK1] gives a hint with source, target and relation kind for a relation between types that are not allowed", async () => {
    const opened = await open({ fixture: "SR-086/relation-types" }, "system");
    const element = await get(opened, { ref: "22a972fd-f4f1-4b95-ba1d-e3e85234824e" });
    // The fixture stores a made-up version, so the relation is outdated too, and the two elements
    // derive from each other, so it is in a cycle too (both shown at the element, SR-026 AK3).
    expect(hints(element).map((p) => p.code)).toEqual([
      "relation.not-allowed",
      "trace.cycle",
      "relation.outdated",
    ]);
    expect(hints(element).filter((p) => p.code === "relation.not-allowed")).toEqual([
      expect.objectContaining({
        code: "relation.not-allowed",
        severity: "warning",
        elementId: "22a972fd-f4f1-4b95-ba1d-e3e85234824e",
        targetId: "fa1e252c-ae4a-43c5-b53c-c03e4db185f3",
        line: 7,
      }),
    ]);
    expect(hints(element)[0]?.message).toMatch(/derives-from/i);
    const allowed = await get(opened, { ref: "fa1e252c-ae4a-43c5-b53c-c03e4db185f3" });
    expect(hints(allowed).filter((p) => p.code === "relation.not-allowed")).toEqual([]);
  });

  it("[SR-091/AK4] gives another version when an embedded image changes", async () => {
    const opened = await open({
      ...TWO,
      files: {
        [WIND.file]: `---\nid: ${WIND.id}\ntype: system-requirement\nstatus: draft\ntitle: Show wind\n---\n\n![Dial](dial.png)\n`,
        "requirements/dial.png": "one",
      },
    });
    const before = await get(opened, { ref: WIND.id });
    await opened.fixture.write("requirements/dial.png", "two");
    const after = await get(opened, { ref: WIND.id });
    expect(after.version).not.toBe(before.version);
    expect(after.text).toBe(before.text);
  });

  it("works read-only without hints while the metamodel is not valid (#208, #220 option 1)", async () => {
    const opened = await open({
      ...TWO,
      files: {
        "metamodel/standard-model.yaml": "types: [\n",
        [GUSTS.file]: `---\nid: ${GUSTS.id}\ntype: system-requirement\nstatus: draft\ntitle: Show gusts\ncolour: red\n---\n`,
      },
    });
    expect((await opened.workspace.get(metamodelState)).valid).toBe(false);
    const element = await get(opened, { ref: GUSTS.id });
    expect(element).toMatchObject({ id: GUSTS.id, readOnly: true, problems: [] });
    expect(element.properties).toHaveProperty("colour", "red");
  });

  it("shows a file that changed on disk since it was read as it is now", async () => {
    const opened = await open(TWO);
    await get(opened, { ref: WIND.id });
    const text = await fs.readFile(opened.fixture.path(WIND.file), "utf8");
    await opened.fixture.write(WIND.file, `${text}More.\n`);
    expect((await get(opened, { ref: WIND.id })).text).toMatch(/More\.\n$/);
  });

  it("gives ref.unknown for a file that is gone or holds another element, and reads the files again", async () => {
    const opened = await open(TWO);
    const store = await opened.workspace.get(elementStoreState);
    await fs.rm(opened.fixture.path(WIND.file));
    const gone = await getError(opened, { ref: WIND.id });
    expect([gone.code, gone.details]).toEqual([
      "ref.unknown",
      { ref: WIND.id, repository: expect.any(String) as string, file: WIND.file },
    ]);
    const fresh = await opened.workspace.get(elementStoreState);
    expect(fresh).not.toBe(store);
    expect(fresh.byId.has(WIND.id)).toBe(false);
    const other = GUSTS.id.replace("3f2a", "4f2a");
    const text = await fs.readFile(opened.fixture.path(GUSTS.file), "utf8");
    await opened.fixture.write(GUSTS.file, text.replace(GUSTS.id, other));
    expect((await getError(opened, { ref: GUSTS.id })).code).toBe("ref.unknown");
    expect((await get(opened, { ref: other })).id).toBe(other);
  });

  it("reports a repository the layout does not list as an internal error", async () => {
    const opened = await open(TWO);
    const { workspace } = opened;
    const layout = await workspace.get(workspaceLayoutState);
    const context = {
      workspace,
      layout: { ...layout, repositories: [] },
      metamodel: await workspace.get(metamodelState),
      store: await workspace.get(elementStoreState),
      shortIds: await workspace.get(shortIdState),
    };
    const error = await showElement(context, WIND.id, () => Promise.resolve([]), false).catch(
      (e: unknown) => e,
    );
    expect((error as CommandError).code).toBe("internal");
  });
});

describe("element.get, more of what stage 1 shows", () => {
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "is read-only in a repository folder this process cannot write (SR-018 AK2; skipped as root)",
    async () => {
      const opened = await open(TWO);
      const folder = opened.fixture.root;
      await fs.chmod(folder, 0o555);
      onTestFinished(() => fs.chmod(folder, 0o755));
      expect(await get(opened, { ref: WIND.id })).toMatchObject({ id: WIND.id, readOnly: true });
    },
  );

  it("[SR-013/AK3] gives a hint naming the missing meaning title of a valid metamodel, with an empty title", async () => {
    const model = await fs.readFile(
      new URL("../../../../../fixtures/SR-001/two-elements/metamodel/standard-model.yaml", import.meta.url),
      "utf8",
    );
    const opened = await open({
      ...TWO,
      files: { "metamodel/standard-model.yaml": model.replace("    meaning: title\n", "") },
    });
    expect((await opened.workspace.get(metamodelState)).valid).toBe(true);
    const element = await get(opened, { ref: WIND.id });
    expect(element.title).toBe("");
    expect(element.properties).toHaveProperty("title");
    expect(hints(element)).toContainEqual({
      code: "metamodel.meaning-unassigned",
      severity: "warning",
      message:
        "No property of the metamodel has the meaning title, which element.get needs. Add `meaning: title` to a property in the metamodel files.",
    });
  });

  it("shows an element whose counted value has no normal form without a version, with a warning (#276)", async () => {
    const opened = await open({ ...TWO, files: { [GUSTS.file]: ENDLESS_GUSTS } });
    const element = await get(opened, { ref: GUSTS.id, versionDate: true });
    expect(element).toMatchObject({ id: GUSTS.id, title: "Show gusts", text: "Gusts.\n", readOnly: false });
    expect(element).not.toHaveProperty("version");
    expect(element).not.toHaveProperty("versionDate");
    // The value-kind hint first (SR-085), then why the version is missing.
    expect(hints(element).map((p) => p.code)).toEqual(["element.wrong-value-kind", "file.faulty"]);
    expect(hints(element).at(-1)).toEqual({
      code: "file.faulty",
      severity: "warning",
      message: `No version: ${GUSTS.file} of repository system: version: Infinity is not a valid number`,
      repository: "system",
      file: GUSTS.file,
      elementId: GUSTS.id,
      elementShortId: "SR-4a5b6c",
    });
    // Every other element keeps its version.
    expect((await get(opened, { ref: WIND.id })).version).toMatch(/^n1:/);
  });

  it("gives file.faulty for a file that became faulty since it was read", async () => {
    const opened = await open(TWO);
    await get(opened, { ref: WIND.id });
    await opened.fixture.write(WIND.file, "---\nid: [\n---\n");
    const error = await getError(opened, { ref: WIND.id });
    expect(error.code).toBe("file.faulty");
    expect(error.details).toMatchObject({ ref: WIND.id, file: WIND.file, problems: [expect.any(Object)] });
  });

  it("[SR-040/AK3] shows the hint on a validity that lists a superseded variant", async () => {
    const opened = await open({
      fixture: "SR-040/validity",
      files: {
        "variants/VAR-b2b2b2b2b2b2.md":
          "---\nid: 40a0e000-0000-4000-8000-b2b2b2b2b2b2\ntype: variant\nstatus: obsolete\ntitle: Mountain\n---\n",
      },
    });
    const element = await get(opened, { ref: "40a0e000-0000-4000-8000-000000000ab2" });
    expect(hints(element).filter((p) => p.code === "variant.superseded-in-validity")).toEqual([
      {
        code: "variant.superseded-in-validity",
        severity: "warning",
        message:
          "Property Validity (validity) of System Requirement SR-000ab2 lists Variant VAR-b2b2b2, which is superseded (status Obsolete)",
        repository: "system",
        file: "requirements/SR-000000000ab2.md",
        line: 11,
        elementId: "40a0e000-0000-4000-8000-000000000ab2",
        elementShortId: "SR-000ab2",
        targetId: "40a0e000-0000-4000-8000-b2b2b2b2b2b2",
      },
    ]);
    // element.update returns the same element, with the same hint (get adds only readOnly and the
    // verification status of SR-031; #554 adds it to element.update).
    const updated = (
      (await invoke(
        "element.update",
        { ref: "40a0e000-0000-4000-8000-000000000ab2", text: element.text ?? "" },
        { workspace: opened.workspace },
      )) as CommandOutput<"element.update">
    ).element;
    expect({ ...updated, readOnly: element.readOnly, verification: element.verification }).toEqual(element);
    const unaffected = await open({ fixture: "SR-040/validity" });
    const plain = await get(unaffected, { ref: "40a0e000-0000-4000-8000-000000000ab2" });
    expect(hints(plain).filter((p) => p.code === "variant.superseded-in-validity")).toEqual([]);
  });
});

describe("a superseded element names its successor without a relation of its own (SR-072 AK3)", () => {
  it("[SR-072/AK3] element.get names the successor as an incoming relation; the superseded file has none", async () => {
    const opened = await open({ fixture: "SR-072/supersede" });
    const old = "7a1e0c2b-4d3f-4a5b-8c6d-a1b2c3d4e5f6";
    const successor = "7a1e0c2b-4d3f-4a5b-8c6d-b2c3d4e5f6a7";
    await invoke(
      "element.supersede",
      { ref: old, status: "obsolete", successor },
      { workspace: opened.workspace },
    );
    const before = await fs.readFile(opened.fixture.path("needs/N-a1b2c3d4e5f6.md"), "utf8");
    const element = await get(opened, { ref: "N-d4e5f6" });
    expect(element.status).toBe("obsolete");
    expect(element.relations).toEqual([
      {
        kind: "supersedes",
        meaning: "replacement",
        direction: "in",
        id: successor,
        repository: "system",
        shortId: "N-e5f6a7",
        title: "See wind and gusts",
        accessible: true,
        targetState: "available",
        storedVersion: expect.stringMatching(/^n1:[0-9a-f]{16}$/) as string,
      },
    ]);
    expect(before).not.toContain(successor);
    expect(await fs.readFile(opened.fixture.path("needs/N-a1b2c3d4e5f6.md"), "utf8")).toBe(before);
  });

  it("[SR-072/AK2] element.get gives the hint on a relation to a superseded element, naming its successor", async () => {
    const opened = await open({ fixture: "SR-072/supersede" });
    await invoke(
      "element.supersede",
      {
        ref: "7a1e0c2b-4d3f-4a5b-8c6d-a1b2c3d4e5f6",
        status: "obsolete",
        successor: "7a1e0c2b-4d3f-4a5b-8c6d-b2c3d4e5f6a7",
      },
      { workspace: opened.workspace },
    );
    const element = await get(opened, { ref: "7a1e0c2b-4d3f-4a5b-8c6d-c3d4e5f6a7b8" });
    expect(hints(element)).toEqual([
      expect.objectContaining({
        code: "relation.target-superseded",
        targetId: "7a1e0c2b-4d3f-4a5b-8c6d-a1b2c3d4e5f6",
        line: 10,
        message: expect.stringMatching(/superseded \(status Obsolete\); successor: Need N-e5f6a7$/) as string,
      }),
    ]);
  });

  it("[SR-072/AK3] element.get names no successor for an element that is not superseded", async () => {
    const opened = await open({ fixture: "SR-072/supersede" });
    const element = await get(opened, { ref: "N-d4e5f6" });
    expect(element.relations.filter((r) => r.direction === "in")).toEqual([]);
  });
});

describe("element.get gives the same hints on relations to superseded elements as workspace.check (SR-072 AK2)", () => {
  const OLD = "7a1e0c2b-4d3f-4a5b-8c6d-a1b2c3d4e5f6";
  const NEW = "7a1e0c2b-4d3f-4a5b-8c6d-b2c3d4e5f6a7";
  const SECOND = "7a1e0c2b-4d3f-4a5b-8c6d-0a0a0a0a0a0a";
  const LENIENT = "7a1e0c2b-4d3f-4a5b-8c6d-0c0c0c0c0c0c";
  const AMBIGUOUS = "7a1e0c2b-4d3f-4a5b-8c6d-0d0d0d0d0d0d";
  const SELF = "7a1e0c2b-4d3f-4a5b-8c6d-0e0e0e0e0e0e";
  const POINTER = "7a1e0c2b-4d3f-4a5b-8c6d-0f0f0f0f0f0f";
  const MISSING = "7a1e0c2b-4d3f-4a5b-8c6d-000000000000";
  const V = "n1:1111111111111111";

  const element = (id: string, type: string, status: string, title: string, extra = ""): string =>
    `---\nid: ${id}\ntype: ${type}\nstatus: ${status}\ntitle: ${title}\n${extra}---\n`;

  const FILES = {
    "needs/N-a1b2c3d4e5f6.md": element(OLD, "need", "obsolete", "See the wind"),
    "needs/N-b2c3d4e5f6a7.md": element(
      NEW,
      "need",
      "draft",
      "See wind and gusts",
      `supersedes:\n  - { id: ${OLD}, version: ${V} }\n`,
    ),
    "needs/N-0a0a0a0a0a0a.md": element(
      SECOND,
      "need",
      "draft",
      "See the gusts",
      `supersedes:\n  - { id: ${OLD}, version: ${V} }\n`,
    ),
    // Without a version: a successor in the view (SR-072 AK3), not named in the hints (no relation target).
    "needs/N-0c0c0c0c0c0c.md": element(
      LENIENT,
      "need",
      "draft",
      "See it roughly",
      `supersedes:\n  - { id: ${OLD} }\n`,
    ),
    "needs/N-0d0d0d0d0d0d.md": element(AMBIGUOUS, "need", "obsolete", "Copied"),
    "needs/copy/N-0d0d0d0d0d0d.md": element(AMBIGUOUS, "need", "obsolete", "Copied"),
    // Replaces itself: no successor of itself, in the whole workspace and for one element.
    "needs/N-0e0e0e0e0e0e.md": element(
      SELF,
      "need",
      "obsolete",
      "Itself",
      `supersedes:\n  - { id: ${SELF}, version: ${V} }\n`,
    ),
    "requirements/SR-0f0f0f0f0f0f.md": element(
      POINTER,
      "system-requirement",
      "draft",
      "Pointer",
      `derives-from:\n  - { id: ${MISSING}, version: ${V} }\n  - { id: ${AMBIGUOUS}, version: ${V} }\n  - { id: ${OLD}, version: ${V} }\n  - { id: ${SELF}, version: ${V} }\n`,
    ),
  };

  const supersededHints = (problems: readonly Problem[]): readonly Problem[] =>
    problems.filter((p) => p.code === "relation.target-superseded");

  it("[SR-072/AK2] element.get and workspace.check give the same hints, naming only complete successor relations", async () => {
    const opened = await open({ fixture: "SR-072/supersede", files: FILES });
    const check = (await invoke(
      "workspace.check",
      {},
      { workspace: opened.workspace },
    )) as CommandOutput<"workspace.check">;
    const store = await opened.workspace.get(elementStoreState);
    const shown = store.elements.filter((e) => e.id !== AMBIGUOUS);
    for (const record of shown) {
      const element = await get(opened, { ref: record.id });
      expect(supersededHints(hints(element)), record.file).toEqual(
        supersededHints(check.problems).filter((p) => p.elementId === record.id),
      );
    }
    const pointer = supersededHints(hints(await get(opened, { ref: POINTER })));
    expect(pointer.map((p) => [p.targetId, p.message])).toEqual([
      [
        OLD,
        "Relation Derives from (derives-from) from System Requirement SR-0f0f0f points to Need N-d4e5f6, which is superseded (status Obsolete); successors: Need N-0a0a0a, Need N-e5f6a7",
      ],
      [
        SELF,
        "Relation Derives from (derives-from) from System Requirement SR-0f0f0f points to Need N-0e0e0e, which is superseded (status Obsolete)",
      ],
    ]);
    const old = await get(opened, { ref: OLD });
    expect(old.relations.filter((r) => r.direction === "in").map((r) => r.id)).toEqual([
      SECOND,
      LENIENT,
      NEW,
    ]);
  });
});

describe("element.get hintDates (#702)", () => {
  /** fixtures/SR-026/hints, committed: SR-0000b1 has an outdated relation and an outdated inline reference. */
  const HINTS: FixtureOptions = { fixture: "SR-026/hints", git: true };
  const outdated = (element: Element): readonly Problem[] =>
    hints(element).filter((problem) => problem.code === "relation.outdated");

  it("[SR-110/AK2] dates the outdated relations and references of the element, but not its own version", async () => {
    const opened = await open(HINTS);
    const plain = await get(opened, { ref: "SR-0000b1" });
    const dated = await get(opened, { ref: "SR-0000b1", hintDates: true });
    const both = await get(opened, { ref: "SR-0000b1", versionDate: true });
    expect(outdated(plain).length).toBeGreaterThanOrEqual(2);
    for (const problem of outdated(plain)) {
      expect(problem).not.toHaveProperty("storedDate");
      expect(problem.message).not.toMatch(/stored version from/);
    }
    expect(dated).not.toHaveProperty("versionDate");
    expect(outdated(dated)).toHaveLength(outdated(plain).length);
    for (const problem of outdated(dated)) {
      expect(problem).toHaveProperty("storedDate");
      expect(problem).toHaveProperty("currentDate");
      expect(problem.message).toMatch(/: stored version from .+, current version from .+$/);
    }
    // The same dated hints as with versionDate, which dates the element's own version too.
    expect(both).toHaveProperty("versionDate");
    const { versionDate: _date, ...withoutDate } = both;
    expect(dated).toEqual(withoutDate);
  });

  it("[SR-110/AK2] gives an element without outdated relations as without the input", async () => {
    const opened = await open(TWO);
    expect(await get(opened, { ref: WIND.id, hintDates: true })).toEqual(await get(opened, { ref: WIND.id }));
  });
});

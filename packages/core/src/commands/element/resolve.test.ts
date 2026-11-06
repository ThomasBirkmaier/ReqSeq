import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
import { WRITTEN_VERSION } from "../../model/version-forms.test-helper.js";
import { readFirst } from "../../runtime/read-first.test-helper.js";
import { currentFormsOf, currentVersions, elementStoreState } from "../../model/index.js";

type Resolved = CommandOutput<"element.resolve">;

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

const resolve = async (opened: Opened, input: Record<string, unknown>): Promise<Resolved> =>
  (await invoke("element.resolve", input, { workspace: opened.workspace })) as Resolved;

const resolveError = async (opened: Opened, input: Record<string, unknown>): Promise<CommandError> => {
  try {
    await resolve(opened, input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected element.resolve to fail");
};

/** Every file below `folder` with its content, for "nothing written". */
const snapshot = async (folder: string): Promise<Record<string, string>> => {
  const entries = await fs.readdir(folder, { recursive: true, withFileTypes: true });
  const files = entries.filter((e) => e.isFile()).map((e) => `${e.parentPath}/${e.name}`);
  return Object.fromEntries(
    await Promise.all(files.map(async (f): Promise<[string, string]> => [f, await fs.readFile(f, "utf8")])),
  );
};

/** The elements of fixtures/SR-001/two-elements. */
const WIND = { id: "e8df96ea-a168-4d90-8d65-6328cee88fb3", file: "requirements/SR-6328cee88fb3.md" };
const GUSTS = { id: "3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c", file: "requirements/SR-1d2e3f4a5b6c.md" };
const TWO: FixtureOptions = { fixture: "SR-001/two-elements" };

// Two system requirements and a need whose UUIDs end on the same 6 digits (abc123); the display
// shows SR-1abc123, SR-2abc123 and N-3abc123.
const SR_1 = "a1b2c3d4-0000-4000-8000-000001abc123";
const SR_2 = "b1b2c3d4-0000-4000-9000-000002abc123";
const NEED = "c1b2c3d4-0000-4000-a000-000003abc123";
const element = (id: string, type: string, title: string): string =>
  `---\nid: ${id}\ntype: ${type}\nstatus: draft\ntitle: ${title}\n---\n\nText of ${title}.\n`;
const SHARED_ENDS: FixtureOptions = {
  fixture: "SR-001/two-elements",
  files: {
    "requirements/SR-000001abc123.md": element(SR_1, "system-requirement", "First"),
    "requirements/SR-000002abc123.md": element(SR_2, "system-requirement", "Second"),
    "needs/N-000003abc123.md": element(NEED, "need", "Need"),
  },
};

describe("element.resolve", () => {
  it("[SR-060/AK1] gives the element with title, text, status and current version by UUID or short ID", async () => {
    const opened = await open(TWO);
    const byId = await resolve(opened, { ref: WIND.id });
    expect(byId.current).toBeNull();
    expect(byId.element).toMatchObject({
      id: WIND.id,
      shortId: "SR-e88fb3",
      title: "Show wind speed",
      text: "The station shows the current wind speed.\n",
      status: "draft",
      file: WIND.file,
    });
    expect(byId.element.version).toMatch(WRITTEN_VERSION);
    // The same element as element.get shows, by the displayed short ID and by the 12 digits of the file name.
    const shown = (await invoke("element.get", { ref: WIND.id }, { workspace: opened.workspace })) as {
      element: unknown;
    };
    expect(byId.element).toEqual(shown.element);
    expect(await resolve(opened, { ref: "SR-e88fb3" })).toEqual(byId);
    expect(await resolve(opened, { ref: "SR-6328cee88fb3" })).toEqual(byId);
  });

  it("[SR-060/AK1] resolves a short ID and a UUID in any case to the same element (ThomasBirkmaier/ReqSeq-archive#309, spec question ThomasBirkmaier/ReqSeq-archive#316)", async () => {
    const opened = await open(TWO);
    const expected = (await resolve(opened, { ref: "SR-e88fb3" })).element;
    for (const ref of ["sr-e88fb3", "Sr-E88FB3", "sr-6328CEE88FB3", WIND.id.toUpperCase()]) {
      expect((await resolve(opened, { ref })).element).toEqual(expected);
    }
    const unknown = await resolveError(opened, { ref: "sr-ffffff" });
    expect([unknown.code, unknown.message]).toEqual([
      "ref.unknown",
      'No element has the short ID or identifier "sr-ffffff"',
    ]);
  });

  it("[SR-060/AK3] refuses a malformed reference with a message that says what a reference looks like (ThomasBirkmaier/ReqSeq-archive#309)", async () => {
    const opened = await open(TWO);
    const error = await resolveError(opened, { ref: " SR-036" });
    expect(error.toJSON()).toEqual({
      code: "input.invalid",
      message:
        'Invalid input for element.resolve: ref " SR-036" is not a reference to an element (a UUID, a short ID such as SR-3c90b0 or an identifier such as SR-036; at most 256 characters, without control characters or spaces at either end)',
      details: {
        command: "element.resolve",
        errors: [
          {
            path: "/ref",
            field: "ref",
            keyword: "pattern",
            message:
              'ref " SR-036" is not a reference to an element (a UUID, a short ID such as SR-3c90b0 or an identifier such as SR-036; at most 256 characters, without control characters or spaces at either end)',
            params: {},
          },
        ],
      },
    });
    // Any other text may be an identifier (ThomasBirkmaier/ReqSeq-archive#305); without one it names no element.
    const unknown = await resolveError(opened, { ref: "SR-036" });
    expect([unknown.code, unknown.message]).toEqual([
      "ref.unknown",
      'No element has the identifier "SR-036"',
    ]);
  });

  it("[SR-060/AK1] resolves a short ID another tool stored before the display grew, when the prefix leaves one element", async () => {
    const opened = await open(SHARED_ENDS);
    // SR-abc123 fits two system requirements, N-abc123 only the need.
    expect((await resolve(opened, { ref: "N-abc123" })).element).toMatchObject({
      id: NEED,
      shortId: "N-3abc123",
      title: "Need",
    });
  });

  it("[SR-060/AK3] names the element whose tail fits a short ID with an outdated prefix, without resolving it (ThomasBirkmaier/ReqSeq-archive#275)", async () => {
    // The type was changed by hand from system requirement to need (ThomasBirkmaier/ReqSeq-archive#165 (b)); the file name and
    // references in other tools keep the prefix SR (D-056).
    const id = "9c0d1e2f-3a4b-4c5d-8e6f-7a8b9c0d1e2f";
    const opened = await open({
      fixture: "SR-001/two-elements",
      files: { "requirements/SR-7a8b9c0d1e2f.md": element(id, "need", "Formerly a requirement") },
    });
    const before = await snapshot(opened.fixture.root);
    for (const ref of ["SR-7a8b9c0d1e2f", "SR-0d1e2f"]) {
      const error = await resolveError(opened, { ref });
      expect([error.code, error.details]).toEqual([
        "ref.unknown",
        {
          ref,
          candidates: [
            { id, repository: expect.any(String) as string, file: "requirements/SR-7a8b9c0d1e2f.md" },
          ],
        },
      ]);
      expect(error.message).toContain("prefix may be outdated; did you mean N-0d1e2f?");
    }
    expect(await snapshot(opened.fixture.root)).toEqual(before);
  });

  it("[SR-060/AK3] names the element of an outdated prefix only when it lies in the given repository and file (ThomasBirkmaier/ReqSeq-archive#255)", async () => {
    const id = "9c0d1e2f-3a4b-4c5d-8e6f-7a8b9c0d1e2f";
    const file = "requirements/SR-7a8b9c0d1e2f.md";
    const opened = await open({
      fixture: "SR-001/two-elements",
      files: { [file]: element(id, "need", "Formerly a requirement") },
    });
    const { repository } = (await resolve(opened, { ref: "N-0d1e2f" })).element;
    const named = await resolveError(opened, { ref: "SR-0d1e2f", repository, file });
    expect([named.code, named.details]).toEqual([
      "ref.unknown",
      { ref: "SR-0d1e2f", candidates: [{ id, repository, file }] },
    ]);
    for (const copy of [{ file: WIND.file }, { repository: "elsewhere" }]) {
      const error = await resolveError(opened, { ref: "SR-0d1e2f", ...copy });
      expect([error.code, error.details]).toEqual(["ref.unknown", { ref: "SR-0d1e2f" }]);
      expect(error.message).not.toContain("did you mean");
    }
  });

  it("[SR-060/AK3] keeps ref.unknown with repository and file, without candidates, when the file moved after the store read it", async () => {
    const opened = await open(TWO);
    await resolve(opened, { ref: "SR-e88fb3" });
    await fs.mkdir(opened.fixture.path("moved"));
    await fs.rename(opened.fixture.path(WIND.file), opened.fixture.path("moved/SR-6328cee88fb3.md"));
    const error = await resolveError(opened, { ref: "SR-e88fb3" });
    expect([error.code, error.details]).toEqual([
      "ref.unknown",
      { ref: "SR-e88fb3", repository: expect.any(String) as string, file: WIND.file },
    ]);
    expect(error.message).not.toContain("did you mean");
    // The store was read again: the next call finds the element where it is now.
    expect((await resolve(opened, { ref: "SR-e88fb3" })).element.file).toBe("moved/SR-6328cee88fb3.md");
  });

  it("never retargets a write: a short ID of a gone element whose tail fits another type stays ref.unknown", async () => {
    // SR-0d1e2f named a system requirement that is gone (deleted, or in a missing repository); a
    // need ends on the same digits. element.setStatus must not write the need.
    const id = "9c0d1e2f-3a4b-4c5d-8e6f-7a8b9c0d1e2f";
    const opened = await open({
      fixture: "SR-001/two-elements",
      files: { "needs/N-7a8b9c0d1e2f.md": element(id, "need", "Another need") },
    });
    const before = await snapshot(opened.fixture.root);
    await expect(
      invoke(
        "element.setStatus",
        { refs: ["SR-0d1e2f"], status: "approved" },
        { workspace: opened.workspace },
      ),
    ).rejects.toMatchObject({ code: "ref.unknown" });
    expect(await snapshot(opened.fixture.root)).toEqual(before);
  });

  it("refuses a version of a normal form the tool does not compute (ADR-0005)", async () => {
    const opened = await open(TWO);
    const error = await resolveError(opened, { ref: WIND.id, version: "n3:0000000000000000" });
    expect([error.code, error.details]).toEqual([
      "input.invalid",
      { command: "element.resolve", fields: ["version"] },
    ]);
  });

  it("[SR-060/AK2] compares a given version in its own normal form (ADR-0005 normal form 2)", async () => {
    const opened = await open(TWO);
    const store = await opened.workspace.get(elementStoreState);
    const record = store.elements.find((e) => e.id === WIND.id);
    expect(record).toBeDefined();
    const forms = record && currentFormsOf(await currentVersions(opened.workspace), record);
    expect(forms?.n2).toMatch(/^n2:/);
    expect((await resolve(opened, { ref: WIND.id, version: forms?.n1 })).current).toBe("current");
    expect((await resolve(opened, { ref: WIND.id, version: forms?.n2 })).current).toBe("current");
    expect((await resolve(opened, { ref: WIND.id, version: "n2:0000000000000000" })).current).toBe(
      "outdated",
    );
  });

  it("[SR-060/AK2] reports whether the given version is still the current one", async () => {
    const opened = await open(TWO);
    const { element: now } = await resolve(opened, { ref: WIND.id });
    expect((await resolve(opened, { ref: "SR-e88fb3", version: now.version })).current).toBe("current");
    expect((await resolve(opened, { ref: "SR-e88fb3", version: "n1:0000000000000000" })).current).toBe(
      "outdated",
    );
    // The text changes on disk: the version given before is outdated (D-013).
    const file = opened.fixture.path(WIND.file);
    await fs.writeFile(file, (await fs.readFile(file, "utf8")).replace("current", "measured"));
    const changed = await resolve(opened, { ref: "SR-e88fb3", version: now.version });
    expect(changed.current).toBe("outdated");
    expect(changed.element.text).toContain("measured wind speed");
    expect(changed.element.version).not.toBe(now.version);
    expect((await resolve(opened, { ref: WIND.id, version: changed.element.version })).current).toBe(
      "current",
    );
  });

  it("[SR-060/AK2] tells unknown, not current or outdated, for an element without a version (ThomasBirkmaier/ReqSeq-archive#276)", async () => {
    // A counted value without a normal form (`.inf`, ADR-0005) leaves the element without a version.
    const endless = `---\nid: ${GUSTS.id}\ntype: system-requirement\nstatus: draft\ntitle: Show gusts\nrequirement-type: functional\nacceptance-criteria: .inf\n---\n\nGusts.\n`;
    const opened = await open({ ...TWO, files: { [GUSTS.file]: endless } });
    const given = await resolve(opened, { ref: GUSTS.id, version: "n1:0000000000000000", versionDate: true });
    expect(given.current).toBe("unknown");
    expect(given.element).not.toHaveProperty("version");
    expect(given.element).not.toHaveProperty("versionDate");
    expect(given.element.problems?.at(-1)).toMatchObject({
      code: "file.faulty",
      severity: "warning",
      message: `No version: ${GUSTS.file} of repository system: version: Infinity is not a valid number`,
    });
    // The element as element.get shows it; without a version given, `current` stays null.
    const shown = (await invoke("element.get", { ref: GUSTS.id }, { workspace: opened.workspace })) as {
      element: unknown;
    };
    expect(given.element).toEqual(shown.element);
    expect(await resolve(opened, { ref: "SR-4a5b6c", versionDate: false })).toEqual({
      element: shown.element,
      current: null,
    });
  });

  it("dates the current version only on request, as element.get does (D-013, ADR-0005)", async () => {
    const opened = await open({ ...TWO, git: true });
    const plain = await resolve(opened, { ref: WIND.id });
    expect(plain.element).not.toHaveProperty("versionDate");
    const dated = await resolve(opened, {
      ref: "SR-e88fb3",
      versionDate: true,
      version: plain.element.version,
    });
    expect(dated.current).toBe("current");
    expect(dated.element.versionDate).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    const shown = (await invoke(
      "element.get",
      { ref: WIND.id, versionDate: true },
      { workspace: opened.workspace },
    )) as { element: unknown };
    expect(dated.element).toEqual(shown.element);
    expect(await resolve(opened, { ref: WIND.id, versionDate: false })).toEqual(plain);
  });

  it("[SR-060/AK2] keeps a version current when only status and title change (D-013)", async () => {
    const opened = await open(TWO);
    const { element: before } = await resolve(opened, { ref: GUSTS.id });
    await invoke(
      "element.setStatus",
      { refs: [GUSTS.id], status: "approved" },
      { workspace: opened.workspace },
    );
    await invoke(
      "element.update",
      await readFirst({ ref: GUSTS.id, title: "Show gusts now" }, { workspace: opened.workspace }),
      { workspace: opened.workspace },
    );
    const after = await resolve(opened, { ref: GUSTS.id, version: before.version });
    expect(after.element).toMatchObject({ status: "approved", title: "Show gusts now" });
    expect(after.current).toBe("current");
  });

  it("[SR-060/AK3] reports an unknown short ID or UUID as ref.unknown", async () => {
    const opened = await open(TWO);
    const before = await snapshot(opened.fixture.root);
    for (const ref of ["SR-ffffff", "N-ffffff", WIND.id.replace("e8df", "0000")]) {
      const error = await resolveError(opened, { ref, version: "n1:0000000000000000" });
      expect([error.code, error.details]).toEqual(["ref.unknown", { ref }]);
    }
    expect(await snapshot(opened.fixture.root)).toEqual(before);
  });

  it("[SR-060/AK3] reports an ambiguous short ID as ref.ambiguous with the candidates", async () => {
    const opened = await open(SHARED_ENDS);
    const error = await resolveError(opened, { ref: "SR-abc123" });
    expect([error.code, error.details]).toEqual([
      "ref.ambiguous",
      {
        ref: "SR-abc123",
        candidates: [
          { id: SR_1, repository: expect.any(String) as string, file: "requirements/SR-000001abc123.md" },
          { id: SR_2, repository: expect.any(String) as string, file: "requirements/SR-000002abc123.md" },
        ],
      },
    ]);
    // A prefix that fits none stays unknown; the tail fits three elements, so none is named.
    const none = await resolveError(opened, { ref: "D-abc123" });
    expect([none.code, none.details]).toEqual(["ref.unknown", { ref: "D-abc123" }]);
  });

  it("[SR-060/AK3] reports a UUID that two files share (SR-088) as ref.ambiguous", async () => {
    const opened = await open({ fixture: "SR-088/copied-file" }, "system");
    const ref = "948a10f1-05c3-4212-bd19-00606ccf2661";
    const error = await resolveError(opened, { ref });
    expect(error.code).toBe("ref.ambiguous");
    expect((error.details as { candidates: unknown[] }).candidates).toHaveLength(2);
  });

  it("[SR-060/AK1] resolves one copy of a UUID two files share by its file, as element.get opens it (ThomasBirkmaier/ReqSeq-archive#255)", async () => {
    const opened = await open({ fixture: "SR-088/copied-file" }, "system");
    const ref = "948a10f1-05c3-4212-bd19-00606ccf2661";
    const input = { ref, repository: "system", file: "copies/N-00606ccf2661.md" };
    const resolved = await resolve(opened, input);
    expect(resolved.element).toMatchObject({ id: ref, file: "copies/N-00606ccf2661.md" });
    const shown = (await invoke("element.get", input, { workspace: opened.workspace })) as {
      element: unknown;
    };
    expect(resolved.element).toEqual(shown.element);
    expect((await resolve(opened, { ...input, version: resolved.element.version })).current).toBe("current");
    // A file that holds none of them keeps its own ref.unknown, without a guessed short ID.
    const error = await resolveError(opened, { ref, file: "needs/N-00606ccf2661.md" });
    expect(error.code).toBe("ref.unknown");
    expect(error.message).not.toContain("did you mean");
    expect((error.details as { candidates: unknown[] }).candidates).toHaveLength(2);
  });
});

describe("element.resolve names the variants and replacements as element.get does (#456)", () => {
  const P = "43043043-0000-4000-8000-0000000000";
  /** fixtures/SR-043/example, where A (Coast) replaces K1 by A1, with B (Mountain) excluding K1. */
  const EXAMPLE: FixtureOptions = {
    fixture: "SR-043/example",
    files: {
      "variants/VAR-0000000000c2.md": `---\nid: ${P}c2\ntype: variant\nstatus: draft\ntitle: Mountain\nexcludes: [{ id: ${P}a1 }]\n---\n`,
    },
  };
  const get = async (opened: Opened, ref: string): Promise<CommandOutput<"element.get">> =>
    (await invoke("element.get", { ref }, { workspace: opened.workspace })) as CommandOutput<"element.get">;

  it("gives names and incomplete as element.get gives them", async () => {
    const opened = await open(EXAMPLE);
    const k1 = await resolve(opened, { ref: "SR-0000a1" });
    expect(k1.names?.slice(0, 3).map((n) => [n.shortId, n.title])).toEqual([
      ["VAR-0000c1", "Coast"],
      ["VAR-0000c2", "Mountain"],
      ["SR-0000b1", "Response time at most 20 ms"],
    ]);
    expect(k1.names).toEqual((await get(opened, "SR-0000a1")).names);
    expect(k1).not.toHaveProperty("incomplete");
    const missing = await open({ fixture: "SR-089/missing-targets" }, "system");
    expect(await resolve(missing, { ref: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d" })).toHaveProperty(
      "incomplete",
      true,
    );
  });
});

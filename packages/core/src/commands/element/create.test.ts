import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { createElement, elementStoreState, loadElements, shortIdState } from "../../model/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
import { workspaceLayoutState } from "../../workspace/index.js";
import { computeVersion } from "../../version/version.js";

type Output = CommandOutput<"element.create">;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface Opened {
  readonly fixture: FixtureWorkspace;
  readonly workspace: Workspace;
  /** The workspace root inside the fixture. */
  readonly root: string;
}

const open = async (options: FixtureOptions, root = "."): Promise<Opened> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.path(root));
  onTestFinished(() => workspace.close());
  return { fixture, workspace, root: fixture.path(root) };
};

const standard = (files: FixtureOptions["files"] = {}): Promise<Opened> =>
  open({ fixture: "SR-001/two-elements", files });

const create = async (opened: Opened, input: Record<string, unknown>): Promise<Output> =>
  (await invoke("element.create", input, { workspace: opened.workspace })) as Output;

const createError = async (opened: Opened, input: Record<string, unknown>): Promise<CommandError> => {
  try {
    await create(opened, input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected element.create to fail");
};

/** Every file below `folder`, relative with `/`, sorted. */
const filesBelow = async (folder: string): Promise<string[]> => {
  const entries = await fs.readdir(folder, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => path.relative(folder, path.join(e.parentPath, e.name)).split(path.sep).join("/"))
    .sort();
};

const read = (opened: Opened, file: string): Promise<string> =>
  fs.readFile(path.join(opened.root, file), "utf8");

const tail12 = (id: string): string => id.replaceAll("-", "").slice(-12);

/** `Übersicht` in both Unicode normal forms: one precomposed `Ü`, or `U` and a combining diaeresis. */
const NFC = `${String.fromCodePoint(0xdc)}bersicht`;
const NFD = `U${String.fromCodePoint(0x308)}bersicht`;

/** Whether two paths name one existing folder (same device and inode, or file index on Windows). */
const sameFolder = async (a: string, b: string): Promise<boolean> => {
  try {
    const [one, two] = await Promise.all([fs.stat(a, { bigint: true }), fs.stat(b, { bigint: true })]);
    return one.dev === two.dev && one.ino === two.ino;
  } catch {
    return false;
  }
};

/**
 * Makes `lstat`, `opendir`, `realpath` and `mkdir` see the names of `onDisk` as a file system that
 * ignores the Unicode normal form (APFS) does: a name that equals one of them after NFC (and with
 * `ignoreCase` after lower case, too) names that one. So Linux and Windows run the branches of
 * macOS; on macOS the real file system does the same.
 */
const foldNormalForm = (onDisk: readonly string[], ignoreCase = false): void => {
  const key = (name: string): string =>
    ignoreCase ? name.normalize("NFC").toLowerCase() : name.normalize("NFC");
  const fold = (p: string): string =>
    p
      .split(path.sep)
      .map((name) => onDisk.find((stored) => key(stored) === key(name)) ?? name)
      .join(path.sep);
  const real = {
    lstat: fs.lstat.bind(fs),
    opendir: fs.opendir.bind(fs),
    realpath: fs.realpath.bind(fs),
    mkdir: fs.mkdir.bind(fs),
  };
  const spies = [
    vi.spyOn(fs, "lstat").mockImplementation(((p: string) => real.lstat(fold(p))) as typeof fs.lstat),
    vi.spyOn(fs, "opendir").mockImplementation(((p: string) => real.opendir(fold(p))) as typeof fs.opendir),
    vi
      .spyOn(fs, "realpath")
      .mockImplementation(((p: string) => real.realpath(fold(p))) as typeof fs.realpath),
    vi
      .spyOn(fs, "mkdir")
      .mockImplementation(((p: string, options: object) => real.mkdir(fold(p), options)) as typeof fs.mkdir),
  ];
  onTestFinished(() => {
    for (const spy of spies) {
      spy.mockRestore();
    }
  });
};

describe("element.create", () => {
  it("[SR-001/AK1] writes exactly one file named by prefix and UUID, properties as frontmatter, text below", async () => {
    const opened = await standard();
    const before = await filesBelow(opened.root);
    const out = await create(opened, {
      type: "system-requirement",
      title: "Show rain",
      text: "The station shows rain.\n",
      folder: "requirements",
      properties: {
        "acceptance-criteria": ["Given rain, when it falls, then the station shows it."],
        "requirement-type": "functional",
      },
    });
    const id = out.element.id;
    const file = `requirements/SR-${tail12(id)}.md`;
    expect(await filesBelow(opened.root)).toEqual([...before, file].sort());
    expect(out.files).toEqual([file]);
    // Structural keys, the title, then the properties in the order of the type (ADR-0004).
    expect(await read(opened, file)).toBe(
      [
        "---",
        `id: ${id}`,
        "type: system-requirement",
        "status: draft",
        "title: Show rain",
        "requirement-type: functional",
        "acceptance-criteria:",
        "  - Given rain, when it falls, then the station shows it.",
        "---",
        "",
        "The station shows rain.",
        "",
      ].join("\n"),
    );
    expect(out.element).toEqual({
      id,
      shortId: `SR-${id.slice(-6)}`,
      type: "system-requirement",
      status: "draft",
      title: "Show rain",
      text: "The station shows rain.\n",
      version: computeVersion({
        text: "The station shows rain.\n",
        properties: {
          "requirement-type": "functional",
          "acceptance-criteria": ["Given rain, when it falls, then the station shows it."],
        },
        definitions: [
          { key: "requirement-type", kind: "choice", content: true },
          { key: "acceptance-criteria", kind: "text", content: true },
        ],
        files: [],
      }),
      repository: "system",
      file,
      properties: {
        "requirement-type": "functional",
        "acceptance-criteria": ["Given rain, when it falls, then the station shows it."],
      },
      relations: [],
      problems: [],
    });
    expect(out.problems).toEqual([]);
  });

  it("[SR-002/AK1] gives every new element a new random UUID of version 4", async () => {
    const opened = await standard();
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const out = await create(opened, { type: "need", title: `Need ${String(i)}` });
      expect(out.element.id).toMatch(UUID_V4);
      expect(out.files).toEqual([`need/N-${tail12(out.element.id)}.md`]);
      ids.add(out.element.id);
    }
    expect(ids.size).toBe(5);
  });

  it("gives the initial status of the metamodel, whatever its key", async () => {
    const opened = await open({ fixture: "SR-013/own-meanings" });
    const out = await create(opened, { type: "spec-item", title: "Own model" });
    expect(out.element).toMatchObject({ status: "open", title: "Own model", type: "spec-item" });
    expect(await read(opened, out.files[0] ?? "")).toBe(
      `---\nid: ${out.element.id}\ntype: spec-item\nstatus: open\nlabel: Own model\n---\n`,
    );
  });

  it("refuses when the metamodel marks no status or more than one as initial", async () => {
    for (const statuses of [
      "  - { key: open, name: Open }\n",
      "  - { key: open, name: Open, initial: true }\n  - { key: new, name: New, initial: true }\n",
    ]) {
      const opened = await open({
        fixture: "SR-013/own-meanings",
        files: { "model/statuses.yaml": `reqseq-metamodel: 1\nstatuses:\n${statuses}` },
      });
      const before = await filesBelow(opened.root);
      // Such a metamodel is invalid, so the command refuses before element.create runs.
      const error = await createError(opened, { type: "wish", title: "x" });
      expect(error.code).toBe("workspace.read-only");
      // createElement does not check writability; it still refuses on its own.
      const direct = await createElement(opened.workspace, { type: "wish", title: "x" }).catch(
        (thrown: unknown) => thrown,
      );
      expect(direct).toBeInstanceOf(CommandError);
      expect(direct).toMatchObject({ code: "input.invalid", details: { reason: "initial-status" } });
      expect(await filesBelow(opened.root)).toEqual(before);
    }
  });

  it("puts the file into the type folder by default, creating it, or into the given folder", async () => {
    const opened = await standard();
    const inType = await create(opened, { type: "decision", title: "Use YAML" });
    expect(inType.files).toEqual([`decision/D-${tail12(inType.element.id)}.md`]);
    const nested = await create(opened, { type: "decision", title: "Nested", folder: "a/b/" });
    expect(nested.files).toEqual([`a/b/D-${tail12(nested.element.id)}.md`]);
    for (const folder of [".", "", "./"]) {
      const top = await create(opened, { type: "decision", title: "Top", folder });
      expect(top.files).toEqual([`D-${tail12(top.element.id)}.md`]);
      expect(top.element.file).toBe(`D-${tail12(top.element.id)}.md`);
    }
  });

  it("refuses a folder outside the repository and writes nothing", async () => {
    const opened = await standard();
    const before = await filesBelow(path.dirname(opened.root));
    for (const folder of ["..", "../elsewhere", opened.fixture.path("elsewhere"), "/elsewhere"]) {
      expect((await createError(opened, { type: "need", title: "x", folder })).code).toBe("input.invalid");
    }
    expect(await filesBelow(path.dirname(opened.root))).toEqual(before);
  });

  it("writes into another repository of the workspace and refuses unknown or missing ones", async () => {
    const opened = await open({ fixture: "SR-085/value-kinds" }, "system");
    const out = await create(opened, {
      type: "system-requirement",
      title: "Sensor",
      repository: "sensor",
      folder: "anemometer",
    });
    expect(out.element).toMatchObject({
      repository: "sensor",
      file: `anemometer/SR-${tail12(out.element.id)}.md`,
    });
    expect(out.files).toEqual([`../sensor/anemometer/SR-${tail12(out.element.id)}.md`]);
    const unknown = await createError(opened, { type: "need", title: "x", repository: "nope" });
    expect([unknown.code, unknown.details]).toEqual([
      "input.invalid",
      { repository: "nope", reason: "unknown" },
    ]);
    await fs.rm(opened.fixture.path("sensor"), { recursive: true });
    const missing = new Workspace(opened.root);
    onTestFinished(() => missing.close());
    const error = await (async (): Promise<CommandError> => {
      try {
        await invoke(
          "element.create",
          { type: "need", title: "x", repository: "sensor" },
          { workspace: missing },
        );
      } catch (e) {
        return e as CommandError;
      }
      throw new Error("expected an error");
    })();
    expect([error.code, error.details]).toEqual([
      "input.invalid",
      { repository: "sensor", reason: "not-available" },
    ]);
  });

  it("refuses properties the type does not have, structural keys, relation kinds and the title key", async () => {
    const opened = await standard();
    const before = await filesBelow(opened.root);
    const cases: [Record<string, unknown>, string][] = [
      [{ status: "approved" }, "structural"],
      // Checked before empty values are left out: an empty status is refused too.
      [{ status: null }, "structural"],
      [{ "requirement-type": [] }, "not-a-property"],
      [{ id: "x" }, "structural"],
      [{ type: "need" }, "structural"],
      [{ title: "Other" }, "title"],
      [{ "customer-id": "WS-1" }, "not-a-property"],
      [
        { "derives-from": [{ id: "e8df96ea-a168-4d90-8d65-6328cee88fb3", version: "n1:0000000000000000" }] },
        "relation",
      ],
      [{ "requirement-type": "functional" }, "not-a-property"],
    ];
    for (const [properties, reason] of cases) {
      const error = await createError(opened, {
        type: "need",
        title: "x",
        properties: { rationale: "r", ...properties },
      });
      expect([error.code, error.details?.["reason"]]).toEqual(["input.invalid", reason]);
    }
    expect(await filesBelow(opened.root)).toEqual(before);
  });

  it("stores the UUID of a relation target given in upper case in lower case (#309, spec question #316)", async () => {
    const opened = await open({ fixture: "SR-085/value-kinds" }, "system");
    const id = "3f1757ed-26d9-478e-8fdc-ea6fe2e123a9";
    const out = await create(opened, {
      type: "system-requirement",
      title: "Gusts",
      properties: { "parent-item": { id: id.toUpperCase() } },
    });
    expect(out.element.properties["parent-item"]).toMatchObject({ id });
    expect(await read(opened, out.files[0] ?? "")).toContain(`parent-item: { id: ${id}, `);
  });

  it("leaves empty properties out and writes relation-valued and single relation target values", async () => {
    const opened = await open({ fixture: "SR-085/value-kinds" }, "system");
    const target = {
      id: "3f1757ed-26d9-478e-8fdc-ea6fe2e123a9",
      version: "n1:9f86d081884c7d65",
      title: "Wind",
    };
    const out = await create(opened, {
      type: "system-requirement",
      title: "Gusts",
      properties: { "acceptance-criteria": [], due: null, "parent-item": target, weight: 2 },
    });
    // The target is new, so it is stored with its current version and title (SR-021).
    const stored = { id: target.id, version: "n1:845647775ebfe803", title: "Wind speed visible at a glance" };
    expect(await read(opened, out.files[0] ?? "")).toBe(
      [
        "---",
        `id: ${out.element.id}`,
        "type: system-requirement",
        "status: draft",
        "title: Gusts",
        "weight: 2",
        `parent-item: { id: ${stored.id}, version: ${stored.version}, title: ${stored.title} }`,
        "---",
        "",
      ].join("\n"),
    );
    expect(out.element.properties).toEqual({ weight: 2, "parent-item": stored });
  });

  it("[SR-064/AK2] saves with every required property empty (absent, null, an empty list, an empty title) and gives one element.missing-required hint per key", async () => {
    const opened = await standard();
    /** The hint for the required property `key` of a system requirement, on `line` when the file has the key. */
    const missing = (out: Output, key: string, name: string, line?: number): Record<string, unknown> => ({
      code: "element.missing-required",
      severity: "warning",
      message: `Required property ${name} (${key}) of type System Requirement (system-requirement) has no value; ReqSeq changes no file`,
      repository: "system",
      file: out.element.file,
      elementId: out.element.id,
      elementShortId: out.element.shortId,
      ...(line === undefined ? {} : { line }),
    });
    const head = (out: Output): string[] => [
      "---",
      `id: ${out.element.id}`,
      "type: system-requirement",
      "status: draft",
    ];

    // Only type and title: requirement type and acceptance criteria are absent.
    const bare = await create(opened, { type: "system-requirement", title: "Show gusts" });
    expect(bare.problems).toEqual([
      missing(bare, "requirement-type", "Requirement Type"),
      missing(bare, "acceptance-criteria", "Acceptance Criteria"),
    ]);
    expect(bare.element.problems).toEqual(bare.problems);
    expect(await read(opened, bare.files[0] ?? "")).toBe(
      [...head(bare), "title: Show gusts", "---", ""].join("\n"),
    );

    // An empty title and the required properties given as null and as an empty list: nothing but the title is written.
    const empty = await create(opened, {
      type: "system-requirement",
      title: "",
      properties: { "requirement-type": null, "acceptance-criteria": [] },
    });
    expect(empty.problems).toEqual([
      missing(empty, "title", "Title", 5),
      missing(empty, "requirement-type", "Requirement Type"),
      missing(empty, "acceptance-criteria", "Acceptance Criteria"),
    ]);
    expect(await read(opened, empty.files[0] ?? "")).toBe(
      [...head(empty), 'title: ""', "---", ""].join("\n"),
    );

    // Both files are saved: the next read of the workspace finds them with the same hints.
    for (const out of [bare, empty]) {
      const got = (await invoke(
        "element.get",
        { ref: out.element.id },
        { workspace: opened.workspace },
      )) as CommandOutput<"element.get">;
      expect(got.element.problems).toEqual(out.problems);
    }
  });

  it("[SR-012/AK3] writes the key of a choice value given by its display name, in any case (#309)", async () => {
    const opened = await standard();
    const out = await create(opened, {
      type: "system-requirement",
      title: "Named",
      properties: { "requirement-type": "Functional", "verification-method": "INSPECTION" },
    });
    const text = await read(opened, out.files[0] ?? "");
    expect(text).toContain("\nrequirement-type: functional\n");
    expect(text).toContain("\nverification-method: inspection\n");
    expect(out.element.properties).toEqual({
      "requirement-type": "functional",
      "verification-method": "inspection",
    });
    expect((out.problems ?? []).filter((p) => p.code === "element.wrong-value-kind")).toEqual([]);
  });

  it("refuses a choice value that names no choice and writes no file (#309, spec question #316)", async () => {
    const opened = await standard();
    const before = await filesBelow(opened.root);
    for (const value of ["sometimes", 5, ["functional", "Sometimes"]]) {
      const error = await createError(opened, {
        type: "system-requirement",
        title: "Wrong",
        properties: { "requirement-type": value },
      });
      expect([error.code, error.details]).toEqual([
        "input.invalid",
        {
          key: "requirement-type",
          value: Array.isArray(value) ? "Sometimes" : value,
          reason: "unknown-choice",
          allowed: ["functional", "quality", "performance", "interface", "constraint"],
        },
      ]);
    }
    expect(
      (
        await createError(opened, {
          type: "system-requirement",
          title: "Wrong",
          properties: { "requirement-type": "sometimes" },
        })
      ).message,
    ).toBe(
      "properties.requirement-type: sometimes is not a value of Requirement Type; the values are: functional (Functional), quality (Quality), performance (Performance), interface (Interface), constraint (Constraint)",
    );
    expect(await filesBelow(opened.root)).toEqual(before);
  });

  it("refuses a choice name that fits two values; the exact key always wins (#309)", async () => {
    const opened = await standard({
      "metamodel/extra.yaml":
        "reqseq-metamodel: 1\nproperties:\n  - key: urgency\n    name: Urgency\n    kind: choice\n    choices:\n      - { key: low, name: Soon }\n      - { key: soon, name: Later }\n  - { key: mood, name: Mood, kind: choice }\ntypes:\n  - { key: note, name: Note, prefix: NOTE, properties: [title, urgency, mood] }\n",
    });
    const note = async (urgency: string): Promise<unknown> =>
      (await create(opened, { type: "note", title: "A note", properties: { urgency } })).element.properties[
        "urgency"
      ];
    expect(await note("soon")).toBe("soon");
    expect(await note("later")).toBe("soon");
    const error = await createError(opened, {
      type: "note",
      title: "A note",
      properties: { urgency: "SOON" },
    });
    expect([error.code, error.details]).toEqual([
      "input.invalid",
      {
        key: "urgency",
        value: "SOON",
        reason: "ambiguous-choice",
        allowed: ["low", "soon"],
        candidates: ["low", "soon"],
      },
    ]);
    expect(error.message).toBe(
      "properties.urgency: SOON names more than one value of Urgency (low, soon); give the key. The values are: low (Soon), soon (Later)",
    );
    // A choice property without values takes none.
    const none = await createError(opened, { type: "note", title: "A note", properties: { mood: "calm" } });
    expect([none.message, none.details]).toEqual([
      "properties.mood: calm is not a value of Mood; the values are: none",
      { key: "mood", value: "calm", reason: "unknown-choice", allowed: [] },
    ]);
  });

  it("stores a value of the wrong kind and reports it with its line (SR-085)", async () => {
    const opened = await standard();
    // One text where the metamodel wants a list of texts; a choice value that is no choice is refused (#309).
    const out = await create(opened, {
      type: "system-requirement",
      title: "Wrong",
      properties: { "requirement-type": "functional", "acceptance-criteria": "Shows it" },
    });
    expect(out.problems).toEqual([
      expect.objectContaining({
        code: "element.wrong-value-kind",
        severity: "warning",
        repository: "system",
        file: out.element.file,
        line: 7,
        elementId: out.element.id,
      }),
    ]);
    expect(out.element.problems).toEqual(out.problems);
  });

  it("refuses unknown and abstract types", async () => {
    const opened = await open({
      fixture: "SR-013/own-meanings",
      files: {
        "model/abstract.yaml":
          "reqseq-metamodel: 1\ntypes:\n  - { key: base, name: Base, prefix: B, abstract: true, properties: [label] }\n",
      },
    });
    expect((await createError(opened, { type: "nope", title: "x" })).details).toMatchObject({
      reason: "unknown",
    });
    expect((await createError(opened, { type: "base", title: "x" })).details).toMatchObject({
      reason: "abstract",
    });
  });

  it("needs a property with the meaning title, and the type must have it", async () => {
    const opened = await open({
      fixture: "SR-013/own-meanings",
      files: {
        "model/properties.yaml":
          "reqseq-metamodel: 1\nproperties:\n  - { key: label, name: Label, kind: text }\n  - { key: applies-to, name: Applies to, kind: relation, many: true }\n  - { key: validity, name: Validity note, kind: text }\n",
      },
    });
    expect((await createError(opened, { type: "wish", title: "x" })).code).toBe(
      "metamodel.meaning-unassigned",
    );
    const other = await open({
      fixture: "SR-013/own-meanings",
      files: {
        "model/types.yaml":
          "reqseq-metamodel: 1\ntypes:\n  - { key: wish, name: Wish, prefix: W, properties: [validity] }\n  - { key: spec-item, name: Spec, prefix: SPI, properties: [label, applies-to] }\n  - { key: edition, name: Edition, prefix: ED, meaning: variant, properties: [label] }\n",
      },
    });
    const error = await createError(other, { type: "wish", title: "x" });
    expect([error.code, error.details]).toEqual([
      "input.invalid",
      { type: "wish", key: "label", reason: "no-title-property" },
    ]);
  });

  it("writes a blank line after the frontmatter, a text with LF and a final line break, and an empty text as nothing", async () => {
    const opened = await standard();
    const out = await create(opened, { type: "need", title: "Rain", text: "Rain is shown." });
    expect(await read(opened, out.files[0] ?? "")).toBe(
      `---\nid: ${out.element.id}\ntype: need\nstatus: draft\ntitle: Rain\n---\n\nRain is shown.\n`,
    );
    expect(out.element.text).toBe("Rain is shown.\n");
    const crlf = await create(opened, { type: "need", title: "Lines", text: "One\r\nTwo\rThree" });
    expect(await read(opened, crlf.files[0] ?? "")).toBe(
      `---\nid: ${crlf.element.id}\ntype: need\nstatus: draft\ntitle: Lines\n---\n\nOne\nTwo\nThree\n`,
    );
    const empty = await create(opened, { type: "need", title: "Empty", text: "" });
    expect(await read(opened, empty.files[0] ?? "")).toBe(
      `---\nid: ${empty.element.id}\ntype: need\nstatus: draft\ntitle: Empty\n---\n`,
    );
  });

  it("writes the layout element.update writes, and an update with the same text changes nothing (#308)", async () => {
    const opened = await standard();
    const out = await create(opened, { type: "need", title: "Rain", text: "Rain is shown." });
    const file = out.files[0] ?? "";
    const created = await read(opened, file);
    const again = (await invoke(
      "element.update",
      { ref: out.element.id, text: out.element.text },
      { workspace: opened.workspace },
    )) as CommandOutput<"element.update">;
    expect(again.files).toEqual([]);
    await invoke("element.update", { ref: out.element.id, text: "Snow" }, { workspace: opened.workspace });
    await invoke(
      "element.update",
      { ref: out.element.id, text: "Rain is shown." },
      { workspace: opened.workspace },
    );
    expect(await read(opened, file)).toBe(created);
    // The version is the one of the layout without the blank line that element.create wrote before.
    const id = "0b6f1a52-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
    const old = await standard({
      "need/N-0c1d2e3f4a5b.md": `---\nid: ${id}\ntype: need\nstatus: draft\ntitle: Rain\n---\nRain is shown.\n`,
    });
    const before = (await invoke(
      "element.get",
      { ref: id },
      { workspace: old.workspace },
    )) as CommandOutput<"element.get">;
    expect(before.element.text).toBe("Rain is shown.\n");
    expect(out.element.version).toBe(before.element.version);
  });

  it("makes the next read of the element store find the new element, with a short ID unique among all", async () => {
    const opened = await standard();
    const before = await opened.workspace.get(elementStoreState);
    const out = await create(opened, { type: "need", title: "Fresh" });
    const after = await opened.workspace.get(elementStoreState);
    expect(after).not.toBe(before);
    expect(after.byId.get(out.element.id)?.map((e) => e.file)).toEqual([out.element.file]);
    expect(out.element.shortId).toMatch(/^N-[0-9a-f]{6,}$/);
    // In place (#166): the other elements were not read again; the store is what a full read gives.
    expect(after.elements.filter((e) => before.elements.includes(e))).toHaveLength(before.elements.length);
    expect(after).toEqual(await loadElements(await opened.workspace.get(workspaceLayoutState)));
    expect((await opened.workspace.get(shortIdState)).find(out.element.shortId)).toMatchObject({
      kind: "found",
      element: { id: out.element.id },
    });
  });

  describe("refuses a file the element walk would not list, before anything is written (#183)", () => {
    /** Every folder and file below `folder` with the bytes of each file, so nothing written or created goes unseen. */
    const treeBelow = async (folder: string): Promise<Record<string, string>> => {
      const entries = await fs.readdir(folder, { recursive: true, withFileTypes: true });
      const tree: Record<string, string> = {};
      for (const e of entries) {
        const absolute = path.join(e.parentPath, e.name);
        const relative = path.relative(folder, absolute).split(path.sep).join("/");
        tree[relative] = e.isFile()
          ? (await fs.readFile(absolute)).toString("base64")
          : e.isDirectory()
            ? "folder"
            : "link";
      }
      return tree;
    };

    /** An input, the rule that refuses it and the part of the path the rule names. */
    type Case = readonly [input: Record<string, unknown>, rule: string, part: string];

    const inFolder = (rule: string, ...folders: readonly string[]): Case[] =>
      folders.map((folder) => [{ folder }, rule, folder]);

    /**
     * Each input is refused with `input.invalid`, `reason` `not-listed` (or `not-portable`) and the
     * rule, and the tree below the workspace is unchanged byte for byte: no file, no folder.
     */
    const refused = async (opened: Opened, cases: readonly Case[]): Promise<void> => {
      const before = await treeBelow(opened.root);
      for (const [input, rule, part] of cases) {
        const error = await createError(opened, { type: "need", title: "x", ...input });
        expect([input, error.code, error.details]).toMatchObject([
          input,
          "input.invalid",
          {
            reason: rule === "not-portable" || rule === "invisible" ? "not-portable" : "not-listed",
            rule,
            path: part,
          },
        ]);
      }
      expect(await treeBelow(opened.root)).toEqual(before);
    };

    it("never writes below .git, at the top or in any folder (D-036: ReqSeq never writes to Git)", async () => {
      const opened = await open({ fixture: "SR-001/two-elements", git: true });
      await refused(opened, [
        ...inFolder("skipped-name", ".git"),
        [{ folder: ".git/objects" }, "skipped-name", ".git"],
        [{ folder: ".git/refs/heads" }, "skipped-name", ".git"],
        [{ folder: "requirements/.git" }, "skipped-name", "requirements/.git"],
        [{ folder: "new/.git/x" }, "skipped-name", "new/.git"],
      ]);
      expect(await opened.fixture.git(["status", "--porcelain"])).toBe("");
    });

    it("never writes below a name that Windows or macOS take for .git or node_modules (D-036)", async () => {
      const opened = await open({ fixture: "SR-001/two-elements", git: true });
      await refused(opened, [
        [{ folder: ".GIT/objects" }, "skipped-name", ".GIT"],
        ...inFolder("skipped-name", ".Git", ".git.", ".git ", ".git. .", "requirements/NODE_MODULES"),
        [{ folder: ".git./objects" }, "skipped-name", ".git."],
        [{ folder: ".git /x" }, "skipped-name", ".git "],
        [{ folder: "Node_Modules/x" }, "skipped-name", "Node_Modules"],
        [{ folder: "GIT~1/objects" }, "not-portable", "GIT~1"],
        [{ folder: "NODE_M~1/x" }, "not-portable", "NODE_M~1"],
      ]);
      expect(await opened.fixture.git(["status", "--porcelain"])).toBe("");
    });

    it("refuses names that Windows changes or refuses, wherever the repository is checked out", async () => {
      const opened = await standard();
      await refused(opened, [
        ...inFolder("not-portable", "drafts.", "drafts ", "a<b", "a>b", "a:b", 'a"b', "a|b", "a?b", "a*b"),
        ...inFolder("not-portable", "a\u0001b", "CON", "nul", "Aux.md", "com1", "LPT9.txt", "prn.x.y"),
        ...inFolder("not-portable", "CONIN$", "conout$.txt", "COM\u00b9", "lpt\u00b3"),
        [{ folder: "requirements/notes./x" }, "not-portable", "requirements/notes."],
      ]);
      // Names that only look alike are fine.
      for (const folder of [
        "console",
        "com0",
        "lpt",
        "a~b",
        "Kapitel~1",
        "release~2026",
        ".gitlab",
        "node_modules_old",
      ]) {
        const out = await create(opened, { type: "need", title: "Fine", folder });
        expect(out.element.file).toBe(`${folder}/N-${tail12(out.element.id)}.md`);
      }
    });

    it("refuses an existing folder spelled in another case, as a file system that ignores case finds it, and names the spelling on disk", async () => {
      const opened = await standard();
      await opened.workspace.get(elementStoreState);
      // Linux tells the case apart, so the answers of Windows and macOS are given here.
      const fold = (p: string): string => p.replace(`${path.sep}Requirements`, `${path.sep}requirements`);
      const { lstat, opendir, realpath } = {
        lstat: fs.lstat.bind(fs),
        opendir: fs.opendir.bind(fs),
        realpath: fs.realpath.bind(fs),
      };
      const spies = [
        vi.spyOn(fs, "lstat").mockImplementation(((p: string) => lstat(fold(p))) as typeof fs.lstat),
        vi.spyOn(fs, "opendir").mockImplementation(((p: string) => opendir(fold(p))) as typeof fs.opendir),
        vi.spyOn(fs, "realpath").mockImplementation(((p: string) => realpath(fold(p))) as typeof fs.realpath),
      ];
      onTestFinished(() => {
        for (const spy of spies) {
          spy.mockRestore();
        }
      });
      await refused(opened, [
        [{ folder: "Requirements" }, "spelling", "Requirements"],
        [{ folder: "Requirements/new" }, "spelling", "Requirements"],
      ]);
      const error = await createError(opened, { type: "need", title: "x", folder: "Requirements" });
      expect(error.details).toMatchObject({ existing: "requirements" });
      expect(error.message).toContain("(on disk: requirements)");
      const out = await create(opened, { type: "need", title: "Fine", folder: "requirements" });
      expect(out.element.file).toBe(`requirements/N-${tail12(out.element.id)}.md`);
    });

    it("refuses a new folder whose name holds an invisible format character, but keeps an existing one (#194)", async () => {
      const opened = await standard({ "alt\u200b/README.md": "# Alt\n" });
      await refused(opened, [
        ...inFolder(
          "invisible",
          "a\u200bb",
          "\ufeffbom",
          "Ab\u00adschnitt",
          "rtl\u202e",
          "requirements/x\u200fy",
        ),
        [{ folder: "new\u2060/deeper" }, "invisible", "new\u2060"],
      ]);
      const error = await createError(opened, { type: "need", title: "x", folder: "a\u200bb" });
      expect(error.message).toContain("a\u200bb holds an invisible format character");
      expect(error.message).toMatch(/\(U\+200B\)$/);
      expect(error.details).toMatchObject({ character: "U+200B" });
      const astral = await createError(opened, { type: "need", title: "x", folder: "tag\u{e0041}" });
      expect(astral.details).toMatchObject({ rule: "invisible", character: "U+E0041" });
      const out = await create(opened, { type: "need", title: "Fine", folder: "alt\u200b" });
      expect(out.element.file).toBe(`alt\u200b/N-${tail12(out.element.id)}.md`);
    });

    it("refuses .git with a zero-width non-joiner inside, a .git where the file system drops the mark (HFS+), and else as invisible (#194, D-036)", async () => {
      const opened = await open({ fixture: "SR-001/two-elements", git: true });
      const alias = ".g\u200cit";
      const same = await sameFolder(opened.fixture.path(".git"), opened.fixture.path(alias));
      if (process.env["CI"] !== undefined) {
        // NTFS, ext4 and APFS keep the mark.
        expect(same).toBe(false);
      }
      await refused(opened, [[{ folder: `${alias}/objects` }, same ? "spelling" : "invisible", alias]]);
      expect(await opened.fixture.git(["status", "--porcelain"])).toBe("");
    });

    it("writes into an NFD folder named in NFC, under the spelling on disk, where the file system ignores the normal form (#194)", async () => {
      const opened = await standard({ [`${NFD}/README.md`]: "# Overview\n" });
      await opened.workspace.get(elementStoreState);
      // Linux and Windows keep the normal forms apart, so the answers of macOS (APFS) are given here.
      foldNormalForm([NFD]);
      const out = await create(opened, { type: "need", title: "Umlaut", folder: NFC });
      const file = `${NFD}/N-${tail12(out.element.id)}.md`;
      expect([out.element.file, out.files]).toEqual([file, [file]]);
      expect(await read(opened, file)).toContain("title: Umlaut");
      expect(await filesBelow(opened.fixture.path(NFD))).toEqual([
        "N-" + tail12(out.element.id) + ".md",
        "README.md",
      ]);
      // The element store has it under the same path as a full read.
      const store = await opened.workspace.get(elementStoreState);
      expect(store.byId.get(out.element.id)?.map((r) => r.file)).toEqual([file]);
      const fresh = await loadElements(await opened.workspace.get(workspaceLayoutState));
      expect(fresh.byId.get(out.element.id)?.map((r) => r.file)).toEqual([file]);
      // A new folder below it keeps the given name.
      const deeper = await create(opened, { type: "need", title: "Deeper", folder: `${NFC}/neu` });
      expect(deeper.element.file).toBe(`${NFD}/neu/N-${tail12(deeper.element.id)}.md`);
    });

    it("still refuses a spelling that differs in case as well as in the normal form (#194)", async () => {
      const opened = await standard({ [`${NFD}/README.md`]: "# Overview\n" });
      await opened.workspace.get(elementStoreState);
      foldNormalForm([NFD], true);
      const lower = NFC.toLowerCase();
      await refused(opened, [[{ folder: lower }, "spelling", lower]]);
      const error = await createError(opened, { type: "need", title: "x", folder: lower });
      expect(error.details).toMatchObject({ existing: NFD });
    });

    it("writes under the spelling on disk where the file system stores a new folder in another normal form (HFS+ stores NFD, #194)", async () => {
      const opened = await standard();
      await opened.workspace.get(elementStoreState);
      foldNormalForm([NFD]);
      // HFS+ stores every new name in NFD; the folder ReqSeq creates as NFC is NFD on disk.
      const mkdir = vi.mocked(fs.mkdir).getMockImplementation();
      vi.mocked(fs.mkdir).mockImplementation(((p: string, options: object) =>
        mkdir?.(p.replace(NFC, NFD), options)) as typeof fs.mkdir);
      const out = await create(opened, { type: "need", title: "Umlaut", folder: `${NFC}/neu` });
      const file = `${NFD}/neu/N-${tail12(out.element.id)}.md`;
      expect([out.element.file, out.files]).toEqual([file, [file]]);
      expect(await read(opened, file)).toContain("title: Umlaut");
    });

    it("on this machine's file system: writes into the existing folder exactly where NFC and NFD name one folder (#194)", async () => {
      const opened = await standard({ [`${NFD}/README.md`]: "# Overview\n" });
      await opened.workspace.get(elementStoreState);
      // APFS ignores the normal form of names; NTFS and ext4 keep NFC and NFD apart. The file system
      // decides; CI, where the platform's file system is known, also checks that.
      const same = await sameFolder(opened.fixture.path(NFD), opened.fixture.path(NFC));
      if (process.env["CI"] !== undefined) {
        expect(same).toBe(process.platform === "darwin");
      }
      const out = await create(opened, { type: "need", title: "Umlaut", folder: NFC });
      const name = `N-${tail12(out.element.id)}.md`;
      const file = same ? `${NFD}/${name}` : `${NFC}/${name}`;
      expect([out.element.file, out.files]).toEqual([file, [file]]);
      expect(await read(opened, file)).toContain("title: Umlaut");
      // One folder where the file system takes both for one; two where it tells them apart.
      const top = (await fs.readdir(opened.root)).filter((n) => n.normalize("NFC") === NFC);
      expect(top.sort()).toEqual(same ? [NFD] : [NFC, NFD].sort());
      const fresh = await loadElements(await opened.workspace.get(workspaceLayoutState));
      expect(fresh.byId.get(out.element.id)?.map((r) => r.file)).toEqual([file]);
    });

    it("never writes into node_modules", async () => {
      const opened = await standard({ "node_modules/x/package.json": "{}\n" });
      await refused(opened, [
        ...inFolder("skipped-name", "node_modules", "requirements/node_modules"),
        [{ folder: "node_modules/x" }, "skipped-name", "node_modules"],
      ]);
    });

    it("refuses a folder or a file name matched by an ignore glob of the workspace file", async () => {
      const opened = await standard({
        "reqseq-workspace.yaml":
          "reqseq-workspace: 1\nname: W\nrepositories:\n  - { name: system, url: x, main: true }\nmetamodel: { repository: system, path: metamodel }\nignore: [drafts/**, decision/*.md]\n",
        "drafts/old/README.md": "# Old\n",
      });
      await refused(opened, [
        ...inFolder("ignored", "drafts"),
        [{ folder: "drafts/old" }, "ignored", "drafts"],
        [{ folder: "drafts/new" }, "ignored", "drafts"],
      ]);
      const error = await createError(opened, { type: "decision", title: "Ignored file name" });
      expect(error.details).toMatchObject({
        reason: "not-listed",
        rule: "ignored",
        path: error.details?.["file"],
      });
      expect(error.details?.["file"]).toMatch(/^decision\/D-[0-9a-f]{12}\.md$/);
    });

    it("refuses the folder of a nested repository of the workspace; the caller names the repository instead", async () => {
      const opened = await standard({
        "reqseq-workspace.yaml":
          "reqseq-workspace: 1\nname: W\nrepositories:\n  - { name: system, url: x, main: true }\n  - { name: sub, url: y, path: vendor/sub }\nmetamodel: { repository: system, path: metamodel }\n",
        "vendor/sub/README.md": "# Sub\n",
      });
      await refused(opened, [
        ...inFolder("nested-repository", "vendor/sub"),
        [{ folder: "vendor/sub/deeper" }, "nested-repository", "vendor/sub"],
      ]);
      const out = await create(opened, { type: "need", title: "Nested", repository: "sub", folder: "." });
      expect(out.files).toEqual([`vendor/sub/N-${tail12(out.element.id)}.md`]);
      expect(out.element).toMatchObject({ repository: "sub", file: `N-${tail12(out.element.id)}.md` });
    });

    it("refuses a folder with its own .git entry, a repository that is not part of the workspace", async () => {
      const opened = await standard({ "own/.git": "gitdir: elsewhere\n" });
      await refused(opened, [
        ...inFolder("git-entry", "own"),
        [{ folder: "own/deeper" }, "git-entry", "own"],
      ]);
    });

    it("refuses a linked folder, which the walk does not follow, and a file in the way of a folder", async () => {
      const opened = await standard();
      await fs.symlink(opened.fixture.path("requirements"), opened.fixture.path("linked"), "junction");
      await refused(opened, [
        ...inFolder("link", "linked"),
        [{ folder: "linked/new" }, "link", "linked"],
        ...inFolder("not-a-folder", "requirements/SR-1d2e3f4a5b6c.md"),
      ]);
    });

    it("refuses a folder the walk cannot open, and any file when it cannot open the repository", async () => {
      const opened = await standard({ "locked/README.md": "# Locked\n" });
      await opened.workspace.get(elementStoreState);
      const opendir = fs.opendir.bind(fs);
      let locked = ["locked"];
      const spy = vi
        .spyOn(fs, "opendir")
        .mockImplementation(((folder: string) =>
          locked.includes(path.basename(folder))
            ? Promise.reject(Object.assign(new Error("denied"), { code: "EACCES" }))
            : opendir(folder)) as typeof fs.opendir);
      onTestFinished(() => {
        spy.mockRestore();
      });
      await refused(opened, [
        ...inFolder("unreadable", "locked"),
        [{ folder: "locked/new" }, "unreadable", "locked"],
      ]);
      locked = [path.basename(opened.root)];
      await refused(opened, [
        [{ folder: "." }, "unreadable", "."],
        [{ folder: "requirements" }, "unreadable", "."],
      ]);
    });

    it("checks the folders again once they are created, so a .git entry put there meanwhile is not written into", async () => {
      const opened = await standard();
      await opened.workspace.get(elementStoreState);
      const mkdir = fs.mkdir.bind(fs);
      const spy = vi.spyOn(fs, "mkdir").mockImplementation((async (folder: string, options: object) => {
        await mkdir(folder, options);
        // Someone else turns the new folder into a repository of its own before ReqSeq writes.
        await fs.writeFile(path.join(opened.root, "fresh", ".git"), "gitdir: elsewhere\n");
        return undefined;
      }) as typeof fs.mkdir);
      onTestFinished(() => {
        spy.mockRestore();
      });
      const error = await createError(opened, { type: "need", title: "x", folder: "fresh/deeper" });
      expect([error.code, error.details]).toMatchObject([
        "input.invalid",
        { reason: "not-listed", rule: "git-entry", path: "fresh" },
      ]);
      expect(await filesBelow(opened.fixture.path("fresh"))).toEqual([".git"]);
    });
  });

  it("is refused on a read-only workspace before anything is written", async () => {
    const opened = await standard({ "metamodel/broken.yaml": "reqseq-metamodel: 2\n" });
    const before = await filesBelow(opened.root);
    expect((await createError(opened, { type: "need", title: "x" })).code).toBe("workspace.read-only");
    expect(await filesBelow(opened.root)).toEqual(before);
  });
});

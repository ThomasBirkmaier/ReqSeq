import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { createElement, elementStoreState } from "../../model/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
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
        files: { "model/statuses.yaml": `logreq-metamodel: 1\nstatuses:\n${statuses}` },
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
    expect(await read(opened, out.files[0] ?? "")).toBe(
      [
        "---",
        `id: ${out.element.id}`,
        "type: system-requirement",
        "status: draft",
        "title: Gusts",
        "weight: 2",
        `parent-item: { id: ${target.id}, version: n1:9f86d081884c7d65, title: Wind }`,
        "---",
        "",
      ].join("\n"),
    );
    expect(out.element.properties).toEqual({ weight: 2, "parent-item": target });
  });

  it("stores a value of the wrong kind and reports it with its line (SR-085)", async () => {
    const opened = await standard();
    const out = await create(opened, {
      type: "system-requirement",
      title: "Wrong",
      properties: { "requirement-type": "sometimes" },
    });
    expect(out.problems).toEqual([
      expect.objectContaining({
        code: "element.wrong-value-kind",
        severity: "warning",
        repository: "system",
        file: out.element.file,
        line: 6,
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
          "logreq-metamodel: 1\ntypes:\n  - { key: base, name: Base, prefix: B, abstract: true, properties: [label] }\n",
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
          "logreq-metamodel: 1\nproperties:\n  - { key: label, name: Label, kind: text }\n  - { key: applies-to, name: Applies to, kind: relation, many: true }\n  - { key: validity, name: Validity note, kind: text }\n",
      },
    });
    expect((await createError(opened, { type: "wish", title: "x" })).code).toBe(
      "metamodel.meaning-unassigned",
    );
    const other = await open({
      fixture: "SR-013/own-meanings",
      files: {
        "model/types.yaml":
          "logreq-metamodel: 1\ntypes:\n  - { key: wish, name: Wish, prefix: W, properties: [validity] }\n  - { key: spec-item, name: Spec, prefix: SPI, properties: [label, applies-to] }\n  - { key: edition, name: Edition, prefix: ED, meaning: variant, properties: [label] }\n",
      },
    });
    const error = await createError(other, { type: "wish", title: "x" });
    expect([error.code, error.details]).toEqual([
      "input.invalid",
      { type: "wish", key: "label", reason: "no-title-property" },
    ]);
  });

  it("writes a text with LF and a final line break, and an empty text as nothing", async () => {
    const opened = await standard();
    const out = await create(opened, { type: "need", title: "Rain", text: "Rain is shown." });
    expect(await read(opened, out.files[0] ?? "")).toBe(
      `---\nid: ${out.element.id}\ntype: need\nstatus: draft\ntitle: Rain\n---\nRain is shown.\n`,
    );
    const crlf = await create(opened, { type: "need", title: "Lines", text: "One\r\nTwo\rThree" });
    expect(await read(opened, crlf.files[0] ?? "")).toBe(
      `---\nid: ${crlf.element.id}\ntype: need\nstatus: draft\ntitle: Lines\n---\nOne\nTwo\nThree\n`,
    );
    const empty = await create(opened, { type: "need", title: "Empty", text: "" });
    expect(await read(opened, empty.files[0] ?? "")).toBe(
      `---\nid: ${empty.element.id}\ntype: need\nstatus: draft\ntitle: Empty\n---\n`,
    );
  });

  it("makes the next read of the element store find the new element, with a short ID unique among all", async () => {
    const opened = await standard();
    const before = await opened.workspace.get(elementStoreState);
    const out = await create(opened, { type: "need", title: "Fresh" });
    const after = await opened.workspace.get(elementStoreState);
    expect(after).not.toBe(before);
    expect(after.byId.get(out.element.id)?.map((e) => e.file)).toEqual([out.element.file]);
    expect(out.element.shortId).toMatch(/^N-[0-9a-f]{6,}$/);
  });

  it("is refused on a read-only workspace before anything is written", async () => {
    const opened = await standard({ "metamodel/broken.yaml": "logreq-metamodel: 2\n" });
    const before = await filesBelow(opened.root);
    expect((await createError(opened, { type: "need", title: "x" })).code).toBe("workspace.read-only");
    expect(await filesBelow(opened.root)).toEqual(before);
  });
});

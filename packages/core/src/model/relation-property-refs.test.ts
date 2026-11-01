// Element references in relation-valued properties (#169, #196, #287): element.create,
// element.update and element.bulkUpdate take each item of a property of kind relation as a
// string or `{ id }` holding a UUID, short ID or identifier, write it as UUID and version, and
// refuse a reference that names no element; nothing is written as text.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandName } from "../catalog.js";
import { CommandError } from "../catalog.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { computeVersion } from "../version/version.js";
import { elementStoreState } from "./store.js";
import { relationTargetRefs } from "./targets.js";
import { shortIdState } from "./short-id.js";

/** The elements of fixtures/SR-021/targets. */
const PKG = { id: "5b0c2f9e-7a41-4c3d-9e2b-1f6a8d3c7e10", short: "PKG-3c7e10", title: "Release 1.0" };
const VAR = { id: "9d4e6a1b-3c2f-4b8a-a1d7-52e8c0f4b9a3", short: "VAR-f4b9a3" };
const SOURCE = { id: "6e2f8a4c-1b3d-4c5e-9f7a-3d8b2c6e1f05", file: "requirements/SR-3d8b2c6e1f05.md" };
const SENSOR_NEED = { id: "a7f3c1e9-5b2d-4e8f-b6a4-0e9d7c5b3a21", short: "N-5b3a21" };
/** The version the fixture's validity entry stores, which a set keeps. */
const STORED_VAR = "n1:0000000000000000";

const version = (text: string): string =>
  computeVersion({ text, properties: {}, definitions: [], files: [] });
const PKG_ENTRY = `{ id: ${PKG.id}, version: ${version("The first release.")}, title: ${PKG.title} }`;
const SENSOR_ENTRY = `{ id: ${SENSOR_NEED.id}, version: ${version("The sensor measures gusts.")}, repository: sensor }`;

const METAMODEL = new URL(
  "../../../../fixtures/SR-021/targets/system/metamodel/standard-model.yaml",
  import.meta.url,
);

interface Opened {
  readonly fixture: FixtureWorkspace;
  readonly workspace: Workspace;
}

const open = async (files: FixtureOptions["files"] = {}): Promise<Opened> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-021/targets", files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.path("system"));
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

/** The fixture with an identifier on the package: its source identifier gets the meaning `identifier`. */
const withIdentifier = async (): Promise<Opened> =>
  open({
    "system/metamodel/standard-model.yaml": (await fs.readFile(METAMODEL, "utf8")).replace(
      "meaning: source-identifier",
      "meaning: identifier",
    ),
    "system/packages/PKG-1f6a8d3c7e10.md": `---\nid: ${PKG.id}\ntype: package\nstatus: draft\ntitle: ${PKG.title}\nsource-identifier: Stufe-3\n---\n\nThe first release.\n`,
  });

const run = (opened: Opened, name: CommandName, input: Record<string, unknown>): Promise<unknown> =>
  invoke(name, input, { workspace: opened.workspace });

const runError = async (
  opened: Opened,
  name: CommandName,
  input: Record<string, unknown>,
): Promise<CommandError> => {
  const error: unknown = await run(opened, name, input).then(
    () => undefined,
    (e: unknown) => e,
  );
  if (error instanceof CommandError) {
    return error;
  }
  throw new Error(`expected ${name} to fail`);
};

const read = (opened: Opened, file: string): Promise<string> =>
  fs.readFile(opened.fixture.path(`system/${file}`), "utf8");

/** The lines of `key` in the frontmatter of `text`: the key and its items. */
const linesOf = (text: string, key: string): string[] => {
  const lines = text.split("\n");
  const at = lines.indexOf(`${key}:`);
  if (at < 0) {
    return [];
  }
  const end = lines.findIndex((line, i) => i > at && !line.startsWith("  - "));
  return lines.slice(at + 1, end);
};

describe("element references in relation-valued properties (#169, #196, #287)", () => {
  it("element.update writes a short ID, as text or as { id } in any case, and a UUID in upper case as UUID and version", async () => {
    const opened = await open();
    await run(opened, "element.update", {
      ref: SOURCE.id,
      set: { packages: [PKG.short], validity: [{ id: VAR.short.toLowerCase() }] },
    });
    const text = await read(opened, SOURCE.file);
    expect(linesOf(text, "packages")).toEqual([`  - ${PKG_ENTRY}`]);
    // The stored target keeps its stored version, also when it is named by short ID.
    expect(linesOf(text, "validity")).toEqual([`  - { id: ${VAR.id}, version: ${STORED_VAR}, title: Pro }`]);
    await run(opened, "element.update", { ref: SOURCE.id, set: { packages: [PKG.id.toUpperCase()] } });
    expect(linesOf(await read(opened, SOURCE.file), "packages")).toEqual([`  - ${PKG_ENTRY}`]);
  });

  it("names a target in another repository with it, whether the item names the repository or not", async () => {
    const opened = await open();
    for (const items of [
      [SENSOR_NEED.short, PKG.short],
      [{ id: SENSOR_NEED.short, repository: "sensor" }, { id: PKG.short }],
    ]) {
      await run(opened, "element.update", { ref: SOURCE.id, set: { packages: items } });
      expect(linesOf(await read(opened, SOURCE.file), "packages")).toEqual([
        `  - ${SENSOR_ENTRY}`,
        `  - ${PKG_ENTRY}`,
      ]);
    }
  });

  it("element.create takes an identifier, as { id } and as text (#169)", async () => {
    const opened = await withIdentifier();
    for (const item of [{ id: "Stufe-3" }, "stufe-3"]) {
      const created = (await run(opened, "element.create", {
        type: "system-requirement",
        title: "New",
        properties: { packages: [item] },
      })) as { files: string[] };
      const [file = ""] = created.files;
      expect(linesOf(await read(opened, file), "packages")).toEqual([`  - ${PKG_ENTRY}`]);
    }
  });

  it("refuses a reference that names no element or several, and an item that is no reference, and writes nothing", async () => {
    // A copied file: two files share the UUID of the variant, so its short ID names both (SR-088).
    const opened = await open({
      "system/variants/copy-of-VAR.md": `---\nid: ${VAR.id}\ntype: variant\nstatus: draft\ntitle: Pro\n---\n`,
    });
    const before = await read(opened, SOURCE.file);
    const unknown = await runError(opened, "element.update", {
      ref: SOURCE.id,
      set: { packages: ["PKG-999999"] },
    });
    expect([unknown.code, unknown.message, unknown.details]).toEqual([
      "ref.unknown",
      'No element has the short ID or identifier "PKG-999999" (in the property packages)',
      { ref: "PKG-999999", key: "packages" },
    ]);
    const ambiguous = await runError(opened, "element.update", {
      ref: SOURCE.id,
      set: { validity: [{ id: VAR.short }] },
    });
    expect([ambiguous.code, ambiguous.details?.["key"]]).toEqual(["ref.ambiguous", "validity"]);
    const elsewhere = await runError(opened, "element.update", {
      ref: SOURCE.id,
      set: { packages: [{ id: PKG.short, repository: "sensor" }] },
    });
    expect([elsewhere.code, elsewhere.details?.["repository"]]).toEqual(["ref.unknown", "sensor"]);
    const number = await runError(opened, "element.update", {
      ref: SOURCE.id,
      set: { packages: [PKG.short, 3] },
    });
    expect([number.code, number.message, number.details]).toEqual([
      "input.invalid",
      "packages: item 2 is the number 3; a relation-valued property takes element references (UUID, short ID or identifier, or { id } with one)",
      { key: "packages", index: 1, reason: "not-a-reference" },
    ]);
    expect(await read(opened, SOURCE.file)).toBe(before);
    const created = await runError(opened, "element.create", {
      type: "system-requirement",
      title: "New",
      properties: { packages: ["PKG-999999"] },
    });
    expect(created.code).toBe("ref.unknown");
  });

  it("element.bulkUpdate adds, sets and removes targets given by short ID, and refuses an unknown one before a file is read (#287)", async () => {
    const opened = await open();
    const selection = { ids: [SOURCE.id] };
    await run(opened, "element.bulkUpdate", {
      selection,
      property: "packages",
      operation: "add",
      value: PKG.short,
      confirm: true,
    });
    expect(linesOf(await read(opened, SOURCE.file), "packages")).toEqual([`  - ${PKG_ENTRY}`]);
    await run(opened, "element.bulkUpdate", {
      selection,
      property: "packages",
      operation: "set",
      value: [{ id: SENSOR_NEED.short }, { id: PKG.short }],
      confirm: true,
    });
    expect(linesOf(await read(opened, SOURCE.file), "packages")).toEqual([
      `  - ${SENSOR_ENTRY}`,
      `  - ${PKG_ENTRY}`,
    ]);
    await run(opened, "element.bulkUpdate", {
      selection,
      property: "packages",
      operation: "remove",
      value: [PKG.short],
      confirm: true,
    });
    expect(linesOf(await read(opened, SOURCE.file), "packages")).toEqual([`  - ${SENSOR_ENTRY}`]);
    const before = await read(opened, SOURCE.file);
    const error = await runError(opened, "element.bulkUpdate", {
      selection,
      property: "packages",
      operation: "add",
      value: "PKG-999999",
      confirm: true,
    });
    expect([error.code, error.details]).toEqual(["ref.unknown", { ref: "PKG-999999", key: "packages" }]);
    const single = await runError(opened, "element.bulkUpdate", {
      selection,
      property: "packages",
      operation: "add",
      value: true,
      confirm: true,
    });
    expect([single.code, single.message]).toEqual([
      "input.invalid",
      "packages: is the boolean true; a relation-valued property takes element references (UUID, short ID or identifier, or { id } with one)",
    ]);
    expect(await read(opened, SOURCE.file)).toBe(before);
  });

  it("keeps null as it is", async () => {
    const opened = await open();
    const store = await opened.workspace.get(elementStoreState);
    const shortIds = await opened.workspace.get(shortIdState);
    expect(relationTargetRefs(store, shortIds, "packages", null)).toBeNull();
    expect(relationTargetRefs(store, shortIds, "packages", PKG.short)).toEqual({
      id: PKG.id,
      repository: "system",
    });
  });
});

import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { CommandError } from "../catalog.js";
import { editElementFile, readElementFile, writeFileAtomic } from "../files/index.js";
import { Workspace } from "../runtime/workspace.js";
import type { Metamodel } from "./index.js";
import {
  allowsType,
  findType,
  keyDefinition,
  markdownKeysOf,
  metamodelState,
  typeForNewElement,
  workspaceAccess,
} from "./index.js";

const ELEMENT = "requirements/SR-6328cee88fb3.md";

const fixture = async (): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace({ fixture: "SR-012/inheritance" });
  onTestFinished(() => created.cleanup());
  return created;
};

const open = (root: string): Workspace => {
  const workspace = new Workspace(root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const errorOf = (fn: () => unknown): CommandError => {
  try {
    fn();
  } catch (e) {
    if (e instanceof CommandError) {
      return e;
    }
    throw e;
  }
  throw new Error("expected a CommandError");
};

const HAZARD_FILE =
  "logreq-metamodel: 1\ntypes:\n  - key: hazard\n    name: Hazard\n    prefix: HAZ\n    properties: [severity]\n    required: [title, severity]\n";

describe("typeForNewElement", () => {
  it("[SR-012/AK1] offers a new type with key, name, prefix and required properties once the workspace is opened", async () => {
    const ws = await fixture();
    const before = await open(ws.root).get(metamodelState);
    expect(errorOf(() => typeForNewElement(before, "hazard")).toJSON()).toEqual({
      code: "input.invalid",
      message: "Unknown type hazard: the metamodel has no type with this key",
      details: { type: "hazard", reason: "unknown" },
    });

    await ws.write("model/hazard.yaml", HAZARD_FILE);
    const workspace = open(ws.root);
    const metamodel = await workspace.get(metamodelState);
    expect(metamodel).toMatchObject({ valid: true, problems: [] });
    // Writable, so element.create is not refused (SR-011 AK3), and the type can be created.
    expect(await workspaceAccess(workspace)).toEqual({ readOnly: false, reasons: [] });
    expect(typeForNewElement(metamodel, "hazard")).toEqual({
      key: "hazard",
      name: "Hazard",
      prefix: "HAZ",
      abstract: false,
      ancestors: [],
      properties: ["severity", "title"],
      required: ["title", "severity"],
      statuses: ["draft", "approved"],
    });
  });

  it("[SR-012/AK1] refuses an abstract type: it is only there to be inherited from", async () => {
    const metamodel = await open((await fixture()).root).get(metamodelState);
    expect(errorOf(() => typeForNewElement(metamodel, "item")).toJSON()).toEqual({
      code: "input.invalid",
      message: "Type item is abstract: elements of this type cannot be created",
      details: { type: "item", reason: "abstract" },
    });
    expect(typeForNewElement(metamodel, "software-requirement").required).toEqual(["title", "component"]);
  });
});

describe("findType", () => {
  /** Reads the fixture element, sets `title` and `rationale` and saves it as `element.update` would. */
  const save = async (ws: FixtureWorkspace, metamodel: Metamodel): Promise<string> => {
    const read = await readElementFile(ws.root, ELEMENT);
    if (read.kind !== "parsed") {
      throw new Error(`fixture element does not parse: ${read.kind}`);
    }
    const type = findType(metamodel, (read.file.data as { type: string }).type);
    const edited = editElementFile(read.file, {
      edits: [
        { kind: "set", key: "title", value: "Show wind speed in large digits" },
        { kind: "set", key: "rationale", value: "Readable from three metres" },
      ],
      keyOrder: ["id", "type", "status", ...(type?.properties ?? [])],
    });
    await writeFileAtomic(ws.root, ELEMENT, new TextDecoder().decode(edited.bytes), read.file.snapshot);
    return fs.readFile(ws.path(ELEMENT), "utf8");
  };

  it("[SR-012/AK3] keeps the key requirement in the saved file and shows the name System Requirement", async () => {
    const ws = await fixture();
    const metamodel = await open(ws.root).get(metamodelState);
    const saved = await save(ws, metamodel);
    expect(saved).toBe(
      "---\nid: 4f1c2b7a-9d3e-4c8b-a1f0-6328cee88fb3\ntype: requirement\nstatus: draft\ntitle: Show wind speed in large digits\nrationale: Readable from three metres\n---\n\nThe display shows the current wind speed.\n",
    );
    expect(saved).not.toContain("System Requirement");
    const read = await readElementFile(ws.root, ELEMENT);
    const key = read.kind === "parsed" ? (read.file.data as { type: string }).type : undefined;
    expect(key).toBe("requirement");
    expect(findType(metamodel, "requirement")?.name).toBe("System Requirement");
  });

  it("[SR-012/AK3] finds types only by key: a renamed type shows its new name, the element file stays as it is", async () => {
    const ws = await fixture();
    const before = await fs.readFile(ws.path(ELEMENT));
    const types = await fs.readFile(ws.path("model/types.yaml"), "utf8");
    await ws.write(
      "model/types.yaml",
      types.replace("name: System Requirement", "name: Product Requirement"),
    );
    const metamodel = await open(ws.root).get(metamodelState);
    expect(findType(metamodel, "requirement")?.name).toBe("Product Requirement");
    expect(findType(metamodel, "System Requirement")).toBeUndefined();
    expect(findType(metamodel, "Product Requirement")).toBeUndefined();
    expect(await fs.readFile(ws.path(ELEMENT))).toEqual(before);
  });
});

describe("allowsType", () => {
  it("[SR-086/AK1] allows the types of the list and every type that extends one of them", async () => {
    const metamodel = await open((await fixture()).root).get(metamodelState);
    expect(allowsType(undefined, "item", metamodel)).toBe(true);
    expect(allowsType([], "item", metamodel)).toBe(false);
    expect(allowsType(["requirement"], "requirement", metamodel)).toBe(true);
    // interface-requirement extends software-requirement extends requirement.
    expect(allowsType(["requirement"], "interface-requirement", metamodel)).toBe(true);
    expect(allowsType(["software-requirement"], "requirement", metamodel)).toBe(false);
    // A type the metamodel does not know is allowed only by its own key.
    expect(allowsType(["goal"], "goal", metamodel)).toBe(true);
    expect(allowsType(["requirement"], "goal", metamodel)).toBe(false);
  });
});

describe("keyDefinition", () => {
  it("finds a property or a relation kind by key, the property first", async () => {
    const base = await open((await fixture()).root).get(metamodelState);
    const relation = { key: "derives-from", name: "Derives from" };
    const property = { key: "derives-from", name: "Origin", kind: "text" as const };
    const metamodel: Metamodel = { ...base, relations: [relation] };
    expect(keyDefinition(metamodel, "derives-from")).toEqual({ kind: "relation", definition: relation });
    expect(keyDefinition(metamodel, "title")).toMatchObject({
      kind: "property",
      definition: { key: "title" },
    });
    expect(keyDefinition(metamodel, "customer-id")).toBeUndefined();
    const both: Metamodel = { ...metamodel, properties: [...base.properties, property] };
    expect(keyDefinition(both, "derives-from")).toEqual({ kind: "property", definition: property });
  });
});

describe("markdownKeysOf", () => {
  it("[SR-127/AK5] gives the keys of the properties marked markdown once per metamodel, and none for a metamodel that is not valid", async () => {
    const base = await open((await fixture()).root).get(metamodelState);
    const marked: Metamodel = {
      ...base,
      properties: [
        ...base.properties,
        { key: "notes", name: "Notes", kind: "text", markdown: true },
        { key: "plain", name: "Plain", kind: "text", markdown: false },
      ],
    };
    expect(markdownKeysOf(marked)).toEqual(new Set(["notes"]));
    expect(markdownKeysOf(marked)).toBe(markdownKeysOf(marked));
    expect(markdownKeysOf({ ...marked, valid: false })).toEqual(new Set());
  });
});

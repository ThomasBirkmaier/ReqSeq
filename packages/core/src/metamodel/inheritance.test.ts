import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput, Problem } from "../catalog.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import type { EffectiveType, LocatedType, Metamodel } from "./index.js";
import { requiredProblemsState, unknownProblemsState } from "../model/index.js";
import { metamodelState, resolveTypes, workspaceAccess } from "./index.js";

const fixture = async (options: FixtureOptions = {}): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace({ fixture: "SR-012/inheritance", ...options });
  onTestFinished(() => created.cleanup());
  return created;
};

const open = (root: string): Workspace => {
  const workspace = new Workspace(root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const load = async (root: string): Promise<Metamodel> => open(root).get(metamodelState);

const effective = (metamodel: Metamodel, key: string): EffectiveType | undefined =>
  metamodel.effectiveTypes.find((t) => t.key === key);

const invalid = (message: string, file: string, line: number): Problem => ({
  code: "metamodel.invalid",
  severity: "error",
  repository: "system",
  message,
  file,
  line,
});

/** The warning for a property that a type names and no property definition has (#141 c, #238). */
const undefinedProperty = (type: string, property: string, line: number): Problem => ({
  code: "metamodel.invalid",
  severity: "warning",
  repository: "system",
  message: `Type ${type} names unknown property ${property}; it is treated like a property the type does not have`,
  file: "model/z-hazard.yaml",
  line,
});

describe("type inheritance", () => {
  it("[SR-012/AK2] gives a type all properties and required properties of its parent, parent first", async () => {
    const metamodel = await load((await fixture()).root);
    expect(metamodel).toMatchObject({ valid: true, problems: [] });
    expect(effective(metamodel, "requirement")).toEqual({
      key: "requirement",
      name: "System Requirement",
      prefix: "SR",
      extends: "item",
      meaning: "requirement",
      abstract: false,
      ancestors: ["item"],
      properties: ["title", "rationale"],
      required: ["title"],
    });
  });

  it("[SR-012/AK2] inherits over several levels; a property listed again keeps the place of the parent", async () => {
    const metamodel = await load((await fixture()).root);
    expect(effective(metamodel, "software-requirement")).toEqual({
      key: "software-requirement",
      name: "Software Requirement",
      prefix: "SWR",
      extends: "requirement",
      meaning: "requirement",
      abstract: false,
      ancestors: ["requirement", "item"],
      properties: ["title", "rationale", "component"],
      required: ["title", "component"],
    });
    expect(effective(metamodel, "interface-requirement")).toMatchObject({
      ancestors: ["software-requirement", "requirement", "item"],
      properties: ["title", "rationale", "component", "protocol"],
      required: ["title", "component"],
      meaning: "requirement",
    });
  });

  it("[SR-012/AK2] keeps the written definitions and resolves every type in their order", async () => {
    const metamodel = await load((await fixture()).root);
    expect(metamodel.effectiveTypes.map((t) => t.key)).toEqual(metamodel.types.map((t) => t.key));
    expect(metamodel.types[2]).toEqual({
      key: "software-requirement",
      name: "Software Requirement",
      prefix: "SWR",
      extends: "requirement",
      properties: ["component", "rationale"],
      required: ["component"],
    });
    // An abstract type stays abstract; abstract is not inherited.
    expect(effective(metamodel, "item")).toEqual({
      key: "item",
      name: "Item",
      prefix: "ITM",
      abstract: true,
      ancestors: [],
      properties: ["title"],
      required: ["title"],
    });
  });

  it("counts required properties as properties of the type and keeps an own meaning and description", () => {
    const located: LocatedType = {
      definition: {
        key: "hazard",
        name: "Hazard",
        description: "A source of harm",
        prefix: "HAZ",
        meaning: "need",
        required: ["severity"],
      },
      file: "model/hazard.yaml",
      lineOf: () => undefined,
    };
    expect(resolveTypes([located], new Set(["severity"]), new Set(), true)).toEqual({
      types: [
        {
          key: "hazard",
          name: "Hazard",
          description: "A source of harm",
          prefix: "HAZ",
          meaning: "need",
          abstract: false,
          ancestors: [],
          properties: ["severity"],
          required: ["severity"],
        },
      ],
      problems: [],
    });
  });

  it("reports a problem without a line when the place of the definition is not known", () => {
    const located: LocatedType = {
      definition: { key: "hazard", name: "Hazard", prefix: "HAZ", extends: "risk" },
      file: "model/hazard.yaml",
      lineOf: () => undefined,
    };
    expect(resolveTypes([located], new Set(), new Set(), true).problems).toEqual([
      {
        code: "metamodel.invalid",
        severity: "error",
        message: "Type hazard extends unknown type risk",
        file: "model/hazard.yaml",
      },
    ]);
  });

  it("reports a type naming an undefined property as a warning with file and line; the workspace stays writable", async () => {
    const ws = await fixture({
      files: {
        "model/z-hazard.yaml":
          "logreq-metamodel: 1\ntypes:\n  - key: hazard\n    name: Hazard\n    prefix: HAZ\n    extends: requirement\n    properties: [severty, severity, refines]\n    required:\n      - colour\n  - { key: sub-hazard, name: Sub-hazard, prefix: SHZ, extends: hazard }\n",
        "model/z-relations.yaml":
          "logreq-metamodel: 1\nrelations:\n  - { key: refines, name: Refines, inverse-name: Refined by }\n",
      },
    });
    const workspace = open(ws.root);
    const metamodel = await workspace.get(metamodelState);
    expect(metamodel.valid).toBe(true);
    expect(metamodel.problems).toEqual([
      undefinedProperty("hazard", "severty", 7),
      {
        ...undefinedProperty("hazard", "refines", 7),
        message: "Type hazard names refines, which is a relation kind, not a property",
      },
      undefinedProperty("hazard", "colour", 9),
    ]);
    expect(await workspaceAccess(workspace)).toEqual({ readOnly: false, reasons: [] });
    // Treated like an unknown property (D-012): the effective type, own or inherited, leaves it out.
    expect(effective(metamodel, "hazard")).toMatchObject({
      properties: ["title", "rationale", "severity"],
      required: ["title"],
    });
    expect(effective(metamodel, "sub-hazard")).toMatchObject({
      ancestors: ["hazard", "requirement", "item"],
      properties: ["title", "rationale", "severity"],
      required: ["title"],
    });
    // The definition as written keeps it.
    expect(metamodel.types.find((t) => t.key === "hazard")).toMatchObject({
      properties: ["severty", "severity", "refines"],
      required: ["colour"],
    });
  });

  it("gives a value under an undefined property an unknown-property hint and requires no value for it", async () => {
    const ws = await fixture({
      files: {
        "model/z-hazard.yaml":
          "logreq-metamodel: 1\ntypes:\n  - key: hazard\n    name: Hazard\n    prefix: HAZ\n    extends: requirement\n    properties: [severty]\n    required: [colour]\n",
        "requirements/HAZ-0b1c2d3e4f5a.md":
          "---\nid: 9a8b7c6d-5e4f-4a3b-8c2d-0b1c2d3e4f5a\ntype: hazard\nstatus: draft\ntitle: Ice on the sensor\nseverty: high\n---\n",
      },
    });
    const workspace = open(ws.root);
    const unknown = await workspace.get(unknownProblemsState);
    expect(unknown).toEqual([
      expect.objectContaining({
        code: "element.unknown-property",
        severity: "warning",
        file: "requirements/HAZ-0b1c2d3e4f5a.md",
        line: 6,
        message: "Property severty is not in the metamodel; LogReq keeps it and its value unchanged",
      }),
    ]);
    expect(await workspace.get(requiredProblemsState)).toEqual([]);
    // Writes treat it like any key the type does not have: refused as input, kept in the file.
    const created = invoke(
      "element.create",
      { type: "hazard", title: "Hail", properties: { severty: "x" } },
      { workspace },
    );
    await expect(created).rejects.toMatchObject({
      code: "input.invalid",
      details: { key: "severty", reason: "not-a-property" },
    });
    const updated = (await invoke(
      "element.update",
      { ref: "9a8b7c6d-5e4f-4a3b-8c2d-0b1c2d3e4f5a", title: "Ice on the wind sensor" },
      { workspace },
    )) as CommandOutput<"element.update">;
    expect(updated.problems).toContainEqual(
      expect.objectContaining({ code: "element.unknown-property", file: "requirements/HAZ-0b1c2d3e4f5a.md" }),
    );
    expect(await fs.readFile(path.join(ws.root, "requirements/HAZ-0b1c2d3e4f5a.md"), "utf8")).toContain(
      "severty: high\n",
    );
  });

  it("still reports a parent type that does not exist as an error next to an undefined property", async () => {
    const ws = await fixture({
      files: {
        "model/z-hazard.yaml":
          "logreq-metamodel: 1\ntypes:\n  - key: hazard\n    name: Hazard\n    prefix: HAZ\n    extends: risk\n    properties: [title, severty]\n",
      },
    });
    const workspace = open(ws.root);
    const metamodel = await workspace.get(metamodelState);
    expect(metamodel.valid).toBe(false);
    expect(metamodel.problems).toEqual([
      invalid("Type hazard extends unknown type risk", "model/z-hazard.yaml", 6),
      undefinedProperty("hazard", "severty", 7),
    ]);
    // Resolved as far as possible, so a read-only workspace still knows its types.
    expect(effective(metamodel, "hazard")).toMatchObject({ ancestors: [], properties: ["title"] });
    expect(await workspaceAccess(workspace)).toEqual({
      readOnly: true,
      reasons: [invalid("Type hazard extends unknown type risk", "model/z-hazard.yaml", 6)],
    });
  });

  it("does not report an unknown parent or property while a file is faulty, which may define them", async () => {
    const ws = await fixture({
      files: {
        "model/z-faulty.yaml": "logreq-metamodel: 1\ntypes: [\n",
        "model/z-hazard.yaml":
          "logreq-metamodel: 1\ntypes:\n  - key: hazard\n    name: Hazard\n    prefix: HAZ\n    extends: risk\n    required: [colour]\n",
      },
    });
    const metamodel = await load(ws.root);
    expect(metamodel.valid).toBe(false);
    expect(metamodel.problems.filter((p) => p.severity === "error").map((p) => [p.code, p.file])).toEqual([
      ["file.invalid-yaml", "model/z-faulty.yaml"],
    ]);
    expect(effective(metamodel, "hazard")).toMatchObject({ ancestors: [], required: ["colour"] });
  });

  it("reports an inheritance cycle also while a file is faulty", async () => {
    const ws = await fixture({
      files: {
        "model/z-faulty.yaml": "logreq-metamodel: 1\ntypes: [\n",
        "model/z-cycle.yaml": "logreq-metamodel: 1\ntypes:\n  - { key: c, name: C, prefix: C, extends: c }\n",
      },
    });
    const metamodel = await load(ws.root);
    expect(metamodel.problems.filter((p) => p.severity === "error").map((p) => [p.file, p.message])).toEqual([
      ["model/z-faulty.yaml", expect.any(String)],
      ["model/z-cycle.yaml", "Type c is part of an inheritance cycle: c -> c"],
    ]);
  });

  it("reports every type on an inheritance cycle, also across files, and still resolves", async () => {
    const ws = await fixture({
      files: {
        "model/cycle-a.yaml":
          "logreq-metamodel: 1\ntypes:\n  - key: a\n    name: A\n    prefix: A\n    extends: b\n    properties: [title]\n  - key: d\n    name: D\n    prefix: D\n    extends: a\n",
        "model/cycle-b.yaml":
          "logreq-metamodel: 1\ntypes:\n  - key: b\n    name: B\n    prefix: B\n    extends: a\n    properties: [rationale]\n  - { key: c, name: C, prefix: C, extends: c }\n",
      },
    });
    const metamodel = await load(ws.root);
    expect(metamodel.valid).toBe(false);
    expect(metamodel.problems).toEqual([
      invalid("Type a is part of an inheritance cycle: a -> b -> a", "model/cycle-a.yaml", 6),
      invalid("Type b is part of an inheritance cycle: b -> a -> b", "model/cycle-b.yaml", 6),
      invalid("Type c is part of an inheritance cycle: c -> c", "model/cycle-b.yaml", 8),
    ]);
    // d only extends a type on the cycle: it is not reported again.
    expect(effective(metamodel, "a")).toMatchObject({ ancestors: ["b"], properties: ["rationale", "title"] });
    expect(effective(metamodel, "d")).toMatchObject({
      ancestors: ["a", "b"],
      properties: ["rationale", "title"],
    });
    expect(effective(metamodel, "c")).toMatchObject({ ancestors: [], properties: [] });
  });
});

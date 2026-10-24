import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { Problem } from "../catalog.js";
import { Workspace } from "../runtime/workspace.js";
import type { EffectiveType, LocatedType, Metamodel } from "./index.js";
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
  message,
  file,
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
    expect(resolveTypes([located], new Set(["severity"]))).toEqual({
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
    expect(resolveTypes([located], new Set()).problems).toEqual([
      {
        code: "metamodel.invalid",
        severity: "error",
        message: "Type hazard extends unknown type risk",
        file: "model/hazard.yaml",
      },
    ]);
  });

  it("reports a parent type that does not exist and an unknown property with file and line", async () => {
    const ws = await fixture({
      files: {
        "model/z-hazard.yaml":
          "logreq-metamodel: 1\ntypes:\n  - key: hazard\n    name: Hazard\n    prefix: HAZ\n    extends: risk\n    properties: [title, severty]\n    required:\n      - colour\n",
      },
    });
    const workspace = open(ws.root);
    const metamodel = await workspace.get(metamodelState);
    expect(metamodel.valid).toBe(false);
    expect(metamodel.problems).toEqual([
      invalid("Type hazard extends unknown type risk", "model/z-hazard.yaml", 6),
      invalid("Type hazard names unknown property severty", "model/z-hazard.yaml", 7),
      invalid("Type hazard names unknown property colour", "model/z-hazard.yaml", 9),
    ]);
    // Resolved as far as possible, so a read-only workspace still knows its types.
    expect(effective(metamodel, "hazard")).toMatchObject({
      ancestors: [],
      properties: ["title", "severty", "colour"],
      required: ["colour"],
    });
    expect(await workspaceAccess(workspace)).toEqual({ readOnly: true, reasons: metamodel.problems });
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

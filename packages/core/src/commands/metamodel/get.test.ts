import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { MEANINGS } from "../../metamodel/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Output = CommandOutput<"metamodel.get">;

/** `metamodel.get` on a copy of the fixture case, through `invoke` like every access (SR-080). */
const get = async (fixture: string, options: FixtureOptions = {}): Promise<Output> => {
  const ws = await createFixtureWorkspace({ fixture, ...options });
  onTestFinished(() => ws.cleanup());
  const workspace = new Workspace(ws.root);
  onTestFinished(() => workspace.close());
  return (await invoke("metamodel.get", {}, { workspace })) as Output;
};

describe("metamodel.get", () => {
  it("[SR-013/AK1] shows the own relation kind with the meaning derivation as its assignment", async () => {
    // #127 option 1: trace.chain (stage 2) adds the end-to-end test that the chain follows it (#34).
    const out = await get("SR-013/own-meanings");
    expect(out.meanings["derivation"]).toEqual(["satisfies"]);
    expect(out.relations).toEqual([
      { key: "satisfies", name: "Satisfies", "inverse-name": "Satisfied by", meaning: "derivation" },
      { key: "traces-to", name: "Traces to", "inverse-name": "Traced by" },
    ]);
  });

  it("[SR-013/AK2] shows the own property with the meaning validity as its assignment", async () => {
    // #127 option 1: the variant view (stage 5) adds the end-to-end test that evaluates it (#55).
    const out = await get("SR-013/own-meanings");
    expect(out.meanings["validity"]).toEqual(["applies-to"]);
    expect(out.properties.map((p) => [p.key, p.meaning])).toEqual([
      ["label", "title"],
      ["applies-to", "validity"],
      ["validity", undefined],
    ]);
  });

  it("[SR-013/AK3] shows a meaning without key as an empty assignment", async () => {
    const out = await get("SR-013/own-meanings", {
      files: {
        "model/relations.yaml": "reqseq-metamodel: 1\nrelations:\n  - { key: traces-to, name: Traces to }\n",
      },
    });
    expect(out.meanings["derivation"]).toEqual([]);
    expect(out.problems).toEqual([]);
  });

  it("[SR-012/AK2] gives the types with inherited properties and meaning", async () => {
    const out = await get("SR-012/inheritance");
    expect(out.types.map((t) => t.key)).toEqual([
      "item",
      "requirement",
      "software-requirement",
      "interface-requirement",
    ]);
    expect(out.types[3]).toEqual({
      key: "interface-requirement",
      name: "Interface Requirement",
      prefix: "IFR",
      extends: "software-requirement",
      meaning: "requirement",
      abstract: false,
      ancestors: ["software-requirement", "requirement", "item"],
      properties: ["title", "rationale", "component", "protocol"],
      required: ["title", "component"],
      statuses: ["draft", "approved"],
    });
    // The assignment is the type that declares the meaning, not the ones inheriting it.
    expect(out.meanings["requirement"]).toEqual(["requirement"]);
  });

  it("gives the whole metamodel of the fixture", async () => {
    const out = await get("SR-013/own-meanings");
    expect(out).toMatchObject({
      statuses: [
        { key: "open", name: "Open", initial: true },
        { key: "withdrawn", name: "Withdrawn", invalid: true },
      ],
      problems: [],
    });
    expect(out.types.map((t) => [t.key, t.meaning])).toEqual([
      ["wish", "need"],
      ["spec-item", "requirement"],
      ["edition", "variant"],
    ]);
    expect(Object.keys(out.meanings)).toEqual(Object.keys(MEANINGS));
  });

  it("reads a faulty metamodel of a read-only workspace and gives its problems", async () => {
    const out = await get("SR-013/own-meanings", {
      files: { "model/statuses.yaml": "reqseq-metamodel: 1\nstatuses: [\n" },
    });
    expect(out.statuses).toEqual([]);
    expect(out.meanings["derivation"]).toEqual(["satisfies"]);
    expect(out.problems).toMatchObject([
      { code: "file.invalid-yaml", severity: "error", repository: "system", file: "model/statuses.yaml" },
    ]);
  });

  it("names a missing metamodel folder", async () => {
    const out = await get("SR-013/own-meanings", {
      files: {
        "reqseq-workspace.yaml":
          "reqseq-workspace: 1\nname: W\nrepositories:\n  - { name: system, url: x }\nmetamodel: { repository: system, path: missing }\n",
      },
    });
    expect(out.types).toEqual([]);
    expect(out.problems).toMatchObject([{ code: "metamodel.invalid", severity: "error" }]);
  });

  // SR-130: the app draws and lists the metamodel from this output alone, so these are the values every
  // access gives (AK6); the graph and the text are tested in the app.
  it("[SR-130/AK6] gives every type with name, prefix, parent, its properties including the inherited ones, its required properties and statuses", async () => {
    const out = await get("SR-130/metamodel");
    expect(out.problems).toEqual([]);
    expect(out.types).toEqual([
      {
        key: "item",
        name: "Item",
        prefix: "ITM",
        abstract: true,
        ancestors: [],
        properties: ["title"],
        required: ["title"],
        statuses: ["draft", "approved", "retired"],
      },
      {
        key: "requirement",
        name: "System Requirement",
        prefix: "SR",
        extends: "item",
        meaning: "requirement",
        abstract: false,
        ancestors: ["item"],
        properties: ["title", "rationale", "packages"],
        required: ["title"],
        statuses: ["draft", "approved", "retired"],
      },
      {
        key: "software-requirement",
        name: "Software Requirement",
        prefix: "SWR",
        extends: "requirement",
        meaning: "requirement",
        abstract: false,
        ancestors: ["requirement", "item"],
        properties: ["title", "rationale", "packages", "component"],
        required: ["title", "component"],
        statuses: ["draft", "approved", "retired"],
      },
      {
        key: "decision",
        name: "Decision",
        prefix: "D",
        abstract: false,
        ancestors: [],
        properties: ["title"],
        required: [],
        statuses: ["open", "decided"],
      },
      {
        key: "package",
        name: "Package",
        prefix: "PKG",
        meaning: "package",
        abstract: false,
        ancestors: [],
        properties: ["title"],
        required: [],
        statuses: [],
      },
    ]);
    expect(out.statuses.map((status) => [status.key, status.name])).toEqual([
      ["draft", "Draft"],
      ["approved", "Approved"],
      ["retired", "Retired"],
      ["open", "Open"],
      ["decided", "Decided"],
    ]);
  });

  it("[SR-130/AK6] gives every relation kind with its source and target types as written, left out where every type is allowed and empty where none is, and each property's value kind", async () => {
    const out = await get("SR-130/metamodel");
    expect(
      out.relations.map((kind) => [kind.key, kind.name, kind["source-types"], kind["target-types"]]),
    ).toEqual([
      ["derives-from", "Derives from", ["software-requirement"], ["requirement", "software-requirement"]],
      ["replaces", "Replaces", ["requirement"], ["requirement"]],
      ["delegates-to", "Delegates to", ["requirement"], ["software-requirement"]],
      ["based-on", "Based on", undefined, ["decision"]],
      ["concerns", "Concerns", undefined, ["requirement", "decision"]],
      ["refines", "Refines", undefined, undefined],
      ["traces-to", "Traces to", ["decision"], undefined],
      ["blocks", "Blocks", [], ["requirement"]],
    ]);
    expect(out.relations.filter((kind) => "source-types" in kind).map((kind) => kind.key)).not.toContain(
      "based-on",
    );
    expect(out.properties.map((p) => [p.key, p.name, p.kind, p.many, p["target-types"]])).toEqual([
      ["title", "Title", "text", undefined, undefined],
      ["rationale", "Rationale", "text", undefined, undefined],
      ["component", "Component", "choice", true, undefined],
      ["packages", "Package", "relation", true, ["package"]],
      ["severity", "Severity", "number", undefined, undefined],
    ]);
  });
});

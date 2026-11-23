import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { MEANINGS } from "../../metamodel/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
import { elements, openSmall, run, useCounts } from "../metamodel-commands.test-helper.js";

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
  it("[SR-013/AK-st9d] shows the own relation kind with the meaning derivation as its assignment", async () => {
    // ThomasBirkmaier/ReqSeq-archive#127 option 1: trace.chain (stage 2) adds the end-to-end test that the chain follows it (ThomasBirkmaier/ReqSeq-archive#34).
    const out = await get("SR-013/own-meanings");
    expect(out.meanings["derivation"]).toEqual(["satisfies"]);
    expect(out.relations).toEqual([
      { key: "satisfies", name: "Satisfies", "inverse-name": "Satisfied by", meaning: "derivation" },
      { key: "traces-to", name: "Traces to", "inverse-name": "Traced by" },
    ]);
  });

  it("[SR-013/AK-tm7f] shows the own property with the meaning validity as its assignment", async () => {
    // ThomasBirkmaier/ReqSeq-archive#127 option 1: the variant view (stage 5) adds the end-to-end test that evaluates it (ThomasBirkmaier/ReqSeq-archive#55).
    const out = await get("SR-013/own-meanings");
    expect(out.meanings["validity"]).toEqual(["applies-to"]);
    expect(out.properties.map((p) => [p.key, p.meaning])).toEqual([
      ["label", "title"],
      ["applies-to", "validity"],
      ["validity", undefined],
    ]);
  });

  it("[SR-013/AK-bh0d] shows a meaning without key as an empty assignment", async () => {
    const out = await get("SR-013/own-meanings", {
      files: {
        "model/relations.yaml": "reqseq-metamodel: 1\nrelations:\n  - { key: traces-to, name: Traces to }\n",
      },
    });
    expect(out.meanings["derivation"]).toEqual([]);
    expect(out.problems).toEqual([]);
  });

  it("[SR-012/AK-bp90] gives the types with inherited properties and meaning", async () => {
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

  it("[SR-130/AK-y6rs] gives the whole metamodel of the fixture, the initial status and the invalid ones marked", async () => {
    const out = await get("SR-013/own-meanings");
    expect(out).toMatchObject({
      statuses: [
        { key: "open", name: "Open", initial: true },
        { key: "withdrawn", name: "Withdrawn", invalid: true },
      ],
      problems: [],
    });
    // Each mark only where it holds.
    expect(out.statuses.map((status) => [status.key, status.initial, status.invalid])).toEqual([
      ["open", true, undefined],
      ["withdrawn", undefined, true],
    ]);
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
    expect(out.files).toEqual([]);
    expect(out.problems).toMatchObject([{ code: "metamodel.invalid", severity: "error" }]);
  });

  it("names the metamodel files it read in the order merged, a faulty one too (#625)", async () => {
    const out = await get("SR-013/own-meanings", {
      files: { "model/zz-faulty.yaml": "reqseq-metamodel: 1\nstatuses: [\n" },
    });
    expect(out.files).toEqual(
      ["properties", "relations", "statuses", "types", "zz-faulty"].map((name) => ({
        repository: "system",
        path: `model/${name}.yaml`,
      })),
    );
  });

  // SR-130: the app draws and lists the metamodel from this output alone, so these are the values every
  // access gives (AK6); the graph and the text are tested in the app.
  it("[SR-130/AK-cmt2] gives every type with name, prefix, parent, its properties including the inherited ones, its required properties and statuses", async () => {
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

  it("[SR-130/AK-cmt2] gives every relation kind with its source and target types as written, left out where every type is allowed and empty where none is, and each property's value kind", async () => {
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

  it("[SR-130/AK-y6rs] says of each property whether it counts to the version, false where content is not written", async () => {
    const out = await get("SR-130/metamodel");
    expect(out.properties.map((p) => [p.key, p.content])).toEqual([
      ["title", false],
      ["rationale", false],
      ["component", true],
      ["packages", false],
      ["severity", false],
    ]);
  });

  it("gives per type the relation kinds relation.options gives an element of it: subtypes, an abstract type, source types absent or empty", async () => {
    const types = ["item", "requirement", "software-requirement", "decision", "package"];
    const id = (at: number): string => `21521500-0000-4000-8000-00000000000${String(at)}`;
    const element = (type: string, at: number): string =>
      `---\nid: ${id(at)}\ntype: ${type}\n${type === "package" ? "" : `status: ${type === "decision" ? "open" : "draft"}\n`}title: ${type}\n---\n`;
    const ws = await createFixtureWorkspace({
      fixture: "SR-130/metamodel",
      files: Object.fromEntries(types.map((type, at) => [`kinds/${type}.md`, element(type, at)])),
    });
    onTestFinished(() => ws.cleanup());
    const workspace = new Workspace(ws.root);
    onTestFinished(() => workspace.close());
    const out = (await invoke("metamodel.get", {}, { workspace })) as Output;
    expect(Object.keys(out.relationKinds)).toEqual(out.types.map((type) => type.key));
    for (const [at, type] of types.entries()) {
      const options = (await invoke(
        "relation.options",
        { ref: id(at) },
        { workspace },
      )) as CommandOutput<"relation.options">;
      expect(out.relationKinds[type], type).toEqual(
        options.kinds.map((option) => ({ kind: option.kind, targetTypes: option.targetTypes })),
      );
    }
    // `blocks` (source types empty) is no kind of any type; `refines` (both absent) is one of every type.
    expect(
      Object.values(out.relationKinds)
        .flat()
        .map((option) => option.kind),
    ).not.toContain("blocks");
    expect(out.relationKinds["software-requirement"]?.map((option) => option.kind)).toEqual([
      "derives-from",
      "replaces",
      "delegates-to",
      "based-on",
      "concerns",
      "refines",
    ]);
    expect(out.relationKinds["item"]?.map((option) => option.kind)).toEqual([
      "based-on",
      "concerns",
      "refines",
    ]);
  });
});

describe("metamodel.get: the elements of each use count (SR-224 AK4)", () => {
  it("[SR-224/AK-h9kx] element.list gives exactly the elements each number of uses counts, by its entry", async () => {
    const { workspace } = await openSmall(
      elements(
        [1, "hazard", { severity: "high", about: "[]" }],
        [2, "risk", { status: "open", severity: "high" }],
        [3, "note", { status: "open", remark: "x" }],
      ),
    );
    const out = await run<Output>(workspace, "metamodel.get", {});
    /** The UUID numbers of the elements `element.list` gives for the number `field` of the entry `key`. */
    const counted = async (field: string, key: Record<string, string>): Promise<number[]> => {
      const listed = await run<CommandOutput<"element.list">>(workspace, "element.list", {
        selection: { output: { command: "metamodel.get", input: {}, count: { field, key: [key] } } },
      });
      expect(listed.incomplete ?? false, field).toBe(false);
      return (listed.elements ?? []).map((e) => Number(e.id.slice(-12))).sort((a, b) => a - b);
    };
    // A type counts its own elements, not those of a type that extends it.
    expect(await counted("uses.types[].count", { key: "hazard" })).toEqual([1]);
    expect(useCounts(out.uses.types)).toEqual({ hazard: 1, risk: 1, note: 1 });
    // The property and the fixed value are used by elements of two types; the unused value counts none.
    expect(await counted("uses.properties[].count", { key: "severity" })).toEqual([1, 2]);
    expect(useCounts(out.uses.properties)["severity"]).toBe(2);
    expect(await counted("uses.values[].count", { property: "severity", value: "high" })).toEqual([1, 2]);
    expect(await counted("uses.values[].count", { property: "severity", value: "low" })).toEqual([]);
    expect(useCounts(out.uses.values)).toEqual({ "severity.low": 0, "severity.high": 2 });
    // A relation kind counts an empty list.
    expect(await counted("uses.relations[].count", { key: "about" })).toEqual([1]);
    expect(useCounts(out.uses.relations)).toEqual({ about: 1 });
    // A status counts on elements of any type: notes have no status open.
    expect(await counted("uses.statuses[].count", { key: "open" })).toEqual([2, 3]);
    expect(await counted("uses.statuses[].count", { key: "noted" })).toEqual([]);
    expect(useCounts(out.uses.statuses)).toMatchObject({ open: 2, noted: 0 });
    // A key that names no entry gives no elements, though elements hold it.
    expect(await counted("uses.properties[].count", { key: "status" })).toEqual([]);
    expect(await counted("uses.types[].count", { key: "system-requirement" })).toEqual([]);
  });
});

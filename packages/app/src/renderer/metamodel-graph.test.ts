import { describe, expect, it } from "vitest";
import type { MetamodelGetOutput } from "@logreq/core";
import type { MetamodelLink } from "./metamodel-graph.js";
import { ANY_KEY, linkLabel, metamodelGraph } from "./metamodel-graph.js";
import { FIXTURE_METAMODEL, effectiveType, metamodelOutput } from "./metamodel-test-data.js";

type Relation = MetamodelGetOutput["relations"][number];

const relation = (
  key: string,
  sides: Partial<Pick<Relation, "source-types" | "target-types">>,
): Relation => ({
  key,
  name: key,
  ...sides,
});

/** The edges as "source > target: label | label". */
const edgeLines = (output: MetamodelGetOutput): string[] =>
  metamodelGraph(output).edges.map(
    (edge) => `${edge.source} > ${edge.target}: ${edge.links.map(linkLabel).join(" | ")}`,
  );

const derives: MetamodelLink = { link: "relation", kind: "derives-from", name: "Derives from" };

describe("metamodelGraph", () => {
  it("[SR-130/AK2] makes each type a node with name, prefix and properties including the inherited ones, each inheritance an edge to the parent, and each relation kind an edge from each allowed source to each allowed target, labelled with its name", () => {
    const graph = metamodelGraph(FIXTURE_METAMODEL);
    expect(graph.nodes).toEqual([
      {
        key: "type:item",
        any: false,
        type: "item",
        name: "Item",
        prefix: "ITM",
        abstract: true,
        properties: [{ key: "title", name: "Title", inherited: false }],
      },
      {
        key: "type:requirement",
        any: false,
        type: "requirement",
        name: "System Requirement",
        prefix: "SR",
        abstract: false,
        properties: [
          { key: "title", name: "Title", inherited: true },
          { key: "rationale", name: "Rationale", inherited: false },
          { key: "packages", name: "Package", inherited: false },
        ],
      },
      {
        key: "type:software-requirement",
        any: false,
        type: "software-requirement",
        name: "Software Requirement",
        prefix: "SWR",
        abstract: false,
        // rationale is listed again by the type, but its parent has it: inherited (review S2).
        properties: [
          { key: "title", name: "Title", inherited: true },
          { key: "rationale", name: "Rationale", inherited: true },
          { key: "packages", name: "Package", inherited: true },
          { key: "component", name: "Component", inherited: false },
        ],
      },
      {
        key: "type:decision",
        any: false,
        type: "decision",
        name: "Decision",
        prefix: "D",
        abstract: false,
        properties: [{ key: "title", name: "Title", inherited: false }],
      },
      {
        key: "type:package",
        any: false,
        type: "package",
        name: "Package",
        prefix: "PKG",
        abstract: false,
        properties: [{ key: "title", name: "Title", inherited: false }],
      },
      { key: ANY_KEY, any: true, name: "Any type", properties: [] },
    ]);
    expect(graph.edges.slice(0, 5)).toEqual([
      { source: "type:requirement", target: "type:item", links: [{ link: "extends" }] },
      // The inheritance and a relation kind of one pair: one edge, a label line each.
      {
        source: "type:software-requirement",
        target: "type:requirement",
        links: [{ link: "extends" }, derives],
      },
      { source: "type:software-requirement", target: "type:software-requirement", links: [derives] },
      {
        source: "type:requirement",
        target: "type:requirement",
        links: [{ link: "relation", kind: "replaces", name: "Replaces" }],
      },
      {
        source: "type:requirement",
        target: "type:software-requirement",
        links: [{ link: "relation", kind: "delegates-to", name: "Delegates to" }],
      },
    ]);
    expect(edgeLines(FIXTURE_METAMODEL)).toEqual([
      "type:requirement > type:item: extends",
      "type:software-requirement > type:requirement: extends | Derives from",
      "type:software-requirement > type:software-requirement: Derives from",
      "type:requirement > type:requirement: Replaces",
      "type:requirement > type:software-requirement: Delegates to",
      "any > type:decision: Based on · any source | Concerns · any source",
      "any > type:requirement: Concerns · any source",
      "any > any: Refines · any source and target",
      "type:decision > any: Traces to · any target",
      // The relation property packages (#619 Q1), from the type that has it as its own only.
      "type:requirement > type:package: Package",
    ]);
  });

  it("[SR-130/AK3] draws a relation kind that allows every type on a side once, to or from the node Any type, with the open side in its label, and adds that node only then", () => {
    const types = [effectiveType("a"), effectiveType("b"), effectiveType("c")];
    expect(
      edgeLines(
        metamodelOutput({
          types,
          relations: [
            relation("from-any", { "target-types": ["a"] }),
            // Open source, two target types: one curve per target type, each with the hint (#619 Q2).
            relation("to-two", { "target-types": ["b", "c"] }),
            relation("to-any", { "source-types": ["a"] }),
            relation("both", {}),
          ],
        }),
      ),
    ).toEqual([
      "any > type:a: from-any · any source",
      "any > type:b: to-two · any source",
      "any > type:c: to-two · any source",
      "type:a > any: to-any · any target",
      "any > any: both · any source and target",
    ]);
    expect(
      metamodelGraph(
        metamodelOutput({ types, relations: [relation("r", { "target-types": ["a"] })] }),
      ).nodes.at(-1),
    ).toEqual({ key: ANY_KEY, any: true, name: "Any type", properties: [] });
    // Every kind restricted on both sides: no node "Any type".
    const restricted = metamodelGraph(
      metamodelOutput({
        types,
        relations: [relation("r", { "source-types": ["a"], "target-types": ["b"] })],
      }),
    );
    expect(restricted.nodes.map((node) => node.key)).toEqual(["type:a", "type:b", "type:c"]);
    // An open side opposite an empty list allows no pair: no curve, no node "Any type".
    const none = metamodelGraph(
      metamodelOutput({ types, relations: [relation("r", { "target-types": [] })] }),
    );
    expect(none).toEqual({ nodes: restricted.nodes, edges: [] });
  });

  it("skips a type key that names no type, an empty list, and a parent that is not defined", () => {
    const output = metamodelOutput({
      types: [effectiveType("a", ["p"], "gone"), effectiveType("b")],
      properties: [{ key: "q", name: "Q", kind: "relation", "target-types": ["gone", "b"] }],
      relations: [
        relation("r", { "source-types": ["gone", "a"], "target-types": ["b", "gone"] }),
        relation("empty", { "source-types": [], "target-types": ["a"] }),
      ],
    });
    // A property no definition names is shown by its key; with no defined parent nothing is inherited.
    expect(metamodelGraph(output).nodes[0]?.properties).toEqual([{ key: "p", name: "p", inherited: false }]);
    expect(edgeLines(output)).toEqual(["type:a > type:b: r"]);
  });

  it("draws a relation property from each type that has it as its own, to each target type or to Any type", () => {
    const output = metamodelOutput({
      types: [effectiveType("base", ["see", "kind"]), effectiveType("sub", ["see", "kind", "more"], "base")],
      properties: [
        { key: "see", name: "See", kind: "relation" },
        { key: "kind", name: "Kind", kind: "text" },
        { key: "more", name: "More", kind: "relation", many: true, "target-types": ["base", "sub"] },
      ],
    });
    expect(edgeLines(output)).toEqual([
      "type:sub > type:base: extends | More",
      "type:base > any: See · any target",
      "type:sub > type:sub: More",
    ]);
    expect(metamodelGraph(output).nodes.map((node) => node.key)).toEqual(["type:base", "type:sub", ANY_KEY]);
  });
});

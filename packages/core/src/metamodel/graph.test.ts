// The graph of the metamodel (SR-130 AK2, AK3) on a small output of metamodel.get: one node per type with
// its own and inherited properties, "Any type" only for an open side, one edge per ordered pair. The app's
// tests of the drawing read it on fixtures/SR-130/metamodel.
import { describe, expect, it } from "vitest";
import type { CommandOutput } from "../catalog.js";
import { ANY_KEY, linkLabel, metamodelGraph } from "./graph.js";

type Output = CommandOutput<"metamodel.get">;
type Type = Output["types"][number];

const type = (key: string, properties: string[], parent?: string): Type => ({
  key,
  name: key.toUpperCase(),
  prefix: key.slice(0, 2).toUpperCase(),
  abstract: parent === undefined,
  ancestors: parent === undefined ? [] : [parent],
  properties,
  required: [],
  statuses: [],
  ...(parent === undefined ? {} : { extends: parent }),
});

const output = (parts: Pick<Output, "types" | "properties" | "relations">): Output => ({
  statuses: [],
  meanings: {},
  relationKinds: {},
  files: [],
  ...parts,
});

/** Every edge as "source > target: label | label". */
const edges = (out: Output): string[] =>
  metamodelGraph(out).edges.map(
    (edge) => `${edge.source} > ${edge.target}: ${edge.links.map(linkLabel).join(" | ")}`,
  );

const BASE = output({
  types: [
    type("item", ["title", "owner"]),
    // The parent "gone" is no type: no inheritance edge, nothing inherited.
    type("req", ["title", "owner", "pkg", "note"], "item"),
    type("sub", ["title", "owner", "pkg", "note"], "req"),
    type("orphan", ["title"], "gone"),
  ],
  properties: [
    { key: "title", name: "Title", kind: "text", content: false },
    { key: "owner", name: "Owner", kind: "relation", content: false },
    {
      key: "pkg",
      name: "Package",
      kind: "relation",
      many: true,
      "target-types": ["item", "nope"],
      content: false,
    },
  ],
  relations: [
    { key: "derives", name: "Derives", "source-types": ["req"], "target-types": ["item"] },
    { key: "blocks", name: "Blocks", "source-types": [], "target-types": ["item"] },
  ],
});

describe("metamodelGraph", () => {
  it("[SR-130/AK-s795] makes each type a node with its properties, the inherited ones marked, a name or the key", () => {
    const [item, req, sub, orphan] = metamodelGraph(BASE).nodes;
    expect(item).toMatchObject({ key: "type:item", any: false, name: "ITEM", prefix: "IT", abstract: true });
    expect(req?.properties).toEqual([
      { key: "title", name: "Title", inherited: true },
      { key: "owner", name: "Owner", inherited: true },
      { key: "pkg", name: "Package", inherited: false },
      { key: "note", name: "note", inherited: false },
    ]);
    expect(sub?.properties.map((property) => property.inherited)).toEqual([true, true, true, true]);
    expect(orphan?.properties).toEqual([{ key: "title", name: "Title", inherited: false }]);
  });

  it("[SR-130/AK-s795] draws inheritance, kinds and own relation properties as one edge per pair, without Any type when no side is open", () => {
    expect(edges(BASE)).toEqual([
      "type:req > type:item: extends | Derives | Package",
      "type:sub > type:req: extends",
      "type:item > any: Owner · any target",
    ]);
    expect(metamodelGraph(BASE).nodes.map((node) => node.key)).toContain(ANY_KEY);
    const closed = output({ ...BASE, properties: [], relations: BASE.relations });
    expect(metamodelGraph(closed).nodes.map((node) => node.key)).not.toContain(ANY_KEY);
  });

  it("[SR-130/AK-j585] adds Any type for a side a kind leaves open, a loop when both are", () => {
    const open = output({
      types: [type("item", [])],
      properties: [],
      relations: [
        { key: "from", name: "From", "target-types": ["item"] },
        { key: "to", name: "To", "source-types": ["item"] },
        { key: "any", name: "Any" },
      ],
    });
    expect(edges(open)).toEqual([
      "any > type:item: From · any source",
      "type:item > any: To · any target",
      "any > any: Any · any source and target",
    ]);
    expect(metamodelGraph(open).nodes.at(-1)).toEqual({
      key: ANY_KEY,
      any: true,
      name: "Any type",
      properties: [],
    });
  });
});

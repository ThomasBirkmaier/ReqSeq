import type { MetamodelGetOutput } from "@logreq/core";
import { describe, expect, it } from "vitest";
import type { CommandListing } from "../shared/protocol.js";
import { graphBuffer } from "./buffers.js";
import { graphInput } from "./graph.js";
import {
  DEPTH_KEYS,
  EVERYTHING,
  alsoChoices,
  depthChoices,
  graphFilterChoices,
  graphMeanings,
  hasFilter,
  onlyChoices,
} from "./graph-choices.js";

const graph = { ...graphBuffer("uuid-S1", "spec", "S1 Title S1"), selected: "spec:uuid-C1" };

/** The catalog as the bridge lists it: `trace.graph` with the meanings of its input, and another command. */
const CATALOG = [
  { name: "trace.chain", input: { type: "object", properties: {} } },
  {
    name: "trace.graph",
    input: {
      type: "object",
      properties: {
        meanings: { type: "array", items: { enum: ["derivation", "replacement", "exclusion", "reference"] } },
      },
    },
  },
] as unknown as readonly CommandListing[];

/** The relation kinds and properties of the standard model, as `metamodel.get` gives them. */
const METAMODEL = {
  relations: [
    { key: "refines", name: "Refines", meaning: "derivation" },
    { key: "derives-from", name: "Derives from", meaning: "derivation" },
    { key: "based-on", name: "Based on" },
  ],
  properties: [
    { key: "title", name: "Title", kind: "text" },
    { key: "packages", name: "Package", kind: "relation" },
  ],
} as unknown as Pick<MetamodelGetOutput, "relations" | "properties">;

const CHOICES = graphFilterChoices(graphMeanings(CATALOG), METAMODEL);

describe("Graph depth", () => {
  it("[SR-111/AK2] Graph depth offers the direct neighbours, 2 to 9 levels and the whole chain, and asks again at the chosen depth", () => {
    const entries = depthChoices({ ...graph, depth: 3 });
    expect(entries.map((entry) => entry.name)).toEqual([
      "Direct neighbours",
      "2 levels",
      "3 levels",
      "4 levels",
      "5 levels",
      "6 levels",
      "7 levels",
      "8 levels",
      "9 levels",
      "Whole chain",
    ]);
    // The current depth has the keys that go one level more or less from it as hint.
    expect(entries.map((entry) => entry.hint)).toEqual([
      undefined,
      undefined,
      DEPTH_KEYS,
      ...Array<undefined>(7).fill(undefined),
    ]);
    expect(DEPTH_KEYS).toBe("+ / -");
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
    // Each entry is the graph at its depth, with its filter and selected node: trace.graph is asked again.
    const filtered = { ...graph, kinds: ["based-on"] };
    expect(depthChoices(filtered).map((entry) => graphInput(entry.buffer))).toEqual([
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((maxDepth) => ({
        ref: "uuid-S1",
        repository: "spec",
        maxDepth,
        kinds: ["based-on"],
        limit: 500,
      })),
      { ref: "uuid-S1", repository: "spec", allLevels: true, kinds: ["based-on"], limit: 500 },
    ]);
    expect(depthChoices(filtered).every((entry) => entry.buffer.selected === "spec:uuid-C1")).toBe(true);
    expect(depthChoices({ ...graph, depth: "all" }).at(-1)?.hint).toBe(DEPTH_KEYS);
  });
});

describe("Show only relation kind", () => {
  it("[SR-111/AK3] Show only relation kind offers everything, the meanings of trace.graph and every relation kind and relation property by its name, and replaces the filter", () => {
    expect(graphMeanings(CATALOG)).toEqual(["derivation", "replacement", "exclusion", "reference"]);
    expect(CHOICES).toEqual([
      { name: "Everything", filter: {} },
      { name: "Derivations", filter: { meanings: ["derivation"] } },
      { name: "Replacements", filter: { meanings: ["replacement"] } },
      { name: "Exclusions", filter: { meanings: ["exclusion"] } },
      { name: "Inline references", filter: { meanings: ["reference"] } },
      { name: "Refines", hint: "refines", filter: { kinds: ["refines"] }, meaning: "derivation" },
      {
        name: "Derives from",
        hint: "derives-from",
        filter: { kinds: ["derives-from"] },
        meaning: "derivation",
      },
      { name: "Based on", hint: "based-on", filter: { kinds: ["based-on"] } },
      { name: "Package", hint: "packages", filter: { kinds: ["packages"] } },
    ]);
    expect(CHOICES[0]).toBe(EVERYTHING);
    // A meaning the app has no name for is shown as it is; no trace.graph in the catalog, no meanings.
    expect(graphFilterChoices(["evidence"], { relations: [], properties: [] })).toEqual([
      EVERYTHING,
      { name: "evidence", filter: { meanings: ["evidence"] } },
    ]);
    expect(graphMeanings([])).toEqual([]);
    expect(graphMeanings([{ name: "trace.graph", input: {} }] as unknown as CommandListing[])).toEqual([]);

    // Taking one replaces the filter; the depth, view and selected node stay.
    const held = {
      ...graph,
      depth: 2,
      view: "baseline",
      kinds: ["based-on"],
      meanings: ["reference" as const],
    };
    const entries = onlyChoices(held, CHOICES);
    expect(entries.map((entry) => [entry.name, entry.hint])).toEqual(
      CHOICES.map((choice) => [choice.name, choice.hint]),
    );
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
    expect(entries.map((entry) => graphInput(entry.buffer))).toEqual(
      CHOICES.map((choice) => ({
        ref: "uuid-S1",
        repository: "spec",
        maxDepth: 2,
        ...choice.filter,
        view: "baseline",
        limit: 500,
      })),
    );
    const [everything, derivations] = entries;
    expect(everything?.buffer).toEqual({ ...graph, depth: 2, view: "baseline" });
    expect(derivations?.buffer).toEqual({ ...graph, depth: 2, view: "baseline", meanings: ["derivation"] });
    expect(hasFilter(graph)).toBe(false);
    expect(entries.map((entry) => hasFilter(entry.buffer))).toEqual([
      false,
      ...Array<boolean>(CHOICES.length - 1).fill(true),
    ]);
  });
});

describe("Also show relation kind", () => {
  it("[SR-111/AK3] Also show relation kind adds a kind to the filter, without the ones it has, and is offered only while a filter is set", () => {
    // No filter: everything is followed, so there is nothing to add.
    expect(alsoChoices(graph, CHOICES)).toEqual([]);
    const derivations = { ...graph, meanings: ["derivation" as const] };
    const entries = alsoChoices(derivations, CHOICES);
    // The relation kinds that derive are followed already: "Refines" and "Derives from" are not offered.
    expect(entries.map((entry) => entry.name)).toEqual([
      "Replacements",
      "Exclusions",
      "Inline references",
      "Based on",
      "Package",
    ]);
    expect(entries.find((entry) => entry.name === "Based on")?.buffer).toEqual({
      ...derivations,
      kinds: ["based-on"],
    });
    expect(entries.find((entry) => entry.name === "Inline references")?.buffer).toEqual({
      ...graph,
      meanings: ["derivation", "reference"],
    });
    // Twice: the kinds and meanings held are left out, and the next one is added to them.
    const both = { ...derivations, kinds: ["based-on"] };
    const next = alsoChoices(both, CHOICES);
    expect(next.map((entry) => entry.name)).toEqual([
      "Replacements",
      "Exclusions",
      "Inline references",
      "Package",
    ]);
    expect(graphInput(next.find((entry) => entry.name === "Package")?.buffer ?? graph)).toEqual({
      ref: "uuid-S1",
      repository: "spec",
      maxDepth: 1,
      kinds: ["based-on", "packages"],
      meanings: ["derivation"],
      limit: 500,
    });
    // Everything followed one by one: nothing is left to add.
    const all = {
      ...graph,
      meanings: ["derivation", "replacement", "exclusion", "reference"] as const,
      kinds: ["based-on", "packages"],
    };
    expect(alsoChoices({ ...all, meanings: [...all.meanings] }, CHOICES)).toEqual([]);
    // An empty filter follows nothing: everything but "Everything" can be added.
    expect(alsoChoices({ ...graph, kinds: [] }, CHOICES).map((entry) => entry.name)).toEqual(
      CHOICES.slice(1).map((choice) => choice.name),
    );
  });

  it("[SR-111/AK3] Also show relation kind leaves out a relation kind whose meaning the filter follows, since it would change nothing", () => {
    // A held relation kind does not hide its meaning: "Derivations" is offered, and so is "Refines".
    const derives = { ...graph, kinds: ["derives-from"] };
    const entries = alsoChoices(derives, CHOICES);
    expect(entries.map((entry) => entry.name)).toEqual([
      "Derivations",
      "Replacements",
      "Exclusions",
      "Inline references",
      "Refines",
      "Based on",
      "Package",
    ]);
    // Once "Derivations" is added, every relation kind that derives is followed and no longer offered.
    const derivations = entries.find((entry) => entry.name === "Derivations")?.buffer ?? graph;
    expect(derivations).toEqual({ ...graph, kinds: ["derives-from"], meanings: ["derivation"] });
    expect(alsoChoices(derivations, CHOICES).map((entry) => entry.name)).toEqual([
      "Replacements",
      "Exclusions",
      "Inline references",
      "Based on",
      "Package",
    ]);
  });
});

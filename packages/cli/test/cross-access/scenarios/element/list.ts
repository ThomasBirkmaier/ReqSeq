// Cross-access scenarios of element.list, in addition to the default one (cross-access.test.ts).
import type { FixtureOptions } from "@reqseq/testkit";
import { expect } from "vitest";
import type { Result } from "../../scenario.js";
import { scenariosOf } from "../../scenario.js";
import { EMERGENT, FILTER, SAVED, VARIANT_VIEWS } from "../../fixtures.js";

/**
 * SR-069/filter with a topic shared by a single value and a list, so that a value of a list property selects
 * its element (SR-132 AK2).
 */
const VALUES: FixtureOptions = {
  fixture: "SR-069/filter",
  git: true,
  files: {
    "requirements/SR-0000000000b6.md": `---\nid: 69069069-0000-4000-8000-0000000000b6\ntype: system-requirement\nstatus: draft\ntitle: Measure the rain\nrequirement-type: functional\nacceptance-criteria: [Given rain, then it holds.]\ntopic: Timing\n---\n`,
    "requirements/SR-0000000000b7.md": `---\nid: 69069069-0000-4000-8000-0000000000b7\ntype: system-requirement\nstatus: approved\ntitle: Measure the hail\nrequirement-type: functional\nacceptance-criteria: [Given hail, then it holds.]\ntopic: [Wind, Timing]\n---\n`,
  },
};
/** The list of the app (#418): by type, then by ID. */
const TYPE_AND_ID = [
  { by: "type", order: "asc" },
  { by: "identifier", order: "asc" },
];
/** Derivations with a diamond, choices, numbers and titles to sort by (SR-075). */
const SORT: FixtureOptions = { fixture: "SR-075/sort", git: true };
/** Packages P1 and P2; R1 in both, R2 in P1, R3 in none (SR-048, SR-049). */
const PACKAGES: FixtureOptions = { fixture: "SR-048/packages", git: true };
/** Identifiers in natural order, a lower-case one and elements without one (#418). */
const NATURAL: FixtureOptions = { fixture: "enabler-418/natural", git: true };

scenariosOf("element.list", [
  {
    tag: "[SR-041/AK1]",
    name: "the view of A lists A1 instead of K1",
    fixture: VARIANT_VIEWS,
    input: { selection: { view: "VAR-0000c1" } },
    expect: "output",
    check: (results) => {
      const output = (results["core"]?.outcome as { output: { elements: { shortId: string }[] } }).output;
      const shown = output.elements.map((e) => e.shortId);
      expect([shown.includes("SR-0000b1"), shown.includes("SR-0000a1")]).toEqual([true, false]);
    },
  },
  {
    tag: "[SR-043/AK1]",
    name: "the view of A holds K3, K4, A1 and A2 of the requirements",
    fixture: VARIANT_VIEWS,
    input: { selection: { view: "VAR-0000c1", where: { type: ["system-requirement"] } } },
    expect: "output",
    check: (results) => {
      const output = (results["core"]?.outcome as { output: { elements: { shortId: string }[] } }).output;
      expect(output.elements.map((e) => e.shortId)).toEqual([
        "SR-0000a3",
        "SR-0000a4",
        "SR-0000b1",
        "SR-0000b2",
      ]);
    },
  },
  {
    name: "requirements without child, combined, one page with text (SR-069 AK1 to AK3)",
    fixture: FILTER,
    input: {
      selection: {
        where: {
          all: [
            { type: ["system-requirement"] },
            { not: { status: ["obsolete"] } },
            { relation: { meaning: "derivation", direction: "down" }, exists: false },
          ],
        },
      },
      offset: 1,
      limit: 2,
      withText: true,
    },
    expect: "output",
  },
  {
    name: "a package, a filter on a property and a variant at once (SR-101 AK2)",
    fixture: FILTER,
    input: {
      selection: {
        package: "PKG-0000d1",
        view: "VAR-0000c1",
        where: {
          any: [{ property: "requirement-type", op: "eq", value: "Performance" }, { status: ["approved"] }],
        },
      },
    },
    expect: "output",
  },
  ...[
    { pkg: "PKG-0000d1", members: ["SR-0000b1", "SR-0000b2"] },
    { pkg: "PKG-0000d2", members: ["SR-0000b1"] },
  ].map(({ pkg, members }) => ({
    name: `a requirement in P1 and P2 appears in both: the elements of ${pkg}`,
    tag: "[SR-049/AK1]",
    fixture: PACKAGES,
    input: { selection: { package: pkg } },
    expect: "output" as const,
    check: (results: Readonly<Record<string, Result>>) => {
      const output = (results["core"]?.outcome as { output: { elements: { shortId: string }[] } }).output;
      expect(output.elements.map((e) => e.shortId)).toEqual(members);
    },
  })),
  {
    name: "the condition emergent (SR-035)",
    fixture: EMERGENT,
    input: { selection: { where: { all: [{ emergent: true }, { verification: ["open"] }] } } },
    expect: "output",
  },
  {
    name: "the elements with a topic, one item of a list included, as the app lists them (SR-132)",
    tag: "[SR-132/AK2]",
    fixture: VALUES,
    input: { selection: { where: { property: "topic", op: "eq", value: "Timing" } }, sort: TYPE_AND_ID },
    expect: "output",
  },
  {
    name: "the elements with a status as the condition property equals value (SR-132)",
    tag: "[SR-132/AK2]",
    fixture: VALUES,
    input: { selection: { where: { property: "status", op: "eq", value: "approved" } }, sort: TYPE_AND_ID },
    expect: "output",
  },
  {
    name: "the elements with the same package as target (SR-132)",
    tag: "[SR-132/AK3]",
    fixture: VALUES,
    input: {
      selection: { where: { property: "packages", op: "eq", value: "PKG-0000d1" } },
      sort: TYPE_AND_ID,
    },
    expect: "output",
  },
  {
    name: "short IDs in any case (SR-101 AK3)",
    fixture: FILTER,
    input: { selection: { ids: ["SR-0000b3", "sr-0000B1"] } },
    expect: "output",
  },
  {
    name: "sorted by a choice and then by a number descending, one page (SR-075 AK1)",
    fixture: SORT,
    input: { sort: [{ by: "requirement-type" }, { by: "priority", order: "desc" }], offset: 1, limit: 5 },
    expect: "output",
  },
  {
    name: "sorted by type and then by identifier, digit runs as numbers (SR-075 AK1)",
    fixture: NATURAL,
    input: { sort: [{ by: "type" }, { by: "identifier" }], limit: 100 },
    expect: "output",
  },
  {
    name: "the derivation tree with its places, siblings by title, one page (SR-075 AK2)",
    fixture: SORT,
    input: { sort: [{ by: "hierarchy" }, { by: "title" }], offset: 2, limit: 5 },
    expect: "output",
  },
  {
    name: "hierarchy after another sort key (SR-075)",
    fixture: SORT,
    input: { sort: [{ by: "title" }, { by: "hierarchy" }] },
    expect: "error",
  },
  {
    name: "a saved filter by name, in any case, with its sort (SR-070 AK3)",
    fixture: SAVED,
    input: { selection: { filter: "sensor DRAFTS" } },
    expect: "output",
  },
  {
    name: "a saved filter with its view, and another part of the selection (SR-070 AK3, SR-101 AK2)",
    fixture: SAVED,
    input: { selection: { filter: "Mountain", where: { status: ["approved"] } }, sort: [{ by: "id" }] },
    expect: "output",
  },
  {
    name: "a saved filter that is not there (SR-070)",
    fixture: SAVED,
    input: { selection: { filter: "Nope" } },
    expect: "error",
  },
  {
    name: "a saved filter in a faulty file (SR-070)",
    fixture: SAVED,
    input: { selection: { filter: "broken" } },
    expect: "error",
  },
  {
    name: "the condition text: what the full-text search finds, with a typo (SR-068)",
    fixture: FILTER,
    input: { selection: { where: { all: [{ text: "Mesure" }, { not: { type: ["need"] } }] } } },
    expect: "output",
  },
  {
    name: "a regular expression that is none",
    fixture: FILTER,
    input: { selection: { where: { property: "title", op: "matches", value: "(" } } },
    expect: "error",
  },
]);

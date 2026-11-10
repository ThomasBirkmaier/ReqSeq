// Cross-access scenarios of element.list, in addition to the default one (cross-access.test.ts).
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FixtureOptions } from "@reqseq/testkit";
import { expect } from "vitest";
import type { Result } from "../../scenario.js";
import { scenariosOf } from "../../scenario.js";
import { EMERGENT, EXPORT, FILTER, SAVED, VARIANT_VIEWS } from "../../fixtures.js";

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
/** The list of the app (ThomasBirkmaier/ReqSeq-archive#418): by type, then by ID. */
const TYPE_AND_ID = [
  { by: "type", order: "asc" },
  { by: "identifier", order: "asc" },
];
/** Derivations with a diamond, choices, numbers and titles to sort by (SR-075). */
const SORT: FixtureOptions = { fixture: "SR-075/sort", git: true };
/** Packages P1 and P2; R1 in both, R2 in P1, R3 in none (SR-048, SR-049). */
const PACKAGES: FixtureOptions = { fixture: "SR-048/packages", git: true };
/** Identifiers in natural order, a lower-case one and elements without one (ThomasBirkmaier/ReqSeq-archive#418). */
const NATURAL: FixtureOptions = { fixture: "enabler-418/natural", git: true };

/**
 * Packages d2 "alarms" and d1 "Wind"; b1 in both, b2 in d1, b4 in d2, b3 only in a package not in the
 * workspace; a choice property `area` with a list, b2 writing the choice by its display name (SR-149).
 */
const GROUP: FixtureOptions = { fixture: "SR-149/group", git: true };
const GROUP_FOLDER = fileURLToPath(new URL("../../../../../../fixtures/SR-149/group/", import.meta.url));
/** The files of fixtures/SR-149/group by path with `/`, as the copies hold them. */
const groupFiles = (): Record<string, string> =>
  Object.fromEntries(
    readdirSync(GROUP_FOLDER, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const file = path.join(entry.parentPath, entry.name);
        return [path.relative(GROUP_FOLDER, file).split(path.sep).join("/"), readFileSync(file, "utf8")];
      }),
  );
/** A grouped list as far as the checks of the SR-149 scenarios read it. */
interface Grouped {
  readonly elements: readonly { readonly shortId: string }[];
  readonly groups: readonly {
    readonly value?: string | number | boolean;
    readonly count: number;
    readonly offset: number;
  }[];
  readonly rows: number;
  readonly total: number;
}
const grouped = (results: Readonly<Record<string, Result>>): Grouped =>
  (results["core"]?.outcome as { output: Grouped }).output;
/** The groups as `value: short IDs` lines, `-` for the last group. */
const groupLines = ({ elements, groups }: Grouped): string[] =>
  groups.map(
    ({ value, count, offset }) =>
      `${value === undefined ? "-" : String(value)}: ${elements
        .slice(offset, offset + count)
        .map((e) => e.shortId)
        .join(" ")}`,
  );
const BY_TITLE = [{ by: "title", order: "asc" }];

scenariosOf("element.list", [
  {
    name: "a selection by baseline: the elements it lists, as they are now (SR-101, #1353)",
    fixture: EXPORT,
    root: "system",
    input: { selection: { baseline: "Release 1" } },
    expect: "output",
    check: (results) => {
      const { elements } = (
        results["core"]?.outcome as { output: { elements: readonly { shortId: string }[] } }
      ).output;
      expect(elements.map((e) => e.shortId)).toEqual(["N-0000a1", "SR-0000b1", "SR-0000b3"]);
    },
  },
  {
    name: "with the verification of the rows: status and progress ring as the graph's nodes (SR-137)",
    fixture: { fixture: "SR-136/graph", git: true },
    input: { withVerification: true },
    expect: "output",
  },
  {
    tag: "[SR-149/AK1]",
    name: "grouped by status: the statuses in metamodel order with their counts",
    fixture: GROUP,
    input: { group: "status", sort: BY_TITLE },
    expect: "output",
    check: (results) => {
      expect(groupLines(grouped(results))).toEqual([
        "draft: SR-0000b3 SR-0000b1",
        "approved: PKG-0000d2 N-0000a1 SR-0000b2 PKG-0000d1",
        "obsolete: SR-0000b4",
      ]);
    },
  },
  {
    tag: "[SR-149/AK1]",
    name: "grouped by a choice property: the choices in metamodel order, the elements without a value last",
    fixture: GROUP,
    input: { group: "requirement-type", sort: BY_TITLE },
    expect: "output",
    check: (results) => {
      const output = grouped(results);
      expect(output.groups.map((g) => [g.value, g.count])).toEqual([
        ["functional", 1],
        ["quality", 1],
        ["performance", 1],
        ["custom", 1],
        [undefined, 3],
      ]);
    },
  },
  {
    tag: "[SR-149/AK2]",
    name: "grouped by package and by a list property: an element with several values in each of their groups",
    fixture: GROUP,
    input: { group: "package", sort: BY_TITLE },
    expect: "output",
    check: (results) => {
      const output = grouped(results);
      expect(groupLines(output)).toEqual([
        "PKG-0000d2: SR-0000b4 SR-0000b1",
        "PKG-0000d1: SR-0000b1 SR-0000b2",
        "-: PKG-0000d2 SR-0000b3 N-0000a1 PKG-0000d1",
      ]);
      expect([output.rows, output.total]).toEqual([8, 7]);
    },
  },
  {
    tag: "[SR-149/AK2]",
    name: "grouped by a choice property with a list: SR-0000b1 in sensor and display",
    fixture: GROUP,
    input: { group: "area", sort: BY_TITLE },
    expect: "output",
    check: (results) => {
      expect(groupLines(grouped(results)).slice(0, 2)).toEqual([
        "sensor: SR-0000b1",
        "display: SR-0000b4 SR-0000b1 SR-0000b2",
      ]);
    },
  },
  {
    tag: "[SR-149/AK1]",
    name: "grouped by topic, a text property with shared values as element.facets offers it, the elements without a topic last",
    fixture: VALUES,
    input: {
      group: "topic",
      selection: { where: { type: ["system-requirement"], subtypes: false } },
      sort: BY_TITLE,
    },
    expect: "output",
    check: (results) => {
      expect(groupLines(grouped(results))).toEqual([
        "Timing: SR-0000b2 SR-0000b7 SR-0000b6",
        "Wind: SR-0000b7 SR-0000b1",
        "-: SR-0000b5 SR-0000b4 SR-0000b3",
      ]);
    },
  },
  ...["area", "type"].map((group) => ({
    tag: "[SR-149/AK3]",
    name: `regrouped by ${group} with the same filter and sort: the same elements, in the sort order in each group`,
    fixture: GROUP,
    input: {
      selection: { where: { type: ["system-requirement", "need"] } },
      sort: [
        { by: "status", order: "asc" },
        { by: "title", order: "desc" },
      ],
      group,
    },
    expect: "output" as const,
    check: (results: Readonly<Record<string, Result>>) => {
      // The order of the same list without grouping (cross-checked in core, group.test.ts).
      const plain = ["SR-0000b1", "SR-0000b3", "SR-0000b2", "N-0000a1", "SR-0000b4"];
      const { elements, groups } = grouped(results);
      const ids = elements.map((e) => e.shortId);
      expect(new Set(ids)).toEqual(new Set(plain));
      for (const { offset, count } of groups) {
        const members = ids.slice(offset, offset + count);
        expect(members).toEqual(plain.filter((id) => members.includes(id)));
      }
    },
  })),
  {
    tag: "[SR-149/AK5]",
    name: "grouping, with the texts and as trees per group, changes no file of the fixture",
    fixture: GROUP,
    input: { group: "package", sort: [{ by: "hierarchy", order: "asc" }], withText: true },
    expect: "output",
    check: (results) => {
      const fixture = groupFiles();
      for (const result of Object.values(results)) {
        const elementFiles = Object.keys(result.files).filter((file) => /\.(md|yaml)$/.test(file));
        expect(elementFiles.toSorted()).toEqual(Object.keys(fixture).toSorted());
        for (const [file, text] of Object.entries(fixture)) {
          expect(result.files[file]?.replaceAll("\r\n", "\n")).toBe(text.replaceAll("\r\n", "\n"));
        }
      }
    },
  },
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
    name: "only the fields asked for, in partial (#982)",
    fixture: FILTER,
    input: {
      selection: { where: { type: ["system-requirement"] } },
      fields: ["title", "status", "relations"],
    },
    expect: "output",
  },
  {
    name: "only the type of each element of a grouped tree, with its text (#982)",
    fixture: GROUP,
    input: { group: "status", sort: [{ by: "hierarchy", order: "asc" }], fields: ["type"], withText: true },
    expect: "output",
  },
  {
    name: "a regular expression that is none",
    fixture: FILTER,
    input: { selection: { where: { property: "title", op: "matches", value: "(" } } },
    expect: "error",
  },
]);

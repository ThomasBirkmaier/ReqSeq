// Cross-access scenarios of trace.matrix, in addition to the default one (cross-access.test.ts).
import type { FixtureOptions } from "@reqseq/testkit";
import { scenariosOf } from "../../scenario.js";
import { MATRIX_EVIDENCE, STATUS } from "../../fixtures.js";

/** Needs, a decision, packages and system requirements with current, outdated and missing relations (SR-125). */
const MATRIX: FixtureOptions = { fixture: "SR-125/matrix", git: true };
const MX = "5e125a7d-2b4f-4c61-9d08-";

scenariosOf("trace.matrix", [
  {
    tag: "[SR-125/AK6]",
    name: "a package gives the same rows, columns and cells",
    fixture: MATRIX,
    input: { selection: { package: "PKG-000001" } },
    expect: "output",
  },
  {
    tag: "[SR-125/AK6]",
    name: "a saved filter with its own sort",
    fixture: MATRIX,
    input: { selection: { filter: "Stage SRs" } },
    expect: "output",
  },
  {
    tag: "[SR-125/AK6]",
    name: "a list of IDs, the sort of the app's list",
    fixture: MATRIX,
    input: {
      selection: { ids: [`${MX}0b0000000005`, `${MX}0b0000000001`, `${MX}0a0000000001`] },
      sort: [
        { by: "type", order: "asc" },
        { by: "identifier", order: "asc" },
      ],
    },
    expect: "output",
  },
  {
    tag: "[SR-125/AK6]",
    name: "the derivation tree, one page, with the properties named",
    fixture: MATRIX,
    input: {
      selection: { package: "PKG-000001" },
      sort: [{ by: "hierarchy" }],
      kinds: ["packages", "derives-from"],
      limit: 2,
      offset: 1,
    },
    expect: "output",
  },
  {
    name: "relations seen through the core view (SR-125 AK3)",
    fixture: MATRIX,
    input: { selection: { package: "PKG-000001", view: "core" } },
    expect: "output",
  },
  {
    name: "the matrix of a selection with evidence (SR-126)",
    fixture: MATRIX_EVIDENCE,
    input: { selection: { where: { type: ["system-requirement"] } } },
    expect: "output",
  },
  {
    name: "one page of the matrix of a selection with evidence (SR-126)",
    fixture: MATRIX_EVIDENCE,
    input: { selection: { where: { type: ["system-requirement"] } }, limit: 3, offset: 2 },
    expect: "output",
  },
  {
    name: "the matrix in a variant view names its variant (SR-126, #588)",
    fixture: STATUS,
    input: { selection: { view: "5e031a7d-2b4f-4c61-9d08-0c0000000001" } },
    expect: "output",
  },
  {
    name: "a key that is no relation kind",
    fixture: MATRIX,
    input: { selection: { package: "PKG-000001" }, kinds: ["nope"] },
    expect: "error",
  },
  {
    name: "an unknown saved filter",
    fixture: MATRIX,
    input: { selection: { filter: "no such filter" } },
    expect: "error",
  },
]);

// Cross-access scenarios of element.bulkUpdate, in addition to the default one (cross-access.test.ts).
import { scenariosOf } from "../../scenario.js";
import { FILTER, NESTED, NESTED_A } from "../../fixtures.js";

scenariosOf("element.bulkUpdate", [
  {
    name: "a package reference that names no element is refused, nothing is written (#287)",
    fixture: FILTER,
    input: { selection: {}, property: "packages", operation: "add", value: "PKG-999999", confirm: true },
    expect: "error",
  },
  {
    name: "an origin property is refused: only reqif.import writes it",
    fixture: FILTER,
    input: { selection: {}, property: "delivery", operation: "set", value: "1", confirm: true },
    tag: "[SR-057/AK3]",
    expect: "error",
  },
  {
    name: "a variant is not given validity entries: the preview names it, the confirmation is refused",
    fixture: NESTED,
    input: {
      selection: { ids: ["VAR-0000c3"] },
      property: "validity",
      operation: "add",
      value: { id: NESTED_A },
    },
    tag: "[SR-039/AK2]",
    expect: "output",
  },
  {
    name: "a confirmation that would give a variant validity entries is refused (variant.nested)",
    fixture: NESTED,
    input: {
      selection: { ids: ["VAR-0000c3"] },
      property: "validity",
      operation: "add",
      value: { id: NESTED_A },
      confirm: true,
    },
    tag: "[SR-039/AK2]",
    expect: "error",
  },
  {
    name: "a preview: the number of affected elements and the skipped ones, nothing written (SR-071 AK2, AK3)",
    fixture: FILTER,
    input: { selection: {}, property: "priority", operation: "set", value: 4 },
    expect: "output",
  },
  {
    name: "add a package to a selection, confirmed with the count of the preview (SR-071 AK1, AK2)",
    fixture: FILTER,
    input: {
      selection: { where: { type: ["system-requirement"] } },
      property: "packages",
      operation: "add",
      value: { id: "69069069-0000-4000-8000-0000000000d2" },
      confirm: true,
      expected: 5,
    },
    expect: "output",
  },
  {
    name: "remove a property from elements named by short ID",
    fixture: FILTER,
    input: {
      selection: { ids: ["SR-0000b1", "SR-0000b2"] },
      property: "topic",
      operation: "remove",
      confirm: true,
    },
    expect: "output",
  },
  {
    name: "a confirmation whose count no longer holds (a choice by its display name)",
    fixture: FILTER,
    input: {
      selection: { ids: ["SR-0000b1"] },
      property: "verification-method",
      operation: "set",
      value: "Analysis",
      confirm: true,
      expected: 3,
    },
    expect: "error",
  },
  {
    name: "the status is never a bulk change (D-030)",
    fixture: FILTER,
    input: { selection: {}, property: "status", operation: "set", value: "approved", confirm: true },
    expect: "error",
  },
]);

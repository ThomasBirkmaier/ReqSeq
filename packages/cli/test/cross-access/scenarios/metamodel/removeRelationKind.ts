// Cross-access scenarios of metamodel.removeRelationKind, in addition to the default one
// (cross-access.test.ts). On SR-004/one-repository with a second metamodel file that has a relation
// kind no element file holds.
import type { FixtureOptions } from "@reqseq/testkit";
import { expect } from "vitest";
import { ONE_REPOSITORY } from "../../fixtures.js";
import { scenariosOf } from "../../scenario.js";

/** A relation kind no element file holds, and a perspective that names it. */
const UNUSED: FixtureOptions = {
  ...ONE_REPOSITORY,
  files: {
    "metamodel/zz-links.yaml":
      "reqseq-metamodel: 1\nrelations:\n  # Not used yet.\n  - { key: conflicts-with, name: Conflicts with }\n",
    "perspectives/conflicts.yaml":
      "reqseq-perspective: 1\nname: Conflicts\ncolumns: [title, conflicts-with]\n",
  },
};

/** The requirement's file holds the relation kind `refines` with an empty list, which is a use (SR-236 AK7). */
const EMPTY_LIST: FixtureOptions = {
  ...ONE_REPOSITORY,
  files: {
    "requirements/SR-6328cee88fb3.md":
      "---\nid: e8df96ea-a168-4d90-8d65-6328cee88fb3\ntype: system-requirement\nstatus: draft\ntitle: Show wind speed\nrefines: []\n---\n\nThe station shows the current wind speed.\n",
  },
};

scenariosOf("metamodel.removeRelationKind", [
  {
    name: "removes a relation kind no element file holds through every access (SR-239 AK3)",
    tag: "[SR-239/AK-qrb0]",
    fixture: UNUSED,
    input: { kind: "conflicts-with" },
    expect: "output",
    check: (results) => {
      for (const { changed, files } of Object.values(results)) {
        expect(changed).toEqual(["metamodel/zz-links.yaml"]);
        expect(files["metamodel/zz-links.yaml"]).toBe("reqseq-metamodel: 1\nrelations: []\n");
      }
    },
  },
  {
    name: "a relation kind an element file holds is refused with the same use through every access (SR-239 AK3)",
    tag: "[SR-239/AK-qrb0]",
    fixture: EMPTY_LIST,
    input: { kind: "refines" },
    expect: "error",
  },
  {
    name: "writes the same bytes and output, and names the same perspective, through every access (SR-236 AK12)",
    tag: "[SR-236/AK-rtcn]",
    fixture: UNUSED,
    input: { kind: "conflicts-with" },
    expect: "output",
  },
]);

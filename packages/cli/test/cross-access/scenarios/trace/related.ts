// Cross-access scenarios of trace.related, in addition to the default one (cross-access.test.ts).
import type { FixtureOptions } from "@reqseq/testkit";
import { scenariosOf } from "../../scenario.js";
import { MISSING_TARGETS } from "../../fixtures.js";

/** Needs, requirements and their derivations (SR-023), shared so the fixture is built once. */
const RELATED: FixtureOptions = { fixture: "SR-023/related", git: true };

scenariosOf("trace.related", [
  {
    name: "children of two parents up to a depth, one page (SR-023 AK1, AK2)",
    fixture: RELATED,
    input: { refs: ["N-0000a1", "N-0000a2"], direction: "children", maxDepth: 2, offset: 1, limit: 2 },
    expect: "output",
  },
  {
    name: "parents of a selection in the core view (SR-023 AK3)",
    fixture: RELATED,
    input: { refs: ["SR-0000b4", "SR-0000b5"], direction: "parents", view: "core" },
    expect: "output",
  },
  {
    name: "metamodel without the meaning derivation (SR-013 AK3)",
    fixture: MISSING_TARGETS,
    root: "system",
    input: { refs: ["9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"], direction: "parents" },
    expect: "error",
  },
  {
    name: "children while a repository is missing, incomplete (SR-006 AK2)",
    fixture: {
      fixture: "SR-023/related",
      git: true,
      files: {
        "reqseq-workspace.yaml":
          "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
          '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
          '  - { name: away, url: "git@git.example.com:ws/away.git", path: ../away }\n' +
          "metamodel: { repository: system, path: metamodel }\n",
      },
    },
    input: { refs: ["SR-0000b1"], direction: "children" },
    expect: "output",
  },
  {
    name: "unknown reference",
    fixture: RELATED,
    input: { refs: ["N-ffffff"], direction: "children" },
    expect: "error",
  },
]);

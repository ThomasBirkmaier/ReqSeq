// Cross-access scenarios of trace.chain, in addition to the default one (cross-access.test.ts).
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";
import { CHAIN, EVIDENCE, IDENTIFIERS, MISSING_TARGETS, ORPHANED_CHAIN, WITH_VAULT } from "../../fixtures.js";

scenariosOf("trace.chain", [
  {
    name: "the chain of a need named by its identifier, each node with its identifier (#305)",
    fixture: IDENTIFIERS,
    input: { ref: "N-001" },
    expect: "output",
  },
  {
    name: "a need down to its component requirements, with gaps (SR-022)",
    fixture: CHAIN,
    input: { ref: "N-00a001" },
    expect: "output",
  },
  {
    name: "up from a component requirement to a requirement without a parent, marked as a gap",
    fixture: ORPHANED_CHAIN,
    input: { ref: "CR-00c003", direction: "up" },
    tag: "[SR-022/AK5]",
    expect: "output",
    check: (results) => {
      const output = (results["core"]?.outcome as { output: { gaps: { id: string; kind: string }[] } })
        .output;
      expect(output.gaps).toEqual([
        { id: "5c0e1d2a-0022-4022-8022-00000000b004", repository: "system", kind: "no-parent" },
      ]);
    },
  },
  {
    name: "the chain of a requirement with an executed and a skipped test case and an inspection (SR-033)",
    fixture: EVIDENCE,
    input: { ref: "SR-e88fb3" },
    expect: "output",
  },
  {
    name: "one page of a chain up and down (SR-082 AK4, spec-frage #290)",
    fixture: CHAIN,
    input: { ref: "SR-00b001", limit: 2, offset: 1 },
    expect: "output",
  },
  {
    name: "up from a component requirement to depth 1, in the core view",
    fixture: CHAIN,
    input: { ref: "CR-00c002", direction: "up", maxDepth: 1, view: "core" },
    expect: "output",
  },
  {
    name: "a cycle and a parent in a repository that is not here (SR-022 AK4, SR-006)",
    fixture: {
      fixture: "SR-022/chain",
      git: true,
      files: {
        "reqseq-workspace.yaml": WITH_VAULT,
        "components/CR-00000000c001.md":
          "---\nid: 5c0e1d2a-0022-4022-8022-00000000c001\ntype: component-requirement\nstatus: draft\ntitle: Count anemometer turns\n" +
          "derives-from:\n" +
          "  - { id: 5c0e1d2a-0022-4022-8022-00000000b001, version: n1:0000000000000000 }\n" +
          "  - { id: 5c0e1d2a-0022-4022-8022-00000000c002, version: n1:0000000000000000 }\n" +
          "  - { id: 5c0e1d2a-0022-4022-8022-00000000f001, version: n1:0000000000000000, repository: vault }\n" +
          "---\n",
      },
    },
    input: { ref: "SR-00b001" },
    expect: "output",
  },
  {
    name: "no relation kind with the meaning derivation (SR-013 AK3)",
    fixture: MISSING_TARGETS,
    root: "system",
    input: { ref: "SR-c4d5e6" },
    expect: "error",
  },
  { name: "unknown reference", fixture: CHAIN, input: { ref: "SR-ffffff" }, expect: "error" },
  {
    name: "view of no variant",
    fixture: CHAIN,
    input: { ref: "N-00a001", view: "N-00a002" },
    expect: "error",
  },
]);

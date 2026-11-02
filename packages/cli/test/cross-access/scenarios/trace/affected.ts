// Cross-access scenarios of trace.affected, in addition to the default one (cross-access.test.ts).
import { scenariosOf } from "../../scenario.js";
import { AFFECTED, IN_CRITERIA, MISSING_TARGETS, WITH_VAULT } from "../../fixtures.js";

scenariosOf("trace.affected", [
  {
    name: "an element that an acceptance criterion references, with the criterion as the link (SR-127 AK3)",
    fixture: IN_CRITERIA,
    input: { ref: "N-0000a2" },
    expect: "output",
  },
  {
    name: "affected elements of a need, directly and through the chain (SR-024 AK1)",
    fixture: AFFECTED,
    input: { ref: "N-00a001" },
    expect: "output",
  },
  {
    name: "one page of the affected elements of a need",
    fixture: AFFECTED,
    input: { ref: "N-00a001", limit: 2, offset: 1 },
    expect: "output",
  },
  {
    name: "a relation that is no derivation, then the chain, and a repository that is not here (SR-006)",
    fixture: {
      ...AFFECTED,
      files: {
        "reqseq-workspace.yaml": WITH_VAULT,
      },
    },
    input: { ref: "D-00d001" },
    expect: "output",
  },
  {
    name: "no relation kind with the meaning derivation (SR-013 AK3)",
    fixture: MISSING_TARGETS,
    root: "system",
    input: { ref: "SR-c4d5e6" },
    expect: "error",
  },
  { name: "unknown reference", fixture: AFFECTED, input: { ref: "SR-ffffff" }, expect: "error" },
]);

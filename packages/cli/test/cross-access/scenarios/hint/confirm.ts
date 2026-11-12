// Cross-access scenarios of hint.confirm, in addition to the default one (cross-access.test.ts).
import { scenariosOf } from "../../scenario.js";
import { HINTS, IN_CRITERIA, SINCE_BASELINE } from "../../fixtures.js";

/** Where SR-0000b1 of HINTS stores its outdated relation and reference, as hint IDs name it (SR-025). */
const HINT_AT_B1 = `relation.outdated/system/${encodeURIComponent("requirements/SR-0000000000b1.md")}/26a0b000-0000-4000-8000-0000000000b1`;
/** Where SR-0000b1 stores the link in its first acceptance criterion, as hint IDs name it (SR-127). */
const CRITERION_HINT = `${HINT_AT_B1}/@text:acceptance-criteria/26a0b000-0000-4000-8000-0000000000a1?version=n1:0000000000000000&n=1`;

scenariosOf("hint.confirm", [
  {
    name: "an inline reference in an acceptance criterion, and the same ID spelled again (SR-127 AK3)",
    fixture: IN_CRITERIA,
    input: { hintIds: [CRITERION_HINT, CRITERION_HINT] },
    expect: "output",
  },
  {
    name: "a relation and an inline reference at once, and IDs that confirm nothing (SR-027 AK1, AK2)",
    fixture: HINTS,
    input: {
      hintIds: [
        `${HINT_AT_B1}/derives-from/26a0b000-0000-4000-8000-0000000000a1?version=n1:0000000000000000`,
        `${HINT_AT_B1}/@text/26a0b000-0000-4000-8000-0000000000a1?version=n1:0000000000000000&n=1`,
        `${HINT_AT_B1}/derives-from/26a0b000-0000-4000-8000-0000000000a1?version=n1:1111111111111111`,
        "element.unknown-property",
      ],
    },
    expect: "output",
  },
  { name: "hint IDs that are not a list", fixture: HINTS, input: { hintIds: "x" }, expect: "error" },
  {
    name: "every open hint that points at an element (ThomasBirkmaier/ReqSeq-archive#310)",
    fixture: HINTS,
    input: { target: "N-0000a1" },
    expect: "output",
  },
  {
    name: "the hints of one element of one kind, together with a given ID (ThomasBirkmaier/ReqSeq-archive#310)",
    fixture: HINTS,
    input: {
      ref: "SR-0000b1",
      kind: ["relation.outdated"],
      hintIds: [`${HINT_AT_B1}/@text/26a0b000-0000-4000-8000-0000000000a1?version=n1:0000000000000000&n=1`],
    },
    expect: "output",
  },
  {
    name: "an element without a hint to confirm: a warning (ThomasBirkmaier/ReqSeq-archive#310)",
    fixture: HINTS,
    input: { ref: "N-0000a1" },
    expect: "output",
  },
  {
    name: "kind without ref or target (ThomasBirkmaier/ReqSeq-archive#310)",
    fixture: HINTS,
    input: { kind: ["x"] },
    expect: "error",
  },
  {
    name: "every open hint of a kind in the workspace, as reviewed (#644)",
    fixture: HINTS,
    input: { all: true, kind: ["relation.outdated"], expected: 2 },
    expect: "output",
  },
  {
    name: "all with another number than expected: refused, nothing written (#644)",
    fixture: HINTS,
    input: { all: true, kind: ["relation.outdated"], expected: 99 },
    expect: "error",
  },
  { name: "all without kind (#644)", fixture: HINTS, input: { all: true, expected: 0 }, expect: "error" },
  {
    name: "all with ref (#644)",
    fixture: HINTS,
    input: { all: true, ref: "SR-0000b1", kind: ["relation.outdated"], expected: 0 },
    expect: "error",
  },
  {
    tag: "[SR-103/AK-q8d1]",
    name: "a since-baseline hint is refused: a new baseline settles it",
    fixture: SINCE_BASELINE,
    input: { ref: "VAR-0000c1", kind: ["variant.core-changed-since-baseline"] },
    expect: "output",
  },
]);

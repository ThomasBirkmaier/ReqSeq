// Cross-access scenarios of reqif.analyze, in addition to the default one (cross-access.test.ts).
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";
import { DELIVERY, PARTIAL_DELIVERY, REPEAT, REPEATED, coreOutput, imported } from "../../fixtures.js";

scenariosOf("reqif.analyze", [
  {
    tag: "[SR-055/AK1]",
    name: "a delivery without mapping: every type and relation type with its attributes is unmapped",
    fixture: DELIVERY,
    input: { file: "in/lieferung.reqif" },
    expect: "output",
  },
  {
    tag: "[SR-055/AK1]",
    name: "a delivery through a mapping that leaves entries unmapped: the list before any write",
    fixture: PARTIAL_DELIVERY,
    input: { file: "in/lieferung.reqif", mapping: "reqif/kunde-a.yaml" },
    expect: "output",
  },
  {
    name: "a delivery through its saved mapping: the objects the import would create and its losses",
    fixture: DELIVERY,
    input: { file: "in/lieferung.reqif", mapping: "reqif/kunde-a.yaml" },
    expect: "output",
  },
  {
    name: "a file that is no ReqIF is refused (reqif.invalid)",
    fixture: DELIVERY,
    input: { file: "reqif/kunde-a.yaml" },
    expect: "error",
  },
  {
    tag: "[SR-056/AK1]",
    name: "a repeated delivery: new, changed and dropped requirements and the conflicts, separately",
    fixture: REPEATED,
    input: { file: REPEAT.file, mapping: REPEAT.mapping },
    expect: "output",
    check: (results) => {
      const out = coreOutput(results) as {
        new: unknown;
        changed: unknown;
        dropped: unknown;
        conflicts: unknown;
      };
      expect([out.new, out.changed, out.dropped, out.conflicts]).toEqual([
        [{ identifier: "REQ-5" }],
        [
          { identifier: "REQ-1", id: imported(1) },
          { identifier: "REQ-3", id: imported(3) },
        ],
        [{ identifier: "REQ-4", id: imported(4) }],
        [{ identifier: "REQ-3", id: imported(3) }],
      ]);
    },
  },
]);

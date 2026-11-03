// A repeated ReqIF import in the performance suite (ADR-0011, SR-056, #577): a generated delivery of
// another tool (REQ-IF-TOOL-ID `other`, a YAML mapping) at the size of N-036, 50,000 SPEC-OBJECTs and
// 5,000 SPEC-RELATIONs, analysed and imported into an empty workspace, then a second delivery of the
// same source with every tenth object changed (title and text), analysed and imported again. Each step
// is recorded with time and memory. No SR names a time for the import; the 60 s of the plan are the
// expectation of #696 (a delivery of N-036 planned in well under a minute), so the rows are recorded,
// not asserted. Correctness is asserted as usual.
import { createFixtureWorkspace, measurePeakMemory, memoryIncrease, recordValue } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CommandName, CommandOutput } from "../../src/catalog.js";
import { getCommandRuntime, invoke } from "../../src/runtime/invoke.js";
import { Workspace } from "../../src/runtime/workspace.js";

const OBJECTS = 50_000;
/** One SPEC-RELATION per tenth object: object i satisfies object i - 1. */
const RELATION_EVERY = 10;
/** The second delivery changes every tenth object, 10 %. */
const CHANGED_EVERY = 10;
const CHANGED = OBJECTS / CHANGED_EVERY;
const PLAN_MS = 60_000;
/**
 * The first import took about 1,000 s on a 4-core container (#577), more than the suite's 600 s per
 * test; the time is recorded, so the test must not stop it.
 */
const IMPORT_TIMEOUT_MS = 1_800_000;
const BASIS_PLAN =
  "N-036, SR-056, #577: plan of a delivery of 50,000 objects (expectation of #696, not asserted)";
const BASIS_IMPORT =
  "N-036, SR-056, #577: import of a delivery of 50,000 objects (recorded, no limit in the spec)";

const MAPPING = `reqseq-reqif-mapping: 1
source: { name: Supplier, tool-id: other }
types:
  - { source: Customer Requirement, type: system-requirement }
attributes:
  - { source: ReqIF.Name, property: title }
  - { source: ReqIF.Text, property: text }
relations:
  - { source: satisfies, kind: derives-from }
`;

/** Delivery `n` (1 or 2) of the source; delivery 2 changes the title and text of every tenth object. */
const delivery = (n: 1 | 2): string => {
  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>\n<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    `<THE-HEADER><REQ-IF-HEADER IDENTIFIER="_hd-${String(n)}"><CREATION-TIME>2026-11-0${String(n)}T09:00:00Z</CREATION-TIME><REQ-IF-TOOL-ID>other</REQ-IF-TOOL-ID><REQ-IF-VERSION>1.0</REQ-IF-VERSION><SOURCE-TOOL-ID>other</SOURCE-TOOL-ID><TITLE>Delivery ${String(n)}</TITLE></REQ-IF-HEADER></THE-HEADER>`,
    '<CORE-CONTENT><REQ-IF-CONTENT><DATATYPES><DATATYPE-DEFINITION-STRING IDENTIFIER="dt-s" MAX-LENGTH="1000"/><DATATYPE-DEFINITION-XHTML IDENTIFIER="dt-x"/></DATATYPES>',
    '<SPEC-TYPES><SPEC-OBJECT-TYPE IDENTIFIER="ot" LONG-NAME="Customer Requirement"><SPEC-ATTRIBUTES>',
    '<ATTRIBUTE-DEFINITION-STRING IDENTIFIER="ad-name" LONG-NAME="ReqIF.Name"><TYPE><DATATYPE-DEFINITION-STRING-REF>dt-s</DATATYPE-DEFINITION-STRING-REF></TYPE></ATTRIBUTE-DEFINITION-STRING>',
    '<ATTRIBUTE-DEFINITION-XHTML IDENTIFIER="ad-text" LONG-NAME="ReqIF.Text"><TYPE><DATATYPE-DEFINITION-XHTML-REF>dt-x</DATATYPE-DEFINITION-XHTML-REF></TYPE></ATTRIBUTE-DEFINITION-XHTML>',
    '</SPEC-ATTRIBUTES></SPEC-OBJECT-TYPE><SPEC-RELATION-TYPE IDENTIFIER="rt" LONG-NAME="satisfies"/></SPEC-TYPES><SPEC-OBJECTS>',
  ];
  for (let i = 0; i < OBJECTS; i++) {
    const changed = n === 2 && i % CHANGED_EVERY === 0 ? " (changed)" : "";
    parts.push(
      `<SPEC-OBJECT IDENTIFIER="REQ-${String(i)}" LAST-CHANGE="2026-11-0${String(n)}T08:00:00Z"><VALUES>`,
      `<ATTRIBUTE-VALUE-STRING THE-VALUE="Measure the wind at station ${String(i)}${changed}"><DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>ad-name</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION></ATTRIBUTE-VALUE-STRING>`,
      `<ATTRIBUTE-VALUE-XHTML><DEFINITION><ATTRIBUTE-DEFINITION-XHTML-REF>ad-text</ATTRIBUTE-DEFINITION-XHTML-REF></DEFINITION><THE-VALUE><xhtml:div><xhtml:p>The station ${String(i)} <xhtml:strong>shall</xhtml:strong> measure the wind speed every second${changed}.</xhtml:p></xhtml:div></THE-VALUE></ATTRIBUTE-VALUE-XHTML>`,
      "</VALUES><TYPE><SPEC-OBJECT-TYPE-REF>ot</SPEC-OBJECT-TYPE-REF></TYPE></SPEC-OBJECT>\n",
    );
  }
  parts.push("</SPEC-OBJECTS><SPEC-RELATIONS>");
  for (let i = RELATION_EVERY; i < OBJECTS; i += RELATION_EVERY) {
    parts.push(
      `<SPEC-RELATION IDENTIFIER="r${String(i)}" LAST-CHANGE="2026-11-0${String(n)}T08:00:00Z"><SOURCE><SPEC-OBJECT-REF>REQ-${String(i)}</SPEC-OBJECT-REF></SOURCE><TARGET><SPEC-OBJECT-REF>REQ-${String(i - 1)}</SPEC-OBJECT-REF></TARGET><TYPE><SPEC-RELATION-TYPE-REF>rt</SPEC-RELATION-TYPE-REF></TYPE></SPEC-RELATION>\n`,
    );
  }
  parts.push("</SPEC-RELATIONS></REQ-IF-CONTENT></CORE-CONTENT></REQ-IF>\n");
  return parts.join("");
};

describe("repeated ReqIF import of 50,000 objects (SR-056, N-036)", () => {
  let fixture: FixtureWorkspace | undefined;
  let workspace: Workspace | undefined;

  beforeAll(async () => {
    fixture = await createFixtureWorkspace({
      fixture: "SR-004/one-repository",
      files: { "in/1.reqif": delivery(1), "in/2.reqif": delivery(2), "reqif/supplier.yaml": MAPPING },
    });
    workspace = new Workspace(fixture.root);
    getCommandRuntime();
  });

  afterAll(async () => {
    await workspace?.close();
    await fixture?.cleanup();
  });

  /** Runs `command` once and records its time and memory as `name`. */
  const step = async <C extends CommandName>(
    name: string,
    command: C,
    input: Record<string, unknown>,
    plan: boolean,
  ): Promise<CommandOutput<C>> => {
    const opened = workspace;
    if (opened === undefined) {
      throw new Error("no workspace");
    }
    const peak = await measurePeakMemory(
      async () => (await invoke(command, input, { workspace: opened })) as CommandOutput<C>,
    );
    const options = plan ? { basis: BASIS_PLAN, thresholdMs: PLAN_MS } : { basis: BASIS_IMPORT };
    await recordValue(name, peak.ms, options);
    await recordValue(`${name}: ${memoryIncrease(peak)}`, 0, { basis: options.basis });
    return peak.result;
  };

  const analyze = (n: 1 | 2): Record<string, unknown> => ({
    file: `in/${String(n)}.reqif`,
    mapping: "reqif/supplier.yaml",
  });
  const load = (n: 1 | 2): Record<string, unknown> => ({ ...analyze(n), delivery: `D${String(n)}` });

  // One step per test, in order: each builds on the workspace the one before left.
  it("analyses the first delivery against an empty workspace", async () => {
    const plan = await step(
      `reqif.analyze: first delivery of ${String(OBJECTS)} objects of another tool`,
      "reqif.analyze",
      analyze(1),
      true,
    );
    expect([plan.new.length, plan.changed.length]).toEqual([OBJECTS, 0]);
  });

  it(
    "imports the first delivery",
    async () => {
      const imported = await step(
        `reqif.import: first delivery of ${String(OBJECTS)} objects of another tool`,
        "reqif.import",
        load(1),
        false,
      );
      expect(imported.created).toHaveLength(OBJECTS);
    },
    IMPORT_TIMEOUT_MS,
  );

  it("analyses a second delivery with 10 % of the objects changed", async () => {
    const plan = await step(
      `reqif.analyze: second delivery of ${String(OBJECTS)} objects, ${String(CHANGED)} changed`,
      "reqif.analyze",
      analyze(2),
      true,
    );
    expect([plan.new.length, plan.changed.length, plan.dropped.length, plan.conflicts.length]).toEqual([
      0,
      CHANGED,
      0,
      0,
    ]);
  });

  it(
    "imports the second delivery",
    async () => {
      const imported = await step(
        `reqif.import: second delivery of ${String(OBJECTS)} objects, ${String(CHANGED)} changed`,
        "reqif.import",
        load(2),
        false,
      );
      expect([imported.created.length, imported.updated.length]).toEqual([0, CHANGED]);
    },
    IMPORT_TIMEOUT_MS,
  );
});

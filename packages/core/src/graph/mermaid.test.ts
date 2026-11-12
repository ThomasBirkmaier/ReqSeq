// trace.mermaid and metamodel.mermaid through `invoke` (SR-151): the text of the element graph on
// fixtures/SR-111/graph and fixtures/SR-136/graph (AK1, AK6), the metamodel graph on
// fixtures/SR-130/metamodel (AK2), and the escaping of the labels.
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandName } from "../catalog.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { edgeText, elementMermaid, nodeText } from "./mermaid.js";

const run = async (
  name: CommandName,
  fixture: string,
  input: object,
  options: FixtureOptions = {},
): Promise<Record<string, unknown>> => {
  const copy = await createFixtureWorkspace({ fixture, ...options });
  onTestFinished(() => copy.cleanup());
  const workspace = new Workspace(copy.root);
  onTestFinished(() => workspace.close());
  return (await invoke(name, input, { workspace })) as Record<string, unknown>;
};

/** S1 of fixtures/SR-111/graph (see `commands/trace/graph.test.ts`). */
const S1 = "5e111a7d-2b4f-4c61-9d08-0b0000000001";

const NODES_S1 = [
  "flowchart BT",
  '  n0["SR-b0000000001 · System Requirement<br/>Show wind speed<br/>outdated verification failed"]',
  '  n1["N-a0000000001 · Need<br/>See the wind<br/>verification 0 %"]',
  '  n2["D-d0000000001 · Decision<br/>Use a cup anemometer"]',
];

describe("trace.mermaid", () => {
  it("[SR-151/AK1] writes each node with ID, type, title, marks and verification, each link as an edge from source to target with its kind and outdated, the element framed, bottom to top, no evidence", async () => {
    const out = await run("trace.mermaid", "SR-111/graph", { ref: S1 });
    expect({ ...out, mermaid: typeof out["mermaid"] }).toEqual({
      mermaid: "string",
      truncated: false,
      incomplete: false,
      problems: [],
    });
    expect(String(out["mermaid"]).split("\n")).toEqual([
      ...NODES_S1,
      '  n3["PKG-e0000000001 · Package<br/>Stage 1"]',
      '  n4["SR-b0000000002 · System Requirement<br/>Show wind in knots<br/>superseded verification open"]',
      '  n5["D-d0000000002 · Decision<br/>Use SI units"]',
      '  n6["CR-c0000000001 · Component Requirement<br/>Count anemometer turns<br/>verification open"]',
      '  n7["CR-c0000000002 · Component Requirement<br/>Average over ten minutes<br/>outdated verification open"]',
      '  n8["CR-c0000000003 · Component Requirement<br/>Convert turns to speed<br/>verification open"]',
      '  n9["D-d0000000003 · Decision<br/>Show values on the display"]',
      "  classDef element stroke-width:3px",
      "  class n0 element",
      '  n0 -->|"Derives from"| n1',
      '  n0 -->|"Based on"| n2',
      '  n0 -->|"Package"| n3',
      '  n0 -->|"Supersedes"| n4',
      '  n0 -.->|"Refers to · outdated"| n5',
      '  n2 -.->|"Refers to"| n0',
      '  n5 -.->|"Refers to"| n6',
      '  n6 -->|"Derives from"| n0',
      '  n6 -->|"Based on"| n2',
      '  n7 -->|"Derives from · outdated"| n0',
      '  n8 -->|"Derives from"| n0',
      '  n8 -->|"Derives from"| n6',
      '  n9 -.->|"Refers to"| n0',
      "",
    ]);
    // The evidence boxes are left out: `withEvidence` is no input.
    await expect(run("trace.mermaid", "SR-111/graph", { ref: S1, withEvidence: true })).rejects.toMatchObject(
      {
        code: "input.invalid",
      },
    );
  });

  it("[SR-151/AK1] writes the share of verified criteria and the degree of a need as the app shows them", async () => {
    const out = await run("trace.mermaid", "SR-136/graph", { ref: "37373737-3737-4737-8737-00000000a001" });
    const lines = String(out["mermaid"]).split("\n");
    expect(lines.slice(1, 4)).toEqual([
      '  n0["N-00a001 · Need<br/>See the weather<br/>verification 60 %"]',
      '  n1["PKG-00d003 · Package<br/>AK3"]',
      '  n2["SR-00b001 · System Requirement<br/>Show reading 1<br/>verification verified 1 of 1"]',
    ]);
  });

  it("[SR-151/AK6] starts with a comment line when the graph shows not every reachable element", async () => {
    const out = await run("trace.mermaid", "SR-111/graph", { ref: S1, limit: 3 });
    expect(out["truncated"]).toBe(true);
    expect(String(out["mermaid"]).split("\n")).toEqual([
      "%% truncated: more elements are reachable than shown",
      ...NODES_S1,
      "  classDef element stroke-width:3px",
      "  class n0 element",
      '  n0 -->|"Derives from"| n1',
      '  n0 -->|"Based on"| n2',
      '  n2 -.->|"Refers to"| n0',
      "",
    ]);
    const incomplete = elementMermaid(
      { root: "x", nodes: [], edges: [], truncated: true, incomplete: true },
      new Map(),
      new Map(),
    );
    expect(incomplete.split("\n").slice(0, 3)).toEqual([
      "%% truncated: more elements are reachable than shown",
      "%% incomplete: not every repository or evidence location is on this machine",
      "flowchart BT",
    ]);
  });
});

describe("metamodel.mermaid", () => {
  it("[SR-151/AK2] writes each type with name, prefix and properties, inherited ones marked, Any type for open sides, and one edge per pair with the graph's lines", async () => {
    const out = await run("metamodel.mermaid", "SR-130/metamodel", {});
    expect(out["problems"]).toEqual([]);
    expect(String(out["mermaid"]).split("\n")).toEqual([
      "flowchart BT",
      '  m0["Item (ITM)<br/>Title"]',
      '  m1["System Requirement (SR)<br/>Title (inherited) · Rationale · Package"]',
      '  m2["Software Requirement (SWR)<br/>Title (inherited) · Rationale (inherited) · Package (inherited) · Component"]',
      '  m3["Decision (D)<br/>Title"]',
      '  m4["Package (PKG)<br/>Title"]',
      '  any["Any type<br/>"]',
      '  m1 -->|"extends"| m0',
      '  m2 -->|"extends<br/>Derives from"| m1',
      '  m2 -->|"Derives from"| m2',
      '  m1 -->|"Replaces"| m1',
      '  m1 -->|"Delegates to"| m2',
      '  any -->|"Based on · any source<br/>Concerns · any source"| m3',
      '  any -->|"Concerns · any source"| m1',
      '  any -->|"Refines · any source and target"| any',
      '  m3 -->|"Traces to · any target"| any',
      '  m1 -->|"Package"| m4',
      "",
    ]);
  });

  it("gives the problems of metamodel.get while the metamodel is missing", async () => {
    const options = {
      files: {
        "reqseq-workspace.yaml":
          "reqseq-workspace: 1\nname: W\nrepositories:\n  - { name: system, url: x }\nmetamodel: { repository: system, path: missing }\n",
      },
    };
    const out = await run("metamodel.mermaid", "SR-013/own-meanings", {}, options);
    const get = await run("metamodel.get", "SR-013/own-meanings", {}, options);
    expect(out).toEqual({ mermaid: "flowchart BT\n", problems: get["problems"] });
  });
});

describe("labels", () => {
  it("escape what Mermaid reads in a node label and keep every other character", () => {
    expect(
      [
        'Say "hi" [a] (b) |c| d; `e`',
        "#quot; and #35;",
        "<b> & {x}: y",
        "%%{init}%%",
        "line\nbreak\ttab",
      ].map(nodeText),
    ).toEqual([
      "Say #quot;hi#quot; [a] (b) |c| d; `e`",
      "#35;quot; and #35;35;",
      "#lt;b#gt; #amp; #123;x}#58; y",
      "%%#123;init}%%",
      "line break tab",
    ]);
  });

  it("escape the angle brackets and ampersand in an edge label, turn a quote into an apostrophe and break a directive", () => {
    expect(edgeText('A "b" <c> & d\ne')).toBe("A 'b' #lt;c#gt; #amp; d e");
    // Mermaid reads `%%{` as a directive anywhere in the text.
    expect(edgeText("x %%{init: {}}%%")).toBe("x %% {init: {}}%%");
  });
});

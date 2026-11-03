import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { Workspace } from "../runtime/workspace.js";
import type { Metamodel } from "./index.js";
import { limitsOf, metamodelState } from "./index.js";
import { limitProblems } from "./limits.js";

/** The SR-152 fixture with `files` on top, its metamodel loaded. */
const load = async (files: Readonly<Record<string, string>> = {}): Promise<Metamodel> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-152/limits", files });
  onTestFinished(() => ws.cleanup());
  const workspace = new Workspace(ws.root);
  onTestFinished(() => workspace.close());
  return workspace.get(metamodelState);
};

const MORE = `reqseq-metamodel: 1
types:
  - { key: safety-requirement, name: Safety Requirement, prefix: SSR, extends: system-requirement }
relations:
  - key: refines
    name: Refines
    source-types: [safety-requirement]
    target-types: [need]
    limits:
      - { source-type: system-requirement, target-type: need, min: 2, max: 1 }
      - { source-type: system-requirement, target-type: need, max: 3 }
      - { target-type: decision, max: 1 }
      - { source-type: decision, target-type: nede, max: 1 }
`;

const problem = (severity: string, line: number, message: string): unknown => ({
  code: "metamodel.invalid",
  severity,
  repository: "system",
  file: "metamodel/z-more.yaml",
  line,
  message,
});

describe("relation limits in the metamodel (SR-152)", () => {
  it("reports min above max, a second limit for a pair, an unknown type and a type outside the kind's types", async () => {
    const metamodel = await load({ "metamodel/z-more.yaml": MORE });
    expect(metamodel.valid).toBe(false);
    expect(metamodel.problems).toEqual([
      problem("error", 10, "Relation kind refines has a limit with min 2 above max 1"),
      problem(
        "error",
        11,
        "Relation kind refines has a second limit for the same source and target type; one limit per pair",
      ),
      problem(
        "warning",
        12,
        "Relation kind refines has a limit for target-type decision, which its target-types (need) do not allow",
      ),
      problem(
        "warning",
        13,
        "Relation kind refines has a limit for source-type decision, which its source-types (safety-requirement) do not allow",
      ),
      problem("error", 13, "Relation kind refines names unknown type nede in limits"),
    ]);
    // A metamodel that is not valid has no limits.
    expect(limitsOf(metamodel).size).toBe(0);
  });

  it("reports a limit problem without a line when the definition has none", () => {
    const relation = { key: "refines", name: "Refines", limits: [{ "target-type": "nede", max: 1 }] };
    expect(
      limitProblems([{ definition: relation, file: "m.yaml", lineOf: () => undefined }], [], true),
    ).toEqual([
      {
        code: "metamodel.invalid",
        severity: "error",
        file: "m.yaml",
        message: "Relation kind refines names unknown type nede in limits",
      },
    ]);
  });

  it("reports an unknown type in limits only when every metamodel file was read", async () => {
    const metamodel = await load({
      "metamodel/z-faulty.yaml": "reqseq-metamodel: 1\ntypes: [\n",
      "metamodel/z-more.yaml":
        "reqseq-metamodel: 1\nrelations:\n  - { key: refines, name: Refines, limits: [{ target-type: nede, max: 1 }] }\n",
    });
    expect(metamodel.problems.map((p) => p.message)).not.toContain(
      "Relation kind refines names unknown type nede in limits",
    );
  });

  it("gives the limits per source type: by source-type with subtypes, else the kind's source-types, else every type", async () => {
    const metamodel = await load({
      "metamodel/z-more.yaml": `reqseq-metamodel: 1
types:
  - { key: safety-requirement, name: Safety Requirement, prefix: SSR, extends: system-requirement }
relations:
  - { key: refers-to, name: Refers to, limits: [{ target-type: decision, max: 2 }] }
`,
    });
    expect(metamodel.problems).toEqual([]);
    const limits = limitsOf(metamodel);
    expect(limitsOf(metamodel)).toBe(limits);
    const useCase = {
      key: "derives-from",
      label: "Derives from (derives-from)",
      targetType: "use-case",
      targetName: "Use Case",
      max: 1,
    };
    const need = {
      key: "derives-from",
      label: "Derives from (derives-from)",
      targetType: "need",
      targetName: "Need",
      min: 1,
    };
    const decision = {
      key: "refers-to",
      label: "Refers to (refers-to)",
      targetType: "decision",
      targetName: "Decision",
      max: 2,
    };
    expect(Object.fromEntries(limits)).toEqual({
      need: [decision],
      "use-case": [decision],
      "system-requirement": [useCase, need, decision],
      decision: [decision],
      "safety-requirement": [useCase, need, decision],
    });
  });
});

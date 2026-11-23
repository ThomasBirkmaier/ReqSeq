// ADR-0019 point 2 (D-080): the HTML export builds the display model of an element's neighbourhood from the same
// shapes the commands give. This test builds the model twice on one fixture, once from the export's walks
// (`neighbourhoodAnswers`) and once from the answers of `trace.neighbourhood`, and checks that they are the same, also
// for an element that points at itself and one in a cycle of derivations.
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { InvokedOutput } from "../catalog.js";
import { neighbourhoodDisplay } from "../displays/index.js";
import { elementStoreState, shortIdState } from "../model/index.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { currentVersionLookup, traceContext } from "../trace/index.js";
import { NEIGHBOURHOOD_LIMIT, neighbourhoodAnswers, neighbourhoodSource } from "./section-neighbourhood.js";

const METAMODEL = `reqseq-metamodel: 1
types:
  - { key: need, name: Need, prefix: N, meaning: need, properties: [title, spec-id], required: [title] }
  - { key: system-requirement, name: System Requirement, prefix: SR, meaning: requirement, properties: [title, spec-id, acceptance-criteria, related], required: [title] }
properties:
  - { key: title, name: Title, kind: text, meaning: title }
  - { key: spec-id, name: Spec ID, kind: text, meaning: identifier }
  - { key: acceptance-criteria, name: Acceptance Criteria, kind: text, many: true, meaning: acceptance-criteria }
  - { key: related, name: Related, kind: relation, many: true }
relations:
  - { key: derives-from, name: Derives from, meaning: derivation }
  - { key: based-on, name: Based on, inverse-name: Basis for }
statuses:
  - { key: draft, name: Draft, initial: true }
  - { key: approved, name: Approved }
  - { key: obsolete, name: Obsolete, invalid: true }
`;

const uuid = (n: number): string => `bbbb2222-2222-4222-8222-${String(n).padStart(12, "0")}`;
const [TOP, SUB, ROOT, CHILD, USER, LOOP] = [1, 2, 3, 4, 5, 6].map(uuid) as [
  string,
  string,
  string,
  string,
  string,
  string,
];
const STALE = "version: n1:0000000000000000";
const element = (id: string, type: string, front: string, body = "Text."): string =>
  `---\nid: ${id}\ntype: ${type}\n${front}---\n\n${body}\n`;

const FILES = {
  "metamodel/standard-model.yaml": METAMODEL,
  "needs/N-1.md": element(TOP, "need", "status: approved\ntitle: Weather\nspec-id: N-1\n"),
  "needs/N-2.md": element(
    SUB,
    "need",
    `status: approved\ntitle: Wind\nderives-from:\n  - { id: ${TOP}, ${STALE} }\n`,
  ),
  "requirements/SR-3.md": element(
    ROOT,
    "system-requirement",
    `status: approved\ntitle: Show wind speed\nspec-id: SR-1\nacceptance-criteria:\n  - { key: k7f3, text: Given wind. }\nderives-from:\n  - { id: ${SUB}, ${STALE} }\n  - { id: ${LOOP} }\nmystery:\n  - { id: ${TOP} }\n`,
    `Shows wind, see [this](reqseq:${ROOT}).`,
  ),
  "requirements/SR-6.md": element(
    LOOP,
    "system-requirement",
    `status: draft\ntitle: Loop\nderives-from:\n  - { id: ${ROOT} }\n`,
  ),
  "requirements/SR-4.md": element(
    CHILD,
    "system-requirement",
    `status: obsolete\ntitle: Show gusts\nderives-from:\n  - { id: ${ROOT} }\n`,
  ),
  "requirements/SR-5.md": element(
    USER,
    "system-requirement",
    `status: draft\ntitle: Log wind\nbased-on:\n  - { id: ${ROOT}, ${STALE} }\nrelated:\n  - { id: ${ROOT} }\n`,
    `Uses [wind](reqseq:${ROOT}).`,
  ),
};

const open = async () => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-001/two-elements", files: FILES });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const call = async <C extends "trace.neighbourhood">(
  workspace: Workspace,
  command: C,
  input: Record<string, unknown>,
): Promise<InvokedOutput<C>> => (await invoke(command, input, { workspace })) as InvokedOutput<C>;

describe("the export builds its neighbourhood model from what trace.neighbourhood gives (ADR-0019, D-080)", () => {
  it("gives the same neighbourhood model from its walks as from trace.neighbourhood", async () => {
    const workspace = await open();
    const [trace, store, shortIds] = await Promise.all([
      traceContext(workspace),
      workspace.get(elementStoreState),
      workspace.get(shortIdState),
    ]);
    const options = {
      bound: {
        parents: NEIGHBOURHOOD_LIMIT,
        children: NEIGHBOURHOOD_LIMIT,
        incoming: Number.POSITIVE_INFINITY,
      },
      open: "all" as const,
    };
    const source = neighbourhoodSource(trace, () => undefined);
    for (const id of [ROOT, SUB, TOP, LOOP]) {
      const record = store.byId.get(id)?.[0];
      if (record === undefined) {
        throw new Error(`no element ${id}`);
      }
      const answers = await neighbourhoodAnswers(
        source,
        { metamodel: trace.metamodel, shortIds },
        record,
        currentVersionLookup(workspace),
      );
      const fromExport = neighbourhoodDisplay(
        {
          parents: answers.derived,
          children: answers.derived,
          incoming: answers.pointing,
          metamodel: trace.metamodel,
        },
        options,
      );
      const walk = { ref: id, meanings: ["derivation"], allLevels: true, limit: 5000 };
      const parents = await call(workspace, "trace.neighbourhood", { ...walk, direction: "up" });
      const children = await call(workspace, "trace.neighbourhood", { ...walk, direction: "down" });
      const incoming = await call(workspace, "trace.neighbourhood", {
        ref: id,
        direction: "down",
        maxDepth: 1,
        limit: 5000,
      });
      const fromCommands = neighbourhoodDisplay(
        {
          parents,
          children,
          incoming,
          metamodel: trace.metamodel,
        },
        options,
      );
      expect(fromExport).toEqual(fromCommands);
      if (id === ROOT) {
        // It points at itself, and its child LOOP derives back from it (SR-107 AK3, AK5).
        const self = fromExport.incoming.rows.find((group) => group.label === "← Inline reference");
        expect(self?.entries.map((entry) => entry.ref.id)).toEqual([ROOT, USER]);
        expect(
          fromExport.children.rows.filter((row) => row.ref.id === ROOT).map((row) => row.repeated),
        ).toEqual([true]);
      }
    }
  });
});

// hint.list with `ref` takes the single-element path of element.get (#145, ADR-0008): per element of
// fixtures that between them have every kind of hint but outdated evidence (tested at element.get,
// hints/element.test.ts) and replacements onto no core requirement, the same hints in the same order as the
// whole-workspace path gives for that element, without building the cycles of the store or the
// incoming index.
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput, Problem } from "../catalog.js";
import { elementStoreState, incomingState, problemElement } from "../model/index.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { derivationCycleProblemsState } from "../trace/index.js";
import { inCheckOrder, isHint } from "./list.js";

type Output = CommandOutput<"hint.list">;

const open = async (options: FixtureOptions, root = ""): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(root === "" ? fixture.root : `${fixture.root}/${root}`);
  onTestFinished(() => workspace.close());
  return workspace;
};

const list = async (workspace: Workspace, input: Record<string, unknown>): Promise<Output> =>
  (await invoke("hint.list", input, { workspace })) as Output;

/** A baseline R1 of Coast (VAR-0000c1), then K1 (SR-0000a1) changed (SR-103). */
const SINCE_BASELINE: FixtureOptions = {
  fixture: "SR-103/since-baseline",
  git: true,
  files: {
    "baselines/R1.yaml":
      "reqseq-baseline: 1\nname: R1\ndate: 2026-11-02T10:00:00Z\nselection:\n" +
      "  view: { id: 10310310-0000-4000-8000-0000000000c1, title: Coast }\nrepositories:\n" +
      `  - { name: system, commit: ${"a".repeat(40)} }\nelements:\n` +
      ["a1:c44c2a59a7eba159", "a2:b817003944c5d6fb", "b1:4a65c37394420816", "c1:878bca1d9503aac6"]
        .map(
          (e) => `  - { id: 10310310-0000-4000-8000-0000000000${e.slice(0, 2)}, version: n1${e.slice(2)} }\n`,
        )
        .join(""),
    "requirements/SR-0000000000a1.md":
      "---\nid: 10310310-0000-4000-8000-0000000000a1\ntype: system-requirement\nstatus: draft\ntitle: Wind speed every minute\n" +
      "requirement-type: functional\nacceptance-criteria:\n  - Given the station runs, when a minute passes, then it reports the wind speed.\n" +
      "---\n\nThe station reports the wind speed every 30 seconds.\n",
  },
};

/** SR-026/hints with a requirement without text but a statement, and one with a link that names no UUID. */
const MORE_HINTS: FixtureOptions = {
  fixture: "SR-026/hints",
  files: {
    "requirements/SR-0000000000b5.md":
      "---\nid: 26a0b000-0000-4000-8000-0000000000b5\ntype: system-requirement\nstatus: draft\ntitle: Log wind\n" +
      "requirement-type: functional\nstatement: Agreed\n---\n",
    "requirements/SR-0000000000b6.md":
      "---\nid: 26a0b000-0000-4000-8000-0000000000b6\ntype: system-requirement\nstatus: draft\ntitle: Log rain\n" +
      "requirement-type: functional\n---\n\nAs [the other](reqseq:not-a-uuid) does, see SR-0000b5.\n",
  },
};

/** enabler-305/identifiers with a second requirement SR-037 (#305). */
const DUPLICATE_IDENTIFIER: FixtureOptions = {
  fixture: "enabler-305/identifiers",
  files: {
    "requirements/SR-0000000b0038.md":
      "---\nid: 30500000-0000-4000-8000-0000000b0038\ntype: system-requirement\nstatus: draft\ntitle: Twice\n" +
      "spec-id: SR-037\n---\n\nThe same identifier.\n",
  },
};

/** SR-A (SR-0000b1) replaces the core requirement SR-K (SR-0000a1), whose content changed (SR-045). */
const CORE_CHANGED: FixtureOptions = {
  fixture: "SR-045/core-changed",
  git: true,
  files: {
    "requirements/SR-0000000000a1.md": `---\nid: 45045045-0000-4000-8000-0000000000a1\ntype: system-requirement\nstatus: draft\ntitle: Response time at most 10 ms\nrequirement-type: functional\nacceptance-criteria:\n  - Given a request, when it is sent, then the answer comes within 12 ms.\n---\n\nThe station answers within 12 ms.\n`,
  },
};

/**
 * Per element with one record, `hint.list` with `ref` and `filters` on a fresh workspace, then the
 * hints of the whole list with `filters` about that element; both must be equal. Returns the codes.
 */
const sameByRef = async (
  options: FixtureOptions,
  root = "",
  filters: Record<string, unknown> = {},
): Promise<Set<string>> => {
  const fresh = await open(options, root);
  const store = await fresh.get(elementStoreState);
  const ids = [...store.byId].filter(([, records]) => records.length === 1).map(([id]) => id);
  const byRef = new Map<string, readonly Problem[]>();
  for (const id of ids) {
    byRef.set(id, (await list(fresh, { ...filters, ref: id })).hints);
  }
  // The single-element path builds neither the cycles of the store nor the incoming index (ADR-0008).
  expect(fresh.peek(derivationCycleProblemsState)).toBeUndefined();
  expect(fresh.peek(incomingState)).toBeUndefined();
  const workspace = await open(options, root);
  const all = (await list(workspace, filters)).hints;
  const whole = await workspace.get(elementStoreState);
  const codes = new Set<string>();
  for (const id of ids) {
    const record = whole.byId.get(id)?.[0];
    const expected = all.filter((hint) => isHint(hint) && problemElement(whole, hint) === record);
    expect(byRef.get(id), `hint.list --ref ${id}`).toEqual(expected);
    for (const hint of expected) {
      codes.add(hint.code);
    }
  }
  return codes;
};

describe("hint.list with ref takes the single-element path (#145)", () => {
  it("gives the hints of the whole list in its order, for every kind of hint", async () => {
    const codes = new Set([
      ...(await sameByRef({ fixture: "SR-026/hints", git: true })),
      ...(await sameByRef({ fixture: "SR-090/cycle" })),
      ...(await sameByRef({ fixture: "SR-085/value-kinds" }, "system")),
      ...(await sameByRef({ fixture: "SR-086/relation-types" }, "system")),
      ...(await sameByRef({ fixture: "SR-016/unknown" })),
      ...(await sameByRef({ fixture: "SR-072/supersede" })),
      ...(await sameByRef({ fixture: "SR-040/validity" })),
      ...(await sameByRef({ fixture: "SR-039/nested" })),
      ...(await sameByRef({ fixture: "SR-152/limits" })),
      ...(await sameByRef({ fixture: "SR-171/max-items" })),
      ...(await sameByRef(CORE_CHANGED)),
      ...(await sameByRef(MORE_HINTS)),
      ...(await sameByRef(DUPLICATE_IDENTIFIER)),
      ...(await sameByRef({ fixture: "enabler-306/statuses-per-type" })),
      ...(await sameByRef(SINCE_BASELINE)),
    ]);
    expect([...codes].sort()).toEqual([
      "element.duplicate-identifier",
      "element.missing-required",
      "element.missing-status",
      "element.statement-without-text",
      "element.status-not-allowed",
      "element.too-many-items",
      "element.unknown-property",
      "element.unknown-type",
      "element.wrong-value-kind",
      "relation.not-allowed",
      "relation.outdated",
      "relation.target-superseded",
      "relation.too-few",
      "relation.too-many",
      "relation.unresolved-link",
      "trace.cycle",
      "trace.no-parent",
      "variant.core-changed",
      "variant.core-changed-since-baseline",
      "variant.nested",
      "variant.superseded-in-validity",
    ]);
  });

  it("applies the other filters as the whole list does, since-baseline hints only for their variant", async () => {
    const coast = "10310310-0000-4000-8000-0000000000c1";
    expect(await sameByRef(SINCE_BASELINE, "", { variant: coast })).toContain(
      "variant.core-changed-since-baseline",
    );
    expect(await sameByRef(SINCE_BASELINE, "", { kind: ["relation.outdated"] })).toEqual(new Set());
    expect(await sameByRef({ fixture: "SR-026/hints" }, "", { type: ["system-requirement"] })).toContain(
      "element.missing-required",
    );
  });

  it("pages the hints of one element as the whole list does: limit from offset, total counts all", async () => {
    const workspace = await open({ fixture: "SR-026/hints", git: true });
    const all = await list(workspace, { ref: "SR-0000b1" });
    expect(all.total).toBe(2);
    expect(all.hints).toHaveLength(2);
    for (const [offset, limit] of [
      [1, 1],
      [0, 1],
      [2, 5],
    ] as const) {
      expect(await list(workspace, { ref: "SR-0000b1", offset, limit })).toEqual({
        hints: all.hints.slice(offset, offset + limit),
        total: 2,
        incomplete: false,
      });
    }
    expect(workspace.peek(derivationCycleProblemsState)).toBeUndefined();
  });

  it("orders the hints of one element by the states of the check, a code it does not name last", () => {
    const hint = (code: Problem["code"]): Problem => ({
      code,
      severity: "warning",
      message: code,
      elementId: "e",
    });
    expect(
      inCheckOrder([
        hint("relation.outdated"),
        hint("file.faulty"),
        hint("trace.no-parent"),
        hint("element.unknown-property"),
        hint("variant.core-changed"),
      ]).map((h) => h.code),
    ).toEqual([
      "element.unknown-property",
      "trace.no-parent",
      "relation.outdated",
      "variant.core-changed",
      "file.faulty",
    ]);
  });
});

// Example tests of the degree and filter model (#1396): the worked examples of the rules D, F and A7 in README.md.
// They name rules, never an [SR/AK] token, because they check the model, not the tool.
import { describe, expect, it } from "vitest";
import { degreeOf, shownValidationOf, validationMatches, verificationMatches } from "./degree-model.js";
import type { ModelRecord } from "./model.js";
import { CORE_VIEW, type ModelWorkspace, type ModelWorkspaceElement } from "./workspace-model.js";

const T1 = "2026-11-01T10:00:00Z";

function record(result: ModelRecord["result"], extra: Partial<ModelRecord> = {}): ModelRecord {
  return { kind: "verification", version: "current", date: T1, result, ...extra };
}

function element(key: string, extra: Partial<ModelWorkspaceElement> = {}, records: ModelRecord[] = []) {
  return {
    key,
    id: key,
    repository: "spec",
    type: "requirement",
    invalid: false,
    emergent: false,
    validity: [],
    derivesFrom: [],
    replaces: [],
    own: { criteria: [], olderVersions: [], records },
    ...extra,
  } satisfies ModelWorkspaceElement;
}

function workspace(elements: ModelWorkspaceElement[]): ModelWorkspace {
  return {
    repositories: [{ name: "spec", variantIndependent: false }],
    variants: [{ id: "A", repository: "spec", invalid: true, excludes: [] }],
    elements,
    order: [],
  };
}

// A parent indirect through its verified child, a failed and an outdated one, an open one, an invalid verified one,
// one valid for A only, and a need.
const ws = workspace([
  element("p"),
  element("c", { derivesFrom: [{ id: "p" }] }, [record("passed")]),
  element("f", {}, [record("failed")]),
  element("o", {}, [record("passed", { version: "v1" })]),
  element("n"),
  element("i", { invalid: true }, [record("passed")]),
  element("a", { validity: ["A"] }, [record("passed", { variant: "A" })]),
  element("need", { type: "need" }, [
    { kind: "validation", version: "current", date: T1, result: "inconclusive", reason: "why" },
  ]),
]);
const all = new Set(ws.elements.map((e) => e.key));

describe("degree model", () => {
  it("counts the valid requirements of the selection in the view, indirect apart (D1 to D4)", () => {
    expect(degreeOf(ws, CORE_VIEW, all)).toEqual({
      total: 5,
      counts: { open: 1, verified: 1, indirect: 1, failed: 1, outdated: 1 },
      share: 0.4,
    });
    expect(degreeOf(ws, CORE_VIEW, new Set(["c", "i", "need"]))).toEqual({
      total: 1,
      counts: { open: 0, verified: 1, indirect: 0, failed: 0, outdated: 0 },
      share: 1,
    });
  });

  it("counts an invalid variant's view like any other and leaves out the share at total 0 (D1, D4)", () => {
    expect(degreeOf(ws, "A", new Set(["a"])).total).toBe(1);
    expect(degreeOf(ws, CORE_VIEW, new Set())).toEqual({
      total: 0,
      counts: { open: 0, verified: 0, indirect: 0, failed: 0, outdated: 0 },
    });
  });

  it("filters by the status in a view and by the shown validation (F1, F2, A7)", () => {
    expect(verificationMatches(ws, CORE_VIEW, ["verified", "indirect"])).toEqual(new Set(["p", "c", "i"]));
    expect(verificationMatches(ws, "A", ["verified"])).toEqual(new Set(["a"]));
    expect(validationMatches(ws, ["inconclusive"])).toEqual(new Set(["need"]));
    expect(validationMatches(ws, ["open"])).toEqual(new Set());
    expect(shownValidationOf(element("x"))).toBeUndefined();
    expect(shownValidationOf(element("y", { type: "need" }))).toEqual({ status: "open" });
  });
});

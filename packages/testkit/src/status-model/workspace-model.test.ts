// Example tests of the workspace model (#1395): the worked examples of the rules W, R and I in README.md. They name
// rules, never an [SR/AK] token, because they check the model, not the tool.
import { describe, expect, it } from "vitest";
import type { ModelRecord } from "./model.js";
import {
  CORE_VIEW,
  type ModelVariant,
  type ModelWorkspace,
  type ModelWorkspaceElement,
  appliesIn,
  entryViews,
  recordsInView,
  resolveRef,
  workspaceStatusOf,
} from "./workspace-model.js";

const T1 = "2026-11-01T10:00:00Z";
const T2 = "2026-11-02T10:00:00Z";

function passed(variant?: string, date = T1): ModelRecord {
  return {
    kind: "verification",
    version: "current",
    date,
    result: "passed",
    ...(variant === undefined ? {} : { variant }),
  };
}

function failed(variant?: string, date = T1): ModelRecord {
  return {
    kind: "verification",
    version: "current",
    date,
    result: "failed",
    ...(variant === undefined ? {} : { variant }),
  };
}

function req(
  key: string,
  extra: Partial<ModelWorkspaceElement> = {},
  records: ModelRecord[] = [],
): ModelWorkspaceElement {
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
  };
}

function variant(id: string, extra: Partial<ModelVariant> = {}): ModelVariant {
  return { id, repository: "spec", invalid: false, excludes: [], ...extra };
}

function workspace(
  elements: ModelWorkspaceElement[],
  variants: ModelVariant[] = [],
  independent: string[] = [],
): ModelWorkspace {
  return {
    repositories: ["spec", "lib"].map((name) => ({ name, variantIndependent: independent.includes(name) })),
    variants,
    elements,
    order: [],
  };
}

function statusOf(ws: ModelWorkspace) {
  return Object.fromEntries(workspaceStatusOf(ws));
}

describe("status model: views", () => {
  it("W1: resolves in the named repository, else the source's own, and not between twins", () => {
    const a = req("a", { id: "u1" });
    const b = req("b", { id: "u1", repository: "lib" });
    const c = req("c", { id: "u2" });
    const d = req("d", { id: "u2" });
    const ws = workspace([a, b, c, d]);
    expect(resolveRef(ws, { id: "u1" }, "spec")).toBe(a);
    expect(resolveRef(ws, { id: "u1" }, "lib")).toBe(b);
    expect(resolveRef(ws, { id: "u1", repository: "lib" }, "spec")).toBe(b);
    expect(resolveRef(ws, { id: "u2" }, "spec")).toBeUndefined();
    expect(resolveRef(ws, { id: "u3" }, "spec")).toBeUndefined();
  });

  it("W2, W3, W4, W7: core requirements are in the core and in variants, the others only in their validity", () => {
    const core = req("core");
    const ab = req("ab", { validity: ["A", "B"] });
    const need: ModelWorkspaceElement = { ...req("need"), type: "need" };
    const ws = workspace([core, ab, need], [variant("A"), variant("B"), variant("C")]);
    expect(entryViews(ws, core)).toEqual([CORE_VIEW, "A", "B", "C"]);
    expect(entryViews(ws, ab)).toEqual(["A", "B"]);
    expect(entryViews(ws, need)).toEqual([]);
    expect([CORE_VIEW, "A", "C"].map((view) => appliesIn(ws, need, view))).toEqual([true, true, true]);
    expect(appliesIn(ws, core, "unknown")).toBe(false);
  });

  it("W5: an exclusion takes a core requirement out, one on a requirement with validity or a need does not", () => {
    const core = req("core");
    const own = req("own", { validity: ["A"] });
    const need: ModelWorkspaceElement = { ...req("need"), type: "need" };
    const ws = workspace(
      [core, own, need],
      [variant("A", { excludes: [{ id: "core" }, { id: "own" }, { id: "need" }] }), variant("B")],
    );
    expect(entryViews(ws, core)).toEqual([CORE_VIEW, "B"]);
    expect(entryViews(ws, own)).toEqual(["A"]);
    expect(appliesIn(ws, need, "A")).toBe(true);
  });

  it("W6: a replacement works only in the variants of the replacing requirement's validity, whatever its status", () => {
    const k = req("k");
    const a = req("a", { validity: ["A", "B"], replaces: [{ id: "k" }], invalid: true });
    const ws = workspace([k, a], [variant("A"), variant("B"), variant("C")]);
    expect(entryViews(ws, k)).toEqual([CORE_VIEW, "C"]);
    expect(entryViews(ws, a)).toEqual(["A", "B"]);
  });

  it("W6: a replacing requirement without validity, or a target with validity, changes no view", () => {
    const k = req("k");
    const a1 = req("a1", { validity: ["A"] });
    const plain = req("plain", { replaces: [{ id: "k" }] });
    const a2 = req("a2", { validity: ["A"], replaces: [{ id: "a1" }] });
    const ws = workspace([k, a1, plain, a2], [variant("A")]);
    expect(entryViews(ws, k)).toEqual([CORE_VIEW, "A"]);
    expect(entryViews(ws, a1)).toEqual(["A"]);
  });

  it("W1, W6: a replacement through an ambiguous item has no effect", () => {
    const k1 = req("k1", { id: "k" });
    const k2 = req("k2", { id: "k" });
    const a = req("a", { validity: ["A"], replaces: [{ id: "k" }] });
    const ws = workspace([k1, k2, a], [variant("A")]);
    expect(entryViews(ws, k1)).toEqual([CORE_VIEW, "A"]);
  });

  it("W8: no entry for a variant with an invalid status, though the requirement applies there", () => {
    const only = req("only", { validity: ["A"] });
    const ws = workspace([only, req("core")], [variant("A", { invalid: true })]);
    expect(appliesIn(ws, only, "A")).toBe(true);
    expect(entryViews(ws, only)).toEqual([]);
    expect(statusOf(ws)).toEqual({ only: [], core: [{ view: CORE_VIEW, status: "open" }] });
  });
});

describe("status model: records per view", () => {
  it("R1, R2: a record without variant counts in the core, one for A only in A", () => {
    const k = req("k", {}, [passed(), failed("B")]);
    const ws = workspace([k], [variant("A"), variant("B"), variant("C", { invalid: true })]);
    expect(statusOf(ws)).toEqual({
      k: [
        { view: CORE_VIEW, status: "verified" },
        { view: "A", status: "open" },
        { view: "B", status: "failed" },
      ],
    });
  });

  it("R3: a variant-independent repository pools its records without variant with the variant's", () => {
    const k = req("k", { repository: "lib" }, [passed(undefined, T1), failed("A", T1), passed("B", T2)]);
    const ws = workspace([k], [variant("A"), variant("B")], ["lib"]);
    expect(recordsInView(ws, k, "A")).toHaveLength(2);
    expect(statusOf(ws)).toEqual({
      k: [
        { view: CORE_VIEW, status: "verified" },
        { view: "A", status: "failed" },
        { view: "B", status: "verified" },
      ],
    });
  });

  it("R3: the element's repository decides, and a repository the workspace does not list is not independent", () => {
    const k = req("k", { repository: "other" }, [passed()]);
    const ws = workspace([k], [variant("A")], ["spec", "lib"]);
    expect(recordsInView(ws, k, "A")).toEqual([]);
  });

  it("R1: validation records never count", () => {
    const k = req("k", {}, [{ kind: "validation", version: "current", date: T1, result: "passed" }]);
    expect(recordsInView(workspace([k]), k, CORE_VIEW)).toEqual([]);
  });

  it("V16: an own status of a requirement with criteria counts its verified criteria", () => {
    const k = req("k", {}, [passed()]);
    const withCriteria = { ...k, own: { ...k.own, criteria: [{ key: "alpha" }, {}] } };
    expect(statusOf(workspace([withCriteria]))).toEqual({
      k: [{ view: CORE_VIEW, status: "verified", verified: 2, total: 2 }],
    });
  });
});

describe("status model: indirect verification", () => {
  it("I1, I3: a parent without own record is indirect when every counted child is verified or indirect", () => {
    const p = req("p");
    const m = req("m", { derivesFrom: [{ id: "p" }] });
    const c1 = req("c1", { derivesFrom: [{ id: "m" }] }, [passed()]);
    const c2 = req("c2", { derivesFrom: [{ id: "p" }, { id: "p" }] }, [passed()]);
    expect(statusOf(workspace([p, m, c1, c2]))).toEqual({
      p: [{ view: CORE_VIEW, status: "indirect" }],
      m: [{ view: CORE_VIEW, status: "indirect" }],
      c1: [{ view: CORE_VIEW, status: "verified" }],
      c2: [{ view: CORE_VIEW, status: "verified" }],
    });
  });

  it("I1: an own record of any result decides, the children are not asked", () => {
    const p = req("p", {}, [failed()]);
    const c = req("c", { derivesFrom: [{ id: "p" }] }, [passed()]);
    expect(statusOf(workspace([p, c]))["p"]).toEqual([{ view: CORE_VIEW, status: "failed" }]);
  });

  it("I4: names the direct children that are failed, open or outdated, each once and sorted", () => {
    const p = req("p");
    const outdated = req("z", { derivesFrom: [{ id: "p" }] }, [{ ...passed(), version: "v1" }]);
    const open = req("y", { derivesFrom: [{ id: "p" }, { id: "p" }] });
    const fail = req("x", { derivesFrom: [{ id: "p" }] }, [failed()]);
    const ok = req("w", { derivesFrom: [{ id: "p" }] }, [passed()]);
    const grand = req("g", { derivesFrom: [{ id: "y" }] }, [failed()]);
    expect(statusOf(workspace([p, outdated, open, fail, ok, grand]))["p"]).toEqual([
      { view: CORE_VIEW, status: "open", missingChildren: ["x", "y", "z"] },
    ]);
  });

  it("I2, I4: no counted child gives open without names; needs, invalid children and twins do not count", () => {
    const p = req("p");
    const need: ModelWorkspaceElement = { ...req("n", { derivesFrom: [{ id: "p" }] }), type: "need" };
    const invalid = req("i", { derivesFrom: [{ id: "p" }], invalid: true });
    const q1 = req("q1", { id: "q" });
    const q2 = req("q2", { id: "q" });
    const twinChild = req("t", { derivesFrom: [{ id: "q" }] });
    const lib = req("l", { repository: "lib", derivesFrom: [{ id: "p" }] }, [failed()]);
    const status = statusOf(workspace([p, need, invalid, q1, q2, twinChild, lib]));
    expect(status["p"]).toEqual([{ view: CORE_VIEW, status: "open" }]);
    expect(status["q1"]).toEqual([{ view: CORE_VIEW, status: "open" }]);
  });

  it("I2: a child in another repository counts when its item names the parent's repository", () => {
    const p = req("p");
    const c = req("c", { repository: "lib", derivesFrom: [{ id: "p", repository: "spec" }] }, [passed()]);
    expect(statusOf(workspace([p, c]))["p"]).toEqual([{ view: CORE_VIEW, status: "indirect" }]);
  });

  it("I2: only children in the view count, and a replacing requirement has only its own children", () => {
    const k = req("k");
    const a = req("a", { validity: ["A"], replaces: [{ id: "k" }] });
    const coreChild = req("kc", { derivesFrom: [{ id: "k" }] }, [passed()]);
    const variantChild = req("ac", { validity: ["B"], derivesFrom: [{ id: "k" }] }, [failed("B")]);
    const ws = workspace([k, a, coreChild, variantChild], [variant("A"), variant("B")]);
    expect(statusOf(ws)).toEqual({
      k: [
        { view: CORE_VIEW, status: "indirect" },
        { view: "B", status: "open", missingChildren: ["ac", "kc"] },
      ],
      a: [{ view: "A", status: "open" }],
      kc: [
        { view: CORE_VIEW, status: "verified" },
        { view: "A", status: "open" },
        { view: "B", status: "open" },
      ],
      ac: [{ view: "B", status: "failed" }],
    });
  });

  it("I5: an emergent requirement without own record is open without names, and is missing as a child", () => {
    const p = req("p");
    const e = req("e", { emergent: true, derivesFrom: [{ id: "p" }] });
    const c = req("c", { derivesFrom: [{ id: "e" }] }, [passed()]);
    const verifiedEmergent = req("v", { emergent: true }, [passed()]);
    expect(statusOf(workspace([p, e, c, verifiedEmergent]))).toEqual({
      p: [{ view: CORE_VIEW, status: "open", missingChildren: ["e"] }],
      e: [{ view: CORE_VIEW, status: "open" }],
      c: [{ view: CORE_VIEW, status: "verified" }],
      v: [{ view: CORE_VIEW, status: "verified" }],
    });
  });

  it("I6: a derivation cycle without own records is not indirect, one with an own record is", () => {
    const a = req("a", { derivesFrom: [{ id: "b" }] });
    const b = req("b", { derivesFrom: [{ id: "a" }] });
    const self = req("s", { derivesFrom: [{ id: "s" }] });
    expect(statusOf(workspace([a, b, self]))).toEqual({
      a: [{ view: CORE_VIEW, status: "open", missingChildren: ["b"] }],
      b: [{ view: CORE_VIEW, status: "open", missingChildren: ["a"] }],
      s: [{ view: CORE_VIEW, status: "open", missingChildren: ["s"] }],
    });
    const c = req("c", { derivesFrom: [{ id: "d" }] }, [passed()]);
    const d = req("d", { derivesFrom: [{ id: "c" }] });
    expect(statusOf(workspace([c, d]))).toEqual({
      c: [{ view: CORE_VIEW, status: "verified" }],
      d: [{ view: CORE_VIEW, status: "indirect" }],
    });
  });
});

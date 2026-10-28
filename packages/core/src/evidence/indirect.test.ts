// The indirect verification (SR-034, ADR-0012 "Status rules") as a pure function of a status source,
// the derivation children of each element and their current versions. The commands that show it
// (evidence.status, element.get) and the filter are tested in commands/evidence/indirect.test.ts; the
// emergent rule (SR-035) in commands/evidence/emergent.test.ts.
import { describe, expect, it } from "vitest";
import type { ElementRecord } from "../model/index.js";
import { isEmergent } from "../model/index.js";
import type { View } from "../variants/index.js";
import { evidenceIndex } from "./by-element.js";
import type { ChildRules, VerificationResult } from "./indirect.js";
import { verificationEvaluator } from "./indirect.js";
import type { EvidenceRecord } from "./record.js";
import type { StatusSource } from "./status.js";

const P = "34343434-3434-4434-8434-0000000";
const V = `${P}0c001`;
const CURRENT = "n1:1111111111111111";
const OLDER = "n1:0000000000000000";
const CORE: View = { kind: "core" };
const IN_V: View = { kind: "variant", variant: { id: V, repository: "system" } };

let next = 0;

/** A requirement (type `req`) of the repository `system`; `more` sets other frontmatter. */
const element = (more: Readonly<Record<string, unknown>> = {}, type = "req"): ElementRecord => {
  next += 1;
  const id = `${P}${next.toString(16).padStart(5, "0")}`;
  return {
    id,
    type,
    repository: "system",
    file: `${id}.md`,
    data: { id, type, status: "draft", ...more },
    eol: "\n",
    closingEol: "\n",
    bom: false,
    snapshot: { path: `${id}.md`, size: 0, mtimeMs: 0, sha256: "0".repeat(64) },
  };
};

const record = (
  of: ElementRecord,
  result: EvidenceRecord["result"],
  more: Partial<EvidenceRecord> = {},
): EvidenceRecord => ({
  element: of.id,
  version: CURRENT,
  kind: "verification",
  method: "test",
  item: "build-1",
  result,
  date: "2026-10-27T10:00:00Z",
  ...more,
});

/** Children by parent; `counts` is false for the status `obsolete` (the metamodel's invalid flag). */
const rules = (children: ReadonlyMap<ElementRecord, readonly ElementRecord[]>): ChildRules => ({
  childrenOf: (e) => children.get(e) ?? [],
  counts: (e) => e.data["status"] !== "obsolete",
});

interface Setup {
  readonly children?: ReadonlyMap<ElementRecord, readonly ElementRecord[]>;
  readonly records?: readonly EvidenceRecord[];
  /** The current version of an element; CURRENT for all others. */
  readonly versions?: ReadonlyMap<ElementRecord, string | undefined>;
  /** No child rules (no derivation meaning, or the metamodel is not valid). */
  readonly noRules?: boolean;
  /** The key of the property with the meaning `emergent`; `emergent` unless given, null: none (SR-035). */
  readonly emergentKey?: string | null;
}

const evaluator = (setup: Setup) => {
  const index = evidenceIndex(setup.records ?? []);
  const source: StatusSource = {
    requirements: new Set(["req"]),
    needs: new Set(["need"]),
    invalid: new Set(),
    validity: { key: "validity", many: true, label: "property Validity (validity)" },
    recordsOf: (id) => index.byElement.get(id) ?? [],
    emergent: (e) =>
      isEmergent(e, setup.emergentKey === null ? undefined : (setup.emergentKey ?? "emergent")),
  };
  const versions = setup.versions ?? new Map<ElementRecord, string | undefined>();
  return verificationEvaluator(
    source,
    setup.noRules === true ? undefined : rules(setup.children ?? new Map()),
    (e) => (versions.has(e) ? versions.get(e) : CURRENT),
  );
};

const indirect: VerificationResult = { status: "indirect" };

describe("indirect verification (SR-034)", () => {
  it("[SR-034/AK1] a parent without own record whose valid children are all verified is indirect", () => {
    const [parent, a, b] = [element(), element(), element()];
    const evaluate = evaluator({
      children: new Map([[parent, [a, b]]]),
      records: [record(a, "passed"), record(b, "passed")],
    });
    expect(evaluate(parent, CORE)).toEqual(indirect);
    expect(evaluate(a, CORE)).toEqual({ status: "verified" });
  });

  it("[SR-034/AK1] a child that is indirect counts as verified for its parent", () => {
    const [top, middle, leaf, other] = [element(), element(), element(), element()];
    const evaluate = evaluator({
      children: new Map([
        [top, [middle, other]],
        [middle, [leaf]],
      ]),
      records: [record(leaf, "passed"), record(other, "passed")],
    });
    expect(evaluate(top, CORE)).toEqual(indirect);
    expect(evaluate(middle, CORE)).toEqual(indirect);
  });

  it("[SR-034/AK1] a child is measured against its own current version", () => {
    const [parent, child] = [element(), element()];
    const setup = { children: new Map([[parent, [child]]]), records: [record(child, "passed")] };
    expect(evaluator(setup)(parent, CORE)).toEqual(indirect);
    const changed = evaluator({ ...setup, versions: new Map([[child, "n1:2222222222222222"]]) });
    expect(changed(parent, CORE)).toEqual({ status: "open", missingChildren: [child.id] });
    expect(changed(child, CORE)).toEqual({ status: "outdated" });
  });

  it.each([
    ["failed", (c: ElementRecord) => [record(c, "failed")], "failed"],
    ["without record", () => [], "open"],
    [
      "with a record of an older version",
      (c: ElementRecord) => [record(c, "passed", { version: OLDER })],
      "outdated",
    ],
  ] as const)(
    "[SR-034/AK2] a parent with one child %s is open and names exactly that child",
    (_name, recordsOf, childStatus) => {
      const [parent, verified, missing] = [element(), element(), element()];
      const evaluate = evaluator({
        children: new Map([[parent, [verified, missing]]]),
        records: [record(verified, "passed"), ...recordsOf(missing)],
      });
      expect(evaluate(parent, CORE)).toEqual({ status: "open", missingChildren: [missing.id] });
      expect(evaluate(missing, CORE)?.status).toBe(childStatus);
    },
  );

  it("[SR-034/AK2] a parent with a failed, an open and an outdated child names the three in child order", () => {
    const [parent, failed, open, outdated, verified] = [
      element(),
      element(),
      element(),
      element(),
      element(),
    ];
    const evaluate = evaluator({
      children: new Map([[parent, [failed, verified, open, outdated]]]),
      records: [
        record(failed, "failed"),
        record(outdated, "passed", { version: OLDER }),
        record(verified, "passed"),
      ],
    });
    expect(evaluate(parent, CORE)).toEqual({
      status: "open",
      missingChildren: [failed.id, open.id, outdated.id],
    });
  });

  it("[SR-034/AK2] a verified or indirect child is not named as missing", () => {
    const [parent, verified, middle, leaf, open] = [element(), element(), element(), element(), element()];
    const evaluate = evaluator({
      children: new Map([
        [parent, [verified, middle, open]],
        [middle, [leaf]],
      ]),
      records: [record(verified, "passed"), record(leaf, "passed")],
    });
    expect(evaluate(parent, CORE)).toEqual({ status: "open", missingChildren: [open.id] });
  });

  it("[SR-034/AK2] only the direct children are named: a parent whose child is open because of a failed grandchild names the child, not the grandchild", () => {
    const [parent, child, grandchild] = [element(), element(), element()];
    const evaluate = evaluator({
      children: new Map([
        [parent, [child]],
        [child, [grandchild]],
      ]),
      records: [record(grandchild, "failed")],
    });
    expect(evaluate(parent, CORE)).toEqual({ status: "open", missingChildren: [child.id] });
    expect(evaluate(child, CORE)).toEqual({ status: "open", missingChildren: [grandchild.id] });
  });

  it("[SR-034/AK3] a child whose status is marked invalid does not count and is never named as missing", () => {
    const [parent, verified, invalid] = [element(), element(), element({ status: "obsolete" })];
    const evaluate = evaluator({
      children: new Map([[parent, [verified, invalid]]]),
      records: [record(verified, "passed"), record(invalid, "failed")],
    });
    expect(evaluate(parent, CORE)).toEqual(indirect);
    // Its own status is still computed: only the parent does not count it.
    expect(evaluate(invalid, CORE)).toEqual({ status: "failed" });
  });

  it("[SR-034/AK3] a parent whose only children are marked invalid is open without missing children", () => {
    const [parent, invalid] = [element(), element({ status: "obsolete" })];
    expect(evaluator({ children: new Map([[parent, [invalid]]]) })(parent, CORE)).toEqual({ status: "open" });
  });

  it("an own outdated or failed record keeps the own status and names no missing children (#526 Q1, Q4)", () => {
    const [outdated, failed, child] = [element(), element(), element()];
    const evaluate = evaluator({
      children: new Map([
        [outdated, [child]],
        [failed, [child]],
      ]),
      records: [
        record(outdated, "passed", { version: OLDER }),
        record(failed, "failed"),
        record(child, "failed"),
      ],
    });
    expect(evaluate(outdated, CORE)).toEqual({ status: "outdated" });
    expect(evaluate(failed, CORE)).toEqual({ status: "failed" });
  });

  it("an own verified record keeps verified whatever the children say", () => {
    const [parent, child] = [element(), element()];
    const evaluate = evaluator({
      children: new Map([[parent, [child]]]),
      records: [record(parent, "passed")],
    });
    expect(evaluate(parent, CORE)).toEqual({ status: "verified" });
  });

  it("a validation record of the parent does not block the indirect verification (D-007)", () => {
    const [parent, child] = [element(), element()];
    const evaluate = evaluator({
      children: new Map([[parent, [child]]]),
      records: [record(parent, "failed", { kind: "validation" }), record(child, "passed")],
    });
    expect(evaluate(parent, CORE)).toEqual(indirect);
  });

  it("a record of a variant does not block in the core, and a child counts only in the views it applies in (SR-047, SR-040)", () => {
    const parent = element();
    const both = element();
    const onlyV = element({ validity: [{ id: V }] });
    const evaluate = evaluator({
      children: new Map([[parent, [both, onlyV]]]),
      records: [
        record(parent, "failed", { variant: V }),
        record(both, "passed"),
        record(both, "passed", { variant: V }),
      ],
    });
    // The core: the parent's variant record does not count, the child of V does not apply.
    expect(evaluate(parent, CORE)).toEqual(indirect);
    // V: the parent's own record decides.
    expect(evaluate(parent, IN_V)).toEqual({ status: "failed" });
    // A parent valid in V without own record there names the child of V.
    const other = element();
    const inV = evaluator({
      children: new Map([[other, [both, onlyV]]]),
      records: [record(both, "passed", { variant: V })],
    });
    expect(inV(other, IN_V)).toEqual({ status: "open", missingChildren: [onlyV.id] });
    expect(inV(onlyV, CORE)).toBeUndefined();
  });

  it("a parent without counted child is open without missing children (#526 Q3)", () => {
    expect(evaluator({})(element(), CORE)).toEqual({ status: "open" });
  });

  it("a child whose type has no meaning requirement does not count (#526 Q2)", () => {
    const [parent, child, useCase] = [element(), element(), element({}, "use-case")];
    const evaluate = evaluator({
      children: new Map([[parent, [useCase, child]]]),
      records: [record(child, "passed")],
    });
    expect(evaluate(parent, CORE)).toEqual(indirect);
    expect(evaluate(useCase, CORE)).toBeUndefined();
    const onlyUseCase = element();
    expect(evaluator({ children: new Map([[onlyUseCase, [useCase]]]) })(onlyUseCase, CORE)).toEqual({
      status: "open",
    });
  });

  it("a child linked twice counts once and is named once", () => {
    const [parent, child] = [element(), element()];
    const evaluate = evaluator({ children: new Map([[parent, [child, child]]]) });
    expect(evaluate(parent, CORE)).toEqual({ status: "open", missingChildren: [child.id] });
  });

  it("a derivation cycle gives no indirect verification, whichever element is computed first (#526 Q5)", () => {
    const [top, a, b, leaf] = [element(), element(), element(), element()];
    const setup: Setup = {
      children: new Map([
        [top, [a]],
        [a, [b]],
        [b, [a, leaf]],
      ]),
      records: [record(leaf, "passed")],
    };
    const expected = new Map<ElementRecord, VerificationResult>([
      [top, { status: "open", missingChildren: [a.id] }],
      [a, { status: "open", missingChildren: [b.id] }],
      [b, { status: "open", missingChildren: [a.id] }],
    ]);
    for (const first of [top, a, b]) {
      const evaluate = evaluator(setup);
      const order = [first, ...[top, a, b].filter((e) => e !== first)];
      expect(new Map(order.map((e) => [e, evaluate(e, CORE)]))).toEqual(expected);
    }
  });

  it("an element that is its own child is not indirect", () => {
    const self = element();
    expect(evaluator({ children: new Map([[self, [self]]]) })(self, CORE)).toEqual({
      status: "open",
      missingChildren: [self.id],
    });
  });

  it("a chain of 10,000 levels does not overflow the stack", () => {
    const head = element();
    const chain = [head, ...Array.from({ length: 9_999 }, () => element())];
    const leaf = element();
    const children = new Map(chain.map((e, i) => [e, [chain[i + 1] ?? leaf]]));
    const evaluate = evaluator({ children, records: [record(leaf, "passed")] });
    expect(evaluate(head, CORE)).toEqual(indirect);
  });

  it("without child rules (no derivation meaning) a requirement without record is open, nothing is indirect", () => {
    const [parent, child] = [element(), element()];
    const evaluate = evaluator({ noRules: true, records: [record(child, "passed")] });
    expect(evaluate(parent, CORE)).toEqual({ status: "open" });
    expect(evaluate(child, CORE)).toEqual({ status: "verified" });
  });

  it("the version shown overrides the current version of that element only and is never kept (S1)", () => {
    const [parent, child] = [element(), element()];
    const evaluate = evaluator({
      children: new Map([[parent, [child]]]),
      records: [record(child, "passed")],
    });
    expect(evaluate(child, CORE, { current: "n1:2222222222222222" })).toEqual({ status: "outdated" });
    expect(evaluate(child, CORE, { current: undefined })).toEqual({ status: "outdated" });
    expect(evaluate(parent, CORE)).toEqual(indirect);
    expect(evaluate(child, CORE)).toEqual({ status: "verified" });
    // A parent without own record does not depend on its own version.
    expect(evaluate(parent, CORE, { current: "n1:2222222222222222" })).toEqual(indirect);
  });

  it("gives nothing for an element that is no requirement or does not apply in the view", () => {
    const evaluate = evaluator({});
    expect(evaluate(element({}, "need"), CORE)).toBeUndefined();
    expect(evaluate(element({ validity: [{ id: V }] }), CORE)).toBeUndefined();
  });
});

describe("emergent requirements need their own record (SR-035)", () => {
  const EMERGENT = { emergent: "yes" } as const;

  it("[SR-035/AK1] an emergent requirement without own record whose children are all verified is open, not indirect", () => {
    const [emergent, a, b] = [element(EMERGENT), element(), element()];
    const evaluate = evaluator({
      children: new Map([[emergent, [a, b]]]),
      records: [record(a, "passed"), record(b, "passed")],
    });
    expect(evaluate(emergent, CORE)?.status).toBe("open");
    expect(evaluate(a, CORE)).toEqual({ status: "verified" });
  });

  it("[SR-035/AK1] an emergent requirement without own record names no missing children", () => {
    const [emergent, verified, failed, none] = [element(EMERGENT), element(), element(), element()];
    const evaluate = evaluator({
      children: new Map([[emergent, [verified, failed, none]]]),
      records: [record(verified, "passed"), record(failed, "failed")],
    });
    expect(evaluate(emergent, CORE)).toEqual({ status: "open" });
  });

  it("[SR-035/AK1] an emergent requirement with its own passed record of the current version is verified", () => {
    const [emergent, child] = [element(EMERGENT), element()];
    const evaluate = evaluator({
      children: new Map([[emergent, [child]]]),
      records: [record(emergent, "passed"), record(child, "passed")],
    });
    expect(evaluate(emergent, CORE)).toEqual({ status: "verified" });
    const older = evaluator({
      children: new Map([[emergent, [child]]]),
      records: [record(emergent, "passed", { version: OLDER }), record(child, "passed")],
    });
    expect(older(emergent, CORE)).toEqual({ status: "outdated" });
  });

  it("[SR-035/AK1] a parent whose emergent child has no own record is not indirect and names that child", () => {
    const [parent, emergent, grandchild, sibling] = [element(), element(EMERGENT), element(), element()];
    const evaluate = evaluator({
      children: new Map([
        [parent, [emergent, sibling]],
        [emergent, [grandchild]],
      ]),
      records: [record(grandchild, "passed"), record(sibling, "passed")],
    });
    expect(evaluate(parent, CORE)).toEqual({ status: "open", missingChildren: [emergent.id] });
    expect(evaluate(emergent, CORE)).toEqual({ status: "open" });
    // With its own record the emergent child counts as verified for its parent.
    const own = evaluator({
      children: new Map([
        [parent, [emergent, sibling]],
        [emergent, [grandchild]],
      ]),
      records: [record(emergent, "passed"), record(sibling, "passed")],
    });
    expect(own(parent, CORE)).toEqual(indirect);
  });

  it("[SR-035/AK1] in a variant view an emergent requirement needs a record for that variant; its core record does not count there", () => {
    const [emergent, child] = [element(EMERGENT), element()];
    const evaluate = evaluator({
      children: new Map([[emergent, [child]]]),
      records: [record(emergent, "passed"), record(child, "passed"), record(child, "passed", { variant: V })],
    });
    expect(evaluate(emergent, CORE)).toEqual({ status: "verified" });
    expect(evaluate(emergent, IN_V)).toEqual({ status: "open" });
    const inV = evaluator({
      children: new Map([[emergent, [child]]]),
      records: [record(emergent, "passed", { variant: V }), record(child, "passed")],
    });
    expect(inV(emergent, IN_V)).toEqual({ status: "verified" });
    expect(inV(emergent, CORE)).toEqual({ status: "open" });
  });

  it("an own passed record decides also when a child failed (#591 Q2)", () => {
    const [emergent, child] = [element(EMERGENT), element()];
    const evaluate = evaluator({
      children: new Map([[emergent, [child]]]),
      records: [record(emergent, "passed"), record(child, "failed")],
    });
    expect(evaluate(emergent, CORE)).toEqual({ status: "verified" });
  });

  it.each([
    ["no", { emergent: "no" }],
    ["an absent value", {}],
    ["the display name Yes", { emergent: "Yes" }],
  ])("%s is no mark: the requirement is indirect as before (#591 Q1)", (_name, more) => {
    const [parent, child] = [element(more), element()];
    const evaluate = evaluator({
      children: new Map([[parent, [child]]]),
      records: [record(child, "passed")],
    });
    expect(evaluate(parent, CORE)).toEqual(indirect);
  });

  it("without a property with the meaning emergent nothing is emergent and nothing fails", () => {
    const [parent, child] = [element(EMERGENT), element()];
    const evaluate = evaluator({
      children: new Map([[parent, [child]]]),
      records: [record(child, "passed")],
      emergentKey: null,
    });
    expect(evaluate(parent, CORE)).toEqual(indirect);
  });

  it("the mark follows the property with the meaning, whatever its key", () => {
    const [parent, child] = [element({ "emergent-behaviour": "yes" }), element()];
    const setup: Setup = { children: new Map([[parent, [child]]]), records: [record(child, "passed")] };
    expect(evaluator(setup)(parent, CORE)).toEqual(indirect);
    expect(evaluator({ ...setup, emergentKey: "emergent-behaviour" })(parent, CORE)).toEqual({
      status: "open",
    });
  });

  it("an emergent requirement on a derivation cycle ends", () => {
    const [top, a, b, leaf] = [element(), element(EMERGENT), element(), element()];
    const evaluate = evaluator({
      children: new Map([
        [top, [a]],
        [a, [b]],
        [b, [a, leaf]],
      ]),
      records: [record(leaf, "passed")],
    });
    expect(evaluate(b, CORE)).toEqual({ status: "open", missingChildren: [a.id] });
    expect(evaluate(a, CORE)).toEqual({ status: "open" });
    expect(evaluate(top, CORE)).toEqual({ status: "open", missingChildren: [a.id] });
  });
});

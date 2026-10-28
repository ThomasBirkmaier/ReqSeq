// The verification degree (SR-037, ADR-0012 "Status rules") as a pure function of a status source and
// an evaluator made by hand: which elements count, the count per status and the share. The command
// (`evidence.degree`) on record files is tested in commands/evidence/degree.test.ts.
import { describe, expect, it } from "vitest";
import type { VerificationStatus } from "../generated/types.js";
import type { ElementRecord } from "../model/index.js";
import type { View } from "../variants/index.js";
import { countedIn, degreeOf, viewIdOf } from "./degree.js";
import type { VerificationEvaluator } from "./indirect.js";
import type { StatusSource } from "./status.js";

const P = "37373737-3737-4737-8737-0000000";
const V = `${P}0c001`;
const CORE: View = { kind: "core" };
const IN_V: View = { kind: "variant", variant: { id: V, repository: "system" } };

let next = 0;

/** An element of the repository `system`: a requirement (type `req`) with status draft unless given. */
const element = (status = "draft", type = "req"): ElementRecord => {
  next += 1;
  const id = `${P}${next.toString(16).padStart(5, "0")}`;
  return {
    id,
    type,
    repository: "system",
    file: `${id}.md`,
    data: { id, type, status },
    eol: "\n",
    closingEol: "\n",
    bom: false,
    snapshot: { path: `${id}.md`, size: 0, mtimeMs: 0, sha256: "0".repeat(64) },
  };
};

const SOURCE: StatusSource = {
  requirements: new Set(["req", "sub-req"]),
  needs: new Set(["need"]),
  invalid: new Set(["obsolete", "rejected"]),
  validity: undefined,
  recordsOf: () => [],
  emergent: () => false,
};

/**
 * A status as the shared evaluator would give it: `statuses` per element in the core; an element not in
 * `statuses` has none (it does not apply in the view). Variants: `inV` per element.
 */
const statusOf = (
  statuses: ReadonlyMap<ElementRecord, VerificationStatus>,
  inV: ReadonlyMap<ElementRecord, VerificationStatus> = new Map(),
): { source: StatusSource; evaluate: VerificationEvaluator } => ({
  source: SOURCE,
  evaluate: (e, view) => {
    const status = (view.kind === "core" ? statuses : inV).get(e);
    return status === undefined ? undefined : { status };
  },
});

/** `n` requirements with `status` each. */
const many = (n: number, status: VerificationStatus): [ElementRecord, VerificationStatus][] =>
  Array.from({ length: n }, () => [element(), status]);

describe("degreeOf (SR-037)", () => {
  it("[SR-037/AK1] 6 verified, 1 failed, 1 outdated and 2 open of 10 requirements give 0.6 and the count per status", () => {
    const statuses = new Map([
      ...many(6, "verified"),
      ...many(1, "failed"),
      ...many(1, "outdated"),
      ...many(2, "open"),
    ]);
    expect(degreeOf(statusOf(statuses), [...statuses.keys()], CORE)).toEqual({
      share: 0.6,
      total: 10,
      counts: { open: 2, verified: 6, indirect: 0, failed: 1, outdated: 1 },
    });
  });

  it("[SR-037/AK2] indirect requirements count as verified in the share and have a count of their own", () => {
    const statuses = new Map([...many(2, "verified"), ...many(1, "indirect"), ...many(1, "open")]);
    expect(degreeOf(statusOf(statuses), [...statuses.keys()], CORE)).toEqual({
      share: 0.75,
      total: 4,
      counts: { open: 1, verified: 2, indirect: 1, failed: 0, outdated: 0 },
    });
  });

  it("[SR-037/AK3] requirements whose status is marked invalid count neither in the share nor in the counts", () => {
    const valid = new Map([...many(1, "verified"), ...many(1, "open")]);
    // Verified but obsolete, failed but rejected: both marked invalid by the metamodel (D-044).
    const invalid = new Map<ElementRecord, VerificationStatus>([
      [element("obsolete"), "verified"],
      [element("rejected"), "failed"],
    ]);
    const all = new Map([...valid, ...invalid]);
    expect(degreeOf(statusOf(all), [...all.keys()], CORE)).toEqual({
      share: 0.5,
      total: 2,
      counts: { open: 1, verified: 1, indirect: 0, failed: 0, outdated: 0 },
    });
  });

  it("does not count elements of other types: needs, packages (#592 Q2)", () => {
    const need = element("draft", "need");
    const pkg = element("draft", "package");
    const sub = element("draft", "sub-req");
    const statuses = new Map<ElementRecord, VerificationStatus>([
      [need, "verified"],
      [pkg, "verified"],
      [sub, "open"],
    ]);
    expect(degreeOf(statusOf(statuses), [need, pkg, sub], CORE)).toEqual({
      share: 0,
      total: 1,
      counts: { open: 1, verified: 0, indirect: 0, failed: 0, outdated: 0 },
    });
  });

  it("does not count a requirement without a status in the view (#592 Q1)", () => {
    const both = element();
    const coreOnly = element();
    const vOnly = element();
    const status = statusOf(
      new Map<ElementRecord, VerificationStatus>([
        [both, "verified"],
        [coreOnly, "failed"],
      ]),
      new Map<ElementRecord, VerificationStatus>([
        [both, "open"],
        [vOnly, "verified"],
      ]),
    );
    expect(degreeOf(status, [both, coreOnly, vOnly], CORE)).toMatchObject({
      share: 0.5,
      total: 2,
      counts: { verified: 1, failed: 1 },
    });
    expect(degreeOf(status, [both, coreOnly, vOnly], IN_V)).toMatchObject({
      share: 0.5,
      total: 2,
      counts: { verified: 1, open: 1 },
    });
  });

  it("gives no share and five zero counts when nothing is counted (#592 Q3)", () => {
    const empty = { total: 0, counts: { open: 0, verified: 0, indirect: 0, failed: 0, outdated: 0 } };
    expect(degreeOf(statusOf(new Map()), [], CORE)).toEqual(empty);
    expect(degreeOf(statusOf(new Map()), [element("obsolete"), element("draft", "need")], CORE)).toEqual(
      empty,
    );
  });

  it("the counts add up to total, whatever the order of the elements", () => {
    const statuses = new Map([
      ...many(3, "verified"),
      ...many(2, "indirect"),
      ...many(4, "failed"),
      ...many(1, "outdated"),
      ...many(5, "open"),
    ]);
    const elements = [...statuses.keys()];
    const forward = degreeOf(statusOf(statuses), elements, CORE);
    const backward = degreeOf(statusOf(statuses), [...elements].reverse(), CORE);
    expect(backward).toEqual(forward);
    expect(Object.values(forward.counts).reduce((a, b) => a + b, 0)).toBe(forward.total);
    expect(forward).toEqual({
      share: 5 / 15,
      total: 15,
      counts: { open: 5, verified: 3, indirect: 2, failed: 4, outdated: 1 },
    });
  });
});

describe("countedIn and viewIdOf (SR-037)", () => {
  it("countedIn keeps the requirements whose status is not marked invalid, in their order", () => {
    const [a, obsolete, need, b, noStatus] = [
      element(),
      element("obsolete"),
      element("draft", "need"),
      element("draft", "sub-req"),
      element(""),
    ];
    expect(countedIn(SOURCE, [a, obsolete, need, b, noStatus])).toEqual([a, b, noStatus]);
  });

  it("viewIdOf names the core and a variant by its UUID", () => {
    expect([viewIdOf(CORE), viewIdOf(IN_V)]).toEqual(["core", V]);
  });
});

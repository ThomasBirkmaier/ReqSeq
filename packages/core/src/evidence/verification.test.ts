// The verification state of a workspace (SR-031, SR-034; `verification.ts`): which current versions
// `prepare` reads, how often, and the entries `verificationOf` gives. The commands are tested in
// commands/evidence/status.test.ts and commands/evidence/indirect.test.ts.
import { describe, expect, it } from "vitest";
import type { CurrentVersion, ElementRecord } from "../model/index.js";
import { isEmergent } from "../model/index.js";
import { evidenceIndex } from "./by-element.js";
import type { ChildRules } from "./indirect.js";
import type { EvidenceRecord } from "./record.js";
import type { StatusSource } from "./status.js";
import type { VersionReader } from "./verification.js";
import { verificationOf, workspaceStatusOf } from "./verification.js";

const P = "34343434-3434-4434-8434-0000000";
const V = `${P}0c001`;
const CURRENT = "n1:1111111111111111";

let next = 0;

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

const passed = (of: ElementRecord, more: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  element: of.id,
  version: CURRENT,
  kind: "verification",
  method: "test",
  item: "build-1",
  result: "passed",
  date: "2026-10-27T10:00:00Z",
  ...more,
});

const sourceOf = (records: readonly EvidenceRecord[]): StatusSource => {
  const index = evidenceIndex(records);
  return {
    requirements: new Set(["req"]),
    needs: new Set(["need"]),
    validity: { key: "validity", many: true, label: "property Validity (validity)" },
    recordsOf: (id) => index.byElement.get(id) ?? [],
    emergent: (e) => isEmergent(e, "emergent"),
  };
};

const rulesOf = (children: ReadonlyMap<ElementRecord, readonly ElementRecord[]>): ChildRules => ({
  childrenOf: (e) => children.get(e) ?? [],
  counts: (e) => e.data["status"] !== "obsolete",
});

/** A reader that gives CURRENT for every element (`unknown` for those in `unknown`) and logs what it was asked. */
const reader = (unknown: ReadonlySet<ElementRecord> = new Set()) => {
  const asked: ElementRecord[][] = [];
  const read: VersionReader = (records) => {
    asked.push([...records]);
    return Promise.resolve(
      new Map(
        records.map((r): [ElementRecord, CurrentVersion] => [
          r,
          unknown.has(r)
            ? { kind: "unknown", reason: "not-computable", message: "no normal form" }
            : { kind: "version", version: CURRENT, images: [] },
        ]),
      ),
    );
  };
  return { asked, read };
};

describe("workspaceStatusOf: current versions (SR-034, plan review B1)", () => {
  it("reads the versions of the children with records below the elements shown, once, in one batch", async () => {
    const [top, middle, leaf, other, recordedParent, below, lone] = [
      element(),
      element(),
      element(),
      element(),
      element(),
      element(),
      element(),
    ];
    const { asked, read } = reader();
    const status = workspaceStatusOf(
      sourceOf([passed(leaf), passed(other), passed(recordedParent), passed(lone)]),
      [],
      rulesOf(
        new Map([
          [top, [middle, other, recordedParent]],
          [middle, [leaf]],
          [recordedParent, [below]],
        ]),
      ),
      read,
    );
    await status.prepare([top]);
    // Not below `recordedParent`: its own record decides.
    expect(asked).toEqual([[other, recordedParent, leaf]]);
    expect(status.evaluate(middle, { kind: "core" })).toEqual({ status: "indirect" });
    await status.prepare([top]);
    await status.prepare([middle]);
    expect(status.versionBatches()).toBe(1);
    // An element shown is measured against the version shown; with `own` its version is read too.
    await status.prepare([lone]);
    expect(status.versionBatches()).toBe(1);
    await status.prepare([lone, top], { own: true });
    expect(asked).toEqual([[other, recordedParent, leaf], [lone]]);
    expect(status.versionBatches()).toBe(2);
  });

  it("walks below an element with a record in the core when a variant view has none", async () => {
    const [parent, child] = [element(), element()];
    const variant = element({}, "variant");
    const { asked, read } = reader();
    const status = workspaceStatusOf(
      sourceOf([passed(parent), passed(child, { variant: V })]),
      [variant],
      rulesOf(new Map([[parent, [child]]])),
      read,
    );
    await status.prepare([parent]);
    expect(asked).toEqual([[child]]);
  });

  it("reads nothing for elements that are no requirement, children that do not count or without child rules", async () => {
    const [need, parent, obsolete] = [element({}, "need"), element(), element({ status: "obsolete" })];
    const { asked, read } = reader();
    const records = [passed(obsolete), passed(need)];
    const status = workspaceStatusOf(
      sourceOf(records),
      [],
      rulesOf(
        new Map([
          [parent, [obsolete]],
          [need, [obsolete]],
        ]),
      ),
      read,
    );
    await status.prepare([need, parent], { own: true });
    const none = workspaceStatusOf(sourceOf(records), [], undefined, read);
    await none.prepare([parent], { own: true });
    expect(asked).toEqual([]);
  });

  it("keeps an unknown version as none: the child's records are of another version", async () => {
    const [parent, child] = [element(), element()];
    const { read } = reader(new Set([child]));
    const status = workspaceStatusOf(
      sourceOf([passed(child)]),
      [],
      rulesOf(new Map([[parent, [child]]])),
      read,
    );
    await status.prepare([parent]);
    expect(status.evaluate(parent, { kind: "core" })).toEqual({
      status: "open",
      missingChildren: [child.id],
    });
  });

  it("walks again after a failed read, and runs one prepare at a time", async () => {
    const [parent, child] = [element(), element()];
    let fail = true;
    const { asked, read } = reader();
    const status = workspaceStatusOf(
      sourceOf([passed(child)]),
      [],
      rulesOf(new Map([[parent, [child]]])),
      (records) => {
        if (fail) {
          fail = false;
          return Promise.reject(new Error("read failed"));
        }
        return read(records);
      },
    );
    const first = status.prepare([parent]);
    const second = status.prepare([parent]);
    await expect(first).rejects.toThrow("read failed");
    await second;
    expect(asked).toEqual([[child]]);
    expect(status.evaluate(parent, { kind: "core" })).toEqual({ status: "indirect" });
  });

  it("walks a chain of 10,000 levels without overflowing the stack", async () => {
    const head = element();
    const chain = [head, ...Array.from({ length: 9_999 }, () => element())];
    const leaf = element();
    const { asked, read } = reader();
    const status = workspaceStatusOf(
      sourceOf([passed(leaf)]),
      [],
      rulesOf(new Map(chain.map((e, i) => [e, [chain[i + 1] ?? leaf]]))),
      read,
    );
    await status.prepare([head]);
    expect(asked).toEqual([[leaf]]);
    expect(status.evaluate(head, { kind: "core" })).toEqual({ status: "indirect" });
  });

  it("prepare reads no version below an emergent requirement without own record (SR-035)", async () => {
    const [emergent, a, b, recorded, child] = [
      element({ emergent: "yes" }),
      element(),
      element(),
      element({ emergent: "yes" }),
      element(),
    ];
    const { asked, read } = reader();
    const status = workspaceStatusOf(
      sourceOf([passed(a), passed(b), passed(recorded), passed(child)]),
      [],
      rulesOf(
        new Map([
          [emergent, [a, b]],
          [recorded, [child]],
        ]),
      ),
      read,
    );
    await status.prepare([emergent]);
    expect(status.versionBatches()).toBe(0);
    expect(status.evaluate(emergent, { kind: "core" })).toEqual({ status: "open" });
    // With its own record only its own version is read, never its children's.
    await status.prepare([recorded], { own: true });
    expect(asked).toEqual([[recorded]]);
    expect(status.evaluate(recorded, { kind: "core" })).toEqual({ status: "verified" });
  });
});

describe("verificationOf (SR-031, SR-034)", () => {
  it("gives the core and each variant the element applies in, with the missing children; nothing for no requirement", async () => {
    const variant = element({}, "variant");
    const [parent, child] = [element(), element({ validity: [{ id: variant.id }] })];
    const status = workspaceStatusOf(
      sourceOf([]),
      [variant],
      rulesOf(new Map([[parent, [child]]])),
      reader().read,
    );
    await status.prepare([parent]);
    expect(verificationOf(status, parent)).toEqual([
      { view: "core", status: "open" },
      { view: variant.id, status: "open", missingChildren: [child.id] },
    ]);
    expect(verificationOf(status, child)).toEqual([{ view: variant.id, status: "open" }]);
    expect(verificationOf(status, variant)).toBeUndefined();
  });
});

describe("workspaceStatusOf: validation status (SR-038)", () => {
  const validation = (of: ElementRecord, more: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
    element: of.id,
    version: CURRENT,
    kind: "validation",
    result: "passed",
    date: "2026-10-27T10:00:00Z",
    ...more,
  });

  it("[SR-038/AK3] a need without validation record is open, any element with a validation record has its status", async () => {
    const [need, requirement, useCase] = [element({}, "need"), element(), element({}, "use-case")];
    const status = workspaceStatusOf(
      sourceOf([validation(requirement), validation(useCase, { result: "failed" })]),
      [],
      undefined,
      reader().read,
    );
    await status.prepare([need, requirement, useCase], { own: true });
    expect([status.validate(need), status.validate(requirement), status.validate(useCase)]).toEqual([
      "open",
      "validated",
      "failed",
    ]);
  });

  it("a requirement or other element without validation record has no validation status (#534)", () => {
    const status = workspaceStatusOf(sourceOf([passed(element())]), [], undefined, reader().read);
    expect([status.validate(element()), status.validate(element({}, "use-case"))]).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("a validation record with a variant gives no status to a non-need, and open to a need (#534 Q2)", () => {
    const [need, requirement] = [element({}, "need"), element()];
    const status = workspaceStatusOf(
      sourceOf([validation(need, { variant: V }), validation(requirement, { variant: V })]),
      [],
      undefined,
      reader().read,
    );
    expect([status.validate(need, { current: CURRENT }), status.validate(requirement)]).toEqual([
      "open",
      undefined,
    ]);
  });

  it("prepare with own reads the versions of validation-recorded elements in the one batch, once", async () => {
    const [need, requirement, other] = [element({}, "need"), element(), element({}, "use-case")];
    const { asked, read } = reader();
    const status = workspaceStatusOf(
      sourceOf([validation(need), passed(requirement), validation(other)]),
      [],
      undefined,
      read,
    );
    await status.prepare([need, requirement, other], { own: true });
    await status.prepare([need, requirement, other], { own: true });
    expect(asked).toEqual([[need, requirement, other]]);
    expect(status.versionBatches()).toBe(1);
  });

  it("the child walk does not read the version of a child that has only a validation record (S4)", async () => {
    const [parent, child] = [element(), element()];
    const { asked, read } = reader();
    const status = workspaceStatusOf(
      sourceOf([validation(child)]),
      [],
      rulesOf(new Map([[parent, [child]]])),
      read,
    );
    await status.prepare([parent]);
    expect(asked).toEqual([]);
    expect(status.versionBatches()).toBe(0);
  });

  it("validate measures against the version shown, also when it has none, and never keeps it (S2)", async () => {
    const need = element({}, "need");
    const status = workspaceStatusOf(sourceOf([validation(need)]), [], undefined, reader().read);
    await status.prepare([need], { own: true });
    expect(status.validate(need)).toBe("validated");
    expect(status.validate(need, { current: undefined })).toBe("outdated");
    expect(status.validate(need, { current: "n1:2222222222222222" })).toBe("outdated");
    expect(status.validate(need)).toBe("validated");
    expect(status.versionBatches()).toBe(1);
  });
});

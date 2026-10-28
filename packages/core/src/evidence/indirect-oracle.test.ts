// The indirect verification (SR-034) with the views sharing their work (#698) against the evaluator
// before #698 as the reference, copied below verbatim (only renamed): for every element and view of
// seeded random workspaces (derivation cycles and self-loops, twins, emergent elements, invalid
// statuses, validities of every shape, records in the core and per variant) and of a small generated
// workspace of the performance suite, the result is the same, in any order of first evaluation. Plus
// the work the shared views save, counted, never timed (ADR-0011).
import type { CurrentVersion } from "../model/index.js";
import { generateLargeWorkspace, withEvidenceRecords, writeLargeWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { metamodelState } from "../metamodel/index.js";
import type { ElementRecord } from "../model/index.js";
import { currentVersionsOf, elementStoreState, isEmergent } from "../model/index.js";
import { Workspace } from "../runtime/workspace.js";
import { traceContext } from "../trace/index.js";
import type { View } from "../variants/index.js";
import { appliesIn, variantsOf } from "../variants/index.js";
import { evidenceIndex, evidenceIndexState } from "./by-element.js";
import type { ChildRules, VerificationEvaluator, VerificationResult } from "./indirect.js";
import { childRulesOf, verificationEvaluator } from "./indirect.js";
import type { EvidenceRecord } from "./record.js";
import type { StatusSource } from "./status.js";
import { holdsIn, statusSource, verificationStatusOf } from "./status.js";
import { workspaceStatusOf } from "./verification.js";

// ---- The reference: evidence/indirect.ts before #698, verbatim from here to the end marker. ----

/** Whether `element` has a verification record that holds in `view` (rule 1). */
const referenceHasOwn = (source: StatusSource, element: ElementRecord, view: View): boolean =>
  source.recordsOf(element.id).some((r) => r.kind === "verification" && holdsIn(r, view));

const OPEN: VerificationResult = Object.freeze({ status: "open" });
const INDIRECT: VerificationResult = Object.freeze({ status: "indirect" });
const NONE: readonly never[] = Object.freeze([]);

/** One element of the walk: its counted children and how many of them were looked at. */
interface Frame {
  readonly key: string;
  readonly children: readonly ElementRecord[];
  next: number;
}

/** The key of an element's children: its repository and UUID (twins of one repository share them, SR-088). */
const nodeKey = (element: ElementRecord): string => `${element.repository}\u0000${element.id}`;

/**
 * The evaluator of `source` with `children` (undefined: no element has children) and the current
 * version of each element (`currentOf`; only asked for requirements with records). Results computed
 * from children are kept per view and element for the life of the evaluator, so `currentOf` must not
 * change while it lives (the evidence block builds one per state of store, metamodel and records).
 */
const referenceEvaluator = (
  source: StatusSource,
  children: ChildRules | undefined,
  currentOf: (element: ElementRecord) => string | undefined,
): VerificationEvaluator => {
  const memos = new Map<string, Map<string, VerificationResult>>();
  const memoOf = (view: View): Map<string, VerificationResult> => {
    const key = view.kind === "core" ? "" : `${view.variant.repository}\u0000${view.variant.id}`;
    let memo = memos.get(key);
    if (memo === undefined) {
      memo = new Map();
      memos.set(key, memo);
    }
    return memo;
  };

  const counted = (element: ElementRecord, view: View): readonly ElementRecord[] => {
    if (children === undefined || source.emergent(element)) {
      return NONE;
    }
    const seen = new Set<ElementRecord>();
    return children.childrenOf(element).filter((child) => {
      const counts =
        !seen.has(child) &&
        source.requirements.has(child.type) &&
        children.counts(child) &&
        appliesIn(source.validity, child, view);
      seen.add(child);
      return counts;
    });
  };

  /** The status of a counted child, once its walk is done; one being computed counts as open (rule 6). */
  const childStatus = (child: ElementRecord, view: View, memo: ReadonlyMap<string, VerificationResult>) =>
    referenceHasOwn(source, child, view)
      ? verificationStatusOf(source.recordsOf(child.id), currentOf(child), view)
      : (memo.get(nodeKey(child))?.status ?? "open");

  const fromChildren = (
    frame: Frame,
    view: View,
    memo: ReadonlyMap<string, VerificationResult>,
  ): VerificationResult => {
    if (frame.children.length === 0) {
      return OPEN;
    }
    const missing = new Set<string>();
    for (const child of frame.children) {
      const status = childStatus(child, view, memo);
      if (status !== "verified" && status !== "indirect") {
        missing.add(child.id);
      }
    }
    return missing.size === 0 ? INDIRECT : { status: "open", missingChildren: [...missing] };
  };

  /** The status of `root`, which has no own record in `view`, from its children (rules 2 to 6). */
  const derived = (root: ElementRecord, view: View): VerificationResult => {
    const memo = memoOf(view);
    const known = memo.get(nodeKey(root));
    if (known !== undefined) {
      return known;
    }
    const onStack = new Set<string>();
    const stack: Frame[] = [];
    const enter = (element: ElementRecord): void => {
      const key = nodeKey(element);
      onStack.add(key);
      stack.push({ key, children: counted(element, view), next: 0 });
    };
    enter(root);
    let result = OPEN;
    for (let frame = stack.at(-1); frame !== undefined; frame = stack.at(-1)) {
      const child = frame.children[frame.next];
      if (child !== undefined) {
        frame.next += 1;
        const key = nodeKey(child);
        if (!referenceHasOwn(source, child, view) && !memo.has(key) && !onStack.has(key)) {
          enter(child);
        }
        continue;
      }
      result = fromChildren(frame, view, memo);
      memo.set(frame.key, result);
      onStack.delete(frame.key);
      stack.pop();
    }
    return result;
  };

  return (element, view, shown) => {
    if (!source.requirements.has(element.type) || !appliesIn(source.validity, element, view)) {
      return undefined;
    }
    if (referenceHasOwn(source, element, view)) {
      const current = shown === undefined ? currentOf(element) : shown.current;
      return { status: verificationStatusOf(source.recordsOf(element.id), current, view) };
    }
    return derived(element, view);
  };
};

// ---- End of the reference. ----

/** A seeded generator: the same workspace for the same seed. */
const randomOf = (seed: number) => {
  let state = seed;
  const next = (n: number): number => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return Math.floor((state / 2147483648) * n);
  };
  return {
    next,
    pick: <T>(values: readonly T[]): T => values[next(values.length)] as T,
    chance: (p: number): boolean => next(1000) < p * 1000,
    shuffled: <T>(values: readonly T[]): T[] => {
      const copy = [...values];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = next(i + 1);
        [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
      }
      return copy;
    },
  };
};

const P = "4e4e4e4e-4e4e-4e4e-8e4e-";
const uuid = (n: number): string => `${P}${n.toString(16).padStart(12, "0")}`;
const CURRENT = "n1:1111111111111111";
const OLDER = "n1:0000000000000000";
const CORE: View = { kind: "core" };

const elementOf = (
  id: string,
  repository: string,
  type: string,
  data: Readonly<Record<string, unknown>>,
): ElementRecord => ({
  id,
  type,
  repository,
  file: `${repository}/${id}-${String(Math.random()).slice(2, 8)}.md`,
  data: { id, type, status: "draft", ...data },
  eol: "\n",
  closingEol: "\n",
  bom: false,
  snapshot: { path: `${id}.md`, size: 0, mtimeMs: 0, sha256: "0".repeat(64) },
});

interface Generated {
  readonly source: StatusSource;
  readonly children: ChildRules;
  readonly elements: readonly ElementRecord[];
  readonly views: readonly View[];
  readonly currentOf: (element: ElementRecord) => string | undefined;
}

type Random = ReturnType<typeof randomOf>;

/** The requirements (and a few needs) with random validities, emergent marks and invalid statuses; some twins. */
const randomElements = (random: Random, validities: readonly unknown[]): ElementRecord[] => {
  const count = 40 + random.next(120);
  const elements: ElementRecord[] = [];
  for (let n = 0; n < count; n += 1) {
    const validity = random.pick(validities);
    const data = {
      ...(validity === undefined ? {} : { validity }),
      ...(random.chance(0.06) ? { emergent: "yes" } : {}),
      ...(random.chance(0.08) ? { status: "obsolete" } : {}),
    };
    const element = elementOf(
      uuid(n),
      random.chance(0.1) ? "other" : "system",
      random.chance(0.08) ? "need" : "req",
      data,
    );
    elements.push(element);
    // Twins: the same UUID once more, in the same or in another repository (SR-088).
    if (random.chance(0.04)) {
      elements.push(elementOf(element.id, random.pick(["system", "other"]), "req", data));
    }
  }
  return elements;
};

/** Mostly a tree downwards, sometimes an earlier element or the element itself: cycles and self-loops. */
const randomChildren = (random: Random, elements: readonly ElementRecord[]) => {
  const children = new Map<ElementRecord, ElementRecord[]>();
  elements.forEach((element, at) => {
    const list: ElementRecord[] = [];
    children.set(element, list);
    // Twins of one repository have no children (the trace block gives none for an ambiguous UUID).
    if (elements.filter((o) => o.id === element.id && o.repository === element.repository).length > 1) {
      return;
    }
    const later = elements.slice(at + 1);
    for (let i = random.pick([0, 0, 1, 2, 2, 3, 4]); i > 0; i -= 1) {
      list.push(random.chance(0.85) && later.length > 0 ? random.pick(later) : random.pick(elements));
    }
  });
  return children;
};

/** Verification and validation records, in the core, for a variant, or for a UUID that is no variant. */
const randomRecords = (
  random: Random,
  elements: readonly ElementRecord[],
  variantIds: readonly string[],
): EvidenceRecord[] =>
  elements.flatMap((element) =>
    Array.from({ length: random.pick([0, 0, 1, 1, 2, 3]) }, (): EvidenceRecord => ({
      element: element.id,
      version: random.pick([CURRENT, CURRENT, OLDER]),
      kind: random.chance(0.85) ? "verification" : "validation",
      method: "test",
      item: "build",
      result: random.chance(0.8) ? "passed" : "failed",
      date: random.pick(["2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", "not a date"]),
      ...(random.chance(0.6) ? {} : { variant: random.pick(variantIds) }),
    })),
  );

/** A random workspace (see the file comment) for `seed`. */
const generate = (seed: number): Generated => {
  const random = randomOf(seed);
  const variants = [1, 2, 3, 4, 5].map((n) => elementOf(uuid(9000 + n), "system", "variant", {}));
  const [first, second, third, fourth] = variants.map((v) => v.id);
  // A variant of the same UUID in another repository (validity names repository and UUID, a record the UUID).
  const twinVariant = elementOf(uuid(9001), "other", "variant", {});
  const unknownVariant = uuid(9999);
  const validities: readonly unknown[] = [
    undefined,
    undefined,
    undefined,
    null,
    [],
    "wrong shape",
    ["free text"],
    [{ id: unknownVariant }],
    ...variants.map((v) => [{ id: v.id }]),
    [{ id: twinVariant.id, repository: "other" }],
    [{ id: second }, { id: third, repository: "system" }],
    { id: fourth },
  ];
  const elements = randomElements(random, validities);
  const children = randomChildren(random, elements);
  const index = evidenceIndex(
    randomRecords(random, elements, [...variants.map((v) => v.id), unknownVariant]),
  );
  const versions = new Map(
    elements.map((e) => [e, random.pick([CURRENT, CURRENT, OLDER, undefined] as const)]),
  );
  const source: StatusSource = {
    requirements: new Set(["req"]),
    needs: new Set(["need"]),
    invalid: new Set(["obsolete"]),
    validity: { key: "validity", many: true, label: "property Validity (validity)" },
    recordsOf: (id) => index.byElement.get(id) ?? [],
    emergent: (e) => isEmergent(e, "emergent"),
  };
  const views: View[] = [
    CORE,
    ...[...variants, twinVariant].map((variant): View => ({ kind: "variant", variant })),
    // A variant given as another object than the store's (e.g. from an older store).
    { kind: "variant", variant: { id: second ?? first ?? "", repository: "system" } },
    { kind: "variant", variant: { id: unknownVariant, repository: "system" } },
  ];
  return {
    source,
    children: {
      childrenOf: (e) => children.get(e) ?? [],
      counts: (e) => e.data["status"] !== "obsolete",
    },
    elements,
    views,
    currentOf: (e) => versions.get(e),
  };
};

/** Every element in every view, in the given order, with and without a version shown. */
const resultsOf = (
  evaluate: VerificationEvaluator,
  pairs: readonly (readonly [ElementRecord, View])[],
): Map<string, VerificationResult | undefined> => {
  const results = new Map<string, VerificationResult | undefined>();
  for (const [element, view] of pairs) {
    const name = `${element.repository}:${element.file}:${view.kind === "core" ? "core" : `${view.variant.repository}/${view.variant.id}`}`;
    results.set(name, evaluate(element, view));
    results.set(`${name}:shown`, evaluate(element, view, { current: OLDER }));
  }
  return results;
};

const sorted = (results: Map<string, VerificationResult | undefined>) =>
  [...results].sort(([a], [b]) => (a < b ? -1 : 1));

describe("the shared views give the results of the evaluator before #698", () => {
  it("in every view of seeded random workspaces, in any order of first evaluation", () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const { source, children, elements, views, currentOf } = generate(seed);
      const random = randomOf(seed * 7);
      const pairs = elements.flatMap((e) => views.map((v) => [e, v] as const));
      const expected = resultsOf(referenceEvaluator(source, children, currentOf), random.shuffled(pairs));
      // The reference itself does not depend on the order (rule 6).
      expect(
        sorted(resultsOf(referenceEvaluator(source, children, currentOf), random.shuffled(pairs))),
      ).toEqual(sorted(expected));
      const actual = resultsOf(verificationEvaluator(source, children, currentOf), random.shuffled(pairs));
      expect(sorted(actual), `seed ${String(seed)}`).toEqual(sorted(expected));
      // Variant views first, then the core: the neutral results are built from another side.
      const variantsFirst = [...pairs].sort(
        ([, a], [, b]) => Number(a.kind === "core") - Number(b.kind === "core"),
      );
      expect(sorted(resultsOf(verificationEvaluator(source, children, currentOf), variantsFirst))).toEqual(
        sorted(expected),
      );
    }
  });

  it("without child rules (no derivation meaning, or an invalid metamodel)", () => {
    const { source, elements, views, currentOf } = generate(3);
    const pairs = elements.flatMap((e) => views.map((v) => [e, v] as const));
    expect(sorted(resultsOf(verificationEvaluator(source, undefined, currentOf), pairs))).toEqual(
      sorted(resultsOf(referenceEvaluator(source, undefined, currentOf), pairs)),
    );
  });

  it("with the versions read by prepare between the evaluations (workspaceStatusOf)", async () => {
    for (let seed = 1; seed <= 15; seed += 1) {
      const { source, children, elements, views, currentOf } = generate(seed);
      const variants = views.flatMap((v) => (v.kind === "variant" ? [v.variant as ElementRecord] : []));
      const status = workspaceStatusOf(source, variants.slice(0, 6), children, (records) =>
        Promise.resolve(
          new Map(
            records.flatMap((r): [ElementRecord, CurrentVersion][] => {
              const version = currentOf(r);
              return version === undefined ? [] : [[r, { kind: "version", version, images: [] }]];
            }),
          ),
        ),
      );
      const reference = referenceEvaluator(source, children, currentOf);
      const random = randomOf(seed);
      for (const element of random.shuffled(elements)) {
        await status.prepare([element], { own: true });
        for (const view of views.slice(0, 7)) {
          const shown = { current: currentOf(element) };
          expect(status.evaluate(element, view, shown), `seed ${String(seed)}`).toEqual(
            reference(element, view, shown),
          );
        }
      }
    }
  });

  it("in every view of a small workspace of the performance generator, with records for variants", async () => {
    const generated = withEvidenceRecords(
      generateLargeWorkspace({
        version: () => "n1:0000000000000000",
        seed: 698,
        elements: 1500,
        relations: 6000,
      }),
    );
    const fixture = await writeLargeWorkspace(generated.workspace);
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.workspaceRoot);
    onTestFinished(() => workspace.close());
    const [metamodel, store, read] = await Promise.all([
      workspace.get(metamodelState),
      workspace.get(elementStoreState),
      workspace.get(evidenceIndexState),
    ]);
    const variants = variantsOf(store, metamodel);
    expect(variants.length).toBeGreaterThan(1);
    // Records for variants too (the generator writes none): one in ten requirements, a random variant.
    const random = randomOf(698);
    const extra = store.elements
      .filter((e) => e.type === "system-requirement" && random.chance(0.1))
      .map((e): EvidenceRecord => ({
        element: e.id,
        version: "n1:0000000000000000",
        kind: "verification",
        method: "test",
        item: "build",
        result: "passed",
        date: "2026-01-01T00:00:00Z",
        variant: random.pick(variants).id,
      }));
    const versions = await currentVersionsOf(workspace, store.elements);
    const byId = new Map(store.elements.map((e) => [e.id, e]));
    const currentOf = (e: ElementRecord | undefined): string | undefined => {
      const entry = e === undefined ? undefined : versions.get(e);
      return entry?.kind === "version" ? entry.version : undefined;
    };
    // The generator stores a placeholder version: most records get the element's current one.
    const records = [...[...read.byElement.values()].flat(), ...extra].map((r) =>
      random.chance(0.8) ? { ...r, version: currentOf(byId.get(r.element)) ?? r.version } : r,
    );
    const index = evidenceIndex(records);
    const source = statusSource(metamodel, index);
    const children = childRulesOf(await traceContext(workspace));
    const views: View[] = [CORE, ...variants.map((variant): View => ({ kind: "variant", variant }))];
    const requirements = store.elements.filter((e) => source.requirements.has(e.type));
    const pairs = requirements.flatMap((e) => views.map((v) => [e, v] as const));
    const expected = resultsOf(referenceEvaluator(source, children, currentOf), pairs);
    expect([...expected.values()].some((r) => r?.status === "indirect")).toBe(true);
    expect(
      sorted(resultsOf(verificationEvaluator(source, children, currentOf), random.shuffled(pairs))),
    ).toEqual(sorted(expected));
  }, 60_000);
});

describe("the work the shared views save (#698)", () => {
  it("walks the subtree once for all variants without seeds, not once per variant", () => {
    // A tree of 1 + 4 + 16 + 64 + 256 requirements with records on the leaves, and 20 variants of
    // which one is named by the validity of one leaf. Counted: reads of the validity property, one
    // per child in each view the walk enters.
    let reads = 0;
    const counting = (data: Record<string, unknown>): Record<string, unknown> =>
      new Proxy(data, {
        get: (target, key, receiver) => {
          if (key === "validity") {
            reads += 1;
          }
          return Reflect.get(target, key, receiver) as unknown;
        },
      });
    const variants = Array.from({ length: 20 }, (_, n) => elementOf(uuid(8000 + n), "system", "variant", {}));
    let n = 0;
    const make = (): ElementRecord => {
      const element = elementOf(uuid(n), "system", "req", {});
      n += 1;
      return { ...element, data: counting({ ...element.data }) };
    };
    const children = new Map<ElementRecord, ElementRecord[]>();
    const root = make();
    let level = [root];
    for (let depth = 0; depth < 4; depth += 1) {
      const next: ElementRecord[] = [];
      for (const parent of level) {
        const list = [make(), make(), make(), make()];
        children.set(parent, list);
        next.push(...list);
      }
      level = next;
    }
    const [seeded] = level;
    if (seeded !== undefined) {
      (seeded.data as Record<string, unknown>)["validity"] = [{ id: variants[0]?.id }];
    }
    const index = evidenceIndex(
      level.map((leaf) => ({
        element: leaf.id,
        version: CURRENT,
        kind: "verification" as const,
        method: "test" as const,
        item: "build",
        result: "passed" as const,
        date: "2026-01-01T00:00:00Z",
      })),
    );
    const source: StatusSource = {
      requirements: new Set(["req"]),
      needs: new Set(),
      invalid: new Set(),
      validity: { key: "validity", many: true, label: "property Validity (validity)" },
      recordsOf: (id) => index.byElement.get(id) ?? [],
      emergent: () => false,
    };
    const rules: ChildRules = { childrenOf: (e) => children.get(e) ?? [], counts: () => true };
    const views: View[] = [CORE, ...variants.map((variant): View => ({ kind: "variant", variant }))];
    const all = (evaluate: VerificationEvaluator): (VerificationResult | undefined)[] =>
      views.map((view) => evaluate(root, view));
    reads = 0;
    const before = all(referenceEvaluator(source, rules, () => CURRENT));
    const referenceReads = reads;
    reads = 0;
    expect(all(verificationEvaluator(source, rules, () => CURRENT))).toEqual(before);
    // The reference walks the 340 elements in each of the 20 variants; the shared views about three
    // times (core, neutral, the seeds below each element) and the path above the one seed.
    expect(referenceReads).toBeGreaterThan(20 * 340);
    expect(reads).toBeLessThan(4 * 341 + 20 * 5 * 4);
  });
});

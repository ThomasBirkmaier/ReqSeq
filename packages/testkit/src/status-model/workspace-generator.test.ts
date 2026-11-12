// The workspace generator of the status model (#1395): with the seed and run count of the property runs it produces
// every feature the level-1 comparison relies on, and no record the reader refuses.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { statusModelWorkspace } from "./workspace-generator.js";
import { DEFAULT_RUNS, DEFAULT_SEED } from "./run.js";
import {
  CORE_VIEW,
  type ModelWorkspace,
  appliesIn,
  countedChildren,
  entriesInView,
  recordsInView,
  isExcluded,
  isReplaced,
  resolveRef,
  workspaceStatusOf,
} from "./workspace-model.js";

type Add = (condition: boolean, feature: string) => void;

function relationFeatures(ws: ModelWorkspace, add: Add): void {
  for (const element of ws.elements) {
    add(
      ws.elements.some((other) => other.id === element.id && other.repository !== element.repository),
      "twins in two repositories",
    );
    add(
      ws.elements.some(
        (other) =>
          other !== element &&
          other.derivesFrom.some((ref) => resolveRef(ws, ref, other.repository) === element) &&
          element.derivesFrom.some((ref) => resolveRef(ws, ref, element.repository) === other),
      ),
      "2-cycle",
    );
    add(
      ws.variants.some(
        (variant) =>
          isReplaced(ws, element, variant.id) &&
          ws.elements.some(
            (other) =>
              other.invalid &&
              other.validity.includes(variant.id) &&
              other.replaces.some((ref) => resolveRef(ws, ref, other.repository) === element),
          ),
      ),
      "replaced by an invalid requirement",
    );
  }
}

function viewFeatures(ws: ModelWorkspace, add: Add): void {
  for (const view of [
    CORE_VIEW,
    ...ws.variants.filter((variant) => !variant.invalid).map((variant) => variant.id),
  ]) {
    const entries = entriesInView(ws, view);
    const done = (key: string) => ["verified", "indirect"].includes(entries.get(key)?.status ?? "");
    for (const element of ws.elements) {
      const children = countedChildren(ws, element, view);
      add(
        element.emergent &&
          entries.has(element.key) &&
          recordsInView(ws, element, view).length === 0 &&
          children.length > 0 &&
          children.every((child) => done(child.key)),
        "emergent parent with all children verified",
      );
      add(
        entries.get(element.key)?.status === "indirect" &&
          children.some((child) => entries.get(child.key)?.status === "indirect"),
        "indirect child of an indirect parent",
      );
    }
  }
}

function featuresOf(ws: ModelWorkspace): string[] {
  const features: string[] = [];
  const add = (condition: boolean, feature: string) => {
    if (condition) {
      features.push(feature);
    }
  };
  add(
    ws.repositories.some((repository) => repository.variantIndependent),
    "variant-independent repository",
  );
  add(
    ws.variants.some((variant) => variant.invalid),
    "invalid variant",
  );
  add(ws.variants.length === 3, "three variants");
  for (const element of ws.elements) {
    add(
      ws.elements.some(
        (other) => other !== element && other.id === element.id && other.repository === element.repository,
      ),
      "twins",
    );
    add(element.type === "need", "need");
    add(element.invalid, "invalid element");
    add(element.emergent, "emergent");
    add(element.validity.length > 1, "validity of two variants");
    add(
      element.derivesFrom.some(
        (ref) => ref.repository !== undefined && ref.repository !== element.repository,
      ),
      "item into another repository",
    );
    add(
      element.derivesFrom.some((ref) => resolveRef(ws, ref, element.repository) === element),
      "derives from itself",
    );
    add(
      element.own.records.some((record) => record.variant !== undefined),
      "record for a variant",
    );
    add(
      element.own.records.some((record) => record.kind === "verification" && record.variant === undefined),
      "record without variant",
    );
    for (const variant of ws.variants) {
      add(isExcluded(ws, element, variant), "excluded");
      add(isReplaced(ws, element, variant.id), "replaced");
      add(isExcluded(ws, element, variant) && isReplaced(ws, element, variant.id), "excluded and replaced");
      add(element.validity.includes(variant.id) && variant.invalid, "validity names an invalid variant");
    }
    add(
      ws.elements.some((child) =>
        child.derivesFrom.some(
          (ref) =>
            resolveRef(ws, ref, child.repository) === undefined &&
            ws.elements.filter(
              (e) => e.id === ref.id && e.repository === (ref.repository ?? child.repository),
            ).length > 1,
        ),
      ),
      "ambiguous derivation item",
    );
    add(
      ws.elements.some(
        (other) =>
          other.validity.length > 0 &&
          other.replaces.some((ref) => resolveRef(ws, ref, other.repository) === element) &&
          element.validity.length > 0,
      ),
      "replaces a requirement with validity",
    );
    add(
      ws.variants.some(
        (variant) =>
          variant.excludes.some((ref) => resolveRef(ws, ref, variant.repository) === element) &&
          !appliesIn(ws, element, "core") &&
          element.type === "requirement",
      ),
      "excludes a requirement with validity",
    );
  }
  relationFeatures(ws, add);
  viewFeatures(ws, add);
  for (const entries of workspaceStatusOf(ws).values()) {
    for (const entry of entries) {
      features.push(`status ${entry.status}`);
      add(entry.view !== "core" && entry.status === "indirect", "indirect in a variant");
      add((entry.missingChildren?.length ?? 0) > 1, "two missing children");
      add(
        (entry.missingChildren ?? []).some((key) => ws.elements.some((e) => e.key === key && e.emergent)),
        "emergent child missing",
      );
      add(entry.total !== undefined, "own status with criteria");
    }
  }
  return features;
}

describe("status model workspace generator", () => {
  it("produces every feature with the seed and run count of the property runs", () => {
    const seen = new Set(
      fc.sample(statusModelWorkspace(), { seed: DEFAULT_SEED, numRuns: DEFAULT_RUNS }).flatMap(featuresOf),
    );
    const expected = [
      "variant-independent repository",
      "invalid variant",
      "three variants",
      "twins",
      "need",
      "invalid element",
      "emergent",
      "validity of two variants",
      "item into another repository",
      "derives from itself",
      "record for a variant",
      "record without variant",
      "excluded",
      "replaced",
      "excluded and replaced",
      "validity names an invalid variant",
      "ambiguous derivation item",
      "replaces a requirement with validity",
      "excludes a requirement with validity",
      ...["open", "verified", "failed", "outdated", "indirect"].map((status) => `status ${status}`),
      "indirect in a variant",
      "two missing children",
      "emergent child missing",
      "twins in two repositories",
      "2-cycle",
      "replaced by an invalid requirement",
      "emergent parent with all children verified",
      "indirect child of an indirect parent",
      "own status with criteria",
    ];
    expect(expected.filter((feature) => !seen.has(feature))).toEqual([]);
  });

  it("gives a variant only to verification records, validity and emergent only to requirements, one own part per UUID", () => {
    for (const ws of fc.sample(statusModelWorkspace(), { seed: 1395, numRuns: 500 })) {
      const variants = ws.variants.map((variant) => variant.id);
      for (const element of ws.elements) {
        for (const record of element.own.records) {
          expect(
            record.variant === undefined ||
              (record.kind === "verification" && variants.includes(record.variant)),
          ).toBe(true);
        }
        expect(element.validity.every((id) => variants.includes(id))).toBe(true);
        // R4: the files of one UUID share its own part.
        expect(
          ws.elements.filter((other) => other.id === element.id).every((other) => other.own === element.own),
        ).toBe(true);
        if (element.type === "need") {
          expect([element.validity, element.emergent]).toEqual([[], false]);
        }
      }
    }
  });
});

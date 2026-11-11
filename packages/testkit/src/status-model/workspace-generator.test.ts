// The workspace generator of the status model (#1395): with the fixed seed it produces every feature the level-1
// comparison relies on, and no record the reader refuses.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { statusModelWorkspace } from "./workspace-generator.js";
import {
  type ModelWorkspace,
  appliesIn,
  isExcluded,
  isReplaced,
  resolveRef,
  workspaceStatusOf,
} from "./workspace-model.js";

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
  it("produces every feature with a fixed seed", () => {
    const seen = new Set(
      fc.sample(statusModelWorkspace(), { seed: 1395, numRuns: 2000 }).flatMap(featuresOf),
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

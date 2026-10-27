import type { MetamodelGetOutput } from "@logreq/core";
import { describe, expect, it } from "vitest";
import { DEFAULT_SORT, elementBuffer } from "./buffers.js";
import type { BufferData } from "./modeline.js";
import {
  memberCount,
  memberList,
  memberSummary,
  packageModel,
  packageOf,
  packageSelection,
} from "./package-page.js";

/** The part of `metamodel.get` that the package page reads. */
const metamodel = (
  types: readonly { key: string; meaning?: string }[],
  meanings: Record<string, string[]>,
): Pick<MetamodelGetOutput, "types" | "meanings"> =>
  ({ types, meanings }) as unknown as Pick<MetamodelGetOutput, "types" | "meanings">;

describe("package page", () => {
  it("[SR-112/AK1] the package page asks element.list for the elements that name the package, by its UUID", () => {
    const buffer = elementBuffer("uuid-p", "spec", "PKG-0000d1 Stufe-3");
    const selection = packageSelection(buffer.id);
    expect(selection).toEqual({ where: { package: "uuid-p" } });
    expect(memberList(buffer, selection)).toEqual({
      kind: "list",
      key: buffer.key,
      label: "package: PKG-0000d1 Stufe-3",
      steps: [],
      selection: { where: { package: "uuid-p" } },
      cursor: 0,
    });
  });

  it("[SR-112/AK2] the elements of the package keep the sort and the row that the page remembers", () => {
    const buffer = {
      ...elementBuffer("uuid-p", "spec", "Stufe-3"),
      memberSort: [{ by: "hierarchy" as const, order: "asc" as const }],
      memberCursor: 4,
    };
    const list = memberList(buffer, packageSelection(buffer.id));
    expect(list.sort).toEqual([{ by: "hierarchy", order: "asc" }]);
    expect(list.cursor).toBe(4);
  });

  it("[SR-112/AK2] the workspace order is kept as `[]` and named in the heading; the default says nothing (#418)", () => {
    const buffer = { ...elementBuffer("uuid-p", "spec", "Stufe-3"), memberSort: [] };
    expect(memberList(buffer, packageSelection(buffer.id)).sort).toEqual([]);
    expect(memberSummary({ total: 2, incomplete: false }, [])).toBe("2 · workspace order");
    expect(memberSummary({ total: 2, incomplete: false }, DEFAULT_SORT)).toBe("2");
    expect(memberSummary({ total: 2, incomplete: false }, undefined)).toBe("2");
  });

  it("finds the types with the meaning package, also inherited ones, and the property that names them", () => {
    const model = packageModel(
      metamodel(
        [{ key: "need" }, { key: "package", meaning: "package" }, { key: "release", meaning: "package" }],
        { package: ["package"], packages: ["packages"] },
      ),
    );
    expect(model?.key).toBe("packages");
    expect([...(model?.types ?? [])]).toEqual(["package", "release"]);
    expect(packageOf(model, "release")).toBe(model);
    expect(packageOf(model, "need")).toBeUndefined();
  });

  it("has no package page without a package type or without the property", () => {
    expect(packageModel(metamodel([{ key: "need" }], { packages: ["packages"] }))).toBeUndefined();
    expect(
      packageModel(metamodel([{ key: "package", meaning: "package" }], { packages: [] })),
    ).toBeUndefined();
    expect(packageModel(metamodel([{ key: "package", meaning: "package" }], {}))).toBeUndefined();
    expect(packageOf(undefined, "package")).toBeUndefined();
  });

  it("counts what the list of the elements reports, and nothing else", () => {
    expect(memberCount({ kind: "list", total: 37, incomplete: false })).toEqual({
      total: 37,
      incomplete: false,
    });
    expect(memberCount({ kind: "list", total: 2, incomplete: true })).toEqual({ total: 2, incomplete: true });
    expect(memberCount(undefined)).toBeUndefined();
    expect(memberCount({ kind: "search", total: 1, incomplete: false })).toBeUndefined();
    const element = { kind: "element" } as unknown as BufferData;
    expect(memberCount(element)).toBeUndefined();
  });

  it("[SR-112/AK2] the heading names the count, what is missing, and how the elements are sorted", () => {
    expect(memberSummary({ total: 37, incomplete: false }, undefined)).toBe("37");
    expect(memberSummary({ total: 37, incomplete: false }, [{ by: "hierarchy", order: "asc" }])).toBe(
      "37 · tree",
    );
    expect(memberSummary({ total: 2, incomplete: true }, [{ by: "title", order: "desc" }])).toBe(
      "2 · incomplete: a repository is missing · sorted by title descending",
    );
  });
});

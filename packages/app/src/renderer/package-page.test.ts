import type { MetamodelGetOutput } from "@reqseq/core";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SORT, NO_ROW, elementBuffer } from "./buffers.js";
import { exactTypeStep, savedStep, statusStep } from "./list-filters.js";
import type { Call } from "./call.js";
import type { BufferData } from "./modeline.js";
import {
  askPackageSummary,
  askSummary,
  coverageBuffer,
  memberAt,
  memberCount,
  memberHeading,
  memberList,
  memberSelection,
  memberQuery,
  memberSummary,
  withMemberQuery,
  packageModel,
  packageOf,
  packageSelection,
  selectionCoverageBuffer,
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

  it("[SR-112/AK2] the workspace order is kept as `[]` and named in the heading; the default says nothing (ThomasBirkmaier/ReqSeq-archive#418)", () => {
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

  it("[SR-112/AK3] the line under the title is core's evidence.coverage and evidence.degree with selection.package", async () => {
    const answers: Record<string, unknown> = {
      "evidence.coverage": {
        levels: [
          { type: "need", total: 1, withChildren: 0, elements: {} },
          { type: "system-requirement", total: 10, withChildren: 0, withEvidence: 8, elements: {} },
        ],
      },
      "evidence.degree": {
        degree: {
          share: 0.6,
          total: 10,
          counts: { open: 2, verified: 6, indirect: 0, failed: 1, outdated: 1 },
        },
        view: "core",
        incomplete: true,
      },
    };
    const call = vi.fn((name: string) => Promise.resolve({ ok: true, output: answers[name] }));
    expect(await askPackageSummary(call as unknown as Call, "uuid-p")).toEqual({
      ok: true,
      line: "Coverage 8 of 10 with evidence · Degree (core) 60 % (6 verified, 1 failed, 1 outdated, 2 open) · incomplete: a repository is missing",
      coverage: answers["evidence.coverage"],
    });
    expect(call.mock.calls).toEqual([
      ["evidence.coverage", { selection: { package: "uuid-p" } }],
      ["evidence.degree", { selection: { package: "uuid-p" } }],
    ]);
  });

  it("[SR-112/AK4] a package without requirements has no line, and a failed call says why", async () => {
    const none = {
      "evidence.coverage": { ok: true, output: { levels: [{ type: "need", total: 1, withChildren: 0 }] } },
      "evidence.degree": { ok: true, output: { degree: { total: 0, counts: {} }, view: "core" } },
    };
    const answer = (fail: string | undefined) => (name: keyof typeof none) =>
      Promise.resolve(name === fail ? { ok: false, code: "x", message: `no ${name}` } : none[name]);
    expect(await askPackageSummary(answer(undefined) as unknown as Call, "p")).toEqual({
      ok: true,
      line: undefined,
      coverage: none["evidence.coverage"].output,
    });
    expect(await askPackageSummary(answer("evidence.coverage") as unknown as Call, "p")).toEqual({
      ok: false,
      message: "no evidence.coverage",
    });
    expect(await askPackageSummary(answer("evidence.degree") as unknown as Call, "p")).toEqual({
      ok: false,
      message: "no evidence.degree",
    });
  });

  it("[SR-036/AK2] a click on the line opens core's coverage of the package, one result buffer per package", () => {
    const coverage = { levels: [{ type: "system-requirement", total: 2, withChildren: 0, elements: {} }] };
    expect(coverageBuffer("uuid-p", "PKG-1 Stage", coverage as never, 3)).toEqual({
      kind: "result",
      key: 'result:evidence.coverage:{"selection":{"package":"uuid-p"}}',
      command: "evidence.coverage",
      input: { selection: { package: "uuid-p" } },
      name: "Show evidence coverage PKG-1 Stage",
      output: coverage,
      revision: 3,
      cursor: NO_ROW,
    });
  });
});

describe("the filter steps of a package page (SR-112 AK2)", () => {
  it("[SR-112/AK2] select the package's elements that meet every step, and name the steps in the heading", () => {
    expect(memberSelection("p1", [])).toEqual(packageSelection("p1"));
    expect(memberSelection("p1", [statusStep("draft"), savedStep("open")])).toEqual({
      filter: "open",
      where: { all: [{ package: "p1" }, { status: ["draft"] }] },
    });
    expect(memberHeading("packages", undefined)).toBe("packages");
    expect(memberHeading("packages", [])).toBe("packages");
    expect(memberHeading("packages", [exactTypeStep("need", "Need"), statusStep("draft")])).toBe(
      "packages · Need · status: draft",
    );
  });
});

describe("the line of a list (product owner decision, 2026-11-06)", () => {
  it("counts the selection of the list, and its click opens the coverage of that selection", async () => {
    const answers: Record<string, unknown> = {
      "evidence.coverage": { levels: [{ type: "system-requirement", total: 2, withChildren: 1 }] },
      "evidence.degree": { degree: { total: 2, counts: { verified: 1, open: 1 } }, view: "core" },
    };
    const call = vi.fn((name: string) => Promise.resolve({ ok: true, output: answers[name] }));
    const selection = { where: { type: ["system-requirement"] } };
    const summary = await askSummary(call as unknown as Call, selection);
    expect(summary.ok).toBe(true);
    expect(call.mock.calls).toEqual([
      ["evidence.coverage", { selection }],
      ["evidence.degree", { selection }],
    ]);
    expect(selectionCoverageBuffer(selection, "type: system-requirement", {} as never, 1)).toMatchObject({
      command: "evidence.coverage",
      input: { selection },
      name: "Show evidence coverage type: system-requirement",
    });
  });

  it("[SR-112/AK3] names the variant of the view the degree is for, as core names it", async () => {
    const answers: Record<string, unknown> = {
      "evidence.coverage": {
        levels: [{ type: "system-requirement", total: 2, withChildren: 0, withEvidence: 1 }],
      },
      "evidence.degree": {
        degree: {
          share: 0.5,
          total: 2,
          counts: { verified: 1, indirect: 0, failed: 0, outdated: 0, open: 1 },
        },
        view: "uuid-v1",
        names: [{ id: "uuid-v1", repository: "spec", shortId: "VAR-0000c1", title: "Coastal station" }],
      },
    };
    const call = vi.fn((name: string) => Promise.resolve({ ok: true, output: answers[name] }));
    const selection = { package: "uuid-p", view: "uuid-v1" };
    const summary = await askSummary(call as unknown as Call, selection);
    expect(call.mock.calls).toEqual([
      ["evidence.coverage", { selection }],
      ["evidence.degree", { selection: { package: "uuid-p", view: "uuid-v1" } }],
    ]);
    expect(summary).toMatchObject({
      ok: true,
      line: "Coverage 1 of 2 with evidence · Degree (Coastal station) 50 % (1 verified, 1 open)",
    });
  });
});

describe("the query of a package page's elements (#993)", () => {
  it("is the steps and the sort of the page; a change keeps the rest, starts from the first row and drops a grouping", () => {
    const page = { ...elementBuffer("p1", "spec", "PKG-1 Wind"), memberSort: DEFAULT_SORT, memberCursor: 4 };
    expect(memberQuery(page)).toEqual({ steps: [], sort: DEFAULT_SORT });
    const filtered = withMemberQuery(page, { steps: [statusStep("draft")], group: "type" });
    expect(filtered).toEqual({ ...page, memberSteps: [statusStep("draft")], memberCursor: 0 });
    expect(memberQuery(filtered)).toEqual({ steps: [statusStep("draft")], sort: DEFAULT_SORT });
    const { memberSort: _sort, memberSteps: _steps, ...plain } = filtered;
    expect(withMemberQuery(filtered, { steps: [], sort: undefined })).toEqual(plain);
  });
});

describe("memberAt (SR-194 AK5)", () => {
  const entries = [elementBuffer("uuid-1", "spec", "SR-1 One"), elementBuffer("uuid-2", "spec", "SR-2 Two")];

  it("is the entry at the cursor only while the list has the focus", () => {
    expect(memberAt(entries, 1, true)).toBe(entries[1]);
    // The first row a filter starts at, while the reader is not in the list, marks nothing.
    expect(memberAt(entries, 0, false)).toBeUndefined();
    expect(memberAt(entries, undefined, true)).toBeUndefined();
    expect(memberAt(entries, -1, true)).toBeUndefined();
    expect(memberAt(undefined, 0, true)).toBeUndefined();
  });
});

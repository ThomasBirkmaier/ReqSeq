import { describe, expect, it } from "vitest";
import type { DataExportRelation } from "../generated/types.js";
import type { ListMetamodel } from "./list.js";
import type { PackageRowInput } from "./package.js";
import { NO_MEMBERS, isPackageType, packageDisplay, packageMembers, targetKey } from "./package.js";

const METAMODEL: ListMetamodel = {
  types: [
    { key: "req", name: "Requirement", meaning: "requirement", properties: ["title", "packages"] },
    { key: "pkg", name: "Package", meaning: "package", properties: ["title", "packages"] },
  ],
  properties: [
    { key: "title", name: "Title", kind: "text", meaning: "title" },
    { key: "packages", name: "Packages", kind: "relation", meaning: "packages" },
  ],
  statuses: [{ key: "draft" }, { key: "obsolete", invalid: true }],
};

const P1 = { id: "p1", repository: "spec" };
const P2 = { id: "p2", repository: "spec" };

const link = (
  target: { id: string; repository?: string },
  more: Partial<DataExportRelation> = {},
): DataExportRelation => ({
  kind: "packages",
  property: true,
  direction: "out",
  accessible: true,
  targetState: "available",
  ...target,
  ...more,
});

const row = (
  id: string,
  relations: readonly DataExportRelation[],
  more: Partial<PackageRowInput["element"]> = {},
  verification?: PackageRowInput["verification"],
): PackageRowInput => ({
  element: {
    id,
    repository: "spec",
    shortId: `SR-${id}`,
    type: "req",
    status: "draft",
    title: `Title ${id}`,
    file: `${id}.md`,
    properties: {},
    relations,
    ...more,
  },
  verification,
});

/** `input` without a status. */
const withoutStatus = (input: PackageRowInput): PackageRowInput => {
  const { status: _status, ...element } = input.element;
  return { ...input, element };
};

describe("isPackageType and targetKey", () => {
  it("names the types with the meaning package, and keys a target by UUID and repository", () => {
    expect(isPackageType(METAMODEL, "pkg")).toBe(true);
    expect(isPackageType(METAMODEL, "req")).toBe(false);
    expect(isPackageType(METAMODEL, "unknown")).toBe(false);
    expect(targetKey(P1)).toBe("p1\nspec");
  });
});

describe("packageMembers", () => {
  it("gives each package the rows whose property with the meaning packages names it, once each, in order", () => {
    const both = row("a", [link(P1), link(P2), link(P1)]);
    const nested = row("p2", [link(P1)], { type: "pkg" });
    const rows = [
      both,
      nested,
      // Another repository than the package's, a stored repository that is not text, a relation kind, an
      // incoming relation, and an unknown package name none of them.
      row("b", [
        link({ id: "p1", repository: "other" }),
        link({ id: "p1" }),
        { kind: "packages", direction: "out", accessible: true, targetState: "available", ...P1 },
        { kind: "derives-from", direction: "out", accessible: true, targetState: "available", ...P1 },
        link(P1, { direction: "in" }),
        link({ id: "p9", repository: "spec" }),
      ]),
    ];
    const members = packageMembers([P1, P2], rows, METAMODEL);
    expect([...members.keys()]).toEqual([targetKey(P1), targetKey(P2)]);
    expect(members.get(targetKey(P1))).toEqual([both, nested]);
    expect(members.get(targetKey(P2))).toEqual([both]);
  });

  it("gives every package no member without a property with the meaning packages", () => {
    const members = packageMembers([P1], [row("a", [link(P1)])], { properties: [] });
    expect(members.get(targetKey(P1))).toEqual([]);
  });
});

describe("packageDisplay", () => {
  const rows = [
    row("a", [link(P1)], { identifier: "SR-001" }, [
      { view: "core", status: "open", criteria: { verified: 1, total: 2 } },
    ]),
    withoutStatus(row("b", [link(P1)], { title: "" })),
    row("c", [link(P1)], { status: "obsolete" }),
  ];

  it("gives the identifier, title, status and verification status alone, '–' where there is none", () => {
    const display = packageDisplay(
      { package: { ...P1 }, rows, metamodel: METAMODEL },
      { id: "identifier", invalid: "omit" },
    );
    expect(display.package).toEqual(P1);
    expect(display.columns.map((c) => c.label)).toEqual([
      "Identifier",
      "Title",
      "Status",
      "Verification status in the core",
    ]);
    expect(display.rows.map((r) => r.cells.map((cell) => cell.text))).toEqual([
      ["SR-001", "Title a", "draft", "open"],
      ["SR-b", "", "–", "–"],
    ]);
    expect(display.rows[0]?.cells[3]).toEqual({
      kind: "verification",
      cell: { view: "core", status: "open", criteria: { verified: 1, total: 2 } },
      text: "open",
    });
    expect(NO_MEMBERS).toBe("No element names this package.");
  });

  it("keeps an element with an invalid status when asked, marked invalid, and names rows by short ID and identifier", () => {
    const display = packageDisplay(
      { package: P1, rows, metamodel: METAMODEL },
      { id: "shownId", invalid: "keep" },
    );
    expect(display.rows.map((r) => [r.cells[0]?.text, r.ref.invalid])).toEqual([
      ["SR-a (SR-001)", false],
      ["SR-b", false],
      ["SR-c", true],
    ]);
  });
});

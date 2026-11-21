import { describe, expect, it } from "vitest";
import type { DataExportElement, DataExportRelation } from "../generated/types.js";
import { elementPageDisplay } from "./element-page.js";

const METAMODEL = {
  relations: [
    { key: "refines", name: "Refines", "inverse-name": "Refined by" },
    { key: "derives-from", name: "Derives from" },
  ],
  properties: [{ key: "packages", name: "Packages" }],
  statuses: [
    { key: "draft", name: "Draft" },
    { key: "obsolete", name: "Obsolete", invalid: true },
  ],
};

const relation = (id: string, extra: Partial<DataExportRelation> = {}): DataExportRelation => ({
  kind: "derives-from",
  direction: "out",
  id,
  accessible: true,
  targetState: "available",
  ...extra,
});

const element = (extra: Partial<DataExportElement> = {}): DataExportElement =>
  ({
    id: "e",
    repository: "spec",
    shortId: "SR-00000e",
    type: "system-requirement",
    title: "Show wind",
    status: "draft",
    properties: {},
    relations: [],
    ...extra,
  }) as DataExportElement;

/** The element without a status. */
const withoutStatus = (): DataExportElement => {
  const { status: _status, ...rest } = element();
  return rest;
};

const groupsOf = (display: ReturnType<typeof elementPageDisplay>) =>
  display.relationGroups.map((group) => [group.label, group.relations.map((r) => r.id)]);

describe("elementPageDisplay", () => {
  it("groups the relations: outgoing first, each in the order of the metamodel, then kinds it does not know, then incoming", () => {
    const display = elementPageDisplay(
      {
        element: element({
          relations: [
            relation("1"),
            relation("2", { kind: "mystery" }),
            relation("3", { kind: "refines" }),
            relation("4", { kind: "refines", direction: "in" }),
            relation("5", { kind: "packages", property: true }),
            relation("6", { kind: "packages", property: true, direction: "in" }),
            relation("7"),
          ],
        }),
        metamodel: METAMODEL,
      },
      { relations: "all" },
    );
    expect(groupsOf(display)).toEqual([
      ["Refines", ["3"]],
      ["Derives from", ["1", "7"]],
      ["mystery", ["2"]],
      ["← Refined by", ["4"]],
      ["← Packages", ["6"]],
    ]);
    expect(display.relationGroups[0]).toMatchObject({
      kind: "refines",
      direction: "out",
      key: "out:kind:refines",
    });
  });

  it("[SR-232/AK-cj5d] keeps only the outgoing relations for the export page, a kind the metamodel does not know too", () => {
    const display = elementPageDisplay(
      {
        element: element({
          relations: [
            relation("1", { kind: "mystery" }),
            relation("2", { kind: "refines", direction: "in" }),
          ],
        }),
        metamodel: METAMODEL,
      },
      { relations: "outgoing" },
    );
    expect(groupsOf(display)).toEqual([["mystery", ["1"]]]);
  });

  it("gives the verification status per view in core's order, and none for an element without one", () => {
    const verification = [
      { view: "core", status: "open" as const, criteria: { verified: 1, total: 2 } },
      { view: "v", status: "open" as const, missingChildren: ["c"] },
    ];
    expect(
      elementPageDisplay({ element: element({ verification }), metamodel: METAMODEL }, { relations: "all" })
        .verification,
    ).toEqual(verification);
    expect(
      elementPageDisplay({ element: element(), metamodel: METAMODEL }, { relations: "all" }).verification,
    ).toBeUndefined();
  });

  it("[SR-232/AK-q95d] takes the hints of hint.list, else the hints of element.get by its rule", () => {
    const problems = [
      { code: "file.faulty" as const, severity: "warning" as const, message: "No version", elementId: "e" },
      {
        code: "trace.no-parent" as const,
        severity: "warning" as const,
        message: "No parent",
        elementId: "e",
      },
    ];
    const own = elementPageDisplay(
      { element: element({ problems }), metamodel: METAMODEL },
      { relations: "all" },
    );
    expect(own.hints).toEqual([{ code: "trace.no-parent", message: "No parent" }]);
    const listed = elementPageDisplay(
      {
        element: element({ problems }),
        hints: [{ code: "trace.no-parent", message: "Listed" }],
        metamodel: METAMODEL,
      },
      { relations: "all" },
    );
    expect(listed.hints).toEqual([{ code: "trace.no-parent", message: "Listed" }]);
  });

  it("names the element with its status, invalid or not, and passes on whether it is read-only", () => {
    const plain = elementPageDisplay({ element: element(), metamodel: METAMODEL }, { relations: "all" });
    expect(plain.ref).toEqual({
      id: "e",
      repository: "spec",
      type: "system-requirement",
      shortId: "SR-00000e",
      title: "Show wind",
      status: "draft",
      invalid: false,
    });
    expect(plain.readOnly).toBe(false);
    const gone = elementPageDisplay(
      {
        element: element({ status: "obsolete", identifier: "SR-1", readOnly: true, file: "r/e.md" }),
        metamodel: METAMODEL,
      },
      { relations: "all" },
    );
    expect(gone.ref).toMatchObject({ identifier: "SR-1", invalid: true, file: "r/e.md" });
    expect(gone.readOnly).toBe(true);
    const none = elementPageDisplay({ element: withoutStatus(), metamodel: METAMODEL }, { relations: "all" });
    expect(none.ref.invalid).toBe(false);
    expect("status" in none.ref).toBe(false);
  });
});

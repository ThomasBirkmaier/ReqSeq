// The lists of the HTML export (SR-233 AK1): the cases the export of the fixtures does not reach.
import { describe, expect, it } from "vitest";
import type { DataExportElement } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import type { ElementRecord, ElementStore, ShortIds } from "../model/index.js";
import type { ListEntry } from "./list-page.js";
import { identifierOf, listPageOf, listsOf, typeOrder } from "./list-page.js";

const metamodel = {
  valid: true,
  effectiveTypes: [
    { key: "req", name: "Requirement", properties: ["level"] },
    { key: "pkg", name: "Package", meaning: "package", properties: [] },
    { key: "var", name: "Variant", meaning: "variant", properties: [] },
  ],
  types: [],
  // A choice without choices (a metamodel error) still filters, its values by text.
  properties: [{ key: "level", name: "Level", kind: "choice" }],
  relations: [],
  statuses: [],
} as unknown as Metamodel;

const entry = (
  type: string,
  element: Partial<DataExportElement>,
  data: Record<string, unknown> = {},
): ListEntry => ({
  record: { type, data } as unknown as ElementRecord,
  element: {
    id: "u",
    shortId: "X-1",
    type,
    title: "",
    repository: "r",
    relations: [],
    properties: {},
    ...element,
  } as DataExportElement,
  hints: 0,
});

describe("lists (SR-233 AK1)", () => {
  it("[SR-233/AK-pmt8] orders the types as the metamodel does, unknown ones after them by key, and leaves out packages and variants", () => {
    const order = typeOrder(metamodel);
    expect(["zeta", "alpha", "pkg", "req"].sort(order)).toEqual(["req", "pkg", "alpha", "zeta"]);
    const lists = listsOf({ metamodel }, [
      entry("zeta", {}),
      entry("pkg", {}),
      entry("var", {}),
      entry("alpha", {}),
      entry("req", {}),
    ]);
    expect(lists.map((l) => l.type)).toEqual(["req", "alpha", "zeta"]);
  });

  it("[SR-233/AK-pmt8] names a row by its identifier, else its short ID, and lists an unknown type under its key", () => {
    expect(identifierOf(entry("req", { identifier: "REQ-1", shortId: "X-1" }).element)).toBe("REQ-1");
    expect(identifierOf(entry("req", { shortId: "X-1" }).element)).toBe("X-1");
    const context = { metamodel, store: {} as ElementStore, shortIds: {} as ShortIds };
    const unknown = listPageOf(context, "zeta", [entry("zeta", { title: "Z" })]);
    expect(unknown).toMatchObject({ type: "zeta", path: "lists/zeta.html", title: "zeta", count: 1 });
    expect(unknown.body).toContain('<p class="rq-list-count">1 element</p>');
    const page = listPageOf(context, "req", [
      entry("req", { identifier: "REQ-2", title: "Two" }, { level: "high" }),
      entry("req", { identifier: "REQ-1", title: "One" }, { level: ["deep", "high"] }),
    ]);
    expect(page.title).toBe("Requirement");
    expect(page.body).toContain(">REQ-2</a>");
    // The values of the choice by text, "–" last.
    expect(page.body).toContain(
      "&quot;label&quot;:&quot;Level&quot;,&quot;values&quot;:[&quot;deep&quot;,&quot;high&quot;,&quot;–&quot;]",
    );
  });
});

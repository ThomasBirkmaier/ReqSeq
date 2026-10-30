import type { DataExportElement, ElementGetOutput, ElementName, ProblemCode } from "@reqseq/core";
import { describe, expect, it } from "vitest";
import { elementBuffer } from "./buffers.js";
import type { LinePart } from "./variant-lines.js";
import { variantLines } from "./variant-lines.js";

const name = (id: string, shortId: string, title: string, identifier?: string): ElementName => ({
  id,
  repository: "system",
  shortId,
  title,
  ...(identifier === undefined ? {} : { identifier }),
});

const COAST = name("uuid-a", "VAR-0000c1", "Coast");
const MOUNTAIN = name("uuid-b", "VAR-0000c2", "Mountain");
const DESERT = name("uuid-c", "VAR-0000c3", "Desert");
const REPLACEMENT = name("uuid-r", "SR-0000b1", "Response time at most 20 ms", "SR-900");

const output = (
  fields: Pick<DataExportElement, "replacedBy" | "excludedBy" | "verification" | "problems">,
  names?: readonly ElementName[],
): Pick<ElementGetOutput, "element" | "names"> => ({
  element: { ...fields } as DataExportElement,
  ...(names === undefined ? {} : { names }),
});

const text = (parts: readonly LinePart[] | undefined): string | undefined =>
  parts?.map((part) => part.text).join("");

describe("the lines of a requirement's variants", () => {
  it("names the variants that replace and exclude it, each a link, and the replacement by its ID and title", () => {
    const lines = variantLines(
      output(
        {
          replacedBy: [{ variant: "uuid-a", replacement: "uuid-r" }],
          excludedBy: ["uuid-b", "uuid-c"],
        },
        [COAST, REPLACEMENT, MOUNTAIN, DESERT],
      ),
    );
    expect(text(lines.use)).toBe(
      "Replaced in Coast by SR-900 Response time at most 20 ms · Excluded in Mountain, Desert",
    );
    expect(lines.use?.find((part) => part.text === "Coast")).toEqual({
      text: "Coast",
      id: "uuid-a",
      open: elementBuffer("uuid-a", "system", "VAR-0000c1 Coast"),
    });
    expect(lines.verification).toBeUndefined();
  });

  it("gives the verification status per view in core's order, the core first by its word", () => {
    const lines = variantLines(
      output(
        {
          verification: [
            { view: "core", status: "verified" },
            { view: "uuid-a", status: "open" },
            { view: "uuid-b", status: "failed" },
          ],
        },
        [COAST, MOUNTAIN],
      ),
    );
    expect(text(lines.verification)).toBe("Verification — Core: verified · Coast: open · Mountain: failed");
    expect(lines.use).toBeUndefined();
  });

  it("names an element that names lacks by its UUID, without a link", () => {
    const lines = variantLines(
      output({ replacedBy: [{ variant: "uuid-x", replacement: "uuid-y" }], verification: [] }),
    );
    expect(text(lines.use)).toBe("Replaced in uuid-x by uuid-y");
    expect(lines.use?.some((part) => "open" in part)).toBe(false);
    expect(lines.verification).toBeUndefined();
  });

  it("[SR-103/AK1] gives a variant's hints since its newest baseline, core's messages in core's order, and no other hint", () => {
    const hint = (code: ProblemCode, message: string) => ({ code, severity: "warning" as const, message });
    const lines = variantLines(
      output({
        problems: [
          hint("variant.core-changed-since-baseline", "SR-0000a1 has changed since R1"),
          hint("relation.outdated", "Relation is outdated"),
          hint("variant.core-new-since-baseline", "SR-0000a5 has come into the view since R1"),
        ],
      }),
    );
    expect(lines.sinceBaseline).toEqual([
      { kind: "changed", message: "SR-0000a1 has changed since R1" },
      { kind: "new", message: "SR-0000a5 has come into the view since R1" },
    ]);
    expect(variantLines(output({})).sinceBaseline).toEqual([]);
  });
});

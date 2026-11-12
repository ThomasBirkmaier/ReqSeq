import type { DataExportElement, ElementGetOutput, ElementName, ProblemCode } from "@reqseq/core";
import { describe, expect, it } from "vitest";
import { elementBuffer } from "./buffers.js";
import type { Badge, LinePart } from "./variant-lines.js";
import { REASON_LENGTH, variantLines } from "./variant-lines.js";

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
  fields: Pick<
    DataExportElement,
    "replacedBy" | "excludedBy" | "verification" | "validation" | "validationReason" | "problems"
  >,
  names?: readonly ElementName[],
): Pick<ElementGetOutput, "element" | "names"> => ({
  element: { ...fields } as DataExportElement,
  ...(names === undefined ? {} : { names }),
});

const text = (parts: readonly LinePart[] | undefined): string | undefined =>
  parts?.map((part) => part.text).join("");

/** Each badge as "<left half> | <right half>". */
const halves = (badges: readonly Badge[] | undefined): string[] | undefined =>
  badges?.map((badge) => `${badge.name.text} | ${text(badge.parts) ?? ""}`);

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
      "Replaced in Coast by SR-0000b1 (SR-900) Response time at most 20 ms · Excluded in Mountain, Desert",
    );
    expect(lines.use?.find((part) => part.text === "Coast")).toEqual({
      text: "Coast",
      id: "uuid-a",
      open: elementBuffer("uuid-a", "system", "VAR-0000c1 Coast"),
    });
    expect(lines.verification).toBeUndefined();
  });

  it("[SR-157/AK-c9cf] gives the verification status per view as a badge in core's order: the name, the status and its word", () => {
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
    expect(halves(lines.verification)).toEqual(["Core | verified", "Coast | open", "Mountain | failed"]);
    expect(lines.verification?.map((badge) => badge.status)).toEqual(["verified", "open", "failed"]);
    // The name of a variant opens it (AK5); the core's is a word.
    expect(lines.verification?.[1]?.name).toEqual({
      text: "Coast",
      id: "uuid-a",
      open: elementBuffer("uuid-a", "system", "VAR-0000c1 Coast"),
    });
    expect(lines.verification?.[0]?.name).toEqual({ text: "Core" });
    expect(lines.use).toBeUndefined();
  });

  it("[SR-034/AK-hk8z] names the children missing for an indirect verification, each a link by its ID with ID and title on hover", () => {
    const one = name("uuid-1", "SR-00b121", "Log wind", "SR-121");
    const lines = variantLines(
      output(
        {
          verification: [
            { view: "core", status: "open", missingChildren: ["uuid-1", "uuid-2"] },
            { view: "uuid-a", status: "indirect" },
          ],
        },
        [one, COAST],
      ),
    );
    expect(halves(lines.verification)).toEqual([
      "Core | open (missing SR-00b121, uuid-2)",
      "Coast | indirect",
    ]);
    expect(lines.verification?.[0]?.parts.find((part) => part.text === "SR-00b121")).toEqual({
      text: "SR-00b121",
      id: "uuid-1",
      open: elementBuffer("uuid-1", "system", "SR-00b121 (SR-121) Log wind"),
    });
  });

  it("[SR-031/AK-yscc] counts the verified acceptance criteria and names those not verified", () => {
    const lines = variantLines(
      output({
        verification: [
          {
            view: "core",
            status: "open",
            criteria: { verified: 2, total: 3, notVerified: [{ criterion: 3 }] },
          },
          { view: "uuid-coast", status: "verified", criteria: { verified: 3, total: 3 } },
        ],
      }),
    );
    expect(halves(lines.verification)).toEqual([
      "Core | open (2 of 3 criteria, AK3 not verified)",
      "uuid-coast | verified (3 of 3 criteria)",
    ]);
  });

  it("[SR-038/AK-w0j6] gives the validation status on a line of its own, apart from the verification status", () => {
    const lines = variantLines(
      output({ verification: [{ view: "core", status: "open" }], validation: "validated" }),
    );
    expect(text(lines.validation)).toBe("Validation — validated");
    expect(halves(lines.verification)).toEqual(["Core | open"]);
    expect(variantLines(output({})).validation).toBeUndefined();
  });

  it("[SR-172/AK-j3vg] gives an inconclusive validation with its reason on one line, cut when long", () => {
    const lines = variantLines(
      output({ validation: "inconclusive", validationReason: "No frost\n\tyet,\u0007 see notes" }),
    );
    expect(text(lines.validation)).toBe("Validation — inconclusive: No frost yet, see notes");
    const long = variantLines(output({ validation: "inconclusive", validationReason: "x".repeat(300) }));
    expect(text(long.validation)).toBe(`Validation — inconclusive: ${"x".repeat(REASON_LENGTH - 1)}…`);
    // Cut by graphemes: an emoji, also one of several code points, is never split.
    const emoji = variantLines(output({ validation: "inconclusive", validationReason: "👍🏽".repeat(300) }));
    expect(text(emoji.validation)).toBe(`Validation — inconclusive: ${"👍🏽".repeat(REASON_LENGTH - 1)}…`);
    // Longer than the limit in code units, but not in graphemes: not cut.
    const fits = variantLines(
      output({ validation: "inconclusive", validationReason: "👍🏽".repeat(REASON_LENGTH) }),
    );
    expect(text(fits.validation)).toBe(`Validation — inconclusive: ${"👍🏽".repeat(REASON_LENGTH)}`);
  });

  it("gives the whole reason as written as the title of a cut validation line, else none (#846)", () => {
    const whole = `First line\n${"x".repeat(300)}`;
    expect(
      variantLines(output({ validation: "inconclusive", validationReason: whole })).validationTitle,
    ).toBe(whole);
    // Control characters other than line breaks and tabs are left out of the title.
    expect(
      variantLines(output({ validation: "inconclusive", validationReason: `a\u001b\tb ${"x".repeat(300)}` }))
        .validationTitle,
    ).toBe(`a\tb ${"x".repeat(300)}`);
    const short = variantLines(output({ validation: "inconclusive", validationReason: "No frost\nyet" }));
    expect(short.validationTitle).toBeUndefined();
    expect(variantLines(output({ validation: "validated" })).validationTitle).toBeUndefined();
    expect(variantLines(output({ validationReason: "x".repeat(300) })).validationTitle).toBeUndefined();
  });

  it("names an element that names lacks by its UUID, without a link", () => {
    const lines = variantLines(
      output({ replacedBy: [{ variant: "uuid-x", replacement: "uuid-y" }], verification: [] }),
    );
    expect(text(lines.use)).toBe("Replaced in uuid-x by uuid-y");
    expect(lines.use?.some((part) => "open" in part)).toBe(false);
    expect(lines.verification).toBeUndefined();
  });

  it("[SR-103/AK-grj7] gives a variant's hints since its newest baseline, core's messages in core's order, and no other hint", () => {
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

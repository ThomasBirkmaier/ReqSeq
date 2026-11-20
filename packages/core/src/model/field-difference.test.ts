// The field difference of an element between two of its texts (SR-232 AK7), on the standard model of
// fixtures/SR-001/two-elements: criteria by key (by number without one), the properties that count to the version,
// relations without their stored versions, the text in its normal form.
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { Metamodel } from "../metamodel/index.js";
import { metamodelState } from "../metamodel/index.js";
import { Workspace } from "../runtime/workspace.js";
import type { ElementContent } from "./field-difference.js";
import { fieldDifference, fieldName } from "./field-difference.js";

const A = "23200000-0000-4000-8000-0000000000a1";
const B = "23200000-0000-4000-8000-0000000000b1";

const standard = async (): Promise<Metamodel> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-001/two-elements" });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace.get(metamodelState);
};

const requirement = (data: Record<string, unknown>, text = "The text.\n"): ElementContent => ({
  type: "system-requirement",
  data: { id: B, type: "system-requirement", ...data },
  text,
});

describe("fieldDifference (SR-232 AK7)", () => {
  it("[SR-232/AK-dywy] matches criteria by key, names what counts to the version, and ignores stored target versions", async () => {
    const metamodel = await standard();
    const before = requirement(
      {
        title: "Old title",
        "requirement-type": "functional",
        priority: "high",
        "acceptance-criteria": [
          { key: "k1aa", text: "Shows the speed." },
          { key: "k2bb", text: "Shows the gusts." },
          { key: "k3cc", text: "Same text." },
          "Unkeyed first.",
        ],
        "derives-from": [{ id: A, version: "n2:0000000000000000", title: "Old title of A" }],
        packages: [{ id: A, version: "n2:0000000000000000" }],
      },
      "The text.  \r\n\r\n\r\nSecond line.\n",
    );
    const after = requirement(
      {
        title: "New title",
        "requirement-type": "performance",
        priority: "low",
        "acceptance-criteria": [
          "Unkeyed first, changed.",
          { key: "k3cc", text: "Same text.  " },
          { key: "k1aa", text: "Shows the speed in knots." },
          { key: "k4dd", text: "Shows the direction." },
        ],
        "derives-from": [{ id: A, version: "n2:1111111111111111" }],
        refines: [{ id: A, version: "n2:1111111111111111", repository: "other" }],
      },
      "The text.\n\nSecond line.",
    );
    const difference = fieldDifference(metamodel, before, after);
    // The text differs only in its normal form: no difference. Title and priority do not count to the version.
    expect(difference.text).toBeUndefined();
    expect(difference.properties).toEqual([
      { key: "requirement-type", before: "functional", after: "performance" },
    ]);
    expect(difference.criteria).toEqual([
      {
        key: "k1aa",
        numberBefore: 1,
        numberAfter: 3,
        before: "Shows the speed.",
        after: "Shows the speed in knots.",
      },
      { key: "k2bb", numberBefore: 2, before: "Shows the gusts.", after: undefined },
      // Without key in the old text, by number: its key k4dd was given later.
      {
        key: "k4dd",
        numberBefore: 4,
        numberAfter: 4,
        before: "Unkeyed first.",
        after: "Shows the direction.",
      },
      { numberAfter: 1, before: undefined, after: "Unkeyed first, changed." },
    ]);
    expect(difference.addedRelations).toEqual([{ kind: "refines", id: A, repository: "other" }]);
    expect(difference.removedRelations).toEqual([{ kind: "packages", id: A }]);
    expect(fieldName(metamodel, "derives-from")).toBe("Derives from");
    expect(fieldName(metamodel, "x-unknown")).toBe("x-unknown");
  });

  it("gives the text, compares absent, null and an empty list alike, and shows lists and other values", async () => {
    const metamodel = await standard();
    const difference = fieldDifference(
      metamodel,
      requirement({ "requirement-type": null, "acceptance-criteria": [] }, "Old.\n"),
      requirement({ "acceptance-criteria": [{ key: "k1aa", text: "New." }] }, "New.\n"),
    );
    expect(difference.text).toEqual({ before: "Old.\n", after: "New.\n" });
    expect(difference.properties).toEqual([]);
    expect(difference.criteria).toEqual([{ key: "k1aa", numberAfter: 1, before: undefined, after: "New." }]);
    // A criterion without key does not take the number of one whose key the old text has.
    const moved = fieldDifference(
      metamodel,
      requirement({
        "acceptance-criteria": ["X.", { key: "k1aa", text: "Y." }, { key: "k2bb", text: "Z." }],
      }),
      requirement({ "acceptance-criteria": [{ key: "k1aa", text: "Y." }, "X.", "Z!"] }),
    );
    expect(moved.criteria).toEqual([
      { numberBefore: 1, before: "X.", after: undefined },
      // A key gone from the new text: by number.
      { key: "k2bb", numberBefore: 3, numberAfter: 3, before: "Z.", after: "Z!" },
      { numberAfter: 2, before: undefined, after: "X." },
    ]);
    // A type without criteria; a property list and a value that is no string.
    const need = (data: Record<string, unknown>): ElementContent => ({
      type: "need",
      data: { id: A, type: "need", ...data },
      text: "",
    });
    const needs = fieldDifference(
      metamodel,
      need({ "validation-criteria": ["One.", { odd: 1 }] }),
      need({ "validation-criteria": ["One."], "acceptance-criteria": ["Stray."] }),
    );
    expect(needs.criteria).toEqual([]);
    expect(needs.properties).toEqual([
      { key: "validation-criteria", before: '- One.\n- {"odd":1}', after: "- One." },
    ]);
    const numbers = fieldDifference(
      metamodel,
      requirement({ "requirement-type": 3, "derives-from": [{ title: "No id" }] }),
      requirement({ "requirement-type": "functional" }),
    );
    expect(numbers.properties).toEqual([{ key: "requirement-type", before: "3", after: "functional" }]);
    // Mappings compare by their keys in any order.
    const mapping = fieldDifference(
      metamodel,
      requirement({ "requirement-type": { b: "x ", a: 1 } }),
      requirement({ "requirement-type": { a: 1, b: "x" } }),
    );
    expect(mapping.properties).toEqual([]);
    expect(
      fieldDifference(metamodel, requirement({}), requirement({ "requirement-type": "quality" })).properties,
    ).toEqual([{ key: "requirement-type", before: undefined, after: "quality" }]);
  });
});

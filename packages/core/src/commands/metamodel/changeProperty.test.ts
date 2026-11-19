// metamodel.changeProperty (SR-238 AK2–AK4) on the small model of the test helper, with the use
// rules of SR-236 AK7 for the value kind, several values and fixed values.
import { describe, expect, it } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import {
  MODEL,
  SMALL_MODEL,
  WITH_MISSING_REPOSITORY,
  WORKSPACE_FILE,
  elements,
  failure,
  openSmall,
  run,
} from "../metamodel-commands.test-helper.js";

/** The output as `invoke` gives it, with the answer sentence. */
type Changed = CommandOutput<"metamodel.changeProperty"> & { readonly answer: string };

const change = (workspace: Parameters<typeof run>[0], input: Record<string, unknown>): Promise<Changed> =>
  run<Changed>(workspace, "metamodel.changeProperty", input);

const meta = (workspace: Parameters<typeof run>[0]): Promise<CommandOutput<"metamodel.get">> =>
  run<CommandOutput<"metamodel.get">>(workspace, "metamodel.get", {});

const REMARK = "  - { key: remark, name: Remark, kind: text }\n";

describe("metamodel.changeProperty changes a property in place (SR-238 AK2)", () => {
  it("[SR-238/AK-sj3y] changes name, description, limit, target types, Markdown, version and meaning at any time, and the requirement in a type", async () => {
    const files = elements([1, "note", { remark: "Set" }], [2, "hazard", { severity: "low" }]);
    const { workspace, read } = await openSmall(files);
    const changed = await change(workspace, {
      property: "remark",
      name: "Comment",
      description: "Free text",
      markdown: true,
      content: true,
      meaning: "statement",
    });
    expect(changed).toEqual({
      answer: "Changed the property Comment; 1 file written; 1 element with another version.",
      property: {
        key: "remark",
        name: "Comment",
        kind: "text",
        description: "Free text",
        markdown: true,
        content: true,
        meaning: "statement",
      },
      dropped: [],
      mentions: [],
      files: [MODEL],
      versionsChanged: 1,
      missingRequired: 0,
      problems: [],
    });
    expect(await read(MODEL)).toBe(
      SMALL_MODEL.replace(
        REMARK,
        "  - { key: remark, name: Comment, kind: text, description: Free text, markdown: true, content: true, meaning: statement }\n",
      ),
    );
    // false and null remove the lines again; a value it has already is no change.
    await change(workspace, {
      property: "remark",
      description: null,
      markdown: false,
      content: false,
      meaning: null,
      name: "Remark",
    });
    expect(await read(MODEL)).toBe(SMALL_MODEL);
    expect(await change(workspace, { property: "remark", name: "Remark", markdown: false })).toMatchObject({
      answer: "The property Remark has these values already; no file written.",
      files: [],
    });
    // Limit and target types, also while elements hold the property.
    await change(workspace, { property: "severity", many: false, maxItems: null });
    const { workspace: listed, read: readListed } = await openSmall(
      elements([3, "note", { remark: "Set" }]),
      SMALL_MODEL.replace(
        REMARK,
        "  - { key: remark, name: Remark, kind: text, many: true }\n  - { key: cause, name: Cause, kind: relation }\n",
      ),
    );
    await change(listed, { property: "remark", maxItems: 3 });
    await change(listed, { property: "cause", targetTypes: ["note", "hazard"] });
    expect(await readListed(MODEL)).toContain(
      "  - { key: remark, name: Remark, kind: text, many: true, max-items: 3 }\n",
    );
    expect((await meta(listed)).properties.find((p) => p.key === "cause")?.["target-types"]).toEqual([
      "note",
      "hazard",
    ]);
    await change(listed, { property: "cause", targetTypes: null, maxItems: null });
    expect((await meta(listed)).properties.find((p) => p.key === "cause")?.["target-types"]).toBeUndefined();

    // Required in a type: added to its own list, and taken out again into its own properties.
    await change(workspace, { property: "likelihood", type: "risk", required: true });
    expect((await meta(workspace)).types.find((t) => t.key === "risk")?.required).toEqual([
      "title",
      "likelihood",
    ]);
    await change(workspace, { property: "likelihood", type: "risk", required: false });
    expect(await read(MODEL)).toContain("    properties: [likelihood]\n    required: []\n");
    // Taken out of `required` only, the type keeps the property in `properties`.
    await change(workspace, { property: "severity", type: "hazard", required: true });
    await change(workspace, { property: "severity", type: "hazard", required: false });
    expect(await read(MODEL)).toContain("    properties: [title, severity]\n    required: [title]\n");
    const { workspace: onlyRequired, read: readOnlyRequired } = await openSmall(
      {},
      SMALL_MODEL.replace(
        "    properties: [title, remark]\n    required: [title]\n",
        "    properties: [remark]\n    required: [title]\n",
      ),
    );
    await change(onlyRequired, { property: "title", type: "note", required: false });
    expect(await readOnlyRequired(MODEL)).toContain("    properties: [remark, title]\n    required: []\n");
    expect(await change(onlyRequired, { property: "title", type: "note", required: false })).toMatchObject({
      files: [],
    });
  });

  it("refuses an unknown property, type or fixed value, a type without the property, a parent's requirement and fields of another kind", async () => {
    const { workspace, read } = await openSmall();
    const refusal = async (input: Record<string, unknown>): Promise<unknown> =>
      (await failure(workspace, "metamodel.changeProperty", input)).details;
    expect(await refusal({ property: "nope", name: "X" })).toEqual({ reason: "unknown", property: "nope" });
    expect(await refusal({ property: "title", type: "nope", required: true })).toEqual({
      reason: "unknown",
      type: "nope",
    });
    expect(await refusal({ property: "title", type: "note" })).toEqual({ reason: "type-and-required" });
    expect(await refusal({ property: "likelihood", type: "note", required: true })).toEqual({
      reason: "not-on-type",
      type: "note",
      property: "likelihood",
    });
    expect(await refusal({ property: "title", type: "risk", required: false })).toEqual({
      reason: "inherited",
      type: "risk",
      property: "title",
      from: "hazard",
    });
    expect(await refusal({ property: "severity", changeChoices: [{ choice: "mid", name: "Mid" }] })).toEqual({
      reason: "unknown",
      property: "severity",
      choice: "mid",
    });
    expect(await refusal({ property: "severity", removeChoices: ["mid"] })).toEqual({
      reason: "unknown",
      property: "severity",
      choice: "mid",
    });
    for (const [input, field, kind] of [
      [{ property: "remark", addChoices: [{ name: "A" }] }, "choices", "text"],
      [{ property: "remark", targetTypes: ["note"] }, "target-types", "text"],
      [{ property: "severity", markdown: true }, "markdown", "choice"],
      [{ property: "remark", kind: "relation", many: true, maxItems: 2 }, "max-items", "relation"],
    ] as const) {
      expect(await refusal(input)).toEqual({ reason: "kind-field", field, kind });
    }
    expect(await refusal({ property: "remark", maxItems: 2 })).toEqual({ reason: "single-value" });
    expect(await refusal({ property: "remark", many: false, maxItems: 2 })).toEqual({
      reason: "single-value",
    });
    expect(await read(MODEL)).toBe(SMALL_MODEL);
    // Only the type's list changes: an anchor in the property's definition does not refuse it.
    const anchored = SMALL_MODEL.replace(REMARK, "  - { key: remark, name: &r Remark, kind: text }\n");
    const { workspace: shared, read: readShared } = await openSmall({}, anchored);
    await change(shared, { property: "remark", type: "note", required: true });
    expect(await readShared(MODEL)).toBe(
      anchored.replace(
        "    required: [title]\n    statuses: [draft, noted]\n",
        "    required: [title, remark]\n    statuses: [draft, noted]\n",
      ),
    );
  });

  it("gives a choice property without fixed values its first one in the line of the definition", async () => {
    const { workspace, read } = await openSmall(
      {},
      SMALL_MODEL.replace(REMARK, "  - { key: remark, name: Remark, kind: choice }\n"),
    );
    expect(
      (await failure(workspace, "metamodel.changeProperty", { property: "remark", removeChoices: ["a"] }))
        .details,
    ).toEqual({
      reason: "unknown",
      property: "remark",
      choice: "a",
    });
    await change(workspace, { property: "remark", addChoices: [{ name: "A" }] });
    expect(await read(MODEL)).toContain(
      "  - { key: remark, name: Remark, kind: choice, choices: [{key: a, name: A}] }\n",
    );
  });
});

describe("metamodel.changeProperty changes the value kind only without use (SR-238 AK3)", () => {
  it("[SR-238/AK-btz9] changes the kind and several values of an unused property, drops the fields of the old kind and names them", async () => {
    const { workspace, read } = await openSmall(elements([1, "note", { remark: "Set" }]));
    const changed = await change(workspace, {
      property: "severity",
      kind: "text",
      markdown: true,
      many: true,
    });
    expect(changed.property).toEqual({
      key: "severity",
      name: "Severity",
      kind: "text",
      many: true,
      markdown: true,
    });
    expect(changed.dropped).toEqual(["choices"]);
    expect(changed.answer).toBe(
      "Changed the property Severity; removed choices, which the new kind or single value does not take; 1 file written.",
    );
    expect(await read(MODEL)).toContain(
      "  - key: severity\n    name: Severity\n    kind: text\n    many: true\n    markdown: true\n",
    );
    await change(workspace, { property: "severity", maxItems: 4 });
    // Back to a single value: the limit goes with it; a new kind takes the Markdown mark.
    expect((await change(workspace, { property: "severity", many: false, kind: "number" })).dropped).toEqual([
      "markdown",
      "max-items",
    ]);
    expect(await read(MODEL)).toContain("  - key: severity\n    name: Severity\n    kind: number\n  - {");
    // A relation property loses its target types with a new kind.
    const { workspace: related } = await openSmall(
      {},
      SMALL_MODEL.replace(
        REMARK,
        "  - { key: remark, name: Remark, kind: relation, target-types: [note] }\n",
      ),
    );
    expect(
      (await change(related, { property: "remark", kind: "choice", addChoices: [{ name: "Yes" }] })).property,
    ).toEqual({
      key: "remark",
      name: "Remark",
      kind: "choice",
      choices: [{ key: "yes", name: "Yes" }],
    });
  });

  it("[SR-238/AK-btz9] refuses a new kind or several values while an element file of a type with the property holds its key, also empty", async () => {
    // An element of another type holding the key does not count; one with an empty value does.
    const { workspace, read } = await openSmall(
      elements(
        [1, "note", { remark: '""' }],
        [2, "hazard", { remark: "Not its property" }],
        [3, "note", { remark: "Set" }],
      ),
    );
    const refused = await failure(workspace, "metamodel.changeProperty", { property: "remark", many: true });
    expect(refused.details).toMatchObject({
      reason: "in-use",
      uses: [{ kind: "property", key: "remark", count: 2 }],
    });
    expect(refused.message).toMatch(
      /^Property remark keeps its kind, several values and fixed values while elements use them: property remark: 2 elements \(NO-/,
    );
    expect(
      (await failure(workspace, "metamodel.changeProperty", { property: "remark", kind: "number" })).details,
    ).toMatchObject({
      reason: "in-use",
    });
    expect(await read(MODEL)).toBe(SMALL_MODEL);
    // The same kind is no change and needs no count.
    expect((await change(workspace, { property: "remark", kind: "text", many: false })).files).toEqual([]);
  });
});

describe("metamodel.changeProperty changes fixed values (SR-238 AK4)", () => {
  it("[SR-238/AK-sfwv] adds, renames, describes and removes fixed values; removing needs a value no element has", async () => {
    const { workspace, read } = await openSmall({
      ...elements([1, "hazard", { severity: "high" }], [2, "note", { severity: "[high]" }]),
      "filters/low.yaml": "reqseq-filter: 1\nname: Low\nwhere: { severity: [low] }\n",
    });
    const changed = await change(workspace, {
      property: "severity",
      addChoices: [{ name: "Medium", key: "mid" }],
      changeChoices: [
        { choice: "low", name: "Minor", description: "Can wait" },
        { choice: "high", description: null },
      ],
    });
    expect(changed.property.choices).toEqual([
      { key: "low", name: "Minor", description: "Can wait" },
      { key: "high", name: "High" },
      { key: "mid", name: "Medium" },
    ]);
    expect(await read(MODEL)).toContain(
      [
        "    choices:",
        "      - { key: low, name: Minor, description: Can wait }",
        "      - { key: high, name: High }",
        "      - key: mid",
        "        name: Medium",
        "",
      ].join("\n"),
    );
    // Removing: refused while an element of any type has the value, in a list too.
    const refused = await failure(workspace, "metamodel.changeProperty", {
      property: "severity",
      removeChoices: ["high", "mid"],
    });
    expect(refused.details).toMatchObject({
      reason: "in-use",
      uses: [{ kind: "value", key: "severity.high", count: 2 }],
    });
    const removed = await change(workspace, { property: "severity", removeChoices: ["mid", "low"] });
    expect(removed.property.choices).toEqual([{ key: "high", name: "High" }]);
    expect(removed.mentions).toEqual(["filters/low.yaml"]);
    expect(removed.answer).toBe(
      "Changed the property Severity; 1 file written; 1 file naming a removed fixed value, not changed.",
    );
    expect(await read("filters/low.yaml")).toBe("reqseq-filter: 1\nname: Low\nwhere: { severity: [low] }\n");
    expect(await read(MODEL)).toContain("    choices:\n      - { key: high, name: High }\n  - {");
  });

  it("[SR-236/AK-bm7r] counts fixed values on every element with the value, and refuses while a repository is not on this machine", async () => {
    const { workspace } = await openSmall(elements([1, "note", { severity: "low" }]));
    const uses = (await meta(workspace)).uses;
    expect(uses.values["severity"]).toEqual({ low: 1, high: 0 });
    // The kind change takes the fixed values, so their uses count too.
    expect(
      (await failure(workspace, "metamodel.changeProperty", { property: "severity", kind: "text" })).details,
    ).toMatchObject({
      uses: [{ kind: "value", key: "severity.low", count: 1 }],
    });
    const { workspace: missing, read } = await openSmall({ [WORKSPACE_FILE]: WITH_MISSING_REPOSITORY });
    const refused = await failure(missing, "metamodel.changeProperty", {
      property: "severity",
      removeChoices: ["low"],
    });
    expect([refused.code, refused.details]).toEqual([
      "file.folder-missing",
      { command: "metamodel.changeProperty", repository: "product", repositories: ["product"] },
    ]);
    expect(await read(MODEL)).toBe(SMALL_MODEL);
    // A change that needs no count works.
    expect((await change(missing, { property: "severity", name: "Impact" })).files).toEqual([MODEL]);
  });
});

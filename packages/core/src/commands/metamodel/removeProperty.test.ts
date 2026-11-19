// metamodel.removeProperty (SR-238 AK5) on the small model of the test helper, with the use rules
// of SR-236 AK7.
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
type Removed = CommandOutput<"metamodel.removeProperty"> & { readonly answer: string };

const remove = (workspace: Parameters<typeof run>[0], input: Record<string, unknown>): Promise<Removed> =>
  run<Removed>(workspace, "metamodel.removeProperty", input);

describe("metamodel.removeProperty removes a property from a type (SR-238 AK5)", () => {
  it("[SR-236/AK-bm7r] refuses while an element file cannot be read, naming it (assumption of #1990)", async () => {
    const { workspace, read } = await openSmall({ "elements/E-broken.md": "---\nid: [\n---\n" });
    const refused = await failure(workspace, "metamodel.removeProperty", {
      type: "note",
      property: "remark",
    });
    expect(refused.code).toBe("file.faulty");
    expect(refused.details).toMatchObject({
      command: "metamodel.removeProperty",
      files: [{ repository: "system", file: "elements/E-broken.md" }],
    });
    expect(await read(MODEL)).toBe(SMALL_MODEL);
  });

  it("[SR-238/AK-pbyq] removes a property the type has itself; its definition goes when no type has it any more", async () => {
    const files = {
      ...elements([2, "hazard", { severity: "low" }]),
      "filters/remarks.yaml": "reqseq-filter: 1\nname: Remarks\nwhere: { remark: [x] }\n",
    };
    const { workspace, read } = await openSmall(files);
    const removed = await remove(workspace, { type: "note", property: "remark" });
    expect(removed).toEqual({
      answer:
        "Removed the property remark from the type note and from the metamodel; 1 file written; 1 file naming a removed key, not changed.",
      type: "note",
      property: "remark",
      definitionRemoved: true,
      mentions: ["filters/remarks.yaml"],
      files: [MODEL],
      versionsChanged: 0,
      missingRequired: 0,
      versionsChangedElements: [],
      missingRequiredElements: [],
      problems: [],
    });
    // The key, the definition and the comment line above it go; every other line stays.
    expect(await read(MODEL)).toBe(
      SMALL_MODEL.replace("    properties: [title, remark]\n", "    properties: [title]\n").replace(
        "  # Only notes have a remark.\n  - { key: remark, name: Remark, kind: text }\n",
        "",
      ),
    );
    for (const [file, text] of Object.entries(files)) {
      expect(await read(file)).toBe(text);
    }
    // Another type still has the title: only the type's keys go, from `properties` and `required`.
    const title = await remove(workspace, { type: "note", property: "title" });
    expect([title.definitionRemoved, title.mentions, title.answer]).toEqual([
      false,
      [],
      "Removed the property title from the type note; 1 file written.",
    ]);
    expect(await read(MODEL)).toContain("    prefix: NO\n    properties: []\n    required: []\n");
    // A subtype that lists the key itself keeps it, so its elements do not count.
    const { workspace: listed, read: readListed } = await openSmall(
      elements([3, "risk", { severity: "high" }]),
      SMALL_MODEL.replace("    properties: [likelihood]\n", "    properties: [likelihood, severity]\n"),
    );
    expect((await remove(listed, { type: "hazard", property: "severity" })).definitionRemoved).toBe(false);
    expect(await readListed(MODEL)).toContain("    properties: [title]\n    required: [title]\n");
  });

  it("[SR-238/AK-pbyq] refuses while an element of the type or of an inheriting type holds it, and an inherited property", async () => {
    // Elements of the type and of the subtype; one with an empty value, one of another status.
    const { workspace, read } = await openSmall(
      elements(
        [1, "hazard", { severity: '""' }],
        [2, "risk", { severity: "low", status: "open" }],
        [3, "note", { severity: "low" }],
      ),
    );
    const refused = await failure(workspace, "metamodel.removeProperty", {
      type: "hazard",
      property: "severity",
    });
    expect(refused.details).toEqual({
      reason: "in-use",
      uses: [{ kind: "property", key: "severity", count: 2, elements: ["HZ-000001", "RI-000002"] }],
    });
    const inherited = await failure(workspace, "metamodel.removeProperty", {
      type: "risk",
      property: "severity",
    });
    expect([inherited.details, inherited.message]).toEqual([
      { reason: "inherited", type: "risk", property: "severity", from: "hazard" },
      "Type risk inherits the property severity from hazard; remove it there",
    ]);
    expect(
      (await failure(workspace, "metamodel.removeProperty", { type: "note", property: "likelihood" }))
        .details,
    ).toEqual({
      reason: "not-on-type",
      type: "note",
      property: "likelihood",
    });
    expect(
      (await failure(workspace, "metamodel.removeProperty", { type: "nope", property: "title" })).details,
    ).toEqual({
      reason: "unknown",
      type: "nope",
    });
    expect(
      (await failure(workspace, "metamodel.removeProperty", { type: "note", property: "nope" })).details,
    ).toEqual({
      reason: "unknown",
      property: "nope",
    });
    expect(await read(MODEL)).toBe(SMALL_MODEL);
    // A type that lists a property its parent has as well loses its own entry and keeps the property.
    const { workspace: twice, read: readTwice } = await openSmall(
      elements([4, "risk", { severity: "low" }]),
      SMALL_MODEL.replace("    properties: [likelihood]\n", "    properties: [likelihood, severity]\n"),
    );
    const own = await remove(twice, { type: "risk", property: "severity" });
    expect([own.definitionRemoved, own.inheritedFrom, own.answer]).toEqual([
      false,
      "hazard",
      "Removed the property severity from the type risk; it keeps it from its parent type hazard; 1 file written.",
    ]);
    expect(await readTwice(MODEL)).toBe(SMALL_MODEL);
    // A type without its own required list; its elements do not hold the key.
    expect((await remove(workspace, { type: "risk", property: "likelihood" })).definitionRemoved).toBe(true);
  });

  it("[SR-236/AK-bm7r] refuses a removal while a repository of the workspace is not on this machine and names it", async () => {
    const { workspace, read } = await openSmall({ [WORKSPACE_FILE]: WITH_MISSING_REPOSITORY });
    const refused = await failure(workspace, "metamodel.removeProperty", {
      type: "note",
      property: "remark",
    });
    expect([refused.code, refused.details]).toEqual([
      "file.folder-missing",
      { command: "metamodel.removeProperty", repository: "product", repositories: ["product"] },
    ]);
    expect(await read(MODEL)).toBe(SMALL_MODEL);
  });
});

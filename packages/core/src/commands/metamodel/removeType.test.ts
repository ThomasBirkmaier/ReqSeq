// metamodel.removeType (SR-237 AK5) and the use rule of the frame (SR-236 AK7) as this command
// shows it, on the small model of the test helper.
import { describe, expect, it } from "vitest";
import removeType from "./removeType.js";
import type { CommandOutput } from "../../catalog.js";
import {
  MODEL,
  SMALL_MODEL,
  WITH_MISSING_REPOSITORY,
  WORKSPACE_FILE,
  elementFile,
  elements,
  failure,
  openSmall,
  openSmallAcross,
  run,
  uuid,
} from "../metamodel-commands.test-helper.js";

/** The output as `invoke` gives it, with the answer sentence. */
type Removed = CommandOutput<"metamodel.removeType"> & { readonly answer: string };

const remove = (workspace: Parameters<typeof run>[0], type: string): Promise<Removed> =>
  run<Removed>(workspace, "metamodel.removeType", { type });

/** `text` without the lines that `drop` holds, each once. */
const without = (text: string, ...drop: readonly string[]): string =>
  drop.reduce((rest, lines) => {
    expect(rest).toContain(lines);
    return rest.replace(lines, "");
  }, text);

describe("metamodel.removeType removes an unused type (SR-237 AK5)", () => {
  it("[SR-237/AK-b0j6] removes a type nothing uses or names, with the property and status only it had", async () => {
    const { workspace, read } = await openSmall(elements([1, "hazard"]));
    const removed = await remove(workspace, "note");
    expect(removed).toEqual({
      answer: "Removed the type note with remark and noted; 1 file written.",
      type: "note",
      removed: { properties: ["remark"], statuses: ["noted"] },
      kept: [],
      mentions: [],
      files: [MODEL],
      versionsChanged: 0,
      missingRequired: 0,
      versionsChangedElements: [],
      missingRequiredElements: [],
      problems: [],
    });
    // Its lines go, with the comment directly above a removed definition; every other line stays.
    expect(await read(MODEL)).toBe(
      without(
        SMALL_MODEL,
        "  - key: note\n    name: Note\n    prefix: NO\n    properties: [title, remark]\n    required: [title]\n    statuses: [draft, noted]\n",
        "  # Only notes have a remark.\n  - { key: remark, name: Remark, kind: text }\n",
        "  - { key: noted, name: Noted }\n",
      ),
    );
    const meta = await run<CommandOutput<"metamodel.get">>(workspace, "metamodel.get", {});
    expect(meta.types.map((t) => t.key)).toEqual(["hazard", "risk"]);
    expect(meta.statuses.map((s) => s.key)).toEqual(["draft", "open"]);
  });

  it("[SR-237/AK-b0j6] refuses a type that is extended, named by a relation kind or a property, or used, names each and writes nothing", async () => {
    const model = SMALL_MODEL.replace(
      "  - { key: likelihood, name: Likelihood, kind: text }",
      "  - { key: likelihood, name: Likelihood, kind: text }\n  - { key: cause, name: Cause, kind: relation, target-types: [hazard] }",
    ).replace(
      "    target-types: [hazard]\n",
      "    source-types: [note]\n    target-types: [hazard]\n    limits: [{ target-type: risk, max: 2 }]\n",
    );
    const { workspace, read } = await openSmall(elements([1, "hazard"], [2, "risk"]), model);
    const named = await failure(workspace, "metamodel.removeType", { type: "hazard" });
    expect(named.code).toBe("input.invalid");
    expect(named.details).toEqual({
      reason: "in-use",
      named: [
        "type risk extends it",
        "relation kind about has it as target type",
        "property cause has it as target type",
      ],
      uses: [{ kind: "type", key: "hazard", count: 1, elements: ["HZ-000001"] }],
    });
    expect(named.message).toContain("type risk extends it");
    const limited = await failure(workspace, "metamodel.removeType", { type: "risk" });
    expect(limited.details).toMatchObject({ named: ["relation kind about names it in a limit"] });
    const source = await failure(workspace, "metamodel.removeType", { type: "note" });
    expect(source.details).toEqual({
      reason: "in-use",
      named: ["relation kind about has it as source type"],
      uses: [],
    });
    expect(await read(MODEL)).toBe(model);
  });

  it("removes the last type with every property and status but the initial one", async () => {
    const model =
      "reqseq-metamodel: 1\ntypes:\n  - { key: note, name: Note, prefix: NO, properties: [remark] }\nproperties:\n  - { key: remark, name: Remark, kind: text }\nstatuses:\n  - { key: draft, name: Draft, initial: true }\n  - { key: noted, name: Noted }\n";
    const { workspace, read } = await openSmall({}, model);
    expect((await remove(workspace, "note")).removed).toEqual({
      properties: ["remark"],
      statuses: ["noted"],
    });
    expect(await read(MODEL)).toBe(
      "reqseq-metamodel: 1\ntypes: []\nproperties: []\nstatuses:\n  - { key: draft, name: Draft, initial: true }\n",
    );
  });

  it("keeps a status another type has, also one without a status list, and a property another type lists", async () => {
    const model = SMALL_MODEL.replace("    statuses: [draft, open]\n", "").replace(
      "    properties: [title, severity]",
      "    properties: [title, severity, remark]",
    );
    const { workspace } = await openSmall({}, model);
    expect((await remove(workspace, "note")).removed).toEqual({ properties: [], statuses: [] });
  });

  it("[SR-237/AK-b0j6] keeps each definition no type has any more that an element of another type holds, names it with their number, and drops a relation property of the type to itself", async () => {
    const model = SMALL_MODEL.replace(
      "    properties: [title, remark]",
      "    properties: [title, remark, follows]",
    ).replace(
      "  - { key: remark, name: Remark, kind: text }",
      "  - { key: remark, name: Remark, kind: text }\n  - { key: follows, name: Follows, kind: relation, target-types: [note] }",
    );
    // An element of another type, and one in another repository of a type the metamodel does not know.
    const { workspace, read } = await openSmallAcross(
      {
        [`system/elements/E-1.md`]: elementFile(uuid(1), "hazard", { status: "noted", remark: "stray" }),
        [`product/E-2.md`]: elementFile(uuid(2), "memo", { remark: '""' }),
        "system/filters/notes.yaml":
          "reqseq-filter: 1\nname: Notes\nwhere: { remark: [x], status: [noted] }\n",
      },
      model,
    );
    const removed = await remove(workspace, "note");
    expect(removed.answer).toBe(
      "Removed the type note with follows; no type has the property remark any more, but its definition stays, as 2 elements hold it; no type has the status noted any more, but its definition stays, as 1 element has it; 1 file written.",
    );
    expect([removed.removed, removed.kept, removed.mentions]).toEqual([
      { properties: ["follows"], statuses: [] },
      [
        {
          kind: "property",
          key: "remark",
          count: 2,
          elements: [
            { id: uuid(1), shortId: "HZ-000001", repository: "system" },
            { id: uuid(2), shortId: "UNKNOWN-000002", repository: "product" },
          ],
        },
        {
          kind: "status",
          key: "noted",
          count: 1,
          elements: [{ id: uuid(1), shortId: "HZ-000001", repository: "system" }],
        },
      ],
      [],
    ]);
    const after = await read(MODEL);
    expect(after).toContain("  - { key: remark, name: Remark, kind: text }\n");
    expect(after).toContain("  - { key: noted, name: Noted }\n");
    expect(after).not.toContain("key: follows");
  });

  it("[SR-237/AK-b0j6] keeps the initial status that no type has any more and names the elements that have it", async () => {
    // Only note has the initial status; the system requirement of the fixture is a draft.
    const model = SMALL_MODEL.replace("    statuses: [draft, open]\n", "    statuses: [open]\n");
    const { workspace, read } = await openSmall({}, model);
    const removed = await remove(workspace, "note");
    expect([removed.removed, removed.kept.map((k) => [k.kind, k.key, k.count])]).toEqual([
      { properties: ["remark"], statuses: ["noted"] },
      [["status", "draft", 1]],
    ]);
    expect(await read(MODEL)).toContain("  - { key: draft, name: Draft, initial: true }\n");
  });

  it("[SR-237/AK-b0j6] refuses while a relation property that has the type as target type stays, as an element holds its key", async () => {
    const model = SMALL_MODEL.replace(
      "    properties: [title, remark]",
      "    properties: [title, remark, follows]",
    ).replace(
      "  - { key: remark, name: Remark, kind: text }",
      "  - { key: remark, name: Remark, kind: text }\n  - { key: follows, name: Follows, kind: relation, target-types: [note] }",
    );
    const { workspace, read } = await openSmall(elements([1, "hazard", { follows: "[]" }]), model);
    const refused = await failure(workspace, "metamodel.removeType", { type: "note" });
    expect([refused.code, refused.details]).toEqual([
      "input.invalid",
      {
        reason: "in-use",
        named: ["property follows has it as target type"],
        uses: [{ kind: "property", key: "follows", count: 1, elements: ["HZ-000001"] }],
      },
    ]);
    expect(await read(MODEL)).toBe(model);
  });

  it("refuses a definition that holds a YAML anchor or alias, with file and line (SR-236 AK5)", async () => {
    const model = SMALL_MODEL.replace("    name: Note\n", "    name: &n Note\n");
    const { workspace } = await openSmall({}, model);
    const anchored = await failure(workspace, "metamodel.removeType", { type: "note" });
    expect([anchored.code, anchored.details]).toEqual([
      "file.faulty",
      { file: MODEL, line: 16, repository: "system" },
    ]);
  });

  it("refuses an unknown type", async () => {
    const { workspace } = await openSmall();
    const unknown = await failure(workspace, "metamodel.removeType", { type: "nope" });
    expect([unknown.code, unknown.details]).toEqual(["input.invalid", { reason: "unknown", type: "nope" }]);
  });
});

describe("metamodel commands: what counts as a use (SR-236 AK7)", () => {
  it("[SR-236/AK-bm7r] counts every element of the type in any status and names the first 20 by short ID", async () => {
    const list = Array.from(
      { length: 21 },
      (_, i) => [i + 1, "note", i === 0 ? { status: "noted" } : {}] as const,
    );
    const { workspace, read } = await openSmall(elements(...list));
    const used = await failure(workspace, "metamodel.removeType", { type: "note" });
    const shown = Array.from(
      { length: 20 },
      (_, i) =>
        `NO-${uuid(i + 1)
          .replaceAll("-", "")
          .slice(-6)}`,
    ).sort();
    expect(used.details).toEqual({
      reason: "in-use",
      uses: [{ kind: "type", key: "note", count: 21, elements: shown }],
    });
    expect(used.message).toContain("type note: 21 elements (");
    expect(used.message).toContain(", …)");
    expect(await read(MODEL)).toBe(SMALL_MODEL);
  });

  it("[SR-236/AK-bm7r] refuses while a repository of the workspace is not on this machine and names it", async () => {
    const { workspace, read } = await openSmall({ [WORKSPACE_FILE]: WITH_MISSING_REPOSITORY });
    const missing = await failure(workspace, "metamodel.removeType", { type: "note" });
    expect([missing.code, missing.details]).toEqual([
      "file.folder-missing",
      { command: "metamodel.removeType", repository: "product", repositories: ["product"] },
    ]);
    expect(missing.message).toContain("product");
    expect(await read(MODEL)).toBe(SMALL_MODEL);
  });

  it("[SR-236/AK-bm7r] names the saved filters, perspectives and mapping files that name a removed key and does not change them", async () => {
    const filter = "reqseq-filter: 1\nname: note\nwhere: { type: [note] }\n";
    const perspective =
      "reqseq-perspective: 1\nname: Remarks\ndescription: noted\ncolumns: [title, remark]\n";
    const mapping = "reqseq-reqif-mapping: 1\nstatuses: { Done: noted }\n";
    const files = {
      "filters/notes.yaml": filter,
      "filters/plain.yaml": "reqseq-filter: 1\nname: note\ndescription: note\nwhere: { type: [hazard] }\n",
      "filters/broken.yaml": "a: [\n",
      "filters/readme.txt": "note",
      "perspectives/remarks.yaml": perspective,
      "reqif/supplier.yaml": mapping,
    };
    const { workspace, read } = await openSmall(files);
    expect((await remove(workspace, "note")).mentions).toEqual([
      "filters/notes.yaml",
      "perspectives/remarks.yaml",
      "reqif/supplier.yaml",
    ]);
    expect([
      await read("filters/notes.yaml"),
      await read("perspectives/remarks.yaml"),
      await read("reqif/supplier.yaml"),
    ]).toEqual([filter, perspective, mapping]);
  });
});

describe("the answer of metamodel.removeType", () => {
  it("names the type, what went with it, the files, the files naming a removed key and the problems", () => {
    const output = {
      type: "note",
      removed: { properties: [], statuses: [] },
      kept: [],
      mentions: ["filters/notes.yaml"],
      files: [MODEL],
      versionsChanged: 0,
      missingRequired: 0,
      problems: [{}],
    };
    expect(
      removeType.answer(output as never, { type: "note" }, { type: (key) => key, element: (ref) => ref }),
    ).toBe("Removed the type note; 1 file written; 1 file naming a removed key, not changed; 1 problem.");
  });
});

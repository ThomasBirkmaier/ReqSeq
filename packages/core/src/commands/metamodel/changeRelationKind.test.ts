// metamodel.changeRelationKind (SR-239 AK2) and the frame of the metamodel commands (SR-236) as this
// command shows it, on the small model of the test helper: the relation kind `about` targets hazards.
import { describe, expect, it } from "vitest";
import changeRelationKind from "./changeRelationKind.js";
import type { CommandOutput } from "../../catalog.js";
import {
  MODEL,
  SMALL_MODEL,
  elements,
  failure,
  openSmall,
  run,
  uuid,
} from "../metamodel-commands.test-helper.js";
import { openOwn } from "../metamodel-relation-kind.test-helper.js";

type Changed = CommandOutput<"metamodel.changeRelationKind"> & { readonly answer: string };

const change = (workspace: Parameters<typeof run>[0], input: Record<string, unknown>): Promise<Changed> =>
  run<Changed>(workspace, "metamodel.changeRelationKind", input);

const ABOUT = "  - key: about\n    name: About\n    target-types: [hazard]\n";

/** The codes and element files of the hints on relation types and limits the check of the workspace gives. */
const relationHints = async (workspace: Parameters<typeof run>[0]): Promise<string[]> =>
  (await run<CommandOutput<"workspace.check">>(workspace, "workspace.check", {})).problems
    .filter((p) => ["relation.not-allowed", "relation.too-few", "relation.too-many"].includes(p.code))
    .map((p) => `${p.code} ${String(p.file)}`);

describe("metamodel.changeRelationKind changes a relation kind in place (SR-239 AK2)", () => {
  it("[SR-239/AK-qt0q] changes every field; relations that no longer fit stay as they are and the check of the workspace reports them", async () => {
    // A note about a hazard: allowed now, no longer once only risks are targets and a note needs two.
    const files = elements(
      [1, "hazard"],
      [2, "note", { about: `[{ id: ${uuid(1)}, version: "n1:0000000000000000" }]` }],
      [3, "risk"],
    );
    const { workspace, read } = await openSmall(files);
    expect(await relationHints(workspace)).toEqual([]);
    const changed = await change(workspace, {
      kind: "about",
      name: "Concerns",
      inverseName: "Concerned by",
      description: "The source is about the target",
      sourceTypes: ["note"],
      targetTypes: ["risk"],
      limits: [{ "target-type": "risk", min: 2 }],
      meaning: "derivation",
    });
    expect(changed).toEqual({
      answer: "Changed the relation kind Concerns; 1 file written.",
      relationKind: {
        key: "about",
        name: "Concerns",
        "target-types": ["risk"],
        "inverse-name": "Concerned by",
        description: "The source is about the target",
        "source-types": ["note"],
        limits: [{ "target-type": "risk", min: 2 }],
        meaning: "derivation",
      },
      files: [MODEL],
      versionsChanged: 0,
      missingRequired: 0,
      problems: [],
    });
    expect(await read(MODEL)).toBe(
      SMALL_MODEL.replace(
        ABOUT,
        [
          "  - key: about",
          "    name: Concerns",
          "    target-types: [risk]",
          "    description: The source is about the target",
          "    inverse-name: Concerned by",
          "    source-types: [note]",
          "    limits:",
          "      - target-type: risk",
          "        min: 2",
          "    meaning: derivation",
          "",
        ].join("\n"),
      ),
    );
    // No element file changes; the check reports the relation that no longer fits and the limit.
    for (const [file, text] of Object.entries(files)) {
      expect(await read(file)).toBe(text);
    }
    expect(await relationHints(workspace)).toEqual([
      "relation.not-allowed elements/E-000000000002.md",
      "relation.too-few elements/E-000000000002.md",
    ]);

    // null removes a field: every type again, any number, no meaning.
    const opened = await change(workspace, {
      kind: "about",
      sourceTypes: null,
      targetTypes: null,
      limits: null,
      meaning: null,
      inverseName: null,
      description: null,
    });
    expect(opened.relationKind).toEqual({ key: "about", name: "Concerns" });
    expect(await read(MODEL)).toBe(SMALL_MODEL.replace(ABOUT, "  - key: about\n    name: Concerns\n"));
    expect(await relationHints(workspace)).toEqual([]);
  });

  it("changes nothing when every field has the value already, and refuses an unknown relation kind", async () => {
    const { workspace, read } = await openSmall();
    const same = await change(workspace, {
      kind: "about",
      name: "About",
      targetTypes: ["hazard"],
      meaning: null,
    });
    expect([same.answer, same.files]).toEqual([
      "The relation kind About has these values already; no file written.",
      [],
    ]);
    expect(await read(MODEL)).toBe(SMALL_MODEL);
    const unknown = await failure(workspace, "metamodel.changeRelationKind", { kind: "nope", name: "X" });
    expect([unknown.code, unknown.details]).toEqual([
      "input.invalid",
      { reason: "unknown", relationKind: "nope" },
    ]);
  });
});

describe("metamodel commands: the frame as metamodel.changeRelationKind shows it (SR-236)", () => {
  it("[SR-236/AK-sx7z] refuses a change that would give the metamodel an error and names it, and writes nothing", async () => {
    const { workspace, read } = await openSmall();
    const unknown = await failure(workspace, "metamodel.changeRelationKind", {
      kind: "about",
      sourceTypes: ["accident"],
    });
    expect(unknown.details).toMatchObject({ reason: "metamodel-invalid" });
    expect(unknown.message).toContain("accident");
    expect(await read(MODEL)).toBe(SMALL_MODEL);
  });

  it("[SR-236/AK-rk7z] refuses a name another relation kind has and writes nothing; its own name is no other's", async () => {
    const model = SMALL_MODEL.replace("statuses:\n", "  - { key: causes, name: Causes }\nstatuses:\n");
    const { workspace, read } = await openSmall({}, model);
    const taken = await failure(workspace, "metamodel.changeRelationKind", { kind: "about", name: "Causes" });
    expect([taken.code, taken.details]).toEqual([
      "input.invalid",
      { reason: "taken", field: "name", relationKind: "causes" },
    ]);
    expect(await read(MODEL)).toBe(model);
    expect((await change(workspace, { kind: "causes", name: "Causes" })).files).toEqual([]);
  });

  it("[SR-236/AK-k2s3] changes only the lines of the changed fields: a comment at their end goes, every other line stays", async () => {
    const model = SMALL_MODEL.replace(
      "    name: About\n",
      "    # Shown at the source.\n    name: About   # the old name\n    description: Kept # as it is\n",
    );
    const { workspace, read } = await openSmall({}, model);
    expect((await change(workspace, { kind: "about", name: "Regards" })).files).toEqual([MODEL]);
    expect(await read(MODEL)).toBe(
      model.replace("    name: About   # the old name\n", "    name: Regards\n"),
    );
  });

  it("[SR-236/AK-yf6d] changes the file the relation kind is in, and no other", async () => {
    const relations = "reqseq-metamodel: 1\nrelations:\n  - { key: about, name: About }\n";
    const { workspace, read } = await openOwn({ "models/model/z-relations.yaml": relations });
    const properties = await read("models/model/properties.yaml");
    expect((await change(workspace, { kind: "about", inverseName: "Subject of" })).files).toEqual([
      "../models/model/z-relations.yaml",
    ]);
    expect(await read("models/model/z-relations.yaml")).toBe(
      "reqseq-metamodel: 1\nrelations:\n  - { key: about, name: About, inverse-name: Subject of }\n",
    );
    expect(await read("models/model/properties.yaml")).toBe(properties);
  });

  it("[SR-236/AK-cv7t] refuses a relation kind with a YAML anchor or alias in it and names file and line", async () => {
    const model = SMALL_MODEL.replace(
      "    target-types: [hazard]\n",
      "    target-types: &targets [hazard]\n",
    );
    const { workspace, read } = await openSmall({}, model);
    const refused = await failure(workspace, "metamodel.changeRelationKind", {
      kind: "about",
      name: "Regards",
    });
    expect([refused.code, refused.details]).toEqual([
      "file.faulty",
      { file: MODEL, line: 35, repository: "system" },
    ]);
    expect(await read(MODEL)).toBe(model);
  });
});

describe("the answer of metamodel.changeRelationKind", () => {
  it("names the counts and the problems", () => {
    const output = {
      relationKind: { key: "about", name: "About" },
      files: [MODEL],
      versionsChanged: 1,
      missingRequired: 2,
      problems: [{}],
    };
    expect(changeRelationKind.answer(output as never, { kind: "about" }, { type: (key) => key })).toBe(
      "Changed the relation kind About; 1 file written; 1 element with another version; 2 elements missing a required property; 1 problem.",
    );
  });
});

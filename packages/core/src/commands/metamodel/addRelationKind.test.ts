// metamodel.addRelationKind (SR-239 AK1) and the frame of the metamodel commands (SR-236) as this
// command shows it, on the small model of the test helper and on fixtures/SR-018/own-repository
// (types, properties and statuses in three files of an own repository).
import path from "node:path";
import { describe, expect, it } from "vitest";
import addRelationKind from "./addRelationKind.js";
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
import { openOwn, snapshot } from "../metamodel-relation-kind.test-helper.js";

type Added = CommandOutput<"metamodel.addRelationKind"> & { readonly answer: string };

const add = (workspace: Parameters<typeof run>[0], input: Record<string, unknown>): Promise<Added> =>
  run<Added>(workspace, "metamodel.addRelationKind", input);

/** The small model with `lines` at the end of its relations, before `statuses:`. */
const withRelation = (lines: string): string => SMALL_MODEL.replace("statuses:\n", `${lines}statuses:\n`);

describe("metamodel.addRelationKind adds a relation kind (SR-239 AK1)", () => {
  it("[SR-239/AK-rvxg] adds a relation kind with every field, and relations of the kind can be set at once", async () => {
    const { workspace, read } = await openSmall(elements([1, "risk"], [2, "hazard"]));
    const added = await add(workspace, {
      name: "Mitigates",
      inverseName: "Mitigated by",
      description: "The source lowers the target: a risk",
      sourceTypes: ["risk"],
      targetTypes: ["hazard"],
      limits: [{ "target-type": "hazard", max: 3 }],
      meaning: "derivation",
    });
    const relationKind = {
      key: "mitigates",
      name: "Mitigates",
      description: "The source lowers the target: a risk",
      "inverse-name": "Mitigated by",
      "source-types": ["risk"],
      "target-types": ["hazard"],
      limits: [{ "target-type": "hazard", max: 3 }],
      meaning: "derivation",
    };
    expect(added).toEqual({
      answer: "Added the relation kind Mitigates; 1 file written.",
      relationKind,
      files: [MODEL],
      versionsChanged: 0,
      missingRequired: 0,
      versionsChangedElements: [],
      missingRequiredElements: [],
      problems: [],
    });
    expect(await read(MODEL)).toBe(
      withRelation(
        [
          "  - key: mitigates",
          "    name: Mitigates",
          '    description: "The source lowers the target: a risk"',
          "    inverse-name: Mitigated by",
          "    source-types: [risk]",
          "    target-types: [hazard]",
          "    limits:",
          "      - target-type: hazard",
          "        max: 3",
          "    meaning: derivation",
          "",
        ].join("\n"),
      ),
    );
    const meta = await run<CommandOutput<"metamodel.get">>(workspace, "metamodel.get", {});
    expect(meta.relations.find((r) => r.key === "mitigates")).toEqual(relationKind);
    // SR-067: a relation of the new kind is set from a risk to a hazard.
    const set = await run<CommandOutput<"relation.add">>(workspace, "relation.add", {
      source: uuid(1),
      kind: "mitigates",
      target: uuid(2),
    });
    expect(set.files).toEqual(["elements/E-000000000001.md"]);
    expect(await read("elements/E-000000000001.md")).toContain(`mitigates:\n  - { id: ${uuid(2)}, version:`);
  });

  it("adds a relation kind with a name only, for every type", async () => {
    const { workspace, read } = await openSmall();
    expect((await add(workspace, { name: "See also" })).relationKind).toEqual({
      key: "see-also",
      name: "See also",
    });
    expect(await read(MODEL)).toBe(withRelation("  - key: see-also\n    name: See also\n"));
  });
});

describe("metamodel commands: the frame as metamodel.addRelationKind shows it (SR-236)", () => {
  it("[SR-236/AK-sx7z] refuses a relation kind that would give the metamodel an error and names it; writes with warnings and names them", async () => {
    const { workspace, read } = await openSmall();
    const unknown = await failure(workspace, "metamodel.addRelationKind", {
      name: "Causes",
      targetTypes: ["accident"],
    });
    expect(unknown.details).toMatchObject({
      reason: "metamodel-invalid",
      problems: [{ code: "metamodel.invalid", severity: "error", file: MODEL, repository: "system" }],
    });
    expect(unknown.message).toContain("accident");
    // A key a property already has is an error of the metamodel (ADR-0004).
    const shared = await failure(workspace, "metamodel.addRelationKind", { name: "Titled", key: "title" });
    expect(shared.details).toMatchObject({ reason: "metamodel-invalid" });
    expect(shared.message).toContain("Relation kind key title is already used by a property");
    const limits = await failure(workspace, "metamodel.addRelationKind", {
      name: "Causes",
      limits: [
        { "target-type": "hazard", min: 1 },
        { "target-type": "hazard", max: 2 },
      ],
    });
    expect(limits.details).toMatchObject({ reason: "metamodel-invalid" });
    // id, type and status are fields every element has (D-012): neither a given key nor one made
    // from the name may be one of them.
    for (const input of [{ name: "Status" }, { name: "Same as", key: "id" }, { name: "Type" }]) {
      const structural = await failure(workspace, "metamodel.addRelationKind", input);
      expect(structural.details).toMatchObject({ reason: "metamodel-invalid" });
      expect(structural.message).toContain("is a field every element has (D-012)");
    }
    expect(await read(MODEL)).toBe(SMALL_MODEL);

    // A type that names an unknown property is only a warning: written, and named.
    const { workspace: warned } = await openSmall(
      {},
      SMALL_MODEL.replace("    properties: [likelihood]\n", "    properties: [likelihood, gone]\n"),
    );
    const added = await add(warned, { name: "Causes" });
    expect(added.problems.map((p) => [p.code, p.severity, p.file])).toEqual([
      ["metamodel.invalid", "warning", MODEL],
    ]);
    expect(added.answer).toBe("Added the relation kind Causes; 1 file written; 1 problem.");
  });

  it("[SR-236/AK-rk7z] refuses a name another relation kind has and writes nothing", async () => {
    const { workspace, read } = await openSmall();
    const taken = await failure(workspace, "metamodel.addRelationKind", { name: "About", key: "regarding" });
    expect([taken.code, taken.details]).toEqual([
      "input.invalid",
      { reason: "taken", field: "name", relationKind: "about" },
    ]);
    // The same name in another Unicode normal form is the same name.
    const { workspace: umlaut } = await openSmall(
      {},
      SMALL_MODEL.replace("    name: About\n", "    name: Über\n"),
    );
    const nfd = await failure(umlaut, "metamodel.addRelationKind", { name: "Über", key: "over" });
    expect(nfd.details).toEqual({ reason: "taken", field: "name", relationKind: "about" });
    // A type or property of that name is no relation kind.
    expect((await add(workspace, { name: "Hazard", key: "hazard-of" })).files).toEqual([MODEL]);
    expect(await read(MODEL)).toBe(withRelation("  - key: hazard-of\n    name: Hazard\n"));
  });

  it("[SR-236/AK-k2s3] changes only the lines it adds in the metamodel file, no element file and nothing in Git, and names the file", async () => {
    const files = elements([1, "hazard"]);
    const { fixture, workspace } = await openSmall(files, SMALL_MODEL, { git: true });
    const head = await fixture.git(["rev-parse", "HEAD"]);
    const before = await snapshot(fixture.root);
    expect((await add(workspace, { name: "Causes" })).files).toEqual([MODEL]);
    const after = await snapshot(fixture.root);
    const changed = Object.keys(after).filter((file) => after[file] !== before[file]);
    expect(changed).toEqual([path.normalize(MODEL)]);
    // Every other line stays with its comment; the new lines follow the last relation kind.
    expect(after[path.normalize(MODEL)]).toBe(withRelation("  - key: causes\n    name: Causes\n"));
    expect(await fixture.git(["rev-parse", "HEAD"])).toBe(head);
    expect(await fixture.git(["status", "--porcelain"])).toBe(` M ${MODEL}\n`);
  });

  it("[SR-236/AK-yf6d] puts a new relation kind into the first file by name that has relations, else at the end of the first file", async () => {
    const none = await openOwn();
    const added = await add(none.workspace, { name: "Causes" });
    expect(added.files).toEqual(["../models/model/properties.yaml"]);
    expect(await none.read("models/model/properties.yaml")).toBe(
      "reqseq-metamodel: 1\nproperties:\n  - key: title\n    name: Title\n    kind: text\nrelations:\n  - key: causes\n    name: Causes\n",
    );

    const relations = "reqseq-metamodel: 1\nrelations: # the links\n  - { key: about, name: About }\n";
    const listed = await openOwn({ "models/model/z-relations.yaml": relations });
    expect((await add(listed.workspace, { name: "Causes" })).files).toEqual([
      "../models/model/z-relations.yaml",
    ]);
    expect(await listed.read("models/model/z-relations.yaml")).toBe(
      `${relations}  - key: causes\n    name: Causes\n`,
    );
  });

  it("[SR-236/AK-cv7t] refuses when the list relations is behind a YAML anchor, and names file and line", async () => {
    const anchored = SMALL_MODEL.replace("relations:\n", "relations: &links\n");
    const { workspace, read } = await openSmall({}, anchored);
    const refused = await failure(workspace, "metamodel.addRelationKind", { name: "Causes" });
    expect([refused.code, refused.details]).toEqual([
      "file.faulty",
      { file: MODEL, line: 32, repository: "system" },
    ]);
    expect(await read(MODEL)).toBe(anchored);
  });

  it("[SR-236/AK-n13v] makes the key from the name, or refuses and asks for one; properties and relation kinds count together", async () => {
    const { workspace } = await openSmall();
    expect((await add(workspace, { name: "Hängt ab von" })).relationKind.key).toBe("haengt-ab-von");
    expect((await add(workspace, { name: "Mitigates", key: "lowers" })).relationKind.key).toBe("lowers");
    for (const [name, key, why] of [
      ["2nd cause", "2nd-cause", "does not start with a letter"],
      ["***", "", "is empty"],
      [`R${"x".repeat(64)}`, `r${"x".repeat(64)}`, "is longer than 64 characters"],
      ["About!", "about", "is already the key of a property or relation kind"],
      ["Remark", "remark", "is already the key of a property or relation kind"],
    ] as const) {
      const refused = await failure(workspace, "metamodel.addRelationKind", { name });
      expect([refused.code, refused.details]).toEqual(["input.invalid", { reason: "key-required", key }]);
      expect(refused.message).toContain(why);
    }
  });
});

describe("the answer of metamodel.addRelationKind", () => {
  it("names the relation kind, the files, the counts and the problems", () => {
    const output = {
      relationKind: { key: "causes", name: "Causes" },
      files: [MODEL],
      versionsChanged: 2,
      missingRequired: 1,
      problems: [],
    };
    expect(addRelationKind.answer(output as never, { name: "Causes" }, { type: (key) => key })).toBe(
      "Added the relation kind Causes; 1 file written; 2 elements with another version; 1 element now missing a required property.",
    );
  });
});

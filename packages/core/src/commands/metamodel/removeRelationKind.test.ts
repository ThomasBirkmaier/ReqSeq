// metamodel.removeRelationKind (SR-239 AK3) and the use rule of the frame (SR-236 AK7) as this
// command shows it, on the small model of the test helper: the relation kind `about` targets hazards.
import { describe, expect, it } from "vitest";
import removeRelationKind from "./removeRelationKind.js";
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
  uuid,
} from "../metamodel-commands.test-helper.js";
import { openOwn } from "../metamodel-relation-kind.test-helper.js";

type Removed = CommandOutput<"metamodel.removeRelationKind"> & { readonly answer: string };

const remove = (workspace: Parameters<typeof run>[0], kind: string): Promise<Removed> =>
  run<Removed>(workspace, "metamodel.removeRelationKind", { kind });

const ABOUT = "  - key: about\n    name: About\n    target-types: [hazard]\n";

/** The short ID of the element of the test helper with the number `n` and the prefix `prefix`. */
const shortId = (prefix: string, n: number): string => `${prefix}-${uuid(n).replaceAll("-", "").slice(-6)}`;

describe("metamodel.removeRelationKind removes an unused relation kind (SR-239 AK3)", () => {
  it("[SR-239/AK-qrb0] removes a relation kind no element file holds, and refuses one that an element file holds", async () => {
    const files = elements([1, "hazard"], [2, "note", { about: `[{ id: ${uuid(1)} }]` }]);
    const used = await openSmall(files);
    const refused = await failure(used.workspace, "metamodel.removeRelationKind", { kind: "about" });
    expect([refused.code, refused.details]).toEqual([
      "input.invalid",
      {
        reason: "in-use",
        uses: [{ kind: "relation", key: "about", count: 1, elements: [shortId("NO", 2)] }],
      },
    ]);
    expect(refused.message).toBe(
      `Relation kind about cannot be removed: relation about: 1 element (${shortId("NO", 2)})`,
    );
    expect(await used.read(MODEL)).toBe(SMALL_MODEL);

    const { workspace, read } = await openSmall(elements([1, "hazard"], [2, "note"]));
    expect(await remove(workspace, "about")).toEqual({
      answer: "Removed the relation kind about; 1 file written.",
      relationKind: "about",
      mentions: [],
      files: [MODEL],
      versionsChanged: 0,
      missingRequired: 0,
      versionsChangedElements: [],
      missingRequiredElements: [],
      problems: [],
    });
    // The list stays, empty; every other line is as it was.
    expect(await read(MODEL)).toBe(SMALL_MODEL.replace(`relations:\n${ABOUT}`, "relations: []\n"));
    const meta = await run<CommandOutput<"metamodel.get">>(workspace, "metamodel.get", {});
    expect(meta.relations).toEqual([]);
  });

  it("refuses an unknown relation kind, also a key every object has", async () => {
    const { workspace } = await openSmall(elements([1, "note", { constructor: "x" }]));
    for (const kind of ["nope", "constructor"]) {
      const unknown = await failure(workspace, "metamodel.removeRelationKind", { kind });
      expect([unknown.code, unknown.details]).toEqual([
        "input.invalid",
        { reason: "unknown", relationKind: kind },
      ]);
    }
  });
});

describe("metamodel commands: the frame as metamodel.removeRelationKind shows it (SR-236)", () => {
  it("[SR-236/AK-bm7r] counts every element file that holds the key, in any status and with an empty list, and names the first 20 by short ID", async () => {
    const list = Array.from(
      { length: 21 },
      (_, i) =>
        [i + 1, i % 2 === 0 ? "note" : "risk", { status: i === 0 ? "noted" : "draft", about: "[]" }] as const,
    );
    // An element of a type without the relation kind counts too: its file holds the key.
    const { workspace, read } = await openSmall(elements(...list, [22, "hazard"]));
    const used = await failure(workspace, "metamodel.removeRelationKind", { kind: "about" });
    const shown = list
      .map(([n, type]) => shortId(type === "note" ? "NO" : "RI", n))
      .sort()
      .slice(0, 20);
    expect(used.details).toEqual({
      reason: "in-use",
      uses: [{ kind: "relation", key: "about", count: 21, elements: shown }],
    });
    expect(used.message).toContain("relation about: 21 elements (");
    expect(used.message).toContain(", …)");
    expect(await read(MODEL)).toBe(SMALL_MODEL);
  });

  it("[SR-236/AK-bm7r] refuses while a repository of the workspace is not on this machine and names it", async () => {
    const { workspace, read } = await openSmall({ [WORKSPACE_FILE]: WITH_MISSING_REPOSITORY });
    const missing = await failure(workspace, "metamodel.removeRelationKind", { kind: "about" });
    expect([missing.code, missing.details]).toEqual([
      "file.folder-missing",
      { command: "metamodel.removeRelationKind", repository: "product", repositories: ["product"] },
    ]);
    expect(await read(MODEL)).toBe(SMALL_MODEL);
  });

  it("[SR-236/AK-bm7r] refuses while an element file cannot be read, as it may hold the key, and names the file (SR-008 AK3)", async () => {
    // Unclosed quote: the frontmatter does not parse, and the file still holds `about`.
    const broken = `---\nid: ${uuid(9)}\ntype: note\ntitle: "Unclosed\nabout: []\n---\n`;
    const { workspace, read } = await openSmall({
      ...elements([1, "hazard"]),
      "elements/E-000000000009.md": broken,
    });
    const refused = await failure(workspace, "metamodel.removeRelationKind", { kind: "about" });
    expect([refused.code, refused.details]).toEqual([
      "file.faulty",
      {
        command: "metamodel.removeRelationKind",
        count: 1,
        files: [{ repository: "system", file: "elements/E-000000000009.md" }],
      },
    ]);
    expect(refused.message).toContain("elements/E-000000000009.md");
    expect([await read(MODEL), await read("elements/E-000000000009.md")]).toEqual([SMALL_MODEL, broken]);
  });

  it("[SR-236/AK-bm7r] names the saved filters, perspectives and mapping files that name the removed key and does not change them", async () => {
    const perspective = "reqseq-perspective: 1\nname: Topics\ncolumns: [title, about]\n";
    const files = {
      "perspectives/topics.yaml": perspective,
      "filters/plain.yaml": "reqseq-filter: 1\nname: about\ndescription: about\nwhere: { type: [note] }\n",
    };
    const { workspace, read } = await openSmall(files);
    const removed = await remove(workspace, "about");
    expect(removed.mentions).toEqual(["perspectives/topics.yaml"]);
    expect(removed.answer).toBe(
      "Removed the relation kind about; 1 file written; 1 file naming the removed key, not changed.",
    );
    expect(await read("perspectives/topics.yaml")).toBe(perspective);
  });

  it("[SR-236/AK-k2s3] removes the lines of the relation kind and the comment lines directly above it, every other line stays", async () => {
    const model = SMALL_MODEL.replace(
      `relations:\n${ABOUT}`,
      `relations:\n  # Kept: above another one.\n  - key: causes # first\n    name: Causes\n\n  # About a hazard.\n${ABOUT}`,
    );
    const { workspace, read } = await openSmall({}, model);
    expect((await remove(workspace, "about")).files).toEqual([MODEL]);
    expect(await read(MODEL)).toBe(model.replace(`  # About a hazard.\n${ABOUT}`, ""));
  });

  it("[SR-236/AK-yf6d] changes the file the relation kind is in, and no other", async () => {
    const relations =
      "reqseq-metamodel: 1\nrelations: [{ key: about, name: About }, { key: causes, name: Causes }]\n";
    const { workspace, read } = await openOwn({ "models/model/z-relations.yaml": relations });
    const types = await read("models/model/types.yaml");
    expect((await remove(workspace, "about")).files).toEqual(["../models/model/z-relations.yaml"]);
    expect(await read("models/model/z-relations.yaml")).toBe(
      "reqseq-metamodel: 1\nrelations: [{ key: causes, name: Causes }]\n",
    );
    expect(await read("models/model/types.yaml")).toBe(types);
  });

  it("[SR-236/AK-cv7t] refuses a relation kind with a YAML anchor or alias in it and names file and line", async () => {
    const model = SMALL_MODEL.replace("    name: About\n", "    name: *n\n").replace(
      "    name: Hazard\n",
      "    name: &n Hazard\n",
    );
    const { workspace, read } = await openSmall({}, model);
    const refused = await failure(workspace, "metamodel.removeRelationKind", { kind: "about" });
    expect([refused.code, refused.details]).toEqual([
      "file.faulty",
      { file: MODEL, line: 34, repository: "system" },
    ]);
    expect(await read(MODEL)).toBe(model);
  });

  it("[SR-236/AK-sx7z] writes a removal that leaves the metamodel with warnings and names them", async () => {
    // Required by notes: once the relation kind is gone, the key names no definition, a warning.
    const model = SMALL_MODEL.replace(
      "    required: [title]\n    statuses: [draft, noted]\n",
      "    required: [title, about]\n    statuses: [draft, noted]\n",
    );
    const { workspace } = await openSmall({}, model);
    const removed = await remove(workspace, "about");
    expect(removed.problems.map((p) => [p.code, p.severity, p.file])).toEqual([
      ["metamodel.invalid", "warning", MODEL],
    ]);
    expect(removed.problems[0]?.message).toContain("about");
    expect(removed.answer).toBe("Removed the relation kind about; 1 file written; 1 problem.");
  });
});

describe("the answer of metamodel.removeRelationKind", () => {
  it("names the counts and the problems", () => {
    const output = {
      relationKind: "about",
      mentions: [],
      files: [MODEL],
      versionsChanged: 3,
      missingRequired: 0,
      problems: [{}],
    };
    expect(removeRelationKind.answer(output as never, { kind: "about" }, { type: (key) => key })).toBe(
      "Removed the relation kind about; 1 file written; 3 elements with another version; 1 problem.",
    );
  });
});

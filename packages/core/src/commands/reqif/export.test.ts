// reqif.export (SR-052) on fixtures/SR-052/package: a package with requirements, a need and a
// decision, relations among them, one to a requirement outside the package and one to a missing
// element; the round trip into fixtures/SR-052/empty, a workspace with the same metamodel.
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { REQIF_XSD_PINS, createFixtureWorkspace, reqifXsdDir, validateReqif } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { metamodelState } from "../../metamodel/index.js";
import { ownMapping } from "../../reqif/index.js";
import type { ReqifFile } from "../../reqif/model.js";
import { parseReqif } from "../../reqif/parse.js";
import { writeReqif } from "../../reqif/write.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Exported = CommandOutput<"reqif.export">;
type Listed = CommandOutput<"element.list">;
type Got = CommandOutput<"element.get">;

const PACKAGE = "52052052-0000-4000-8000-0000000052f1";
const NEED = "52052052-0000-4000-8000-0000000052d1";
const DECISION = "52052052-0000-4000-8000-0000000052e1";
const WIND = "52052052-0000-4000-8000-0000000052a1";
const HISTORY = "52052052-0000-4000-8000-0000000052a2";
const TEMPERATURE = "52052052-0000-4000-8000-0000000052a3";
const GONE = "52052052-0000-4000-8000-0000000052ff";
const ORIGIN = ["source", "source-identifier", "import-date", "delivery", "import-version"];
const GUSTS = "52052052-0000-4000-8000-0000000052b1";
const BARE = "52052052-0000-4000-8000-0000000052b2";
const ODD = "52052052-0000-4000-8000-0000000052b3";

/** A type `measure` with a property of each kind, beside the standard model. */
const EXTRA_MODEL: Readonly<Record<string, string>> = {
  "metamodel/extra.yaml": [
    "reqseq-metamodel: 1",
    "types:",
    "  - { key: measure, name: Measure, prefix: MS, properties: [title, weight, due, notes, tags, mood, owner, packages, source, source-identifier, import-date, delivery, import-version], required: [title] }",
    "properties:",
    "  - { key: weight, name: Weight, kind: number }",
    "  - { key: due, name: Due, kind: date }",
    "  - { key: notes, name: Notes, kind: text, many: true }",
    "  - { key: tags, name: Tags, kind: choice, many: true, choices: [{ key: red, name: Red }, { key: blue, name: Blue }] }",
    "  - { key: mood, name: Mood, kind: choice }",
    "  - { key: owner, name: Owner, kind: relation }",
    "",
  ].join("\n"),
};

/** EXTRA_MODEL with a measure of each kind of value, one without any, and an element of an unknown type. */
const EXTRA: Readonly<Record<string, string>> = {
  ...EXTRA_MODEL,
  "measures/MS-0000000052b1.md": [
    "---",
    `id: ${GUSTS}`,
    "type: measure",
    "status: draft",
    "title: Gusts",
    "weight: 2.5",
    "due: 2026-11-01",
    'notes: [first, "", { a: 1 }]',
    "tags: [red, green, 5]",
    "mood: calm",
    "owner: { id: 52052052-0000-4000-8000-0000000052a1 }",
    "packages: [{ id: 52052052-0000-4000-8000-0000000052fe }, loose]",
    "refines: [text, { id: not-a-uuid }, { id: 52052052-0000-4000-8000-0000000052a1 }, { id: 52052052-0000-4000-8000-0000000052a1 }]",
    "---",
    "",
    "Gusts over 3 s.",
    "",
  ].join("\n"),
  "measures/MS-0000000052b2.md": [
    "---",
    `id: ${BARE}`,
    "type: measure",
    "status: weird",
    "weight: .inf",
    "due: soon",
    "notes: []",
    "tags: []",
    "---",
    "",
  ].join("\n"),
  "measures/GA-0000000052b3.md": [
    "---",
    `id: ${ODD}`,
    "type: gadget",
    "status: draft",
    "title: Odd",
    "---",
    "",
  ].join("\n"),
};

const open = async (
  fixture = "SR-052/package",
  files: Readonly<Record<string, string>> = {},
): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> => {
  const made = await createFixtureWorkspace({ fixture, files });
  onTestFinished(() => made.cleanup());
  const workspace = new Workspace(made.root);
  onTestFinished(() => workspace.close());
  return { fixture: made, workspace };
};

const run = async <T>(workspace: Workspace, command: string, input: Record<string, unknown>): Promise<T> =>
  (await invoke(command, input, { workspace })) as T;

const failure = async (workspace: Workspace, input: Record<string, unknown>): Promise<CommandError> => {
  try {
    await run(workspace, "reqif.export", input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("reqif.export did not fail");
};

const failure2 = async (workspace: Workspace, input: Record<string, unknown>): Promise<CommandError> => {
  try {
    await run(workspace, "reqif.import", input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("reqif.import did not fail");
};

/** `file` written again, as text. */
const rewritten = (file: ReqifFile): string => {
  const written = writeReqif(file);
  if (written.kind !== "written") {
    throw new Error(JSON.stringify(written.problems));
  }
  return written.chunks.join("");
};

/** The exported file at `file` of `fixture`, parsed. */
const parsed = async (fixture: FixtureWorkspace, file: string): Promise<ReqifFile> => {
  const outcome = parseReqif(await fs.readFile(fixture.path(file)));
  if (outcome.kind !== "parsed") {
    throw new Error(outcome.message);
  }
  return outcome.file;
};

describe("reqif.export (SR-052)", () => {
  it("[SR-052/AK1] writes a file valid against the ReqIF 1.2 schema with every element of the selection, needs and decisions too, in one flat SPECIFICATION in the order of the list", async (context) => {
    const { fixture, workspace } = await open();
    const inPackage = { package: PACKAGE };
    const out = await run<Exported>(workspace, "reqif.export", { output: "s6.reqif", selection: inPackage });
    expect(out).toEqual({ file: "s6.reqif", elements: 2, relations: 5, files: [], problems: [] });
    const listed = await run<Listed>(workspace, "element.list", { selection: inPackage });
    const file = await parsed(fixture, "s6.reqif");
    const [specification, ...others] = file.specifications;
    expect(others).toEqual([]);
    expect(specification?.children.map((c) => [c.object, c.children.length])).toEqual(
      listed.elements.map((e) => [`_${e.id}`, 0]),
    );
    // Needs and decisions are exported like requirements; their order is the list's too.
    const ids = { ids: [DECISION, WIND, NEED] };
    const all = await run<Exported>(workspace, "reqif.export", { output: "mixed.reqif", selection: ids });
    expect(all.elements).toBe(3);
    const mixed = await parsed(fixture, "mixed.reqif");
    const order = (await run<Listed>(workspace, "element.list", { selection: ids })).elements.map(
      (e) => `_${e.id}`,
    );
    expect(mixed.specifications[0]?.children.map((c) => c.object)).toEqual(order);
    expect(mixed.specObjects.slice(0, 3).map((o) => [o.identifier, o.type])).toEqual(
      order.map((id) => [
        id,
        id === `_${NEED}` ? "_ot-need" : id === `_${DECISION}` ? "_ot-decision" : "_ot-system-requirement",
      ]),
    );
    const dir = reqifXsdDir(context, process.env);
    const pins = await fs.readFile(REQIF_XSD_PINS, "utf8");
    for (const name of ["s6.reqif", "mixed.reqif"]) {
      expect(await validateReqif(await fs.readFile(fixture.path(name), "utf8"), dir, pins), name).toEqual({
        valid: true,
        errors: [],
      });
    }
  });

  it("[SR-052/AK2] gives every requirement the IDENTIFIER _ plus its UUID and writes every relation as a SPEC-RELATION, a target outside the export as a stub", async () => {
    const { fixture, workspace } = await open();
    await run<Exported>(workspace, "reqif.export", { output: "s6.reqif", selection: { package: PACKAGE } });
    const file = await parsed(fixture, "s6.reqif");
    expect(file.specObjects.map((o) => [o.identifier, o.type, o.values.length > 0])).toEqual([
      [`_${WIND}`, "_ot-system-requirement", true],
      [`_${HISTORY}`, "_ot-system-requirement", true],
      // Stubs: IDENTIFIER and type only, in the order first named.
      [`_${NEED}`, "_ot-need", false],
      [`_${DECISION}`, "_ot-decision", false],
      [`_${TEMPERATURE}`, "_ot-system-requirement", false],
      [`_${GONE}`, "_ot.missing", false],
    ]);
    expect(file.specRelations.map((r) => [r.type, r.source, r.target])).toEqual([
      ["_rt-derives-from", `_${WIND}`, `_${NEED}`],
      ["_rt-based-on", `_${WIND}`, `_${DECISION}`],
      ["_rt-refines", `_${HISTORY}`, `_${WIND}`],
      ["_rt-refines", `_${HISTORY}`, `_${TEMPERATURE}`],
      ["_rt-derives-from", `_${HISTORY}`, `_${GONE}`],
    ]);
    expect(new Set(file.specRelations.map((r) => r.identifier)).size).toBe(5);
    expect(file.specRelations.every((r) => /^_sr-[0-9a-f]{32}$/.test(r.identifier))).toBe(true);
    // The package a requirement is in is a readable value (short IDs), not a SPEC-RELATION.
    const wind = file.specObjects[0];
    expect(wind?.values.find((v) => v.definition === "_ad-system-requirement.packages")).toEqual({
      kind: "string",
      definition: "_ad-system-requirement.packages",
      value: "PKG-0052f1",
    });
  });

  it("[SR-052/AK3] a file of ReqSeq imported into an empty workspace without a mapping gives the same titles, texts, properties, relations and versions, with no relation outdated, and saves its one-to-one mapping", async () => {
    const original = await open();
    await run<Exported>(original.workspace, "reqif.export", { output: "all.reqif" });
    const all = await fs.readFile(original.fixture.path("all.reqif"), "utf8");
    const { fixture, workspace } = await open("SR-052/empty", { "in/all.reqif": all });
    const imported = await run<CommandOutput<"reqif.import">>(workspace, "reqif.import", {
      file: "in/all.reqif",
      delivery: "round trip",
    });
    expect(imported.problems).toEqual([]);
    // The stub of the missing target is no element and no loss; the flat SPECIFICATION is.
    expect(imported.losses.map((l) => l.code)).toEqual(["hierarchy"]);
    expect(imported.files).toContain("reqif/weather-station.yaml");
    const newId = new Map(imported.created.map((c) => [c.identifier.slice(1), c.id ?? ""]));
    const oldId = new Map([...newId].map(([old, now]) => [now, old]));
    const back = (id: string): string => oldId.get(id) ?? id;
    const comparable = (element: Got["element"], ids: (id: string) => string): unknown => ({
      type: element.type,
      title: element.title,
      text: element.text,
      version: element.version,
      properties: Object.fromEntries(
        Object.entries(element.properties)
          .filter(([key]) => !ORIGIN.includes(key))
          .map(([key, value]) => [
            key,
            Array.isArray(value)
              ? value.map((item: unknown) =>
                  typeof item === "object" && item !== null && "id" in item
                    ? { ...item, id: ids((item as { id: string }).id) }
                    : item,
                )
              : value,
          ]),
      ),
      relations: element.relations
        .filter((r) => r.direction === "out")
        .map((r) => ({ kind: r.kind, id: ids(r.id), title: r.title, storedVersion: r.storedVersion })),
    });
    for (const id of [PACKAGE, NEED, DECISION, WIND, HISTORY, TEMPERATURE]) {
      const before = (await run<Got>(original.workspace, "element.get", { ref: id })).element;
      const after = (await run<Got>(workspace, "element.get", { ref: newId.get(id) })).element;
      expect(comparable(after, back), id).toEqual(comparable(before, (x) => x));
      expect(after.properties["source-identifier"]).toBe(`_${id}`);
    }
    const check = await run<CommandOutput<"workspace.check">>(workspace, "workspace.check", {});
    expect(check.problems.filter((p) => p.code === "relation.outdated")).toEqual([]);
    // The saved mapping is used next time, and no other is written.
    const again = await run<CommandOutput<"reqif.import">>(workspace, "reqif.import", {
      file: "in/all.reqif",
      delivery: "again",
    });
    expect(again.files).not.toContain("reqif/weather-station.yaml");
    expect(again.problems).toEqual([]);
    expect(await fs.readFile(fixture.path("reqif/weather-station.yaml"), "utf8")).toContain(
      "tool-id: reqseq",
    );
  });

  it("replaces an earlier export, never a file that is no XML, and refuses what it cannot write yet or at all", async () => {
    const { fixture, workspace } = await open("SR-052/package", { "notes.txt": "not XML\n" });
    await run<Exported>(workspace, "reqif.export", { output: "s6.reqif", selection: { ids: [WIND] } });
    const again = await run<Exported>(workspace, "reqif.export", {
      output: "s6.reqif",
      selection: { ids: [HISTORY] },
    });
    expect(again.elements).toBe(1);
    expect((await parsed(fixture, "s6.reqif")).specObjects[0]?.identifier).toBe(`_${HISTORY}`);
    expect((await failure(workspace, { output: "notes.txt" })).code).toBe("file.faulty");
    expect(await fs.readFile(fixture.path("notes.txt"), "utf8")).toBe("not XML\n");
    expect((await failure(workspace, { output: "requirements" })).code).toBe("file.faulty");
    const later = await failure(workspace, {
      output: "x.reqif",
      profile: "p",
      mapping: "reqif/m.yaml",
      omitProperties: ["topic"],
      statements: true,
    });
    expect([later.code, later.details?.["fields"]]).toEqual([
      "input.invalid",
      ["profile", "mapping", "omitProperties", "statements"],
    ]);
    expect((await failure(workspace, { output: "x.reqif", profile: "p" })).message).toBe(
      "profile: not available yet in this version; export a selection without it",
    );
    expect(
      (
        await run<Exported>(workspace, "reqif.export", {
          output: "y.reqif",
          omitProperties: [],
          statements: false,
        })
      ).elements,
    ).toBe(6);
    // Outside the workspace the output is named by its absolute path.
    const outside = path.join(os.tmpdir(), `reqseq-export-${randomUUID()}.reqif`);
    onTestFinished(() => fs.rm(outside, { force: true }));
    expect(
      (await run<Exported>(workspace, "reqif.export", { output: outside, selection: { ids: [WIND] } })).file,
    ).toBe(outside);
  });

  it("refuses a character XML 1.0 cannot carry and a file changed since it was read, and writes nothing", async () => {
    const { fixture, workspace } = await open("SR-052/package", {
      "requirements/SR-0000000052b1.md":
        '---\nid: 52052052-0000-4000-8000-0000000052b1\ntype: system-requirement\nstatus: draft\ntitle: "Bell \\a"\n---\n',
    });
    const refused = await failure(workspace, { output: "bell.reqif" });
    expect(refused.code).toBe("reqif.invalid");
    expect(refused.message).toContain("holds U+0007 at 5");
    await expect(fs.stat(fixture.path("bell.reqif"))).rejects.toThrow();
    const many = await open("SR-052/package", {
      ...Object.fromEntries(
        Array.from({ length: 6 }, (_, i) => [
          `requirements/SR-00000000520${String(i)}.md`,
          `---\nid: 52052052-0000-4000-8000-00000000520${String(i)}\ntype: system-requirement\nstatus: draft\ntitle: "Bell \\a"\n---\n`,
        ]),
      ),
    });
    expect((await failure(many.workspace, { output: "bell.reqif" })).message).toMatch(/; and \d+ more$/);
    // A write after the store read the file: its text would not be the element's.
    await run<Listed>(workspace, "element.list", {});
    await fs.appendFile(fixture.path("requirements/SR-0000000052a3.md"), "More.\n");
    const changed = await failure(workspace, { output: "changed.reqif", selection: { ids: [TEMPERATURE] } });
    expect(changed.code).toBe("file.changed-on-disk");
  });

  it("writes each kind of value it can carry, keeps the others in reqseq-values only, and brings them back", async () => {
    const original = await open("SR-052/package", EXTRA);
    const out = await run<Exported>(original.workspace, "reqif.export", {
      output: "extra.reqif",
      selection: { ids: [GUSTS, BARE, ODD] },
    });
    // Two items name no element (text, no UUID) and one names WIND twice: one SPEC-RELATION.
    expect(out.relations).toBe(1);
    const file = await parsed(original.fixture, "extra.reqif");
    const values = (id: string): Record<string, unknown> =>
      Object.fromEntries(
        (file.specObjects.find((o) => o.identifier === `_${id}`)?.values ?? [])
          .filter((v) => !v.definition.startsWith("_rq-"))
          .map((v) => [
            v.definition.replace(/^_ad-[a-z]+\./, ""),
            v.kind === "enumeration" ? v.values : v.value,
          ]),
      );
    expect(values(GUSTS)).toEqual({
      title: "Gusts",
      text: expect.anything() as unknown,
      weight: "2.5",
      due: "2026-11-01T00:00:00Z",
      notes: [
        {
          name: "div",
          namespace: "http://www.w3.org/1999/xhtml",
          attributes: [],
          children: [
            {
              name: "ul",
              namespace: "http://www.w3.org/1999/xhtml",
              attributes: [],
              children: [
                {
                  name: "li",
                  namespace: "http://www.w3.org/1999/xhtml",
                  attributes: [],
                  children: ["first"],
                },
                { name: "li", namespace: "http://www.w3.org/1999/xhtml", attributes: [], children: [] },
              ],
            },
          ],
        },
      ],
      tags: ["_ev-tags.red"],
      owner: "SR-0052a1",
      // A target that is missing is named by its UUID.
      packages: "52052052-0000-4000-8000-0000000052fe",
      status: ["_ev-status.draft"],
    });
    // No title, an unknown status and values no attribute can carry: none of them is readable.
    expect(values(BARE)).toEqual({});
    expect(file.specObjects.find((o) => o.identifier === `_${BARE}`)?.longName).toBeUndefined();
    // A type the metamodel does not know: title, text and status only, after the known types.
    expect(file.specTypes.map((t) => t.identifier)).toEqual([
      "_ot-measure",
      "_ot-gadget",
      "_ot-system-requirement",
      "_rt-refines",
      "_st-specification",
    ]);
    expect(file.specTypes[1]?.attributes.map((a) => a.identifier)).toEqual([
      "_ad-gadget.title",
      "_ad-gadget.text",
      "_ad-gadget.status",
      "_rq-gadget.markdown",
      "_rq-gadget.values",
    ]);
    const all = await fs.readFile(original.fixture.path("extra.reqif"), "utf8");
    const { workspace } = await open("SR-052/empty", { ...EXTRA_MODEL, "in/extra.reqif": all });
    const imported = await run<CommandOutput<"reqif.import">>(workspace, "reqif.import", {
      file: "in/extra.reqif",
      delivery: "round trip",
    });
    expect(imported.problems).toEqual([]);
    const newId = new Map(imported.created.map((c) => [c.identifier.slice(1), c.id ?? ""]));
    const got = async (id: string): Promise<Got["element"]> =>
      (await run<Got>(workspace, "element.get", { ref: newId.get(id) })).element;
    const gusts = await got(GUSTS);
    expect(gusts.properties).toMatchObject({
      weight: 2.5,
      notes: ["first", "", { a: 1 }],
      tags: ["red", "green", 5],
      owner: { id: WIND },
      packages: [{ id: "52052052-0000-4000-8000-0000000052fe" }, "loose"],
    });
    const bare = await got(BARE);
    // JSON has no infinity, a number the value check refuses (SR-085): it comes back as no value.
    expect([bare.title, bare.properties["weight"], bare.properties["due"]]).toEqual(["", undefined, "soon"]);
    expect(newId.has(ODD)).toBe(false);
  });

  it("maps a file of ReqSeq one to one, omitting what this metamodel does not know", async () => {
    const { fixture, workspace } = await open("SR-052/package", EXTRA);
    await run<Exported>(workspace, "reqif.export", { output: "m.reqif", selection: { ids: [GUSTS, ODD] } });
    const file = await parsed(fixture, "m.reqif");
    const changed: ReqifFile = {
      ...file,
      datatypes: file.datatypes.map((d) =>
        d.identifier === "_dt-enum.tags"
          ? {
              ...d,
              values: [
                ...d.values,
                ...d.values.slice(0, 1).map((v) => ({ ...v, identifier: "_ev-tags.green" })),
                ...d.values.slice(0, 1).map((v) => ({ ...v, identifier: "_other" })),
              ],
            }
          : d,
      ),
      specTypes: [
        ...file.specTypes.map((t) => ({
          ...t,
          attributes: t.attributes.map((a) =>
            a.identifier === "_ad-measure.due" ? { ...a, datatype: "_dt-gone" } : a,
          ),
        })),
        ...file.specTypes
          .slice(0, 1)
          .map((t) => ({ ...t, identifier: "_rt-blocks", category: "spec-relation" as const })),
      ],
    };
    const mapping = ownMapping(
      changed,
      await workspace.get(metamodelState),
      "Weather station",
      new Set(["title", ...ORIGIN]),
    );
    expect(mapping.types).toEqual([
      { source: "_ot-measure", type: "measure" },
      { source: "_ot-gadget", omit: true },
      { source: "_ot-system-requirement", type: "system-requirement" },
    ]);
    expect(mapping.attributes?.filter((a) => a.source.startsWith("_ad-measure."))).toEqual([
      { source: "_ad-measure.title", property: "title" },
      { source: "_ad-measure.text", property: "text" },
      { source: "_ad-measure.weight", property: "weight" },
      { source: "_ad-measure.due", property: "due" },
      { source: "_ad-measure.notes", property: "notes" },
      {
        source: "_ad-measure.tags",
        property: "tags",
        values: { "_ev-tags.red": "red", "_ev-tags.blue": "blue" },
        "omit-values": ["_ev-tags.green", "_other"],
      },
      { source: "_ad-measure.mood", property: "mood", values: {} },
      { source: "_ad-measure.owner", omit: true },
      { source: "_ad-measure.packages", omit: true },
      // The origin is the import's to write (SR-057).
      ...ORIGIN.map((key) => ({ source: `_ad-measure.${key}`, omit: true })),
      { source: "_ad-measure.status", omit: true },
    ]);
    expect(mapping.attributes?.filter((a) => a.source.startsWith("_rq-measure."))).toEqual([
      { source: "_rq-measure.markdown", omit: true },
      { source: "_rq-measure.values", omit: true },
    ]);
    expect(mapping.relations).toEqual([
      { source: "_rt-refines", kind: "refines" },
      { source: "_rt-blocks", omit: true },
    ]);
  });

  it("imports a file of ReqSeq another tool changed by its readable values, and refuses one without a source", async () => {
    const original = await open();
    await run<Exported>(original.workspace, "reqif.export", {
      output: "all.reqif",
      selection: { ids: [WIND, TEMPERATURE, NEED] },
    });
    const file = await parsed(original.fixture, "all.reqif");
    const edited = rewritten({
      ...file,
      specObjects: file.specObjects.map((o) => {
        const valuesId = "_rq-system-requirement.values";
        if (o.identifier === `_${TEMPERATURE}`) {
          // Its title changed in another tool.
          return {
            ...o,
            values: o.values.map((v) =>
              v.definition === "_ad-system-requirement.title" && v.kind === "string"
                ? { ...v, value: "Measure heat" }
                : v,
            ),
          };
        }
        if (o.identifier === `_${WIND}`) {
          // Its round-trip values are no JSON object.
          return {
            ...o,
            values: o.values.map((v) =>
              v.definition === valuesId && v.kind === "string" ? { ...v, value: "[1]" } : v,
            ),
          };
        }
        if (o.identifier === `_${NEED}`) {
          // Both round-trip attributes are gone.
          return { ...o, values: o.values.filter((v) => !v.definition.startsWith("_rq-")) };
        }
        return o;
      }),
    });
    const { workspace } = await open("SR-052/empty", { "in/edited.reqif": edited });
    const imported = await run<CommandOutput<"reqif.import">>(workspace, "reqif.import", {
      file: "in/edited.reqif",
      delivery: "edited",
    });
    expect((imported.problems ?? []).map((p) => [p.code, p.message.split(":")[0]])).toEqual([
      ["reqif.edited-elsewhere", `_${NEED}`],
      ["reqif.edited-elsewhere", `_${WIND}`],
      ["reqif.edited-elsewhere", `_${TEMPERATURE}`],
    ]);
    const titles = await run<Listed>(workspace, "element.list", {});
    expect(titles.elements.map((e) => e.title).sort()).toEqual([
      "Know the weather",
      "Measure heat",
      "Show wind speed & gusts <live>",
    ]);
    // Without a TITLE the source is the caller's to name.
    const untitled = (await fs.readFile(original.fixture.path("all.reqif"), "utf8")).replace(
      "<TITLE>Weather station</TITLE>",
      "",
    );
    expect(untitled).not.toContain("<TITLE>");
    const other = await open("SR-052/empty", { "in/untitled.reqif": untitled });
    const refused = await failure2(other.workspace, { file: "in/untitled.reqif", delivery: "x" });
    expect([refused.code, refused.details?.["fields"]]).toEqual(["input.invalid", ["source"]]);
    const named = await run<CommandOutput<"reqif.import">>(other.workspace, "reqif.import", {
      file: "in/untitled.reqif",
      delivery: "x",
      source: "Station",
    });
    expect(named.files).toContain("reqif/station.yaml");
  });

  it("uses a saved mapping of another source as it is, with a warning, and saves the mapping of an empty export alone", async () => {
    const original = await open();
    await run<Exported>(original.workspace, "reqif.export", {
      output: "one.reqif",
      selection: { ids: [NEED] },
    });
    // Nothing selected: a file without SPEC-OBJECTs.
    await run<Exported>(original.workspace, "reqif.export", { output: "none.reqif", selection: { ids: [] } });
    const one = await fs.readFile(original.fixture.path("one.reqif"), "utf8");
    const none = await fs.readFile(original.fixture.path("none.reqif"), "utf8");
    const settings = await fs.readFile(original.fixture.path("reqseq-workspace.yaml"), "utf8");
    // The mapping folder is the repository root, beside the element folders.
    const { fixture, workspace } = await open("SR-052/empty", {
      "reqseq-workspace.yaml": `${settings}mappings: { repository: system, path: . }\n`,
      "in/one.reqif": one,
    });
    const first = await run<CommandOutput<"reqif.import">>(workspace, "reqif.import", {
      file: "in/one.reqif",
      delivery: "one",
    });
    expect(first.files).toContain("weather-station.yaml");
    const saved = await fs.readFile(fixture.path("weather-station.yaml"), "utf8");
    await fs.writeFile(
      fixture.path("weather-station.yaml"),
      saved.replace("name: Weather station", "name: Kiosk"),
    );
    const renamed = await run<CommandOutput<"reqif.import">>(workspace, "reqif.import", {
      file: "in/one.reqif",
      delivery: "two",
    });
    expect((renamed.problems ?? []).map((p) => [p.code, p.message])).toEqual([
      [
        "reqif.mapping-differs",
        "weather-station.yaml maps source Kiosk (reqseq), not Weather station (reqseq); it is used as it is",
      ],
    ]);
    await fs.writeFile(fixture.path("weather-station.yaml"), saved.replace(/\n *tool-id: reqseq/, ""));
    const anonymous = await run<CommandOutput<"reqif.import">>(workspace, "reqif.import", {
      file: "in/one.reqif",
      delivery: "three",
    });
    expect((anonymous.problems ?? []).map((p) => p.message)).toEqual([
      "weather-station.yaml maps source Weather station, not Weather station (reqseq); it is used as it is",
    ]);
    const other = await open("SR-052/empty", { "in/none.reqif": none });
    const empty = await run<CommandOutput<"reqif.import">>(other.workspace, "reqif.import", {
      file: "in/none.reqif",
      delivery: "none",
    });
    expect([empty.created, empty.files]).toEqual([[], ["reqif/weather-station.yaml"]]);
  });
});

// reqif.import of a file of ReqSeq (SR-052 AK3, ADR-0013 "Import"): what fixtures/SR-052/package
// exports, imported into fixtures/SR-052/empty: the saved mapping grows with later files, a given or
// edited mapping is never bypassed, an object another tool changed keeps its relations, relations the
// metamodel does not allow are losses, the images of the text are copied, and a refused import writes
// no mapping folder.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { parse, stringify } from "yaml";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import type { ReqifFile, ReqifSpecObject } from "../../reqif/model.js";
import { parseReqif } from "../../reqif/parse.js";
import { writeReqif } from "../../reqif/write.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Imported = CommandOutput<"reqif.import">;
type Got = CommandOutput<"element.get">;

const PACKAGE = "52052052-0000-4000-8000-0000000052f1";
const NEED = "52052052-0000-4000-8000-0000000052d1";
const DECISION = "52052052-0000-4000-8000-0000000052e1";
const VARIANT = "52052052-0000-4000-8000-0000000052c1";
const WIND = "52052052-0000-4000-8000-0000000052a1";
const HISTORY = "52052052-0000-4000-8000-0000000052a2";
const TEMPERATURE = "52052052-0000-4000-8000-0000000052a3";
const GONE = "52052052-0000-4000-8000-0000000052ff";
const ODD = "52052052-0000-4000-8000-0000000052b4";
const PICTURES = "52052052-0000-4000-8000-0000000052b5";
const GUSTS = "52052052-0000-4000-8000-0000000052b1";
const MAPPING = "reqif/weather-station.yaml";

/** A type `measure` with a property Owner that has one target, in both workspaces. */
const OWNER_MODEL = {
  "metamodel/extra.yaml": [
    "reqseq-metamodel: 1",
    "types:",
    "  - { key: measure, name: Measure, prefix: MS, properties: [title, owner, source, source-identifier, import-date, delivery, import-version], required: [title] }",
    "properties:",
    "  - { key: owner, name: Owner, kind: relation }",
    "",
  ].join("\n"),
};

const open = async (
  fixture: string,
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

const refusal = async (workspace: Workspace, input: Record<string, unknown>): Promise<CommandError> => {
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

/** What SR-052/package (with `files`) exports of `ids` (all without), parsed, and its image folder. */
const exported = async (
  ids: readonly string[] | undefined,
  files: Readonly<Record<string, string>> = {},
): Promise<{ readonly file: ReqifFile; readonly text: string; readonly images: string }> => {
  const { fixture, workspace } = await open("SR-052/package", files);
  await run(workspace, "reqif.export", {
    output: "x.reqif",
    ...(ids === undefined ? {} : { selection: { ids } }),
  });
  const text = await fs.readFile(fixture.path("x.reqif"), "utf8");
  const outcome = parseReqif(new TextEncoder().encode(text));
  if (outcome.kind !== "parsed") {
    throw new Error(outcome.message);
  }
  return { file: outcome.file, text, images: fixture.path("x-images") };
};

/** `file` written again, as text. */
const rewritten = (file: ReqifFile): string => {
  const written = writeReqif(file);
  if (written.kind !== "written") {
    throw new Error(JSON.stringify(written.problems));
  }
  return written.chunks.join("");
};

/** `file` with `change` applied to the object `_<id>`. */
const changed = (
  file: ReqifFile,
  id: string,
  change: (o: ReqifSpecObject) => ReqifSpecObject,
): ReqifFile => ({
  ...file,
  specObjects: file.specObjects.map((o) => (o.identifier === `_${id}` ? change(o) : o)),
});

/** `object` with another title, as another tool would change it. */
const retitled = (object: ReqifSpecObject): ReqifSpecObject => ({
  ...object,
  values: object.values.map((v) =>
    v.kind === "string" && v.definition.endsWith(".title") ? { ...v, value: `${v.value} (edited)` } : v,
  ),
});

/** The empty workspace with `text` at in/x.reqif and the images of the export beside it. */
const target = async (
  text: string,
  images: string | undefined,
  files: Readonly<Record<string, string>> = {},
): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> => {
  const made = await open("SR-052/empty", { ...files, "in/x.reqif": text });
  if (images !== undefined) {
    await fs.cp(images, made.fixture.path("in/x-images"), { recursive: true });
  }
  return made;
};

const element = async (workspace: Workspace, imported: Imported, id: string): Promise<Got["element"]> =>
  (
    await run<Got>(workspace, "element.get", {
      ref: imported.created.find((c) => c.identifier === `_${id}`)?.id,
    })
  ).element;

/** The saved mapping of the source, changed by `change` as a person would edit it. */
const editMapping = async (
  fixture: FixtureWorkspace,
  change: (m: Record<string, unknown>) => void,
): Promise<void> => {
  const mapping = parse(await fs.readFile(fixture.path(MAPPING), "utf8")) as Record<string, unknown>;
  change(mapping);
  await fs.writeFile(fixture.path(MAPPING), stringify(mapping));
};

interface Entry {
  source: string;
  values?: Record<string, string>;
  "omit-values"?: string[];
  omit?: true;
  property?: string;
}

/** The attribute entry for `source` of mapping `m`. */
const attributeEntry = (m: Record<string, unknown>, source: string): Entry => {
  const found = (m["attributes"] as Entry[]).find((e) => e.source === source);
  if (found === undefined) {
    throw new Error(`no attribute entry ${source}`);
  }
  return found;
};

describe("reqif.import of a file of ReqSeq (SR-052)", () => {
  it("[SR-052/AK3] extends the saved mapping by what a later file of the same source adds, keeping what it holds", async () => {
    const one = await exported([TEMPERATURE]);
    const all = await exported(undefined);
    const { fixture, workspace } = await target(one.text, undefined, { "in/all.reqif": all.text });
    await fs.cp(all.images, fixture.path("in/x-images"), { recursive: true });
    await run<Imported>(workspace, "reqif.import", { file: "in/x.reqif", delivery: "1" });
    const choice = "_ad-system-requirement.requirement-type";
    // A person maps one value no longer and omits another.
    await editMapping(fixture, (m) => {
      const entry = attributeEntry(m, choice);
      delete entry.values?.["_ev-requirement-type.quality"];
      delete entry.values?.["_ev-requirement-type.constraint"];
      entry["omit-values"] = ["_ev-requirement-type.constraint"];
    });
    // The whole workspace: types, attributes and relation types the first file did not have.
    const second = await run<Imported>(workspace, "reqif.import", { file: "in/all.reqif", delivery: "2" });
    expect(second.files).toContain(MAPPING);
    // The element of the first file is the same element now (SR-056): six are new.
    expect([second.created.length, second.updated, second.dropped]).toEqual([6, [], []]);
    const mapping = parse(await fs.readFile(fixture.path(MAPPING), "utf8")) as Record<string, Entry[]>;
    expect(mapping["types"]?.map((t) => t.source)).toEqual([
      "_ot-system-requirement",
      "_ot-need",
      "_ot-decision",
      "_ot-variant",
      "_ot-package",
      "_ot.missing",
    ]);
    expect(mapping["relations"]?.map((r) => r.source)).toContain("_rt-packages");
    const entry = mapping["attributes"]?.find((e) => e.source === choice);
    expect(Object.keys(entry?.values ?? {})).toContain("_ev-requirement-type.quality");
    expect([
      Object.keys(entry?.values ?? {}).includes("_ev-requirement-type.constraint"),
      entry?.["omit-values"],
    ]).toEqual([false, ["_ev-requirement-type.constraint"]]);
    // Nothing more to add: the mapping stays as it is.
    const third = await run<Imported>(workspace, "reqif.import", { file: "in/all.reqif", delivery: "3" });
    expect(third.files).not.toContain(MAPPING);
    // A file with less adds nothing either; a mapping without attributes gets those of the file.
    const fourth = await run<Imported>(workspace, "reqif.import", { file: "in/x.reqif", delivery: "4" });
    expect(fourth.files).not.toContain(MAPPING);
    await editMapping(fixture, (m) => {
      delete m["attributes"];
    });
    const fifth = await run<Imported>(workspace, "reqif.import", { file: "in/x.reqif", delivery: "5" });
    expect(fifth.files).toContain(MAPPING);
  });

  it("[SR-052/AK3] never bypasses a given mapping: an attribute it omits is not taken from reqseq-values", async () => {
    const all = await exported(undefined);
    const { fixture, workspace } = await target(all.text, all.images);
    await run<Imported>(workspace, "reqif.import", { file: "in/x.reqif", delivery: "1" });
    await editMapping(fixture, (m) => {
      const entry = attributeEntry(m, "_ad-system-requirement.topic");
      delete entry.property;
      entry.omit = true;
      // Another source, so the elements are new rather than those of the first import (SR-056).
      (m["source"] as Record<string, unknown>)["name"] = "Other station";
    });
    const again = await run<Imported>(workspace, "reqif.import", {
      file: "in/x.reqif",
      delivery: "2",
      mapping: MAPPING,
    });
    const wind = await element(workspace, again, WIND);
    expect([wind.title, wind.properties["topic"], wind.properties["rationale"]]).toEqual([
      "Show wind speed & gusts <live>",
      undefined,
      "Operators **need** it.",
    ]);
    expect(
      again.losses.filter((l) => l.code === "omitted-attribute").map((l) => [l.identifier, l.reason]),
    ).toEqual([[`_${WIND}`, "the mapping omits its attribute topic"]]);
  });

  it("[SR-052/AK3] imports an object another tool changed by its SPEC-RELATIONs, keeping a target outside the export with its stored version", async () => {
    const { file, images } = await exported([WIND, HISTORY]);
    // Another tool removed WIND's relation to the decision.
    const edited = rewritten({
      ...file,
      specRelations: file.specRelations.filter(
        (r) => !(r.source === `_${WIND}` && r.target === `_${DECISION}`),
      ),
    });
    const { workspace } = await target(edited, images);
    const imported = await run<Imported>(workspace, "reqif.import", { file: "in/x.reqif", delivery: "1" });
    expect(imported.problems?.map((p) => [p.code, p.message.split(":")[0]])).toEqual([
      ["reqif.edited-elsewhere", `_${WIND}`],
    ]);
    expect(imported.losses.map((l) => l.code)).toEqual(["hierarchy"]);
    const wind = await element(workspace, imported, WIND);
    const history = await element(workspace, imported, HISTORY);
    expect(wind.properties["validity"]).toEqual([{ id: VARIANT, version: "n1:67ebd0624004c969" }]);
    expect(wind.properties["packages"]).toEqual([{ id: PACKAGE, version: "n1:67ebd0624004c969" }]);
    expect(
      wind.relations.filter((r) => r.direction === "out").map((r) => [r.kind, r.id, r.storedVersion]),
    ).toEqual([
      ["derives-from", NEED, "n1:99370531eef49776"],
      ["validity", VARIANT, "n1:67ebd0624004c969"],
      ["packages", PACKAGE, "n1:67ebd0624004c969"],
    ]);
    // Taken from its channels: the relation to WIND points at the new element, the others as stored.
    expect(history.relations.filter((r) => r.direction === "out").map((r) => [r.kind, r.id])).toEqual([
      ["refines", wind.id],
      ["refines", TEMPERATURE],
      ["derives-from", GONE],
      ["packages", PACKAGE],
    ]);
    // Without readable reqseq-values the targets outside the export have no version to keep.
    const bare = rewritten(
      changed(file, WIND, (o) => ({
        ...o,
        values: o.values.filter((v) => !v.definition.startsWith("_rq-")),
      })),
    );
    const other = await target(bare, images);
    const lost = await run<Imported>(other.workspace, "reqif.import", { file: "in/x.reqif", delivery: "1" });
    expect(lost.losses.filter((l) => l.code === "relation-end-not-imported")).toHaveLength(4);
  });

  it("[SR-052/AK3] leaves out a relation the metamodel does not allow, from the channels and from SPEC-RELATIONs", async () => {
    const files = {
      ...OWNER_MODEL,
      "requirements/SR-0000000052b4.md": [
        "---",
        `id: ${ODD}`,
        "type: system-requirement",
        "status: draft",
        "title: Odd",
        `based-on:\n  - { id: ${WIND}, version: n1:584cedef0a756936 }`,
        `packages:\n  - { id: ${NEED}, version: n1:99370531eef49776 }\n  - { id: ${PACKAGE}, version: n1:67ebd0624004c969 }`,
        `validity:\n  - { id: ${NEED}, version: n1:99370531eef49776 }`,
        "refines: loose",
        "---",
        "",
      ].join("\n"),
      "measures/MS-0000000052b1.md": `---\nid: ${GUSTS}\ntype: measure\nstatus: draft\ntitle: Gusts\nowner: { id: ${WIND}, version: n1:584cedef0a756936 }\npackages: [{ id: ${PACKAGE}, version: n1:67ebd0624004c969 }]\n---\n`,
    };
    const { file, images } = await exported([ODD, WIND, NEED, GUSTS], files);
    const notAllowed = (imported: Imported): string[] =>
      imported.losses
        .filter((l) => l.code === "relation-not-allowed" || l.code === "relation-duplicate")
        .map((l) => l.reason);
    const fromChannels = await target(rewritten(file), images, OWNER_MODEL);
    const taken = await run<Imported>(fromChannels.workspace, "reqif.import", {
      file: "in/x.reqif",
      delivery: "1",
    });
    expect(notAllowed(taken)).toEqual([
      "the metamodel does not allow based-on from system-requirement to system-requirement",
      "the metamodel does not allow validity from system-requirement to need",
      "the metamodel does not allow packages from system-requirement to need",
    ]);
    const odd = await element(fromChannels.workspace, taken, ODD);
    expect(odd.properties["validity"]).toBeUndefined();
    // The target outside the export stays.
    expect([
      odd.properties["packages"],
      odd.relations.filter((r) => r.direction === "out").map((r) => r.id),
    ]).toEqual([[{ id: PACKAGE, version: "n1:67ebd0624004c969" }], [PACKAGE]]);
    // Edited elsewhere: the same through SPEC-RELATIONs, and a property with one target takes one.
    const relation = (
      source: string,
      type: string,
      to: string,
      n: number,
    ): ReqifFile["specRelations"][number] => ({
      identifier: `_sr-added-${String(n)}`,
      lastChange: file.header.creationTime ?? "",
      type,
      source: `_${source}`,
      target: `_${to}`,
      values: [],
      line: 0,
    });
    const edited = changed(changed(file, ODD, retitled), GUSTS, retitled);
    const more = rewritten({
      ...edited,
      specRelations: [
        ...edited.specRelations,
        relation(GUSTS, "_rt-owner", WIND, 1),
        relation(GUSTS, "_rt-owner", NEED, 2),
        relation(WIND, "_rt-owner", NEED, 3),
      ],
    });
    const fromRelations = await target(more, images, OWNER_MODEL);
    const read = await run<Imported>(fromRelations.workspace, "reqif.import", {
      file: "in/x.reqif",
      delivery: "1",
    });
    expect(notAllowed(read)).toEqual([
      // Exported from its stored values; the type of a measure has no packages.
      `the metamodel does not allow packages from measure to _${PACKAGE}`,
      "the metamodel does not allow based-on from system-requirement to system-requirement",
      "the metamodel does not allow validity from system-requirement to need",
      "the metamodel does not allow packages from system-requirement to need",
      `owner to _${WIND} is imported once already`,
      `owner holds one target, so _${NEED} is not imported`,
      "the metamodel does not allow owner from system-requirement to need",
    ]);
    const gusts = await element(fromRelations.workspace, read, GUSTS);
    expect(gusts.properties["owner"]).toEqual({
      id: (await element(fromRelations.workspace, read, WIND)).id,
      version: expect.any(String) as unknown,
    });
  });

  it("[SR-052/AK3] takes the channels of an object with a property the metamodel here does not know, without that property", async () => {
    const weighted = {
      "metamodel/extra.yaml": OWNER_MODEL["metamodel/extra.yaml"]
        .replace("properties: [title, owner,", "properties: [title, weight, owner,")
        .replace("properties:\n", "properties:\n  - { key: weight, name: Weight, kind: number }\n"),
      "measures/MS-0000000052b1.md": `---\nid: ${GUSTS}\ntype: measure\nstatus: draft\ntitle: Gusts\nweight: 2\n---\n\nGusts over 3 s.\n`,
    };
    const { text } = await exported([GUSTS], weighted);
    const { workspace } = await target(text, undefined, OWNER_MODEL);
    const imported = await run<Imported>(workspace, "reqif.import", { file: "in/x.reqif", delivery: "1" });
    expect(imported.problems).toEqual([]);
    expect(imported.losses.map((l) => [l.code, l.reason])).toContainEqual([
      "omitted-attribute",
      "the mapping omits its attribute weight",
    ]);
    const gusts = await element(workspace, imported, GUSTS);
    expect([gusts.title, gusts.text, gusts.properties["weight"]]).toEqual([
      "Gusts",
      "Gusts over 3 s.\n",
      undefined,
    ]);
  });

  it("[SR-052/AK3] copies the images of the text and points its links at the copies; an image not there is a loss", async () => {
    const files = {
      "requirements/SR-0000000052b5.md": [
        "---",
        `id: ${PICTURES}`,
        "type: system-requirement",
        "status: draft",
        "title: Pictures",
        "---",
        "",
        "![a](SR-0000000052a1/anemometer.png) ![b](SR-0000000052a1/anemometer.png) ![w](https://example.com/w.png) ![r][ref] [site](https://example.com)",
        "",
        "[ref]: SR-0000000052a1/anemometer.png",
        "",
      ].join("\n"),
    };
    const { file, text, images } = await exported([PICTURES], files);
    const { workspace } = await target(text, images);
    const imported = await run<Imported>(workspace, "reqif.import", { file: "in/x.reqif", delivery: "1" });
    expect([imported.problems, imported.losses.map((l) => l.code)]).toEqual([[], ["hierarchy"]]);
    const pictures = await element(workspace, imported, PICTURES);
    const stem = `SR-${pictures.id.slice(-12)}`;
    // Reference-style images keep their links as written.
    expect(pictures.text).toBe(
      `![a](${stem}/anemometer.png) ![b](${stem}/anemometer.png) ![w](https://example.com/w.png) ![r][ref] [site](https://example.com)\n\n[ref]: SR-0000000052a1/anemometer.png\n`,
    );
    expect(imported.files).toContain(`Weather-station/${stem}/anemometer.png`);
    // Without the image folder the image is missing; the link stays.
    const without = await target(text, undefined);
    const missing = await run<Imported>(without.workspace, "reqif.import", {
      file: "in/x.reqif",
      delivery: "1",
    });
    // One for each image object of the XHTML, the reference-style one too.
    expect(missing.losses.map((l) => l.code)).toEqual([
      "image-missing",
      "image-missing",
      "image-missing",
      "hierarchy",
    ]);
    expect((await element(without.workspace, missing, PICTURES)).text).toContain(
      "![a](SR-0000000052a1/anemometer.png)",
    );
    // A text whose XHTML lost its images was changed elsewhere.
    const textless = rewritten(
      changed(file, PICTURES, (o) => ({
        ...o,
        values: o.values.filter((v) => !v.definition.endsWith(".text")),
      })),
    );
    const changedText = await target(textless, images);
    const edited = await run<Imported>(changedText.workspace, "reqif.import", {
      file: "in/x.reqif",
      delivery: "1",
    });
    expect(edited.problems?.map((p) => p.code)).toEqual(["reqif.edited-elsewhere"]);
  });

  it("writes no mapping folder for a refused import, and refuses a mapping path that is no file", async () => {
    const all = await exported(undefined);
    const settings = await fs.readFile(
      new URL("../../../../../fixtures/SR-052/empty/reqseq-workspace.yaml", import.meta.url),
      "utf8",
    );
    const ignored = await target(all.text, all.images, {
      "reqseq-workspace.yaml": `${settings}ignore: ["Weather-station/**"]\n`,
    });
    await refusal(ignored.workspace, { file: "in/x.reqif", delivery: "1" });
    await expect(fs.stat(ignored.fixture.path("reqif"))).rejects.toThrow();
    const folder = await target(all.text, all.images);
    await fs.mkdir(folder.fixture.path(MAPPING), { recursive: true });
    const error = await refusal(folder.workspace, { file: "in/x.reqif", delivery: "1" });
    expect([error.code, error.message.startsWith(`mapping: ${MAPPING} cannot be read`)]).toEqual([
      "file.faulty",
      true,
    ]);
  });
});

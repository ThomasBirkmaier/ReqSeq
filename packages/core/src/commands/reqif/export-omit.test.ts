// reqif.export with omitted properties and targets outside the export (SR-059) on
// fixtures/SR-052/package: a package with requirements, a need and a decision, relations among them,
// one to a requirement outside the package and one to a missing element.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { parse } from "yaml";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import type { ReqifFile } from "../../reqif/model.js";
import { parseReqif } from "../../reqif/parse.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Exported = CommandOutput<"reqif.export">;

const PACKAGE = "52052052-0000-4000-8000-0000000052f1";
const NEED = "52052052-0000-4000-8000-0000000052d1";
const DECISION = "52052052-0000-4000-8000-0000000052e1";
const VARIANT = "52052052-0000-4000-8000-0000000052c1";
const WIND = "52052052-0000-4000-8000-0000000052a1";
const HISTORY = "52052052-0000-4000-8000-0000000052a2";

/** The mapping of a supplier, with a comment the export keeps. */
const MAPPING = [
  "reqseq-reqif-mapping: 1",
  "# Supplier of the anemometer",
  "source: { name: Zulieferer }",
  "",
].join("\n");

const open = async (files: Readonly<Record<string, string>> = {}) => {
  const made = await createFixtureWorkspace({ fixture: "SR-052/package", files });
  onTestFinished(() => made.cleanup());
  const workspace = new Workspace(made.root);
  onTestFinished(() => workspace.close());
  const exported = async (input: Record<string, unknown>): Promise<Exported> =>
    (await invoke("reqif.export", input, { workspace })) as Exported;
  const refused = async (input: Record<string, unknown>): Promise<CommandError> => {
    try {
      await exported(input);
    } catch (error) {
      if (error instanceof CommandError) {
        return error;
      }
      throw error;
    }
    throw new Error("reqif.export did not fail");
  };
  const text = (file: string): Promise<string> => fs.readFile(made.path(file), "utf8");
  const parsed = async (file: string): Promise<ReqifFile> => {
    const outcome = parseReqif(await fs.readFile(made.path(file)));
    if (outcome.kind !== "parsed") {
      throw new Error(outcome.message);
    }
    return outcome.file;
  };
  return { fixture: made, exported, refused, text, parsed };
};

/** The `reqseq-values` of the SPEC-OBJECT `_<id>` of `file`, parsed. */
const valuesOf = (file: ReqifFile, id: string): Record<string, unknown> => {
  const value = file.specObjects
    .find((o) => o.identifier === `_${id}`)
    ?.values.find((v) => v.definition.endsWith(".values"));
  return JSON.parse(value?.kind === "string" ? value.value : "{}") as Record<string, unknown>;
};

describe("reqif.export (SR-059)", () => {
  it("[SR-059/AK1] leaves the listed properties out of the file: no attribute, no value, nothing in reqseq-values, no SPEC-RELATION of a relation-valued one", async () => {
    const { exported, text, parsed } = await open();
    const selection = { package: PACKAGE };
    await exported({ output: "full.reqif", selection });
    expect(await text("full.reqif")).toContain("Operators **need** it.");
    const result = await exported({
      output: "s6.reqif",
      selection,
      omitProperties: ["rationale", "packages"],
    });
    expect(result.files).toEqual(["s6-images/SR-0000000052a1/anemometer.png"]);
    const raw = await text("s6.reqif");
    expect(raw).not.toContain("rationale");
    expect(raw).not.toContain("Operators");
    expect(raw).not.toContain("packages");
    const file = await parsed("s6.reqif");
    expect(file.specRelations.map((r) => r.type)).not.toContain("_rt-packages");
    // The package was a target of the omitted property only, so it is no stub either.
    expect(file.specObjects.map((o) => o.identifier)).not.toContain(`_${PACKAGE}`);
    expect(Object.keys(valuesOf(file, WIND))).not.toContain("rationale");
    expect(valuesOf(file, WIND)["topic"]).toBe("Display");
  });

  it("[SR-059/AK2] names a target outside the export by its ID only: a SPEC-OBJECT with IDENTIFIER and type, and no title or text of it anywhere in the file", async () => {
    const { exported, text, parsed } = await open();
    await exported({ output: "wind.reqif", selection: { ids: [WIND] } });
    const file = await parsed("wind.reqif");
    expect(file.specObjects.map((o) => [o.identifier, o.type, o.longName, o.desc, o.values.length])).toEqual([
      [`_${WIND}`, "_ot-system-requirement", "Show wind speed & gusts <live>", undefined, 13],
      [`_${NEED}`, "_ot-need", undefined, undefined, 0],
      [`_${DECISION}`, "_ot-decision", undefined, undefined, 0],
      [`_${VARIANT}`, "_ot-variant", undefined, undefined, 0],
      [`_${PACKAGE}`, "_ot-package", undefined, undefined, 0],
    ]);
    const raw = await text("wind.reqif");
    for (const outside of [
      "Know the weather",
      "The operator wants",
      "Measure with an anemometer",
      "cup anemometer",
      "Coast",
      "Stage 6",
    ]) {
      expect(raw).not.toContain(outside);
    }
    // Its relations keep the ID and the version of each target.
    expect(valuesOf(file, WIND)["derives-from"]).toEqual([{ id: NEED, version: "n1:99370531eef49776" }]);
    // A target inside the export keeps its title in the relation.
    await exported({ output: "two.reqif", selection: { ids: [HISTORY, WIND] } });
    expect(valuesOf(await parsed("two.reqif"), HISTORY)["refines"]).toEqual([
      { id: WIND, version: "n1:584cedef0a756936", title: "Show wind speed & gusts <live>" },
      { id: "52052052-0000-4000-8000-0000000052a3", version: "n1:9de1cddc22503560" },
    ]);
  });

  it("[SR-059/AK3] saves the omitted properties in the mapping of the target and leaves them out of later deliveries", async () => {
    const { exported, text } = await open({ "reqif/zulieferer.yaml": MAPPING });
    const selection = { package: PACKAGE };
    const first = await exported({
      output: "first.reqif",
      selection,
      mapping: "reqif/zulieferer.yaml",
      omitProperties: ["rationale"],
    });
    expect(first.files).toEqual(["first-images/SR-0000000052a1/anemometer.png", "reqif/zulieferer.yaml"]);
    const saved = await text("reqif/zulieferer.yaml");
    expect(saved.startsWith(MAPPING)).toBe(true);
    expect(parse(saved)).toEqual({
      "reqseq-reqif-mapping": 1,
      source: { name: "Zulieferer" },
      "omit-properties": ["rationale"],
    });
    expect(await text("first.reqif")).not.toContain("Operators");
    // A later delivery names the mapping only.
    const later = await exported({ output: "later.reqif", selection, mapping: "reqif/zulieferer.yaml" });
    expect(later.files).toEqual(["later-images/SR-0000000052a1/anemometer.png"]);
    expect(await text("later.reqif")).not.toContain("Operators");
    // A key the mapping has is not saved again; a new one is added after it.
    await exported({ output: "x.reqif", mapping: "reqif/zulieferer.yaml", omitProperties: ["rationale"] });
    expect(await text("reqif/zulieferer.yaml")).toBe(saved);
    await exported({
      output: "x.reqif",
      mapping: "reqif/zulieferer.yaml",
      omitProperties: ["topic", "topic"],
    });
    expect(
      (parse(await text("reqif/zulieferer.yaml")) as Record<string, unknown>)["omit-properties"],
    ).toEqual(["rationale", "topic"]);
    expect(await text("x.reqif")).not.toContain("Display");
  });

  it("refuses an unknown property and a mapping outside the mapping folder it would save, writing nothing, and can leave out the title", async () => {
    const { fixture, exported, refused, text, parsed } = await open({
      "reqif/zulieferer.yaml": MAPPING,
      "elsewhere/zulieferer.yaml": `${MAPPING}omit-properties: [rationale]\n`,
    });
    const unknown = await refused({ output: "a.reqif", omitProperties: ["topic", "nope"] });
    expect([unknown.code, unknown.details?.["fields"], unknown.message]).toEqual([
      "input.invalid",
      ["omitProperties[1]"],
      "omitProperties[1]: nope is no property of the metamodel",
    ]);
    const outside = await refused({
      output: "a.reqif",
      mapping: "elsewhere/zulieferer.yaml",
      omitProperties: ["topic"],
    });
    expect([outside.code, outside.details?.["fields"], outside.details?.["reason"]]).toEqual([
      "input.invalid",
      ["mapping"],
      "outside-mapping-folder",
    ]);
    await expect(fs.stat(fixture.path("a.reqif"))).rejects.toThrow();
    expect(await text("elsewhere/zulieferer.yaml")).not.toContain("topic");
    // Read from anywhere when nothing is saved.
    await exported({
      output: "b.reqif",
      mapping: "elsewhere/zulieferer.yaml",
      omitProperties: ["rationale"],
    });
    expect(await text("b.reqif")).not.toContain("Operators");
    // The title too, LONG-NAME and its attribute included.
    await exported({ output: "c.reqif", selection: { ids: [WIND] }, omitProperties: ["title"] });
    const file = await parsed("c.reqif");
    expect(file.specObjects[0]?.longName).toBeUndefined();
    expect(file.specTypes[0]?.attributes.map((a) => a.identifier)).not.toContain(
      "_ad-system-requirement.title",
    );
    expect(await text("c.reqif")).not.toContain("Show wind speed");
  });
});

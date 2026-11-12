// Criterion keys on reqif.import (SR-204): a new element gets a key for each acceptance criterion
// (AK1), a repeated import keeps them (AK4), and a file of ReqSeq carries them in its own values
// (AK12), and a key there not in its form or given twice refuses the file (AK5). Fixtures: what fixtures/SR-052/package exports of its requirement WIND, imported into
// fixtures/SR-052/empty; for another tool, the deliveries of fixtures/SR-056/delivery with two
// criteria attributes on REQ-1, imported into fixtures/SR-004/one-repository.
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { parse } from "yaml";
import type { CommandOutput } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Imported = CommandOutput<"reqif.import">;

const WIND = "52052052-0000-4000-8000-0000000052a1";
const WIND_FILE = "requirements/SR-0000000052a1.md";
const KEY = /^[a-z][a-z0-9]{3}$/u;

const MODEL = "metamodel/standard-model.yaml";

/** The metamodel of `fixture` with the meaning acceptance-criteria on its property (D-072), if it lacks it. */
const withMeaning = async (fixture: string): Promise<Record<string, string>> => {
  const text = await fs.readFile(
    new URL(`../../../../../fixtures/${fixture}/${MODEL}`, import.meta.url),
    "utf8",
  );
  return {
    [MODEL]: text.includes("meaning: acceptance-criteria")
      ? text
      : text.replace(
          "  - key: acceptance-criteria\n",
          "  - key: acceptance-criteria\n    meaning: acceptance-criteria\n",
        ),
  };
};

const open = async (
  fixture: string,
  files: Readonly<Record<string, string>> = {},
): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> => {
  const made = await createFixtureWorkspace({
    fixture,
    files: { ...(await withMeaning(fixture)), ...files },
  });
  onTestFinished(() => made.cleanup());
  const workspace = new Workspace(made.root);
  onTestFinished(() => workspace.close());
  return { fixture: made, workspace };
};

/** What SR-052/package exports of WIND, with the criteria lines of its file replaced by `criteria`. */
const exported = async (criteria?: readonly string[]): Promise<string> => {
  const source = await open("SR-052/package");
  if (criteria !== undefined) {
    const text = await fs.readFile(source.fixture.path(WIND_FILE), "utf8");
    await source.fixture.write(
      WIND_FILE,
      text.replace(/acceptance-criteria:\n( {2}- .*\n)+/u, `acceptance-criteria:\n${criteria.join("\n")}\n`),
    );
  }
  const workspace = new Workspace(source.fixture.root);
  onTestFinished(() => workspace.close());
  await invoke("reqif.export", { output: "x.reqif", selection: { ids: [WIND] } }, { workspace });
  return fs.readFile(source.fixture.path("x.reqif"), "utf8");
};

/** The acceptance criteria in the file of the element the import made of WIND. */
const criteriaOf = async (made: FixtureWorkspace, imported: Imported): Promise<unknown> => {
  const id = imported.created.find((c) => c.identifier === `_${WIND}`)?.id ?? "";
  const file = imported.files.find((f) => f.endsWith(`${id.slice(-12)}.md`)) ?? "";
  const text = await fs.readFile(made.path(file), "utf8");
  return (parse(text.split("---\n")[1] ?? "") as Record<string, unknown>)["acceptance-criteria"];
};

/** The texts of every element file the import wrote, by path. */
const written = async (made: FixtureWorkspace, imported: Imported): Promise<string[]> =>
  Promise.all(imported.files.filter((f) => f.endsWith(".md")).map((f) => fs.readFile(made.path(f), "utf8")));

/** A delivery of fixtures/SR-056/delivery. */
const sample = (name: string): string =>
  readFileSync(new URL(`../../../../../fixtures/SR-056/delivery/${name}`, import.meta.url), "utf8");

const CRITERIA = ["Alpha", "Beta", "Gamma"];

/**
 * `delivery` with a multi-valued enumeration Criteria on its requirement type, whose values `texts`
 * REQ-1, its first object, holds: several criteria as another tool can give them, each by its name.
 */
const withCriteria = (delivery: string, texts: readonly string[]): string =>
  delivery
    .replace(
      "</DATATYPES>",
      `<DATATYPE-DEFINITION-ENUMERATION IDENTIFIER="dt-criteria"><SPECIFIED-VALUES>${CRITERIA.map(
        (c, i) =>
          `<ENUM-VALUE IDENTIFIER="ev-${c}" LONG-NAME="${c}"><PROPERTIES><EMBEDDED-VALUE KEY="${String(i)}" OTHER-CONTENT=""/></PROPERTIES></ENUM-VALUE>`,
      ).join("")}</SPECIFIED-VALUES></DATATYPE-DEFINITION-ENUMERATION></DATATYPES>`,
    )
    .replace(
      "</SPEC-ATTRIBUTES>",
      '<ATTRIBUTE-DEFINITION-ENUMERATION IDENTIFIER="ad-criteria" LONG-NAME="Criteria" MULTI-VALUED="true"><TYPE><DATATYPE-DEFINITION-ENUMERATION-REF>dt-criteria</DATATYPE-DEFINITION-ENUMERATION-REF></TYPE></ATTRIBUTE-DEFINITION-ENUMERATION></SPEC-ATTRIBUTES>',
    )
    .replace(
      "</ATTRIBUTE-VALUE-ENUMERATION>\n          </VALUES>",
      `</ATTRIBUTE-VALUE-ENUMERATION><ATTRIBUTE-VALUE-ENUMERATION><DEFINITION><ATTRIBUTE-DEFINITION-ENUMERATION-REF>ad-criteria</ATTRIBUTE-DEFINITION-ENUMERATION-REF></DEFINITION><VALUES>${texts
        .map((t) => `<ENUM-VALUE-REF>ev-${t}</ENUM-VALUE-REF>`)
        .join("")}</VALUES></ATTRIBUTE-VALUE-ENUMERATION>\n          </VALUES>`,
    );

/** The acceptance criteria in element file `file` of `made`. */
const criteriaIn = async (made: FixtureWorkspace, file: string): Promise<unknown> => {
  const text = await fs.readFile(made.path(file), "utf8");
  return (parse(text.split("---\n")[1] ?? "") as Record<string, unknown>)["acceptance-criteria"];
};

describe("criterion keys on reqif.import (SR-204)", () => {
  it("[SR-204/AK-qg2w] gives each acceptance criterion of a new element a key, and [SR-204/AK-ftt1] a repeated import keeps them", async () => {
    const { fixture, workspace } = await open("SR-052/empty", { "in/x.reqif": await exported() });
    const first = (await invoke(
      "reqif.import",
      { file: "in/x.reqif", delivery: "1" },
      { workspace },
    )) as Imported;
    const criteria = (await criteriaOf(fixture, first)) as { key: string; text: string }[];
    expect(criteria.map((c) => c.text)).toEqual([
      "Given wind, when it blows, then the *speed* shows within 1 s.",
      "Given a gust, then the peak shows for 10 s.",
    ]);
    expect(criteria.every((c) => KEY.test(c.key))).toBe(true);
    expect(new Set(criteria.map((c) => c.key)).size).toBe(2);
    const before = await written(fixture, first);
    const again = (await invoke(
      "reqif.import",
      { file: "in/x.reqif", delivery: "1" },
      { workspace },
    )) as Imported;
    expect(again.updated).toEqual([]);
    expect(await written(fixture, first)).toEqual(before);
  });

  it("[SR-204/AK-s9d6] keeps the criterion keys of a requirement exported and imported again", async () => {
    const text = await exported([
      "  - key: speed",
      '    text: "Given wind, when it blows, then the *speed* shows within 1 s."',
      "  - key: peaks",
      "    text: Given a gust, then the peak shows for 10 s.",
    ]);
    const { fixture, workspace } = await open("SR-052/empty", { "in/x.reqif": text });
    const imported = (await invoke(
      "reqif.import",
      { file: "in/x.reqif", delivery: "1" },
      { workspace },
    )) as Imported;
    expect(await criteriaOf(fixture, imported)).toEqual([
      { key: "speed", text: "Given wind, when it blows, then the *speed* shows within 1 s." },
      { key: "peaks", text: "Given a gust, then the peak shows for 10 s." },
    ]);
  });
  it("[SR-204/AK-b2q6] refuses a file of ReqSeq whose criterion key is not in its form, or given twice, naming the object", async () => {
    for (const [items, reason] of [
      [["  - key: speed", "    text: First.", "  - key: speed", "    text: Second."], "is given twice"],
      [["  - key: Peak1", "    text: First."], "is no criterion key"],
    ] as const) {
      const text = await exported([...items]);
      const { fixture, workspace } = await open("SR-052/empty", { "in/x.reqif": text });
      const before = await fs.readdir(fixture.root, { recursive: true });
      const error = await invoke("reqif.import", { file: "in/x.reqif", delivery: "1" }, { workspace }).then(
        () => undefined,
        (e: unknown) => e as { code: string; message: string },
      );
      expect(error?.code).toBe("reqif.invalid");
      expect(error?.message).toMatch(new RegExp(`SPEC-OBJECT \\S+: .*${reason}`, "u"));
      expect(await fs.readdir(fixture.root, { recursive: true })).toEqual(before);
    }
  });

  it("[SR-204/AK-ftt1] a repeated import from another tool keeps the keys of the same texts at other positions", async () => {
    const { fixture, workspace } = await open("SR-004/one-repository", {
      "in/1.reqif": withCriteria(sample("lieferung-1.reqif"), ["Alpha", "Beta"]),
      "in/2.reqif": withCriteria(sample("lieferung-2.reqif"), ["Beta", "Gamma"]),
      "reqif/kunde-a.yaml": sample("kunde-a.yaml").replace(
        "relations:",
        "  - { source: Criteria, property: acceptance-criteria }\nrelations:",
      ),
    });
    const input = (n: number): Record<string, unknown> => ({
      file: `in/${String(n)}.reqif`,
      mapping: "reqif/kunde-a.yaml",
      delivery: `D${String(n)}`,
    });
    const first = (await invoke("reqif.import", input(1), { workspace })) as Imported;
    const id = String(first.created.find((c) => c.identifier === "REQ-1")?.id);
    const file = first.files.find((f) => f.endsWith(`${id.slice(-12)}.md`)) ?? "";
    const before = (await criteriaIn(fixture, file)) as { key: string; text: string }[];
    expect(before.map((c) => c.text)).toEqual(["Alpha", "Beta"]);
    await invoke("reqif.import", input(2), { workspace });
    const after = (await criteriaIn(fixture, file)) as { key: string; text: string }[];
    expect(after.map((c) => c.text)).toEqual(["Beta", "Gamma"]);
    expect(after[0]?.key).toBe(before[1]?.key);
    expect([before[0]?.key, before[1]?.key]).not.toContain(after[1]?.key);
    expect(KEY.test(after[1]?.key ?? "")).toBe(true);
  });
});

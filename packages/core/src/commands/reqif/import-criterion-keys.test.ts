// Criterion keys on reqif.import (SR-204): a new element gets a key for each acceptance criterion
// (AK1), a repeated import keeps them (AK4), and a file of ReqSeq carries them in its own values.
// Fixtures: what fixtures/SR-052/package exports of its requirement WIND, imported into
// fixtures/SR-052/empty.
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

/** The metamodel of `fixture` with the meaning acceptance-criteria on its property (D-072). */
const withMeaning = async (fixture: string): Promise<Record<string, string>> => {
  const text = await fs.readFile(new URL(`../../../../../fixtures/${fixture}/${MODEL}`, import.meta.url), "utf8");
  return { [MODEL]: text.replace("  - key: acceptance-criteria\n", "  - key: acceptance-criteria\n    meaning: acceptance-criteria\n") };
};

const open = async (
  fixture: string,
  files: Readonly<Record<string, string>> = {},
): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> => {
  const made = await createFixtureWorkspace({ fixture, files: { ...(await withMeaning(fixture)), ...files } });
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

describe("criterion keys on reqif.import (SR-204)", () => {
  it("[SR-204/AK1] gives each acceptance criterion of a new element a key, and [SR-204/AK4] a repeated import keeps them", async () => {
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

  it("keeps the criterion keys of a file of ReqSeq", async () => {
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
});

// The acceptance criteria of a file of ReqSeq that another tool edited (SR-204 AK12, SR-053): the
// export writes them as an XHTML list (own.ts), and the import reads that list back as its items,
// so an unchanged criterion keeps its criterion key by its text (AK4). Fixtures: what
// fixtures/SR-052/package exports of its requirement WIND, imported into fixtures/SR-052/empty.
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
const MODEL = "metamodel/standard-model.yaml";
const KEY = /^[a-z][a-z0-9]{3}$/u;
const SPEED = "Given wind, when it blows, then the *speed* shows within 1 s.";
const PEAK = "Given a gust, then the peak shows for 10 s.";

/** The criteria list of WIND as the export writes it. */
const LIST = /<xhtml:div><xhtml:ul><xhtml:li>Given wind.*?<\/xhtml:ul><\/xhtml:div>/u;

const open = async (
  fixture: string,
  files: Readonly<Record<string, string>> = {},
): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> => {
  const model = await fs.readFile(
    new URL(`../../../../../fixtures/${fixture}/${MODEL}`, import.meta.url),
    "utf8",
  );
  const made = await createFixtureWorkspace({
    fixture,
    files: {
      // The meaning acceptance-criteria gives the criteria their keys (D-072).
      [MODEL]: model.replace(
        "  - key: acceptance-criteria\n",
        "  - key: acceptance-criteria\n    meaning: acceptance-criteria\n",
      ),
      ...files,
    },
  });
  onTestFinished(() => made.cleanup());
  const workspace = new Workspace(made.root);
  onTestFinished(() => workspace.close());
  return { fixture: made, workspace };
};

/** What SR-052/package exports of WIND, its criteria keyed `speed` and `peaks`. */
const exported = async (): Promise<string> => {
  const source = await open("SR-052/package");
  const text = await fs.readFile(source.fixture.path(WIND_FILE), "utf8");
  await source.fixture.write(
    WIND_FILE,
    text.replace(
      /acceptance-criteria:\n( {2}- .*\n)+/u,
      `acceptance-criteria:\n  - key: speed\n    text: "${SPEED}"\n  - key: peaks\n    text: ${PEAK}\n`,
    ),
  );
  await invoke(
    "reqif.export",
    { output: "x.reqif", selection: { ids: [WIND] } },
    { workspace: source.workspace },
  );
  return fs.readFile(source.fixture.path("x.reqif"), "utf8");
};

/** The acceptance criteria in element file `file` of `made`. */
const criteriaIn = async (made: FixtureWorkspace, file: string): Promise<unknown> => {
  const text = await fs.readFile(made.path(file), "utf8");
  return (parse(text.split("---\n")[1] ?? "") as Record<string, unknown>)["acceptance-criteria"];
};

/** The file of the element the import made of WIND. */
const windFile = (imported: Imported): string => {
  const id = imported.created.find((c) => c.identifier === `_${WIND}`)?.id ?? "";
  return imported.files.find((f) => f.endsWith(`${id.slice(-12)}.md`)) ?? "";
};

/** The criteria texts of WIND after importing `text`, whose criteria list is replaced by `list`, into an empty workspace. */
const importedTexts = async (text: string, list: string): Promise<unknown> => {
  const { fixture, workspace } = await open("SR-052/empty", { "in/x.reqif": text.replace(LIST, list) });
  const imported = (await invoke(
    "reqif.import",
    { file: "in/x.reqif", delivery: "1" },
    { workspace },
  )) as Imported;
  expect(imported.problems?.map((p) => p.code)).toEqual(["reqif.edited-elsewhere"]);
  return ((await criteriaIn(fixture, windFile(imported))) as { text: string }[]).map((c) => c.text);
};

describe("acceptance criteria of a file of ReqSeq another tool edited (SR-204)", () => {
  it("[SR-204/AK12] keeps the criterion keys of the unchanged criteria when another tool edited one between export and import", async () => {
    const text = await exported();
    const edited = text.replace(
      `${PEAK}</xhtml:li>`,
      "Given a gust, then the peak shows for 20 s.</xhtml:li>",
    );
    expect(edited).not.toBe(text);
    const { fixture, workspace } = await open("SR-052/empty", { "in/1.reqif": text, "in/2.reqif": edited });
    const first = (await invoke(
      "reqif.import",
      { file: "in/1.reqif", delivery: "1" },
      { workspace },
    )) as Imported;
    const file = windFile(first);
    expect(await criteriaIn(fixture, file)).toEqual([
      { key: "speed", text: SPEED },
      { key: "peaks", text: PEAK },
    ]);
    const again = (await invoke(
      "reqif.import",
      { file: "in/2.reqif", delivery: "2" },
      { workspace },
    )) as Imported;
    expect(again.problems?.map((p) => [p.code, p.message.split(":")[0]])).toContainEqual([
      "reqif.edited-elsewhere",
      `_${WIND}`,
    ]);
    const after = (await criteriaIn(fixture, file)) as { key: string; text: string }[];
    expect(after.map((c) => c.text)).toEqual([SPEED, "Given a gust, then the peak shows for 20 s."]);
    expect(after[0]?.key).toBe("speed");
    expect(KEY.test(after[1]?.key ?? "")).toBe(true);
    expect(["speed", "peaks"]).not.toContain(after[1]?.key);
  });

  it("reads a list another tool wrote as its items, its formatting as Markdown, and any other value as one item", async () => {
    const text = await exported();
    // An ordered list without div, white space between its items, one item formatted.
    expect(
      await importedTexts(
        text,
        "<xhtml:ol>\n  <xhtml:li>Plain.</xhtml:li>\n  <xhtml:li>Very <xhtml:b>bold</xhtml:b>.</xhtml:li>\n  <xhtml:li/>\n</xhtml:ol>",
      ),
    ).toEqual(["Plain.", "Very **bold**.", ""]);
    // Not exactly one list of items: text beside it, a second list, an item outside li, no list.
    for (const value of [
      "<xhtml:div><xhtml:p>Intro</xhtml:p><xhtml:ul><xhtml:li>One.</xhtml:li></xhtml:ul></xhtml:div>",
      "<xhtml:div>Intro<xhtml:ul><xhtml:li>One.</xhtml:li></xhtml:ul></xhtml:div>",
      "<xhtml:ul><xhtml:li>One.</xhtml:li></xhtml:ul><xhtml:ul><xhtml:li>Two.</xhtml:li></xhtml:ul>",
      "<xhtml:ul><xhtml:li>One.</xhtml:li>Two.</xhtml:ul>",
      "<xhtml:div><xhtml:p>One.</xhtml:p></xhtml:div>",
    ]) {
      expect(await importedTexts(text, value)).toHaveLength(1);
    }
  });
});

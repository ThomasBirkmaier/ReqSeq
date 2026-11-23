// Acceptance criteria in the search (SR-222, SR-216 AK1, AK2), on fixtures/SR-222/criteria: system
// requirements d1 "Gust alarm" (SR-036; criteria k7f3, rqjp and one without key), d2 "Mast survives
// storms" (SR-037; m4st, k7f3), d3 "Wind log" (SR-038; w1nd twice, text "… see SR-036 and the key
// rqjp."), and the glossary term e1 "Acceptance criterion" with the synonym "AK" (SR-220).
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../catalog.js";
import type { ElementRecord } from "../model/index.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { criterionKeysOf } from "../model/index.js";
import { carryKeyed, keyedRecords, queryKeyOf, queryReferenceOf, recordKeys } from "./search-criteria.js";
import { searchElements } from "./search-index.js";
import { searchIndex } from "./search-state.js";

type Output = CommandOutput<"element.search">;
type Hit = Output["hits"][number];

const ID = "22200000-0000-4000-8000-0000000000";

const open = async (
  files: Readonly<Record<string, string>> = {},
): Promise<{ readonly fixture: FixtureWorkspace; readonly workspace: Workspace }> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-222/criteria", files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const search = async (
  workspace: Workspace,
  query: string,
  more: Record<string, unknown> = {},
): Promise<Output> => (await invoke("element.search", { query, ...more }, { workspace })) as Output;

/** The UUID tails of the hits, in their order. */
const tails = (out: Output): string[] => out.hits.map((hit) => hit.id.slice(-2));

/** The record of `tail` in `records`. */
const recordOf = (
  records: readonly ElementRecord[],
  test: (record: ElementRecord) => boolean,
): ElementRecord => {
  const record = records.find(test);
  if (record === undefined) {
    throw new Error("no record");
  }
  return record;
};

const hitOf = (out: Output, tail: string): Hit => {
  const hit = out.hits.find((one) => one.id === `${ID}${tail}`);
  if (hit === undefined) {
    throw new Error(`no hit ${tail}`);
  }
  return hit;
};

/** The criterion and text of a hit's snippet, and its marked parts. */
const located = (hit: Hit): unknown => {
  const { snippet } = hit;
  if (snippet === undefined) {
    return undefined;
  }
  const marks = snippet.marks.map((mark) => snippet.text.slice(mark.start, mark.end));
  return snippet.field === "text"
    ? { field: "text", marks }
    : { property: snippet.property, criterion: snippet.criterion, text: snippet.text, marks };
};

/** A system requirement of `tail` with `criteria` as YAML lines and the text `text`. */
const requirement = (tail: string, identifier: string, criteria: readonly string[], text: string): string =>
  [
    "---",
    `id: ${ID}${tail}`,
    "type: system-requirement",
    "status: draft",
    `title: Extra ${tail}`,
    `spec-id: ${identifier}`,
    "acceptance-criteria:",
    ...criteria,
    "---",
    "",
    text,
    "",
  ].join("\n");

describe("criterion keys (SR-222 AK1)", () => {
  it("[SR-222/AK-tdpp] finds a criterion key exactly, in any case, in quotes and after AK-, beside the word itself, and the other words must still match", async () => {
    const { workspace } = await open();
    // d1 through its criterion, d3 through the word in its text.
    const plain = await search(workspace, "RQJP");
    expect(tails(plain).sort()).toEqual(["d1", "d3"]);
    expect(located(hitOf(plain, "d1"))).toEqual({
      property: "acceptance-criteria",
      criterion: { criterion: 2, key: "rqjp", keyMarked: true },
      text: "Given a gust, then the alarm sounds.",
      marks: [],
    });
    expect(hitOf(plain, "d1").fields).toEqual(["properties"]);
    expect(hitOf(plain, "d1").terms).toEqual([]);
    expect(tails(await search(workspace, '"rqjp"')).sort()).toEqual(["d1", "d3"]);
    // `AK-rqjp` as a reference writes it: d3 has no word starting with "ak".
    expect(tails(await search(workspace, "ak-RQJP"))).toEqual(["d1"]);
    expect(tails(await search(workspace, '"AK-rqjp"'))).toEqual(["d1"]);
    // No typo, no word start, no part: the key is no word of the index.
    // "rqjq" finds d3 by a typo of its word "rqjp", not d1 by its key.
    expect(tails(await search(workspace, "rqjq"))).toEqual(["d3"]);
    expect(tails(await search(workspace, "rqj"))).toEqual(["d3"]);
    expect(tails(await search(workspace, "m4s"))).toEqual([]);
    // A key two requirements carry finds both; the other words must still match.
    expect(tails(await search(workspace, "k7f3")).sort()).toEqual(["d1", "d2"]);
    expect(tails(await search(workspace, "k7f3 rain"))).toEqual(["d2"]);
    // A key two criteria of one requirement carry is found in the first one.
    expect(located(hitOf(await search(workspace, "w1nd"), "d3"))).toMatchObject({
      criterion: { criterion: 1, key: "w1nd", keyMarked: true },
    });
  });

  it("[SR-222/AK-tdpp] ranks a key match by relevance and adds it to a word found in the same requirement", async () => {
    const { workspace } = await open({
      "requirements/SR-0000000000d4.md": requirement(
        "d4",
        "SR-039",
        ["  - key: rqjp", "    text: Given a gust, then the log names rqjp."],
        "No text.",
      ),
    });
    const out = await search(workspace, "rqjp");
    // d4: the key and the word; d1: the key; d3: the word in its text.
    expect(tails(out)[0]).toBe("d4");
    expect(hitOf(out, "d4").score).toBeGreaterThan(hitOf(out, "d1").score);
    expect(hitOf(out, "d1").score).toBeGreaterThan(0);
    expect(located(hitOf(out, "d4"))).toMatchObject({
      criterion: { criterion: 1, key: "rqjp" },
      marks: ["rqjp"],
    });
    // Two keys of one requirement: both are found in it.
    expect(tails(await search(workspace, "k7f3 rqjp"))).toEqual(["d1"]);
  });
});

describe("criterion references (SR-222 AK2)", () => {
  it("[SR-222/AK-ttpn] finds the requirement a criterion reference names, as an ID and in that criterion, in any case, with or without brackets and quotes", async () => {
    const { workspace } = await open();
    for (const query of ["[SR-036/AK-k7f3]", "sr-036/ak-K7F3", '"[SR-036/AK-k7f3]"', '"SR-036/AK-k7f3"']) {
      const out = await search(workspace, query);
      // d2 has the key k7f3 too, d3 names SR-036 but holds no "ak" or "k7f3": neither is found.
      expect(tails(out)).toEqual(["d1"]);
      expect(hitOf(out, "d1").fields).toEqual(["properties", "id"]);
      expect(located(hitOf(out, "d1"))).toEqual({
        property: "acceptance-criteria",
        criterion: { criterion: 1, key: "k7f3", keyMarked: true },
        text: "Given a calm day, then the alarm stays silent.",
        marks: [],
      });
    }
    // Twice, and within a selection without it.
    expect(tails(await search(workspace, "[SR-036/AK-k7f3] [SR-036/AK-k7f3]"))).toEqual(["d1"]);
    expect(tails(await search(workspace, "rqjp", { selection: { ids: [`${ID}d3`] } }))).toEqual(["d3"]);
    // By short ID too.
    expect(tails(await search(workspace, "[SR-0000d2/AK-k7f3]"))).toEqual(["d2"]);
  });

  it("[SR-222/AK-ttpn] still finds its words in other elements, after the requirement, and not in the requirement itself", async () => {
    const { workspace } = await open({
      // d1 quotes its own reference in the text, d4 quotes it too.
      "requirements/SR-0000000000d1.md": readFileSync(
        join(import.meta.dirname, "../../../../fixtures/SR-222/criteria/requirements/SR-0000000000d1.md"),
        "utf8",
      ).replace("The alarm logs every gust.", "The alarm logs every gust; a test names SR-036/AK-k7f3."),
      "requirements/SR-0000000000d4.md": requirement("d4", "SR-039", [], "The test SR-036/AK-k7f3 failed."),
    });
    const out = await search(workspace, "[SR-036/AK-k7f3]");
    expect(tails(out)).toEqual(["d1", "d4"]);
    // In d1 its words mark nothing: the snippet is the criterion, found by the key alone.
    expect(hitOf(out, "d1").terms).toEqual([]);
    expect(located(hitOf(out, "d1"))).toMatchObject({
      criterion: { criterion: 1, key: "k7f3", keyMarked: true },
    });
    expect(located(hitOf(out, "d4"))).toEqual({ field: "text", marks: ["SR", "036", "AK", "k7f3"] });
    // Only in title and text: the other element alone; only IDs: the requirement alone.
    expect(tails(await search(workspace, "[SR-036/AK-k7f3]", { fields: ["title", "text"] }))).toEqual(["d4"]);
    expect(tails(await search(workspace, '"[SR-036/AK-k7f3]"', { fields: ["text"] }))).toEqual(["d4"]);
    expect(tails(await search(workspace, "[SR-036/AK-k7f3]", { fields: ["id"] }))).toEqual(["d1"]);
  });

  it("[SR-222/AK-ttpn] comes first beside other words, which must still match", async () => {
    const { workspace } = await open();
    const out = await search(workspace, "gust [SR-036/AK-rqjp]");
    expect(tails(out)).toEqual(["d1"]);
    // The text holds "gust": the snippet is there, the words of the reference mark nothing.
    expect(located(hitOf(out, "d1"))).toEqual({ field: "text", marks: ["gust"] });
    expect(hitOf(out, "d1").terms).toEqual(["gust", "gusts"]);
    // Beside a word another element matches: the reference's requirement first.
    const two = await search(workspace, "[SR-036/AK-k7f3] alarm");
    expect(tails(two)).toEqual(["d1"]);
  });

  it("[SR-222/AK-ttpn] is taken from the query before other designations (SR-220): no run splits it", async () => {
    const { workspace } = await open({
      "requirements/SR-0000000000d4.md": requirement(
        "d4",
        "SR-039",
        [],
        "Acceptance criterion SR-036 k7f3 failed.",
      ),
      "requirements/SR-0000000000d5.md": requirement(
        "d5",
        "SR-040",
        [],
        "The AK test SR-036/AK-k7f3 failed.",
      ),
    });
    // Split by the synonym AK, d4 would be found through "Acceptance criterion".
    expect(tails(await search(workspace, "[SR-036/AK-k7f3]"))).toEqual(["d1", "d5"]);
    // A run beside it: the reference stays one word of the rest.
    expect(tails(await search(workspace, "AK [SR-036/AK-k7f3]"))).toEqual(["d5"]);
  });

  it("[SR-222/AK-ttpn] searches a reference that fits no requirement as words", async () => {
    const { workspace } = await open();
    // An unknown key, a key two criteria carry, a criterion by number, an unknown requirement.
    expect(tails(await search(workspace, "SR-036/AK-zzzz"))).toEqual([]);
    expect(tails(await search(workspace, "[SR-038/AK-w1nd]"))).toEqual([]);
    expect(tails(await search(workspace, "[SR-036/AK2]"))).toEqual([]);
    expect(tails(await search(workspace, "[SR-099/AK-k7f3]"))).toEqual([]);
    // Its words, where they stand: d3 holds "SR-036" and "key rqjp", no word starting with "ak".
    const words = await search(workspace, "SR-036/KEY-rqjp");
    expect(tails(words)).toEqual(["d3"]);
  });
});

describe("criterion keys and references in chosen fields (SR-216 AK1, AK2)", () => {
  it("[SR-216/AK-r9jg] finds the acceptance criteria property by its keys, and the IDs by a criterion reference", async () => {
    const { workspace } = await open();
    const criteria = { fields: ["acceptance-criteria"] };
    expect(tails(await search(workspace, "rqjp", criteria))).toEqual(["d1"]);
    expect(tails(await search(workspace, "rqjp", { fields: ["properties"] }))).toEqual(["d1"]);
    expect(tails(await search(workspace, "rqjp", { fields: ["title", "text"] }))).toEqual(["d3"]);
    // The reference: an ID match without a snippet with `id` alone.
    const ids = await search(workspace, "[SR-036/AK-rqjp]", { fields: ["id"] });
    expect(tails(ids)).toEqual(["d1"]);
    expect(hitOf(ids, "d1").fields).toEqual(["id"]);
    expect(hitOf(ids, "d1").snippet).toBeUndefined();
  });

  it("[SR-216/AK-wf2k] finds a key or reference only in chosen fields, and a reference is found in its criterion without IDs", async () => {
    const { workspace } = await open();
    const criteria = { fields: ["acceptance-criteria"] };
    const out = await search(workspace, "[SR-036/AK-rqjp]", criteria);
    expect(tails(out)).toEqual(["d1"]);
    expect(hitOf(out, "d1").fields).toEqual(["properties"]);
    expect(located(hitOf(out, "d1"))).toMatchObject({ criterion: { criterion: 2, key: "rqjp" } });
    // Neither IDs nor the criteria: only its words, which no element holds, in quotes too.
    expect(tails(await search(workspace, "[SR-036/AK-rqjp]", { fields: ["title", "text"] }))).toEqual([]);
    expect(tails(await search(workspace, '"[SR-036/AK-rqjp]"', { fields: ["title"] }))).toEqual([]);
    expect(tails(await search(workspace, "k7f3", { fields: ["rationale"] }))).toEqual([]);
  });
});

describe("the location of a hit in a criterion (SR-222 AK3)", () => {
  it("[SR-222/AK-h8py] names the number and key of the criterion, the number alone without key, and marks the key only where it was found", async () => {
    const { workspace } = await open();
    // A word in the criterion without key, at its place in the current version.
    expect(located(hitOf(await search(workspace, "repeats"), "d1"))).toEqual({
      property: "acceptance-criteria",
      criterion: { criterion: 3 },
      text: "Given a storm, then the alarm repeats.",
      marks: ["repeats"],
    });
    // A word in a criterion with key: number and key, the key not marked.
    expect(located(hitOf(await search(workspace, "rain"), "d2"))).toEqual({
      property: "acceptance-criteria",
      criterion: { criterion: 2, key: "k7f3" },
      text: "Given rain, then the mast stays dry.",
      marks: ["rain"],
    });
    // The key and a word of the same criterion: the word marked, not the key (only a key found alone).
    expect(located(hitOf(await search(workspace, "k7f3 rain"), "d2"))).toEqual({
      property: "acceptance-criteria",
      criterion: { criterion: 2, key: "k7f3" },
      text: "Given rain, then the mast stays dry.",
      marks: ["rain"],
    });
    // A property before the criteria in reading order still comes first (SR-174 AK3).
    expect(located(hitOf(await search(workspace, "storms"), "d2"))).toMatchObject({ property: "rationale" });
  });

  it("[SR-222/AK-h8py] shows the start of a Markdown criterion found by its key alone, without marks", async () => {
    const { fixture } = await open();
    const model = readFileSync(join(fixture.root, "metamodel/model.yaml"), "utf8");
    const { workspace } = await open({
      "metamodel/model.yaml": model.replace(
        "meaning: acceptance-criteria,",
        "meaning: acceptance-criteria,\n      markdown: true,",
      ),
      "requirements/SR-0000000000d4.md": requirement(
        "d4",
        "SR-039",
        [
          "  - key: qqqq",
          `    text: "Given a **gust** and [a link](https://example.com/x) ${"long words ".repeat(14)}end"`,
          "  - key: zzzz",
          '    text: "  "',
        ],
        "No text.",
      ),
    });
    const hit = hitOf(await search(workspace, "qqqq"), "d4");
    const snippet = located(hit) as { text: string; marks: unknown[] };
    expect(snippet).toMatchObject({ criterion: { criterion: 1, key: "qqqq", keyMarked: true }, marks: [] });
    expect(snippet.text.startsWith("Given a gust and a link long words")).toBe(true);
    expect(snippet.text.endsWith("…")).toBe(true);
    // A criterion without a visible character: found, but no snippet.
    const blank = hitOf(await search(workspace, "zzzz"), "d4");
    expect(blank.snippet).toBeUndefined();
  });
});

describe("criterion keys and references in filters (SR-222)", () => {
  it("[SR-222/AK-b63b] the condition text finds keys and references as the search does, a property condition and its values read the texts only", async () => {
    const { workspace } = await open();
    const listed = async (where: unknown): Promise<string[]> => {
      const out = (await invoke(
        "element.list",
        { selection: { where } },
        { workspace },
      )) as CommandOutput<"element.list">;
      return (out.elements ?? []).map((element) => element.id.slice(-2)).sort();
    };
    expect(await listed({ text: "rqjp" })).toEqual(["d1", "d3"]);
    expect(await listed({ text: "[SR-036/AK-k7f3]" })).toEqual(["d1"]);
    expect(await listed({ property: "acceptance-criteria", op: "contains", value: "rqjp" })).toEqual([]);
    expect(await listed({ property: "acceptance-criteria", op: "contains", value: "gust" })).toEqual(["d1"]);
    const facets = (await invoke(
      "element.facets",
      { selection: { where: { text: "k7f3" } } },
      { workspace },
    )) as CommandOutput<"element.facets">;
    expect(facets.total).toBe(2);
    // The selectable values of the criteria are their 7 texts, without the keys.
    const all = (await invoke("element.facets", {}, { workspace })) as CommandOutput<"element.facets">;
    const criteria = all.properties.find((property) => property.key === "acceptance-criteria");
    expect(criteria?.distinct).toBe(7);
    expect(JSON.stringify(criteria)).not.toMatch(/k7f3|rqjp|m4st|w1nd/u);
  });
});

describe("the criterion keys of a store", () => {
  it("reads keys and references of a query word", () => {
    expect(queryKeyOf(" AK-Rqjp ")).toBe("rqjp");
    expect(queryKeyOf("rqj")).toBeUndefined();
    expect(queryReferenceOf("[SR-036/AK-K7F3]")).toEqual({ ref: "sr-036", key: "k7f3" });
    expect(queryReferenceOf("[/AK-k7f3]")).toBeUndefined();
    expect(queryReferenceOf("[SR-036/AK2]")).toBeUndefined();
    expect(queryReferenceOf("SR-036")).toBeUndefined();
  });

  it("reads the keys of a record as element.get reads its criteria", async () => {
    const { workspace } = await open();
    const index = await searchIndex(workspace);
    const d1 = recordOf(index.store.elements, (record) => record.id === `${ID}d1`);
    const lists: unknown[] = [
      undefined,
      [],
      ["Given a."],
      [{ key: "abcd", text: "A" }, { text: "B" }, "C", { key: "abcd", text: "D" }],
      [
        { key: "ABCD", text: "A" },
        { key: 7, text: "B" },
      ],
      [{ key: "abcd", text: "A" }, 3],
      [{ key: "abcd", text: "A" }, null],
      [{ key: "abcd", text: "A" }, ["x"]],
      [{ key: "abcd", text: 1 }],
      [{ key: "abcd", text: "A", more: 1 }],
      [{ note: "x", text: "A" }],
    ];
    for (const list of lists) {
      const record = { ...d1, data: { ...d1.data, "acceptance-criteria": list } };
      const found = criterionKeysOf(index.metamodel, record.type, record.data);
      const expected = [...new Set(found?.keys.flatMap((key) => key ?? []) ?? [])];
      expect(recordKeys(index.metamodel, record), JSON.stringify(list)).toEqual(expected);
    }
    const term = recordOf(index.store.elements, (record) => record.type === "glossary-term");
    const withCriteria = {
      ...term,
      data: { ...term.data, "acceptance-criteria": [{ key: "abcd", text: "A" }] },
    };
    expect(recordKeys(index.metamodel, withCriteria)).toEqual([]);
  });

  it("finds nothing for a reference where no field is searched, with every word or any", async () => {
    const { workspace } = await open();
    const index = await searchIndex(workspace);
    for (const query of ["[SR-036/AK-k7f3]", '"[SR-036/AK-k7f3]"']) {
      expect(searchElements(index, query, { fields: [] }).total).toBe(0);
      expect(searchElements(index, `${query} gust`, { fields: [], combineWith: "or" }).total).toBe(0);
    }
  });

  it("carries the keys of changed records over a save, the others kept", async () => {
    const { workspace } = await open();
    const index = await searchIndex(workspace);
    const keyOf = (record: ElementRecord): string => `${record.repository}\0${record.file}`;
    const known = keyedRecords(index.store, index.metamodel, keyOf);
    const d1 = recordOf(index.store.elements, (record) => record.id === `${ID}d1`);
    const changed: ElementRecord = {
      ...d1,
      data: { ...d1.data, "acceptance-criteria": [{ key: "n3wk", text: "Given new." }] },
    };
    const d2 = recordOf(index.store.elements, (record) => record.id === `${ID}d2`);
    const carried = carryKeyed(known, index.metamodel, [d1, changed], [changed], keyOf);
    expect(carried.get("rqjp")).toBeUndefined();
    expect(carried.get("n3wk")).toEqual([keyOf(d1)]);
    expect(carried.get("k7f3")).toEqual([keyOf(d2)]);
    expect(carried.get("m4st")).toBe(known.get("m4st"));
  });
});

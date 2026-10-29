import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { Problem } from "../catalog.js";
import type { Metamodel } from "../metamodel/index.js";
import { metamodelState } from "../metamodel/index.js";
import { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { ElementRecord } from "./elements.js";
import { locateFindings } from "./locate.js";
import type { ElementStore } from "./store.js";
import { elementStoreState } from "./store.js";
import { valueFindings, valueKindFindings, valueKindProblemsState } from "./values.js";

const FIXTURE = "SR-085/value-kinds";

const GOOD = "ec020327-5719-456a-a708-af917a75882f";
const WRONG = "234ae95e-f9e5-4d31-9ab2-9b0f1826503d";
const SENSOR = "c0dcc639-0097-42b7-b926-b69e094ad34c";
const NEED = "3f1757ed-26d9-478e-8fdc-ea6fe2e123a9";
const WRONG_FILE = "requirements/SR-9b0f1826503d.md";
const SENSOR_FILE = "anemometer/SR-b69e094ad34c.md";
const TARGET = { id: NEED, version: "n1:9f86d081884c7d65", title: "Wind speed visible at a glance" };
const PRIORITIES = "one of low (Low), medium (Medium), high (High)";

interface Opened {
  readonly ws: FixtureWorkspace;
  readonly workspace: Workspace;
}

const open = async (files: Readonly<Record<string, string>> = {}): Promise<Opened> => {
  const ws = await createFixtureWorkspace({ fixture: FIXTURE, files });
  onTestFinished(() => ws.cleanup());
  const workspace = new Workspace(ws.path("system"));
  onTestFinished(() => workspace.close());
  return { ws, workspace };
};

const problemsOf = async (workspace: Workspace): Promise<readonly Problem[]> =>
  workspace.get(valueKindProblemsState);

const loaded = async (workspace: Workspace): Promise<{ store: ElementStore; metamodel: Metamodel }> => ({
  store: await workspace.get(elementStoreState),
  metamodel: await workspace.get(metamodelState),
});

const recordOf = (store: ElementStore, id: string): ElementRecord => {
  const record = store.byId.get(id)?.[0];
  if (record === undefined) {
    throw new Error(`no element ${id}`);
  }
  return record;
};

/** The element `id` of the fixture with other frontmatter values, without touching its file. */
const withData = (record: ElementRecord, data: Readonly<Record<string, unknown>>): ElementRecord => ({
  ...record,
  data: { id: record.id, type: record.type, status: "draft", ...data },
});

/** The messages of the findings of one element with other values, by key path. */
const messages = async (
  data: Readonly<Record<string, unknown>>,
): Promise<readonly (readonly [string, string])[]> => {
  const { workspace } = await open();
  const { store, metamodel } = await loaded(workspace);
  return valueFindings(withData(recordOf(store, GOOD), data), metamodel).map(
    (f) => [f.path.join("/"), f.problem.message] as const,
  );
};

const wrong = (line: number, message: string): Problem => ({
  code: "element.wrong-value-kind",
  severity: "warning",
  message,
  repository: "system",
  file: WRONG_FILE,
  line,
  elementId: WRONG,
});

const SENSOR_PROBLEM: Problem = {
  code: "element.wrong-value-kind",
  severity: "warning",
  message: `Property Priority (priority) expects ${PRIORITIES}; the value is the text "urgent"`,
  repository: "sensor",
  file: SENSOR_FILE,
  line: 6,
  elementId: SENSOR,
};

const FIXTURE_PROBLEMS: readonly Problem[] = [
  wrong(
    5,
    "Property Title (title) expects text; the value is the number 42; write it in quotes to keep it as text",
  ),
  wrong(6, 'Property Weight (weight) expects a number; the value is the text "heavy"'),
  wrong(7, 'Property Due date (due) expects a date YYYY-MM-DD; the value is the text "2026-02-30"'),
  wrong(
    9,
    'Property Parent item (parent-item) expects a relation target { id, version }; the value is the text "SR-af917a75882f"',
  ),
  SENSOR_PROBLEM,
];

describe("value kinds (SR-085)", () => {
  it("[SR-085/AK1] gives a hint for a value of the wrong kind for text, number, date, choice and relation", async () => {
    const { workspace } = await open();
    expect(await problemsOf(workspace)).toEqual(FIXTURE_PROBLEMS);
  });

  it("[SR-085/AK1] gives no hint when every value has the kind of its property", async () => {
    const { workspace } = await open();
    const problems = await problemsOf(workspace);
    expect(problems.filter((p) => p.elementId === GOOD || p.elementId === NEED)).toEqual([]);
    const { store, metamodel } = await loaded(workspace);
    expect(valueFindings(recordOf(store, GOOD), metamodel)).toEqual([]);
    expect(
      await messages({
        title: "",
        weight: -3,
        due: "2028-02-29",
        priority: "low",
        "parent-item": { id: NEED, version: "n1:9f86d081884c7d65", repository: "sensor" },
        platforms: ["windows"],
      }),
    ).toEqual([]);
  });

  it("[SR-085/AK1] does not check empty values, keys the metamodel does not know and the structural keys", async () => {
    expect(
      await messages({
        status: 7,
        weight: null,
        due: null,
        "review-dates": [],
        platforms: null,
        "derives-from": [],
        "customer-id": 815,
        notes: { any: "thing" },
      }),
    ).toEqual([]);
  });

  it("[SR-085/AK1] gives a hint for an infinite number, an impossible date and a value of another kind", async () => {
    expect(
      await messages({
        weight: Number.POSITIVE_INFINITY,
        due: "2026-13-01",
        priority: true,
        title: { text: "T" },
        "parent-item": { id: "SR-af917a75882f", version: "n1:9f86d081884c7d65" },
      }),
    ).toEqual([
      ["weight", "Property Weight (weight) expects a number; the value is the number Infinity"],
      ["due", 'Property Due date (due) expects a date YYYY-MM-DD; the value is the text "2026-13-01"'],
      ["priority", `Property Priority (priority) expects ${PRIORITIES}; the value is the boolean true`],
      ["title", "Property Title (title) expects text; the value is a mapping"],
      [
        "parent-item",
        "Property Parent item (parent-item) expects a relation target { id, version }; the value is a mapping whose id is no UUID",
      ],
    ]);
  });

  it("[SR-085/AK1] tells how to keep a number or boolean in a text property as text", async () => {
    expect(await messages({ title: true, "acceptance-criteria": ["Given, when, then.", 1] })).toEqual([
      [
        "title",
        "Property Title (title) expects text; the value is the boolean true; write it in quotes to keep it as text",
      ],
      [
        "acceptance-criteria/1",
        "Property Acceptance Criteria (acceptance-criteria) expects each item to be text; item 2 is the number 1; write it in quotes to keep it as text",
      ],
    ]);
  });

  it("[SR-085/AK1] checks a property by its key whatever the type of the element", async () => {
    const { workspace } = await open({
      "system/requirements/N-ea6fe2e123a9.md": `---\nid: ${NEED}\ntype: need\nstatus: draft\ntitle: Wind\nweight: heavy\n---\n`,
    });
    expect((await problemsOf(workspace)).filter((p) => p.elementId === NEED)).toEqual([
      {
        code: "element.wrong-value-kind",
        severity: "warning",
        message: 'Property Weight (weight) expects a number; the value is the text "heavy"',
        repository: "system",
        file: "requirements/N-ea6fe2e123a9.md",
        line: 6,
        elementId: NEED,
      },
    ]);
  });

  it("[SR-085/AK1] shows at most 40 characters of a text of the wrong kind", async () => {
    const long = "about two and a half kilograms with the mount";
    expect(await messages({ weight: long })).toEqual([
      [
        "weight",
        `Property Weight (weight) expects a number; the value is the text "${long.slice(0, 40)}..."`,
      ],
    ]);
  });

  it("[SR-085/AK1] checks every item of a list property and wants a list where the metamodel says so", async () => {
    expect(
      await messages({
        "review-dates": ["2026-01-01", 20260101, null],
        "acceptance-criteria": "Given, when, then.",
        weight: [1, 2],
        platforms: ["linux", "macos", ["windows"]],
      }),
    ).toEqual([
      [
        "review-dates/1",
        "Property Review dates (review-dates) expects each item to be a date YYYY-MM-DD; item 2 is the number 20260101",
      ],
      [
        "review-dates/2",
        "Property Review dates (review-dates) expects each item to be a date YYYY-MM-DD; item 3 is empty",
      ],
      [
        "acceptance-criteria",
        'Property Acceptance Criteria (acceptance-criteria) expects a list, each item text; the value is the text "Given, when, then."',
      ],
      ["weight", "Property Weight (weight) expects a number, not a list"],
      [
        "platforms/1",
        'Property Platforms (platforms) expects each item to be one of linux (Linux), windows (Windows); item 2 is the text "macos"',
      ],
      [
        "platforms/2",
        "Property Platforms (platforms) expects each item to be one of linux (Linux), windows (Windows); item 3 is a list",
      ],
    ]);
  });

  it("[SR-085/AK1] checks that a relation kind holds a list of relation targets", async () => {
    expect(await messages({ "derives-from": [TARGET, { id: NEED }, "N-ea6fe2e123a9"] })).toEqual([
      [
        "derives-from/1",
        "Relation Derives from (derives-from) expects each item to be a relation target { id, version }; item 2 is a mapping without version",
      ],
      [
        "derives-from/2",
        'Relation Derives from (derives-from) expects each item to be a relation target { id, version }; item 3 is the text "N-ea6fe2e123a9"',
      ],
    ]);
    expect(await messages({ "derives-from": TARGET })).toEqual([
      [
        "derives-from",
        "Relation Derives from (derives-from) expects a list, each item a relation target { id, version }; the value is a mapping",
      ],
    ]);
  });

  it("[SR-085/AK1] names what a mapping that is no relation target lacks or has too much (#302)", async () => {
    const { id, version } = TARGET;
    const expects =
      "Relation Derives from (derives-from) expects each item to be a relation target { id, version }";
    expect(
      await messages({
        "derives-from": [
          { id, title: "Migrated" },
          { id, version: "2026-01-01" },
          { version },
          { id: 815, version },
          { id, version, note: "x" },
          { id, version, title: 1 },
          { id, version, repository: ["sensor"] },
          { id, version, title: "T", repository: "sensor" },
        ],
      }),
    ).toEqual([
      ["derives-from/0", `${expects}; item 1 is a mapping without version`],
      [
        "derives-from/1",
        `${expects}; item 2 is a mapping whose version is the text "2026-01-01", not a version like n1:9f86d081884c7d65`,
      ],
      ["derives-from/2", `${expects}; item 3 is a mapping without id`],
      ["derives-from/3", `${expects}; item 4 is a mapping whose id is no UUID`],
      [
        "derives-from/4",
        `${expects}; item 5 is a mapping with the key note, which a relation target does not have`,
      ],
      ["derives-from/5", `${expects}; item 6 is a mapping whose title is no text`],
      ["derives-from/6", `${expects}; item 7 is a mapping whose repository is no text`],
      [
        "derives-from/7",
        `${expects}; item 8 is a mapping with both title and repository; a target in another repository has no title`,
      ],
    ]);
  });

  it("[SR-085/AK1] says when a choice property has no values to choose from", async () => {
    expect(await messages({ "legacy-class": "a" })).toEqual([
      [
        "legacy-class",
        'Property Legacy class (legacy-class) expects a choice value, but the metamodel defines none; the value is the text "a"',
      ],
    ]);
  });

  it("[SR-085/AK2] lists at most 20 allowed values of a choice", async () => {
    const { workspace } = await open();
    const { store, metamodel } = await loaded(workspace);
    const choices = Array.from({ length: 21 }, (_, i) => ({
      key: `r${String(i + 1)}`,
      name: `R${String(i + 1)}`,
    }));
    const wide: Metamodel = {
      ...metamodel,
      properties: [...metamodel.properties, { key: "region", name: "Region", kind: "choice", choices }],
    };
    const [found] = valueFindings(withData(recordOf(store, GOOD), { region: "r22" }), wide);
    const listed = choices.slice(0, 20).map((c) => `${c.key} (${c.name})`);
    expect(found?.problem.message).toBe(
      `Property Region (region) expects one of ${listed.join(", ")}, …; the value is the text "r22"`,
    );
  });

  it("[SR-085/AK1] gives the findings of one element for a command that has just written it", async () => {
    const { workspace } = await open();
    const { store, metamodel } = await loaded(workspace);
    const element = recordOf(store, WRONG);
    const findings = valueFindings(element, metamodel);
    expect(findings.map((f) => f.path)).toEqual([["title"], ["weight"], ["due"], ["parent-item"]]);
    expect(findings.every((f) => f.element === element && f.problem.line === undefined)).toBe(true);
    expect(await locateFindings(await workspace.get(workspaceLayoutState), findings)).toEqual(
      FIXTURE_PROBLEMS.slice(0, 4),
    );
  });

  it("[SR-085/AK3] stops reading files for the lines when the caller aborts", async () => {
    const { workspace } = await open();
    const { store, metamodel } = await loaded(workspace);
    const reason = new Error("stopped");
    const signal = AbortSignal.abort(reason);
    await expect(
      locateFindings(await workspace.get(workspaceLayoutState), valueKindFindings(store, metamodel), {
        signal,
      }),
    ).rejects.toBe(reason);
  });

  it("[SR-085/AK2] names the allowed values when a choice value in the file is not one of them", async () => {
    const { workspace } = await open();
    const problems = await problemsOf(workspace);
    expect(problems.filter((p) => p.elementId === SENSOR)).toEqual([SENSOR_PROBLEM]);
    for (const value of ["low", "medium", "high"]) {
      expect(SENSOR_PROBLEM.message).toContain(value);
    }
  });

  it("[SR-085/AK3] reports every wrong value of all repositories as a finding with file, line and element", async () => {
    const { workspace } = await open({
      "sensor/anemometer/SR-b69e094ad34c.md": [
        "---",
        `id: ${SENSOR}`,
        "type: system-requirement",
        "status: draft",
        "title: Measure wind speed",
        "priority: urgent",
        "platforms:",
        "  - linux",
        "  - macos",
        "---",
        "",
      ].join("\n"),
    });
    expect(await problemsOf(workspace)).toEqual([
      ...FIXTURE_PROBLEMS.slice(0, 4),
      SENSOR_PROBLEM,
      {
        ...SENSOR_PROBLEM,
        line: 9,
        message:
          'Property Platforms (platforms) expects each item to be one of linux (Linux), windows (Windows); item 2 is the text "macos"',
      },
    ]);
  });

  it("[SR-085/AK3] checks the values again after the element store is read again", async () => {
    const { ws, workspace } = await open();
    expect(await problemsOf(workspace)).toHaveLength(5);
    await ws.write(
      `sensor/${SENSOR_FILE}`,
      `---\nid: ${SENSOR}\ntype: system-requirement\nstatus: draft\ntitle: Measure wind speed\npriority: low\n---\n`,
    );
    expect(await problemsOf(workspace)).toHaveLength(5);
    await workspace.reset(elementStoreState);
    expect(await problemsOf(workspace)).toEqual(FIXTURE_PROBLEMS.slice(0, 4));
  });

  it("[SR-085/AK3] leaves the line out when the file changed or vanished since it was read", async () => {
    const { ws, workspace } = await open();
    await workspace.get(elementStoreState);
    await ws.write(`system/${WRONG_FILE}`, "---\nid: x\n---\n");
    await fs.rm(ws.path(`sensor/${SENSOR_FILE}`));
    const withoutLine = FIXTURE_PROBLEMS.map(({ line: _line, ...rest }) => rest);
    expect(await problemsOf(workspace)).toEqual(withoutLine);
  });

  it("[SR-085/AK3] leaves the line out for a key written as an alias and for a repository the layout does not have", async () => {
    const { workspace } = await open({
      "system/requirements/SR-9b0f1826503d.md": `---\nid: ${WRONG}\ntype: system-requirement\nstatus: draft\nname: &k weight\n*k : heavy\n---\n`,
    });
    const problems = await problemsOf(workspace);
    expect(problems.filter((p) => p.elementId === WRONG)).toEqual([
      {
        code: "element.wrong-value-kind",
        severity: "warning",
        message: 'Property Weight (weight) expects a number; the value is the text "heavy"',
        repository: "system",
        file: WRONG_FILE,
        elementId: WRONG,
      },
    ]);
    const { store, metamodel } = await loaded(workspace);
    const elsewhere = { ...recordOf(store, SENSOR), repository: "elsewhere" };
    const located = await locateFindings(
      await workspace.get(workspaceLayoutState),
      valueFindings(elsewhere, metamodel),
    );
    const { line: _line, ...unlocated } = SENSOR_PROBLEM;
    expect(located).toEqual([{ ...unlocated, repository: "elsewhere" }]);
  });

  it("checks 50,000 elements in one pass within the time budget (N-036)", async () => {
    const { workspace } = await open();
    const { store, metamodel } = await loaded(workspace);
    const good = recordOf(store, GOOD);
    const elements = Array.from({ length: 50_000 }, (_, i) =>
      i % 100 === 0 ? withData(good, { ...good.data, weight: "heavy" }) : good,
    );
    const big: ElementStore = { elements, byId: new Map(), nonElements: [], problems: [] };
    const started = performance.now();
    const findings = valueKindFindings(big, metamodel);
    expect(performance.now() - started).toBeLessThan(5000);
    expect(findings).toHaveLength(500);
  });
});

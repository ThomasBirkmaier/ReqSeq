import { describe, expect, it } from "vitest";
import type { FilterStep } from "./buffers.js";
import {
  answerOf,
  LIST_KEY,
  outputList,
  outputSelectionList,
  ownSteps,
  selectionOf,
  withQuery,
} from "./buffers.js";
import { answerField, elementKey, outputParts, relabelled } from "./output-list.js";
import type { OutputField } from "./result.js";
import { resultLines } from "./result.js";
import { linesOf } from "./result-copy.js";
import { selectionInView, withView } from "./views.js";

const textFilterStepForTest: FilterStep = {
  label: "text: storm",
  selection: { where: { text: "storm" } },
};

const AFFECTED = { command: "trace.affected", input: { ref: "SR-1" } };

const AFFECTED_FIELDS: OutputField[] = [
  { path: "answer", title: "Answer" },
  { path: "affected", title: "Affected elements", elements: "answer" },
  { path: "affected[].id", title: "Element", technical: true },
  { path: "affected[].distance", title: "Distance" },
  { path: "affected[].file", title: "File", technical: true },
  { path: "records", title: "Records of older versions" },
  { path: "records[].item", title: "Item under test" },
  { path: "total", title: "Total", elements: ["affected"] },
] as OutputField[];

const affectedOutput = {
  answer: "2 elements are affected by a change of SR-1.",
  affected: [
    {
      id: "u-2",
      repository: "system",
      shortId: "SR-2",
      title: "Gusts",
      type: "sr",
      distance: 1,
      file: "a.md",
    },
    { id: "u-2", repository: "sensor", shortId: "SR-2", title: "Gusts", type: "sr", distance: 2 },
    { id: "u-2", repository: "sensor", shortId: "SR-2", title: "Gusts copy", distance: 3 },
    { id: "u-3", repository: "system", shortId: "SR-3", title: "Bare" },
    "not an element",
  ],
  records: [{ item: "build-1" }],
  total: 2,
};

describe("a list from the output of a command", () => {
  it("[SR-223/AK-qwkc] lists the answer of an output under its answer: one fixed step with selection.output, a buffer of its own", () => {
    const list = outputSelectionList("2 elements are affected.", AFFECTED);
    expect(list.label).toBe("2 elements are affected.");
    expect(list.steps).toEqual([
      { label: "2 elements are affected.", selection: { output: AFFECTED }, output: true },
    ]);
    expect(list.selection).toEqual({ output: AFFECTED });
    expect(list.key).toBe(`list:output:${JSON.stringify(AFFECTED)}`);
    expect(answerOf(list)).toEqual(AFFECTED);
    // A further step adds to it and keeps the buffer; "Clear all list filters" never takes the output back.
    const filtered = withQuery({ ...list, details: true }, { steps: [...list.steps, textFilterStepForTest] });
    expect(filtered.key).toBe(list.key);
    expect(filtered.details).toBe(true);
    expect(filtered.selection).toEqual({ output: AFFECTED, where: textFilterStepForTest.selection.where });
    expect(ownSteps(filtered.steps)).toBe(1);
    expect(withQuery(list, { sort: [] }).details).toBeUndefined();
    // The list of a number is no list of an answer; a list by UUIDs keeps the one list buffer.
    const counted = outputSelectionList("Open", { ...AFFECTED, count: { field: "total" } });
    expect(answerOf(counted)).toBeUndefined();
    expect(outputList("Unknown property", ["u-1"]).key).toBe(LIST_KEY);
    // A list by UUIDs from an output keeps its step too: "Clear all list filters" never takes it back.
    expect(ownSteps(outputList("Unknown property", ["u-1"]).steps)).toBe(0);
    expect(selectionOf([])).toBeUndefined();
  });

  it("[SR-223/AK-zc7t] runs the command of selection.output in the view of the window, as the number was counted", () => {
    const output = { command: "evidence.degree", input: {}, count: { field: "degree.counts.open" } };
    expect(selectionInView({ output }, "core")).toEqual({
      view: "core",
      output: { ...output, input: { selection: { view: "core" } } },
    });
    expect(withView("element.list", { selection: { output } }, "v-1")).toEqual({
      selection: { view: "v-1", output: { ...output, input: { selection: { view: "v-1" } } } },
    });
    // An inner input that names another view keeps it, and the selection holds in that view: its number was counted
    // there, and core refuses another view.
    const inVariant = { ...output, input: { selection: { view: "v-1" } } };
    expect(selectionInView({ output: inVariant }, "core")).toEqual({ view: "v-1", output: inVariant });
    const chain = { command: "evidence.withoutPassedTest", input: { view: "v-2" } };
    expect(selectionInView({ output: chain }, "core")).toEqual({ view: "v-2", output: chain });
    // A command without a view: the selection holds in the window's view.
    const affected = { command: "trace.affected", input: { ref: "SR-1" } };
    expect(selectionInView({ output: affected }, "core")).toEqual({ view: "core", output: affected });
    // An output that is no command call, and a selection that names a view or ids, stay as they are.
    expect(selectionInView({ output: "x" }, "core")).toEqual({ output: "x", view: "core" });
    expect(selectionInView({ output, view: "v-2" }, "core")).toEqual({ output, view: "v-2" });
  });

  it("[SR-223/AK-qwkc] shows the rest of the output above the rows and, with Show details, the values per element", () => {
    const list = outputSelectionList(affectedOutput.answer, AFFECTED);
    expect(answerField(AFFECTED_FIELDS)).toBe("affected");
    expect(answerField([{ path: "elements[].x", elements: "answer" }])).toBeUndefined();
    const plain = outputParts(list, affectedOutput, AFFECTED_FIELDS, false);
    // SR-024 AK4: the records stand above the list, under their title; the answer and its elements do not.
    expect(plain.lines.map((line) => [line.label, line.text])).toEqual([
      ["Records of older versions", "1"],
      ["Item under test", "build-1"],
    ]);
    expect(plain.details.size).toBe(0);
    const shown = outputParts(list, affectedOutput, AFFECTED_FIELDS, true);
    const at = (repository: string) =>
      shown.details.get(elementKey({ id: "u-2", repository }))?.map((line) => [line.label, line.text]);
    // Each copy of a UUID in its own repository (SR-088); the row's own fields are not repeated.
    expect(at("system")).toEqual([
      ["Distance", "1"],
      ["File", "a.md"],
    ]);
    expect(at("sensor")).toEqual([["Distance", "2"]]);
    expect(shown.details.has(elementKey({ id: "u-3", repository: "system" }))).toBe(false);
    // A row that names its file finds the values of that copy.
    expect(
      shown.details
        .get(elementKey({ id: "u-2", repository: "system", file: "a.md" }))
        ?.map((line) => line.text),
    ).toEqual(["1", "a.md"]);
    // Another list, an output without the field of its answer, or of another shape: nothing.
    expect(outputParts(outputList("x", ["u-1"]), affectedOutput, AFFECTED_FIELDS, true).lines).toEqual([]);
    expect(outputParts(list, affectedOutput, [], true).lines).toEqual([]);
    expect(outputParts(list, "text", AFFECTED_FIELDS, true).lines).toEqual([]);
    expect(outputParts(list, { answer: "a" }, AFFECTED_FIELDS, true).details.size).toBe(0);
  });
});

describe("the numbers of elements of an output", () => {
  const DEGREE: OutputField[] = [
    { path: "degree", title: "Verification degree" },
    { path: "degree.total", title: "Requirements", elements: "selection" },
    { path: "degree.share", title: "Share" },
  ] as OutputField[];
  const origin = { command: "evidence.degree", input: { selection: {} }, name: "Show verification degree" };

  it("[SR-223/AK-zc7t] each number of elements is a line that opens the list of what selection.output counts", () => {
    const lines = resultLines({ degree: { total: 5, share: 0.5 } }, DEGREE, false, [], origin);
    const total = lines.find((line) => line.label === "Requirements");
    expect(total?.list?.steps).toEqual([
      {
        label: "Show verification degree · Requirements",
        selection: {
          output: { command: "evidence.degree", input: { selection: {} }, count: { field: "degree.total" } },
        },
        output: true,
      },
    ]);
    expect(lines.find((line) => line.label === "Share")?.list).toBeUndefined();
    // Without the call, and through the buffer's lines, as the page shows them.
    expect(resultLines({ degree: { total: 5 } }, DEGREE).some((line) => line.list !== undefined)).toBe(false);
    const page = linesOf(
      { command: "evidence.degree", input: {}, name: "Degree", output: { degree: { total: 5 } } },
      DEGREE,
    );
    expect(page.find((line) => line.label === "Requirements")?.list?.label).toBe("Degree · Requirements");
    expect(
      linesOf({ command: "evidence.degree", input: {}, output: { degree: { total: 5 } } }, DEGREE)[1]?.list
        ?.label,
    ).toBe("evidence.degree · Requirements");
  });

  it("[SR-223/AK-zc7t] a number in a list is keyed by the fields of its entry and named by those that are not technical", () => {
    const fields = [
      { path: "levels", title: "Levels" },
      { path: "levels[].type", title: "Type" },
      { path: "levels[].id", title: "Element", technical: true },
      {
        path: "levels[].total",
        title: "Total",
        elements: ["levels[].elements"],
        keys: [["type", "id", "gone"]],
      },
    ] as OutputField[];
    const lines = resultLines({ levels: [{ type: "need", id: "u-9", total: 3 }] }, fields, false, [], {
      command: "evidence.coverage",
      input: {},
      name: "Coverage",
    });
    const total = lines.find((line) => line.label === "Total");
    expect(total?.list?.label).toBe("Coverage · need · Total");
    expect(total?.list?.selection).toEqual({
      output: {
        command: "evidence.coverage",
        input: {},
        count: { field: "levels[].total", key: [{ type: "need", id: "u-9" }] },
      },
    });
    // A number whose lists the walk does not stand in as the catalog says opens nothing.
    const flat = resultLines({ total: 3 }, [{ ...fields[3], path: "total" }], false, [], {
      command: "x",
      input: {},
      name: "X",
    });
    expect(flat.some((line) => line.list !== undefined)).toBe(false);
  });

  it("[SR-223/AK-zc7t] a number of a write command opens the elements its output names, by UUID", () => {
    const fields = [
      { path: "versionsChanged", title: "Versions changed", elements: ["versionsChangedElements"] },
      { path: "missing", title: "Missing", elements: ["missingElements"] },
      { path: "versionsChangedElements", title: "Elements", elements: true },
    ] as OutputField[];
    const written = { command: "metamodel.addType", input: {}, name: "Add type", written: true };
    const lines = resultLines(
      { versionsChanged: 2, missing: 0, versionsChangedElements: [{ id: "u-1" }, "u-2", { id: 3 }] },
      fields,
      false,
      [],
      written,
    );
    expect(lines.find((line) => line.label === "Versions changed")?.list?.selection).toEqual({
      where: { property: "id", op: "in", value: ["u-1", "u-2"] },
    });
    // No elements named: no list.
    expect(lines.find((line) => line.label === "Missing")?.list).toBeUndefined();
    const nested = resultLines(
      { groups: [{ count: 1, ids: ["u-7"] }] },
      [
        { path: "groups[].count", title: "Count", elements: ["groups[].ids"], keys: [[]] },
        { path: "groups[].ids", title: "IDs", elements: true },
      ] as OutputField[],
      false,
      [],
      written,
    );
    expect(nested.find((line) => line.label === "Count")?.list?.selection).toEqual({
      where: { property: "id", op: "in", value: ["u-7"] },
    });
  });
});

describe("the answer of a list from an output", () => {
  it("[SR-223/AK-qwkc] follows the output read last: its first step and its name say the answer as it is now", () => {
    const list = { ...outputSelectionList("2 elements are affected.", AFFECTED), cursor: 1 };
    const filtered = withQuery(list, { steps: [...list.steps, textFilterStepForTest] });
    const next = relabelled(filtered, { answer: "3 elements are affected." });
    expect(next?.steps[0]?.label).toBe("3 elements are affected.");
    expect(next?.label).toBe("3 elements are affected. · text: storm");
    expect(next?.key).toBe(list.key);
    expect(next?.selection).toEqual(filtered.selection);
    // The same answer, none, or another list: nothing to change.
    expect(relabelled(list, { answer: "2 elements are affected." })).toBeUndefined();
    expect(relabelled(list, { answer: 2 })).toBeUndefined();
    expect(relabelled(list, "x")).toBeUndefined();
    expect(relabelled(outputList("x", ["u-1"]), { answer: "y" })).toBeUndefined();
  });
});

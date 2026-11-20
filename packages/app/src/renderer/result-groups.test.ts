// @vitest-environment happy-dom
import { act, createElement, useReducer } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Buffer, ResultBuffer } from "./buffers.js";
import { resultBuffer, selectionOf } from "./buffers.js";
import type { Call } from "./call.js";
import type { OutputField, ResultLine } from "./result.js";
import { groupKey, resultLines } from "./result.js";
import { ResultView } from "./ResultView.js";
import type { WindowAction } from "./window-layout.js";
import { ONE_AREA, reduceWindow } from "./window-layout.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const outdated = (n: number) => ({
  code: "relation.outdated",
  severity: "warning",
  message: `The target of ${String(n)} changed`,
  elementId: `uuid-${String(n)}`,
  elementShortId: `SR-00000${String(n)}`,
  repository: "spec",
});

const yaml = (line: number) => ({
  code: "file.invalid-yaml",
  severity: "error",
  message: "Bad YAML",
  file: "requirements/a.md",
  line,
  repository: "spec",
});

const output = {
  answer: "Checked 4 elements and found 1 error and 3 warnings.",
  problems: [outdated(1), yaml(3), outdated(2), outdated(1), yaml(9)],
  checked: 4,
};

const FIELDS: readonly OutputField[] = [
  { path: "problems[].code", title: "Problem kind", technical: true },
  { path: "problems[].elementId", title: "Element", technical: true },
  { path: "problems[].file", title: "File", technical: "with-element" },
  { path: "problems[].line", title: "Line", technical: "with-element" },
];

const shown = (lines: readonly ResultLine[]): string[] =>
  lines.map(
    (line) =>
      `${"  ".repeat(line.depth)}${line.kind}|${line.label}|${line.text}${line.status === undefined ? "" : `|${line.status}`}`,
  );

const OUTDATED = groupKey(outdated(1));
const YAML = groupKey(yaml(1));

describe("the groups of problems of one kind (SR-223 AK3)", () => {
  it("[SR-223/AK-d895] shows several problems of one kind folded as one line with the title of their kind and their count", () => {
    expect(shown(resultLines(output, FIELDS))).toEqual([
      "heading||Errors",
      "group||YAML that cannot be parsed|2",
      "heading||Warnings",
      "group||Outdated relation|3",
      "text|checked|4",
    ]);
  });

  it("opens a group to its problems, each with its element and reason, or its file and line without element", () => {
    const lines = resultLines(output, FIELDS, false, [OUTDATED, YAML]);
    expect(shown(lines)).toEqual([
      "heading||Errors",
      "group||YAML that cannot be parsed|2",
      "  problem|requirements/a.md:3|Bad YAML",
      "  problem|requirements/a.md:9|Bad YAML",
      "heading||Warnings",
      "group||Outdated relation|3",
      "  problem|SR-000001|The target of 1 changed",
      "  problem|SR-000002|The target of 2 changed",
      "  problem|SR-000001|The target of 1 changed",
      "text|checked|4",
    ]);
    expect(lines.filter((line) => line.kind === "group").map((line) => line.unfolded)).toEqual([true, true]);
    // Each line of a group names it, so that Left closes it from there.
    expect(lines.filter((line) => line.kind === "problem").map((line) => line.group)).toEqual([
      YAML,
      YAML,
      OUTDATED,
      OUTDATED,
      OUTDATED,
    ]);
  });

  it("opens the list of the elements of a group, each once; a group without elements has none", () => {
    const lines = resultLines(output, FIELDS);
    const [errors, warnings] = lines.filter((line) => line.kind === "group");
    expect(errors?.list).toBeUndefined();
    expect(warnings?.list?.label).toBe("Outdated relation");
    // By the frontmatter key `id`, which takes every copy of a UUID (SR-088), not by `ids` (`ref.ambiguous`).
    const where = { property: "id", op: "in", value: ["uuid-1", "uuid-2"] };
    expect(warnings?.list?.selection).toEqual({ where });
    expect(warnings?.list?.steps).toEqual([
      { label: "Outdated relation", selection: { where }, output: true },
    ]);
    // A filter added to that list keeps its elements.
    const step = warnings?.list?.steps[0];
    expect(
      step === undefined
        ? undefined
        : selectionOf([step, { label: "x", selection: { where: { status: ["draft"] } } }]),
    ).toEqual({ where: { all: [where, { status: ["draft"] }] } });
  });

  it("shows the kind of a group, which is technical, only with Show details, and not again at its problems", () => {
    const lines = resultLines(output, FIELDS, true, [OUTDATED]);
    const at = lines.findIndex((line) => line.group === OUTDATED);
    expect(shown(lines.slice(at, at + 4))).toEqual([
      "group||Outdated relation|3",
      "  text|Problem kind|relation.outdated",
      "  problem|SR-000001|The target of 1 changed",
      "    text|Element|uuid-1",
    ]);
    expect(lines[at + 1]?.detail).toBe(true);
    expect(lines.filter((line) => line.kind === "problem").every((line) => line.status === undefined)).toBe(
      true,
    );
    // Without the catalog, the kind stands under its field name.
    expect(resultLines(output, [], true).find((line) => line.text === "relation.outdated")?.label).toBe(
      "code",
    );
  });

  it("[SR-223/AK-d895] shows a count per kind with the title of its kind, as the group line of that kind shows its count", () => {
    const counts = {
      hints: [outdated(1), outdated(2)],
      hintKinds: [
        { code: "relation.outdated", count: 2 },
        { code: "file.invalid-yaml", count: 1 },
      ],
    };
    const fields: readonly OutputField[] = [
      { path: "hints[].code", title: "Problem kind", technical: true },
      { path: "hintKinds", title: "Hints per kind" },
      { path: "hintKinds[].code", title: "Problem kind", technical: true },
      { path: "hintKinds[].count", title: "Hints" },
    ];
    const lines = resultLines(counts, fields);
    expect(shown(lines)).toEqual([
      "heading||Warnings",
      "group||Outdated relation|2",
      "text|Hints per kind|2",
      "  text||Outdated relation|2",
      "  text||YAML that cannot be parsed|1",
    ]);
    expect(lines.slice(-2).map((line) => line.field)).toEqual(["hintKinds[].count", "hintKinds[].count"]);
    // Its kind, technical, follows only with Show details.
    expect(shown(resultLines(counts, fields, true)).slice(-4)).toEqual([
      "  text||Outdated relation|2",
      "    text|Problem kind|relation.outdated",
      "  text||YAML that cannot be parsed|1",
      "    text|Problem kind|file.invalid-yaml",
    ]);
  });

  it("puts several values about one kind under its title, and keeps a code that is no kind an outline", () => {
    const output = {
      kinds: [
        { code: "relation.outdated", count: 2, open: 1 },
        { code: "x.unknown", count: 3 },
      ],
    };
    const lines = resultLines(output, [{ path: "kinds[].count", title: "Hints" }]);
    expect(shown(lines)).toEqual([
      "text|kinds|2",
      "  text|Outdated relation|",
      "    text|Hints|2",
      "    text|open|1",
      "  text|code|x.unknown",
      "  text|Hints|3",
    ]);
    expect(lines[1]?.itemStart).toBe(true);
  });

  it("heads a group of a kind without a title by its code, and keeps a single problem a line of its own", () => {
    const unknown = { code: "x.unknown", severity: "info", message: "Hm" };
    expect(shown(resultLines({ problems: [unknown, unknown, outdated(1)] }, FIELDS))).toEqual([
      "heading||Warnings",
      "problem|SR-000001|The target of 1 changed",
      "heading||Info",
      "group||x.unknown|2",
    ]);
  });
});

describe("the test cases of an output (SR-223 AK4)", () => {
  it("shows a test case of any output with its executions as runs, the variants by their titles", () => {
    const run = (variant?: string) => ({
      element: "uuid-1",
      version: "n1:1111111111111111",
      kind: "verification",
      method: "test",
      result: "passed",
      date: "2026-11-19T09:36:34Z",
      item: "build-1",
      ...(variant === undefined ? {} : { variant }),
    });
    const lines = resultLines({
      testCases: [
        { name: "test_speed", elements: ["uuid-1"], executed: true, executions: [run(), run("uuid-v")] },
      ],
      names: [{ id: "uuid-v", repository: "spec", shortId: "VAR-1", title: "Linux" }],
    });
    expect(shown(lines)).toEqual([
      "text|testCases|1",
      "  text|test case|test_speed",
      "    text||2026-11-19T09:36:34Z · passed · Core, Linux",
    ]);
  });
});

describe("the group lines of the output page (SR-223 AK3)", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const press = async (key: string, init: KeyboardEventInit = {}): Promise<KeyboardEvent> => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    await act(async () => {
      container.querySelector("[data-buffer]")?.dispatchEvent(event);
      await Promise.resolve();
    });
    return event;
  };

  const mount = async (initial: Buffer): Promise<{ actions: WindowAction[]; buffer: () => ResultBuffer }> => {
    const actions: WindowAction[] = [];
    let current: ResultBuffer | undefined;
    // One call for every render, as the window gives it: another one would ask again (a new view).
    const call = vi.fn<Call>();
    const Harness = (): React.ReactElement => {
      const [state, dispatch] = useReducer(reduceWindow, { buffers: [initial], layout: ONE_AREA });
      const [first] = state.buffers;
      current = first?.kind === "result" ? first : current;
      return first?.kind === "result"
        ? createElement(ResultView, {
            call,
            buffer: first,
            revision: 1,
            dispatch: (action: WindowAction) => {
              actions.push(action);
              dispatch(action);
            },
            onData: () => undefined,
            onEcho: () => undefined,
            fields: FIELDS,
          })
        : createElement("p", {}, "elsewhere");
    };
    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
    });
    return {
      actions,
      buffer: () => {
        if (current === undefined) {
          throw new Error("no result buffer");
        }
        return current;
      },
    };
  };

  const texts = (): string[] => [...container.querySelectorAll(".line")].map((line) => line.textContent);
  const groups = (): Element[] => [...container.querySelectorAll(".line.group")];

  it("opens and closes a group with Tab, Right and Left, and Left on one of its problems closes it", async () => {
    const { buffer } = await mount({ ...resultBuffer("workspace.check", {}, "Check", output, 1), cursor: 1 });
    expect(groups().map((line) => line.getAttribute("aria-expanded"))).toEqual(["false", "false"]);
    expect(groups()[0]?.textContent).toBe("▸YAML that cannot be parsed2");
    expect((await press("Tab")).defaultPrevented).toBe(true);
    expect(buffer().unfolded).toEqual([YAML]);
    expect(texts()).toContain("requirements/a.md:3Bad YAML");
    expect(groups()[0]?.textContent).toBe("▾YAML that cannot be parsed2");
    await press("Tab");
    expect(buffer().unfolded).toBeUndefined();
    await press("ArrowRight");
    expect(buffer().unfolded).toEqual([YAML]);
    await press("ArrowDown");
    expect(buffer().cursor).toBe(2);
    await press("ArrowLeft");
    expect(buffer().unfolded).toBeUndefined();
    expect(buffer().cursor).toBe(1);
    // Tab with a modifier, and Tab on a line that is no group, are not taken.
    expect((await press("Tab", { shiftKey: true })).defaultPrevented).toBe(false);
    await press("ArrowDown");
    expect((await press("Tab")).defaultPrevented).toBe(false);
  });

  it("opens the list of the elements of a group with Enter or a click, and opens a group without elements instead", async () => {
    const { actions, buffer } = await mount({
      ...resultBuffer("workspace.check", {}, "Check", output, 1),
      cursor: 3,
    });
    // The group of file problems has no elements: a click opens it, a click on its triangle closes it.
    await act(async () => {
      container.querySelector<HTMLElement>(".line.group")?.click();
      await Promise.resolve();
    });
    expect(buffer().unfolded).toEqual([YAML]);
    await act(async () => {
      container.querySelector<HTMLElement>(".line.group .fold-mark")?.click();
      await Promise.resolve();
    });
    expect(buffer().unfolded).toBeUndefined();
    await press("ArrowDown");
    await press("ArrowDown");
    await press("Enter");
    const opened = actions.find((action) => action.type === "open");
    expect(opened?.type === "open" ? opened.buffer : undefined).toMatchObject({
      kind: "list",
      label: "Outdated relation",
      selection: { where: { property: "id", op: "in", value: ["uuid-1", "uuid-2"] } },
    });
  });

  it("names the selected group as the active option", async () => {
    await mount({ ...resultBuffer("workspace.check", {}, "Check", output, 1), cursor: 3 });
    const group = container.querySelector("[data-buffer]");
    expect(group?.getAttribute("aria-activedescendant")).toMatch(/result-3$/);
    expect(groups().every((line) => line.getAttribute("role") === "option")).toBe(true);
  });
});

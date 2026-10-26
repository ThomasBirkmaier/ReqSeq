// The short ID of the element each problem names, added where outputs leave the runtime (#315).
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureOptions } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput, JsonSchema, Problem } from "../catalog.js";
import { defineTestCommand } from "../catalog.js";
import { metamodelState } from "../metamodel/index.js";
import { elementStoreState, problemElement, requiredProblemsState, shortIdState } from "../model/index.js";
import { SCHEMA_BASE, loadContracts } from "./contracts.js";
import type { ProblemLocator } from "./element-short-ids.js";
import { fillElementShortIds, problemLocator, withElementShortIds } from "./element-short-ids.js";
import { createCommandRuntime, invoke } from "./invoke.js";
import { Workspace } from "./workspace.js";

const P = "26a0b000-0000-4000-8000-0000000000";
const N1 = `${P}a1`;
const R2 = `${P}b2`;
const HINTS: FixtureOptions = { fixture: "SR-026/hints" };

const open = async (options: FixtureOptions = HINTS): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const { schemas } = loadContracts();
const base = `${SCHEMA_BASE}commands/test.output.json`;
const PROBLEM = { $ref: "../common.schema.json#/$defs/problem" };
const PROBLEMS = { type: "array", items: PROBLEM };
const locator = (schema: JsonSchema): ProblemLocator | undefined => problemLocator(schema, base, schemas);

/** A problem about `id` in `file` of the repository system. */
const about = (
  id: string,
  file: string,
  more: Partial<Problem> = {},
): Problem & { readonly elementId: string } => ({
  code: "element.unknown-property",
  severity: "warning",
  message: "m",
  repository: "system",
  file,
  elementId: id,
  ...more,
});

/** An output with one problem about `id`. */
const named = (id: string): { problems: Problem[] } => ({ problems: [about(id, "needs/N-0000000000a1.md")] });

describe("problemLocator", () => {
  it("finds the problems behind $ref, items, properties, anyOf, oneOf and allOf", () => {
    const problem: ProblemLocator = { problem: true };
    expect(locator(PROBLEM)).toEqual(problem);
    expect(locator({ type: "object", properties: { problems: PROBLEMS, ok: { type: "boolean" } } })).toEqual({
      properties: new Map([["problems", { items: problem }]]),
    });
    expect(
      locator({
        anyOf: [
          { properties: { a: PROBLEMS } },
          { properties: { a: PROBLEM, b: PROBLEM } },
          { type: "null" },
        ],
        oneOf: [{ items: PROBLEM }],
        allOf: [PROBLEM],
      }),
    ).toEqual({
      problem: true,
      items: problem,
      properties: new Map<string, ProblemLocator>([
        ["a", { problem: true, items: problem }],
        ["b", problem],
      ]),
    });
    // An element of data-export.schema.json, as element.get gives it: refs relative to that file.
    expect(
      locator({ properties: { element: { $ref: "../data-export.schema.json#/$defs/element" } } }),
    ).toEqual({
      properties: new Map([["element", { properties: new Map([["problems", { items: problem }]]) }]]),
    });
  });

  it("finds none where there is none, a ref that leads nowhere or a schema that refers back to itself", () => {
    expect(locator({ type: "object", properties: { ok: { type: "boolean" } } })).toBeUndefined();
    expect(locator({ $ref: "../common.schema.json#/$defs/nothing/here" })).toBeUndefined();
    expect(locator({ anyOf: "no list", items: true })).toBeUndefined();
    const recursive: Record<string, unknown> = { type: "object" };
    recursive["properties"] = { child: recursive, problems: PROBLEMS };
    expect(locator(recursive)).toEqual({ properties: new Map([["problems", { items: { problem: true } }]]) });
    // Without common.schema.json there is no problem schema to find.
    expect(problemLocator(PROBLEM, base, [])).toBeUndefined();
  });

  it("finds the problems of every product command that has them", () => {
    const contracts = loadContracts();
    const located = (name: string): ProblemLocator | undefined => {
      const entry = contracts.entry(name);
      return entry && problemLocator(entry.output, base, schemas);
    };
    const list = { items: { problem: true } };
    expect(located("workspace.check")).toEqual({ properties: new Map([["problems", list]]) });
    expect(located("hint.list")).toEqual({ properties: new Map([["hints", list]]) });
    expect(located("element.get")).toEqual({
      properties: new Map([["element", { properties: new Map([["problems", list]]) }]]),
    });
    expect(located("trace.affected")).toBeUndefined();
  });
});

describe("fillElementShortIds", () => {
  const where = locator({ properties: { problems: PROBLEMS, other: PROBLEMS } }) ?? {};
  const shortIdOf = (problem: Problem & { readonly elementId: string }): string | undefined =>
    problem.elementId === N1 ? "N-0000a1" : undefined;

  it("adds the short ID to the problems that name an element, in a copy", () => {
    const named = about(N1, "needs/N-0000000000a1.md");
    const output = { problems: [{ code: "x", severity: "info", message: "m" }, named], other: [], ok: true };
    const filled = fillElementShortIds(output, where, shortIdOf);
    expect(filled).toEqual({
      ...output,
      problems: [output.problems[0], { ...named, elementShortId: "N-0000a1" }],
    });
    // The output and its problems stay as they were (they may be kept in workspace states).
    expect(named).not.toHaveProperty("elementShortId");
    expect((filled as typeof output).problems[0]).toBe(output.problems[0]);
    expect((filled as typeof output).other).toBe(output.other);
  });

  it("returns the value itself when nothing changes", () => {
    const unknown = about(R2, "x.md");
    const shown = { ...about(N1, "x.md"), elementShortId: "N-1" };
    for (const output of [
      { problems: [unknown, shown] },
      { problems: "not a list" },
      { problems: [null, 3, ["nested"]] },
      { other: [{ ...unknown, elementId: 7 }] },
      "text",
      null,
    ]) {
      expect(fillElementShortIds(output, where, shortIdOf)).toBe(output);
    }
  });
});

describe("withElementShortIds", () => {
  const where = locator({ properties: { problems: PROBLEMS } });

  it("changes nothing without problems that name an element", async () => {
    const workspace = await open();
    const output = { problems: [{ code: "x", severity: "info", message: "m" }] };
    expect(await withElementShortIds(workspace, undefined, named(N1))).toEqual(named(N1));
    expect(await withElementShortIds(workspace, where, output)).toBe(output);
    expect(workspace.peek(elementStoreState)).toBeUndefined();
  });

  it("leaves the short ID out and reads nothing when the store or the metamodel is not built (ADR-0008)", async () => {
    const workspace = await open();
    const output = named(N1);
    expect(await withElementShortIds(workspace, where, output)).toBe(output);
    expect(workspace.peek(elementStoreState)).toBeUndefined();
    expect(workspace.peek(metamodelState)).toBeUndefined();
    await workspace.get(elementStoreState);
    expect(await withElementShortIds(workspace, where, output)).toBe(output);
    expect(workspace.peek(metamodelState)).toBeUndefined();
    expect(workspace.peek(shortIdState)).toBeUndefined();
  });

  it("takes the short IDs the workspace has, else builds them from the store and metamodel without keeping them", async () => {
    const workspace = await open();
    await Promise.all([workspace.get(elementStoreState), workspace.get(metamodelState)]);
    const expected = { problems: [{ ...named(N1).problems[0], elementShortId: "N-0000a1" }] };
    expect(await withElementShortIds(workspace, where, named(N1))).toEqual(expected);
    expect(workspace.peek(shortIdState)).toBeUndefined();
    await workspace.get(shortIdState);
    expect(await withElementShortIds(workspace, where, named(N1))).toEqual(expected);
    // An element that is not in the store has no short ID.
    const stray = named(`${P}ee`);
    expect(await withElementShortIds(workspace, where, stray)).toBe(stray);
  });

  it("names the copy a problem is about when files share a UUID (SR-088)", async () => {
    const workspace = await open({
      ...HINTS,
      files: {
        "requirements/SR-0000000000a1.md":
          "---\nid: " + N1 + "\ntype: system-requirement\nstatus: draft\ntitle: Copy\n---\n",
      },
    });
    const store = await workspace.get(elementStoreState);
    await workspace.get(metamodelState);
    const copy = { problems: [about(N1, "requirements/SR-0000000000a1.md")] };
    expect(await withElementShortIds(workspace, where, copy)).toEqual({
      problems: [{ ...copy.problems[0], elementShortId: "SR-0000a1" }],
    });
    // A file that holds no copy of the UUID: none of the two is meant.
    expect(problemElement(store, about(N1, "elsewhere.md"))).toBeUndefined();
    expect(problemElement(store, about(R2, "elsewhere.md"))?.file).toBe("requirements/SR-0000000000b2.md");
  });
});

describe("every command names the short ID of the element of each problem (#315)", () => {
  it("workspace.check, hint.list and element.get give the same problems, with short IDs", async () => {
    const workspace = await open();
    const check = (await invoke("workspace.check", {}, { workspace })) as CommandOutput<"workspace.check">;
    const named = check.problems.filter((p) => p.elementId !== undefined);
    expect(named.length).toBeGreaterThan(5);
    for (const problem of named) {
      expect(problem.elementShortId).toMatch(/^[A-Z]+-0000[a-f0-9]{2}$/);
    }
    // The problems kept in the workspace states stay without it.
    expect((await workspace.get(requiredProblemsState)).every((p) => p.elementShortId === undefined)).toBe(
      true,
    );
    const shown = (await invoke("element.get", { ref: R2 }, { workspace })) as CommandOutput<"element.get">;
    expect(shown.element.problems?.map((p) => p.elementShortId)).toContain("SR-0000b2");
  });

  it("gives the same short IDs against an invalid metamodel, whatever ran before on the workspace (SR-080 AK2)", async () => {
    const files = {
      "metamodel/broken.yaml": "logreq-metamodel: 1\ntypes: 5\n",
      "needs/N-1111110000a1.md": "---\nid: " + N1 + "\ntype: need\nstatus: draft\ntitle: Copy\n---\n",
    };
    const checked = async (warm: boolean): Promise<CommandOutput<"workspace.check">> => {
      const workspace = await open({ ...HINTS, files });
      if (warm) {
        await invoke("element.get", { ref: R2 }, { workspace });
        expect(workspace.peek(shortIdState)).toBeDefined();
      }
      return (await invoke("workspace.check", {}, { workspace })) as CommandOutput<"workspace.check">;
    };
    const fresh = await checked(false);
    const duplicates = fresh.problems.filter((p) => p.code === "element.duplicate-id");
    expect(duplicates.map((p) => p.elementShortId)).toEqual(["N-0000a1", "N-0000a1"]);
    expect(await checked(true)).toEqual(fresh);
  });

  it("leaves it out for a command that names an element without having read the store", async () => {
    const catalog = {
      "logreq-catalog": 1,
      commands: [
        {
          name: "test.named",
          summary: "A problem about an element (test only).",
          effect: "read",
          stage: 1,
          implements: ["SR-080"],
          input: { type: "object" },
          output: { type: "object", properties: { problems: PROBLEMS } },
        },
      ],
    };
    const command = defineTestCommand<object, unknown>({
      name: "test.named",
      run: () => Promise.resolve(named(N1)),
    });
    const runtime = createCommandRuntime({
      contracts: loadContracts({ catalog }),
      commands: [command],
      validateOutput: true,
    });
    const workspace = await open();
    expect(await runtime.invoke("test.named", {}, { workspace })).toEqual(named(N1));
    await Promise.all([workspace.get(elementStoreState), workspace.get(metamodelState)]);
    expect(await runtime.invoke("test.named", {}, { workspace })).toEqual({
      problems: [{ ...named(N1).problems[0], elementShortId: "N-0000a1" }],
    });
  });
});

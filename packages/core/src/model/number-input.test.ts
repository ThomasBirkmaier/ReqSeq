// A value of a number property that is no number is refused by element.create and element.update
// (#614); element.bulkUpdate in bulkUpdate.test.ts.
import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../catalog.js";
import { CommandError } from "../catalog.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { numberInput } from "./number-input.js";

const open = async (): Promise<{ workspace: Workspace; root: string }> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-085/value-kinds" });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.path("system"));
  onTestFinished(() => workspace.close());
  return { workspace, root: fixture.path("system") };
};

const refusal = (run: () => unknown): CommandError => {
  try {
    run();
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a refusal");
};

const refusalOf = async (run: Promise<unknown>): Promise<CommandError> => {
  try {
    await run;
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a refusal");
};

describe("numberInput (#614)", () => {
  it("keeps numbers, lists of numbers and values that count as no value", () => {
    for (const value of [3, 2.5, -1, [1, 2], null, [], "", " "]) {
      expect(numberInput("weight", value)).toBe(value);
    }
  });

  it("refuses a value or list item that is no number, and converts nothing", () => {
    const cases: readonly (readonly [unknown, string, Record<string, unknown>])[] = [
      [
        "3",
        'weight: is the text "3"; give it as a number, without quotes; a property of kind number takes a number',
        {},
      ],
      ["heavy", 'weight: is the text "heavy"; a property of kind number takes a number', {}],
      [true, "weight: is the boolean true; a property of kind number takes a number", {}],
      [{ n: 3 }, "weight: is a mapping; a property of kind number takes a number", {}],
      [Infinity, "weight: is the number Infinity; a property of kind number takes a number", {}],
      [
        [1, "2"],
        'weight: item 2 is the text "2"; give it as a number, without quotes; a property of kind number takes a number',
        { index: 1 },
      ],
      [[null], "weight: item 1 is empty; a property of kind number takes a number", { index: 0 }],
      [[[1]], "weight: item 1 is a list; a property of kind number takes a number", { index: 0 }],
    ];
    for (const [value, message, details] of cases) {
      const error = refusal(() => numberInput("weight", value as never));
      expect([error.code, error.message, error.details]).toEqual([
        "input.invalid",
        message,
        { key: "weight", ...details, reason: "not-a-number" },
      ]);
    }
  });
});

describe("element.create and element.update: a number given as text (#614)", () => {
  it("refuses it with input.invalid and writes nothing; a number is written", async () => {
    const { workspace, root } = await open();
    const filesBefore = await fs.readdir(root, { recursive: true });
    const created = await refusalOf(
      invoke(
        "element.create",
        { type: "system-requirement", title: "Gusts", properties: { weight: "3" } },
        { workspace },
      ),
    );
    expect([created.code, created.details]).toEqual([
      "input.invalid",
      { key: "weight", reason: "not-a-number" },
    ]);
    expect(await fs.readdir(root, { recursive: true })).toEqual(filesBefore);

    const out = (await invoke(
      "element.create",
      { type: "system-requirement", title: "Gusts", properties: { weight: 3 } },
      { workspace },
    )) as CommandOutput<"element.create">;
    const file = path.join(root, out.files[0] ?? "");
    const written = await fs.readFile(file, "utf8");
    expect(written).toContain("\nweight: 3\n");

    const updated = await refusalOf(
      invoke("element.update", { ref: out.element.id, set: { weight: "4" } }, { workspace }),
    );
    expect([updated.code, updated.details]).toEqual([
      "input.invalid",
      { key: "weight", reason: "not-a-number" },
    ]);
    expect(await fs.readFile(file, "utf8")).toBe(written);
  });
});

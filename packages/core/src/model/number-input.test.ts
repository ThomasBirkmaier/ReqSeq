// A value of a number property that is no number is refused by element.create, element.update and
// element.bulkUpdate set and add (#614); bulk remove still removes such an item from a file.
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

  it("[SR-085/AK-jx8c] refuses a value or list item that is no number, converts nothing, and says what to give", () => {
    const long = "x".repeat(60);
    const cases: readonly (readonly [unknown, string, Record<string, unknown>])[] = [
      // A text JSON reads as a number: only its quotes are wrong (API, MCP).
      ["3", 'weight: the text "3" is no number; give it as a number, without quotes', {}],
      [" 3 ", 'weight: the text " 3 " is no number; give it as a number, without quotes', {}],
      // A text only JavaScript reads as a number (the CLI sends `--set weight=.5` as text).
      [".5", 'weight: the text ".5" is no number; give a decimal number such as 0.5', {}],
      ["0x10", 'weight: the text "0x10" is no number; give a decimal number such as 16', {}],
      ["heavy", 'weight: the text "heavy" is no number; give a decimal number', {}],
      ["true", 'weight: the text "true" is no number; give a decimal number', {}],
      ["1,5", 'weight: the text "1,5" is no number; give a decimal number', {}],
      [long, `weight: the text "${"x".repeat(40)}..." is no number; give a decimal number`, {}],
      [true, "weight: the boolean true is no number; give a decimal number", {}],
      [{ n: 3 }, "weight: a mapping is no number; give a decimal number", {}],
      [Infinity, "weight: the number Infinity is no number; give a decimal number", {}],
      [
        [1, "2"],
        'weight item 2: the text "2" is no number; give it as a number, without quotes',
        { index: 1 },
      ],
      [[null], "weight item 1: empty is no number; give a decimal number", { index: 0 }],
      [[[1]], "weight item 1: a list is no number; give a decimal number", { index: 0 }],
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
  it("[SR-085/AK-jx8c] refuses it with input.invalid and writes nothing; a number is written", async () => {
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

describe("element.bulkUpdate and a number property (#614)", () => {
  it("[SR-085/AK-jx8c] refuses set and add of a text, and removes a hand-written text item with remove", async () => {
    const fixture = await createFixtureWorkspace({
      fixture: "SR-069/filter",
      files: {
        "metamodel/software.yaml": [
          "reqseq-metamodel: 1",
          "types:",
          "  - key: software-requirement",
          "    name: Software Requirement",
          "    prefix: SWR",
          "    extends: system-requirement",
          "    properties: [priority]",
          "properties:",
          "  - { key: priority, name: Priority, kind: number, many: true }",
          "",
        ].join("\n"),
        "requirements/SWR-0000000000f2.md": [
          "---",
          "id: 69069069-0000-4000-8000-0000000000f2",
          "type: software-requirement",
          "status: approved",
          "title: Log the raw values",
          "priority:",
          "  - 5",
          '  - "5"',
          "---",
          "",
        ].join("\n"),
      },
    });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    const file = path.join(fixture.root, "requirements/SWR-0000000000f2.md");
    const selection = { ids: ["69069069-0000-4000-8000-0000000000f2"] };
    for (const operation of ["set", "add"]) {
      const error = await refusalOf(
        invoke(
          "element.bulkUpdate",
          { selection, property: "priority", operation, value: "6", confirm: true },
          { workspace },
        ),
      );
      expect([error.code, error.details]).toEqual([
        "input.invalid",
        { key: "priority", reason: "not-a-number" },
      ]);
    }
    await invoke(
      "element.bulkUpdate",
      { selection, property: "priority", operation: "remove", value: "5", confirm: true },
      { workspace },
    );
    expect(await fs.readFile(file, "utf8")).toContain("\npriority:\n  - 5\n---\n");
  });
});

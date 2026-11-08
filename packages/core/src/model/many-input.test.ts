// One item given for a property with many values is stored as a list of one (#1209), by
// element.create, element.update and element.bulkUpdate, so the element counts for its package.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput, Problem } from "../catalog.js";
import { metamodelState } from "../metamodel/index.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { listWhereMany } from "./many-input.js";

const PKG = "48048048-0000-4000-8000-0000000000d1";
const R3 = "48048048-0000-4000-8000-0000000000b3";

const open = async (): Promise<{ workspace: Workspace; path: (file: string) => string }> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-048/packages" });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { workspace, path: (file) => fixture.path(file) };
};

const membersOf = async (workspace: Workspace): Promise<string[]> =>
  (
    (await invoke(
      "element.list",
      { selection: { package: PKG } },
      { workspace },
    )) as CommandOutput<"element.list">
  ).elements?.map((e) => e.id) ?? [];

const wrongKinds = (problems: readonly Problem[] | undefined): Problem[] =>
  (problems ?? []).filter((p) => p.code === "element.wrong-value-kind");

/** The front matter lines of `key` in `text`: the key line and the list items below it. */
const linesOf = (text: string, key: string): string[] => {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.startsWith(`${key}:`));
  const end = lines.findIndex((l, i) => i > at && !l.startsWith("  - "));
  return lines.slice(at, end);
};

describe("listWhereMany (#1209)", () => {
  it("makes one item of a property with many a list of one, and keeps everything else", async () => {
    const { workspace } = await open();
    const metamodel = await workspace.get(metamodelState);
    expect(listWhereMany(metamodel, "packages", "PKG-0000d1")).toEqual(["PKG-0000d1"]);
    expect(listWhereMany(metamodel, "packages", { id: PKG })).toEqual([{ id: PKG }]);
    expect(listWhereMany(metamodel, "acceptance-criteria", "It holds.")).toEqual(["It holds."]);
    for (const value of [["PKG-0000d1"], [], null, "", " "]) {
      expect(listWhereMany(metamodel, "packages", value)).toBe(value);
    }
    // No many, and keys that are no property (a relation kind, an unknown key), stay as given.
    expect(listWhereMany(metamodel, "requirement-type", "functional")).toBe("functional");
    expect(listWhereMany(metamodel, "derives-from", "N-0000a1")).toBe("N-0000a1");
    expect(listWhereMany(metamodel, "no-such-key", "x")).toBe("x");
  });
});

describe("element.create, element.update and element.bulkUpdate: one package given without a list (#1209)", () => {
  it("writes it as a list of one, without a wrong-value-kind hint, and the element is in the package", async () => {
    const { workspace, path } = await open();
    const created = (await invoke(
      "element.create",
      {
        type: "system-requirement",
        title: "Show the wind speed",
        properties: {
          "requirement-type": "functional",
          "acceptance-criteria": "It shows the wind speed.",
          packages: "PKG-0000d1",
        },
      },
      { workspace },
    )) as CommandOutput<"element.create">;
    const text = await fs.readFile(path(created.files[0] ?? ""), "utf8");
    expect(linesOf(text, "packages")).toEqual([
      "packages:",
      expect.stringMatching(
        new RegExp(`^  - \\{ id: ${PKG}, version: n\\d+:[0-9a-f]{16}, title: Release 1 \\}$`),
      ),
    ]);
    expect(linesOf(text, "acceptance-criteria")).toEqual([
      "acceptance-criteria:",
      "  - It shows the wind speed.",
    ]);
    expect(wrongKinds(created.problems)).toEqual([]);
    expect(await membersOf(workspace)).toContain(created.element.id);

    // R3 is in no package; update gives it one by a target mapping, without a list.
    expect(await membersOf(workspace)).not.toContain(R3);
    const updated = (await invoke(
      "element.update",
      { ref: R3, set: { packages: { id: PKG } } },
      { workspace },
    )) as CommandOutput<"element.update">;
    expect(wrongKinds(updated.problems)).toEqual([]);
    expect(
      linesOf(await fs.readFile(path("requirements/SR-0000000000b3.md"), "utf8"), "packages"),
    ).toHaveLength(2);
    expect(await membersOf(workspace)).toContain(R3);

    const bulk = (await invoke(
      "element.bulkUpdate",
      {
        selection: { ids: [created.element.id] },
        property: "packages",
        operation: "set",
        value: PKG,
        confirm: true,
      },
      { workspace },
    )) as CommandOutput<"element.bulkUpdate">;
    expect(wrongKinds(bulk.problems)).toEqual([]);
    expect(linesOf(await fs.readFile(path(created.files[0] ?? ""), "utf8"), "packages")).toHaveLength(2);
    expect(await membersOf(workspace)).toContain(created.element.id);
  });
});

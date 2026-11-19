// The use counts of metamodel definitions (SR-236 AK7, AK8) beyond what the metamodel commands show.
import { describe, expect, it } from "vitest";
import { SMALL_MODEL, elements, openSmall } from "../commands/metamodel-commands.test-helper.js";
import { metamodelState } from "../metamodel/index.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { mentioningFiles, metamodelUsesState } from "./metamodel-uses.js";

describe("metamodelUses", () => {
  it("counts each fixed value an element with several values holds, and no unknown one", async () => {
    const model = SMALL_MODEL.replace("    kind: choice\n", "    kind: choice\n    many: true\n");
    const { workspace } = await openSmall(
      elements([1, "hazard", { severity: "[low, high, other]" }], [2, "hazard", { severity: "[low, 3]" }]),
      model,
    );
    expect((await workspace.get(metamodelState)).valid).toBe(true);
    expect((await workspace.get(metamodelUsesState)).values).toEqual({ severity: { low: 2, high: 1 } });
  });
});

describe("metamodelUses and keys objects inherit", () => {
  it("counts no key of an element file that only objects inherit, and changes nothing objects inherit", async () => {
    const { workspace } = await openSmall(
      elements([
        1,
        "hazard",
        { constructor: "x", keys: "y", hasOwnProperty: "z", severity: "toString", status: "valueOf" },
      ]),
    );
    const uses = await workspace.get(metamodelUsesState);
    expect(uses.values).toEqual({ severity: { low: 0, high: 0 } });
    expect(uses.relations).toEqual({ about: 0 });
    expect(uses.statuses).toEqual({ draft: 0, open: 0, noted: 0 });
    expect(typeof Object.keys).toBe("function");
    expect(Object.hasOwn({}, "constructor")).toBe(false);
  });

  it("counts a fixed value on an element of a type without the property", async () => {
    const { workspace } = await openSmall(elements([1, "note", { severity: "high" }]));
    expect((await workspace.get(metamodelUsesState)).values).toEqual({ severity: { low: 0, high: 1 } });
  });
});

describe("mentioningFiles", () => {
  it("skips the folders of a repository that is not on this machine", async () => {
    const layout = {
      root: "/nowhere",
      main: "system",
      file: {},
      repositories: [{ name: "system", available: false, folder: "/nowhere" }],
    } as unknown as WorkspaceLayout;
    expect(await mentioningFiles(layout, new Set(["note"]))).toEqual([]);
  });
});

// The use counts of metamodel definitions (SR-236 AK7, AK8) beyond what the metamodel commands show.
import { describe, expect, it } from "vitest";
import { SMALL_MODEL, elements, openSmall, useCounts } from "../commands/metamodel-commands.test-helper.js";
import { metamodelState } from "../metamodel/index.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { mentioningFiles, metamodelUsesState, unreadableElementFiles } from "./metamodel-uses.js";

describe("metamodelUses", () => {
  it("counts each fixed value an element with several values holds, and no unknown one", async () => {
    const model = SMALL_MODEL.replace("    kind: choice\n", "    kind: choice\n    many: true\n");
    const { workspace } = await openSmall(
      elements([1, "hazard", { severity: "[low, high, other]" }], [2, "hazard", { severity: "[low, 3]" }]),
      model,
    );
    expect((await workspace.get(metamodelState)).valid).toBe(true);
    expect(useCounts((await workspace.get(metamodelUsesState)).values)).toEqual({
      "severity.low": 2,
      "severity.high": 1,
    });
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
    expect(useCounts(uses.values)).toEqual({ "severity.low": 0, "severity.high": 0 });
    expect(useCounts(uses.relations)).toEqual({ about: 0 });
    // Only the system requirement of the fixture, a draft, counts.
    expect(useCounts(uses.statuses)).toEqual({ draft: 1, open: 0, noted: 0 });
    expect(typeof Object.keys).toBe("function");
    expect(Object.hasOwn({}, "constructor")).toBe(false);
  });

  it("counts an element once for a fixed value its list holds twice, as the elements of the number", async () => {
    const model = SMALL_MODEL.replace("    kind: choice\n", "    kind: choice\n    many: true\n");
    const { workspace } = await openSmall(elements([1, "hazard", { severity: "[high, high]" }]), model);
    expect(useCounts((await workspace.get(metamodelUsesState)).values)).toEqual({
      "severity.low": 0,
      "severity.high": 1,
    });
  });

  it("counts a fixed value on an element of a type without the property", async () => {
    const { workspace } = await openSmall(elements([1, "note", { severity: "high" }]));
    expect(useCounts((await workspace.get(metamodelUsesState)).values)).toEqual({
      "severity.low": 0,
      "severity.high": 1,
    });
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

describe("unreadableElementFiles", () => {
  it("takes the errors at a file, each file once, by repository and path; warnings and errors without a file stay out", () => {
    const at = (severity: "error" | "warning", file?: string, repository?: string) => ({
      code: "file.invalid-yaml" as const,
      severity,
      message: "m",
      ...(file === undefined ? {} : { file }),
      ...(repository === undefined ? {} : { repository }),
    });
    expect(
      unreadableElementFiles([
        at("error", "b.md", "system"),
        at("error", "b.md", "system"),
        at("warning", "c.md", "system"),
        at("error"),
        at("error", "a.md", "system"),
        at("error", "z.md", "product"),
        at("error", "loose.md"),
      ]),
    ).toEqual([
      { repository: "", file: "loose.md" },
      { repository: "product", file: "z.md" },
      { repository: "system", file: "a.md" },
      { repository: "system", file: "b.md" },
    ]);
  });
});

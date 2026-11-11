// Saved filter files (saved.ts, SR-070): reading the filters folder, file names of new filters.
// The commands filter.save, filter.list and the selection are tested in commands/filter/.
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { CommandError } from "../catalog.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { SavedFilter } from "./saved.js";
import { filterSlug, inSavedFilter, newFilterFile, readSavedFilters } from "./saved.js";

const WORKSPACE = (filters: string): string =>
  "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
  '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
  `metamodel: { repository: system, path: metamodel }\nfilters: ${filters}\n`;

const open = async (options: FixtureOptions): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

describe("saved filter files (SR-070)", () => {
  it("[SR-070/AK1] reads and writes filters at the root of a repository, never the workspace file", async () => {
    const workspace = await open({
      fixture: "SR-069/filter",
      files: { "reqseq-workspace.yaml": WORKSPACE("{ repository: system, path: . }") },
    });
    const saved = await invoke("filter.save", { name: "All", where: { all: [] } }, { workspace });
    expect(saved).toEqual({ files: ["all.yaml"], problems: [] });
    expect(await invoke("filter.list", {}, { workspace })).toEqual({
      filters: [{ name: "All", file: "all.yaml", where: { all: [] } }],
      problems: [],
      incomplete: false,
    });
  });

  it("reports a filters path that is no folder, and a repository the workspace file does not list", async () => {
    const blocked = await open({ fixture: "SR-069/filter", files: { filters: "a file" } });
    const read = await readSavedFilters(await blocked.get(workspaceLayoutState));
    expect(read.filters).toEqual([]);
    expect(read.problems.map((p) => [p.code, p.file])).toEqual([["file.unreadable", "filters"]]);
    const error = await invoke(
      "filter.save",
      { name: "All", where: { all: [] } },
      { workspace: blocked },
    ).catch((e: unknown) => e);
    expect((error as CommandError).code).toBe("file.not-regular");
    const unknown = await open({
      fixture: "SR-069/filter",
      files: { "reqseq-workspace.yaml": WORKSPACE("{ repository: elsewhere, path: filters }") },
    });
    expect(await readSavedFilters(await unknown.get(workspaceLayoutState))).toMatchObject({
      repository: undefined,
      filters: [],
      incomplete: false,
    });
  });

  it("keeps every faulty file of a name, and reports an empty file", async () => {
    const workspace = await open({
      fixture: "SR-069/filter",
      files: {
        "filters/a.yaml": "reqseq-filter: 2\nname: Twice\nwhere: { all: [] }\n",
        "filters/b.yaml": "reqseq-filter: 1\nname: Twice\n",
        "filters/c.yaml": "",
      },
    });
    const read = await readSavedFilters(await workspace.get(workspaceLayoutState));
    expect(read.faultyNames).toEqual(new Map([["twice", ["filters/a.yaml", "filters/b.yaml"]]]));
    expect(read.problems.map((p) => [p.file, p.line, p.message])).toEqual([
      ["filters/a.yaml", 1, "Invalid saved filter filters/a.yaml: reqseq-filter 2 is not 1"],
      ["filters/b.yaml", 1, "Invalid saved filter filters/b.yaml: where is required"],
      [
        "filters/c.yaml",
        undefined,
        "Invalid saved filter filters/c.yaml: the file must be an object, not empty",
      ],
    ]);
  });

  it("names the saved filter in its errors and passes other errors on", () => {
    const filter = { name: "Drafts", file: "filters/drafts.yaml" } as SavedFilter;
    let named: unknown;
    try {
      inSavedFilter(filter, () => {
        throw new CommandError("input.invalid", "where: wrong", { fields: ["where"] });
      });
    } catch (error) {
      named = error;
    }
    expect((named as CommandError).toJSON()).toEqual({
      code: "input.invalid",
      message: 'Saved filter "Drafts" (filters/drafts.yaml): where: wrong',
      details: { fields: ["where"] },
    });
    const plain = new Error("a bug");
    expect(() =>
      inSavedFilter(filter, () => {
        throw plain;
      }),
    ).toThrow(plain);
    expect(inSavedFilter(filter, () => 3)).toBe(3);
  });

  it("[SR-070/AK1] makes a file name of letters and digits that every file system takes", () => {
    expect(filterSlug("Open drafts")).toBe("open-drafts");
    expect(filterSlug("  Überprüfte Größen: 2026/Q3 ")).toBe("uberprufte-großen-2026-q3");
    expect(filterSlug("需求 review")).toBe("需求-review");
    expect(filterSlug("com1")).toBe("com1-filter");
    expect(filterSlug("LPT9")).toBe("lpt9-filter");
    expect(filterSlug("con-x")).toBe("con-x");
    expect(filterSlug("...")).toBe("filter");
    expect(filterSlug("x".repeat(70))).toBe("x".repeat(64));
    expect(newFilterFile("Open", new Set(["open.yaml", "open-2.yaml"]))).toBe("open-3.yaml");
    expect(newFilterFile("Open", new Set(["open.yml"]))).toBe("open.yaml");
  });
});

// SR-099 (D-045): LogReq offers no delete of an element, only supersede. The app, CLI, API and MCP server
// offer exactly the catalog commands (ADR-0002 rule 3), so the catalog and the implemented write commands
// are checked here; packages/cli/test/no-delete.test.ts checks the three adapters. The app has no UI before
// stage 3; by #127 option 1 its part of AK1 is this catalog test until then.
import fs from "node:fs";
import path from "node:path";
import { createFixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { elementStoreState } from "../model/index.js";
import { loadContracts } from "../runtime/contracts.js";
import { createCommandRuntime } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { commands } from "./index.js";

/** Words of an action that would delete something. */
const DELETE_LIKE = /delete|remove|destroy|erase|purge|drop|unlink|trash|discard|clear|wipe/i;

/**
 * Catalog commands whose name sounds like a delete but which delete no element, with the reason.
 * Each one is checked to be in the catalog, so the list cannot go stale.
 */
const NOT_AN_ELEMENT_DELETE: Readonly<Record<string, string>> = {
  "relation.remove": "removes a relation entry from the source file; the element and its file stay",
};

const contracts = loadContracts();
const runtime = createCommandRuntime({ commands });

const WIND = "e8df96ea-a168-4d90-8d65-6328cee88fb3";
const GUSTS = "3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c";

/** Input of one call of a write command, run on SR-001/two-elements plus a `new/` folder with an image. */
type Scenario = Readonly<Record<string, unknown>>;

/** Every implemented write command, with calls that succeed and calls that fail. */
const SCENARIOS: Readonly<Record<string, readonly Scenario[]>> = {
  "element.addAttachment": [
    { ref: WIND, sourcePath: "new/layout.png" },
    { ref: WIND, sourcePath: "new/layout.png" },
    { ref: GUSTS, sourcePath: "new/layout.png" },
    { ref: WIND, sourcePath: "new/missing.png" },
  ],
  "element.create": [
    { type: "system-requirement", title: "Show gusts", folder: "requirements" },
    { type: "need", title: "New need", folder: "needs/new" },
    { type: "nope", title: "Unknown type" },
  ],
  "element.update": [
    { ref: WIND, title: "Renamed", text: "" },
    { ref: GUSTS, unset: ["acceptance-criteria", "rationale"] },
    { ref: "SR-ffffff", title: "Unknown element" },
  ],
  "element.setStatus": [
    { refs: [WIND, GUSTS], status: "obsolete" },
    { refs: [WIND], status: "draft" },
    { refs: [GUSTS], status: "released" },
  ],
  "element.supersede": [
    { ref: WIND, status: "obsolete", successor: GUSTS, relation: "supersedes" },
    { ref: GUSTS, status: "obsolete" },
    { ref: WIND, status: "draft" },
  ],
  "hint.confirm": [
    {
      hintIds: [
        `relation.outdated/system/${encodeURIComponent("requirements/SR-1d2e3f4a5b6c.md")}/${GUSTS}/derives-from/${WIND}?version=n1:0000000000000000`,
      ],
    },
    { hintIds: "not a list" },
  ],
  "relation.add": [
    { source: WIND, kind: "replaces", target: GUSTS },
    { source: WIND, kind: "nope", target: GUSTS },
  ],
  "relation.remove": [
    { source: GUSTS, kind: "derives-from", target: WIND },
    { source: GUSTS, kind: "nope", target: WIND },
  ],
  "workspace.init": [
    { path: "new", name: "New" },
    { path: ".", name: "Again" },
  ],
};

/** Every file below `root` (relative, with `/`), except Git's own. */
const filesBelow = (root: string): string[] =>
  fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(root, path.join(e.parentPath, e.name)).split(path.sep).join("/"))
    .filter((file) => !file.split("/").includes(".git"))
    .sort();

describe("no delete of an element (SR-099, D-045)", () => {
  it("[SR-099/AK1] the catalog offers no command that deletes an element", () => {
    const names = contracts.commands.map((c) => c.name);
    const deleteLike = names.filter((name) => DELETE_LIKE.test(name.split(".")[1] ?? ""));
    expect(deleteLike.filter((name) => !(name in NOT_AN_ELEMENT_DELETE))).toEqual([]);
    expect(Object.keys(NOT_AN_ELEMENT_DELETE).filter((name) => !names.includes(name))).toEqual([]);
    // No command group of elements has a delete-like action at all; supersede takes its place.
    expect(names.filter((name) => name.startsWith("element.") && deleteLike.includes(name))).toEqual([]);
    expect(contracts.entry("element.supersede")?.summary).toContain("There is no delete (D-045)");
  });

  it("[SR-099/AK1] has a scenario for every implemented write command", () => {
    const writes = contracts.commands
      .filter((c) => c.effect === "write-files" && runtime.commands.has(c.name))
      .map((c) => c.name)
      .sort();
    expect(Object.keys(SCENARIOS).sort()).toEqual(writes);
  });

  for (const [name, scenarios] of Object.entries(SCENARIOS)) {
    it(`[SR-099/AK1] ${name} never removes or moves a file`, async () => {
      const fixture = await createFixtureWorkspace({
        fixture: "SR-001/two-elements",
        files: { "new/.keep": "", "new/layout.png": "an image" },
      });
      onTestFinished(() => fixture.cleanup());
      const workspace = new Workspace(fixture.root);
      onTestFinished(() => workspace.close());
      const ids = async (): Promise<string[]> =>
        (await workspace.get(elementStoreState)).elements.map((e) => e.id).sort();
      const outcomes: string[] = [];
      for (const input of scenarios) {
        const filesBefore = filesBelow(fixture.root);
        const idsBefore = await ids();
        try {
          await runtime.invoke(name, input, { workspace });
          outcomes.push("output");
        } catch {
          outcomes.push("error");
        }
        const filesAfter = new Set(filesBelow(fixture.root));
        expect(filesBefore.filter((file) => !filesAfter.has(file))).toEqual([]);
        const idsAfter = new Set(await ids());
        expect(idsBefore.filter((id) => !idsAfter.has(id))).toEqual([]);
      }
      // Each command both writes and fails at least once, so the check covers both paths.
      expect(outcomes).toContain("output");
      expect(outcomes).toContain("error");
    });
  }

  it("[SR-099/AK1] only the files module removes or renames files", () => {
    const src = path.resolve(import.meta.dirname, "..");
    const removing = fs
      .readdirSync(src, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".test.ts"))
      .map((e) => path.join(e.parentPath, e.name))
      .filter((file) =>
        /\b(?:rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync|rename|renameSync)\(/.test(
          fs.readFileSync(file, "utf8"),
        ),
      )
      .map((file) => path.relative(src, file).split(path.sep).join("/"))
      .sort();
    expect(removing).toEqual(["files/lock.ts", "files/private.ts", "files/write.ts"]);
  });
});

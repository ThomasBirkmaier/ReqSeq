// SR-099 (D-045): ReqSeq offers no delete of an element, only supersede. The app, CLI, API and MCP server
// offer exactly the catalog commands (ADR-0002 rule 3), so the catalog and the implemented write commands
// are checked here; packages/cli/test/no-delete.test.ts checks the three adapters. The app has no UI before
// stage 3; by ThomasBirkmaier/ReqSeq-archive#127 option 1 its part of AK1 is this catalog test until then.
import fs from "node:fs";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { elementStoreState } from "../model/index.js";
import { loadContracts } from "../runtime/contracts.js";
import { createCommandRuntime } from "../runtime/invoke.js";
import { readFirstFor } from "../runtime/read-first.test-helper.js";
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
  "filter.delete": "deletes the file of a saved filter, which is no element (D-056, SR-217 AK5)",
  "perspective.delete": "deletes the file of a perspective, which is no element (D-056, SR-217 AK5)",
};

const contracts = loadContracts();
const runtime = createCommandRuntime({ commands });

const WIND = "e8df96ea-a168-4d90-8d65-6328cee88fb3";
const GUSTS = "3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c";

/** Input of one call of a write command, run on SR-001/two-elements plus a `new/` folder with an image and a JUnit file. */
type Scenario = Readonly<Record<string, unknown>>;

/** A variant, in the fixture of variant.exclude only. */
const VARIANT = "0b7c6e1a-1111-4222-8333-cccccccccccc";
const EXTRA_FILES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "reqif.import": {
    "in/lieferung.reqif": fs.readFileSync(
      new URL("../../../../fixtures/SR-053/delivery/lieferung.reqif", import.meta.url),
      "utf8",
    ),
    "reqif/kunde-a.yaml": fs.readFileSync(
      new URL("../../../../fixtures/SR-053/delivery/kunde-a.yaml", import.meta.url),
      "utf8",
    ),
  },
  "filter.rename": {
    "filters/drafts.yaml": "reqseq-filter: 1\nname: Drafts\nwhere: { status: [draft] }\n",
    "perspectives/mine.yaml": "reqseq-perspective: 1\nname: Mine\nfilter: Drafts\nwhere: { all: [] }\n",
  },
  "perspective.rename": {
    "perspectives/drafts.yaml": "reqseq-perspective: 1\nname: Drafts\nwhere: { status: [draft] }\n",
  },
  "filter.delete": {
    "filters/drafts.yaml": "reqseq-filter: 1\nname: Drafts\nwhere: { status: [draft] }\n",
  },
  "perspective.delete": {
    "perspectives/drafts.yaml": "reqseq-perspective: 1\nname: Drafts\nwhere: { status: [draft] }\n",
  },
  "variant.exclude": {
    "variants/VAR-cccccccccccc.md": `---\nid: ${VARIANT}\ntype: variant\nstatus: draft\ntitle: Coast\n---\n`,
  },
};

/** Commands that rename the file of a perspective or saved filter, which is no element (SR-217 AK2, D-056). */
const RENAMES: ReadonlySet<string> = new Set(["filter.rename", "perspective.rename"]);

/** Commands that delete the file of a perspective or saved filter, which is no element (SR-217 AK5, D-056). */
const DELETES: ReadonlySet<string> = new Set(["filter.delete", "perspective.delete"]);

/** Commands that write only with Git, so their fixture is a Git repository (data.store, SR-062 K3; baseline.create, SR-050 AK7). */
const GIT_COMMANDS: ReadonlySet<string> = new Set(["baseline.create", "data.store"]);

/** Every implemented write command, with calls that succeed and calls that fail. */
const SCENARIOS: Readonly<Record<string, readonly Scenario[]>> = {
  "baseline.create": [
    { name: "Release 1", selection: {} },
    { name: "release 1", selection: { ids: [WIND] } },
    { name: "Other", selection: { baseline: "Release 1" } },
  ],
  "element.addAttachment": [
    { ref: WIND, sourcePath: "new/layout.png" },
    { ref: WIND, sourcePath: "new/layout.png" },
    { ref: GUSTS, sourcePath: "new/layout.png" },
    { ref: WIND, sourcePath: "new/missing.png" },
  ],
  "element.assignCriterionKeys": [
    { selection: {} },
    { selection: { ids: [GUSTS] } },
    { selection: { baseline: "nope" } },
  ],
  "element.bulkUpdate": [
    { selection: {}, property: "rationale", operation: "remove", confirm: true },
    { selection: {}, property: "acceptance-criteria", operation: "remove", value: "x", confirm: true },
    { selection: { ids: [WIND] }, property: "status", operation: "remove", confirm: true },
  ],
  "element.create": [
    { type: "system-requirement", title: "Show gusts", folder: "requirements" },
    { type: "need", title: "New need", folder: "needs/new" },
    { type: "nope", title: "Unknown type" },
  ],
  "element.update": [
    { ref: WIND, title: "Renamed", text: "" },
    { ref: GUSTS, unset: ["acceptance-criteria", "rationale"] },
    { ref: "SR-ffffff", title: "Unknown element", expectedFileSha256: "0".repeat(64) },
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
  // A record is only ever created, a taken name gets -2 (SR-030); `records` is the evidence location.
  "evidence.record": [
    {
      ref: WIND,
      kind: "verification",
      result: "passed",
      method: "test",
      item: "build-1",
      date: "2026-10-27T10:00:00Z",
    },
    {
      ref: WIND,
      kind: "verification",
      result: "failed",
      method: "test",
      item: "build-1",
      date: "2026-10-27T10:00:00Z",
    },
    { ref: "SR-ffffff", kind: "validation", result: "passed" },
  ],
  // Enriching replaces the JUnit file in place or writes a new one; the input stays (SR-029).
  // With Git (see GIT_COMMANDS): the second call replaces the data file of the same commit, which keeps it.
  "data.store": [{ folder: "out" }, { folder: "out" }, { folder: "out/.git" }],
  "evidence.enrichJunit": [
    { file: "new/results.xml", item: "build-1", date: "2026-10-27T10:00:00Z", output: "new/enriched.xml" },
    { file: "new/results.xml", item: "build-1", date: "2026-10-27T10:00:00Z" },
    { file: "new/gone.xml", item: "build-1" },
  ],
  // Saving under an existing name replaces the filter in its own file; a key left out is removed from
  // the file, never the file (filters are no elements, D-056, but nothing is deleted either).
  "filter.save": [
    { name: "Drafts", description: "Open work", where: { status: ["draft"] } },
    { name: "drafts", where: { status: ["draft", "obsolete"] } },
    { name: "Unknown package", where: { package: "SR-ffffff" } },
  ],
  // Adding a type changes one metamodel file in place; the second call is refused (name taken).
  "metamodel.addType": [
    { name: "Risk", prefix: "RI" },
    { name: "Risk", prefix: "RX" },
  ],
  // Renaming gives the file the new name (SR-217 AK2): the move check below allows exactly the
  // renamed files the output names; perspectives that name the filter change in place.
  "filter.rename": [
    { name: "Drafts", newName: "Open drafts" },
    { name: "Nope", newName: "Other" },
  ],
  // Deleting removes the file only with confirm (SR-217 AK5): the check below allows exactly the
  // deleted file the output names, a `.yaml` file that is no element.
  "filter.delete": [{ name: "Drafts" }, { name: "Drafts", confirm: true }, { name: "Drafts", confirm: true }],
  "perspective.delete": [
    { name: "drafts" },
    { name: "Drafts", confirm: true },
    { name: "Nope", confirm: true },
  ],
  "perspective.rename": [
    { name: "Drafts", newName: "Open drafts" },
    { name: "open drafts", newName: "Open Drafts" },
    { name: "Nope", newName: "Other" },
  ],
  // Saving under an existing name replaces the perspective in its own file; nothing is deleted.
  "perspective.save": [
    { name: "Drafts", description: "Open work", where: { status: ["draft"] }, group: "status" },
    { name: "drafts", where: { status: ["draft", "obsolete"] } },
    { name: "Unknown package", where: { package: "SR-ffffff" } },
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
  // An element file as output is refused (no XML), never replaced.
  "reqif.export": [{ output: "out.reqif" }, { output: "requirements/SR-1d2e3f4a5b6c.md" }],
  "reqif.import": [
    { file: "in/lieferung.reqif", mapping: "reqif/kunde-a.yaml", delivery: "1" },
    { file: "in/missing.reqif", mapping: "reqif/kunde-a.yaml", delivery: "1" },
  ],
  "reqif.saveMapping": [
    {
      mapping: {
        "reqseq-reqif-mapping": 1,
        source: { name: "Kunde A" },
        types: [{ source: "Customer Requirement", type: "system-requirement" }],
      },
    },
    { mapping: { "reqseq-reqif-mapping": 1, source: { name: "Kunde A" }, omit: true } },
  ],
  "variant.exclude": [
    { variant: VARIANT, refs: [WIND] },
    { variant: VARIANT, refs: [WIND], undo: true },
    { variant: WIND, refs: [GUSTS] },
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
  it("[SR-099/AK-nbg9] the catalog offers no command that deletes an element", () => {
    const names = contracts.commands.map((c) => c.name);
    const deleteLike = names.filter((name) => DELETE_LIKE.test(name.split(".")[1] ?? ""));
    expect(deleteLike.filter((name) => !(name in NOT_AN_ELEMENT_DELETE))).toEqual([]);
    expect(Object.keys(NOT_AN_ELEMENT_DELETE).filter((name) => !names.includes(name))).toEqual([]);
    // No command group of elements has a delete-like action at all; supersede takes its place.
    expect(names.filter((name) => name.startsWith("element.") && deleteLike.includes(name))).toEqual([]);
    expect(contracts.entry("element.supersede")?.summary).toContain("There is no delete.");
  });

  it("[SR-099/AK-nbg9] has a scenario for every implemented write command", () => {
    const writes = contracts.commands
      .filter((c) => c.effect === "write-files" && runtime.commands.has(c.name))
      .map((c) => c.name)
      .sort();
    expect(Object.keys(SCENARIOS).sort()).toEqual(writes);
  });

  for (const [name, scenarios] of Object.entries(SCENARIOS)) {
    const own = RENAMES.has(name)
      ? " but its own renamed one"
      : DELETES.has(name)
        ? " but its own deleted one"
        : "";
    it(`[SR-099/AK-nbg9] ${name} never removes or moves a file${own}`, async () => {
      const fixture = await createFixtureWorkspace({
        fixture: "SR-001/two-elements",
        files: {
          "reqseq-workspace.yaml":
            'reqseq-workspace: 1\nname: Weather station\nrepositories:\n  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
            "metamodel: { repository: system, path: metamodel }\nevidence:\n  - { repository: system, path: records }\n",
          "new/.keep": "",
          "new/layout.png": "an image",
          "new/results.xml":
            '<testsuites><testsuite name="s"><testcase name="[SR-e88fb3] wind"/></testsuite></testsuites>\n',
          ...EXTRA_FILES[name],
        },
        ...(GIT_COMMANDS.has(name) ? { git: true } : {}),
      });
      onTestFinished(() => fixture.cleanup());
      const workspace = new Workspace(fixture.root);
      onTestFinished(() => workspace.close());
      const ids = async (): Promise<string[]> =>
        (await workspace.get(elementStoreState)).elements.map((e) => e.id).sort();
      const outcomes: string[] = [];
      let moved = 0;
      let removed = 0;
      for (const input of scenarios) {
        const filesBefore = filesBelow(fixture.root);
        const idsBefore = await ids();
        let renamed: readonly { readonly from: string; readonly to: string }[] = [];
        let deleted: readonly string[] = [];
        try {
          const output = await runtime.invoke(name, await readFirstFor(name, input, { workspace }), {
            workspace,
          });
          renamed = (output as { readonly renamed?: typeof renamed }).renamed ?? [];
          const gone = output as { readonly deleted?: boolean; readonly files?: readonly string[] };
          deleted = gone.deleted === true ? (gone.files ?? []) : [];
          outcomes.push("output");
          moved += renamed.length;
          removed += deleted.length;
        } catch {
          outcomes.push("error");
        }
        const filesAfter = new Set(filesBelow(fixture.root));
        // Only a rename of a saved file moves one and only a delete of one removes it (SR-217, D-056:
        // no element); no other file goes.
        expect(
          renamed.every((r) => RENAMES.has(name) && filesAfter.has(r.to) && !r.from.endsWith(".md")),
        ).toBe(true);
        expect(deleted.every((file) => DELETES.has(name) && file.endsWith(".yaml"))).toBe(true);
        expect(filesBefore.filter((file) => !filesAfter.has(file))).toEqual([
          ...renamed.map((r) => r.from),
          ...deleted,
        ]);
        const idsAfter = new Set(await ids());
        expect(idsBefore.filter((id) => !idsAfter.has(id))).toEqual([]);
      }
      // Each command both writes and fails at least once, so the check covers both paths.
      expect(outcomes).toContain("output");
      expect(outcomes).toContain("error");
      // A rename command renames a file at least once, so the allowance above is shown to hold.
      expect(moved > 0).toBe(RENAMES.has(name));
      // A delete command deletes a file once, so the allowance above is shown to hold.
      expect(removed).toBe(DELETES.has(name) ? 1 : 0);
    });
  }

  it("[SR-099/AK-nbg9] only the files module removes or renames files", () => {
    const src = path.resolve(import.meta.dirname, "..");
    const sources = fs
      .readdirSync(src, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".test.ts"))
      .map((e) => path.relative(src, path.join(e.parentPath, e.name)).split(path.sep).join("/"));
    const read = (file: string): string => fs.readFileSync(path.join(src, file), "utf8");
    const removing = sources
      .filter((file) =>
        /\b(?:rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync|rename|renameSync)\(/.test(read(file)),
      )
      .sort();
    expect(removing).toEqual(["files/lock.ts", "files/private.ts", "files/write.ts"]);
    // The one delete of a file the user wrote, the file of a perspective or saved filter (SR-217 AK5).
    const deleting = sources
      .filter((file) => !file.startsWith("files/") && /\bdeleteSavedFile\b/.test(read(file)))
      .sort();
    expect(deleting).toEqual(["query/saved-delete.ts"]);
  });
});

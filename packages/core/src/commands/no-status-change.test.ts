// SR-087 (D-030, D-044, ADR-0002 rule 6): the tool changes the status of an element only when it is
// set (`element.setStatus`) or the element is superseded (`element.supersede`). Every other implemented
// command, read or write, runs here on elements of several statuses, among them one the metamodel does
// not know; afterwards every element file has the `status` line it had. The status is read from the
// files on disk, not from the element store. Loading, the watcher (SR-007) and a changed metamodel
// (SR-015) change no status either. Confirming a hint (AK2) writes the files of approved, obsolete
// and draft elements here; importing a delivery (AK2) is not implemented yet, and by #127 option 1
// the guard below adds it to the scenarios once it is.
import fs from "node:fs";
import path from "node:path";
import { createFixtureWorkspace, untilWatching } from "@logreq/testkit";
import type { FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { metamodelState } from "../metamodel/index.js";
import { elementStoreState, watchWorkspace } from "../model/index.js";
import { loadContracts } from "../runtime/contracts.js";
import { createCommandRuntime } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { commands } from "./index.js";

const contracts = loadContracts();
const runtime = createCommandRuntime({ commands });

/** The two commands that may change a status (SR-087 text). */
const STATUS_COMMANDS = ["element.setStatus", "element.supersede"];
/** Commands of AK2 that are in the catalog; each one needs a scenario once it is implemented. */
const AK2_COMMANDS = ["hint.confirm", "reqif.import"];

const WIND = "e8df96ea-a168-4d90-8d65-6328cee88fb3";
const GUSTS = "3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c";
const OBSOLETE = "0b7c6e1a-1111-4222-8333-444455556666";
const APPROVED = "0b7c6e1a-1111-4222-8333-aaaaaaaaaaaa";
const RETIRED = "0b7c6e1a-1111-4222-8333-bbbbbbbbbbbb";

/** A relation to an outdated version of WIND, as SR-001/two-elements has one from GUSTS, so `hint.confirm` writes. */
const OUTDATED = `derives-from:\n  - { id: ${WIND}, version: n1:0000000000000000 }\n`;

/** The hint ID of the outdated derivation of `source` in `file` (hints/hint-id.ts). */
const hintId = (file: string, source: string, target: string): string =>
  `relation.outdated/system/${encodeURIComponent(file)}/${source}/derives-from/${target}?version=n1:0000000000000000`;

/** A file of fixtures/enabler-535/evidence: an evidence location with a Markdown record and an enriched JUnit file. */
const evidenceFixture = (file: string): string =>
  fs.readFileSync(new URL(`../../../../fixtures/enabler-535/evidence/${file}`, import.meta.url), "utf8");

/** The evidence files every scenario has (#535); read once the readers are in (SR-028, SR-093). */
const EVIDENCE_RECORD = "evidence/2026-10-20-SR-e88fb3-inspection.md";
const EVIDENCE_JUNIT = "evidence/ci/results.xml";

/**
 * A JUnit file outside the evidence folder that is not enriched yet, naming elements of every status
 * by short ID (WIND draft, APPROVED, OBSOLETE, RETIRED), so evidence.enrichJunit writes (SR-029).
 */
const RAW_JUNIT = "results/raw.xml";
const RAW_JUNIT_TEXT =
  '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n  <testsuite name="station">\n' +
  ["SR-e88fb3", "N-aaaaaa", "SR-556666", "N-bbbbbb"]
    .map((ref) => `    <testcase classname="station" name="[${ref}] is checked"/>\n`)
    .join("") +
  "  </testsuite>\n</testsuites>\n";

/**
 * Added to SR-001/two-elements: elements approved, obsolete, and `retired`, which the metamodel
 * does not know; an evidence location with a Markdown record and an enriched JUnit file of WIND.
 */
const FILES: Readonly<Record<string, string>> = {
  "logreq-workspace.yaml": evidenceFixture("logreq-workspace.yaml"),
  [EVIDENCE_RECORD]: evidenceFixture(EVIDENCE_RECORD),
  [EVIDENCE_JUNIT]: evidenceFixture(EVIDENCE_JUNIT),
  [RAW_JUNIT]: RAW_JUNIT_TEXT,
  "requirements/SR-444455556666.md": `---\nid: ${OBSOLETE}\ntype: system-requirement\nstatus: obsolete\ntitle: Old\n${OUTDATED}---\n`,
  "needs/N-aaaaaaaaaaaa.md": `---\nid: ${APPROVED}\ntype: need\nstatus: approved\ntitle: Need\n${OUTDATED}---\n`,
  "needs/N-bbbbbbbbbbbb.md": `---\nid: ${RETIRED}\ntype: need\nstatus:   retired   # unknown to the metamodel\ntitle: Retired need\n${OUTDATED}---\n`,
  "new/.keep": "",
  "new/layout.png": "an image",
};

/** The `status` line of every element file, and null for the evidence record, by file (relative, `/`), as written on disk. */
const STATUS_LINES: Readonly<Record<string, string | null>> = {
  [EVIDENCE_RECORD]: null,
  "needs/N-aaaaaaaaaaaa.md": "status: approved",
  "needs/N-bbbbbbbbbbbb.md": "status:   retired   # unknown to the metamodel",
  "requirements/SR-1d2e3f4a5b6c.md": "status: draft",
  "requirements/SR-444455556666.md": "status: obsolete",
  "requirements/SR-6328cee88fb3.md": "status: draft",
};

type Scenario = Readonly<Record<string, unknown>>;

/** Every implemented command except the two status commands, with calls that succeed and calls that fail. */
const SCENARIOS: Readonly<Record<string, readonly Scenario[]>> = {
  "data.export": [
    {},
    { selection: { where: { any: [{ status: ["retired"] }, { invalid: true }] } } },
    { selection: { ids: [WIND, OBSOLETE, RETIRED], view: "core" } },
    { selection: { baseline: "nope" } },
  ],
  "element.addAttachment": [
    { ref: WIND, sourcePath: "new/layout.png" },
    { ref: OBSOLETE, sourcePath: "new/layout.png" },
    { ref: APPROVED, sourcePath: "new/layout.png" },
    { ref: RETIRED, sourcePath: "new/layout.png" },
    { ref: WIND, sourcePath: "new/.keep" },
  ],
  "element.bulkUpdate": [
    { selection: {}, property: "rationale", operation: "set", value: "Changed together", confirm: true },
    { selection: { where: { type: ["need"] } }, property: "topic", operation: "set", value: "Wind" },
    {
      selection: { ids: [WIND, OBSOLETE] },
      property: "acceptance-criteria",
      operation: "add",
      value: "New",
      confirm: true,
    },
    { selection: {}, property: "rationale", operation: "remove", confirm: true },
    { selection: {}, property: "status", operation: "set", value: "approved", confirm: true },
    { selection: { ids: [RETIRED] }, property: "status", operation: "remove", confirm: true },
  ],
  "element.create": [
    { type: "system-requirement", title: "Show gusts", folder: "requirements" },
    { type: "need", title: "New need", folder: "needs" },
    { type: "decision", title: "New decision", folder: "new" },
    { type: "nope", title: "Unknown type" },
  ],
  "element.facets": [
    {},
    { selection: { where: { status: ["retired"] } } },
    { selection: { ids: ["SR-ffffff"] } },
  ],
  "element.get": [{ ref: WIND }, { ref: OBSOLETE }, { ref: RETIRED }, { ref: "SR-ffffff" }],
  "element.list": [
    {},
    { selection: { where: { any: [{ status: ["retired"] }, { invalid: true }] } }, withText: true },
    { selection: { ids: [WIND, RETIRED], view: "core" } },
    { selection: { where: { relation: { meaning: "derivation", direction: "down" }, exists: false } } },
    { selection: { ids: ["SR-ffffff"] } },
  ],
  "element.resolve": [{ ref: WIND, version: "n1:0000000000000000" }, { ref: RETIRED }, { ref: "SR-ffffff" }],
  "element.search": [
    { query: "approved" },
    { query: "wind", selection: { where: { text: "retired" } } },
    { query: "obsolete", selection: { ids: [RETIRED] } },
    { query: "wind", selection: { ids: ["SR-ffffff"] } },
  ],
  "element.update": [
    { ref: WIND, title: "Renamed", text: "" },
    { ref: GUSTS, text: "New text\n", set: { rationale: "Why", "requirement-type": "quality" } },
    { ref: GUSTS, unset: ["acceptance-criteria", "rationale"] },
    { ref: OBSOLETE, title: "Still old", set: { "verification-method": "test" } },
    { ref: APPROVED, text: "approved stays\n" },
    { ref: RETIRED, title: "Still retired", text: "retired stays\n" },
    { ref: WIND, set: { status: "approved" } },
    { ref: WIND, unset: ["status"] },
    { ref: "SR-ffffff", title: "Unknown element" },
  ],
  "evidence.coverage": [
    {},
    { selection: { where: { any: [{ status: ["retired"] }, { invalid: true }] }, view: "core" } },
    { selection: { ids: [WIND, OBSOLETE, RETIRED] } },
    { selection: { ids: ["SR-ffffff"] } },
  ],
  "evidence.degree": [
    {},
    { selection: { where: { any: [{ status: ["retired"] }, { invalid: true }] }, view: "core" } },
    { selection: { ids: [WIND, OBSOLETE, RETIRED] } },
    { selection: { ids: ["SR-ffffff"] } },
  ],
  "evidence.enrichJunit": [
    { file: RAW_JUNIT, item: "build-513", date: "2026-10-27T10:00:00Z", output: "evidence/ci/raw.xml" },
    { file: RAW_JUNIT, item: "build-513", date: "2026-10-27T10:00:00Z" },
    { file: EVIDENCE_JUNIT, item: "build-514" },
    { file: "results/gone.xml", item: "build-513" },
  ],
  "evidence.list": [{ ref: WIND }, { ref: OBSOLETE, view: "core" }, { ref: "SR-ffffff" }],
  // Records of every status (SR-030): a verification and a validation of the requirements, validations
  // of the approved and the retired need; a verification of a need is refused (D-012).
  "evidence.record": [
    {
      ref: WIND,
      kind: "verification",
      result: "passed",
      method: "inspection",
      item: "unit 7",
      date: "2026-10-27T10:00:00Z",
    },
    {
      ref: OBSOLETE,
      kind: "verification",
      result: "failed",
      method: "test",
      item: "build-513",
      date: "2026-10-27T10:00:00Z",
    },
    { ref: WIND, kind: "validation", result: "passed", date: "2026-10-27T10:00:00Z" },
    { ref: OBSOLETE, kind: "validation", result: "failed", date: "2026-10-27T10:00:00Z" },
    { ref: APPROVED, kind: "validation", result: "passed", date: "2026-10-27T10:00:00Z" },
    { ref: RETIRED, kind: "validation", result: "failed", date: "2026-10-27T10:00:00Z" },
    {
      ref: APPROVED,
      kind: "verification",
      result: "passed",
      method: "test",
      item: "build-513",
      date: "2026-10-27T10:00:00Z",
    },
  ],
  "evidence.status": [
    {},
    { selection: { where: { verification: ["open", "verified"] } }, limit: 1 },
    { selection: { ids: [WIND, RETIRED], view: "core" } },
    { selection: { ids: ["SR-ffffff"] } },
  ],
  "filter.list": [{}, { extra: true }],
  "filter.save": [
    { name: "Drafts", where: { status: ["draft"] }, sort: [{ by: "status" }] },
    { name: "drafts", where: { any: [{ status: ["retired"] }, { invalid: true }] } },
    { name: "Retired", where: { status: ["retired"] } },
    { name: "Unknown", where: { package: "SR-ffffff" } },
  ],
  "hint.confirm": [
    { hintIds: [hintId("requirements/SR-1d2e3f4a5b6c.md", GUSTS, WIND)] },
    {
      hintIds: [
        hintId("needs/N-aaaaaaaaaaaa.md", APPROVED, WIND),
        hintId("requirements/SR-444455556666.md", OBSOLETE, WIND),
      ],
    },
    { hintIds: ["element.unknown-property", hintId("requirements/SR-1d2e3f4a5b6c.md", GUSTS, WIND)] },
    { hintIds: [hintId("needs/N-bbbbbbbbbbbb.md", RETIRED, WIND)] },
    {},
  ],
  "hint.list": [{}, { kind: ["relation.outdated"], type: ["need"] }, { ref: OBSOLETE }, { ref: "SR-ffffff" }],
  "metamodel.get": [{}, { extra: true }],
  "relation.add": [
    { source: GUSTS, kind: "replaces", target: OBSOLETE },
    { source: APPROVED, kind: "refines", target: RETIRED },
    { source: RETIRED, kind: "refines", target: WIND },
    { source: APPROVED, kind: "derives-from", target: GUSTS },
  ],
  "relation.options": [{ ref: WIND }, { ref: RETIRED, kind: "refines" }, { ref: "SR-ffffff" }],
  "relation.remove": [
    { source: GUSTS, kind: "derives-from", target: WIND },
    { source: APPROVED, kind: "refines", target: RETIRED },
    { source: "SR-ffffff", kind: "refines", target: WIND },
  ],
  "trace.affected": [{ ref: WIND }, { ref: OBSOLETE }, { ref: RETIRED }, { ref: "SR-ffffff" }],
  "trace.chain": [
    { ref: WIND },
    { ref: APPROVED, direction: "down", view: "core" },
    { ref: RETIRED, direction: "up" },
    { ref: "SR-ffffff" },
  ],
  "trace.graph": [
    { ref: WIND },
    { ref: APPROVED, allLevels: true, view: "core" },
    { ref: RETIRED, meanings: ["derivation"], limit: 2 },
    { ref: "SR-ffffff" },
  ],
  "trace.matrix": [
    {},
    { selection: { ids: [APPROVED, WIND] }, sort: [{ by: "hierarchy" }] },
    { kinds: ["nope"] },
  ],
  "trace.neighbourhood": [
    { ref: WIND },
    { ref: APPROVED, direction: "down", view: "core" },
    { ref: RETIRED, allLevels: true },
    { ref: "SR-ffffff" },
  ],
  "trace.related": [
    { refs: [WIND, APPROVED, RETIRED, OBSOLETE], direction: "children" },
    { refs: [GUSTS, OBSOLETE, RETIRED], direction: "parents", view: "core" },
    { refs: ["SR-ffffff"], direction: "children" },
  ],
  "workspace.activity": [{}, { extra: true }],
  "workspace.check": [
    {},
    { severity: "error" },
    { changedFiles: ["needs/N-aaaaaaaaaaaa.md"] },
    { changedSince: "main" },
  ],
  "workspace.init": [
    { path: "new", name: "New" },
    { path: ".", name: "Again" },
  ],
  "workspace.recent": [{}, { extra: true }],
  "workspace.status": [{}, { extra: true }],
};

/** The `status` line of every Markdown file below `root` that has one (null without), except Git's own. */
const statusLines = (root: string): Record<string, string | null> => {
  const out: Record<string, string | null> = {};
  const files = fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => path.relative(root, path.join(e.parentPath, e.name)).split(path.sep).join("/"))
    .filter((file) => !file.split("/").includes(".git"))
    .sort();
  for (const file of files) {
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(path.join(root, file), "utf8"))?.[1];
    out[file] = /^status:.*$/m.exec(frontmatter ?? "")?.[0] ?? null;
  }
  return out;
};

/** The bytes of each of `files` (relative to `root`), base64. */
const contents = (root: string, files: readonly string[]): Record<string, string> =>
  Object.fromEntries(files.map((file) => [file, fs.readFileSync(path.join(root, file), "base64")]));

/** Expects every file of `before` to have the status line it had. */
const expectKept = (root: string, before: Readonly<Record<string, string | null>>): void => {
  const after = statusLines(root);
  for (const [file, line] of Object.entries(before)) {
    expect([file, after[file]]).toEqual([file, line]);
  }
};

const open = async (): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-001/two-elements", files: FILES });
  const workspace = new Workspace(fixture.root);
  onTestFinished(async () => {
    await workspace.close();
    await fixture.cleanup();
  });
  return { fixture, workspace };
};

describe("no status change by itself (SR-087, D-030, ADR-0002 rule 6)", () => {
  it("[SR-087/AK1] has a scenario for every implemented command except element.setStatus and element.supersede", () => {
    const implemented = contracts.commands
      .map((c) => c.name)
      .filter((name) => runtime.commands.has(name))
      .sort();
    expect(STATUS_COMMANDS.filter((name) => !implemented.includes(name))).toEqual([]);
    expect(Object.keys(SCENARIOS).sort()).toEqual(
      implemented.filter((name) => !STATUS_COMMANDS.includes(name)),
    );
  });

  it("[SR-087/AK2] hint.confirm and reqif.import get a scenario as soon as they are implemented", () => {
    const names = contracts.commands.map((c) => c.name);
    for (const name of AK2_COMMANDS) {
      expect([name, names.includes(name)]).toEqual([name, true]);
      expect([name, runtime.commands.has(name)]).toEqual([name, name in SCENARIOS]);
    }
  });

  for (const [name, scenarios] of Object.entries(SCENARIOS)) {
    const ak = AK2_COMMANDS.includes(name) ? "AK2" : "AK1";
    it(`[SR-087/${ak}] ${name} changes no status`, async () => {
      const { fixture, workspace } = await open();
      expect(statusLines(fixture.root)).toEqual(STATUS_LINES);
      const outcomes: string[] = [];
      for (const input of scenarios) {
        const before = statusLines(fixture.root);
        try {
          await runtime.invoke(name, input, { workspace });
          outcomes.push("output");
        } catch {
          outcomes.push("error");
        }
        expectKept(fixture.root, before);
      }
      // Each command both succeeds and fails at least once, so the check covers both paths.
      expect(outcomes).toContain("output");
      expect(outcomes).toContain("error");
      // A created element has the initial status; it is no change of a status.
      // A record (evidence.record, SR-030) has no status; every other new Markdown file is an element.
      const added = Object.entries(statusLines(fixture.root)).filter(
        ([file]) =>
          !(file in STATUS_LINES) &&
          !fs.readFileSync(path.join(fixture.root, file), "utf8").startsWith("---\nlogreq-record: 1\n"),
      );
      expect(added.map(([, line]) => line).filter((line) => line !== "status: draft")).toEqual([]);
      if (name === "element.create") {
        expect(added).toHaveLength(3);
      }
    });
  }

  it("[SR-087/AK2] hint.confirm writes the new version into files of every status and keeps each status", async () => {
    const { fixture, workspace } = await open();
    const sources = [
      ["requirements/SR-1d2e3f4a5b6c.md", GUSTS],
      ["requirements/SR-444455556666.md", OBSOLETE],
      ["needs/N-aaaaaaaaaaaa.md", APPROVED],
    ] as const;
    const before = contents(fixture.root, Object.keys(STATUS_LINES));
    const out = await runtime.invoke(
      "hint.confirm",
      { hintIds: sources.map(([file, id]) => hintId(file, id, WIND)) },
      { workspace },
    );
    expect(out).toMatchObject({ files: sources.map(([file]) => file), problems: [] });
    const after = contents(fixture.root, Object.keys(STATUS_LINES));
    expect(Object.keys(after).filter((file) => after[file] !== before[file])).toEqual(
      sources.map(([file]) => file).sort(),
    );
    expect(statusLines(fixture.root)).toEqual(STATUS_LINES);
    // A status the metamodel does not know stays as written too.
    await expect(
      runtime.invoke(
        "hint.confirm",
        { hintIds: [hintId("needs/N-bbbbbbbbbbbb.md", RETIRED, WIND)] },
        { workspace },
      ),
    ).resolves.toMatchObject({ files: ["needs/N-bbbbbbbbbbbb.md"] });
    expect(statusLines(fixture.root)).toEqual(STATUS_LINES);
  });

  it("[SR-087/AK1] evidence.enrichJunit writes a JUnit file that names elements of every status and changes no status", async () => {
    const { fixture, workspace } = await open();
    const out = await runtime.invoke(
      "evidence.enrichJunit",
      { file: RAW_JUNIT, item: "build-513", date: "2026-10-27T10:00:00Z" },
      { workspace },
    );
    expect(out).toEqual({ testCases: 4, unknown: [], files: [RAW_JUNIT], problems: [] });
    expect(fs.readFileSync(fixture.path(RAW_JUNIT), "utf8").match(/logreq:version/g)).toHaveLength(4);
    expect(statusLines(fixture.root)).toEqual(STATUS_LINES);
  });

  it("[SR-087/AK1] element.setStatus and element.supersede change only the status of the elements they name", async () => {
    const { fixture, workspace } = await open();
    await runtime.invoke("element.setStatus", { refs: [WIND], status: "approved" }, { workspace });
    expect(statusLines(fixture.root)).toEqual({
      ...STATUS_LINES,
      "requirements/SR-6328cee88fb3.md": "status: approved",
    });
    await runtime.invoke(
      "element.supersede",
      { ref: GUSTS, status: "obsolete", successor: WIND, relation: "supersedes" },
      { workspace },
    );
    expect(statusLines(fixture.root)).toEqual({
      ...STATUS_LINES,
      "requirements/SR-6328cee88fb3.md": "status: approved",
      "requirements/SR-1d2e3f4a5b6c.md": "status: obsolete",
    });
  });

  it("[SR-087/AK1] keeps a status that the metamodel does not know", async () => {
    const { fixture, workspace } = await open();
    const store = await workspace.get(elementStoreState);
    expect(store.elements.find((e) => e.id === RETIRED)?.data["status"]).toBe("retired");
    await runtime.invoke("element.update", { ref: RETIRED, title: "Renamed" }, { workspace });
    await runtime.invoke("element.setStatus", { refs: [APPROVED], status: "draft" }, { workspace });
    await expect(
      runtime.invoke("element.setStatus", { refs: [WIND], status: "retired" }, { workspace }),
    ).rejects.toMatchObject({ code: "input.invalid" });
    expect(statusLines(fixture.root)).toEqual({
      ...STATUS_LINES,
      "needs/N-aaaaaaaaaaaa.md": "status: draft",
    });
  });

  it("[SR-087/AK2] loading, the watcher and a changed metamodel change no status, and writes keep it", async () => {
    const { fixture, workspace } = await open();
    const elementFiles = Object.keys(STATUS_LINES);
    const bytes = contents(fixture.root, elementFiles);
    // Loading the store and the metamodel, and starting the real watcher (SR-007).
    await workspace.get(elementStoreState);
    await workspace.get(metamodelState);
    await watchWorkspace(workspace).ready;
    await untilWatching({
      probe: async (attempt) => {
        await workspace.get(metamodelState);
        await fixture.write("metamodel/probe.txt", `Probe ${String(attempt)}\n`);
      },
      seen: () => Promise.resolve(workspace.peek(metamodelState) === undefined),
    });
    // The metamodel is saved without `approved` (SR-015); the tool picks it up (bounded loosely for slow runners).
    const model = "metamodel/standard-model.yaml";
    const text = fs.readFileSync(fixture.path(model), "utf8");
    const changed = text.replace("  - { key: approved, name: Approved }\n", "");
    expect(changed).not.toBe(text);
    await fixture.write(model, changed);
    const deadline = performance.now() + 10_000;
    for (;;) {
      const statuses = (await workspace.get(metamodelState)).statuses.map((s) => s.key);
      if (!statuses.includes("approved")) {
        break;
      }
      expect(performance.now()).toBeLessThan(deadline);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await watchWorkspace(workspace).settled();
    expect(contents(fixture.root, elementFiles)).toEqual(bytes);

    // The tool writes files with the changed metamodel: `approved` and `retired` stay as they are.
    await runtime.invoke("element.update", { ref: APPROVED, title: "Still approved" }, { workspace });
    await runtime.invoke("element.update", { ref: RETIRED, text: "Still retired\n" }, { workspace });
    await runtime.invoke(
      "element.create",
      { type: "need", title: "Another", folder: "needs" },
      { workspace },
    );
    await expect(
      runtime.invoke("element.setStatus", { refs: [WIND], status: "approved" }, { workspace }),
    ).rejects.toMatchObject({ code: "input.invalid" });
    await watchWorkspace(workspace).settled();
    const after = statusLines(fixture.root);
    expectKept(fixture.root, STATUS_LINES);
    expect(
      Object.keys(after)
        .filter((file) => !(file in STATUS_LINES))
        .map((file) => after[file]),
    ).toEqual(["status: draft"]);
  }, 30_000);
});

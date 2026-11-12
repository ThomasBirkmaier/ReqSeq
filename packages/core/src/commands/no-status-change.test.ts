// SR-087 (D-030, D-044, ADR-0002 rule 6): the tool changes the status of an element only when it is
// set (`element.setStatus`) or the element is superseded (`element.supersede`). Every other implemented
// command, read or write, runs here on elements of several statuses, among them one the metamodel does
// not know; afterwards every element file has the `status` line it had. The status is read from the
// files on disk, not from the element store. Loading, the watcher (SR-007) and a changed metamodel
// (SR-015) change no status either. Confirming a hint (AK2) writes the files of approved and draft
// elements and of one with a status the metamodel does not know here (an obsolete source has no hint
// to confirm, SR-025 AK5); importing a delivery (AK2) creates new elements with the initial status
// only (SR-053), and a changed delivery of the same source updates them without their status
// (SR-056).
import fs from "node:fs";
import path from "node:path";
import { createFixtureWorkspace, untilWatching } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { metamodelState } from "../metamodel/index.js";
import { elementStoreState, watchWorkspace } from "../model/index.js";
import { loadContracts } from "../runtime/contracts.js";
import { createCommandRuntime } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { commands } from "./index.js";
import {
  APPROVED,
  EVIDENCE_RECORD,
  FILES,
  GIT_COMMANDS,
  GUSTS,
  hintId,
  OBSOLETE,
  RAW_JUNIT,
  RETIRED,
  SCENARIOS,
  VARIANT_FILE,
  WIND,
} from "./scenarios.test-helper.js";
import { readFirst } from "../runtime/read-first.test-helper.js";

const contracts = loadContracts();
const runtime = createCommandRuntime({ commands });

/** The two commands that may change a status (SR-087 text). */
const STATUS_COMMANDS = ["element.setStatus", "element.supersede"];
/** Commands of AK2 that are in the catalog; each one needs a scenario once it is implemented. */
const AK2_COMMANDS = ["hint.confirm", "reqif.import"];

/** The `status` line of every element file, and null for the evidence record, by file (relative, `/`), as written on disk. */
const STATUS_LINES: Readonly<Record<string, string | null>> = {
  [EVIDENCE_RECORD]: null,
  "needs/N-aaaaaaaaaaaa.md": "status: approved",
  "needs/N-bbbbbbbbbbbb.md": "status:   retired   # unknown to the metamodel",
  "requirements/SR-1d2e3f4a5b6c.md": "status: draft",
  "requirements/SR-444455556666.md": "status: obsolete",
  "requirements/SR-6328cee88fb3.md": "status: draft",
  [VARIANT_FILE]: "status: approved",
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

const open = async (git = false): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> => {
  const fixture = await createFixtureWorkspace({
    fixture: "SR-001/two-elements",
    files: FILES,
    ...(git ? { git: true } : {}),
  });
  const workspace = new Workspace(fixture.root);
  onTestFinished(async () => {
    await workspace.close();
    await fixture.cleanup();
  });
  return { fixture, workspace };
};

describe("no status change by itself (SR-087, D-030, ADR-0002 rule 6)", () => {
  it("[SR-087/AK-pjbh] has a scenario for every implemented command except element.setStatus and element.supersede", () => {
    const implemented = contracts.commands
      .map((c) => c.name)
      .filter((name) => runtime.commands.has(name))
      .sort();
    expect(STATUS_COMMANDS.filter((name) => !implemented.includes(name))).toEqual([]);
    expect(Object.keys(SCENARIOS).sort()).toEqual(
      implemented.filter((name) => !STATUS_COMMANDS.includes(name)),
    );
  });

  it("[SR-087/AK-v0p5] hint.confirm and reqif.import get a scenario as soon as they are implemented", () => {
    const names = contracts.commands.map((c) => c.name);
    for (const name of AK2_COMMANDS) {
      expect([name, names.includes(name)]).toEqual([name, true]);
      expect([name, runtime.commands.has(name)]).toEqual([name, name in SCENARIOS]);
    }
  });

  for (const [name, scenarios] of Object.entries(SCENARIOS)) {
    // The whole tag in one string, so that scripts/criterion-keys/rename-tags.mjs renames it (#1419).
    const tag = AK2_COMMANDS.includes(name) ? "[SR-087/AK-v0p5]" : "[SR-087/AK-pjbh]";
    it(`${tag} ${name} changes no status`, async () => {
      const { fixture, workspace } = await open(GIT_COMMANDS.has(name));
      expect(statusLines(fixture.root)).toEqual(STATUS_LINES);
      if (name === "baseline.compare" || name === "baseline.get") {
        // A baseline to read, made by baseline.create (its own scenario above).
        await runtime.invoke("baseline.create", { name: "Base", selection: { ids: [WIND] } }, { workspace });
      }
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
          !fs.readFileSync(path.join(fixture.root, file), "utf8").startsWith("---\nreqseq-record: 1\n"),
      );
      expect(added.map(([, line]) => line).filter((line) => line !== "status: draft")).toEqual([]);
      if (name === "element.create") {
        expect(added).toHaveLength(3);
      }
    });
  }

  it("[SR-087/AK-v0p5] hint.confirm writes the new version into the files of every status that has hints, and keeps each status", async () => {
    const { fixture, workspace } = await open();
    const sources = [
      ["requirements/SR-1d2e3f4a5b6c.md", GUSTS],
      ["needs/N-aaaaaaaaaaaa.md", APPROVED],
    ] as const;
    const obsolete = hintId("requirements/SR-444455556666.md", OBSOLETE, WIND);
    const before = contents(fixture.root, Object.keys(STATUS_LINES));
    const out = await runtime.invoke(
      "hint.confirm",
      { hintIds: [...sources.map(([file, id]) => hintId(file, id, WIND)), obsolete] },
      { workspace },
    );
    // The obsolete source has no open hint (SR-025 AK5): its file is not written.
    expect(out).toMatchObject({
      files: sources.map(([file]) => file),
      problems: [{ code: "hint.not-found", hintId: obsolete }],
    });
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

  it("[SR-087/AK-pjbh] evidence.enrichJunit writes a JUnit file that names elements of every status and changes no status", async () => {
    const { fixture, workspace } = await open();
    const out = await runtime.invoke(
      "evidence.enrichJunit",
      { file: RAW_JUNIT, item: "build-513", date: "2026-10-27T10:00:00Z" },
      { workspace },
    );
    // The two needs give a kind warning each (#843), which changes no status either.
    expect(out).toMatchObject({ testCases: 4, withoutReference: 0, unknown: [], files: [RAW_JUNIT] });
    expect((out as { problems: { code: string }[] }).problems.map((p) => p.code)).toEqual([
      "evidence.kind-mismatch",
      "evidence.kind-mismatch",
    ]);
    expect(fs.readFileSync(fixture.path(RAW_JUNIT), "utf8").match(/reqseq:version/g)).toHaveLength(4);
    expect(statusLines(fixture.root)).toEqual(STATUS_LINES);
  });

  it("[SR-087/AK-pjbh] data.store stores elements of every status with Git, refuses a folder, and changes no status", async () => {
    const { fixture, workspace } = await open(true);
    const commit = await fixture.head();
    const out = await runtime.invoke("data.store", { folder: "out" }, { workspace });
    expect(out).toEqual({ files: [`out/${commit}.jsonl`], problems: [] });
    // One element per line (#319).
    const lines = fs
      .readFileSync(fixture.path(`out/${commit}.jsonl`), "utf8")
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as { status: string });
    expect(new Set(lines.map((e) => e.status))).toEqual(
      new Set(["draft", "approved", "obsolete", "retired"]),
    );
    await expect(runtime.invoke("data.store", { folder: "out/.git" }, { workspace })).rejects.toMatchObject({
      code: "input.invalid",
    });
    expect(statusLines(fixture.root)).toEqual(STATUS_LINES);
  });

  it("[SR-087/AK-pjbh] element.setStatus and element.supersede change only the status of the elements they name", async () => {
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

  it("[SR-087/AK-pjbh] keeps a status that the metamodel does not know", async () => {
    const { fixture, workspace } = await open();
    const store = await workspace.get(elementStoreState);
    expect(store.elements.find((e) => e.id === RETIRED)?.data["status"]).toBe("retired");
    await runtime.invoke(
      "element.update",
      await readFirst({ ref: RETIRED, title: "Renamed" }, { workspace }),
      { workspace },
    );
    await runtime.invoke("element.setStatus", { refs: [APPROVED], status: "draft" }, { workspace });
    await expect(
      runtime.invoke("element.setStatus", { refs: [WIND], status: "retired" }, { workspace }),
    ).rejects.toMatchObject({ code: "input.invalid" });
    expect(statusLines(fixture.root)).toEqual({
      ...STATUS_LINES,
      "needs/N-aaaaaaaaaaaa.md": "status: draft",
    });
  });

  it("[SR-087/AK-v0p5] loading, the watcher and a changed metamodel change no status, and writes keep it", async () => {
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
    const changed = text.replace(
      '  - { key: approved, name: Approved, description: "Agreed and valid." }\n',
      "",
    );
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
    await runtime.invoke(
      "element.update",
      await readFirst({ ref: APPROVED, title: "Still approved" }, { workspace }),
      { workspace },
    );
    await runtime.invoke(
      "element.update",
      await readFirst({ ref: RETIRED, text: "Still retired\n" }, { workspace }),
      { workspace },
    );
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

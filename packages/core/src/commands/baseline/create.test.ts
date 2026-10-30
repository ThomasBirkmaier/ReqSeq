// baseline.create through `invoke` (SR-050) on fixtures/SR-061/export (main repository `system` with
// the metamodel, the baseline „Release 1“ and the saved filter `Functional`; repository `sensor`;
// its README lists the elements and versions). The CLI end to end: packages/cli/test/e2e/baseline-create.test.ts.
import fs from "node:fs";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { readBaselines } from "../../baselines/index.js";
import { scanBaseline } from "../../baselines/scan.js";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import * as model from "../../model/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
import { workspaceLayoutState } from "../../workspace/index.js";

vi.mock("../../model/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof model>();
  return { ...original, currentVersionsOf: vi.fn(original.currentVersionsOf) };
});

type Output = CommandOutput<"baseline.create">;

const ID = "61061061-0000-4000-8000-0000000000";
const B1 = `  - { id: ${ID}b1, version: n1:697a2ad17ed49170 }`;
const B2 = `  - { id: ${ID}b2, version: n1:077d46fbf1a6a93d }`;
const E1 = `  - { id: ${ID}e1, version: n1:31d60ac7c791e279, repository: sensor }`;
const PACKAGE = { package: "PKG-0000d1" };
const NOW = new Date("2026-11-02T13:00:00.250Z");

const fixture = async (git: FixtureOptions["git"] = ["system", "sensor"]): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace({ fixture: "SR-061/export", git });
  onTestFinished(() => created.cleanup());
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  return created;
};

/** baseline.create on a fresh workspace object of `system`, so every call reads the files as they are. */
const create = async (ws: FixtureWorkspace, name: string, selection: object): Promise<Output> => {
  const workspace = new Workspace(ws.path("system"));
  try {
    return (await invoke("baseline.create", { name, selection }, { workspace })) as Output;
  } finally {
    await workspace.close();
  }
};

const failure = async (ws: FixtureWorkspace, name: string, selection: object): Promise<CommandError> => {
  const error = await create(ws, name, selection).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(CommandError);
  return error as CommandError;
};

const read = (ws: FixtureWorkspace, file: string): string =>
  fs.readFileSync(ws.path(`system/${file}`), "utf8");

/** The repositories lines of the file of `out` and its elements lines. */
const bodyOf = (ws: FixtureWorkspace, out: Output): string =>
  read(ws, out.baseline.file).slice(read(ws, out.baseline.file).indexOf("repositories:"));

describe("baseline.create", () => {
  it("[SR-050/AK1] [SR-101/AK1] baseline.create writes a file in the baseline folder with name, date, commits and id plus version, for exactly the elements of the package", async () => {
    const ws = await fixture();
    const head = await ws.head("system");
    const out = await create(ws, "Release 2", PACKAGE);
    const file = "baselines/Release-2.yaml";
    expect(out).toEqual({
      files: [file],
      baseline: { name: "Release 2", file, repository: "system", date: "2026-11-02T13:00:00Z", elements: 2 },
    });
    const text = [
      "reqseq-baseline: 1",
      "name: Release 2",
      "date: 2026-11-02T13:00:00Z",
      "selection:",
      `  package: { id: ${ID}d1, title: Display }`,
      "repositories:",
      `  - { name: system, commit: ${head} }`,
      "elements:",
      B1,
      B2,
      "",
    ].join("\n");
    expect(read(ws, file)).toBe(text);
    // The fast reader reads it, and the reader names it at once; Git is not touched (SR-083).
    expect(scanBaseline(text)?.name).toBe("Release 2");
    const workspace = new Workspace(ws.path("system"));
    onTestFinished(() => workspace.close());
    const baselines = await readBaselines(await workspace.get(workspaceLayoutState));
    expect(baselines.baselines.map((b) => b.file)).toContain(file);
    expect(await ws.head("system")).toBe(head);
    expect(await ws.git(["status", "--porcelain"], "system")).toBe(`?? ${file}\n`);
  });

  it("[SR-050/AK2] uncommitted or never committed files of the selection, embedded files, metamodel or workspace file refuse the baseline; evidence records do not", async () => {
    const ws = await fixture();
    const b1 = { id: `${ID}b1`, repository: "system", file: "requirements/SR-0000000000b1.md" };
    const refused = async (change: () => Promise<void>): Promise<unknown> => {
      await change();
      const error = await failure(ws, "Changed", PACKAGE);
      expect(error.code).toBe("baseline.uncommitted-changes");
      await ws.git(["reset", "--hard", "-q"], "system");
      await ws.git(["clean", "-fdq"], "system");
      return error.details;
    };
    const append = (file: string, text: string) => async () =>
      fs.promises.appendFile(ws.path(`system/${file}`), text);
    expect(await refused(append(b1.file, "edited\n"))).toEqual({ elements: [b1], files: [] });
    for (const file of ["metamodel/standard-model.yaml", "reqseq-workspace.yaml"]) {
      expect(await refused(append(file, "# edited\n"))).toEqual({
        elements: [],
        files: [{ repository: "system", file }],
      });
    }
    const added = { id: `${ID}b9`, repository: "system", file: "requirements/SR-0000000000b9.md" };
    const addElement = async (): Promise<void> => {
      const b2 = read(ws, "requirements/SR-0000000000b2.md");
      await ws.write(`system/${added.file}`, b2.replace(`${ID}b2`, added.id));
    };
    expect(await refused(addElement)).toEqual({ elements: [added], files: [] });
    // An embedded image: committed, then changed.
    await ws.write("system/requirements/wind.png", "png");
    await fs.promises.appendFile(ws.path(`system/${b1.file}`), "![Wind](wind.png)\n");
    await ws.commit("system");
    expect(await refused(append("requirements/wind.png", "changed"))).toEqual({
      elements: [b1],
      files: [{ repository: "system", file: "requirements/wind.png" }],
    });
    // A committed metamodel file removed from disk, which the metamodel no longer lists.
    await ws.write("system/metamodel/extra.yaml", "reqseq-metamodel: 1\n");
    await ws.commit("system");
    const removeExtra = async (): Promise<void> => fs.promises.rm(ws.path("system/metamodel/extra.yaml"));
    expect(await refused(removeExtra)).toEqual({
      elements: [],
      files: [{ repository: "system", file: "metamodel/extra.yaml" }],
    });
    // Allowed: an element outside the selection, a new evidence record, a file touched but equal.
    await fs.promises.appendFile(ws.path("system/requirements/SR-0000000000b3.md"), "edited\n");
    await ws.write(
      "system/evidence/2026-11-01-SR-0000b1-test.md",
      read(ws, "evidence/2026-10-20-SR-0000b1-test.md"),
    );
    fs.writeFileSync(ws.path(`system/${b1.file}`), read(ws, b1.file));
    expect((await create(ws, "Allowed", PACKAGE)).baseline.elements).toBe(2);
  });

  it("refuses a view that differs from the saved filter's view and stores the same view once", async () => {
    const ws = await fixture();
    await ws.write(
      "system/filters/coast.yaml",
      "reqseq-filter: 1\nname: CoastOnly\nview: VAR-0000c1\nwhere: { all: [] }\n",
    );
    const error = await failure(ws, "X", { filter: "CoastOnly", view: "VAR-0000c2" });
    expect([error.code, error.details]).toEqual([
      "input.invalid",
      { command: "baseline.create", fields: ["selection.view"] },
    ]);
    expect(error.message).toContain("CoastOnly has the view VAR-0000c1");
    expect((await failure(ws, "Y", { filter: "CoastOnly", view: "core" })).code).toBe("input.invalid");
    const same = await create(ws, "Coast again", { filter: "CoastOnly", view: `${ID}c1` });
    expect(read(ws, same.baseline.file)).toContain(
      `selection:\n  where:\n    all: []\n  view: { id: ${ID}c1, title: Coast }\nrepositories:\n`,
    );
  });

  it("[SR-050/AK3] a baseline through a variant view names the variant", async () => {
    const ws = await fixture();
    const out = await create(ws, "Coast", { view: "VAR-0000c1" });
    expect(read(ws, out.baseline.file)).toContain(
      `selection:\n  view: { id: ${ID}c1, title: Coast }\nrepositories:\n`,
    );
    // A saved filter is stored resolved: its where (with the input's) and its view.
    const where = { property: "requirement-type", op: "in", value: ["Functional", "quality"] };
    const filtered = await create(ws, "Coast functional", { filter: "Functional", where });
    expect(read(ws, filtered.baseline.file)).toContain(
      [
        "selection:",
        "  where:",
        "    all:",
        "      - property: requirement-type",
        "        op: eq",
        "        value: functional",
        "      - property: requirement-type",
        "        op: in",
        "        value: [ functional, quality ]",
        "repositories:",
      ].join("\n"),
    );
    const core = await create(ws, "Core", {
      view: "Core",
      where: { property: "status", op: "eq", value: "draft" },
    });
    expect(read(ws, core.baseline.file)).toContain(
      "selection:\n  where:\n    property: status\n    op: eq\n    value: draft\n  view: core\n",
    );
  });

  it("[SR-050/AK4] R1 in system and R2 in sensor give the commits of system and sensor once each", async () => {
    const ws = await fixture();
    const [system, sensor] = [await ws.head("system"), await ws.head("sensor")];
    const out = await create(ws, "Both", { ids: ["SR-0000b1", "SR-0000e1", `${ID}b1`] });
    expect(read(ws, out.baseline.file)).toBe(
      [
        "reqseq-baseline: 1",
        "name: Both",
        "date: 2026-11-02T13:00:00Z",
        "selection:",
        "  ids:",
        `    - ${ID}b1`,
        `    - { id: ${ID}e1, repository: sensor }`,
        "repositories:",
        `  - { name: system, commit: ${system} }`,
        `  - { name: sensor, commit: ${sensor} }`,
        "elements:",
        B1,
        E1,
        "",
      ].join("\n"),
    );
    // Only system is involved without an element of sensor.
    expect(bodyOf(ws, await create(ws, "System", { ids: ["SR-0000b1"] }))).toBe(
      `repositories:\n  - { name: system, commit: ${system} }\nelements:\n${B1}\n`,
    );
  });

  it("[SR-050/AK5] an empty selection writes a file with an empty element list", async () => {
    const ws = await fixture();
    fs.rmSync(ws.path("system/baselines"), { recursive: true });
    const out = await create(ws, "基线一", { ids: [] });
    expect(out.baseline).toMatchObject({ file: "baselines/baseline.yaml", elements: 0 });
    expect(bodyOf(ws, out)).toBe(
      `repositories:\n  - { name: system, commit: ${await ws.head("system")} }\nelements: []\n`,
    );
    expect(scanBaseline(read(ws, out.baseline.file))?.elements).toEqual([]);
  });

  it("[SR-050/AK6] a second baseline „Release 1“ is refused naming the existing file, nothing overwritten", async () => {
    const ws = await fixture();
    const before = read(ws, "baselines/release-1.yaml");
    for (const name of ["Release 1", "RELEASE 1"]) {
      const error = await failure(ws, name, PACKAGE);
      expect([error.code, error.details]).toEqual([
        "baseline.exists",
        { file: "baselines/release-1.yaml", repository: "system" },
      ]);
      expect(error.message).toContain("baselines/release-1.yaml");
    }
    expect(read(ws, "baselines/release-1.yaml")).toBe(before);
    expect(fs.readdirSync(ws.path("system/baselines")).sort()).toEqual(["broken.yaml", "release-1.yaml"]);
    // Another name whose file name is taken gets the next free one.
    expect((await create(ws, "Release-1", PACKAGE)).files).toEqual(["baselines/Release-1-2.yaml"]);
  });

  it("[SR-050/AK7] a repository without a commit refuses the baseline naming it", async () => {
    const ws = await fixture(["system"]);
    const refusal = async (): Promise<unknown> => {
      const error = await failure(ws, "Sensor", { ids: ["SR-0000e1"] });
      expect(error.message).toContain("repository sensor has no commit");
      return [error.code, error.details];
    };
    expect(await refusal()).toEqual(["git.unavailable", { repository: "sensor" }]);
    await ws.git(["init", "-q"], "sensor");
    expect(await refusal()).toEqual(["git.unavailable", { repository: "sensor" }]);
    expect(fs.readdirSync(ws.path("system/baselines")).sort()).toEqual(["broken.yaml", "release-1.yaml"]);
  });

  it("refuses selection.baseline, a folder that is not here or cannot be read, and an element without version", async () => {
    const ws = await fixture();
    expect((await failure(ws, "B", { baseline: "Release 1" })).details).toMatchObject({
      fields: ["selection.baseline"],
    });
    vi.mocked(model.currentVersionsOf).mockImplementationOnce(async (workspace, records) => {
      const versions = await vi.importActual<typeof model>("../../model/index.js");
      const all = await versions.currentVersionsOf(workspace, records);
      const [first] = records;
      return new Map(
        [...all].map(([r, v]) => [
          r,
          r === first ? { kind: "unknown", reason: "not-in-file", message: "gone" } : v,
        ]),
      );
    });
    const faulty = await failure(ws, "F", PACKAGE);
    expect([faulty.code, faulty.details]).toEqual([
      "file.faulty",
      { elements: [{ id: `${ID}b1`, repository: "system", file: "requirements/SR-0000000000b1.md" }] },
    ]);
    const settings = read(ws, "reqseq-workspace.yaml");
    await ws.write(
      "system/reqseq-workspace.yaml",
      `${settings}baselines: { repository: system, path: requirements/SR-0000000000b1.md }\n`,
    );
    const unreadable = await failure(ws, "U", PACKAGE);
    expect([unreadable.code, unreadable.details]).toEqual([
      "file.unreadable",
      { repository: "system", file: "requirements/SR-0000000000b1.md" },
    ]);
    await ws.write(
      "system/reqseq-workspace.yaml",
      `${settings}baselines: { repository: sensor, path: baselines }\n`,
    );
    fs.rmSync(ws.path("sensor"), { recursive: true });
    const missing = await failure(ws, "H", PACKAGE);
    expect([missing.code, missing.details]).toEqual(["file.folder-missing", { repository: "sensor" }]);
  });

  it("says when a repository is not here and stores a package without title with an empty one", async () => {
    const ws = await fixture(["system"]);
    fs.rmSync(ws.path("sensor"), { recursive: true });
    const out = await create(ws, "Next", PACKAGE);
    expect(out).toMatchObject({ incomplete: true });
    expect(out.problems?.map((p) => p.code)).toEqual(["workspace.repository-missing"]);
    // A metamodel in a repository that is not here makes the workspace read-only: refused before Git is asked.
    const settings = read(ws, "reqseq-workspace.yaml");
    await ws.write(
      "system/reqseq-workspace.yaml",
      settings.replace("metamodel: { repository: system", "metamodel: { repository: sensor"),
    );
    expect((await failure(ws, "Away", { ids: [] })).code).toBe("workspace.read-only");
    await ws.write("system/reqseq-workspace.yaml", settings);
    // A package without title is stored with an empty one.
    const pkg = "packages/PKG-0000000000d1.md";
    await ws.write(`system/${pkg}`, read(ws, pkg).replace("title: Display\n", ""));
    const untitled = await create(ws, "Untitled", PACKAGE);
    expect(read(ws, untitled.baseline.file)).toContain(`  package: { id: ${ID}d1, title: "" }\n`);
  });
});

// The read-only baseline reader (read.ts, SR-032 AK2, spec question #530) on fixtures/SR-032/baselines:
// Beta (A1 at V1), Release 1.0 (A1 at V1, A2 at V2), Release 1.1 (A1 at V2, A2 at V2) and a README
// in the default folder `baselines`. What evidence.list makes of it: commands/evidence/list.test.ts.
import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { parseYamlFileBytes } from "../files/index.js";
import type { BaselineFile } from "../generated/types.js";
import { fileSchemaValidator } from "../runtime/contracts.js";
import { Workspace } from "../runtime/workspace.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { BaselineFiles, Baselines } from "./read.js";
import { baselineHeader, scanBaseline } from "./scan.js";
import {
  MAX_VIOLATIONS,
  baselineFilesState,
  baselinesContaining,
  findBaseline,
  readBaselines,
  workspaceBaselines,
} from "./read.js";

const P = "32032032-0000-4000-8000-0000000032";
const A1 = `${P}a1`;
const A2 = `${P}a2`;
const V1 = "n1:1111111111111111";
const V2 = "n1:2222222222222222";
const COMMIT = "9abcdef09abcdef09abcdef09abcdef09abcdef0";

const WORKSPACE = (more = ""): string =>
  "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
  '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
  `metamodel: { repository: system, path: metamodel }\n${more}`;

/** A baseline file named `name` that lists `elements` (`- { ... }` lines). */
const baseline = (name: string, ...elements: readonly string[]): string =>
  `reqseq-baseline: 1\nname: ${name}\ndate: 2026-10-01T09:00:00Z\nrepositories:\n  - { name: system, commit: ${COMMIT} }\n` +
  (elements.length === 0 ? "elements: []\n" : `elements:\n${elements.map((e) => `  - ${e}\n`).join("")}`);

const open = async (files: Readonly<Record<string, string>> = {}, options: Partial<FixtureOptions> = {}) => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-032/baselines", files, ...options });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  const layout: WorkspaceLayout = await workspace.get(workspaceLayoutState);
  return { fixture, workspace, layout };
};

/** The baselines as `[name, file]` and the problems as `[code, severity, file, line]`. */
const shown = (read: Baselines): unknown => ({
  baselines: read.baselines.map((b) => [b.name, b.file]),
  problems: read.problems.map((p) => [p.code, p.severity, p.file, p.line]),
  incomplete: read.incomplete,
});

describe("baseline files, read-only (SR-032 AK2)", () => {
  it("[SR-032/AK2] reads every baseline file of the baselines folder in file order and tells which contain a version", async () => {
    const { layout } = await open();
    const read = await readBaselines(layout);
    expect(shown(read)).toEqual({
      baselines: [
        ["Beta", "baselines/beta.yaml"],
        ["Release 1.0", "baselines/release-1.0.yaml"],
        ["Release 1.1", "baselines/release-1.1.yaml"],
      ],
      problems: [],
      incomplete: false,
    });
    expect(read.location).toEqual({ repository: "system", path: "baselines" });
    expect(read.baselines.map((b) => b.repository)).toEqual(["system", "system", "system"]);
    expect(baselinesContaining(read, A1, V1)).toEqual(["Beta", "Release 1.0"]);
    expect(baselinesContaining(read, A2, V2)).toEqual(["Release 1.0", "Release 1.1"]);
    expect(baselinesContaining(read, A2, V1)).toEqual([]);
  });

  it("[SR-032/AK2] reads the baselines folder the workspace file names, also at the root of a repository, never the workspace file", async () => {
    const { layout } = await open({
      "reqseq-workspace.yaml": WORKSPACE("baselines: { repository: system, path: . }\n"),
      "root-baseline.yaml": baseline("Root", `{ id: ${A1}, version: ${V1}, repository: system }`),
    });
    const read = await readBaselines(layout);
    expect(shown(read)).toEqual({
      baselines: [["Root", "root-baseline.yaml"]],
      problems: [],
      incomplete: false,
    });
    expect(baselinesContaining(read, A1, V1)).toEqual(["Root"]);
  });

  it("names a baseline once when two files carry the same name", async () => {
    const { layout } = await open({
      "baselines/twin.yaml": baseline("Beta", `{ id: ${A1}, version: ${V1} }`),
    });
    expect(baselinesContaining(await readBaselines(layout), A1, V1)).toEqual(["Beta", "Release 1.0"]);
  });

  it("reports faulty files, a .yml file and YAML warnings, and reads no baseline from a faulty file", async () => {
    const { layout } = await open({
      "baselines/broken-yaml.yaml": "reqseq-baseline: 1\nname: [unclosed\n",
      "baselines/no-name.yaml": `reqseq-baseline: 1\ndate: 2026-10-01T09:00:00Z\nrepositories: []\nelements: []\n`,
      "baselines/old.yml": baseline("Old"),
      "baselines/tagged.yaml": baseline(`!odd Tagged`, `{ id: ${A1}, version: ${V2} }`),
      "baselines/notes.txt": "no baseline",
      "baselines/scalar.yaml": "a note\n",
    });
    const read = await readBaselines(layout);
    expect(shown(read)).toEqual({
      baselines: [
        ["Beta", "baselines/beta.yaml"],
        ["Release 1.0", "baselines/release-1.0.yaml"],
        ["Release 1.1", "baselines/release-1.1.yaml"],
        ["Tagged", "baselines/tagged.yaml"],
      ],
      problems: [
        ["file.invalid-yaml", "error", "baselines/broken-yaml.yaml", 2],
        ["baseline.invalid", "error", "baselines/no-name.yaml", 1],
        ["baseline.invalid", "error", "baselines/no-name.yaml", 3],
        ["baseline.invalid", "warning", "baselines/old.yml", undefined],
        ["baseline.invalid", "error", "baselines/scalar.yaml", 1],
        ["file.yaml-warning", "warning", "baselines/tagged.yaml", 2],
      ],
      incomplete: false,
    });
    expect(read.problems.every((p) => p.repository === "system")).toBe(true);
    expect(read.problems[1]?.message).toBe("Invalid baseline baselines/no-name.yaml: name is required");
    expect(read.problems[4]?.message).toBe(
      'Invalid baseline baselines/scalar.yaml: the file must be an object, not "a note"',
    );
    expect(read.problems[3]?.message).toBe("baselines/old.yml is not read: baseline files end in .yaml");
  });

  it("lists at most MAX_VIOLATIONS violations of one file and counts the rest", async () => {
    const entries = Array.from(
      { length: MAX_VIOLATIONS + 3 },
      (_, i) => `{ id: ${A1}, version: v${String(i)} }`,
    );
    const { layout } = await open({ "baselines/many.yaml": baseline("Many", ...entries) });
    const problems = (await readBaselines(layout)).problems;
    expect(problems).toHaveLength(MAX_VIOLATIONS + 1);
    expect(problems.at(-1)).toEqual({
      code: "baseline.invalid",
      severity: "error",
      repository: "system",
      file: "baselines/many.yaml",
      message: "Invalid baseline baselines/many.yaml: 3 more violations",
    });
  });

  it("has no baseline and no problem without a baselines folder", async () => {
    const { layout } = await open({
      "reqseq-workspace.yaml": WORKSPACE("baselines: { repository: system, path: releases }\n"),
    });
    expect(shown(await readBaselines(layout))).toEqual({ baselines: [], problems: [], incomplete: false });
  });

  it("reports a baselines path that is no folder", async () => {
    const { layout } = await open({
      "reqseq-workspace.yaml": WORKSPACE(
        "baselines: { repository: system, path: requirements/SR-0000000032a1.md }\n",
      ),
    });
    const read = await readBaselines(layout);
    expect(shown(read)).toEqual({
      baselines: [],
      problems: [["file.unreadable", "error", "requirements/SR-0000000032a1.md", undefined]],
      incomplete: false,
    });
    expect(read.problems[0]?.message).toBe(
      "Cannot read the baselines folder requirements/SR-0000000032a1.md: ENOTDIR",
    );
  });

  it("is incomplete while the repository of the folder is not on this machine, and empty for a repository the workspace file does not list", async () => {
    const vault = '  - { name: vault, url: "git@git.example.com:ws/vault.git", path: ../vault }\n';
    const away = await open({
      "reqseq-workspace.yaml": WORKSPACE("baselines: { repository: vault, path: baselines }\n").replace(
        "metamodel:",
        `${vault.trimEnd()}\nmetamodel:`,
      ),
    });
    expect(shown(await readBaselines(away.layout))).toEqual({
      baselines: [],
      problems: [],
      incomplete: true,
    });
    const unknown = await open({
      "reqseq-workspace.yaml": WORKSPACE("baselines: { repository: elsewhere, path: baselines }\n"),
    });
    expect(shown(await readBaselines(unknown.layout))).toEqual({
      baselines: [],
      problems: [],
      incomplete: false,
    });
  });

  /** Lets the clock of the reader run `ms` ahead, so the files just written are no longer racy. */
  const later = (ms: number): void => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now + ms);
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
  };

  it("parses a file again only when it changed, and forgets files that are gone", async () => {
    const { fixture, layout } = await open();
    later(60_000);
    const kept: BaselineFiles = new Map();
    const first = await readBaselines(layout, kept);
    expect([...kept.keys()]).toEqual([
      "system\nbaselines/beta.yaml",
      "system\nbaselines/release-1.0.yaml",
      "system\nbaselines/release-1.1.yaml",
    ]);
    const again = await readBaselines(layout, kept);
    expect(again.baselines).toEqual(first.baselines);
    expect(again.baselines.every((b, i) => b === first.baselines[i])).toBe(true);
    await fs.rm(fixture.path("baselines/beta.yaml"));
    await fixture.write("baselines/release-1.1.yaml", baseline("Release 1.1 rebuilt"));
    const changed = await readBaselines(layout, kept);
    expect(changed.baselines.map((b) => b.name)).toEqual(["Release 1.0", "Release 1.1 rebuilt"]);
    expect(changed.baselines[0]).toBe(first.baselines[1]);
    expect(kept.size).toBe(2);
    await fs.rm(fixture.path("baselines"), { recursive: true });
    expect((await readBaselines(layout, kept)).baselines).toEqual([]);
    expect(kept.size).toBe(0);
  });

  it("sees a change of the same size whose modification time was set back (cp -p)", async () => {
    const { fixture, layout } = await open();
    later(60_000);
    const kept: BaselineFiles = new Map();
    await readBaselines(layout, kept);
    const file = fixture.path("baselines/release-1.0.yaml");
    const { atime, mtime } = await fs.stat(file);
    await fs.writeFile(file, (await fs.readFile(file, "utf8")).replace("Release 1.0", "Release 1.X"));
    await fs.utimes(file, atime, mtime);
    // The file system stores the time set back in its own resolution, so it reads back as e.g. ...930.999.
    expect((await fs.stat(file)).mtimeMs).toBeCloseTo(mtime.getTime(), 0);
    expect((await readBaselines(layout, kept)).baselines.map((b) => b.name)).toEqual([
      "Beta",
      "Release 1.X",
      "Release 1.1",
    ]);
  });

  it("parses a file again that changed less than RACY_MS before it was read", async () => {
    const { fixture, layout } = await open();
    // Written now, not only copied: on Windows the copy keeps the modification and change time of
    // the checkout, which may lie more than RACY_MS back.
    for (const name of ["beta", "release-1.0", "release-1.1"]) {
      const file = `baselines/${name}.yaml`;
      await fixture.write(file, await fs.readFile(fixture.path(file), "utf8"));
    }
    const kept: BaselineFiles = new Map();
    const first = await readBaselines(layout, kept);
    expect([...kept.values()].map((k) => k.stamp)).toEqual([undefined, undefined, undefined]);
    const again = await readBaselines(layout, kept);
    expect(again.baselines.some((b, i) => b === first.baselines[i])).toBe(false);
    expect(again.baselines.map((b) => b.name)).toEqual(first.baselines.map((b) => b.name));
  });

  it("passes over a file that is gone between listing the folder and reading it", async () => {
    const { layout } = await open();
    const gone = Object.assign(new Error("gone"), { code: "ENOENT" });
    vi.spyOn(fs, "lstat").mockRejectedValueOnce(gone);
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    expect((await readBaselines(layout)).baselines.map((b) => b.name)).toEqual([
      "Release 1.0",
      "Release 1.1",
    ]);
  });

  it("reads a file it cannot look at, so its problem shows, and keeps it for no later call", async () => {
    const { layout } = await open();
    later(60_000);
    const denied = Object.assign(new Error("denied"), { code: "EACCES" });
    vi.spyOn(fs, "lstat").mockRejectedValueOnce(denied);
    const kept: BaselineFiles = new Map();
    expect((await readBaselines(layout, kept)).baselines.map((b) => b.name)).toEqual([
      "Beta",
      "Release 1.0",
      "Release 1.1",
    ]);
    expect([...kept.values()].map((k) => k.stamp === undefined)).toEqual([true, false, false]);
  });

  it("keeps what it read in the workspace state, which a reset of the layout drops", async () => {
    const { workspace } = await open();
    expect((await workspaceBaselines(workspace)).baselines).toHaveLength(3);
    const kept = workspace.get(baselineFilesState);
    expect(kept.size).toBe(3);
    await workspace.reset(workspaceLayoutState);
    expect(workspace.get(baselineFilesState)).not.toBe(kept);
  });

  it("forgets the files when the repository of the folder is gone", async () => {
    const { layout } = await open();
    const kept: BaselineFiles = new Map();
    await readBaselines(layout, kept);
    const away = { ...layout, repositories: layout.repositories.map((r) => ({ ...r, available: false })) };
    expect((await readBaselines(away as WorkspaceLayout, kept)).incomplete).toBe(true);
    expect(kept.size).toBe(0);
  });
});

describe("selection by baseline (data.export, SR-061 AK2)", () => {
  it("selects the elements a baseline lists in any version, a copy only where an entry names its repository", async () => {
    const { layout } = await open({
      "baselines/copies.yaml": baseline(
        "Copies",
        `{ id: ${A1}, version: ${V1}, repository: system }`,
        `{ id: ${A1}, version: ${V2}, repository: sensor }`,
        `{ id: ${A2}, version: ${V2} }`,
        `{ id: ${A2}, version: ${V1}, repository: sensor }`,
        `{ id: ${P}a3, version: ${V1}, repository: system }`,
        `{ id: ${P}a3, version: ${V1}, repository: system }`,
      ),
    });
    const found = findBaseline(await readBaselines(layout), "Copies");
    if (found.kind !== "found") {
      throw new Error(found.kind);
    }
    const { selects } = found.baseline;
    expect([
      selects({ id: A1, repository: "system" }),
      selects({ id: A1, repository: "sensor" }),
      selects({ id: A1, repository: "other" }),
      // An entry without repository names every copy, whatever came before.
      selects({ id: A2, repository: "other" }),
      selects({ id: `${P}a3`, repository: "system" }),
      selects({ id: `${P}a4`, repository: "system" }),
    ]).toEqual([true, true, false, true, true, false]);
  });

  it("finds a baseline by name in any case, then by its file name with or without .yaml", async () => {
    const { layout } = await open({
      "baselines/release-1.1.yaml.yaml": baseline("Odd file name"),
    });
    const read = await readBaselines(layout);
    const fileOf = (text: string): unknown => {
      const found = findBaseline(read, text);
      return found.kind === "found" ? found.baseline.file : found;
    };
    expect(fileOf("release 1.0")).toBe("baselines/release-1.0.yaml");
    expect(fileOf("beta.yaml")).toBe("baselines/beta.yaml");
    expect(fileOf("beta")).toBe("baselines/beta.yaml");
    expect(fileOf("release-1.1.yaml")).toEqual({
      kind: "ambiguous",
      files: ["baselines/release-1.1.yaml", "baselines/release-1.1.yaml.yaml"],
    });
    expect(fileOf("Release 2")).toEqual({ kind: "none" });
    // A name is not a path: the folder is not part of the file name.
    expect(fileOf("baselines/beta.yaml")).toEqual({ kind: "none" });
  });

  it("tells a name two files share, and a file name of a faulty file", async () => {
    const { layout } = await open({
      "baselines/twin.yaml": baseline("Beta"),
      "baselines/broken.yaml": "reqseq-baseline: 1\nname: Broken\n",
    });
    const read = await readBaselines(layout);
    expect(read.faulty).toEqual(["baselines/broken.yaml"]);
    expect(findBaseline(read, "BETA")).toEqual({
      kind: "ambiguous",
      files: ["baselines/beta.yaml", "baselines/twin.yaml"],
    });
    expect(findBaseline(read, "broken")).toEqual({ kind: "faulty", file: "baselines/broken.yaml" });
    // Its `name` is not known: the file is faulty.
    expect(findBaseline(read, "Broken file")).toEqual({ kind: "none" });
  });
});

describe("baseline file format (ADR-0018): the line scanner and the YAML fallback", () => {
  const EXAMPLES = path.resolve(import.meta.dirname, "../../../../schemas/examples/baseline");
  const U1 = "102ee39b-773f-4cd0-b414-825b7146fb54";
  const U2 = "fe5fce30-087e-4bbd-82e4-0f03900e5af3";
  const VARIANT = "ca0dd4a9-6f1e-4c3a-9d55-2b7c1e8f0a11";
  const HEADER = `reqseq-baseline: 1\nname: Release 1\ndate: 2026-11-02T13:00:00Z\n`;
  const SELECTION = `selection:\n  view: { id: ${VARIANT}, title: Pro }\n`;
  const REPOSITORIES = `repositories:\n  - { name: system, commit: ${COMMIT} }\n  - { name: sensor, commit: ${COMMIT} }\n`;
  const ELEMENTS =
    `elements:\n  - { id: ${U1}, version: ${V1} }\n  - { id: ${U1}, version: ${V2}, repository: sensor }\n` +
    `  - { id: ${U2}, version: ${V2} }\n`;
  const CANONICAL = HEADER + SELECTION + REPOSITORIES + ELEMENTS;

  /** What YAML and the schema make of `text`: its data, and whether it is a valid baseline. */
  const viaYaml = (text: string): { data: unknown; valid: boolean } => {
    const parsed = parseYamlFileBytes("b.yaml", new TextEncoder().encode(text));
    return parsed.kind === "problem"
      ? { data: undefined, valid: false }
      : {
          data: parsed.content.data,
          valid: fileSchemaValidator("baseline.schema.json")(parsed.content.data),
        };
  };

  /** The header part of a baseline's data. */
  const headerOf = (data: unknown): unknown =>
    Object.fromEntries(
      Object.entries(data as BaselineFile).filter(([key]) => key !== "repositories" && key !== "elements"),
    );

  it("reads both examples and every stored selection form by the line scanner, as YAML and the schema read them", async () => {
    const examples = ["release-1.0.yaml", "release-1-variant.yaml"];
    const texts = await Promise.all(examples.map((name) => fs.readFile(path.join(EXAMPLES, name), "utf8")));
    const selections = [
      SELECTION,
      // As baseline.create writes them: `{ id, title }` in the file's repository, `{ id, repository }` elsewhere.
      `selection:\n  ids:\n    - { id: ${U1}, title: K1 }\n    - { id: ${U2}, repository: sensor }\n  where: { all: [] }\n`,
      // Stage 4 and hand-written forms: every elementRef, a saved filter by name, the core view.
      `selection: { ids: [${U1}, SR-46fb54, SR-036], package: SR-036, view: core }\n`,
      "selection: { filter: Open items, view: SR-099 }\n",
      "",
    ];
    const canonical = selections.map((s) => HEADER + s + REPOSITORIES + ELEMENTS);
    for (const text of [...texts, ...canonical, HEADER + REPOSITORIES + "elements: []\n"]) {
      const yaml = viaYaml(text);
      expect(yaml.valid).toBe(true);
      expect(scanBaseline(text)).toEqual(yaml.data);
      expect(baselineHeader(text)).toEqual(headerOf(yaml.data));
    }
  });

  it("sends a file in any other layout to YAML and the schema, which give the same baseline or its problems", async () => {
    const swap = (from: string, to: string): string => CANONICAL.replace(from, to);
    const element = (more: string): string => CANONICAL.replace(`  - { id: ${U2}`, `${more}  - { id: ${U2}`);
    // Same data as the canonical file, in another layout.
    const same = {
      comment: element("  # checked\n"),
      blank: element("\n"),
      "keys reordered": swap(`{ id: ${U2}, version: ${V2} }`, `{ version: ${V2}, id: ${U2} }`),
      crlf: CANONICAL.replaceAll("\n", "\r\n"),
      "no final newline": CANONICAL.slice(0, -1),
      "flow repositories": swap(
        REPOSITORIES,
        `repositories: [{ name: system, commit: ${COMMIT} }, { name: sensor, commit: ${COMMIT} }]\n`,
      ),
      "header reordered": swap(HEADER, `name: Release 1\nreqseq-baseline: 1\ndate: 2026-11-02T13:00:00Z\n`),
    };
    // Other data, valid or not.
    const other = {
      "out of order": [element(`  - { id: ${U1}, version: ${V1}, repository: aaa }\n`), true],
      twice: [element(`  - { id: ${U1}, version: ${V2}, repository: sensor }\n`), true],
      "number as repository name": [swap("{ name: sensor,", "{ name: 123,"), false],
      "number as commit": [
        swap(`commit: ${COMMIT} }\n  - { name: sensor`, `commit: ${"1".repeat(40)} }\n  - { name: sensor`),
        false,
      ],
      "boolean as element repository": [swap("repository: sensor }", "repository: true }"), false],
      "extra key": [swap(`{ id: ${U2}, version: ${V2} }`, `{ id: ${U2}, version: ${V2}, note: x }`), false],
      "elements without entries": [HEADER + REPOSITORIES + "elements:\n", false],
      "elements: [] and more": [HEADER + REPOSITORIES + "elements: []\n# end\n", true],
      "no repository": [HEADER + "repositories:\nelements: []\n", false],
      "no elements": [HEADER + REPOSITORIES, false],
      "extra header key": [swap(SELECTION, "note: x\n"), false],
      "header without date": [swap("date: 2026-11-02T13:00:00Z\n", ""), false],
      "name against the schema": [swap("name: Release 1", 'name: " padded"'), false],
      "YAML warning": [swap("name: Release 1", "name: !odd Release 1"), true],
      "faulty header YAML": [swap("name: Release 1", "name: [open"), false],
      "header a scalar": ["a note\n" + REPOSITORIES + ELEMENTS, false],
      "header a list": ["- a\n" + REPOSITORIES + ELEMENTS, false],
      "header empty": ["\n" + REPOSITORIES + ELEMENTS, false],
    } as const;
    const canonical = viaYaml(CANONICAL).data;
    for (const [label, text] of Object.entries(same)) {
      expect(scanBaseline(text), label).toBeUndefined();
      expect(viaYaml(text), label).toEqual({ data: canonical, valid: true });
    }
    for (const [label, [text, valid]] of Object.entries(other)) {
      expect(scanBaseline(text), label).toBeUndefined();
      expect(viaYaml(text).valid, label).toBe(valid);
    }
    expect(baselineHeader(REPOSITORIES)).toBeUndefined();
    // On disk: the canonical file and a hand-edited copy give the same baseline.
    const { layout } = await open({
      "baselines/canonical.yaml": CANONICAL,
      "baselines/edited.yaml": same.comment.replace("Release 1", "Release 1 edited"),
    });
    const read = await readBaselines(layout);
    expect(baselinesContaining(read, U1, V2)).toEqual(["Release 1", "Release 1 edited"]);
    expect(read.problems).toEqual([]);
  });
});

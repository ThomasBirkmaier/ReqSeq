// data.store through `invoke` (SR-062) on fixtures/SR-062/store (one Git repository; its README lists
// what makes a state dirty), fixtures/SR-061/export (two Git repositories) and fixtures/SR-062/subfolder
// (a workspace in spec/ of a code repository, #377). The same output on every access:
// cross-access.test.ts; the CLI end to end and AK2: packages/cli/test/e2e/data-store.test.ts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import * as exportModule from "../../data/export.js";
import { DATA_LINES } from "../../data/store.js";
import * as files from "../../files/index.js";
import * as reader from "../../git/reader.js";
import type { DataExportLine } from "../../generated/types.js";
import { fileSchemaValidator, loadContracts } from "../../runtime/contracts.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

vi.mock("../../git/reader.js", async (importOriginal) => {
  const original = await importOriginal<typeof reader>();
  return {
    ...original,
    headCommit: vi.fn(original.headCommit),
    changedPaths: vi.fn(original.changedPaths),
    openObjectReader: vi.fn(original.openObjectReader),
  };
});
vi.mock("../../files/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof files>();
  return {
    ...original,
    createFolder: vi.fn(original.createFolder),
    writeFileAtomic: vi.fn(original.writeFileAtomic),
  };
});
vi.mock("../../data/export.js", async (importOriginal) => {
  const original = await importOriginal<typeof exportModule>();
  return { ...original, exportDataWithProblems: vi.fn(original.exportDataWithProblems) };
});

const actual = await vi.importActual<typeof reader>("../../git/reader.js");

type Output = CommandOutput<"data.store">;
type Data = CommandOutput<"data.export">;
type Line = DataExportLine;

/** Symbolic links need a privilege on Windows. */
const NO_LINKS = process.platform === "win32";
/** Permissions do not stop root, and Windows has none of this kind. */
const NO_PERMISSIONS = process.platform === "win32" || process.getuid?.() === 0;

const STORE: FixtureOptions = { fixture: "SR-062/store", git: true };
const EXPORT: FixtureOptions = { fixture: "SR-061/export", git: ["system", "sensor"] };

const fixture = async (options: FixtureOptions = STORE): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace(options);
  onTestFinished(() => created.cleanup());
  return created;
};

/** A temporary folder outside every fixture. */
const tempFolder = (): string => {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "reqseq-store-out-")));
  onTestFinished(() => {
    fs.rmSync(folder, { recursive: true, force: true });
  });
  return folder;
};

/** Calls data.store on a fresh workspace object of `root`, so every call reads the files as they are. */
const storeIn = async (root: string, input: Readonly<Record<string, unknown>>): Promise<Output> => {
  const workspace = new Workspace(root);
  try {
    return (await invoke("data.store", input, { workspace })) as Output;
  } finally {
    await workspace.close();
  }
};

const exportIn = async (root: string, input: Readonly<Record<string, unknown>> = {}): Promise<Data> => {
  const workspace = new Workspace(root);
  try {
    return (await invoke("data.export", input, { workspace })) as Data;
  } finally {
    await workspace.close();
  }
};

const failure = async (root: string, input: Readonly<Record<string, unknown>>): Promise<CommandError> => {
  const error = await storeIn(root, input).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(CommandError);
  return error as CommandError;
};

/** The lines of a stored file, parsed; the text ends with a line break (or is empty). */
const readLines = (file: string): Line[] => {
  const text = fs.readFileSync(file, "utf8");
  expect(text === "" || text.endsWith("\n")).toBe(true);
  return text === ""
    ? []
    : text
        .slice(0, -1)
        .split("\n")
        .map((line) => JSON.parse(line) as Line);
};

/** The lines `data` gives: its state, then each element (SR-062 AK1, #319). */
const linesOf = (data: Data): Line[] =>
  data.elements.map((element) => ({
    "reqseq-data": 2,
    ...(data.commit === undefined ? {} : { commit: data.commit }),
    dirty: data.dirty,
    ...element,
  }));

/** The state every line of a stored file carries: `[commit, dirty]` of each line, once when all agree. */
const stateIn = (file: string): (readonly [string | undefined, boolean])[] => [
  ...new Map(
    readLines(file).map(
      (l) => [`${String(l.commit)} ${String(l.dirty)}`, [l.commit, l.dirty] as const] as const,
    ),
  ).values(),
];

/** The names in `folder`, or undefined when it does not exist. */
const namesIn = (folder: string): string[] | undefined =>
  fs.existsSync(folder) ? fs.readdirSync(folder).sort() : undefined;

/** Whether data.store names the file of the state of `ws` after `change` -dirty; the change is undone afterwards. */
const dirtyAfter = async (ws: FixtureWorkspace, change: () => Promise<void> | void): Promise<boolean> => {
  await change();
  const out = await storeIn(ws.root, { folder: "out" });
  await ws.git(["reset", "--hard", "-q"]);
  await ws.git(["clean", "-fdxq"]);
  const [file = ""] = out.files;
  expect(file).toMatch(/^out\/[0-9a-f]{40}(-dirty)?\.jsonl$/);
  return file.endsWith("-dirty.jsonl");
};

const append = (ws: FixtureWorkspace, file: string, text: string): void => {
  fs.appendFileSync(ws.path(file), text);
};

describe("data.store: the data of a state as a file named after its commit (SR-062 AK1)", () => {
  it("[SR-062/AK1] writes the data of the state into the given folder as JSON Lines, one element per line, named after the commit of the main repository", async () => {
    const ws = await fixture(EXPORT);
    const root = ws.path("system");
    const commit = await ws.head("system");
    expect(fs.existsSync(ws.path("system/out"))).toBe(false);
    const out = await storeIn(root, { folder: "out" });
    expect(out).toEqual({ files: [`out/${commit}.jsonl`], problems: [] });
    const text = fs.readFileSync(ws.path(`system/out/${commit}.jsonl`), "utf8");
    const exported = await exportIn(root);
    // Byte for byte the lines of `data export --jsonl` (no line holds the time of the call).
    const catalog = loadContracts().entry("data.export")?.jsonLines;
    expect(catalog).toEqual(DATA_LINES);
    expect(text).toBe([...files.jsonLines(exported, DATA_LINES)].join(""));
    const lines = readLines(ws.path(`system/out/${commit}.jsonl`));
    expect(lines).toHaveLength(exported.elements.length);
    expect(lines).toEqual(linesOf(exported));
    for (const line of text.slice(0, -1).split("\n")) {
      expect(line.startsWith(`{"reqseq-data":2,"commit":"${commit}","dirty":false,"id":`)).toBe(true);
    }
  });

  it("[SR-062/AK1] names the file <commit>-dirty.jsonl when an element file has uncommitted changes", async () => {
    const changed = await fixture();
    const commit = await changed.head();
    append(changed, "requirements/SR-0000000000a1.md", "More text.\n");
    expect(await storeIn(changed.root, { folder: "out" })).toEqual({
      files: [`out/${commit}-dirty.jsonl`],
      problems: [],
    });
    expect(stateIn(changed.path(`out/${commit}-dirty.jsonl`))).toEqual([[commit, true]]);
    const added = await fixture();
    await added.write(
      "requirements/SR-0000000000a3.md",
      "---\nid: 62062062-0000-4000-8000-0000000000a3\ntype: system-requirement\nstatus: draft\ntitle: New\n---\n",
    );
    expect((await storeIn(added.root, { folder: "out" })).files).toEqual([`out/${commit}-dirty.jsonl`]);
  });

  it("[SR-062/AK1] a dirty second repository makes the file -dirty too", async () => {
    const ws = await fixture(EXPORT);
    append(ws, "sensor/requirements/SR-0000000000e1.md", "Changed.\n");
    const commit = await ws.head("system");
    const out = await storeIn(ws.path("system"), { folder: "out" });
    expect(out.files).toEqual([`out/${commit}-dirty.jsonl`]);
    expect(stateIn(ws.path(`system/out/${commit}-dirty.jsonl`))).toEqual([[commit, true]]);
    expect((await exportIn(ws.path("system"))).repositories.map((r) => r.dirty)).toEqual([false, true]);
  });

  it("[SR-062/AK1] a second run on the same commit replaces the file of that commit", async () => {
    const ws = await fixture();
    const commit = await ws.head();
    const file = ws.path(`out/${commit}.jsonl`);
    await storeIn(ws.root, { folder: "out" });
    const first = fs.readFileSync(file, "utf8");
    // An older file of ReqSeq: its first line is enough (review PS3), also when a crash cut it.
    const old = `{"reqseq-data":2,"commit":"${commit}","dirty":false,"id":"older"}\n{"reqseq-data":2,"ti`;
    fs.writeFileSync(file, old);
    expect(await storeIn(ws.root, { folder: "out" })).toEqual({
      files: [`out/${commit}.jsonl`],
      problems: [],
    });
    expect(namesIn(ws.path("out"))).toEqual([`${commit}.jsonl`]);
    expect(fs.readFileSync(file, "utf8")).toBe(first);
    // An empty file (a selection without elements) is ReqSeq's too.
    fs.writeFileSync(file, "");
    expect((await storeIn(ws.root, { folder: "out" })).files).toEqual([`out/${commit}.jsonl`]);
    expect(fs.readFileSync(file, "utf8")).toBe(first);
  });

  it("[SR-062/AK1] leaves an old <commit>.json as it is and writes <commit>.jsonl next to it", async () => {
    const ws = await fixture();
    const commit = await ws.head();
    const old = '{"reqseq-data":1,"workspace":"W","elements":[]}\n';
    await ws.write(`out/${commit}.json`, old);
    expect((await storeIn(ws.root, { folder: "out" })).files).toEqual([`out/${commit}.jsonl`]);
    expect(namesIn(ws.path("out"))).toEqual([`${commit}.json`, `${commit}.jsonl`]);
    expect(fs.readFileSync(ws.path(`out/${commit}.json`), "utf8")).toBe(old);
  });

  it("[SR-062/AK1] without a commit of the main repository nothing is written and git.unavailable is an error", async () => {
    const plain = await fixture({ fixture: "SR-062/store" });
    const out = await storeIn(plain.root, { folder: "out" });
    expect(out).toEqual({
      files: [],
      problems: [
        {
          code: "git.unavailable",
          severity: "error",
          repository: "system",
          message:
            "Not stored: the commit of the main repository system is unknown (it is in no Git repository); the file is named after it",
        },
      ],
    });
    expect(fs.existsSync(plain.path("out"))).toBe(false);
    const empty = await fixture({ fixture: "SR-062/store" });
    await empty.git(["init", "-q"]);
    const unborn = await storeIn(empty.root, { folder: "out" });
    expect(unborn.files).toEqual([]);
    expect(unborn.problems?.map((p) => [p.code, p.severity, p.message])).toEqual([
      [
        "git.unavailable",
        "error",
        "Not stored: the commit of the main repository system is unknown (its Git repository has no commit yet); the file is named after it",
      ],
    ]);
    expect(fs.existsSync(empty.path("out"))).toBe(false);
  });

  it("[SR-062/AK2] each line of the stored file matches $defs/line of the shipped data-export.schema.json, and it names no path of this machine", async () => {
    const ws = await fixture(EXPORT);
    const out = await storeIn(ws.path("system"), { folder: "out" });
    const file = ws.path(`system/${String(out.files[0])}`);
    const text = fs.readFileSync(file, "utf8");
    const validate = fileSchemaValidator("data-export.schema.json#/$defs/line");
    for (const line of readLines(file)) {
      expect([line.id, validate(line), validate.errors]).toEqual([line.id, true, null]);
    }
    expect(text).not.toContain(ws.root);
    expect(text).not.toContain(os.tmpdir());
  });
});

describe("data.store: a second repository without a known commit (#531 Q2, review B1)", () => {
  it("names the file -dirty when a second repository has no Git, with a warning that names it", async () => {
    const ws = await fixture({ fixture: "SR-061/export", git: ["system"] });
    const commit = await ws.head("system");
    const out = await storeIn(ws.path("system"), { folder: "out" });
    expect(out).toEqual({
      files: [`out/${commit}-dirty.jsonl`],
      problems: [
        {
          code: "git.unavailable",
          severity: "warning",
          repository: "sensor",
          message:
            "The commit of repository sensor is unknown (it is in no Git repository); a stored state is marked dirty",
        },
      ],
    });
    expect(stateIn(ws.path(`system/out/${commit}-dirty.jsonl`))).toEqual([[commit, true]]);
  });

  it("names the file -dirty when Git refuses a second repository (safe.directory)", async () => {
    const ws = await fixture(EXPORT);
    vi.mocked(reader.headCommit).mockImplementation(async (folder, options) =>
      path.basename(folder) === "sensor"
        ? { known: false, reason: "refused", detail: "dubious ownership" }
        : actual.headCommit(folder, options),
    );
    onTestFinished(() => {
      vi.mocked(reader.headCommit).mockImplementation(actual.headCommit);
    });
    const commit = await ws.head("system");
    const out = await storeIn(ws.path("system"), { folder: "out" });
    expect(out.files).toEqual([`out/${commit}-dirty.jsonl`]);
    expect(out.problems).toEqual([
      {
        code: "git.unavailable",
        severity: "warning",
        repository: "sensor",
        message:
          "The commit of repository sensor is unknown (Git refuses to read it because another user owns it, see git config safe.directory); a stored state is marked dirty",
      },
    ]);
  });

  it("names the file -dirty when Git cannot tell the changes, with a warning, and dirty in every line", async () => {
    const ws = await fixture();
    const commit = await ws.head();
    vi.mocked(reader.changedPaths).mockResolvedValueOnce({ known: false, reason: "timeout", detail: "slow" });
    const out = await storeIn(ws.root, { folder: "out" });
    expect(out).toEqual({
      files: [`out/${commit}-dirty.jsonl`],
      problems: [
        {
          code: "git.unavailable",
          severity: "warning",
          repository: "system",
          message:
            "Git cannot tell whether repository system has uncommitted changes (Git did not answer in time); a stored state is marked dirty",
        },
      ],
    });
    expect(stateIn(ws.path(`out/${commit}-dirty.jsonl`))).toEqual([[commit, true]]);
    vi.mocked(reader.openObjectReader).mockImplementationOnce(() => ({
      info: () => Promise.resolve({ known: false, reason: "not-a-repository", detail: "broken" }),
      read: () => Promise.resolve({ known: false, reason: "not-a-repository", detail: "broken" }),
      close: () => undefined,
    }));
    const failed = await storeIn(ws.root, { folder: "out" });
    expect(failed.problems?.map((p) => p.message)).toEqual([
      "Git cannot tell whether repository system has uncommitted changes (git failed); a stored state is marked dirty",
    ]);
  });

  it("stores an incomplete state with the info of the missing repository; the name is clean when the rest is", async () => {
    const ws = await fixture(EXPORT);
    fs.rmSync(ws.path("sensor"), { recursive: true });
    const commit = await ws.head("system");
    const out = await storeIn(ws.path("system"), { folder: "out" });
    expect(out.files).toEqual([`out/${commit}.jsonl`]);
    expect(out.problems).toEqual([
      {
        code: "workspace.repository-missing",
        severity: "info",
        message: "Repository sensor is not available locally",
      },
    ]);
    // The lines tell no incompleteness (only the JSON form has `incomplete`); the info says it.
    expect(stateIn(ws.path(`system/out/${commit}.jsonl`))).toEqual([[commit, false]]);
  });
});

describe("data.store: which changes make the state dirty (K2)", () => {
  it("counts changes to the workspace file, the YAML files of the metamodel, filter and baseline folders and any Markdown file the walk reads", async () => {
    const ws = await fixture();
    expect(await dirtyAfter(ws, () => undefined)).toBe(false);
    expect(
      await dirtyAfter(ws, () => {
        append(ws, "reqseq-workspace.yaml", "# changed\n");
      }),
    ).toBe(true);
    expect(
      await dirtyAfter(ws, () => {
        append(ws, "metamodel/standard-model.yaml", "# changed\n");
      }),
    ).toBe(true);
    expect(
      await dirtyAfter(ws, () => {
        append(ws, "filters/functional.yaml", "# changed\n");
      }),
    ).toBe(true);
    expect(
      await dirtyAfter(ws, () => {
        append(ws, "baselines/release-1.yaml", "# changed\n");
      }),
    ).toBe(true);
    expect(
      await dirtyAfter(ws, () => {
        append(ws, "README.md", "Changed.\n");
      }),
    ).toBe(true);
    expect(await dirtyAfter(ws, () => ws.write("baselines/release-2.yml", "reqseq-baseline: 1\n"))).toBe(
      true,
    );
  });

  it("counts a changed or deleted embedded file of any extension and a deleted element file", async () => {
    const ws = await fixture();
    expect(
      await dirtyAfter(ws, () => {
        append(ws, "requirements/SR-a1/layout.png", "x");
      }),
    ).toBe(true);
    expect(
      await dirtyAfter(ws, () => {
        append(ws, "requirements/SR-a2/plot.dat", "4\n");
      }),
    ).toBe(true);
    expect(
      await dirtyAfter(ws, () => {
        fs.rmSync(ws.path("requirements/SR-a1/layout.png"));
      }),
    ).toBe(true);
    expect(
      await dirtyAfter(ws, () => {
        fs.rmSync(ws.path("requirements/SR-0000000000a2.md"));
      }),
    ).toBe(true);
  });

  it("keeps <commit>.jsonl and dirty: false for a committed link to an embedded file that exists nowhere", async () => {
    const ws = await fixture({
      ...STORE,
      files: {
        "requirements/SR-0000000000a7.md":
          "---\nid: 62062062-0000-4000-8000-0000000000a7\ntype: system-requirement\nstatus: draft\ntitle: Show a gone image\n---\n\n![Gone](SR-a7/missing.png)\n",
      },
    });
    const commit = await ws.head();
    expect(await storeIn(ws.root, { folder: "out" })).toEqual({
      files: [`out/${commit}.jsonl`],
      problems: [],
    });
    expect(stateIn(ws.path(`out/${commit}.jsonl`))).toEqual([[commit, false]]);
    // Once the image is there, it is an uncommitted change.
    expect(
      await dirtyAfter(ws, () => {
        fs.mkdirSync(ws.path("requirements/SR-a7"));
        fs.writeFileSync(ws.path("requirements/SR-a7/missing.png"), "an image");
      }),
    ).toBe(true);
  });

  it("counts a new element file in a folder Git ignores, and an embedded file Git ignores (review S4)", async () => {
    const ws = await fixture();
    expect(
      await dirtyAfter(ws, () =>
        ws.write(
          "drafts/SR-0000000000a9.md",
          "---\nid: 62062062-0000-4000-8000-0000000000a9\ntype: system-requirement\nstatus: draft\ntitle: Draft\n---\n",
        ),
      ),
    ).toBe(true);
    await ws.write(
      "requirements/SR-0000000000a3.md",
      "---\nid: 62062062-0000-4000-8000-0000000000a3\ntype: system-requirement\nstatus: draft\ntitle: Shot\n---\n\n![Shot](SR-a3/shot.local.png)\n",
    );
    await ws.write("requirements/SR-a3/shot.local.png", "shot");
    await ws.commit();
    const out = await storeIn(ws.root, { folder: "out" });
    expect(out.files).toEqual([`out/${await ws.head()}-dirty.jsonl`]);
  });

  it.skipIf(NO_LINKS)("counts a link where the commit has a file with the same content", async () => {
    const ws = await fixture();
    expect(
      await dirtyAfter(ws, () => {
        const file = ws.path("requirements/SR-a2/plot.dat");
        fs.renameSync(file, ws.path("plot.copy"));
        fs.symlinkSync(ws.path("plot.copy"), file);
      }),
    ).toBe(true);
  });

  it("does not count evidence records, the local file, code, ignored Markdown and stored data files", async () => {
    const ws = await fixture();
    const unchanged = async (change: () => Promise<void> | void): Promise<void> => {
      expect(await dirtyAfter(ws, change)).toBe(false);
    };
    await unchanged(() => {
      append(ws, "evidence/2026-10-20-SR-a1-test.md", "More.\n");
    });
    await unchanged(() => ws.write("evidence/ci/run.xml", "<testsuites/>\n"));
    await unchanged(() => ws.write(".reqseq/local.yaml", "reqseq-local: 1\n"));
    await unchanged(() => {
      append(ws, "src/tool.py", "MORE = 2\n");
    });
    await unchanged(() => {
      append(ws, "generated/notes.md", "More.\n");
    });
    await unchanged(() =>
      ws.write("out/0000000000000000000000000000000000000000.jsonl", '{"reqseq-data":2,"dirty":false}\n'),
    );
    await unchanged(() =>
      ws.write("out/0000000000000000000000000000000000000000.json", '{"reqseq-data":1}\n'),
    );
    await unchanged(() => ws.write("metamodel/extra.json", "{}\n"));
    await unchanged(() => ws.write("requirements/notes.MD", "Not an element file name.\n"));
  });

  it("compares content, not stat data: a copied work tree is clean, a touched file too, a changed byte is not (review S2)", async () => {
    const ws = await fixture();
    const copy = path.join(tempFolder(), "copy");
    fs.cpSync(ws.root, copy, { recursive: true });
    const commit = await ws.head();
    expect((await storeIn(copy, { folder: "out" })).files).toEqual([`out/${commit}.jsonl`]);
    expect(stateIn(path.join(copy, `out/${commit}.jsonl`))).toEqual([[commit, false]]);
    const element = path.join(copy, "requirements/SR-0000000000a1.md");
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(element, later, later);
    expect((await storeIn(copy, { folder: "out" })).files).toEqual([`out/${commit}.jsonl`]);
    fs.writeFileSync(element, fs.readFileSync(element, "utf8").replace("Show", "Shew"));
    expect((await storeIn(copy, { folder: "out" })).files).toEqual([`out/${commit}-dirty.jsonl`]);
  });

  it("does not count a state file committed in NFD and checked out in NFC", async () => {
    const ws = await fixture();
    const nfd = "requirements/Ü-notes.md".normalize("NFD");
    const commit = await ws.commitFiles({ [nfd]: "# Notes\n" });
    await ws.git(["reset", "--hard", "-q", commit]);
    const nfc = "requirements/Ü-notes.md".normalize("NFC");
    if (fs.existsSync(ws.path(nfd)) && !fs.existsSync(ws.path(nfc))) {
      fs.renameSync(ws.path(nfd), ws.path(nfc));
    }
    expect((await storeIn(ws.root, { folder: "out" })).files).toEqual([`out/${commit}.jsonl`]);
  });

  it("leaves .git as it was on a copied work tree: the diff and the object round write nothing (D-036)", async () => {
    const ws = await fixture();
    const copy = path.join(tempFolder(), "copy");
    fs.cpSync(ws.root, copy, { recursive: true });
    const snapshot = (): Record<string, string> =>
      Object.fromEntries(
        fs
          .readdirSync(path.join(copy, ".git"), { recursive: true, withFileTypes: true })
          .filter((e) => e.isFile())
          .map((e) => {
            const file = path.join(e.parentPath, e.name);
            return [path.relative(copy, file), fs.readFileSync(file).toString("base64")];
          }),
      );
    const before = snapshot();
    await storeIn(copy, { folder: "out" });
    expect(snapshot()).toEqual(before);
  });

  it("names the file of a workspace in spec/ below the Git top level after HEAD (#377)", async () => {
    const ws = await fixture({ fixture: "SR-062/subfolder", git: true });
    const commit = await ws.head();
    expect(await storeIn(ws.path("spec"), { folder: "out" })).toEqual({
      files: [`out/${commit}.jsonl`],
      problems: [],
    });
  });
});

describe("data.store: where the file may go (K4, ADR-0002 rule 5)", () => {
  /** The `details` of the refusal of `folder`, after checking that nothing was created. */
  const refused = async (ws: FixtureWorkspace, folder: string): Promise<Record<string, unknown>> => {
    const before = fs.readdirSync(ws.root, { recursive: true }).length;
    const error = await failure(ws.root, { folder });
    expect([error.code, fs.readdirSync(ws.root, { recursive: true }).length]).toEqual([
      "input.invalid",
      before,
    ]);
    return error.details as Record<string, unknown>;
  };

  it("refuses .git, node_modules, a folder with a .git entry and a name Windows refuses inside a repository, and creates nothing", async () => {
    const ws = await fixture();
    expect(await refused(ws, "out/.git/x")).toMatchObject({ rule: "skipped-name", path: "out/.git" });
    expect(await refused(ws, ".git")).toMatchObject({ rule: "skipped-name", path: ".git" });
    expect(await refused(ws, "out/node_modules")).toMatchObject({ rule: "skipped-name" });
    await ws.write("vendored/.git/HEAD", "ref: refs/heads/main\n");
    fs.mkdirSync(ws.path("vendored/.git/objects"));
    fs.mkdirSync(ws.path("vendored/.git/refs"));
    expect(await refused(ws, "vendored/out")).toMatchObject({ rule: "git-entry", path: "vendored" });
    expect(await refused(ws, "out/aux")).toMatchObject({ rule: "not-portable", reason: "not-portable" });
    expect(await refused(ws, "README.md/out")).toMatchObject({ rule: "not-a-folder", path: "README.md" });
  });

  it.skipIf(NO_LINKS)(
    "refuses a link inside the repository that leads into it, and judges one that leads out by the rules outside (review N2)",
    async () => {
      const ws = await fixture();
      fs.symlinkSync(ws.path("requirements"), ws.path("linked"));
      expect(await refused(ws, "linked/out")).toMatchObject({ rule: "link", path: "linked" });
      const outside = tempFolder();
      fs.symlinkSync(outside, ws.path("away"));
      const commit = await ws.head();
      expect(await storeIn(ws.root, { folder: "away" })).toEqual({
        files: [path.join(ws.root, "away", `${commit}.jsonl`)],
        problems: [],
      });
      expect(namesIn(outside)).toEqual([`${commit}.jsonl`]);
      fs.mkdirSync(path.join(outside, ".git", "x"), { recursive: true });
      fs.symlinkSync(path.join(outside, ".git", "x"), ws.path("into-git"));
      const error = await failure(ws.root, { folder: "into-git" });
      expect([error.code, error.details]).toEqual([
        "input.invalid",
        { file: `${commit}.jsonl`, reason: "git-folder" },
      ]);
    },
  );

  it("writes into an ignored folder, which it creates, and under an ignore glob for *.jsonl (review S1)", async () => {
    const ws = await fixture();
    const commit = await ws.head();
    expect(await storeIn(ws.root, { folder: "generated/out" })).toEqual({
      files: [`generated/out/${commit}.jsonl`],
      problems: [],
    });
    const json = await fixture({
      fixture: "SR-062/store",
      files: {
        "reqseq-workspace.yaml": fs
          .readFileSync(ws.path("reqseq-workspace.yaml"), "utf8")
          .replace('  - "generated/**"', '  - "generated/**"\n  - "**/*.jsonl"'),
      },
      git: true,
    });
    expect((await storeIn(json.root, { folder: "out" })).files).toEqual([`out/${await json.head()}.jsonl`]);
  });

  it("writes into the repository folder itself and into an existing folder outside every repository, which it names absolute", async () => {
    const ws = await fixture();
    const commit = await ws.head();
    expect((await storeIn(ws.root, { folder: "." })).files).toEqual([`${commit}.jsonl`]);
    const outside = tempFolder();
    expect(await storeIn(ws.root, { folder: outside })).toEqual({
      files: [path.join(outside, `${commit}.jsonl`)],
      problems: [],
    });
    expect(readLines(path.join(outside, `${commit}.jsonl`))).toEqual(linesOf(await exportIn(ws.root)));
  });

  it("refuses a missing folder outside, a path through a file outside and a folder in .git outside", async () => {
    const ws = await fixture();
    const outside = tempFolder();
    const missing = await failure(ws.root, { folder: path.join(outside, "missing") });
    expect([missing.code, missing.details]).toEqual([
      "file.folder-missing",
      { folder: path.join(outside, "missing") },
    ]);
    fs.writeFileSync(path.join(outside, "file.txt"), "a file");
    expect((await failure(ws.root, { folder: path.join(outside, "file.txt", "out") })).code).toBe(
      "file.folder-missing",
    );
    expect((await failure(ws.root, { folder: path.join(outside, "file.txt") })).code).toBe(
      "file.folder-missing",
    );
    fs.mkdirSync(path.join(outside, "other", ".Git", "out"), { recursive: true });
    const git = await failure(ws.root, { folder: path.join(outside, "other", ".Git", "out") });
    expect([git.code, (git.details as { reason?: string }).reason]).toEqual(["input.invalid", "git-folder"]);
    expect(namesIn(path.join(outside, "other", ".Git", "out"))).toEqual([]);
  });

  it.skipIf(NO_PERMISSIONS)(
    "gives file.unreadable when a folder above the target cannot be looked at (review N2)",
    async () => {
      const ws = await fixture();
      fs.mkdirSync(ws.path("locked/inner"), { recursive: true });
      fs.chmodSync(ws.path("locked"), 0o000);
      onTestFinished(() => {
        fs.chmodSync(ws.path("locked"), 0o755);
      });
      expect(await storeIn(ws.root, { folder: "locked/inner/out" })).toEqual({
        files: [],
        problems: [
          {
            code: "file.unreadable",
            severity: "error",
            file: "locked/inner/out",
            message:
              "Not stored: the folder locked/inner/out or a folder above it cannot be looked at (EACCES)",
          },
        ],
      });
    },
  );

  it.skipIf(NO_LINKS)(
    "gives file.unreadable for a loop of links above the target, also as root (ELOOP)",
    async () => {
      const ws = await fixture();
      fs.symlinkSync(ws.path("loop-b"), ws.path("loop-a"));
      fs.symlinkSync(ws.path("loop-a"), ws.path("loop-b"));
      expect(await storeIn(ws.root, { folder: "loop-a/out" })).toEqual({
        files: [],
        problems: [
          {
            code: "file.unreadable",
            severity: "error",
            file: "loop-a/out",
            message: "Not stored: the folder loop-a/out or a folder above it cannot be looked at (ELOOP)",
          },
        ],
      });
      expect(namesIn(ws.root)).not.toContain("out");
    },
  );

  it("refuses a folder before the export is built (review N1)", async () => {
    const ws = await fixture();
    vi.mocked(exportModule.exportDataWithProblems).mockClear();
    await failure(ws.root, { folder: "out/.git" });
    expect(exportModule.exportDataWithProblems).not.toHaveBeenCalled();
    await storeIn(ws.root, { folder: "out" });
    expect(exportModule.exportDataWithProblems).toHaveBeenCalledTimes(1);
  });

  it("replaces only a ReqSeq data file: another file of the name stays as it is", async () => {
    const ws = await fixture();
    const commit = await ws.head();
    // Not ReqSeq's: the old JSON form of version 1, another first line, a byte order mark, a first key
    // other than reqseq-data, a first line cut inside the signature.
    for (const text of [
      '{"reqseq-data":1}\n',
      '{"reqseq-data":1,"workspace":"W","elements":[]}\n',
      "[1]\n",
      "null\n",
      "not json\n",
      '\ufeff{"reqseq-data":2}\n',
      '{"id":"a","reqseq-data":2}\n',
      '{"reqseq-data":2',
    ]) {
      await ws.write(`out/${commit}.jsonl`, text);
      const error = await failure(ws.root, { folder: "out" });
      expect([error.code, error.details]).toEqual([
        "input.invalid",
        { file: `${commit}.jsonl`, reason: "not-a-data-file" },
      ]);
      expect(fs.readFileSync(ws.path(`out/${commit}.jsonl`), "utf8")).toBe(text);
    }
    // Broken UTF-8 after a first line of ReqSeq: anything but a cut at the end.
    await ws.write(
      `out/${commit}.jsonl`,
      Buffer.concat([
        Buffer.from('{"reqseq-data":2,"dirty":false}\n{"t":"'),
        Buffer.from([0xff]),
        Buffer.from('"}\n'),
      ]),
    );
    expect((await failure(ws.root, { folder: "out" })).code).toBe("input.invalid");
    fs.rmSync(ws.path(`out/${commit}.jsonl`));
    fs.mkdirSync(ws.path(`out/${commit}.jsonl`));
    expect((await failure(ws.root, { folder: "out" })).code).toBe("file.faulty");
  });

  it.skipIf(NO_PERMISSIONS)(
    "gives file.read-only for an existing data file that is not writable",
    async () => {
      const ws = await fixture();
      const commit = await ws.head();
      await ws.write(`out/${commit}.jsonl`, '{"reqseq-data":2,"dirty":false}\n');
      fs.chmodSync(ws.path(`out/${commit}.jsonl`), 0o444);
      expect((await failure(ws.root, { folder: "out" })).code).toBe("file.read-only");
    },
  );

  it.skipIf(NO_LINKS)(
    "refuses a folder that became a link after it was created (the second check)",
    async () => {
      const ws = await fixture();
      vi.mocked(files.createFolder).mockImplementationOnce((root, folder) => {
        fs.symlinkSync(ws.path("requirements"), path.join(root, folder));
        return Promise.resolve(folder);
      });
      const error = await failure(ws.root, { folder: "out" });
      expect([error.code, (error.details as { rule?: string }).rule]).toEqual(["input.invalid", "link"]);
      expect(namesIn(ws.path("requirements"))).not.toContain(`${await ws.head()}.jsonl`);
    },
  );

  it("writes nothing when the commit of the main repository is gone after the export", async () => {
    const ws = await fixture();
    vi.mocked(reader.headCommit)
      .mockImplementationOnce(actual.headCommit)
      .mockResolvedValueOnce({ known: false, reason: "timeout", detail: "slow" });
    expect(await storeIn(ws.root, { folder: "out" })).toEqual({
      files: [],
      problems: [
        {
          code: "git.unavailable",
          severity: "error",
          repository: "system",
          message:
            "Not stored: the commit of the main repository system is unknown (it was no longer known after the export); the file is named after it",
        },
      ],
    });
    expect(fs.existsSync(ws.path("out"))).toBe(false);
  });
});

describe("data.store: a file larger than one string (#277, #319)", () => {
  it("[SR-062/AK1] writes the lines of jsonLines, in chunks given lazily (review S6)", async () => {
    const ws = await fixture(EXPORT);
    const commit = await ws.head("system");
    vi.mocked(files.writeFileAtomic).mockClear();
    vi.mocked(exportModule.exportDataWithProblems).mockClear();
    await storeIn(ws.path("system"), { folder: "out" });
    const text = fs.readFileSync(ws.path(`system/out/${commit}.jsonl`), "utf8");
    const built = (await vi.mocked(exportModule.exportDataWithProblems).mock.results[0]
      ?.value) as exportModule.ExportWithProblems;
    expect(text).toBe(
      linesOf(built.data)
        .map((line) => `${JSON.stringify(line)}\n`)
        .join(""),
    );
    const call = vi.mocked(files.writeFileAtomic).mock.calls[0];
    expect(typeof call?.[2]).toBe("function");
    expect(call?.[4]).toEqual({ kind: "jsonl" });
  });

  it("writes an empty file for a selection without elements, and replaces it", async () => {
    const ws = await fixture();
    const commit = await ws.head();
    const none = { folder: "out", selection: { ids: [] } };
    const selected = await storeIn(ws.root, none);
    expect(selected.files).toEqual([`out/${commit}.jsonl`]);
    expect(fs.readFileSync(ws.path(`out/${commit}.jsonl`), "utf8")).toBe("");
    expect((await storeIn(ws.root, none)).files).toEqual([`out/${commit}.jsonl`]);
  });
});

describe("data.store: selection and read-only workspace", () => {
  it("stores a package selection under the same name", async () => {
    const ws = await fixture(EXPORT);
    const commit = await ws.head("system");
    const out = await storeIn(ws.path("system"), { folder: "out", selection: { package: "PKG-0000d1" } });
    expect(out.files).toEqual([`out/${commit}.jsonl`]);
    const lines = readLines(ws.path(`system/out/${commit}.jsonl`));
    expect(lines.map((e) => e.id.slice(-2))).toEqual(["b1", "b2"]);
  });

  it("takes selection.baseline (SR-061 AK2), which element.list still refuses", async () => {
    const ws = await fixture(EXPORT);
    const root = ws.path("system");
    const out = await storeIn(root, { folder: "out", selection: { baseline: "release-1" } });
    const lines = readLines(path.join(root, String(out.files[0])));
    expect(lines.map((e) => e.id.slice(-2))).toEqual(["a1", "b1", "b3"]);
    const workspace = new Workspace(root);
    onTestFinished(() => workspace.close());
    await expect(
      invoke("element.list", { selection: { baseline: "release-1" } }, { workspace }),
    ).rejects.toMatchObject({ code: "input.invalid" });
  });

  it("data.store is refused with workspace.read-only while the metamodel is faulty", async () => {
    const ws = await fixture();
    fs.writeFileSync(ws.path("metamodel/standard-model.yaml"), "reqseq-metamodel: 1\ntypes: nope\n");
    const error = await failure(ws.root, { folder: "out" });
    expect(error.code).toBe("workspace.read-only");
    expect(fs.existsSync(ws.path("out"))).toBe(false);
  });
});

describe("data.store: nested repositories", () => {
  it("writes into the deepest repository of the workspace the folder lies in, and leaves the other repository's files out of the outer one", async () => {
    const ws = await fixture({
      fixture: "SR-062/store",
      files: {
        "reqseq-workspace.yaml":
          'reqseq-workspace: 1\nname: Nested\nrepositories:\n  - { name: system, url: "u", main: true }\n' +
          '  - { name: inner, url: "v", path: inner }\nmetamodel: { repository: system, path: metamodel }\n',
        "inner/requirements/SR-0000000000c1.md":
          "---\nid: 62062062-0000-4000-8000-0000000000c1\ntype: system-requirement\nstatus: draft\ntitle: Inner\n---\n",
      },
      git: true,
    });
    const commit = await ws.head();
    const out = await storeIn(ws.root, { folder: "inner/out" });
    expect(out).toEqual({ files: [`inner/out/${commit}.jsonl`], problems: [] });
    expect(stateIn(ws.path(`inner/out/${commit}.jsonl`))).toEqual([[commit, false]]);
    expect((await exportIn(ws.root)).repositories).toEqual([
      { name: "system", available: true, commit, dirty: false },
      { name: "inner", available: true, commit, dirty: false },
    ]);
  });

  it("does not count an image an element embeds from a nested repository", async () => {
    const ws = await fixture({
      fixture: "SR-062/store",
      files: {
        "vendored/pic.png": "pic",
        "requirements/SR-0000000000a4.md":
          "---\nid: 62062062-0000-4000-8000-0000000000a4\ntype: system-requirement\nstatus: draft\ntitle: Vendored\n---\n\n![Pic](../vendored/pic.png)\n",
      },
      git: ["vendored"],
    });
    await ws.git(["init", "-q"]);
    await ws.write(".gitignore", "vendored/\n");
    const commit = await ws.commit();
    expect((await storeIn(ws.root, { folder: "out" })).files).toEqual([`out/${commit}.jsonl`]);
  });
});

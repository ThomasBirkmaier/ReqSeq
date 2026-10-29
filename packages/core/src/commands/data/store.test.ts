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
import { storeData } from "../../data/index.js";
import * as files from "../../files/index.js";
import * as reader from "../../git/reader.js";
import { resolveSelection } from "../../query/index.js";
import { fileSchemaValidator } from "../../runtime/contracts.js";
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

const readData = (file: string): Data => JSON.parse(fs.readFileSync(file, "utf8")) as Data;

/** The data without the time of the call. */
const timeless = (data: Data): Omit<Data, "generated"> => {
  const { generated: _generated, ...rest } = data;
  return rest;
};

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
  expect(file).toMatch(/^out\/[0-9a-f]{40}(-dirty)?\.json$/);
  return file.endsWith("-dirty.json");
};

const append = (ws: FixtureWorkspace, file: string, text: string): void => {
  fs.appendFileSync(ws.path(file), text);
};

describe("data.store: the data of a state as a file named after its commit (SR-062 AK1)", () => {
  it("[SR-062/AK1] writes the data of the state into the given folder as a JSON file named after the commit of the main repository", async () => {
    const ws = await fixture(EXPORT);
    const root = ws.path("system");
    const commit = await ws.head("system");
    expect(fs.existsSync(ws.path("system/out"))).toBe(false);
    const out = await storeIn(root, { folder: "out" });
    expect(out).toEqual({ files: [`out/${commit}.json`], problems: [] });
    const text = fs.readFileSync(ws.path(`system/out/${commit}.json`), "utf8");
    expect(text.startsWith('{"logreq-data":2,')).toBe(true);
    expect(text.endsWith("}\n")).toBe(true);
    const data = JSON.parse(text) as Data;
    expect(timeless(data)).toEqual(timeless(await exportIn(root)));
    expect(data.repositories).toEqual([
      { name: "system", available: true, commit, dirty: false },
      { name: "sensor", available: true, commit: await ws.head("sensor"), dirty: false },
    ]);
  });

  it("[SR-062/AK1] names the file <commit>-dirty.json when an element file has uncommitted changes", async () => {
    const changed = await fixture();
    const commit = await changed.head();
    append(changed, "requirements/SR-0000000000a1.md", "More text.\n");
    expect(await storeIn(changed.root, { folder: "out" })).toEqual({
      files: [`out/${commit}-dirty.json`],
      problems: [],
    });
    expect(readData(changed.path(`out/${commit}-dirty.json`)).repositories).toEqual([
      { name: "system", available: true, commit, dirty: true },
    ]);
    const added = await fixture();
    await added.write(
      "requirements/SR-0000000000a3.md",
      "---\nid: 62062062-0000-4000-8000-0000000000a3\ntype: system-requirement\nstatus: draft\ntitle: New\n---\n",
    );
    expect((await storeIn(added.root, { folder: "out" })).files).toEqual([`out/${commit}-dirty.json`]);
  });

  it("[SR-062/AK1] a dirty second repository makes the file -dirty too", async () => {
    const ws = await fixture(EXPORT);
    append(ws, "sensor/requirements/SR-0000000000e1.md", "Changed.\n");
    const commit = await ws.head("system");
    const out = await storeIn(ws.path("system"), { folder: "out" });
    expect(out.files).toEqual([`out/${commit}-dirty.json`]);
    expect(readData(ws.path(`system/out/${commit}-dirty.json`)).repositories.map((r) => r.dirty)).toEqual([
      false,
      true,
    ]);
  });

  it("[SR-062/AK1] a second run on the same commit replaces the file of that commit", async () => {
    const ws = await fixture();
    const commit = await ws.head();
    const file = ws.path(`out/${commit}.json`);
    await storeIn(ws.root, { folder: "out" });
    const first = readData(file);
    fs.writeFileSync(file, JSON.stringify({ ...first, generated: "2000-01-01T00:00:00Z" }));
    expect(await storeIn(ws.root, { folder: "out" })).toEqual({
      files: [`out/${commit}.json`],
      problems: [],
    });
    expect(namesIn(ws.path("out"))).toEqual([`${commit}.json`]);
    expect(readData(file).generated).not.toBe("2000-01-01T00:00:00Z");
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

  it("[SR-062/AK2] the stored file matches the shipped data-export.schema.json and names no path of this machine", async () => {
    const ws = await fixture(EXPORT);
    const out = await storeIn(ws.path("system"), { folder: "out" });
    const text = fs.readFileSync(ws.path(`system/${String(out.files[0])}`), "utf8");
    const validate = fileSchemaValidator("data-export.schema.json");
    expect([validate(JSON.parse(text)), validate.errors]).toEqual([true, null]);
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
      files: [`out/${commit}-dirty.json`],
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
    expect(readData(ws.path(`system/out/${commit}-dirty.json`)).repositories).toEqual([
      { name: "system", available: true, commit, dirty: false },
      { name: "sensor", available: true },
    ]);
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
    expect(out.files).toEqual([`out/${commit}-dirty.json`]);
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

  it("names the file -dirty when Git cannot tell the changes, with a warning, and no dirty in the file", async () => {
    const ws = await fixture();
    const commit = await ws.head();
    vi.mocked(reader.changedPaths).mockResolvedValueOnce({ known: false, reason: "timeout", detail: "slow" });
    const out = await storeIn(ws.root, { folder: "out" });
    expect(out).toEqual({
      files: [`out/${commit}-dirty.json`],
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
    expect(readData(ws.path(`out/${commit}-dirty.json`)).repositories).toEqual([
      { name: "system", available: true, commit },
    ]);
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
    expect(out.files).toEqual([`out/${commit}.json`]);
    expect(out.problems).toEqual([
      {
        code: "workspace.repository-missing",
        severity: "info",
        message: "Repository sensor is not available locally",
      },
    ]);
    const data = readData(ws.path(`system/out/${commit}.json`));
    expect(data.incomplete).toBe(true);
    expect(data.repositories).toEqual([
      { name: "system", available: true, commit, dirty: false },
      { name: "sensor", available: false },
    ]);
  });
});

describe("data.store: which changes make the state dirty (K2)", () => {
  it("counts changes to the workspace file, the YAML files of the metamodel, filter and baseline folders and any Markdown file the walk reads", async () => {
    const ws = await fixture();
    expect(await dirtyAfter(ws, () => undefined)).toBe(false);
    expect(
      await dirtyAfter(ws, () => {
        append(ws, "logreq-workspace.yaml", "# changed\n");
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
    expect(await dirtyAfter(ws, () => ws.write("baselines/release-2.yml", "logreq-baseline: 1\n"))).toBe(
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

  it("keeps <commit>.json and dirty: false for a committed link to an embedded file that exists nowhere", async () => {
    const ws = await fixture({
      ...STORE,
      files: {
        "requirements/SR-0000000000a7.md":
          "---\nid: 62062062-0000-4000-8000-0000000000a7\ntype: system-requirement\nstatus: draft\ntitle: Show a gone image\n---\n\n![Gone](SR-a7/missing.png)\n",
      },
    });
    const commit = await ws.head();
    expect(await storeIn(ws.root, { folder: "out" })).toEqual({
      files: [`out/${commit}.json`],
      problems: [],
    });
    expect(readData(ws.path(`out/${commit}.json`)).repositories).toEqual([
      { name: "system", available: true, commit, dirty: false },
    ]);
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
    expect(out.files).toEqual([`out/${await ws.head()}-dirty.json`]);
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

  it("does not count evidence records, the local file, code, ignored Markdown and stored JSON files", async () => {
    const ws = await fixture();
    const unchanged = async (change: () => Promise<void> | void): Promise<void> => {
      expect(await dirtyAfter(ws, change)).toBe(false);
    };
    await unchanged(() => {
      append(ws, "evidence/2026-10-20-SR-a1-test.md", "More.\n");
    });
    await unchanged(() => ws.write("evidence/ci/run.xml", "<testsuites/>\n"));
    await unchanged(() => ws.write(".logreq/local.yaml", "logreq-local: 1\n"));
    await unchanged(() => {
      append(ws, "src/tool.py", "MORE = 2\n");
    });
    await unchanged(() => {
      append(ws, "generated/notes.md", "More.\n");
    });
    await unchanged(() =>
      ws.write("out/0000000000000000000000000000000000000000.json", '{"logreq-data":2}\n'),
    );
    await unchanged(() => ws.write("metamodel/extra.json", "{}\n"));
    await unchanged(() => ws.write("requirements/notes.MD", "Not an element file name.\n"));
  });

  it("compares content, not stat data: a copied work tree is clean, a touched file too, a changed byte is not (review S2)", async () => {
    const ws = await fixture();
    const copy = path.join(tempFolder(), "copy");
    fs.cpSync(ws.root, copy, { recursive: true });
    const commit = await ws.head();
    expect((await storeIn(copy, { folder: "out" })).files).toEqual([`out/${commit}.json`]);
    expect(readData(path.join(copy, `out/${commit}.json`)).repositories[0]?.dirty).toBe(false);
    const element = path.join(copy, "requirements/SR-0000000000a1.md");
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(element, later, later);
    expect((await storeIn(copy, { folder: "out" })).files).toEqual([`out/${commit}.json`]);
    fs.writeFileSync(element, fs.readFileSync(element, "utf8").replace("Show", "Shew"));
    expect((await storeIn(copy, { folder: "out" })).files).toEqual([`out/${commit}-dirty.json`]);
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
    expect((await storeIn(ws.root, { folder: "out" })).files).toEqual([`out/${commit}.json`]);
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
      files: [`out/${commit}.json`],
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
        files: [path.join(ws.root, "away", `${commit}.json`)],
        problems: [],
      });
      expect(namesIn(outside)).toEqual([`${commit}.json`]);
      fs.mkdirSync(path.join(outside, ".git", "x"), { recursive: true });
      fs.symlinkSync(path.join(outside, ".git", "x"), ws.path("into-git"));
      const error = await failure(ws.root, { folder: "into-git" });
      expect([error.code, error.details]).toEqual([
        "input.invalid",
        { file: `${commit}.json`, reason: "git-folder" },
      ]);
    },
  );

  it("writes into an ignored folder, which it creates, and under an ignore glob for *.json (review S1)", async () => {
    const ws = await fixture();
    const commit = await ws.head();
    expect(await storeIn(ws.root, { folder: "generated/out" })).toEqual({
      files: [`generated/out/${commit}.json`],
      problems: [],
    });
    const json = await fixture({
      fixture: "SR-062/store",
      files: {
        "logreq-workspace.yaml": fs
          .readFileSync(ws.path("logreq-workspace.yaml"), "utf8")
          .replace('  - "generated/**"', '  - "generated/**"\n  - "**/*.json"'),
      },
      git: true,
    });
    expect((await storeIn(json.root, { folder: "out" })).files).toEqual([`out/${await json.head()}.json`]);
  });

  it("writes into the repository folder itself and into an existing folder outside every repository, which it names absolute", async () => {
    const ws = await fixture();
    const commit = await ws.head();
    expect((await storeIn(ws.root, { folder: "." })).files).toEqual([`${commit}.json`]);
    const outside = tempFolder();
    expect(await storeIn(ws.root, { folder: outside })).toEqual({
      files: [path.join(outside, `${commit}.json`)],
      problems: [],
    });
    expect(timeless(readData(path.join(outside, `${commit}.json`)))).toEqual(
      timeless(await exportIn(ws.root)),
    );
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
    for (const text of ['{"logreq-data":1}', "[1]", "null", "not json", "﻿{}"]) {
      await ws.write(`out/${commit}.json`, text);
      const error = await failure(ws.root, { folder: "out" });
      expect([error.code, error.details]).toEqual([
        "input.invalid",
        { file: `${commit}.json`, reason: "not-a-data-file" },
      ]);
      expect(fs.readFileSync(ws.path(`out/${commit}.json`), "utf8")).toBe(text);
    }
    await ws.write(`out/${commit}.json`, Buffer.from([0x7b, 0xff, 0x7d]));
    expect((await failure(ws.root, { folder: "out" })).code).toBe("input.invalid");
    fs.rmSync(ws.path(`out/${commit}.json`));
    fs.mkdirSync(ws.path(`out/${commit}.json`));
    expect((await failure(ws.root, { folder: "out" })).code).toBe("file.faulty");
  });

  it.skipIf(NO_PERMISSIONS)(
    "gives file.read-only for an existing data file that is not writable",
    async () => {
      const ws = await fixture();
      const commit = await ws.head();
      await ws.write(`out/${commit}.json`, '{"logreq-data":2}\n');
      fs.chmodSync(ws.path(`out/${commit}.json`), 0o444);
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
      expect(namesIn(ws.path("requirements"))).not.toContain(`${await ws.head()}.json`);
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

describe("data.store: a file larger than one string (#277)", () => {
  it("[SR-062/AK1] writes the bytes of JSON.stringify and a line break, in chunks given lazily (review S6)", async () => {
    const ws = await fixture(EXPORT);
    const commit = await ws.head("system");
    vi.mocked(files.writeFileAtomic).mockClear();
    vi.mocked(exportModule.exportDataWithProblems).mockClear();
    await storeIn(ws.path("system"), { folder: "out" });
    const text = fs.readFileSync(ws.path(`system/out/${commit}.json`), "utf8");
    const built = (await vi.mocked(exportModule.exportDataWithProblems).mock.results[0]
      ?.value) as exportModule.ExportWithProblems;
    expect(text).toBe(`${JSON.stringify(built.data)}\n`);
    const content = vi.mocked(files.writeFileAtomic).mock.calls[0]?.[2];
    expect(typeof content).toBe("function");
  });

  it("replaces a data file over the bound by its frame, which the guard and the refusal check alike (review B1)", async () => {
    const ws = await fixture();
    const commit = await ws.head();
    // The frame of a data file around bytes that are no JSON: above the bound only the frame counts.
    const framed = `{"logreq-data":2,"elements":[${"x".repeat(300)}}\n`;
    const store = async (fullParseUpTo?: number): Promise<Output> => {
      const workspace = new Workspace(ws.root);
      try {
        const selected = await resolveSelection(workspace, {}, "data.store", { baseline: true });
        return await storeData(
          workspace,
          selected,
          { folder: "out" },
          fullParseUpTo === undefined ? {} : { fullParseUpTo },
        );
      } finally {
        await workspace.close();
      }
    };
    await ws.write(`out/${commit}.json`, framed);
    await expect(store()).rejects.toMatchObject({
      code: "input.invalid",
      details: { reason: "not-a-data-file" },
    });
    expect(fs.readFileSync(ws.path(`out/${commit}.json`), "utf8")).toBe(framed);
    expect(await store(100)).toEqual({ files: [`out/${commit}.json`], problems: [] });
    const text = fs.readFileSync(ws.path(`out/${commit}.json`), "utf8");
    expect((JSON.parse(text) as Data)["logreq-data"]).toBe(2);
    // The stored file is over the bound too, and is replaced again.
    expect(text.length).toBeGreaterThan(100);
    expect(await store(100)).toEqual({ files: [`out/${commit}.json`], problems: [] });
  });
});

describe("data.store: selection and read-only workspace", () => {
  it("stores a package selection with the selection in the file and the same name", async () => {
    const ws = await fixture(EXPORT);
    const commit = await ws.head("system");
    const out = await storeIn(ws.path("system"), { folder: "out", selection: { package: "PKG-0000d1" } });
    expect(out.files).toEqual([`out/${commit}.json`]);
    const data = readData(ws.path(`system/out/${commit}.json`));
    expect(data.selection).toEqual({ package: "PKG-0000d1" });
    expect(data.elements.map((e) => e.id.slice(-2))).toEqual(["b1", "b2"]);
  });

  it("takes selection.baseline (SR-061 AK2), which element.list still refuses", async () => {
    const ws = await fixture(EXPORT);
    const root = ws.path("system");
    const out = await storeIn(root, { folder: "out", selection: { baseline: "release-1" } });
    const data = readData(path.join(root, String(out.files[0])));
    expect(data.elements.map((e) => e.id.slice(-2))).toEqual(["a1", "b1", "b3"]);
    const workspace = new Workspace(root);
    onTestFinished(() => workspace.close());
    await expect(
      invoke("element.list", { selection: { baseline: "release-1" } }, { workspace }),
    ).rejects.toMatchObject({ code: "input.invalid" });
  });

  it("data.store is refused with workspace.read-only while the metamodel is faulty", async () => {
    const ws = await fixture();
    fs.writeFileSync(ws.path("metamodel/standard-model.yaml"), "logreq-metamodel: 1\ntypes: nope\n");
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
        "logreq-workspace.yaml":
          'logreq-workspace: 1\nname: Nested\nrepositories:\n  - { name: system, url: "u", main: true }\n' +
          '  - { name: inner, url: "v", path: inner }\nmetamodel: { repository: system, path: metamodel }\n',
        "inner/requirements/SR-0000000000c1.md":
          "---\nid: 62062062-0000-4000-8000-0000000000c1\ntype: system-requirement\nstatus: draft\ntitle: Inner\n---\n",
      },
      git: true,
    });
    const commit = await ws.head();
    const out = await storeIn(ws.root, { folder: "inner/out" });
    expect(out).toEqual({ files: [`inner/out/${commit}.json`], problems: [] });
    expect(readData(ws.path(`inner/out/${commit}.json`)).repositories).toEqual([
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
    expect((await storeIn(ws.root, { folder: "out" })).files).toEqual([`out/${commit}.json`]);
  });
});

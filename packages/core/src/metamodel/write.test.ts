// The write layer of the metamodel commands (SR-236): the parts no single command shows, called
// directly with a plan. On fixtures/SR-018/own-repository: types, properties and statuses in three
// files of the repository models; the workspace file and the elements in system.
import { writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@reqseq/testkit";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { CommandError } from "../catalog.js";
import { appendListItem } from "../files/index.js";
import type { YamlFile } from "../files/index.js";
import { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { metamodelState } from "./state.js";
import type { MetamodelChange, MetamodelSource } from "./write.js";
import { changeMetamodel } from "./write.js";

const TYPES = "models/model/types.yaml";
const PROPERTIES = "models/model/properties.yaml";

interface Opened {
  readonly fixture: FixtureWorkspace;
  readonly workspace: Workspace;
  readonly read: (file: string) => Promise<string>;
}

const open = async (options: FixtureOptions = {}): Promise<Opened> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-018/own-repository", ...options });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.path("system"));
  onTestFinished(() => workspace.close());
  return { fixture, workspace, read: (file) => fs.readFile(fixture.path(file), "utf8") };
};

const fileOf = (source: MetamodelSource, name: string): YamlFile => {
  const found = source.files.find((f) => f.path.endsWith(`/${name}`));
  if (found === undefined) {
    throw new Error(`no ${name}`);
  }
  return found;
};

/** A plan that adds a type to types.yaml and a property to properties.yaml. */
const twoFiles = (source: MetamodelSource): ReadonlyMap<string, Uint8Array> => {
  const types = fileOf(source, "types.yaml");
  const properties = fileOf(source, "properties.yaml");
  return new Map([
    [
      types.path,
      appendListItem(types, types.path, ["types"], { key: "risk", name: "Risk", prefix: "RI" }).bytes,
    ],
    [
      properties.path,
      appendListItem(properties, properties.path, ["properties"], { key: "note", name: "Note", kind: "text" })
        .bytes,
    ],
  ]);
};

/** `changeMetamodel` for the command `test` with a plan that gives only bytes. */
const changeWith = (
  workspace: Workspace,
  plan: (source: MetamodelSource) => ReadonlyMap<string, Uint8Array>,
): Promise<MetamodelChange<null>> =>
  changeMetamodel(workspace, "test", (source) => ({ bytes: plan(source), result: null }));

const failure = async (run: Promise<unknown>): Promise<CommandError> => {
  try {
    await run;
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("no error");
};

/** Lets `fs.rename` fail with EIO from its call number `from` (counted from 1) on, up to `to`. */
const failRenames = (from: number, to: number): void => {
  const rename = fs.rename.bind(fs);
  let calls = 0;
  vi.spyOn(fs, "rename").mockImplementation(async (a, b) => {
    calls += 1;
    if (calls >= from && calls <= to) {
      throw Object.assign(new Error("EIO"), { code: "EIO" });
    }
    return rename(a, b);
  });
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("changeMetamodel (SR-236)", () => {
  it("writes every planned file, names them relative to the workspace root and resets the metamodel", async () => {
    const { workspace, read } = await open();
    expect((await workspace.get(metamodelState)).types.map((t) => t.key)).toEqual([
      "need",
      "system-requirement",
    ]);
    const change = await changeWith(workspace, twoFiles);
    expect(change.files).toEqual(["../models/model/properties.yaml", "../models/model/types.yaml"]);
    expect(change.before.types).toHaveLength(2);
    expect(change.after.types).toHaveLength(3);
    expect(await read(TYPES)).toContain("  - key: risk\n");
    expect(await read(PROPERTIES)).toContain("  - key: note\n");
    expect((await workspace.get(metamodelState)).properties.map((p) => p.key)).toEqual(["title", "note"]);
  });

  it("[SR-236/AK-yf6d] puts back every file already written when a later one cannot be written, and names the reason", async () => {
    const { workspace, read } = await open();
    const before = [await read(TYPES), await read(PROPERTIES)];
    // The first write (properties.yaml) succeeds, the second fails, the rollback of the first works.
    failRenames(2, 2);
    const error = await failure(changeWith(workspace, twoFiles));
    expect([error.code, error.message, error.details]).toEqual([
      "internal",
      "Not written: model/types.yaml (EIO)",
      undefined,
    ]);
    expect([await read(TYPES), await read(PROPERTIES)]).toEqual(before);
  });

  it("names the files it could not put back in details.written", async () => {
    const { workspace, read } = await open();
    failRenames(2, 3);
    const error = await failure(changeWith(workspace, twoFiles));
    expect([error.code, error.details]).toEqual([
      "internal",
      { written: ["../models/model/properties.yaml"] },
    ]);
    expect(await read(PROPERTIES)).toContain("  - key: note\n");
  });

  it("[SR-236/AK-jskb] does not write a file another process changed since it was read, and reports an error", async () => {
    const { fixture, workspace, read } = await open();
    const other = `${await read(TYPES)}# changed by another process\n`;
    const error = await failure(
      changeWith(workspace, (source) => {
        const plan = twoFiles(source);
        writeFileSync(fixture.path(TYPES), other);
        return plan;
      }),
    );
    expect(error.code).toBe("file.changed-on-disk");
    expect(await read(TYPES)).toBe(other);
    expect(await read(PROPERTIES)).not.toContain("note");
  });

  it("checks the planned state with the files as read, a file that appeared meanwhile read from disk", async () => {
    const { fixture, workspace } = await open();
    const error = await failure(
      changeWith(workspace, (source) => {
        // Written before the check reads the folder: it defines need a second time.
        writeFileSync(
          fixture.path("models/model/zz.yaml"),
          "reqseq-metamodel: 1\ntypes:\n  - { key: need, name: Need 2, prefix: NN }\n",
        );
        const types = fileOf(source, "types.yaml");
        // Unchanged bytes are no write.
        return new Map([[types.path, new TextEncoder().encode(types.text)]]);
      }),
    );
    expect(error.details).toMatchObject({ reason: "metamodel-invalid" });
    expect(error.message).toContain("an error:");
  });

  it("names the number of errors when there are several", async () => {
    const { workspace } = await open();
    const error = await failure(
      changeWith(workspace, (source) => {
        const types = fileOf(source, "types.yaml");
        const once = appendListItem(types, types.path, ["types"], {
          key: "a",
          name: "A",
          prefix: "A",
          extends: "x",
        });
        const twice = appendListItem(
          { text: new TextDecoder().decode(once.bytes), bom: false },
          types.path,
          ["types"],
          { key: "b", name: "B", prefix: "B", extends: "y" },
        );
        return new Map([[types.path, twice.bytes]]);
      }),
    );
    expect(error.message).toContain("would have 2 errors");
  });

  it("keeps a byte order mark, writes no file whose bytes stay and refuses planned bytes that do not read", async () => {
    const { fixture, workspace, read } = await open();
    await fs.writeFile(fixture.path(TYPES), `\uFEFF${await read(TYPES)}`);
    const change = await changeWith(workspace, (source) => {
      const types = fileOf(source, "types.yaml");
      const properties = fileOf(source, "properties.yaml");
      return new Map([
        [
          types.path,
          appendListItem(types, types.path, ["types"], { key: "r", name: "R", prefix: "R" }).bytes,
        ],
        [properties.path, new TextEncoder().encode(properties.text)],
      ]);
    });
    expect(change.files).toEqual(["../models/model/types.yaml"]);
    expect((await read(TYPES)).startsWith("\uFEFF")).toBe(true);
    const error = await failure(
      changeWith(workspace, (source) => {
        const types = fileOf(source, "types.yaml");
        return new Map([[types.path, new TextEncoder().encode("types: [\n")]]);
      }),
    );
    expect(error.details).toMatchObject({
      reason: "metamodel-invalid",
      problems: [{ code: "file.invalid-yaml" }],
    });
  });

  it("refuses a metamodel that does not read now, also when the workspace read it before", async () => {
    const { fixture, workspace } = await open();
    expect((await workspace.get(metamodelState)).valid).toBe(true);
    await fs.writeFile(fixture.path("models/model/statuses.yaml"), "statuses: [\n");
    const error = await failure(changeWith(workspace, () => new Map()));
    expect(error.code).toBe("workspace.read-only");
    expect(error.details).toMatchObject({ command: "test", problems: [{ code: "file.invalid-yaml" }] });
  });

  it("refuses when the metamodel repository is not on this machine, and names it", async () => {
    const { fixture, workspace } = await open();
    await fs.rm(fixture.path("models"), { recursive: true });
    const error = await failure(changeWith(workspace, () => new Map()));
    expect([error.code, error.message, error.details]).toEqual([
      "workspace.read-only",
      "The metamodel repository models is not on this machine; test changes no file",
      { command: "test", repository: "models", problems: [] },
    ]);
  });

  it("refuses a plan that names a file it did not read", async () => {
    const { workspace } = await open();
    const error = await failure(changeWith(workspace, () => new Map([["model/new.yaml", new Uint8Array()]])));
    expect([error.code, error.message]).toEqual([
      "internal",
      "Not written: model/new.yaml is no metamodel file that was read",
    ]);
  });

  it("names the files it could not put back also after an error that is no command error", async () => {
    const { workspace, read } = await open();
    const realpath = fs.realpath.bind(fs);
    const rename = fs.rename.bind(fs);
    let written = false;
    vi.spyOn(fs, "rename").mockImplementation(async (a, b) => {
      if (written) {
        throw Object.assign(new Error("EIO"), { code: "EIO" });
      }
      await rename(a, b);
      written = true;
    });
    // The Git check of the second file fails with a plain error once the first file is written.
    vi.spyOn(fs, "realpath").mockImplementation((async (target: string) => {
      if (written) {
        throw new Error("broken");
      }
      return realpath(target);
    }) as typeof fs.realpath);
    const error = await failure(changeWith(workspace, twoFiles));
    expect([error.code, error.message, error.details]).toEqual([
      "internal",
      "Not written: ../models/model/types.yaml (Error: broken)",
      { written: ["../models/model/properties.yaml"] },
    ]);
    vi.restoreAllMocks();
    expect(await read(PROPERTIES)).toContain("note");
  });

  it("[SR-236/AK-k2s3] never writes into a metamodel folder that is .git or a repository of its own, and the layout warns about it", async () => {
    for (const [folder, setup] of [
      [".git/m", undefined],
      ["meta", "meta/.git"],
    ] as const) {
      const { fixture, workspace } = await open({
        files: {
          "system/reqseq-workspace.yaml": `reqseq-workspace: 1\nname: Weather station\nrepositories:\n  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\nmetamodel: { repository: system, path: ${folder} }\n`,
        },
      });
      const into = fixture.path(`system/${folder}`);
      await fs.mkdir(into, { recursive: true });
      for (const name of ["types.yaml", "properties.yaml", "statuses.yaml"]) {
        await fs.copyFile(fixture.path(`models/model/${name}`), path.join(into, name));
      }
      if (setup !== undefined) {
        await fs.writeFile(fixture.path(`system/${setup}`), "gitdir: elsewhere\n");
      }
      const before = await fs.readFile(path.join(into, "types.yaml"), "utf8");
      const error = await failure(
        changeWith(workspace, (source) => {
          const types = fileOf(source, "types.yaml");
          return new Map([
            [
              types.path,
              appendListItem(types, types.path, ["types"], { key: "r", name: "R", prefix: "R" }).bytes,
            ],
          ]);
        }),
      );
      expect([folder, error.code, error.details?.["reason"]]).toEqual([
        folder,
        "input.invalid",
        "git-folder",
      ]);
      expect(await fs.readFile(path.join(into, "types.yaml"), "utf8")).toBe(before);
      const layout = await workspace.get(workspaceLayoutState);
      expect(layout.problems.map((p) => p.message).filter((m) => m.startsWith("metamodel:"))).toHaveLength(1);
    }
  });
});

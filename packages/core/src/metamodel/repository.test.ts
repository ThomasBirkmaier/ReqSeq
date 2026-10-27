// SR-018: the metamodel in its own repository, also when that repository is read-only, and as a
// folder in the main repository. No element command exists yet (#127 option 1), so AK2 is shown at
// the lowest core level: workspace.status, the read-only guard of `invoke` with stand-in commands,
// and the files block that every write goes through.
import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@logreq/testkit";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { AnyCommand, CommandContext, CommandOutput } from "../catalog.js";
import { defineTestCommand } from "../catalog.js";
import { readYamlFile, writeFileAtomic } from "../files/index.js";
import type { YamlFile } from "../files/index.js";
import { loadContracts } from "../runtime/contracts.js";
import { createCommandRuntime, invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { workspaceAccess } from "./access.js";
import { metamodelState } from "./state.js";

const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code });

/** Files and folders below `folder`, and `folder` itself first. */
const tree = async (folder: string): Promise<{ files: string[]; folders: string[] }> => {
  const entries = await fs.readdir(folder, { recursive: true, withFileTypes: true });
  const below = (dirs: boolean): string[] =>
    entries.filter((e) => (dirs ? e.isDirectory() : e.isFile())).map((e) => path.join(e.parentPath, e.name));
  return { files: below(false), folders: [folder, ...below(true)] };
};

/** Takes write permission away from a folder and everything in it; the fixture gives it back. */
const makeReadOnly = async (folder: string): Promise<void> => {
  const { files, folders } = await tree(folder);
  for (const f of files) {
    await fs.chmod(f, 0o444);
  }
  for (const f of [...folders].reverse()) {
    await fs.chmod(f, 0o555);
  }
};

/** Gives write permission back so the fixture can be removed (without root a 0555 folder cannot). */
const makeWritable = async (folder: string): Promise<void> => {
  await fs.chmod(folder, 0o755);
  const { files, folders } = await tree(folder);
  for (const f of folders) {
    await fs.chmod(f, 0o755);
  }
  for (const f of files) {
    await fs.chmod(f, 0o644);
  }
};

const fixture = async (options: FixtureOptions = {}): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace({ fixture: "SR-018/own-repository", ...options });
  onTestFinished(async () => {
    await makeWritable(created.root);
    await created.cleanup();
  });
  return created;
};

/**
 * `readOnly: false` of a writable repository folder. Left out on Windows, where the operating
 * system cannot tell (`isWritableFolder`), so the expectation follows the platform.
 */
const writable: { readonly readOnly?: false } = process.platform === "win32" ? {} : { readOnly: false };

/** `system` holds the workspace file and the elements, `models` the metamodel folder `model`. */
const ownRepository = (): Promise<FixtureWorkspace> => fixture({ git: ["system", "models"] });

const open = (root: string): Workspace => {
  const workspace = new Workspace(root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const status = async (workspace: Workspace): Promise<CommandOutput<"workspace.status">> =>
  (await invoke("workspace.status", {}, { workspace })) as CommandOutput<"workspace.status">;

/** Lets `fs.access` fail with `code` for `folder` only: a read-only metamodel repository. */
const denyWriteAccess = (folder: string, code: string): void => {
  const access = fs.access.bind(fs);
  vi.spyOn(fs, "access").mockImplementation((target, mode) =>
    target === folder ? Promise.reject(errno(code)) : access(target, mode),
  );
};

/** Lets `process.platform` be `value` for the rest of the test (see `isWritableFolder`). */
const onPlatform = (value: NodeJS.Platform): void => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value });
  onTestFinished(() => {
    if (platform !== undefined) {
      Object.defineProperty(process, "platform", platform);
    }
  });
};

const parsedYaml = async (root: string, file: string): Promise<YamlFile> => {
  const read = await readYamlFile(root, file);
  if (read.kind !== "parsed") {
    throw new Error(`expected ${file} to parse`);
  }
  return read.file;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("metamodel in its own repository (SR-018)", () => {
  it("[SR-018/AK1] reads the metamodel from the repository the workspace file names", async () => {
    const ws = await ownRepository();
    const workspace = open(ws.path("system"));
    expect(await status(workspace)).toEqual({
      name: "Weather station",
      repositories: [
        { name: "system", available: true, path: ".", commit: await ws.head("system"), ...writable },
        { name: "models", available: true, path: "../models", commit: await ws.head("models"), ...writable },
      ],
      metamodel: { repository: "models", path: "model", valid: true },
      readOnly: false,
      problems: [],
    });
    const metamodel = await workspace.get(metamodelState);
    expect(metamodel.files).toEqual(["model/properties.yaml", "model/statuses.yaml", "model/types.yaml"]);
    // Not the folder metamodel/ of the main repository, which the workspace file does not name.
    expect(metamodel.types.map((t) => t.key)).toEqual(["need", "system-requirement"]);
    expect(metamodel.statuses.map((s) => s.key)).toEqual(["draft", "accepted"]);
  });

  it("[SR-018/AK1] reports metamodel findings in the metamodel repository, with the file relative to it", async () => {
    const ws = await ownRepository();
    await ws.write(
      "models/model/statuses.yaml",
      "logreq-metamodel: 1\nstatuses:\n  - key: draft\n    name: [Draft\n",
    );
    const out = await status(open(ws.path("system")));
    expect(out).toMatchObject({ metamodel: { repository: "models", valid: false }, readOnly: true });
    expect(out.problems?.map((p) => [p.code, p.repository, p.file, p.line])).toEqual([
      ["file.invalid-yaml", "models", "model/statuses.yaml", 4],
    ]);
  });

  it.each([
    ["EROFS", "a read-only file system"],
    ["EACCES", "a checkout without write permission"],
  ])(
    "[SR-018/AK2] shows a metamodel repository on %s (%s) as read-only and keeps the workspace writable",
    async (code) => {
      const ws = await ownRepository();
      // Simulated: the tests may run as root, which ignores missing write permission. A POSIX
      // platform, since on Windows the operating system cannot tell (isWritableFolder).
      onPlatform("linux");
      denyWriteAccess(ws.path("models"), code);
      const workspace = open(ws.path("system"));
      const out = await status(workspace);
      expect(out.repositories.map((r) => [r.name, r.available, r.readOnly])).toEqual([
        ["system", true, false],
        ["models", true, true],
      ]);
      expect(out).toMatchObject({
        metamodel: { repository: "models", valid: true },
        readOnly: false,
        problems: [],
      });
      expect(await workspaceAccess(workspace)).toEqual({ readOnly: false, reasons: [] });
    },
  );

  it("leaves readOnly out on Windows, where the operating system cannot tell, and stays writable", async () => {
    const ws = await ownRepository();
    onPlatform("win32");
    const out = await status(open(ws.path("system")));
    expect(out.repositories.map((r) => [r.name, "readOnly" in r])).toEqual([
      ["system", false],
      ["models", false],
    ]);
    expect(out).toMatchObject({ metamodel: { valid: true }, readOnly: false });
  });

  it("[SR-018/AK2] runs read and write commands while the metamodel repository is read-only", async () => {
    // Stand-ins with the effects of the real catalog entries: the guard of `invoke` decides by
    // `effect`, so every element command behaves like these.
    const entry = (name: string, effect: "read" | "write-files"): Record<string, unknown> => ({
      name,
      title: "Test command",
      summary: `${name} (test only).`,
      effect,
      stage: 1,
      implements: ["SR-018"],
      arguments: [],
      input: { type: "object", additionalProperties: false },
      output: {
        type: "object",
        required: ["ran"],
        properties: { ran: { const: true } },
        additionalProperties: false,
      },
    });
    const stub = (name: string, writes: boolean): AnyCommand =>
      defineTestCommand<Readonly<Record<string, never>>, { readonly ran: boolean }>({
        name,
        run: async (ctx: CommandContext) => {
          if (writes) {
            // An element change in the main repository.
            await fs.writeFile(path.join(ctx.workspace.root, "requirements", "changed-by-test.md"), "x");
          }
          return { ran: true };
        },
      });
    const runtime = createCommandRuntime({
      contracts: loadContracts({
        catalog: {
          "logreq-catalog": 1,
          commands: [entry("test.read", "read"), entry("test.write", "write-files")],
        },
      }),
      commands: [stub("test.read", false), stub("test.write", true)],
      validateOutput: true,
    });
    const ws = await ownRepository();
    await makeReadOnly(ws.path("models"));
    const workspace = open(ws.path("system"));
    await expect(runtime.invoke("test.read", {}, { workspace })).resolves.toEqual({ ran: true });
    await expect(runtime.invoke("test.write", {}, { workspace })).resolves.toEqual({ ran: true });
    expect(await fs.readFile(ws.path("system/requirements/changed-by-test.md"), "utf8")).toBe("x");
    expect((await workspace.get(metamodelState)).valid).toBe(true);
  });

  it("[SR-018/AK2] refuses to change a metamodel file of a read-only repository and leaves it as it was", async () => {
    const ws = await ownRepository();
    const before = await fs.readFile(ws.path("models/model/types.yaml"), "utf8");
    await makeReadOnly(ws.path("models"));
    const types = await parsedYaml(ws.path("models"), "model/types.yaml");
    await expect(
      writeFileAtomic(ws.path("models"), "model/types.yaml", `${before}# changed\n`, types.snapshot, {
        kind: "yaml",
      }),
    ).rejects.toMatchObject({
      code: "file.read-only",
      message: "Not written: model/types.yaml is read-only",
    });
    expect(await fs.readFile(ws.path("models/model/types.yaml"), "utf8")).toBe(before);
  });

  it("[SR-018/AK2] refuses to change or add a metamodel file on a read-only file system", async () => {
    const ws = await ownRepository();
    const before = await fs.readFile(ws.path("models/model/types.yaml"), "utf8");
    const types = await parsedYaml(ws.path("models"), "model/types.yaml");
    vi.spyOn(fs, "open").mockRejectedValue(errno("EROFS"));
    await expect(
      writeFileAtomic(ws.path("models"), "model/types.yaml", `${before}# changed\n`, types.snapshot, {
        kind: "yaml",
      }),
    ).rejects.toMatchObject({
      code: "file.read-only",
      message: "Not written: the folder of model/types.yaml is not writable (EROFS)",
    });
    await expect(
      writeFileAtomic(ws.path("models"), "model/variants.yaml", "logreq-metamodel: 1\n", null, {
        kind: "yaml",
      }),
    ).rejects.toMatchObject({ code: "file.read-only" });
    vi.restoreAllMocks();
    expect(await fs.readFile(ws.path("models/model/types.yaml"), "utf8")).toBe(before);
    expect((await fs.readdir(ws.path("models/model"))).sort()).toEqual([
      "properties.yaml",
      "statuses.yaml",
      "types.yaml",
    ]);
  });

  it("[SR-018/AK3] works the same with the metamodel as a folder in the main repository", async () => {
    const own = await ownRepository();
    const folder = await fixture();
    // The same metamodel files, now in the main repository; the repository models is gone.
    await fs.cp(folder.path("models/model"), folder.path("system/model"), { recursive: true });
    await fs.rm(folder.path("models"), { recursive: true });
    await folder.write(
      "system/logreq-workspace.yaml",
      'logreq-workspace: 1\nname: Weather station\nrepositories:\n  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\nmetamodel: { repository: system, path: model }\n',
    );
    const inOwn = open(own.path("system"));
    const inMain = open(folder.path("system"));
    const ownOut = await status(inOwn);
    const mainOut = await status(inMain);
    expect(mainOut.metamodel).toEqual({ repository: "system", path: "model", valid: true });
    expect({
      valid: mainOut.metamodel.valid,
      readOnly: mainOut.readOnly,
      problems: mainOut.problems,
    }).toEqual({
      valid: ownOut.metamodel.valid,
      readOnly: ownOut.readOnly,
      problems: ownOut.problems,
    });
    const ownModel = await inOwn.get(metamodelState);
    const mainModel = await inMain.get(metamodelState);
    const definitions = (m: typeof ownModel): unknown => ({
      files: m.files,
      types: m.types,
      properties: m.properties,
      relations: m.relations,
      statuses: m.statuses,
      effectiveTypes: m.effectiveTypes,
      valid: m.valid,
      problems: m.problems,
    });
    expect(definitions(mainModel)).toEqual(definitions(ownModel));
  });
});

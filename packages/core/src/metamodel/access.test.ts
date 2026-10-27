import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@logreq/testkit";
import { beforeEach, describe, expect, it, onTestFinished } from "vitest";
import type { AnyCommand, CommandContext } from "../catalog.js";
import { CommandError, defineTestCommand } from "../catalog.js";
import { loadContracts } from "../runtime/contracts.js";
import { createCommandRuntime } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { assertWritable, workspaceAccess } from "./access.js";

// Test-only catalog: no write command is implemented yet (element.create is SR-001), so the guard
// in `invoke` is checked with stand-ins that have the effects of the real catalog entries.
const entry = (name: string, effect: "read" | "write-files"): Record<string, unknown> => ({
  name,
  title: "Test command",
  summary: `${name} (test only).`,
  effect,
  stage: 1,
  implements: ["SR-011"],
  arguments: [],
  input: { type: "object", additionalProperties: false },
  output: {
    type: "object",
    required: ["ran"],
    properties: { ran: { const: true } },
    additionalProperties: false,
  },
});

const contracts = loadContracts({
  catalog: {
    "logreq-catalog": 1,
    commands: [
      entry("test.read", "read"),
      entry("test.write", "write-files"),
      entry("workspace.init", "write-files"),
    ],
  },
});

const runs: string[] = [];
const stub = (name: string, writes: boolean): AnyCommand =>
  defineTestCommand<Readonly<Record<string, never>>, { readonly ran: boolean }>({
    name,
    run: async (ctx: CommandContext) => {
      runs.push(name);
      if (writes) {
        // A write command writes into the workspace; the guard must stop it before this.
        await fs.writeFile(`${ctx.workspace.root}/written-by-${name}.txt`, "x");
      }
      return { ran: true };
    },
  });

const runtime = createCommandRuntime({
  contracts,
  commands: [stub("test.read", false), stub("test.write", true), stub("workspace.init", true)],
  validateOutput: true,
});

const fixture = async (options: FixtureOptions = {}): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace({ fixture: "SR-011/split-folder", ...options });
  onTestFinished(() => created.cleanup());
  return created;
};

const open = (root: string): Workspace => {
  const workspace = new Workspace(root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const FAULTY_STATUSES = {
  "model/statuses.yaml": "logreq-metamodel: 1\nstatuses:\n  - key: draft\n    name: [Draft\n",
};

const exists = async (file: string): Promise<boolean> =>
  fs.access(file).then(
    () => true,
    () => false,
  );

describe("read-only workspace", () => {
  beforeEach(() => {
    runs.length = 0;
  });

  it("[SR-011/AK3] refuses write commands while the metamodel has faulty YAML, and still runs read commands", async () => {
    const ws = await fixture({ files: FAULTY_STATUSES });
    const workspace = open(ws.root);
    const error: unknown = await runtime.invoke("test.write", {}, { workspace }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CommandError);
    expect((error as CommandError).toJSON()).toEqual({
      code: "workspace.read-only",
      message:
        "The workspace is read-only because its metamodel is missing or faulty; test.write changes no file. Fix the metamodel files and open the workspace again.",
      details: {
        command: "test.write",
        problems: [
          {
            code: "file.invalid-yaml",
            severity: "error",
            repository: "system",
            file: "model/statuses.yaml",
            line: 4,
            message: expect.stringMatching(/^Invalid YAML at line 4/) as unknown,
          },
        ],
      },
    });
    expect(runs).toEqual([]);
    expect(await exists(ws.path("written-by-test.write.txt"))).toBe(false);
    await expect(runtime.invoke("test.read", {}, { workspace })).resolves.toEqual({ ran: true });
  });

  it("[SR-011/AK3] lets write commands run again once the fixed metamodel is read", async () => {
    const ws = await fixture({ files: FAULTY_STATUSES });
    const workspace = open(ws.root);
    await expect(runtime.invoke("test.write", {}, { workspace })).rejects.toMatchObject({
      code: "workspace.read-only",
    });
    await ws.write(
      "model/statuses.yaml",
      "logreq-metamodel: 1\nstatuses:\n  - { key: draft, name: Draft, initial: true }\n",
    );
    // Still read-only until the metamodel is read again (watcher or reopening).
    await expect(runtime.invoke("test.write", {}, { workspace })).rejects.toMatchObject({
      code: "workspace.read-only",
    });
    await expect(runtime.invoke("test.write", {}, { workspace: open(ws.root) })).resolves.toEqual({
      ran: true,
    });
  });

  it("names a missing metamodel folder as the reason", async () => {
    const ws = await fixture();
    await fs.rm(ws.path("model"), { recursive: true });
    expect(await workspaceAccess(open(ws.root))).toEqual({
      readOnly: true,
      reasons: [
        {
          code: "metamodel.invalid",
          severity: "error",
          file: "logreq-workspace.yaml",
          message: "Metamodel folder model is missing in repository system",
        },
      ],
    });
  });

  it("gives only errors as reasons, not warnings", async () => {
    const ws = await fixture({ files: FAULTY_STATUSES });
    const access = await workspaceAccess(open(ws.root));
    expect(access.reasons.map((p) => p.code)).toEqual(["file.invalid-yaml"]);
  });

  it("is writable with a valid metamodel", async () => {
    const ws = await fixture();
    const workspace = open(ws.root);
    expect(await workspaceAccess(workspace)).toEqual({ readOnly: false, reasons: [] });
    await expect(assertWritable(workspace, "test.write")).resolves.toBeUndefined();
  });

  it("lets workspace.init run without a workspace, since it creates one", async () => {
    const ws = await createFixtureWorkspace();
    onTestFinished(() => ws.cleanup());
    await expect(runtime.invoke("workspace.init", {}, { workspace: open(ws.root) })).resolves.toEqual({
      ran: true,
    });
  });

  it("passes a missing workspace file on unchanged to write commands", async () => {
    const ws = await createFixtureWorkspace();
    onTestFinished(() => ws.cleanup());
    await expect(runtime.invoke("test.write", {}, { workspace: open(ws.root) })).rejects.toMatchObject({
      code: "workspace.not-found",
    });
  });
});

// The generated workspaces of the testkit for the web UI tests (ADR-0020, Tests, #2316) as core
// reads them: each passes `workspace.check` without an error, and has what the UI tests rely on.
import type { RunCommand } from "@reqseq/testkit";
import {
  EARLIER_DRAFT,
  ORBIT_BASELINE,
  SPEC_COPY_BASELINE,
  SPEC_COPY_CHANGED,
  createFixtureWorkspace,
  createSeeder,
  createNoIdentifierWorkspace,
  createOrbitLabWorkspace,
  createSpecCopyWorkspace,
} from "@reqseq/testkit";
import fs from "node:fs/promises";
import { describe, expect, it, onTestFinished } from "vitest";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";

/** A fresh `Workspace` per command, so each one reads what the generator wrote and committed before. */
const run: RunCommand = async (root, command, input) => {
  const workspace = new Workspace(root);
  try {
    return await invoke(command, input, { workspace });
  } finally {
    await workspace.close();
  }
};

interface Problem {
  readonly severity: string;
  readonly code: string;
}

const errorsOf = async (root: string): Promise<readonly Problem[]> => {
  const { problems } = (await run(root, "workspace.check", {})) as { readonly problems: readonly Problem[] };
  return problems.filter((p) => p.severity === "error");
};

/** A system requirement whose text the history of the spec copy changes. */
const CHANGED = "SR-036";

/** Copying the 20 MB of `spec/` and reading it twice: a bound only a hang reaches. */
const TIMEOUT_MS = 120_000;

/** A folder of its own, removed after the test; with `git`, an empty Git repository. */
const emptyFolder = async (git = false): Promise<string> => {
  const folder = await createFixtureWorkspace(git ? { git: true } : {});
  onTestFinished(() => folder.cleanup());
  return folder.root;
};

/**
 * A small specification in a Git repository with N-001, SR-001 and SR-036 (SR-001 and SR-036 name
 * each other) and, with `free`, SR-002, which no other file names; an untracked file besides.
 */
const smallSpec = async (free: boolean): Promise<string> => {
  const element = (id: string, specId: string, names: string): string =>
    `---\nid: ${id}\ntype: system-requirement\nspec-id: "${specId}"\n---\n\nNames ${names}.\n`;
  const spec = await createFixtureWorkspace({
    files: {
      "README.md": "# Not an element\n",
      "need/N-1.md": element("n-uuid", "N-001", "sr1-uuid"),
      "system-requirement/SR-1.md": element("sr1-uuid", "SR-001", "sr36-uuid"),
      "system-requirement/SR-36.md": element("sr36-uuid", "SR-036", "sr1-uuid"),
      ...(free ? { "system-requirement/SR-2.md": element("sr2-uuid", "SR-002", "nothing") } : {}),
    },
    git: true,
  });
  await spec.write("system-requirement/.DS_Store", "untracked");
  onTestFinished(() => spec.cleanup());
  return spec.root;
};

describe("workspaces for the web UI tests (ADR-0020, #2316)", () => {
  it(
    "copies spec/ with a generated history: a baseline that finds the changed and the added elements",
    async () => {
      const ws = await createSpecCopyWorkspace({ run });
      onTestFinished(() => ws.cleanup());
      expect(await errorsOf(ws.root)).toEqual([]);
      expect((await ws.git(["log", "--format=%s"])).trim().split("\n")).toEqual([
        "Current state",
        `Baseline ${SPEC_COPY_BASELINE}`,
        "Earlier state",
      ]);
      expect(ws.commits.at(-1)).toBe(await ws.head());
      expect(await ws.git(["status", "--porcelain"])).toBe("");
      expect(SPEC_COPY_CHANGED).toContain(CHANGED);
      const compare = (await run(ws.root, "baseline.compare", {
        baseline: SPEC_COPY_BASELINE,
        ref: CHANGED,
      })) as { readonly from: string; readonly difference: unknown };
      expect(compare.from).toBe(ws.commits[0]);
      expect(JSON.stringify(compare.difference)).toContain(EARLIER_DRAFT);
      await expect(
        run(ws.root, "baseline.compare", { baseline: SPEC_COPY_BASELINE, ref: ws.added }),
      ).rejects.toMatchObject({ details: { reason: "not-in-baseline" } });
      const dateOf = async (ref: string): Promise<string> =>
        (
          (await run(ws.root, "element.get", { ref, versionDate: true })) as {
            readonly element: { readonly versionDate: string };
          }
        ).element.versionDate;
      expect(await dateOf(CHANGED)).not.toBe(await dateOf("SR-052"));
      expect(await dateOf(ws.added)).toBe(await dateOf(CHANGED));
    },
    TIMEOUT_MS,
  );

  it("refuses a specification without the elements the history changes or adds", async () => {
    await expect(createSpecCopyWorkspace({ run, specDir: await emptyFolder(true) })).rejects.toThrow(
      "has no element N-001",
    );
    await expect(createSpecCopyWorkspace({ run, specDir: await smallSpec(false) })).rejects.toThrow(
      "no system requirement that no other file names",
    );
  });

  it(
    "builds Orbit Lab: an unusual metamodel with an abstract type, a baseline and criteria without keys",
    async () => {
      const ws = await createOrbitLabWorkspace({ run });
      onTestFinished(() => ws.cleanup());
      expect(await errorsOf(ws.root)).toEqual([]);
      const { types } = (await run(ws.root, "metamodel.get", {})) as {
        readonly types: readonly {
          readonly key: string;
          readonly abstract?: boolean;
          readonly extends?: string;
        }[];
      };
      expect(types.filter((t) => t.extends === "commitment").map((t) => t.key)).toEqual([
        "capability",
        "constraint",
      ]);
      expect(types.find((t) => t.key === "commitment")?.abstract).toBe(true);
      expect(types.some((t) => t.key.includes("glossary"))).toBe(false);
      const { element } = (await run(ws.root, "element.get", { ref: "CON-2" })) as {
        readonly element: { readonly file: string };
      };
      const keyless = await fs.readFile(ws.path(element.file), "utf8");
      expect(keyless).toContain("  - Edits made offline are kept.");
      expect(keyless).not.toContain("key:");
      const compare = (await run(ws.root, "baseline.compare", {
        baseline: ORBIT_BASELINE,
        ref: "CAP-101",
      })) as {
        readonly difference: unknown;
      };
      expect(JSON.stringify(compare.difference)).toContain("suggests a new time");
      expect((await ws.git(["log", "--format=%s"])).trim().split("\n")).toHaveLength(3);
    },
    TIMEOUT_MS,
  );

  it(
    "builds a workspace without identifiers, with stakeholders and hazards",
    async () => {
      const ws = await createNoIdentifierWorkspace({ run });
      onTestFinished(() => ws.cleanup());
      expect(await errorsOf(ws.root)).toEqual([]);
      const { properties } = (await run(ws.root, "metamodel.get", {})) as {
        readonly properties: readonly { readonly meaning?: string }[];
      };
      expect(properties.some((p) => p.meaning === "identifier")).toBe(false);
      const list = (await run(ws.root, "element.list", { group: "type" })) as {
        readonly groups: readonly { readonly value?: string; readonly count: number }[];
      };
      expect(Object.fromEntries(list.groups.map((g) => [g.value, g.count]))).toMatchObject({
        stakeholder: 3,
        need: 3,
        hazard: 3,
        "system-requirement": 5,
      });
    },
    TIMEOUT_MS,
  );

  it("removes its temporary folder in tempDir again when a command fails", async () => {
    const tempDir = await emptyFolder();
    const failing: RunCommand = () => Promise.reject(new Error("command failed"));
    const specDir = await smallSpec(true);
    for (const generate of [createSpecCopyWorkspace, createOrbitLabWorkspace, createNoIdentifierWorkspace]) {
      await expect(generate({ run: failing, tempDir, specDir })).rejects.toThrow("command failed");
      expect(await fs.readdir(tempDir)).toEqual([]);
    }
  });

  it("copies only the files Git tracks, CRLF files included", async () => {
    const specDir = await smallSpec(true);
    for (const file of ["need/N-1.md", "system-requirement/SR-2.md"]) {
      const content = await fs.readFile(`${specDir}/${file}`, "utf8");
      await fs.writeFile(`${specDir}/${file}`, content.replaceAll("\n", "\r\n"));
    }
    let copied: readonly string[] = [];
    const ws = await createSpecCopyWorkspace({
      specDir,
      run: async (root) => {
        copied = (await fs.readdir(root, { recursive: true })).map(String);
        return {};
      },
    });
    onTestFinished(() => ws.cleanup());
    expect(ws.added).toBe("SR-002");
    expect(copied.some((file) => file.endsWith(".DS_Store"))).toBe(false);
    expect(copied.some((file) => file.endsWith("SR-2.md"))).toBe(false);
  });

  it("names a seed key it does not know", () => {
    expect(() => createSeeder(() => Promise.resolve({})).id("nobody")).toThrow("unknown seed key nobody");
  });
});

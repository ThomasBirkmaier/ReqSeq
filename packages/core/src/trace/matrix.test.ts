// The traceability matrix (SR-125, SR-153) where the commands' tests do not reach: which relation keys
// make columns, on a metamodel object that a metamodel file cannot describe (a relation kind whose key a
// property of another kind has, which makes the file invalid), and the minima a row cannot be judged by
// or is not held to. The matrix itself: commands/trace/matrix.test.ts.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../catalog.js";
import { metamodelState } from "../metamodel/index.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { matrixKeys } from "./matrix.js";

const P = "5e125a7d-2b4f-4c61-9d08-";
const S3 = `${P}0b0000000003`;
const S3_FILE = "requirements/SR-0b0000000003.md";

const open = async (change?: (fixture: FixtureWorkspace) => Promise<void>): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-125/matrix" });
  onTestFinished(() => fixture.cleanup());
  await change?.(fixture);
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

/** Changes the file of S3, which refines S1 and derives from nothing. */
const editS3 = async (fixture: FixtureWorkspace, change: (text: string) => string): Promise<void> => {
  await fixture.write(S3_FILE, change(await fs.readFile(fixture.path(S3_FILE), "utf8")));
};

const matrixOfS3 = async (workspace: Workspace): Promise<CommandOutput<"trace.matrix">> =>
  (await invoke(
    "trace.matrix",
    { selection: { ids: [S3] } },
    { workspace },
  )) as CommandOutput<"trace.matrix">;

/** A workspace file that lists a second repository, `vault`, which is not on this machine (SR-006). */
const WITH_VAULT =
  "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
  '  - { name: system, url: "ssh://example.com/system.git", main: true }\n' +
  '  - { name: vault, url: "ssh://example.com/vault.git", path: ../vault }\n' +
  "metamodel: { repository: system, path: metamodel }\n";

it("[SR-125/AK-wzq6] leaves out a relation kind whose key a property of another kind has", async () => {
  const workspace = await open();
  const metamodel = await workspace.get(metamodelState);
  const keys = (kinds?: readonly string[]): string[] => matrixKeys(metamodel, kinds).map((k) => k.key);
  expect(keys()).toEqual(["refines", "derives-from", "based-on", "supersedes", "replaces", "excludes"]);
  const shadowed = {
    ...metamodel,
    properties: [...metamodel.properties, { key: "replaces", name: "Replaces", kind: "text" as const }],
  };
  const without = matrixKeys(shadowed, undefined).map((k) => k.key);
  expect(without).toEqual(["refines", "derives-from", "based-on", "supersedes", "excludes"]);
  expect(matrixKeys(shadowed, ["replaces", "derives-from"]).map((k) => k.key)).toEqual(["derives-from"]);
  // The property wins over the relation kind of the same key, as everywhere (ADR-0004).
  const property = {
    ...metamodel,
    properties: [...metamodel.properties, { key: "excludes", name: "Excluded", kind: "relation" as const }],
  };
  expect(matrixKeys(property, ["excludes"]).map((k) => [k.key, k.property, k.name, k.inverseName])).toEqual([
    ["excludes", true, "Excluded", "Excluded"],
  ]);
});

describe("minima the matrix cannot judge or does not hold a row to (SR-153)", () => {
  it("gives neither gap nor met for a target in a repository that is not here, as SR-152 gives no too-few", async () => {
    for (const [listed, repository] of [
      [true, "vault"],
      [false, "elsewhere"],
    ] as const) {
      const workspace = await open(async (fixture) => {
        if (listed) {
          await fixture.write("reqseq-workspace.yaml", WITH_VAULT);
        }
        await editS3(fixture, (t) =>
          t.replace(
            "refines:\n",
            `derives-from:\n  - { id: ${P}0a00000000ff, repository: ${repository} }\nrefines:\n`,
          ),
        );
      });
      const output = await matrixOfS3(workspace);
      // A repository the workspace file does not list leaves the matrix complete (#838 Q5).
      expect(output.incomplete).toBe(listed);
      expect(output.columns.find((c) => c.kind === "derives-from")).toMatchObject({
        count: 1,
        expected: 1,
        met: 0,
        share: 0,
      });
      expect(output.rows[0]?.gaps).toBeUndefined();
    }
  });

  it("holds a row with an invalid status to no minimum, as SR-152 gives it no hint", async () => {
    const workspace = await open((fixture) =>
      editS3(fixture, (t) => t.replace("status: draft", "status: obsolete")),
    );
    const output = await matrixOfS3(workspace);
    expect(output.columns.map((c) => [c.kind, c.direction, c.share])).toEqual([
      ["refines", "out", undefined],
    ]);
    expect(output.rows[0]?.gaps).toBeUndefined();
  });

  it("trusts no minimum of a metamodel that is not valid", async () => {
    const workspace = await open(async (fixture) => {
      const file = "metamodel/standard-model.yaml";
      const model = await fs.readFile(fixture.path(file), "utf8");
      await fixture.write(
        file,
        model.replace("target-type: need, min: 1 }", "target-type: need, min: 2, max: 1 }"),
      );
    });
    expect((await workspace.get(metamodelState)).valid).toBe(false);
    const output = await matrixOfS3(workspace);
    expect(output.columns.every((c) => c.share === undefined)).toBe(true);
    expect(output.rows[0]?.gaps).toBeUndefined();
  });
});

// Mapping files (reqif/mapping.ts) on SR-004/one-repository; saving them is commands/reqif/saveMapping.test.ts.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { CommandError } from "../catalog.js";
import { metamodelState } from "../metamodel/index.js";
import { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { mappingFileName, mappingTarget, readMappingFile, samePath } from "./mapping.js";

const open = async (
  files: Readonly<Record<string, string>> = {},
): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-004/one-repository", files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const readFrom = async (workspace: Workspace, given: string): Promise<unknown> =>
  readMappingFile(
    await workspace.get(workspaceLayoutState),
    await workspace.get(metamodelState),
    workspace.root,
    given,
    "reqif.import",
  );

const failure = async (run: () => Promise<unknown>): Promise<CommandError> => {
  try {
    await run();
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("did not fail");
};

describe("mapping files (SR-054)", () => {
  it("names a new file after the source, portable and in lower case", () => {
    expect(mappingFileName("Kunde A")).toBe("kunde-a.yaml");
    expect(mappingFileName("Müller & Söhne")).toBe("muller-sohne.yaml");
    expect(mappingFileName("???")).toBe("source.yaml");
  });

  it("reads a saved mapping from any path, checked against the schema and the own metamodel", async () => {
    const example = await fs.readFile(
      new URL("../../../../schemas/examples/reqif-mapping/customer-acme.yaml", import.meta.url),
      "utf8",
    );
    const { fixture, workspace } = await open({ "exchange/acme.yaml": example });
    const read = (await readFrom(workspace, fixture.path("exchange/acme.yaml"))) as {
      mapping: { source: unknown };
      yaml: { path: string };
    };
    expect(read.mapping.source).toEqual({ name: "ACME", "tool-id": "DOORS Next" });
    expect(read.yaml.path).toBe("acme.yaml");
  });

  it("is file.faulty for a missing file or one that is no mapping file, input.invalid for one that does not fit", async () => {
    const { workspace } = await open({
      "reqif/wrong.yaml": "reqseq-reqif-mapping: 2\n",
      "reqif/unknown.yaml":
        "reqseq-reqif-mapping: 1\nsource: { name: X }\ntypes: [{ source: A, type: nothing }]\n",
    });
    const missing = await failure(() => readFrom(workspace, "reqif/missing.yaml"));
    expect([missing.code, missing.details]).toEqual([
      "file.faulty",
      { command: "reqif.import", fields: ["mapping"] },
    ]);
    const wrong = await failure(() => readFrom(workspace, "reqif/wrong.yaml"));
    expect(wrong.code).toBe("file.faulty");
    expect(wrong.message).toMatch(/^mapping: wrong\.yaml is no mapping file: /);
    const unknown = await failure(() => readFrom(workspace, "reqif/unknown.yaml"));
    expect([unknown.code, unknown.details?.["fields"]]).toEqual(["input.invalid", ["mapping.types[0].type"]]);
  });

  it("compares paths by the rules of the platform: on Windows the case of the drive letter does not count", () => {
    expect(samePath("C:\\ws\\reqif", "c:\\ws\\reqif", "win32")).toBe(true);
    expect(samePath("C:\\ws\\reqif", "C:\\ws\\other", "win32")).toBe(false);
    expect(samePath("/ws/reqif", "/ws/Reqif", "linux")).toBe(false);
    expect(samePath("/ws/reqif", "/ws/reqif/", "darwin")).toBe(true);
    expect(samePath("/ws/reqif", "/ws/reqif")).toBe(true);
  });

  it("refuses values for a choice property that has no choices", async () => {
    const { workspace } = await open({
      "metamodel/grade.yaml":
        "reqseq-metamodel: 1\nproperties:\n  - { key: grade, name: Grade, kind: choice }\n",
      "reqif/grade.yaml":
        "reqseq-reqif-mapping: 1\nsource: { name: X }\nattributes: [{ source: G, property: grade, values: { A: a } }]\n",
    });
    const error = await failure(() => readFrom(workspace, "reqif/grade.yaml"));
    expect([error.code, error.message]).toEqual([
      "input.invalid",
      "mapping.attributes[0].values.A: a is no choice of grade",
    ]);
  });

  it("checks the target also while the metamodel folder is not on this machine", async () => {
    const { workspace } = await open();
    const layout = await workspace.get(workspaceLayoutState);
    const target = await mappingTarget(
      { ...layout, metamodel: { ...layout.metamodel, folder: undefined } },
      workspace.root,
      "Kunde A",
      undefined,
      "reqif.saveMapping",
    );
    expect(target.file).toBe("reqif/kunde-a.yaml");
  });
});

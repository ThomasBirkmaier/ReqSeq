// Performance suite (ADR-0011): `element.bulkUpdate` (SR-071) through the catalog on the generated
// workspace of N-036 with 50,000 elements and 200,000 relations, the store warmed as at a start
// (`warmWorkspace`). 1,000 system requirements are selected by UUID; the preview and the confirmed
// change of a text property and of a relation-valued property (`packages`, a new target gets its
// current version) are recorded with `measure`. SR-071 names no time, so nothing is asserted against
// a threshold (N-036 is the basis); correctness is asserted as usual.
import type { GeneratedWorkspace, LargeFixtureWorkspace } from "@logreq/testkit";
import { generateLargeWorkspace, measure, writeLargeWorkspace } from "@logreq/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CommandOutput } from "../../src/catalog.js";
import { getCommandRuntime, invoke } from "../../src/runtime/invoke.js";
import { elementStoreState } from "../../src/model/index.js";
import { warmWorkspace } from "../../src/runtime/warm.js";
import { Workspace } from "../../src/runtime/workspace.js";
import { standardModel, versionOf } from "./core-version.js";

const ELEMENTS = 50_000;
const RELATIONS = 200_000;
/** The selection of SR-071 in this suite. */
const SELECTED = 1000;

type Output = CommandOutput<"element.bulkUpdate">;

describe("element.bulkUpdate with 50,000 elements and 200,000 relations (SR-071, N-036)", () => {
  let tree: GeneratedWorkspace;
  let fixture: LargeFixtureWorkspace | undefined;
  let workspace: Workspace | undefined;

  beforeAll(async () => {
    const version = versionOf(await standardModel());
    tree = generateLargeWorkspace({ version, elements: ELEMENTS, relations: RELATIONS });
    fixture = await writeLargeWorkspace(tree);
    workspace = new Workspace(fixture.workspaceRoot);
    getCommandRuntime();
    await warmWorkspace(workspace);
    expect((await workspace.get(elementStoreState)).elements).toHaveLength(ELEMENTS);
  }, 600_000);

  afterAll(async () => {
    await workspace?.close();
    await fixture?.cleanup();
  });

  const run = async (name: string, input: Record<string, unknown>): Promise<Output> => {
    const opened = workspace;
    if (opened === undefined) {
      throw new Error("no workspace");
    }
    const { result } = await measure(
      name,
      async () => (await invoke("element.bulkUpdate", input, { workspace: opened })) as Output,
      { basis: "N-036, SR-071 (no threshold)" },
    );
    return result;
  };

  it("previews and changes one property of 1,000 of 50,000 elements", async () => {
    const requirements = tree.elements.filter((e) => e.type === "system-requirement");
    const ids = requirements.slice(0, SELECTED).map((e) => e.id);
    expect(ids).toHaveLength(SELECTED);
    const text = {
      selection: { ids },
      property: "rationale",
      operation: "set",
      value: "Changed in one step",
    };
    const preview = await run("element.bulkUpdate: preview, set a text property on 1,000 elements", text);
    expect(preview).toMatchObject({ applied: false, count: SELECTED, files: [] });
    const done = await run("element.bulkUpdate: confirm, set a text property on 1,000 elements", {
      ...text,
      confirm: true,
      expected: preview.count,
    });
    expect(done).toMatchObject({ applied: true, count: SELECTED });
    expect(done.files).toHaveLength(SELECTED);

    const target = tree.elements.find((e) => e.type === "package");
    const relation = {
      selection: { ids },
      property: "packages",
      operation: "add",
      value: {
        id: target?.id,
        ...(target?.repository === undefined ? {} : { repository: target.repository }),
      },
    };
    const added = await run("element.bulkUpdate: preview, add a relation target on 1,000 elements", relation);
    expect(added.applied).toBe(false);
    const written = await run("element.bulkUpdate: confirm, add a relation target on 1,000 elements", {
      ...relation,
      confirm: true,
    });
    expect(written.count).toBe(added.count);
    expect(written.count + written.unchanged + written.skipped.length).toBe(SELECTED);
  });
});

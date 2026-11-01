// Requirements without a parent in workspace.check, hint.list and element.get (SR-022 AK6).
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../catalog.js";
import { metamodelState } from "../metamodel/index.js";
import { elementStoreState, shortIdState } from "../model/index.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { elementNoParentFindings, noParentProblemsState } from "./no-parent.js";

const P = "5c0e1d2a-0022-4022-8022-00000000";
const V = "n1:0000000000000000";
const ORPHAN = `${P}b004`;
const DECISION = `${P}e001`;
const ORPHAN_FILE = "requirements/SR-00000000b004.md";

/** fixtures/SR-022/chain, whose requirements all have a parent, with one based only on a decision. */
const ORPHANED: FixtureOptions = {
  fixture: "SR-022/chain",
  files: {
    "decisions/D-00000000e001.md": `---\nid: ${DECISION}\ntype: decision\nstatus: draft\ntitle: Knots\n---\n`,
    [ORPHAN_FILE]: `---\nid: ${ORPHAN}\ntype: system-requirement\nstatus: draft\ntitle: Orphan\nbased-on:\n  - { id: ${DECISION}, version: ${V} }\n---\n`,
  },
};

const open = async (options: FixtureOptions, root?: string): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(root === undefined ? fixture.root : fixture.path(root));
  onTestFinished(() => workspace.close());
  return workspace;
};

/** The `trace.no-parent` problems of `problems` (the fixture has other findings, such as outdated relations). */
const noParent = (problems: readonly { readonly code: string }[] | undefined): unknown[] =>
  (problems ?? []).filter((p) => p.code === "trace.no-parent");

const HINT = {
  code: "trace.no-parent",
  severity: "warning",
  message: "System Requirement SR-00b004 has no parent: no relation with the meaning derivation names one",
  repository: "system",
  file: ORPHAN_FILE,
  elementId: ORPHAN,
  elementShortId: "SR-00b004",
};

describe("requirements without a parent (SR-022 AK6)", () => {
  it("[SR-022/AK6] workspace.check reports a requirement without a parent as a hint with its ID", async () => {
    const workspace = await open(ORPHANED);
    const out = (await invoke("workspace.check", {}, { workspace })) as CommandOutput<"workspace.check">;
    expect(noParent(out.problems)).toEqual([HINT]);
    // A hint blocks nothing: ok by default (#304).
    expect(out.ok).toBe(true);
    // The same hint in hint.list and at the element (SR-026 AK3); nothing to confirm.
    const hints = (await invoke("hint.list", {}, { workspace })) as CommandOutput<"hint.list">;
    expect(noParent(hints.hints)).toEqual([HINT]);
    const shown = (await invoke(
      "element.get",
      { ref: ORPHAN },
      { workspace },
    )) as CommandOutput<"element.get">;
    expect(noParent(shown.element.problems)).toEqual([HINT]);
  });

  it("[SR-022/AK6] reports nothing once the requirement has a parent", async () => {
    const workspace = await open(ORPHANED);
    await invoke("relation.add", { source: ORPHAN, kind: "derives-from", target: `${P}a001` }, { workspace });
    const out = (await invoke("workspace.check", {}, { workspace })) as CommandOutput<"workspace.check">;
    expect(noParent(out.problems)).toEqual([]);
  });

  it("[SR-022/AK6] reports no superseded requirement: a retired element needs no origin", async () => {
    const workspace = await open(ORPHANED);
    await invoke("element.setStatus", { refs: [ORPHAN], status: "obsolete" }, { workspace });
    const out = (await invoke("workspace.check", {}, { workspace })) as CommandOutput<"workspace.check">;
    expect(noParent(out.problems)).toEqual([]);
    const hints = (await invoke("hint.list", {}, { workspace })) as CommandOutput<"hint.list">;
    expect(noParent(hints.hints)).toEqual([]);
  });

  it("reports nothing without a relation kind with the meaning derivation, or against a metamodel that is not valid", async () => {
    const withoutDerivation = await open({ fixture: "SR-089/missing-targets" }, "system");
    expect(await withoutDerivation.get(noParentProblemsState)).toEqual([]);
    const broken = await open({
      ...ORPHANED,
      files: { ...ORPHANED.files, "metamodel/broken.yaml": "types: [\n" },
    });
    expect(await broken.get(noParentProblemsState)).toEqual([]);
    const context = { metamodel: await broken.get(metamodelState), shortIds: await broken.get(shortIdState) };
    const [record] = (await broken.get(elementStoreState)).byId.get(ORPHAN) ?? [];
    expect(record).toBeDefined();
    if (record !== undefined) {
      expect(elementNoParentFindings(context, record)).toEqual([]);
    }
  });
});

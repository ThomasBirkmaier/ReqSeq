import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput, Problem } from "../catalog.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { statementProblemsState } from "./index.js";

const CODE = "element.statement-without-text";
const MODEL = "metamodel/standard-model.yaml";

/** A requirement with its statement on line 6 and `text` below the frontmatter. */
const requirement = (id: string, statement: string, text = "", status = "draft"): string =>
  `---\nid: 66700000-0000-4000-8000-${id}\ntype: system-requirement\nstatus: ${status}\ntitle: Rounding\nstatement: ${statement}\n---\n${text}`;

const FILES = {
  // Only the statement holds the requirement: the hint.
  "requirements/SR-000000a00667.md": requirement(
    "000000a00667",
    "The mass is rounded to 0.001 kg.",
    "\n  \n",
  ),
  // A text and a statement: the supplier's statement as meant.
  "requirements/SR-000000b00667.md": requirement("000000b00667", "Agreed.", "\nThe mass is rounded.\n"),
  // No statement: a requirement without text is no gap of this kind.
  "requirements/SR-000000c00667.md": requirement("000000c00667", '""'),
  // No statement key at all.
  "requirements/SR-000000f00667.md":
    "---\nid: 66700000-0000-4000-8000-000000f00667\ntype: system-requirement\nstatus: draft\ntitle: Rounding\n---\n",
  // Obsolete (a status the metamodel marks invalid): not worked on any more.
  "requirements/SR-000000e00667.md": requirement("000000e00667", "Rounded to 0.1 m.", "", "obsolete"),
  // Not a requirement type.
  "decisions/D-000000d00667.md":
    "---\nid: 66700000-0000-4000-8000-000000d00667\ntype: decision\nstatus: accepted\ntitle: Rounding\nstatement: Agreed.\n---\n",
};

interface Opened {
  readonly fixture: FixtureWorkspace;
  readonly workspace: Workspace;
}

const open = async (): Promise<Opened> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-004/one-repository", files: FILES });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const HINT = {
  code: CODE,
  severity: "warning",
  message:
    "This System Requirement has no text, but a value in Statement (statement), which does not count to the version: a change there gives no new version and outdates no evidence or relation; put the requirement into the text",
  repository: "system",
  file: "requirements/SR-000000a00667.md",
  line: 6,
  elementId: "66700000-0000-4000-8000-000000a00667",
};

const hints = async (workspace: Workspace): Promise<readonly Problem[]> =>
  ((await invoke("workspace.check", {}, { workspace })) as CommandOutput<"workspace.check">).problems.filter(
    (p) => p.code === CODE,
  );

/** A copy of the fixture's workspace whose standard model has `edit` applied. */
const withModel = async (opened: Opened, edit: (model: string) => string): Promise<Workspace> => {
  const model = await fs.readFile(opened.fixture.path(MODEL), "utf8");
  const edited = edit(model);
  expect(edited).not.toBe(model);
  await opened.fixture.write(MODEL, edited);
  const workspace = new Workspace(opened.fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

describe("a requirement whose wording is only in the statement (#667)", () => {
  it("warns about a requirement with a blank text and a statement, with file and line, and passes the check", async () => {
    const opened = await open();
    const out = (await invoke(
      "workspace.check",
      {},
      { workspace: opened.workspace },
    )) as CommandOutput<"workspace.check">;
    expect(out.problems.filter((p) => p.code === CODE)).toEqual([expect.objectContaining(HINT)]);
    expect(out.ok).toBe(true);
  });

  it("lists it as a hint and shows it at the element", async () => {
    const opened = await open();
    const listed = (await invoke(
      "hint.list",
      {},
      { workspace: opened.workspace },
    )) as CommandOutput<"hint.list">;
    expect(listed.hints.filter((h) => h.code === CODE)).toEqual([
      expect.objectContaining({ elementId: HINT.elementId }),
    ]);
    const get = (await invoke(
      "element.get",
      { ref: HINT.elementId },
      { workspace: opened.workspace },
    )) as CommandOutput<"element.get">;
    expect((get.element.problems ?? []).filter((p) => p.code === CODE)).toEqual([
      expect.objectContaining(HINT),
    ]);
  });

  it("follows a save that gives the requirement a text", async () => {
    const opened = await open();
    expect(await hints(opened.workspace)).toHaveLength(1);
    await invoke(
      "element.update",
      { ref: HINT.elementId, text: "The mass is rounded to 0.001 kg." },
      { workspace: opened.workspace },
    );
    expect(await hints(opened.workspace)).toEqual([]);
  });

  it("gives none when the statement counts to the version, no property has its meaning, the type lacks the property, or the metamodel is not valid", async () => {
    const counts = await open();
    const content = await withModel(counts, (m) =>
      m.replace("meaning: statement,", "meaning: statement,\n      content: true,"),
    );
    expect(await hints(content)).toEqual([]);
    const unassigned = await open();
    const none = await withModel(unassigned, (m) => m.replace("meaning: statement,", ""));
    expect(await hints(none)).toEqual([]);
    // A requirement type without the statement property: the value is an unknown property (SR-016), and
    // it does not count to the version on that type whatever its `content` (`versionDefinitions`).
    const without = await open();
    const notOnType = await withModel(without, (m) =>
      m
        .replace("        statement,\n", "")
        .replace("meaning: statement,", "meaning: statement,\n      content: false,"),
    );
    const problems = (
      (await invoke("workspace.check", {}, { workspace: notOnType })) as CommandOutput<"workspace.check">
    ).problems;
    expect(problems.filter((p) => p.code === CODE)).toEqual([]);
    expect(problems).toContainEqual(
      expect.objectContaining({ code: "element.unknown-property", elementId: HINT.elementId }),
    );
    const broken = await open();
    await broken.fixture.write("metamodel/broken.yaml", "reqseq-metamodel: 2\n");
    const invalid = new Workspace(broken.fixture.root);
    onTestFinished(() => invalid.close());
    expect(await invalid.get(statementProblemsState)).toEqual([]);
  });
});

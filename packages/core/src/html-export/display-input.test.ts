// ADR-0019 point 2 (D-080): the HTML export builds the display model of an element's page from the same shapes the
// commands give. This test builds the model twice on one fixture, once from the export's batch (`elementDataOf`) and
// once from the answers of `element.get` and `hint.list`, and checks that they are the same.
import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { InvokedOutput } from "../catalog.js";
import { elementPageDisplay, openHints, overviewDisplay } from "../displays/index.js";
import { metamodelState } from "../metamodel/index.js";
import { elementStoreState, shortIdState } from "../model/index.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { elementDataOf } from "./element-data.js";

const METAMODEL = `reqseq-metamodel: 1
types:
  - { key: need, name: Need, prefix: N, meaning: need, properties: [title, spec-id], required: [title] }
  - { key: system-requirement, name: System Requirement, prefix: SR, meaning: requirement, properties: [title, spec-id, acceptance-criteria, related], required: [title] }
properties:
  - { key: title, name: Title, kind: text, meaning: title }
  - { key: spec-id, name: Spec ID, kind: text, meaning: identifier }
  - { key: acceptance-criteria, name: Acceptance Criteria, kind: text, many: true, meaning: acceptance-criteria }
  - { key: related, name: Related, kind: relation, many: true }
relations:
  - { key: derives-from, name: Derives from, meaning: derivation }
  - { key: based-on, name: Based on, inverse-name: Basis for }
statuses:
  - { key: draft, name: Draft, initial: true }
  - { key: approved, name: Approved }
  - { key: obsolete, name: Obsolete, invalid: true }
`;

const uuid = (n: number): string => `bbbb2222-2222-4222-8222-${String(n).padStart(12, "0")}`;
const [TOP, SUB, ROOT, CHILD, USER, GUSTS] = [1, 2, 3, 4, 5, 6].map(uuid) as [
  string,
  string,
  string,
  string,
  string,
  string,
];
const STALE = "version: n1:0000000000000000";
const element = (id: string, type: string, front: string, body = "Text."): string =>
  `---\nid: ${id}\ntype: ${type}\n${front}---\n\n${body}\n`;

const FILES = {
  "metamodel/standard-model.yaml": METAMODEL,
  "needs/N-1.md": element(TOP, "need", "status: approved\ntitle: Weather\nspec-id: N-1\n"),
  "needs/N-2.md": element(
    SUB,
    "need",
    `status: approved\ntitle: Wind\nderives-from:\n  - { id: ${TOP}, ${STALE} }\n`,
  ),
  "requirements/SR-3.md": element(
    ROOT,
    "system-requirement",
    `status: approved\ntitle: Show wind speed\nspec-id: SR-1\nacceptance-criteria:\n  - { key: k7f3, text: Given wind. }\nderives-from:\n  - { id: ${SUB}, ${STALE} }\nmystery:\n  - { id: ${TOP} }\n`,
  ),
  "requirements/SR-4.md": element(
    CHILD,
    "system-requirement",
    `status: obsolete\ntitle: Show gusts\nderives-from:\n  - { id: ${ROOT} }\n`,
  ),
  "requirements/SR-5.md": element(
    USER,
    "system-requirement",
    `status: draft\ntitle: Log wind\nbased-on:\n  - { id: ${ROOT}, ${STALE} }\nrelated:\n  - { id: ${ROOT} }\n`,
    `Uses [wind](reqseq:${ROOT}).`,
  ),
};

/** With the standard model, a counted value without a normal form: element.get adds a `file.faulty` warning (#2231). */
const ENDLESS = {
  "requirements/SR-1d2e3f4a5b6c.md": element(
    GUSTS,
    "system-requirement",
    "status: draft\ntitle: Show gusts\nrequirement-type: functional\nacceptance-criteria: .inf\n",
    "Gusts.",
  ),
};

/** An element of a type the metamodel does not know: the type lines name it by its key, after the known types. */
const MYSTERY = {
  "notes/X-7.md": element(uuid(7), "note", "status: draft\ntitle: Remember the vane\n"),
};

const openFixture = async (files: Readonly<Record<string, string>>) => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-001/two-elements", files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { root: fixture.root, workspace };
};

const open = async (files: Readonly<Record<string, string>> = FILES) => (await openFixture(files)).workspace;

const call = async <
  C extends "element.get" | "element.facets" | "hint.list" | "html.export" | "trace.neighbourhood",
>(
  workspace: Workspace,
  command: C,
  input: Record<string, unknown>,
): Promise<InvokedOutput<C>> => (await invoke(command, input, { workspace })) as InvokedOutput<C>;

describe("the export builds its display models from what the commands give (ADR-0019, D-080)", () => {
  it("gives the same element page model from its batch as from element.get and hint.list", async () => {
    const workspace = await open();
    const [layout, metamodel, store, shortIds] = await Promise.all([
      workspace.get(workspaceLayoutState),
      workspace.get(metamodelState),
      workspace.get(elementStoreState),
      workspace.get(shortIdState),
    ]);
    const records = store.elements.filter((record) => [TOP, SUB, ROOT, USER].includes(record.id));
    const batch = await elementDataOf(workspace, { layout, metamodel, store, shortIds }, records);
    expect(batch).toHaveLength(4);
    for (const data of batch) {
      const got = await call(workspace, "element.get", { ref: data.record.id });
      const listed = await call(workspace, "hint.list", { ref: data.record.id });
      const fromExport = elementPageDisplay(
        { element: data.element, hints: data.hints ?? [], metamodel },
        { relations: "outgoing" },
      );
      const fromCommands = elementPageDisplay(
        { element: got.element, hints: listed.hints, metamodel },
        { relations: "outgoing" },
      );
      expect({ ...fromExport, readOnly: false }).toEqual({ ...fromCommands, readOnly: false });
    }
  });

  it("takes the hint section of hint.list from element.get by its rule, also where element.get has a warning more (#2231)", async () => {
    const workspace = await open();
    for (const id of [ROOT, USER, SUB]) {
      const got = await call(workspace, "element.get", { ref: id });
      const listed = await call(workspace, "hint.list", { ref: id });
      expect(openHints(got.element.problems).map((p) => p.code)).toEqual(listed.hints.map((h) => h.code));
    }
    const endless = await open(ENDLESS);
    const gusts = await call(endless, "element.get", { ref: GUSTS });
    const hints = await call(endless, "hint.list", { ref: GUSTS });
    expect(gusts.element.problems?.map((p) => p.code)).toContain("file.faulty");
    expect(openHints(gusts.element.problems).map((p) => p.code)).toEqual(hints.hints.map((h) => h.code));
  });

  it("shows on the start page the type lines element.facets gives for the elements of its lists", async () => {
    const { root, workspace } = await openFixture({ ...FILES, ...MYSTERY });
    await call(workspace, "html.export", { output: "site" });
    const start = await fs.readFile(path.join(root, "site", "index.html"), "utf8");
    const table =
      /<h2 id="types">Elements by type<\/h2><table>.*?<tbody>(.*?)<\/tbody>/su.exec(start)?.[1] ?? "";
    const shown = [
      ...table.matchAll(/<tr><td>(?:<a href="([^"]*)">)?([^<]*)(?:<\/a>)?<\/td><td>(\d+)<\/td><\/tr>/gu),
    ].map(([, href, name, count]) => ({ href, name, count: Number(count) }));
    // The export's lists hold the elements without an invalid status (SR-231 AK1): Show gusts (obsolete) is left out.
    const facets = await call(workspace, "element.facets", { selection: { where: { invalid: false } } });
    const model = overviewDisplay({ types: facets.types });
    expect(model.types.map(({ key, count }) => [key, count])).toEqual([
      ["need", 2],
      ["system-requirement", 4],
      ["note", 1],
    ]);
    expect(shown).toEqual(
      model.types.map(({ name, count, target }) => ({
        href: `lists/${target.list}.html`,
        name,
        count,
      })),
    );
  });
});

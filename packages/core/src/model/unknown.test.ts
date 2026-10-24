import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput, Problem } from "../catalog.js";
import { CommandError } from "../catalog.js";
import { readElementFile } from "../files/index.js";
import type { ParsedFile } from "../files/index.js";
import type { Metamodel } from "../metamodel/index.js";
import { metamodelState } from "../metamodel/index.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { ElementRecord } from "./elements.js";
import { keyLineOf } from "./elements.js";
import { locateFindings } from "./locate.js";
import { shortIdState } from "./short-id.js";
import type { ElementStore } from "./store.js";
import { elementStoreState } from "./store.js";
import { allUnknownFindings, unknownFindings, unknownProblemsState } from "./unknown.js";
import { elementView } from "./view.js";

const FIXTURE = "SR-016/unknown";

const KNOWN = "7a5d2f10-3c4b-4e8f-9a61-4c1e0d3a9b21";
const GUSTS = "5e0b8c2d-7f14-4a39-b6d2-8e9f0a1b2c3d";
const GADGET = "2c9e4b71-6d58-4f03-a1e7-0f6a7b8c9d0e";
const GUSTS_FILE = "requirements/SR-8e9f0a1b2c3d.md";
const GADGET_FILE = "requirements/X-0f6a7b8c9d0e.md";

interface Opened {
  readonly ws: FixtureWorkspace;
  readonly workspace: Workspace;
}

const open = async (files: Readonly<Record<string, string>> = {}): Promise<Opened> => {
  const ws = await createFixtureWorkspace({ fixture: FIXTURE, files });
  onTestFinished(() => ws.cleanup());
  const workspace = new Workspace(ws.root);
  onTestFinished(() => workspace.close());
  return { ws, workspace };
};

const loaded = async (workspace: Workspace): Promise<{ store: ElementStore; metamodel: Metamodel }> => ({
  store: await workspace.get(elementStoreState),
  metamodel: await workspace.get(metamodelState),
});

const recordOf = (store: ElementStore, id: string): ElementRecord => {
  const record = store.byId.get(id)?.[0];
  if (record === undefined) {
    throw new Error(`no element ${id}`);
  }
  return record;
};

const unknownProperty = (file: string, elementId: string, key: string, line?: number): Problem => ({
  code: "element.unknown-property",
  severity: "warning",
  message: `Property ${key} is not in the metamodel; LogReq keeps it and its value unchanged`,
  repository: "system",
  file,
  ...(line === undefined ? {} : { line }),
  elementId,
});

const UNKNOWN_TYPE: Problem = {
  code: "element.unknown-type",
  severity: "warning",
  message: "Type gadget is not in the metamodel; LogReq shows the element and only reads it",
  repository: "system",
  file: GADGET_FILE,
  line: 3,
  elementId: GADGET,
};

const notOfType = (key: string, name: string, line?: number): Problem => ({
  ...unknownProperty(GUSTS_FILE, GUSTS, key, line),
  message: `Property ${name} (${key}) is not a property of type System Requirement (system-requirement); LogReq keeps it and its value unchanged`,
});

const GUSTS_PROBLEMS: readonly Problem[] = [
  unknownProperty(GUSTS_FILE, GUSTS, "customer-id", 6),
  unknownProperty(GUSTS_FILE, GUSTS, "legacy", 8),
  notOfType("weight", "Weight", 11),
  unknownProperty(GUSTS_FILE, GUSTS, "tags", 12),
];

const GADGET_PROBLEMS: readonly Problem[] = [UNKNOWN_TYPE, unknownProperty(GADGET_FILE, GADGET, "colour", 6)];

type UpdateOutput = CommandOutput<"element.update">;

const update = async (workspace: Workspace, input: Record<string, unknown>): Promise<UpdateOutput> =>
  (await invoke("element.update", input, { workspace })) as UpdateOutput;

/** The lines of `before` that `after` changes, as `git diff` would show them for a single change. */
const changedLines = (before: string, after: string): { removed: string[]; added: string[] } => {
  const a = before.split("\n");
  const b = after.split("\n");
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) {
    p++;
  }
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) {
    s++;
  }
  return { removed: a.slice(p, a.length - s), added: b.slice(p, b.length - s) };
};

describe("unknown properties and types (SR-016)", () => {
  it("[SR-016/AK1] gives a hint with the key for every property the type of the element does not know", async () => {
    const { workspace } = await open();
    expect(await workspace.get(unknownProblemsState)).toEqual([...GUSTS_PROBLEMS, ...GADGET_PROBLEMS]);
  });

  it("[SR-016/AK1] gives the line of the key, also for a nested value, and none for a key written as an alias", async () => {
    const { ws, workspace } = await open({
      [GUSTS_FILE]: `---\nid: ${GUSTS}\ntype: system-requirement\nstatus: draft\nname: &k remark\n*k : x\nlegacy:\n  source: DOORS\n---\n`,
      "notes/list.md": "---\n- a\n---\n",
    });
    const problems = await workspace.get(unknownProblemsState);
    expect(problems.filter((p) => p.elementId === GUSTS)).toEqual([
      unknownProperty(GUSTS_FILE, GUSTS, "name", 5),
      unknownProperty(GUSTS_FILE, GUSTS, "remark"),
      unknownProperty(GUSTS_FILE, GUSTS, "legacy", 7),
    ]);
    // A frontmatter that is no mapping has no keys.
    const read = await readElementFile(ws.root, "notes/list.md");
    expect(read.kind).toBe("parsed");
    expect(keyLineOf((read as { file: ParsedFile }).file, "a")).toBeUndefined();
  });

  it("[SR-016/AK1] does not report a property the type inherits from its parent", async () => {
    const id = "9d1c2b3a-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
    const { workspace } = await open({
      "requirements/SAF-0e1f2a3b4c5d.md": `---\nid: ${id}\ntype: safety-requirement\nstatus: draft\ntitle: Stop at storm\npriority: high\nweight: 2\n---\n`,
    });
    const { store, metamodel } = await loaded(workspace);
    expect(unknownFindings(recordOf(store, id), metamodel)).toEqual([]);
  });

  it("[SR-016/AK1] checks again after the metamodel is read again", async () => {
    const { ws, workspace } = await open();
    expect(await workspace.get(unknownProblemsState)).toHaveLength(6);
    const model = await fs.readFile(ws.path("metamodel/model.yaml"), "utf8");
    await ws.write(
      "metamodel/model.yaml",
      model.replace("properties: [title, priority]", "properties: [title, priority, weight]"),
    );
    expect(await workspace.get(unknownProblemsState)).toHaveLength(6);
    await workspace.reset(metamodelState);
    const problems = await workspace.get(unknownProblemsState);
    expect(problems.filter((p) => p.elementId === GUSTS).map((p) => p.message)).not.toContain(
      notOfType("weight", "Weight").message,
    );
    expect(problems).toHaveLength(5);
  });

  it("[SR-016/AK1] gives no hint for structural keys, known properties and relation kinds", async () => {
    const { workspace } = await open();
    const { store, metamodel } = await loaded(workspace);
    // The clean element has a title, a choice property and a relation kind.
    expect(unknownFindings(recordOf(store, KNOWN), metamodel)).toEqual([]);
    // `weight` is a property of the metamodel that the type does not list: reported too (D-012).
    const keys = unknownFindings(recordOf(store, GUSTS), metamodel).map((f) => f.path);
    expect(keys).toEqual([["customer-id"], ["legacy"], ["weight"], ["tags"]]);
  });

  it("[SR-016/AK1] gives the findings of one element without lines, for a command about that element", async () => {
    const { workspace } = await open();
    const { store, metamodel } = await loaded(workspace);
    const element = recordOf(store, GUSTS);
    const findings = unknownFindings(element, metamodel);
    expect(findings.every((f) => f.element === element && f.problem.line === undefined)).toBe(true);
    expect(await locateFindings(await workspace.get(workspaceLayoutState), findings)).toEqual(GUSTS_PROBLEMS);
    expect(allUnknownFindings(store, metamodel)).toHaveLength(6);
  });

  it("[SR-016/AK1] leaves out the line when the file changed since it was read", async () => {
    const { ws, workspace } = await open();
    await workspace.get(elementStoreState);
    await ws.write(GADGET_FILE, `---\nid: ${GADGET}\ntype: system-requirement\nstatus: draft\n---\n`);
    const { line: _line, ...withoutLine } = UNKNOWN_TYPE;
    expect(await workspace.get(unknownProblemsState)).toEqual([
      ...GUSTS_PROBLEMS,
      withoutLine,
      unknownProperty(GADGET_FILE, GADGET, "colour"),
    ]);
  });

  it("[SR-016/AK1] checks again after the element store is read again", async () => {
    const { ws, workspace } = await open();
    expect(await workspace.get(unknownProblemsState)).toHaveLength(6);
    await ws.write(GADGET_FILE, `---\nid: ${GADGET}\ntype: system-requirement\nstatus: draft\n---\n`);
    expect(await workspace.get(unknownProblemsState)).toHaveLength(6);
    await workspace.reset(elementStoreState);
    expect(await workspace.get(unknownProblemsState)).toEqual(GUSTS_PROBLEMS);
  });

  it("[SR-016/AK2] keeps unknown properties with their values unchanged when the element is edited and saved", async () => {
    const { ws, workspace } = await open();
    const before = await fs.readFile(ws.path(GUSTS_FILE), "utf8");
    const out = await update(workspace, { ref: GUSTS, title: "Show gusts above 10 m/s" });
    const after = await fs.readFile(ws.path(GUSTS_FILE), "utf8");
    expect(changedLines(before, after)).toEqual({
      removed: ["title: Show gusts"],
      added: ["title: Show gusts above 10 m/s"],
    });
    expect(after).toContain(
      [
        "customer-id: 00815      # from the customer's tool",
        "priority: low",
        "legacy:",
        "  source: DOORS",
        "  object:   'WS-17'",
        "weight: 3",
        "tags: [wind, display]",
      ].join("\n"),
    );
    expect(out.element.properties).toMatchObject({
      "customer-id": 815,
      legacy: { source: "DOORS", object: "WS-17" },
      tags: ["wind", "display"],
    });
    expect(out.problems).toEqual(GUSTS_PROBLEMS);
  });

  it("[SR-016/AK2] keeps unknown properties when a known property and the text change", async () => {
    const { ws, workspace } = await open();
    await update(workspace, { ref: GUSTS, set: { priority: "high" }, text: "New text.\n" });
    const after = await fs.readFile(ws.path(GUSTS_FILE), "utf8");
    expect(after).toBe(
      [
        "---",
        `id: ${GUSTS}`,
        "type: system-requirement",
        "status: draft",
        "title: Show gusts",
        "customer-id: 00815      # from the customer's tool",
        "priority: high",
        "legacy:",
        "  source: DOORS",
        "  object:   'WS-17'",
        "weight: 3",
        "tags: [wind, display]",
        "---",
        "New text.",
        "",
      ].join("\n"),
    );
  });

  it("[SR-016/AK3] shows an element of an unknown type with a hint", async () => {
    const { ws, workspace } = await open();
    const { store, metamodel } = await loaded(workspace);
    const record = recordOf(store, GADGET);
    expect(record.type).toBe("gadget");
    const read = await readElementFile(ws.root, GADGET_FILE);
    if (read.kind !== "parsed") {
      throw new Error("fixture file must parse");
    }
    const view = elementView({
      record,
      file: read.file,
      metamodel,
      store,
      shortIds: await workspace.get(shortIdState),
      titleKey: "title",
      layout: await workspace.get(workspaceLayoutState),
    });
    // Prefix of an unknown type: assumption until spec question #154 is answered (option 1).
    expect(view).toMatchObject({ id: GADGET, shortId: "UNKNOWN-8c9d0e", type: "gadget", title: "Wind vane" });
    expect(view.problems).toEqual(GADGET_PROBLEMS);
  });

  it("[SR-016/AK3] only reads an element of an unknown type: element.update is refused and the file stays", async () => {
    const { ws, workspace } = await open();
    const before = await fs.readFile(ws.path(GADGET_FILE), "utf8");
    const error = await update(workspace, { ref: GADGET, title: "Weather vane" }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(CommandError);
    expect([(error as CommandError).code, (error as CommandError).details]).toEqual([
      "element.read-only",
      { id: GADGET, type: "gadget", reason: "unknown-type" },
    ]);
    expect(await fs.readFile(ws.path(GADGET_FILE), "utf8")).toBe(before);
  });

  it("checks 50,000 elements in one pass within the time budget (N-036)", async () => {
    const { workspace } = await open();
    const { store, metamodel } = await loaded(workspace);
    const known = recordOf(store, KNOWN);
    const gusts = recordOf(store, GUSTS);
    const elements = Array.from({ length: 50_000 }, (_, i) => (i % 100 === 0 ? gusts : known));
    const big: ElementStore = { elements, byId: new Map(), nonElements: [], problems: [] };
    const started = performance.now();
    const findings = allUnknownFindings(big, metamodel);
    expect(performance.now() - started).toBeLessThan(5000);
    expect(findings).toHaveLength(2000);
  });
});

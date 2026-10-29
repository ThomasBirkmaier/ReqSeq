// Identifiers (#305): the property with the meaning `identifier` (here `spec-id`, as the ReqSeq spec
// will use it after the migration) names elements besides UUID and short ID, outputs show it next
// to the short ID, and a duplicate within a type is a finding.
import { readFile, rm, writeFile } from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandName, Problem } from "../catalog.js";
import { CommandError } from "../catalog.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { duplicateIdentifierProblemsState } from "./identifiers.js";
import { applyStoreChange, updateElements } from "./store.js";

const FIXTURE = "enabler-305/identifiers";

/** The elements of fixtures/enabler-305/identifiers. */
const N001 = { id: "30500000-0000-4000-8000-0000000a0001", file: "needs/N-0000000a0001.md" };
const SR036 = { id: "30500000-0000-4000-8000-0000000b0036", file: "requirements/SR-0000000b0036.md" };
const SR037 = { id: "30500000-0000-4000-8000-0000000b0037", file: "requirements/SR-0000000b0037.md" };
const D047 = { id: "30500000-0000-4000-8000-0000000c0047", file: "decisions/D-0000000c0047.md" };

interface Opened {
  readonly fixture: FixtureWorkspace;
  readonly workspace: Workspace;
}

const open = async (files: FixtureOptions["files"] = {}): Promise<Opened> => {
  const fixture = await createFixtureWorkspace({ fixture: FIXTURE, files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const run = async (opened: Opened, name: CommandName, input: Record<string, unknown>): Promise<unknown> =>
  invoke(name, input, { workspace: opened.workspace });

const failure = async (
  opened: Opened,
  name: CommandName,
  input: Record<string, unknown>,
): Promise<CommandError> => {
  try {
    await run(opened, name, input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error(`expected ${name} to fail`);
};

const elementOf = async (opened: Opened, ref: string): Promise<Record<string, unknown>> =>
  ((await run(opened, "element.get", { ref })) as { element: Record<string, unknown> }).element;

/** A decision of the fixture's metamodel with `spec-id`. */
const decision = (id: string, specId: string): string =>
  `---\nid: ${id}\ntype: decision\nstatus: draft\ntitle: Another decision\nspec-id: ${specId}\n---\n`;

const problemsOf = async (opened: Opened): Promise<readonly Problem[]> =>
  ((await run(opened, "workspace.check", {})) as { problems: readonly Problem[] }).problems;

describe("identifiers as element references (#305)", () => {
  it("names an element by its identifier in element.get and element.resolve, in any case", async () => {
    const opened = await open();
    const byUuid = await elementOf(opened, SR036.id);
    expect(byUuid).toMatchObject({ id: SR036.id, shortId: "SR-0b0036", identifier: "SR-036" });
    for (const ref of ["SR-036", "sr-036", "Sr-036"]) {
      expect(await elementOf(opened, ref)).toEqual(byUuid);
    }
    expect(await elementOf(opened, "N-001")).toMatchObject({ id: N001.id, identifier: "N-001" });
    expect(await elementOf(opened, "D-047")).toMatchObject({ id: D047.id, identifier: "D-047" });
    const resolved = (await run(opened, "element.resolve", { ref: "SR-036" })) as {
      element: unknown;
      current: unknown;
    };
    expect(resolved).toEqual({ element: byUuid, current: null });
    // The short ID still names the element.
    expect(await elementOf(opened, "SR-0b0036")).toEqual(byUuid);
  });

  it("says that no element has an identifier, and gives no candidate for it", async () => {
    const opened = await open();
    const unknown = await failure(opened, "element.resolve", { ref: "SR-099" });
    expect(unknown.toJSON()).toEqual({
      code: "ref.unknown",
      message: 'No element has the identifier "SR-099"',
      details: { ref: "SR-099" },
    });
    const shortForm = await failure(opened, "element.get", { ref: "SR-ffffff" });
    expect([shortForm.code, shortForm.message]).toEqual([
      "ref.unknown",
      'No element has the short ID or identifier "SR-ffffff"',
    ]);
    const uuid = await failure(opened, "element.get", { ref: "30500000-0000-4000-8000-0000000f0000" });
    expect(uuid.message).toBe('No element has the UUID "30500000-0000-4000-8000-0000000f0000"');
  });

  it("refuses a reference that is the short ID of one element and the identifier of another as ambiguous", async () => {
    const other = "30500000-0000-4000-8000-0000000c0048";
    const opened = await open({ "decisions/D-0000000c0048.md": decision(other, "SR-0b0037") });
    const error = await failure(opened, "element.get", { ref: "SR-0b0037" });
    expect(error.toJSON()).toEqual({
      code: "ref.ambiguous",
      message:
        "SR-0b0037 names more than one element (as a short ID and as an identifier); give the full UUID",
      details: {
        ref: "SR-0b0037",
        candidates: [
          { id: SR037.id, repository: "spec", file: SR037.file },
          { id: other, repository: "spec", file: "decisions/D-0000000c0048.md" },
        ],
      },
    });
    // The same in any case, and through any command that takes a reference.
    expect((await failure(opened, "trace.chain", { ref: "sr-0B0037" })).code).toBe("ref.ambiguous");
    // A candidate's repository and file pick it (#255); the UUID always names one element.
    expect(await elementOf(opened, other).then((e) => e["id"])).toBe(other);
    const picked = (await run(opened, "element.get", {
      ref: "SR-0b0037",
      file: "decisions/D-0000000c0048.md",
    })) as { element: { id: string } };
    expect(picked.element.id).toBe(other);
  });

  it("refuses an identifier that elements of two types share as ambiguous, without a finding", async () => {
    const other = "30500000-0000-4000-8000-0000000c0048";
    const opened = await open({ "decisions/D-0000000c0048.md": decision(other, "sr-036") });
    const error = await failure(opened, "element.update", { ref: "SR-036", title: "x" });
    expect(error.toJSON()).toEqual({
      code: "ref.ambiguous",
      message: "SR-036 names more than one element (as the identifier of each); give the full UUID",
      details: {
        ref: "SR-036",
        candidates: [
          { id: other, repository: "spec", file: "decisions/D-0000000c0048.md" },
          { id: SR036.id, repository: "spec", file: SR036.file },
        ],
      },
    });
    const there = await failure(opened, "element.get", { ref: "SR-036", repository: "spec" });
    expect(there.message).toBe(
      "SR-036 names more than one element there (as the identifier of each); give the repository and file of one of the candidates",
    );
    // Unique per type: elements of different types may share it.
    expect(await problemsOf(opened)).toEqual([]);
  });

  it("never resolves a short ID with an outdated prefix silently to the element with that identifier", async () => {
    // N-0b0036 was the short ID of SR-036 before its type's prefix changed (SR-015, #275); now it
    // is the identifier of a decision. Both are candidates, the tool picks neither.
    const other = "30500000-0000-4000-8000-0000000c0048";
    const opened = await open({ "decisions/D-0000000c0048.md": decision(other, "N-0b0036") });
    const error = await failure(opened, "element.resolve", { ref: "n-0b0036" });
    expect(error.toJSON()).toEqual({
      code: "ref.ambiguous",
      message:
        "n-0b0036 names more than one element (as an identifier, and as a short ID whose prefix may be outdated); give the full UUID",
      details: {
        ref: "n-0b0036",
        candidates: [
          { id: other, repository: "spec", file: "decisions/D-0000000c0048.md" },
          { id: SR036.id, repository: "spec", file: SR036.file },
        ],
      },
    });
    // An identifier that is also the element's own tail names that one element.
    const own = await open({ "decisions/D-0000000c0048.md": decision(other, "N-0c0048") });
    expect((await elementOf(own, "N-0c0048"))["id"]).toBe(other);
  });

  it("never compares an identifier with a reference of the UUID form", async () => {
    const other = "30500000-0000-4000-8000-0000000c0048";
    const opened = await open({ "decisions/D-0000000c0048.md": decision(other, SR036.id) });
    expect((await elementOf(opened, SR036.id))["id"]).toBe(SR036.id);
    expect((await elementOf(opened, SR036.id.toUpperCase()))["id"]).toBe(SR036.id);
  });

  it("takes identifiers in every command that takes an element reference", async () => {
    const opened = await open();
    const chain = (await run(opened, "trace.chain", { ref: "N-001" })) as { root: string };
    expect(chain.root).toBe(N001.id);
    const related = (await run(opened, "trace.related", { refs: ["SR-037"], direction: "parents" })) as {
      elements: { id: string }[];
    };
    expect(related.elements.map((e) => e.id)).toEqual([SR036.id, N001.id]);
    const affected = (await run(opened, "trace.affected", { ref: "n-001" })) as { total: number };
    expect(affected.total).toBe(2);
    const hints = (await run(opened, "hint.list", { ref: "SR-036" })) as { hints: unknown[] };
    expect(hints.hints).toEqual([]);
    await run(opened, "relation.add", { source: "D-047", kind: "derives-from", target: "N-001" });
    expect(await readFile(opened.fixture.path(D047.file), "utf8")).toContain(`{ id: ${N001.id}, version: `);
    await run(opened, "element.update", { ref: "D-047", title: "The spec moves into ReqSeq" });
    await run(opened, "element.setStatus", { refs: ["D-047"], status: "obsolete" });
    expect(await elementOf(opened, "d-047")).toMatchObject({
      title: "The spec moves into ReqSeq",
      status: "obsolete",
    });
  });
});

describe("identifiers in outputs (#305)", () => {
  it("shows the identifier next to the short ID of an element, its relations and its successors", async () => {
    const opened = await open();
    const element = await elementOf(opened, "SR-036");
    expect(Object.keys(element).slice(0, 3)).toEqual(["id", "shortId", "identifier"]);
    expect(element["properties"]).toEqual({ "spec-id": "SR-036" });
    expect(element["relations"]).toEqual([
      expect.objectContaining({ kind: "derives-from", shortId: "N-0a0001", identifier: "N-001" }),
    ]);
    await run(opened, "element.supersede", { ref: "SR-037", status: "obsolete", successor: "D-047" });
    const superseded = await elementOf(opened, "SR-037");
    expect(superseded["relations"]).toContainEqual(
      expect.objectContaining({ direction: "in", shortId: "D-0c0047", identifier: "D-047" }),
    );
  });

  it("leaves the field out for an element without identifier and when no property has the meaning", async () => {
    const without = await open({
      [D047.file]: `---\nid: ${D047.id}\ntype: decision\nstatus: draft\ntitle: No spec ID\n---\n`,
    });
    expect(await elementOf(without, D047.id)).not.toHaveProperty("identifier");
    const model = await readFile(
      new URL("../../../../fixtures/enabler-305/identifiers/metamodel/model.yaml", import.meta.url),
      "utf8",
    );
    const opened = await open({ "metamodel/model.yaml": model.replace(", meaning: identifier", "") });
    expect(await elementOf(opened, SR036.id)).not.toHaveProperty("identifier");
    expect((await failure(opened, "element.get", { ref: "SR-036" })).code).toBe("ref.unknown");
  });

  it("shows the identifier of each element of a chain, of related and of affected elements", async () => {
    const opened = await open();
    const chain = (await run(opened, "trace.chain", { ref: "SR-036" })) as {
      nodes: { shortId: string; identifier?: string }[];
    };
    expect(chain.nodes.map((n) => [n.shortId, n.identifier])).toEqual([
      ["SR-0b0036", "SR-036"],
      ["N-0a0001", "N-001"],
      ["SR-0b0037", "SR-037"],
    ]);
    const related = (await run(opened, "trace.related", { refs: ["SR-036"], direction: "children" })) as {
      elements: { identifier?: string }[];
    };
    expect(related.elements.map((e) => e.identifier)).toEqual(["SR-037"]);
    const affected = (await run(opened, "trace.affected", { ref: "N-001" })) as {
      affected: { identifier?: string }[];
    };
    expect(affected.affected.map((e) => e.identifier)).toEqual(["SR-036", "SR-037"]);
  });

  it("names the identifier of the element of a problem next to its short ID", async () => {
    const opened = await open();
    const file = opened.fixture.path(N001.file);
    await writeFile(file, (await readFile(file, "utf8")).replace("by their spec ID.", "by their IDs."));
    const problems = await problemsOf(opened);
    expect(problems.map((p) => [p.code, p.elementShortId, p.elementIdentifier])).toEqual([
      ["relation.outdated", "SR-0b0036", "SR-036"],
    ]);
  });

  it("shows the identifier of the child an unresolved derivation comes from", async () => {
    // A copy of SR-036 (the same UUID, SR-088): SR-037 points at both, so it is unresolved below SR-036.
    const opened = await open({
      "requirements/SR-copy.md": `---\nid: ${SR036.id}\ntype: system-requirement\nstatus: draft\ntitle: Copy\nspec-id: SR-136\n---\n`,
    });
    const chain = (await run(opened, "trace.chain", { ref: "N-001", direction: "down" })) as {
      unresolved: unknown[];
    };
    expect(chain.unresolved).toEqual([
      expect.objectContaining({
        direction: "down",
        shortId: "SR-0b0037",
        identifier: "SR-037",
        targetState: "ambiguous",
      }),
    ]);
  });
});

describe("duplicate identifiers (#305)", () => {
  const twin = (specId: string): string =>
    `---\nid: 30500000-0000-4000-8000-0000000b0038\ntype: system-requirement\nstatus: draft\ntitle: Twin\nspec-id: ${specId}\n---\n`;
  const TWIN_FILE = "requirements/SR-0000000b0038.md";

  it("reports each element of a type whose identifier another one has, in any case", async () => {
    const opened = await open({ [TWIN_FILE]: twin("sr-036") });
    const problems = await problemsOf(opened);
    expect(problems).toEqual([
      {
        code: "element.duplicate-identifier",
        severity: "warning",
        message: `The identifier SR-036 is also on System Requirement ${TWIN_FILE} (spec); an identifier is unique per type, so a reference by it is ambiguous: give one of them another spec-id`,
        repository: "spec",
        file: SR036.file,
        line: 6,
        elementId: SR036.id,
        elementShortId: "SR-0b0036",
        elementIdentifier: "SR-036",
      },
      {
        code: "element.duplicate-identifier",
        severity: "warning",
        message: `The identifier sr-036 is also on System Requirement ${SR036.file} (spec); an identifier is unique per type, so a reference by it is ambiguous: give one of them another spec-id`,
        repository: "spec",
        file: TWIN_FILE,
        line: 6,
        elementId: "30500000-0000-4000-8000-0000000b0038",
        elementShortId: "SR-0b0038",
        elementIdentifier: "sr-036",
      },
    ]);
    // A hint (a warning about an element): at the element and in hint.list.
    const shown = (await run(opened, "element.get", { ref: SR036.id })) as {
      element: { problems: Problem[] };
    };
    expect(shown.element.problems.map((p) => [p.code, p.line])).toEqual([
      ["element.duplicate-identifier", 6],
    ]);
    const hints = (await run(opened, "hint.list", { kind: ["element.duplicate-identifier"] })) as {
      hints: Problem[];
    };
    expect(hints.hints.map((h) => h.file)).toEqual([SR036.file, TWIN_FILE]);
  });

  it("leaves copies of one UUID to duplicate-id (SR-088)", async () => {
    const copy = "requirements/SR-copy.md";
    const original = await readFile((await open()).fixture.path(SR036.file), "utf8");
    const opened = await open({ [copy]: original });
    const codes = (await problemsOf(opened)).map((p) => p.code);
    expect(codes).toContain("element.duplicate-id");
    expect(codes).not.toContain("element.duplicate-identifier");
  });

  it("finds the duplicates again after a save that adds or removes one", async () => {
    const opened = await open({ [TWIN_FILE]: twin("SR-099") });
    expect(await problemsOf(opened)).toEqual([]);
    // Two saves on one workspace: the findings are carried over each (#184).
    await run(opened, "element.update", { ref: "SR-099", set: { "spec-id": "SR-037" } });
    expect((await problemsOf(opened)).map((p) => [p.code, p.file])).toEqual([
      ["element.duplicate-identifier", SR037.file],
      ["element.duplicate-identifier", TWIN_FILE],
    ]);
    // A fresh workspace gives the same (SR-080 AK2).
    const fresh = new Workspace(opened.fixture.root);
    onTestFinished(() => fresh.close());
    expect(await invoke("workspace.check", {}, { workspace: fresh })).toEqual(
      await run(opened, "workspace.check", {}),
    );
    await run(opened, "element.update", { ref: "30500000-0000-4000-8000-0000000b0038", unset: ["spec-id"] });
    expect(await problemsOf(opened)).toEqual([]);
    await run(opened, "element.update", { ref: SR037.id, set: { "spec-id": "SR-036" } });
    expect((await problemsOf(opened)).map((p) => p.file)).toEqual([SR036.file, SR037.file]);
    // The identifier now names both: a reference by it is ambiguous, the old one names nothing.
    expect((await failure(opened, "element.get", { ref: "SR-036" })).code).toBe("ref.ambiguous");
    expect((await failure(opened, "element.get", { ref: "SR-037" })).code).toBe("ref.unknown");
  });

  it("carries the findings over changes from outside, also a new and a removed file (#184)", async () => {
    const { fixture, workspace } = await open();
    expect(await workspace.get(duplicateIdentifierProblemsState)).toEqual([]);
    /** Writes or removes files as an editor does and applies them as the watcher does (SR-007). */
    const external = async (files: Readonly<Record<string, string | undefined>>): Promise<void> => {
      for (const [file, text] of Object.entries(files)) {
        await (text === undefined ? rm(fixture.path(file)) : fixture.write(file, text));
      }
      const layout = await workspace.get(workspaceLayoutState);
      const changed = await applyStoreChange(workspace, (store) =>
        updateElements(store, layout, new Map([["spec", { paths: Object.keys(files) }]])),
      );
      expect(changed).toBeDefined();
      // Carried, not reset.
      expect(workspace.peek(duplicateIdentifierProblemsState)).toBeDefined();
    };
    await external({ [TWIN_FILE]: twin("SR-036") });
    expect((await workspace.get(duplicateIdentifierProblemsState)).map((p) => p.file)).toEqual([
      SR036.file,
      TWIN_FILE,
    ]);
    await external({ [TWIN_FILE]: undefined });
    expect(await workspace.get(duplicateIdentifierProblemsState)).toEqual([]);
  });

  it("names the type by its key when the metamodel does not know it", async () => {
    const widget = (n: number): string =>
      `---\nid: 30500000-0000-4000-8000-0000000e000${String(n)}\ntype: widget\nstatus: draft\nspec-id: W-1\n---\n`;
    const { workspace } = await open({ "widgets/a.md": widget(1), "widgets/b.md": widget(2) });
    expect((await workspace.get(duplicateIdentifierProblemsState)).map((p) => p.message)).toEqual([
      "The identifier W-1 is also on widget widgets/b.md (spec); an identifier is unique per type, so a reference by it is ambiguous: give one of them another spec-id",
      "The identifier W-1 is also on widget widgets/a.md (spec); an identifier is unique per type, so a reference by it is ambiguous: give one of them another spec-id",
    ]);
  });

  it("reports nothing against a metamodel that is not valid", async () => {
    const opened = await open({
      [TWIN_FILE]: twin("SR-036"),
      "metamodel/broken.yaml": "reqseq-metamodel: 1\ntypes:\n  - { key: need, name: Again, prefix: NN }\n",
    });
    const problems = await problemsOf(opened);
    expect(problems.some((p) => p.code === "metamodel.invalid")).toBe(true);
    expect(problems.some((p) => p.code === "element.duplicate-identifier")).toBe(false);
  });
});

describe("the meaning identifier in the metamodel (#305)", () => {
  it("refuses it on a property that is not of kind text or holds a list", async () => {
    for (const [property, not] of [
      ["{ key: spec-id, name: Spec ID, kind: number, meaning: identifier }", "kind number"],
      ["{ key: spec-id, name: Spec ID, kind: text, many: true, meaning: identifier }", "a list"],
    ] as const) {
      const model = await readFile(
        new URL("../../../../fixtures/enabler-305/identifiers/metamodel/model.yaml", import.meta.url),
        "utf8",
      );
      const opened = await open({
        "metamodel/model.yaml": model.replace(
          "{ key: spec-id, name: Spec ID, kind: text, meaning: identifier }",
          property,
        ),
      });
      const status = (await run(opened, "workspace.status", {})) as {
        readOnly: boolean;
        problems: Problem[];
      };
      expect(status.readOnly, property).toBe(true);
      expect(status.problems, property).toEqual([
        {
          code: "metamodel.invalid",
          severity: "error",
          message: `Property spec-id has the meaning identifier, which needs kind text without many (one text per element), not ${not}`,
          file: "metamodel/model.yaml",
          line: 15,
          repository: "spec",
        },
      ]);
    }
  });
});

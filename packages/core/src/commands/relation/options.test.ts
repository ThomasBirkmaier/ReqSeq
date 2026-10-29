// relation.options (SR-067) on fixtures/SR-069/filter: needs N-0000a1, N-0000a2; system requirements
// SR-0000b1..b5; software requirements SWR-0000f1, f2 (a subtype of system-requirement); decision
// D-0000e1; variants VAR-0000c1, c2; packages PKG-0000d1, d2. Metamodel files merge in name order, so
// the types are software-requirement (software.yaml), need, use-case, system-requirement, decision,
// variant, package (standard-model.yaml).
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Output = CommandOutput<"relation.options">;
type Hits = CommandOutput<"element.search">;

const FILTER: FixtureOptions = { fixture: "SR-069/filter" };

const ALL_TYPES = [
  "software-requirement",
  "need",
  "use-case",
  "system-requirement",
  "decision",
  "variant",
  "package",
];
const REFINES = { kind: "refines", name: "Refines", targetTypes: ALL_TYPES };
const DERIVES = {
  kind: "derives-from",
  name: "Derives from",
  targetTypes: ["software-requirement", "need", "use-case", "system-requirement"],
};
const BASED_ON = { kind: "based-on", name: "Based on", targetTypes: ["decision"] };
const SUPERSEDES = { kind: "supersedes", name: "Supersedes", targetTypes: ALL_TYPES };
const REPLACES = {
  kind: "replaces",
  name: "Replaces",
  targetTypes: ["software-requirement", "system-requirement"],
};
const EXCLUDES = {
  kind: "excludes",
  name: "Excludes",
  targetTypes: ["software-requirement", "system-requirement"],
};

/** An element of a type the metamodel does not know (SR-016). */
const GADGET_ID = "69069069-0000-4000-8000-0000000000ee";
const GADGET = `---\nid: ${GADGET_ID}\ntype: gadget\nstatus: draft\ntitle: Gadget\n---\n\nA draft gadget.\n`;

const open = async (options: FixtureOptions = FILTER): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const options = async (workspace: Workspace, input: Record<string, unknown>): Promise<Output> =>
  (await invoke("relation.options", input, { workspace })) as Output;

const optionsError = async (workspace: Workspace, input: Record<string, unknown>): Promise<CommandError> => {
  try {
    await options(workspace, input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected relation.options to fail");
};

/** The short IDs `element.search` finds for `query`, within `selection` when given. */
const found = async (
  workspace: Workspace,
  query: string,
  selection?: Record<string, unknown>,
): Promise<string[]> => {
  const out = (await invoke(
    "element.search",
    { query, limit: 500, ...(selection === undefined ? {} : { selection }) },
    { workspace },
  )) as Hits;
  return out.hits.map((hit) => hit.shortId).toSorted();
};

describe("relation.options offers only the relation kinds the metamodel allows for the type (SR-067 AK1)", () => {
  it("[SR-067/AK1] offers a system requirement the kinds whose source types allow it, in metamodel order, with name and target types", async () => {
    const ws = await open();
    // excludes goes only from a variant.
    expect(await options(ws, { ref: "SR-0000b1" })).toEqual({
      kinds: [REFINES, DERIVES, BASED_ON, SUPERSEDES, REPLACES],
    });
  });

  it("[SR-067/AK1] offers a subtype the kinds of its supertype, and a need and a variant only theirs", async () => {
    const ws = await open();
    expect(await options(ws, { ref: "swr-0000F1" })).toEqual({
      kinds: [REFINES, DERIVES, BASED_ON, SUPERSEDES, REPLACES],
    });
    expect(await options(ws, { ref: "N-0000a1" })).toEqual({ kinds: [REFINES, BASED_ON, SUPERSEDES] });
    expect(await options(ws, { ref: "VAR-0000c1" })).toEqual({
      kinds: [REFINES, BASED_ON, SUPERSEDES, EXCLUDES],
    });
  });

  it("[SR-067/AK1] with a kind offers only that one, and none when the type does not allow it", async () => {
    const ws = await open();
    expect(await options(ws, { ref: "SR-0000b1", kind: "derives-from" })).toEqual({ kinds: [DERIVES] });
    expect(await options(ws, { ref: "N-0000a1", kind: "derives-from" })).toEqual({ kinds: [] });
  });

  it("[SR-067/AK1] refuses a key that is no relation kind, as relation.add does", async () => {
    const ws = await open();
    const unknown = await optionsError(ws, { ref: "N-0000a1", kind: "nope" });
    expect([unknown.code, unknown.message, unknown.details]).toEqual([
      "input.invalid",
      "The metamodel has no relation kind nope; relation kinds from Need: refines, based-on, supersedes",
      { kind: "nope", reason: "unknown-relation", allowed: ["refines", "based-on", "supersedes"] },
    ]);
    const property = await optionsError(ws, { ref: "N-0000a1", kind: "validity" });
    expect([property.code, property.details]).toEqual([
      "input.invalid",
      { kind: "validity", reason: "property" },
    ]);
    const add = await invoke(
      "relation.add",
      { source: "N-0000a1", kind: "nope", target: "N-0000a2" },
      { workspace: ws },
    ).catch((error: unknown) => error);
    expect(add).toEqual(unknown);
  });

  it("[SR-067/AK1] does not offer a kind whose target types allow no type, and names a subtype it allows", async () => {
    const ws = await open({
      ...FILTER,
      files: {
        "metamodel/more.yaml":
          "reqseq-metamodel: 1\nrelations:\n" +
          "  - { key: blocks, name: Blocks, target-types: [] }\n" +
          "  - { key: refines-software, name: Refines software, source-types: [need], target-types: [software-requirement] }\n",
      },
    });
    expect(await options(ws, { ref: "N-0000a1" })).toEqual({
      // more.yaml comes first.
      kinds: [
        { kind: "refines-software", name: "Refines software", targetTypes: ["software-requirement"] },
        REFINES,
        BASED_ON,
        SUPERSEDES,
      ],
    });
    expect(await options(ws, { ref: "N-0000a1", kind: "blocks" })).toEqual({ kinds: [] });
  });

  it("[SR-067/AK1] offers no kind for an element whose type the metamodel does not know (SR-016 AK3)", async () => {
    const ws = await open({ ...FILTER, files: { "requirements/X-0000000000ee.md": GADGET } });
    expect(await options(ws, { ref: GADGET_ID })).toEqual({ kinds: [] });
    const error = await optionsError(ws, { ref: GADGET_ID, kind: "nope" });
    expect([error.code, error.message]).toEqual([
      "input.invalid",
      "The metamodel has no relation kind nope; relation kinds from gadget: none",
    ]);
  });

  it("refuses a reference that names no element", async () => {
    const ws = await open();
    expect((await optionsError(ws, { ref: "SR-ffffff" })).code).toBe("ref.unknown");
  });

  it("[SR-067/AK1] relation.add sets a relation exactly when relation.options offers its kind with the target's type", async () => {
    const ws = await open();
    const sources = ["SR-0000b1", "SWR-0000f1", "N-0000a1", "VAR-0000c1", "D-0000e1"];
    // One target of each type that has elements.
    const targets: Record<string, string> = {
      "N-0000a2": "need",
      "SR-0000b2": "system-requirement",
      "SWR-0000f2": "software-requirement",
      "D-0000e1": "decision",
      "VAR-0000c2": "variant",
      "PKG-0000d2": "package",
    };
    const kinds = [REFINES, DERIVES, BASED_ON, SUPERSEDES, REPLACES, EXCLUDES].map((k) => k.kind);
    const outcomes: string[] = [];
    const expected: string[] = [];
    for (const source of sources) {
      const offered = (await options(ws, { ref: source })).kinds;
      for (const kind of kinds) {
        for (const [target, type] of Object.entries(targets)) {
          const allowed = offered.find((o) => o.kind === kind)?.targetTypes.includes(type) === true;
          expected.push(`${source} ${kind} ${target}: ${allowed ? "set" : "relation.not-allowed"}`);
          const outcome = await invoke("relation.add", { source, kind, target }, { workspace: ws }).then(
            () => "set",
            (error: unknown) => (error instanceof CommandError ? error.code : String(error)),
          );
          outcomes.push(`${source} ${kind} ${target}: ${outcome}`);
        }
      }
    }
    expect(outcomes).toEqual(expected);
    expect(expected.filter((line) => line.endsWith(": set")).length).toBeGreaterThan(0);
    expect(expected.filter((line) => line.endsWith(": relation.not-allowed")).length).toBeGreaterThan(0);
  });
});

describe("relation.options gives the target types a target search is restricted to (SR-067 AK2)", () => {
  it("[SR-067/AK2] with a chosen kind, element.search within its target types shows only elements of those types", async () => {
    const ws = await open();
    // "draft" is the name of a status, so it finds every draft element, whatever its type.
    expect(await found(ws, "draft")).toEqual([
      "N-0000a2",
      "PKG-0000d2",
      "SR-0000b2",
      "SR-0000b3",
      "SWR-0000f1",
      "VAR-0000c2",
    ]);
    const [derives] = (await options(ws, { ref: "SR-0000b1", kind: "derives-from" })).kinds;
    expect(await found(ws, "draft", { where: { type: derives?.targetTypes } })).toEqual([
      "N-0000a2",
      "SR-0000b2",
      "SR-0000b3",
      "SWR-0000f1",
    ]);
    // Every allowed type is named, so leaving out subtypes finds the same elements.
    expect(await found(ws, "draft", { where: { type: derives?.targetTypes, subtypes: false } })).toEqual(
      await found(ws, "draft", { where: { type: derives?.targetTypes } }),
    );
    const [basedOn] = (await options(ws, { ref: "SR-0000b1", kind: "based-on" })).kinds;
    expect(await found(ws, "approved", { where: { type: basedOn?.targetTypes } })).toEqual(["D-0000e1"]);
  });

  it("[SR-067/AK2] a kind without target types finds elements of every type the metamodel knows, not of an unknown type", async () => {
    const ws = await open({ ...FILTER, files: { "requirements/X-0000000000ee.md": GADGET } });
    const [refines] = (await options(ws, { ref: "N-0000a1", kind: "refines" })).kinds;
    const everyDraft = await found(ws, "draft");
    expect(everyDraft).toContain("UNKNOWN-0000ee");
    expect(await found(ws, "draft", { where: { type: refines?.targetTypes } })).toEqual(
      everyDraft.filter((id) => id !== "UNKNOWN-0000ee"),
    );
  });
});

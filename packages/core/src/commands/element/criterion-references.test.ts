// The criteria of a requirement with number, key, text and the reference for a test name, as
// element.get and element.resolve give them (SR-205 AK1, AK3), and element.resolve of such a
// reference (SR-205 AK5). The reference leads back to the requirement as enrich-junit reads a test
// name (`criterionRefsOf`) and the store resolves it (`resolveRef`), so a name that does not is
// replaced by the short ID (assumption of spec question #1525).
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { criterionRefsOf } from "../../evidence/junit-model.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
import { elementStoreState, resolveRef, shortIdState } from "../../model/index.js";

type Got = CommandOutput<"element.get">;
type Resolved = CommandOutput<"element.resolve">;

const requirement = (id: string, identifier: string | undefined, criteria: string): string =>
  `---\nid: ${id}\ntype: system-requirement\nstatus: draft\ntitle: Requirement ${id.slice(-4)}\n` +
  `requirement-type: functional\n${identifier === undefined ? "" : `spec-id: ${JSON.stringify(identifier)}\n`}` +
  `acceptance-criteria:\n${criteria}---\n\nText.\n`;

const KEYED =
  "  - key: kred\n    text: Given a reading, then it shows.\n  - Given no reading, then a dash shows.\n  - key: kfro\n    text: Given frost, then a mark shows.\n";

/** UUIDs of the requirements below; the short IDs are SR- and the last six digits. */
const IDS = {
  named: "29000000-0000-4000-8000-0000000e0001",
  slash: "29000000-0000-4000-8000-0000000e0002",
  shared1: "29000000-0000-4000-8000-0000000e0003",
  shared2: "29000000-0000-4000-8000-0000000e0004",
  plain: "29000000-0000-4000-8000-0000000e0005",
  double: "29000000-0000-4000-8000-0000000e0006",
  bracket: "29000000-0000-4000-8000-0000000e0007",
  akLike: "29000000-0000-4000-8000-0000000e000a",
} as const;

// fixtures/SR-029/enrich has the property `spec-id` with the meaning identifier.
const FIXTURE: FixtureOptions = {
  fixture: "SR-029/enrich",
  files: {
    "requirements/SR-0000000e0001.md": requirement(IDS.named, "SR-901", KEYED),
    "requirements/SR-0000000e0002.md": requirement(IDS.slash, "SYS/REQ/001", KEYED),
    "requirements/SR-0000000e0003.md": requirement(IDS.shared1, "SR-902", KEYED),
    "requirements/SR-0000000e0004.md": requirement(IDS.shared2, "SR-902", KEYED),
    "requirements/SR-0000000e0005.md": requirement(IDS.plain, undefined, KEYED),
    "requirements/SR-0000000e0006.md": requirement(
      IDS.double,
      "SR-903",
      "  - key: kred\n    text: First.\n  - key: kred\n    text: Second.\n  - key: kone\n    text: Third.\n",
    ),
    "requirements/SR-0000000e0007.md": requirement(IDS.bracket, "A[1]", KEYED),
    // An identifier that reads as a reference to a criterion by number.
    "requirements/SR-0000000e000a.md": requirement(IDS.akLike, "ECU/AK2", KEYED),
    // A need whose file holds criteria: it is no requirement, so it has none (SR-205 AK1).
    "needs/N-0000000e0008.md":
      "---\nid: 29000000-0000-4000-8000-0000000e0008\ntype: need\nstatus: draft\ntitle: A need\nacceptance-criteria:\n  - key: kred\n    text: Not a criterion.\n---\n",
    "requirements/SR-0000000e0009.md":
      "---\nid: 29000000-0000-4000-8000-0000000e0009\ntype: system-requirement\nstatus: draft\ntitle: Without criteria\nrequirement-type: functional\n---\n",
  },
};

const open = async (): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace(FIXTURE);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const get = async (workspace: Workspace, ref: string): Promise<Got> =>
  (await invoke("element.get", { ref }, { workspace })) as Got;

const resolveOf = async (workspace: Workspace, input: Record<string, unknown>): Promise<Resolved> =>
  (await invoke("element.resolve", input, { workspace })) as Resolved;

const resolveError = async (workspace: Workspace, input: Record<string, unknown>): Promise<CommandError> => {
  try {
    await resolveOf(workspace, input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected element.resolve to fail");
};

/** The three criteria of `KEYED` with the references of `name`. */
const keyed = (name: string): Got["criterionReferences"] => ({
  property: "acceptance-criteria",
  criteria: [
    { criterion: 1, key: "kred", text: "Given a reading, then it shows.", reference: `[${name}/AK-kred]` },
    { criterion: 2, text: "Given no reading, then a dash shows." },
    { criterion: 3, key: "kfro", text: "Given frost, then a mark shows.", reference: `[${name}/AK-kfro]` },
  ],
});

describe("element.get: criteria with number, key, text and reference (SR-205 AK1)", () => {
  it("[SR-205/AK-npsp] gives each criterion its number, key, text and the reference with the identifier, else the short ID; none without key", async () => {
    const workspace = await open();
    expect((await get(workspace, "SR-901")).criterionReferences).toEqual(keyed("SR-901"));
    // Without identifier, and with one a test name cannot carry or that names two elements: the short ID.
    expect((await get(workspace, IDS.plain)).criterionReferences).toEqual(keyed("SR-0e0005"));
    expect((await get(workspace, IDS.slash)).criterionReferences).toEqual(keyed("SR-0e0002"));
    expect((await get(workspace, IDS.shared1)).criterionReferences).toEqual(keyed("SR-0e0003"));
    expect((await get(workspace, IDS.bracket)).criterionReferences).toEqual(keyed("SR-0e0007"));
    // A key two criteria carry names neither of them (SR-204 AK10).
    expect((await get(workspace, "SR-903")).criterionReferences?.criteria).toEqual([
      { criterion: 1, key: "kred", text: "First." },
      { criterion: 2, key: "kred", text: "Second." },
      { criterion: 3, key: "kone", text: "Third.", reference: "[SR-903/AK-kone]" },
    ]);
    // A requirement without criteria, and an element that is no requirement, have none.
    expect((await get(workspace, "SR-0e0009")).criterionReferences).toBeUndefined();
    expect((await get(workspace, "N-0e0008")).criterionReferences).toBeUndefined();
  });

  it("[SR-205/AK-npsp] each reference reads back as a test name and resolves to its requirement", async () => {
    const workspace = await open();
    const store = await workspace.get(elementStoreState);
    const shortIds = await workspace.get(shortIdState);
    for (const id of Object.values(IDS)) {
      for (const entry of (await get(workspace, id)).criterionReferences?.criteria ?? []) {
        if (entry.reference === undefined) {
          continue;
        }
        const [read, ...more] = criterionRefsOf(`test > ${entry.reference} reports it`);
        expect(more).toEqual([]);
        expect(read?.criterion).toBe(entry.key);
        expect(read === undefined ? undefined : resolveRef(store, shortIds, read.ref).id).toBe(id);
      }
    }
  });

  it("[SR-205/AK-npsp] element.resolve gives the same criteria as element.get", async () => {
    const workspace = await open();
    expect((await resolveOf(workspace, { ref: "SR-901" })).criterionReferences).toEqual(keyed("SR-901"));
  });

  it("[SR-205/AK-wyyz] numbers stay 1 to n without gaps when criteria are inserted, moved and removed, and keys move with their criteria", async () => {
    const workspace = await open();
    const { fileSha256 } = await get(workspace, "SR-901");
    await invoke(
      "element.update",
      {
        ref: "SR-901",
        expectedFileSha256: fileSha256,
        // kred removed, kfro moved first, a new criterion inserted in between.
        set: {
          "acceptance-criteria": [
            { key: "kfro", text: "Given frost, then a mark shows." },
            "Given a storm, then a warning shows.",
            "Given no reading, then a dash shows.",
          ],
        },
      },
      { workspace },
    );
    const criteria = (await get(workspace, "SR-901")).criterionReferences?.criteria ?? [];
    expect(criteria.map((c) => c.criterion)).toEqual([1, 2, 3]);
    expect(criteria[0]).toEqual({
      criterion: 1,
      key: "kfro",
      text: "Given frost, then a mark shows.",
      reference: "[SR-901/AK-kfro]",
    });
    expect(criteria.map((c) => c.text)).toEqual([
      "Given frost, then a mark shows.",
      "Given a storm, then a warning shows.",
      "Given no reading, then a dash shows.",
    ]);
    // Every criterion saved gets a key (SR-204 AK1), so each has a reference now.
    expect(criteria.every((c) => c.reference === `[SR-901/AK-${String(c.key)}]`)).toBe(true);
  });
});

describe("element.resolve of a reference to a criterion (SR-205 AK5)", () => {
  it("[SR-205/AK-ndnj] names the requirement, number and text of the criterion, with brackets or without, by identifier or short ID", async () => {
    const workspace = await open();
    const ak3 = {
      criterion: 3,
      key: "kfro",
      text: "Given frost, then a mark shows.",
      reference: "[SR-901/AK-kfro]",
    };
    const bracketed = await resolveOf(workspace, { ref: "[SR-901/AK-kfro]" });
    expect(bracketed.element).toMatchObject({ id: IDS.named, shortId: "SR-0e0001", identifier: "SR-901" });
    expect(bracketed.criterion).toEqual(ak3);
    expect((await resolveOf(workspace, { ref: "SR-901/AK-kfro" })).criterion).toEqual(ak3);
    expect((await resolveOf(workspace, { ref: "[SR-0e0001/AK-kfro]" })).criterion).toEqual(ak3);
    // The identifier with a `/` reads as enrich-junit reads it: the short ID is its reference.
    expect((await resolveOf(workspace, { ref: "[SR-0e0002/AK-kred]" })).criterion?.reference).toBe(
      "[SR-0e0002/AK-kred]",
    );
    // With a version, whether it is current, as without a criterion (SR-060 AK2).
    const versioned = await resolveOf(workspace, { ref: "[SR-901/AK-kfro]", version: "n1:0000000000000000" });
    expect(versioned.current).toBe("outdated");
    expect(versioned.criterion).toEqual(ak3);
  });

  it("[SR-205/AK-ndnj] a bracket token without a criterion names the element; a plain identifier with a `/` stays one, also one that reads as a criterion's", async () => {
    const workspace = await open();
    for (const ref of ["[SR-901]", "[SR-901/slow]"]) {
      const resolved = await resolveOf(workspace, { ref });
      expect(resolved.element.id).toBe(IDS.named);
      expect(resolved.criterion).toBeUndefined();
    }
    expect((await resolveOf(workspace, { ref: "SYS/REQ/001" })).element.id).toBe(IDS.slash);
    // An identifier that names one element stays its reference, also where it reads as a criterion's.
    const akLike = await resolveOf(workspace, { ref: "ECU/AK2" });
    expect(akLike.element.id).toBe(IDS.akLike);
    expect(akLike.criterion).toBeUndefined();
  });

  it("[SR-205/AK-ndnj] refuses an unknown key, a key two criteria carry, a number and another form, each with its own code", async () => {
    const workspace = await open();
    const unknown = await resolveError(workspace, { ref: "[SR-901/AK-zzzz]" });
    expect(unknown.code).toBe("ref.unknown");
    expect(unknown.details).toEqual({ ref: "[SR-901/AK-zzzz]", criterion: "zzzz" });
    const twice = await resolveError(workspace, { ref: "[SR-903/AK-kred]" });
    expect(twice.code).toBe("ref.ambiguous");
    expect(twice.details).toMatchObject({
      criterion: "kred",
      criteria: [1, 2],
      candidates: [{ id: IDS.double, repository: "system" }],
    });
    const byNumber = await resolveError(workspace, { ref: "[SR-901/AK3]" });
    expect(byNumber.code).toBe("input.invalid");
    expect(byNumber.details).toMatchObject({ reason: "criterion-by-number", fields: ["ref"] });
    expect(byNumber.message).toContain("[SR-901/AK-k7f3]");
    const malformed = await resolveError(workspace, { ref: "SR-901/AK-x" });
    expect(malformed.details).toMatchObject({ reason: "criterion-malformed" });
    // An element without such a criterion: an element that is no requirement has none.
    expect((await resolveError(workspace, { ref: "[N-0e0008/AK-kred]" })).code).toBe("ref.unknown");
  });

  it("[SR-205/AK-ndnj] an unknown element part is ref.unknown, with the candidate of an outdated prefix (SR-060 AK3)", async () => {
    const workspace = await open();
    const error = await resolveError(workspace, { ref: "[N-0e0001/AK-kred]" });
    expect(error.code).toBe("ref.unknown");
    expect(error.message).toContain("did you mean SR-0e0001?");
    expect(error.details).toMatchObject({ candidates: [{ id: IDS.named }] });
  });
});

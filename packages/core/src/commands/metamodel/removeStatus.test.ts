// metamodel.removeStatus (SR-240 AK3) and the use rule of the frame (SR-236 AK7) as this command
// shows it, on the small model of the test helper. The rest of the frame for the status commands is
// in addStatus.test.ts.
import { describe, expect, it } from "vitest";
import removeStatus from "./removeStatus.js";
import type { CommandOutput } from "../../catalog.js";
import type { Workspace } from "../../runtime/workspace.js";
import {
  MODEL,
  SMALL_MODEL,
  WITH_MISSING_REPOSITORY,
  WORKSPACE_FILE,
  elementFile,
  elements,
  failure,
  openSmall,
  openSmallAcross,
  run,
  uuid,
} from "../metamodel-commands.test-helper.js";

/** The output as `invoke` gives it, with the answer sentence. */
type Removed = CommandOutput<"metamodel.removeStatus"> & { readonly answer: string };

const remove = (workspace: Workspace, type: string, status: string): Promise<Removed> =>
  run<Removed>(workspace, "metamodel.removeStatus", { type, status });

/** The small model without the status list of note, so note has every status. */
const NOTE_WITHOUT_LIST = SMALL_MODEL.replace("    statuses: [draft, noted]\n", "");

describe("metamodel.removeStatus removes a status from a type (SR-240 AK3)", () => {
  it("[SR-240/AK-pgn4] removes a status from the type's list, and its definition once no type has it", async () => {
    const files = { "filters/noted.yaml": "reqseq-filter: 1\nname: Noted\nwhere: { status: [noted] }\n" };
    const { workspace, read } = await openSmall({ ...files, ...elements([1, "note", { status: "draft" }]) });
    const removed = await remove(workspace, "note", "noted");
    expect(removed).toEqual({
      answer:
        "Removed the status noted from the type note; no type has it any more, so its definition went too; 1 file written; 1 file naming a removed key, not changed.",
      type: "note",
      status: "noted",
      removed: true,
      kept: [],
      mentions: ["filters/noted.yaml"],
      files: [MODEL],
      versionsChanged: 0,
      missingRequired: 0,
      versionsChangedElements: [],
      missingRequiredElements: [],
      problems: [],
    });
    expect(await read(MODEL)).toBe(
      SMALL_MODEL.replace("    statuses: [draft, noted]\n", "    statuses: [draft]\n").replace(
        "  - { key: noted, name: Noted }\n",
        "",
      ),
    );
    expect(await read("filters/noted.yaml")).toBe(files["filters/noted.yaml"]);
  });

  it("[SR-240/AK-pgn4] writes the list of the other statuses on a type without one, and keeps a definition another type has", async () => {
    const { workspace, read } = await openSmall({}, NOTE_WITHOUT_LIST);
    const removed = await remove(workspace, "note", "open");
    expect([removed.removed, removed.mentions]).toEqual([false, []]);
    expect(await read(MODEL)).toBe(
      NOTE_WITHOUT_LIST.replace(
        "    properties: [title, remark]\n    required: [title]\n",
        "    properties: [title, remark]\n    required: [title]\n    statuses: [draft, noted]\n",
      ),
    );
  });

  it("[SR-240/AK-pgn4] refuses while an element of the type or of a type that extends it has the status, and an inherited status", async () => {
    const { workspace, read } = await openSmall(
      elements([1, "risk", { status: "open" }], [2, "note", { status: "open" }]),
    );
    const used = await failure(workspace, "metamodel.removeStatus", { type: "hazard", status: "open" });
    expect([used.code, used.details]).toEqual([
      "input.invalid",
      { reason: "in-use", uses: [{ kind: "status", key: "open", count: 1, elements: ["RI-000001"] }] },
    ]);
    const inherited = await failure(workspace, "metamodel.removeStatus", { type: "risk", status: "open" });
    expect([inherited.code, inherited.details]).toEqual([
      "input.invalid",
      { reason: "inherited", type: "risk", status: "open", types: ["hazard"] },
    ]);
    expect(inherited.message).toContain("remove it there");
    expect(await read(MODEL)).toBe(SMALL_MODEL);
  });

  it("[SR-240/AK-pgn4] refuses a list that would give a type that extends it, with a list of its own, more statuses", async () => {
    const model = SMALL_MODEL.replace("    statuses: [draft, open]\n", "").replace(
      "    properties: [likelihood]\n",
      "    properties: [likelihood]\n    statuses: [noted]\n",
    );
    const { workspace, read } = await openSmall({}, model);
    const widened = await failure(workspace, "metamodel.removeStatus", { type: "hazard", status: "open" });
    expect(widened.details).toEqual({ reason: "widens", types: ["risk"] });
    expect(await read(MODEL)).toBe(model);
  });

  it("[SR-240/AK-pgn4] keeps the definition no type has any more while an element of any type has the status, and names their number", async () => {
    // An element of another type, and one in another repository of a type the metamodel does not know.
    const { workspace, read } = await openSmallAcross({
      [`system/elements/E-1.md`]: elementFile(uuid(1), "hazard", { status: "noted" }),
      [`product/E-2.md`]: elementFile(uuid(2), "memo", { status: "noted" }),
    });
    const removed = await remove(workspace, "note", "noted");
    expect(removed.answer).toBe(
      "Removed the status noted from the type note; no type has the status noted any more, but its definition stays, as 2 elements have it; 1 file written.",
    );
    expect([removed.removed, removed.kept, removed.mentions]).toEqual([
      false,
      [
        {
          kind: "status",
          key: "noted",
          count: 2,
          elements: [
            { id: uuid(1), shortId: "HZ-000001", repository: "system" },
            { id: uuid(2), shortId: "UNKNOWN-000002", repository: "product" },
          ],
        },
      ],
      [],
    ]);
    expect(await read(MODEL)).toBe(
      SMALL_MODEL.replace("    statuses: [draft, noted]\n", "    statuses: [draft]\n"),
    );
  });

  it("[SR-240/AK-pgn4] keeps the definition of the initial status when no type has it any more, and names the elements that have it", async () => {
    const model = SMALL_MODEL.replace("    statuses: [draft, open]\n", "    statuses: [open]\n");
    // The system requirement of the fixture, of a type the small model does not have, is a draft.
    const { workspace, read } = await openSmall({}, model);
    const removed = await remove(workspace, "note", "draft");
    expect([removed.removed, removed.kept, removed.answer]).toEqual([
      false,
      [
        {
          kind: "status",
          key: "draft",
          count: 1,
          elements: [
            { id: "e8df96ea-a168-4d90-8d65-6328cee88fb3", shortId: "UNKNOWN-e88fb3", repository: "system" },
          ],
        },
      ],
      "Removed the status draft from the type note; no type has the status draft any more, but its definition stays, as 1 element has it; 1 file written.",
    ]);
    expect(await read(MODEL)).toContain("  - { key: draft, name: Draft, initial: true }\n");
    // Without such an element it stays as well, and nothing is named.
    const { workspace: unused, read: readUnused } = await openSmall(
      {
        "requirements/SR-6328cee88fb3.md":
          "---\nid: e8df96ea-a168-4d90-8d65-6328cee88fb3\ntype: system-requirement\nstatus: open\ntitle: Show wind speed\n---\n",
      },
      model,
    );
    const quiet = await remove(unused, "note", "draft");
    expect([quiet.removed, quiet.kept]).toEqual([false, []]);
    expect(await readUnused(MODEL)).toContain("  - { key: draft, name: Draft, initial: true }\n");
  });

  it("removes a key the type's list has twice, and refuses an unknown type or status and a status the type does not have", async () => {
    const model = SMALL_MODEL.replace(
      "    statuses: [draft, noted]\n",
      "    statuses: [noted, draft, noted]\n",
    );
    const { workspace, read } = await openSmall({}, model);
    for (const [input, details] of [
      [
        { type: "nope", status: "open" },
        { reason: "unknown", type: "nope" },
      ],
      [
        { type: "note", status: "nope" },
        { reason: "unknown", type: "note", status: "nope" },
      ],
      [
        { type: "note", status: "open" },
        { reason: "not-had", type: "note", status: "open" },
      ],
    ] as const) {
      const refused = await failure(workspace, "metamodel.removeStatus", input);
      expect([refused.code, refused.details]).toEqual(["input.invalid", details]);
    }
    await remove(workspace, "note", "noted");
    expect(await read(MODEL)).toContain("    statuses: [draft]\n");
  });
});

describe("metamodel commands: what counts as the use of a status (SR-236 AK7)", () => {
  it("[SR-236/AK-bm7r] counts every element of the type and of the types that extend it with the status and names the first 20 by short ID", async () => {
    const list = Array.from(
      { length: 21 },
      (_, i) => [i + 1, i % 2 === 0 ? "hazard" : "risk", { status: "open" }] as const,
    );
    const { workspace, read } = await openSmall(elements(...list, [30, "note", { status: "open" }]));
    const used = await failure(workspace, "metamodel.removeStatus", { type: "hazard", status: "open" });
    const shown = list
      .map(([n, type]) => `${type === "hazard" ? "HZ" : "RI"}-${uuid(n).replaceAll("-", "").slice(-6)}`)
      .sort()
      .slice(0, 20);
    expect(used.details).toEqual({
      reason: "in-use",
      uses: [{ kind: "status", key: "open", count: 21, elements: shown }],
    });
    expect(used.message).toContain("status open: 21 elements (");
    expect(await read(MODEL)).toBe(SMALL_MODEL);
  });

  it("[SR-236/AK-bm7r] refuses while a repository of the workspace is not on this machine and names it", async () => {
    const { workspace, read } = await openSmall({ [WORKSPACE_FILE]: WITH_MISSING_REPOSITORY });
    const missing = await failure(workspace, "metamodel.removeStatus", { type: "note", status: "noted" });
    expect([missing.code, missing.details]).toEqual([
      "file.folder-missing",
      { command: "metamodel.removeStatus", repository: "product", repositories: ["product"] },
    ]);
    expect(await read(MODEL)).toBe(SMALL_MODEL);
  });
});

describe("the answer of metamodel.removeStatus", () => {
  it("names the status, the type, the files and the problems", () => {
    const output = {
      type: "note",
      status: "open",
      removed: false,
      kept: [],
      mentions: [],
      files: [MODEL],
      versionsChanged: 0,
      missingRequired: 0,
      problems: [{}],
    };
    expect(
      removeStatus.answer(output as never, { type: "note", status: "open" }, { type: (key) => key }),
    ).toBe("Removed the status open from the type note; 1 file written; 1 problem.");
  });
});

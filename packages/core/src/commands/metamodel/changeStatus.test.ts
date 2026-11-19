// metamodel.changeStatus (SR-240 AK2) on the small model of the test helper. The frame of the
// metamodel commands (SR-236) for the status commands is in addStatus.test.ts.
import { describe, expect, it } from "vitest";
import changeStatus from "./changeStatus.js";
import type { CommandOutput } from "../../catalog.js";
import type { Workspace } from "../../runtime/workspace.js";
import {
  MODEL,
  SMALL_MODEL,
  elements,
  failure,
  openSmall,
  run,
  uuid,
} from "../metamodel-commands.test-helper.js";

type Changed = CommandOutput<"metamodel.changeStatus">;

const change = (workspace: Workspace, input: Record<string, unknown>): Promise<Changed> =>
  run<Changed>(workspace, "metamodel.changeStatus", input);

describe("metamodel.changeStatus changes a status in place (SR-240 AK2)", () => {
  it("[SR-240/AK-kk0y] changes name, description and the invalid mark, names the elements with the status and changes no element", async () => {
    const files = elements([1, "hazard", { status: "open" }], [2, "note", { status: "open" }], [3, "note"]);
    const { workspace, read } = await openSmall(files);
    const changed = await change(workspace, {
      status: "open",
      name: "Opened",
      description: "Not done: yet",
      invalid: true,
    });
    expect(changed).toEqual({
      answer: "Changed the status Opened; 2 elements have this status; 1 file written.",
      status: { key: "open", name: "Opened", description: "Not done: yet", invalid: true },
      elements: 2,
      elementsWithStatus: [
        { id: uuid(1), shortId: "HZ-000001", repository: "system" },
        { id: uuid(2), shortId: "NO-000002", repository: "system" },
      ],
      files: [MODEL],
      versionsChanged: 0,
      missingRequired: 0,
      versionsChangedElements: [],
      missingRequiredElements: [],
      problems: [],
    });
    expect(await read(MODEL)).toBe(
      SMALL_MODEL.replace(
        "  - { key: open, name: Open }",
        '  - { key: open, name: Opened, description: "Not done: yet", invalid: true }',
      ),
    );
    for (const [file, text] of Object.entries(files)) {
      expect(await read(file)).toBe(text);
    }
    // Removing the mark and the description names the elements again; a name alone does not.
    const back = await change(workspace, { status: "open", invalid: false, description: null });
    expect([back.status, back.elements]).toEqual([{ key: "open", name: "Opened" }, 2]);
    expect((await change(workspace, { status: "open", name: "Open" })).elements).toBeUndefined();
    expect(await read(MODEL)).toBe(SMALL_MODEL);
  });

  it("[SR-240/AK-kk0y] moves the initial mark, so exactly one status has it, and no element changes its status", async () => {
    const files = elements([1, "hazard"]);
    const { workspace, read } = await openSmall(files);
    const changed = await change(workspace, { status: "open", initial: true });
    expect(changed).toMatchObject({
      answer: "Changed the status Open; draft is no longer the initial status; 1 file written.",
      status: { key: "open", name: "Open", initial: true },
      previousInitial: "draft",
    });
    expect(await read(MODEL)).toBe(
      SMALL_MODEL.replace(
        "  - { key: draft, name: Draft, initial: true }",
        "  - { key: draft, name: Draft }",
      ).replace("  - { key: open, name: Open }", "  - { key: open, name: Open, initial: true }"),
    );
    expect(await read(Object.keys(files)[0] ?? "")).toBe(Object.values(files)[0]);
    const got = await run<CommandOutput<"element.get">>(workspace, "element.get", { ref: uuid(1) });
    expect(got.element.status).toBe("draft");
    const meta = await run<CommandOutput<"metamodel.get">>(workspace, "metamodel.get", {});
    expect(meta.statuses.filter((s) => s.initial === true).map((s) => s.key)).toEqual(["open"]);
  });

  it("leaves a status that has the values already as it is, and refuses an unknown status", async () => {
    const { workspace, read } = await openSmall();
    const same = await change(workspace, { status: "draft", name: "Draft", initial: true, invalid: false });
    expect(same).toMatchObject({
      answer: "The status Draft has these values already; no file written.",
      files: [],
    });
    expect(await read(MODEL)).toBe(SMALL_MODEL);
    // A mark written as false is no mark: false changes nothing.
    const marked = await openSmall(
      {},
      SMALL_MODEL.replace("{ key: open, name: Open }", "{ key: open, name: Open, invalid: false }"),
    );
    expect((await change(marked.workspace, { status: "open", invalid: false })).files).toEqual([]);
    const unknown = await failure(workspace, "metamodel.changeStatus", { status: "nope", name: "Nope" });
    expect([unknown.code, unknown.details]).toEqual(["input.invalid", { reason: "unknown", status: "nope" }]);
  });
});

describe("the answer of metamodel.changeStatus", () => {
  it("names one element with the status and the problems", () => {
    const output = {
      status: { key: "open", name: "Open" },
      elements: 1,
      files: [MODEL],
      versionsChanged: 0,
      missingRequired: 0,
      problems: [{}],
    };
    expect(changeStatus.answer(output as never, { status: "open" }, { type: (key) => key })).toBe(
      "Changed the status Open; 1 element has this status; 1 file written; 1 problem.",
    );
  });
});

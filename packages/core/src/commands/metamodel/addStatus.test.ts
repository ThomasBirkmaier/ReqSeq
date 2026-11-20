// metamodel.addStatus (SR-240 AK1) on the small model of the test helper, and the frame of the
// metamodel commands (SR-236) as the status commands show it.
import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import addStatus from "./addStatus.js";
import type { CommandOutput } from "../../catalog.js";
import { Workspace } from "../../runtime/workspace.js";
import { MODEL, SMALL_MODEL, elements, failure, openSmall, run } from "../metamodel-commands.test-helper.js";

type Added = CommandOutput<"metamodel.addStatus">;

const add = (workspace: Workspace, input: Record<string, unknown>): Promise<Added> =>
  run<Added>(workspace, "metamodel.addStatus", input);

/** The small model without the status list of note, so note has every status. */
const NOTE_WITHOUT_LIST = SMALL_MODEL.replace("    statuses: [draft, noted]\n", "");

/** fixtures/SR-018/own-repository: types, properties and statuses in three files of the repository models. */
const own = async (
  files: Readonly<Record<string, string>> = {},
): Promise<{ readonly workspace: Workspace; readonly read: (file: string) => Promise<string> }> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-018/own-repository", files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(path.join(fixture.root, "system"));
  onTestFinished(() => workspace.close());
  return { workspace, read: (file) => fs.readFile(fixture.path(file), "utf8") };
};

const TYPES = "models/model/types.yaml";
const STATUSES = "models/model/statuses.yaml";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("metamodel.addStatus gives a type a status (SR-240 AK1)", () => {
  it("[SR-240/AK-s2fx] gives a type an existing status at the end of its own list, or a list of its own below an inherited one", async () => {
    const { workspace, read } = await openSmall();
    const added = await add(workspace, { type: "note", status: "open" });
    expect(added).toEqual({
      answer: "Added the status Open to the type note; 1 file written.",
      type: "note",
      status: { key: "open", name: "Open" },
      created: false,
      statuses: ["draft", "open", "noted"],
      alsoTypes: [],
      files: [MODEL],
      versionsChanged: 0,
      missingRequired: 0,
      versionsChangedElements: [],
      missingRequiredElements: [],
      problems: [],
    });
    // Risk inherits the list of hazard and gets one of its own, with only the new status.
    expect((await add(workspace, { type: "risk", status: "noted" })).statuses).toEqual([
      "draft",
      "open",
      "noted",
    ]);
    expect(await read(MODEL)).toBe(
      SMALL_MODEL.replace("    statuses: [draft, noted]\n", "    statuses: [draft, noted, open]\n").replace(
        "    properties: [likelihood]\n",
        "    properties: [likelihood]\n    statuses: [noted]\n",
      ),
    );
  });

  it("[SR-240/AK-s2fx] writes every status a type without a list had and the new one, and names the other types without a list", async () => {
    const model = NOTE_WITHOUT_LIST.replace(
      "properties:\n",
      "  - { key: memo, name: Memo, prefix: ME, properties: [title] }\nproperties:\n",
    );
    const { workspace, read } = await openSmall({}, model);
    const added = await add(workspace, { type: "note", name: "Archived", invalid: true });
    expect(added).toMatchObject({
      answer: "Added the new status Archived to the type note; the type memo has it too; 1 file written.",
      status: { key: "archived", name: "Archived", invalid: true },
      created: true,
      statuses: ["draft", "open", "noted", "archived"],
      alsoTypes: ["memo"],
    });
    expect(await read(MODEL)).toBe(
      `${model.replace(
        "    properties: [title, remark]\n    required: [title]\n",
        "    properties: [title, remark]\n    required: [title]\n    statuses: [draft, open, noted, archived]\n",
      )}  - key: archived\n    name: Archived\n    invalid: true\n`,
    );
    const meta = await run<CommandOutput<"metamodel.get">>(workspace, "metamodel.get", {});
    expect(meta.types.find((t) => t.key === "hazard")?.statuses).toEqual(["draft", "open"]);
  });

  it("[SR-240/AK-s2fx] refuses a status that would give a type that extends it, with a list of its own, more statuses, and names it", async () => {
    // Without a list of hazard, risk with its own list has only its own status.
    const model = SMALL_MODEL.replace("    statuses: [draft, open]\n", "").replace(
      "    properties: [likelihood]\n",
      "    properties: [likelihood]\n    statuses: [open]\n",
    );
    const { workspace, read } = await openSmall({}, model);
    const widened = await failure(workspace, "metamodel.addStatus", { type: "hazard", name: "Closed" });
    expect([widened.code, widened.details]).toEqual(["input.invalid", { reason: "widens", types: ["risk"] }]);
    expect(widened.message).toContain("type risk extends it");
    // Also a status added to an own list reaches the list of risk.
    const listed = await openSmall(
      {},
      SMALL_MODEL.replace(
        "    properties: [likelihood]\n",
        "    properties: [likelihood]\n    statuses: [open]\n",
      ),
    );
    const more = await failure(listed.workspace, "metamodel.addStatus", { type: "hazard", status: "noted" });
    expect(more.details).toEqual({ reason: "widens", types: ["risk"] });
    expect(await read(MODEL)).toBe(model);
  });

  it("refuses an unknown type or status, a status the type has, and an input that names both or neither", async () => {
    const { workspace, read } = await openSmall();
    const cases = [
      [
        { type: "nope", status: "open" },
        { reason: "unknown", type: "nope" },
      ],
      [
        { type: "note", status: "nope" },
        { reason: "unknown", status: "nope" },
      ],
      [
        { type: "risk", status: "open" },
        { reason: "has", type: "risk", status: "open" },
      ],
      [{ type: "note", status: "open", invalid: true }, { reason: "status-or-name" }],
      [{ type: "note" }, { reason: "status-or-name" }],
      [{ type: "note", key: "review" }, { reason: "status-or-name" }],
    ] as const;
    for (const [input, details] of cases) {
      const refused = await failure(workspace, "metamodel.addStatus", input);
      expect([refused.code, refused.details]).toEqual(["input.invalid", details]);
    }
    expect(await read(MODEL)).toBe(SMALL_MODEL);
  });

  it("[SR-240/AK-s2fx] gives a type in flow style that inherits a list a list of its own", async () => {
    const model = SMALL_MODEL.replace(
      "properties:\n",
      "  - { key: memo, name: Memo, prefix: ME, extends: hazard }\nproperties:\n",
    );
    const { workspace, read } = await openSmall({}, model);
    expect((await add(workspace, { type: "memo", status: "noted" })).statuses).toEqual([
      "draft",
      "open",
      "noted",
    ]);
    expect(await read(MODEL)).toBe(
      model.replace(
        "  - { key: memo, name: Memo, prefix: ME, extends: hazard }",
        "  - { key: memo, name: Memo, prefix: ME, extends: hazard, statuses: [noted] }",
      ),
    );
  });

  it("[SR-240/AK-s2fx] writes a key a list names already without a definition only once, and names the other types that get it", async () => {
    const model = SMALL_MODEL.replace(
      "    statuses: [draft, noted]\n",
      "    statuses: [draft, noted, review]\n",
    );
    const own = await openSmall({}, model);
    expect((await add(own.workspace, { type: "note", name: "Review" })).statuses).toEqual([
      "draft",
      "noted",
      "review",
    ]);
    expect(await own.read(MODEL)).toBe(`${model}  - key: review\n    name: Review\n`);
    const other = await openSmall({}, model);
    const added = await add(other.workspace, { type: "hazard", name: "Review" });
    expect(added).toMatchObject({
      alsoTypes: ["note"],
      answer: "Added the new status Review to the type hazard; the type note has it too; 1 file written.",
    });
  });
});

describe("metamodel commands: the frame as the status commands show it (SR-236)", () => {
  it("[SR-236/AK-sx7z] refuses a status change that would give the metamodel an error and names it; writes with warnings and names them", async () => {
    const { workspace, read } = await openSmall();
    const none = await failure(workspace, "metamodel.changeStatus", { status: "draft", initial: false });
    expect(none.details).toMatchObject({ reason: "metamodel-invalid" });
    expect(none.message).toContain("No status is initial");
    expect(await read(MODEL)).toBe(SMALL_MODEL);
    // An initial status marked invalid is only a warning: written, and named.
    const warned = await run<CommandOutput<"metamodel.changeStatus">>(workspace, "metamodel.changeStatus", {
      status: "draft",
      invalid: true,
    });
    expect(warned.problems.map((p) => [p.code, p.severity])).toEqual([["metamodel.invalid", "warning"]]);
    expect(warned).toMatchObject({ answer: expect.stringContaining("1 problem") as unknown });
  });

  it("[SR-236/AK-rk7z] refuses a status name another status has, also in another normal form, and writes nothing", async () => {
    const model = SMALL_MODEL.replace("{ key: noted, name: Noted }", "{ key: noted, name: Geprüft }");
    const { workspace, read } = await openSmall({}, model);
    const added = await failure(workspace, "metamodel.addStatus", { type: "hazard", name: "Geprüft" });
    expect([added.code, added.details]).toEqual([
      "input.invalid",
      { reason: "taken", field: "name", status: "noted" },
    ]);
    const key = await failure(workspace, "metamodel.addStatus", {
      type: "hazard",
      name: "Opened",
      key: "open",
    });
    expect(key.details).toEqual({ reason: "taken", field: "key", status: "open" });
    const changed = await failure(workspace, "metamodel.changeStatus", { status: "open", name: "Draft" });
    expect(changed.details).toEqual({ reason: "taken", field: "name", status: "draft" });
    expect(await read(MODEL)).toBe(model);
  });

  it("[SR-236/AK-k2s3] changes only the lines of the changed definitions, no element file and nothing in Git, and names the file", async () => {
    const files = elements([1, "hazard", { status: "open" }]);
    // The comment at the end of a changed line goes; the comment line above a removed definition too.
    const model = SMALL_MODEL.replace(
      "  - { key: open, name: Open }\n",
      "  - key: open\n    name: Open   # open ones\n",
    ).replace("  - { key: noted, name: Noted }\n", "  # noted ones\n  - { key: noted, name: Noted }\n");
    const { fixture, workspace, read } = await openSmall(files, model, { git: true });
    const head = await fixture.git(["rev-parse", "HEAD"]);
    const changed = await run<CommandOutput<"metamodel.changeStatus">>(workspace, "metamodel.changeStatus", {
      status: "open",
      name: "Opened",
    });
    expect(changed.files).toEqual([MODEL]);
    await run(workspace, "metamodel.removeStatus", { type: "note", status: "noted" });
    expect(await read(MODEL)).toBe(
      SMALL_MODEL.replace("  - { key: open, name: Open }\n", "  - key: open\n    name: Opened\n")
        .replace("  - { key: noted, name: Noted }\n", "")
        .replace("    statuses: [draft, noted]\n", "    statuses: [draft]\n"),
    );
    for (const [file, text] of Object.entries(files)) {
      expect(await read(file)).toBe(text);
    }
    expect(await fixture.git(["rev-parse", "HEAD"])).toBe(head);
    expect(await fixture.git(["status", "--porcelain"])).toBe(` M ${MODEL}\n`);
  });

  it("[SR-236/AK-yf6d] changes the file each definition is in, a new status in the first file with statuses, and puts back every file when one cannot be written", async () => {
    const { workspace, read } = await own();
    const before = [await read(TYPES), await read(STATUSES)];
    // The second write (types.yaml) fails, the first (statuses.yaml) is put back.
    const rename = fs.rename.bind(fs);
    let calls = 0;
    vi.spyOn(fs, "rename").mockImplementation(async (a, b) => {
      calls += 1;
      if (calls === 2) {
        throw Object.assign(new Error("EIO"), { code: "EIO" });
      }
      return rename(a, b);
    });
    const failed = await failure(workspace, "metamodel.addStatus", { type: "need", name: "Review" });
    expect([failed.code, failed.message]).toEqual(["internal", "Not written: model/types.yaml (EIO)"]);
    expect([await read(TYPES), await read(STATUSES)]).toEqual(before);
    vi.restoreAllMocks();

    const added = await add(workspace, { type: "need", name: "Review" });
    expect(added.files).toEqual(["../models/model/statuses.yaml", "../models/model/types.yaml"]);
    expect(await read(STATUSES)).toBe(`${String(before[1])}  - key: review\n    name: Review\n`);
    expect(await read(TYPES)).toContain(
      "    properties: [title]\n    required: [title]\n    statuses: [draft, accepted, review]\n  - key: system-requirement\n",
    );
  });

  it("[SR-236/AK-cv7t] refuses on a read-only metamodel repository, a metamodel that does not read and a definition with a YAML anchor or alias, with file and line, and writes nothing", async () => {
    const readOnly = await own();
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "linux" });
    onTestFinished(() => {
      if (platform !== undefined) {
        Object.defineProperty(process, "platform", platform);
      }
    });
    const access = fs.access.bind(fs);
    vi.spyOn(fs, "access").mockImplementation((target, mode) =>
      String(target).endsWith(`${path.sep}models`)
        ? Promise.reject(Object.assign(new Error("EROFS"), { code: "EROFS" }))
        : access(target, mode),
    );
    for (const [command, input] of [
      ["metamodel.addStatus", { type: "need", name: "Review" }],
      ["metamodel.changeStatus", { status: "accepted", name: "Agreed" }],
      ["metamodel.removeStatus", { type: "need", status: "accepted" }],
    ] as const) {
      const denied = await failure(readOnly.workspace, command, input);
      expect([denied.code, denied.details]).toEqual(["file.read-only", { repository: "models" }]);
    }
    vi.restoreAllMocks();

    const faulty = await own({ [STATUSES]: "reqseq-metamodel: 1\nstatuses: [\n" });
    const unreadable = await failure(faulty.workspace, "metamodel.changeStatus", {
      status: "draft",
      name: "New",
    });
    expect(unreadable.code).toBe("workspace.read-only");

    const anchored = SMALL_MODEL.replace("    name: Note\n", "    name: &n Note\n").replace(
      "  - { key: open, name: Open }",
      "  - { key: open, name: &o Open }",
    );
    const { workspace, read } = await openSmall({}, anchored);
    for (const [command, input, line] of [
      ["metamodel.addStatus", { type: "note", status: "open" }, 16],
      ["metamodel.removeStatus", { type: "note", status: "noted" }, 16],
      ["metamodel.changeStatus", { status: "open", description: "Not closed" }, 38],
    ] as const) {
      const shared = await failure(workspace, command, input);
      expect([shared.code, shared.details]).toEqual([
        "file.faulty",
        { file: MODEL, line, repository: "system" },
      ]);
    }
    expect(await read(MODEL)).toBe(anchored);
  });

  it("[SR-236/AK-n13v] makes the key of a new status from the name, or refuses and asks for one; a given key is taken as it is", async () => {
    const { workspace } = await openSmall();
    expect((await add(workspace, { type: "note", name: "Über prüft 2" })).status.key).toBe("ueber-prueft-2");
    expect((await add(workspace, { type: "note", name: "Validé" })).status.key).toBe("valide");
    expect((await add(workspace, { type: "note", name: "Held", key: "on-hold" })).status.key).toBe("on-hold");
    for (const [name, key, why] of [
      ["2nd look", "2nd-look", "does not start with a letter"],
      ["***", "", "is empty"],
      [`R${"x".repeat(64)}`, `r${"x".repeat(64)}`, "is longer than 64 characters"],
      ["OPEN!", "open", "is already the key of a status"],
    ] as const) {
      const refused = await failure(workspace, "metamodel.addStatus", { type: "note", name });
      expect([refused.code, refused.details]).toEqual(["input.invalid", { reason: "key-required", key }]);
      expect(refused.message).toContain(why);
    }
  });

  it("[SR-236/AK-drrw] works with the new statuses at once in the same process, and counts no element as changed", async () => {
    const { workspace } = await openSmall(elements([1, "note"]));
    await run(workspace, "metamodel.get", {});
    const added = await add(workspace, { type: "note", name: "Archived" });
    expect([added.versionsChanged, added.missingRequired]).toEqual([0, 0]);
    const changed = await run<CommandOutput<"metamodel.changeStatus">>(workspace, "metamodel.changeStatus", {
      status: "archived",
      initial: true,
    });
    expect([changed.versionsChanged, changed.missingRequired]).toEqual([0, 0]);
    const created = await run<CommandOutput<"element.create">>(workspace, "element.create", {
      type: "note",
      title: "New",
    });
    expect(created.element.status).toBe("archived");
  });

  it("[SR-236/AK-jskb] runs calls that arrive at the same time one after the other, each on the metamodel the one before wrote", async () => {
    const { workspace, read } = await openSmall();
    const results = await Promise.allSettled([
      add(workspace, { type: "note", name: "Review" }),
      add(workspace, { type: "hazard", status: "review" }),
      add(workspace, { type: "risk", name: "Review" }),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled", "rejected"]);
    expect((results[2] as PromiseRejectedResult).reason).toMatchObject({
      details: { reason: "taken", field: "name" },
    });
    const text = await read(MODEL);
    expect(text).toContain("    statuses: [draft, open, review]\n");
    expect(text).toContain("    statuses: [draft, noted, review]\n");
  });

  it("[SR-236/AK-rtcn] writes the same bytes and gives the same output for the same input and metamodel", async () => {
    for (const [command, input] of [
      ["metamodel.addStatus", { type: "note", name: "Review" }],
      ["metamodel.changeStatus", { status: "open", initial: true, invalid: true }],
      ["metamodel.removeStatus", { type: "note", status: "noted" }],
    ] as const) {
      const first = await openSmall();
      const second = await openSmall();
      expect(await run(first.workspace, command, input)).toEqual(await run(second.workspace, command, input));
      expect(await first.read(MODEL)).toBe(await second.read(MODEL));
    }
  });
});

describe("the answer of metamodel.addStatus", () => {
  it("names the status, the type, the other types, the files, the elements and the problems", () => {
    const output = {
      type: "note",
      status: { key: "review", name: "Review" },
      created: true,
      statuses: [],
      alsoTypes: ["memo", "risk"],
      files: [MODEL],
      versionsChanged: 2,
      missingRequired: 0,
      problems: [{}],
    };
    expect(
      addStatus.answer(output as never, { type: "note" }, { type: (key) => key, element: (ref) => ref }),
    ).toBe(
      "Added the new status Review to the type note; the types memo and risk have it too; 1 file written; 2 elements with another version; 1 problem.",
    );
  });
});

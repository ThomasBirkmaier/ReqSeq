import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { metamodelState } from "../../metamodel/index.js";
import { elementStoreState, loadElements } from "../../model/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
import { workspaceLayoutState } from "../../workspace/index.js";

// The runtime adds the answer to every output (SR-224).
type Output = CommandOutput<"element.setStatus"> & { readonly answer: string };

/** The elements of fixtures/SR-017/own-statuses. */
const WIND = { id: "e8df96ea-a168-4d90-8d65-6328cee88fb3", file: "requirements/REQ-6328cee88fb3.md" };
const GUSTS = { id: "3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c", file: "requirements/REQ-1d2e3f4a5b6c.md" };
const BARE = { id: "0b7c6e1a-1111-4222-8333-444455556666", file: "requirements/REQ-444455556666.md" };
const FILES = [WIND.file, GUSTS.file, BARE.file];

/** The statuses of the fixture's metamodel, in metamodel order; none of the standard model's. */
const OWN_STATUSES = ["proposed", "in-review", "released", "in-change", "withdrawn"];

/** The statuses as a refusal lists them: key and display name (ThomasBirkmaier/ReqSeq-archive#309). */
const OWN_LISTED =
  "proposed (Proposed), in-review (In Review), released (Released), in-change (In Change), withdrawn (Withdrawn)";

interface Opened {
  readonly fixture: FixtureWorkspace;
  readonly workspace: Workspace;
}

const open = async (fixtureName = "SR-017/own-statuses"): Promise<Opened> => {
  const fixture = await createFixtureWorkspace({ fixture: fixtureName });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const setStatus = async (opened: Opened, input: Record<string, unknown>): Promise<Output> =>
  (await invoke("element.setStatus", input, { workspace: opened.workspace })) as Output;

const setStatusError = async (opened: Opened, input: Record<string, unknown>): Promise<CommandError> => {
  try {
    await setStatus(opened, input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected element.setStatus to fail");
};

const read = (opened: Opened, file: string): Promise<string> =>
  fs.readFile(opened.fixture.path(file), "utf8");

const readAll = async (opened: Opened, files: readonly string[]): Promise<string[]> =>
  Promise.all(files.map((file) => read(opened, file)));

/** The status of every element as the element store reads it again. */
const statuses = async (opened: Opened): Promise<Record<string, unknown>> =>
  Object.fromEntries(
    (await opened.workspace.get(elementStoreState)).elements.map((e) => [e.id, e.data["status"]]),
  );

describe("element.setStatus offers only the statuses of the metamodel (SR-017)", () => {
  it("[SR-017/AK-h2n4] offers exactly the metamodel's own statuses and sets each of them", async () => {
    const opened = await open();
    const metamodel = (await invoke(
      "metamodel.get",
      {},
      { workspace: opened.workspace },
    )) as CommandOutput<"metamodel.get">;
    expect(metamodel.statuses.map((s) => s.key)).toEqual(OWN_STATUSES);
    for (const status of OWN_STATUSES) {
      const out = await setStatus(opened, { refs: [WIND.id], status });
      expect(out).toEqual({
        answer:
          status === "proposed"
            ? "No element changed its status."
            : `Set the status of 1 element to ${status}.`,
        files: status === "proposed" ? [] : [WIND.file],
        problems: [],
      });
      expect((await statuses(opened))[WIND.id]).toBe(status);
    }
  });

  it("[SR-017/AK-h2n4] refuses a value that is not a status of the metamodel and writes no file", async () => {
    const opened = await open();
    const before = await readAll(opened, FILES);
    // `approved` and `draft` are statuses of the standard model, not of this metamodel.
    for (const status of ["approved", "draft", "nope"]) {
      const error = await setStatusError(opened, { refs: [WIND.id, GUSTS.id, BARE.id], status });
      expect([error.code, error.details]).toEqual([
        "input.invalid",
        { status, reason: "unknown-status", allowed: OWN_STATUSES },
      ]);
      expect(error.message).toBe(
        `${status} is not a status of the metamodel; the statuses are: ${OWN_LISTED}`,
      );
    }
    expect(await readAll(opened, FILES)).toEqual(before);
  });

  it("[SR-017/AK-h2n4] takes the display name of a status in any case and writes its key (ThomasBirkmaier/ReqSeq-archive#309)", async () => {
    const opened = await open();
    for (const [given, key] of [
      ["Released", "released"],
      ["in review", "in-review"],
      ["IN CHANGE", "in-change"],
      ["Withdrawn", "withdrawn"],
      ["PROPOSED", "proposed"],
    ] as const) {
      await setStatus(opened, { refs: [WIND.id], status: given });
      expect((await statuses(opened))[WIND.id]).toBe(key);
      expect(await read(opened, WIND.file)).toContain(`\nstatus: ${key}\n`);
    }
  });

  it("[SR-017/AK-h2n4] refuses a name that two statuses share, with the statuses to choose from (ThomasBirkmaier/ReqSeq-archive#309)", async () => {
    const opened = await open();
    const model = opened.fixture.path("metamodel/model.yaml");
    await fs.writeFile(
      model,
      (await fs.readFile(model, "utf8")).replace(
        "{ key: in-change, name: In Change }",
        "{ key: in-change, name: Released }",
      ),
    );
    const before = await readAll(opened, FILES);
    const error = await setStatusError(opened, { refs: [WIND.id], status: "RELEASED" });
    expect([error.code, error.details]).toEqual([
      "input.invalid",
      {
        status: "RELEASED",
        reason: "ambiguous-status",
        allowed: OWN_STATUSES,
        candidates: ["released", "in-change"],
      },
    ]);
    expect(error.message).toMatch(
      /^RELEASED names more than one status of the metamodel \(released, in-change\); give the key\./,
    );
    expect(await readAll(opened, FILES)).toEqual(before);
    // The key itself is never ambiguous.
    await setStatus(opened, { refs: [WIND.id], status: "released" });
    expect((await statuses(opened))[WIND.id]).toBe("released");
  });

  it("offers the standard model's statuses in a workspace with the standard model", async () => {
    const opened = await open("SR-001/two-elements");
    const metamodel = (await invoke(
      "metamodel.get",
      {},
      { workspace: opened.workspace },
    )) as CommandOutput<"metamodel.get">;
    expect(metamodel.statuses.map((s) => s.key)).toEqual(["draft", "approved", "obsolete"]);
    const error = await setStatusError(opened, { refs: ["SR-e88fb3"], status: "released" });
    expect(error.details).toEqual({
      status: "released",
      reason: "unknown-status",
      allowed: ["draft", "approved", "obsolete"],
    });
    const set = await setStatus(opened, { refs: ["SR-e88fb3"], status: "approved" });
    expect([set.answer, set.files, set.problems?.map((p) => p.code)]).toEqual([
      "Set the status of 1 element to approved; 2 problems.",
      ["requirements/SR-6328cee88fb3.md"],
      ["element.missing-required", "element.missing-required"],
    ]);
  });

  it("[SR-002/AK-b8j5] keeps the UUID and the file name when the status changes", async () => {
    const opened = await open();
    await setStatus(opened, { refs: [WIND.id, GUSTS.id], status: "in-change" });
    const store = await opened.workspace.get(elementStoreState);
    for (const { id, file } of [WIND, GUSTS]) {
      const records = store.byId.get(id) ?? [];
      expect(records.map((r) => [r.id, r.file, r.data["status"]])).toEqual([[id, file, "in-change"]]);
    }
    expect(store.elements.map((e) => e.file).sort()).toEqual([...FILES].sort());
  });

  it("[SR-016/AK-k7rx] refuses an element of an unknown type, also next to a writable one, and writes no file", async () => {
    const opened = await open("SR-016/unknown");
    const files = ["requirements/X-0f6a7b8c9d0e.md", "requirements/SR-4c1e0d3a9b21.md"];
    const before = await readAll(opened, files);
    const gadget = "2c9e4b71-6d58-4f03-a1e7-0f6a7b8c9d0e";
    for (const refs of [[gadget], ["7a5d2f10-3c4b-4e8f-9a61-4c1e0d3a9b21", gadget]]) {
      const error = await setStatusError(opened, { refs, status: "draft" });
      expect([error.code, error.details]).toEqual([
        "element.read-only",
        { id: gadget, type: "gadget", reason: "unknown-type" },
      ]);
    }
    expect(await readAll(opened, files)).toEqual(before);
  });
});

describe("element.setStatus writes only the status", () => {
  it("rewrites only the status line; comments, quoting, key order and text stay", async () => {
    const opened = await open();
    const before = await read(opened, GUSTS.file);
    expect(await setStatus(opened, { refs: ["REQ-4a5b6c"], status: "in-change" })).toEqual({
      answer: "Set the status of 1 element to in-change.",
      files: [GUSTS.file],
      problems: [],
    });
    const after = await read(opened, GUSTS.file);
    const changed = before.split("\n").filter((line) => !after.split("\n").includes(line));
    expect(changed).toEqual(['status: "released"              # after the CCB of week 12']);
    expect(after.split("\n").filter((line) => !before.split("\n").includes(line))).toHaveLength(1);
    expect(after).toBe(
      before.replace(
        'status: "released"              # after the CCB of week 12',
        "status: in-change              # after the CCB of week 12",
      ),
    );
  });

  it("adds a missing status key and writes each element once", async () => {
    const opened = await open();
    const out = await setStatus(opened, {
      refs: [BARE.id, "REQ-556666", WIND.id, BARE.id],
      status: "in-review",
    });
    expect(out).toEqual({
      answer: "Set the status of 2 elements to in-review.",
      files: [BARE.file, WIND.file],
      problems: [],
    });
    expect(await read(opened, BARE.file)).toBe(
      `---\nid: ${BARE.id}\ntype: requirement\ntitle: No status yet\nstatus: in-review\n---\n`,
    );
    expect(await statuses(opened)).toEqual({
      [WIND.id]: "in-review",
      [GUSTS.id]: "released",
      [BARE.id]: "in-review",
    });
  });

  it("writes nothing when the status is already set or no element is given", async () => {
    const opened = await open();
    const before = await readAll(opened, FILES);
    expect(await setStatus(opened, { refs: [WIND.id], status: "proposed" })).toEqual({
      answer: "No element changed its status.",
      files: [],
      problems: [],
    });
    expect(await setStatus(opened, { refs: [GUSTS.id], status: "released" })).toEqual({
      answer: "No element changed its status.",
      files: [],
      problems: [],
    });
    expect(await setStatus(opened, { refs: [], status: "released" })).toEqual({
      answer: "No element changed its status.",
      files: [],
      problems: [],
    });
    expect(await readAll(opened, FILES)).toEqual(before);
  });

  it("refuses unknown references before it writes anything", async () => {
    const opened = await open();
    const before = await readAll(opened, FILES);
    const error = await setStatusError(opened, { refs: [WIND.id, "REQ-ffffff"], status: "released" });
    expect(error.code).toBe("ref.unknown");
    expect(await readAll(opened, FILES)).toEqual(before);
  });

  it("refuses all elements when one file changed on disk since it was read, and reads it again", async () => {
    const opened = await open();
    await opened.workspace.get(elementStoreState);
    const changed = (await read(opened, GUSTS.file)).replace("Show gusts", "Changed elsewhere");
    await fs.writeFile(opened.fixture.path(GUSTS.file), changed);
    const wind = await read(opened, WIND.file);
    const error = await setStatusError(opened, { refs: [WIND.id, GUSTS.id], status: "in-review" });
    expect([error.code, error.details]).toEqual([
      "file.changed-on-disk",
      { file: GUSTS.file, repository: "system" },
    ]);
    expect(await readAll(opened, [WIND.file, GUSTS.file])).toEqual([wind, changed]);
    expect(await setStatus(opened, { refs: [WIND.id, GUSTS.id], status: "in-review" })).toEqual({
      answer: "Set the status of 2 elements to in-review.",
      files: [WIND.file, GUSTS.file],
      problems: [],
    });
  });

  it("refuses a file that was removed since it was read", async () => {
    const opened = await open();
    await opened.workspace.get(elementStoreState);
    await fs.rm(opened.fixture.path(WIND.file));
    const error = await setStatusError(opened, { refs: [WIND.id], status: "released" });
    expect(error.code).toBe("file.changed-on-disk");
  });

  it("updates the element store in place, equal to a full read, without reading other files (ThomasBirkmaier/ReqSeq-archive#166)", async () => {
    const opened = await open();
    const store = await opened.workspace.get(elementStoreState);
    await opened.workspace.get(metamodelState);
    const reads = vi.spyOn(fs, "readFile");
    onTestFinished(() => {
      reads.mockRestore();
    });
    await setStatus(opened, { refs: [WIND.id, BARE.id], status: "in-change" });
    // Each written file only: read before the write and checked by the write itself.
    expect(reads.mock.calls.map(([file]) => path.basename(file as string))).toEqual([
      path.basename(WIND.file),
      path.basename(BARE.file),
      path.basename(WIND.file),
      path.basename(BARE.file),
    ]);
    reads.mockRestore();
    const now = await opened.workspace.peek(elementStoreState);
    expect(now).toBeDefined();
    expect(now).not.toBe(store);
    expect(now?.byId.get(GUSTS.id)?.[0]).toBe(store.byId.get(GUSTS.id)?.[0]);
    expect(now?.byId.get(WIND.id)?.[0]?.data["status"]).toBe("in-change");
    expect(now).toEqual(
      await loadElements(await opened.workspace.get(workspaceLayoutState), undefined, {
        versioning: now?.versioning,
      }),
    );
  });

  it("writes the first file back when a later one is refused at write time (read-only)", async () => {
    const opened = await open();
    const before = await readAll(opened, FILES);
    await fs.chmod(opened.fixture.path(BARE.file), 0o444);
    onTestFinished(() => fs.chmod(opened.fixture.path(BARE.file), 0o644));
    const error = await setStatusError(opened, { refs: [WIND.id, BARE.id], status: "released" });
    // Every file could be restored, so the error is the writer's as it is, without `written`.
    expect(error.code).toBe("file.read-only");
    expect(error.details).toBeUndefined();
    expect(await readAll(opened, FILES)).toEqual(before);
    // The store was reset and reads the restored files again.
    expect(await statuses(opened)).toEqual({ [WIND.id]: "proposed", [GUSTS.id]: "released" });
    await fs.chmod(opened.fixture.path(BARE.file), 0o644);
    expect(await setStatus(opened, { refs: [WIND.id, BARE.id], status: "released" })).toEqual({
      answer: "Set the status of 2 elements to released.",
      files: [WIND.file, BARE.file],
      problems: [],
    });
  });
});

describe("element.setStatus names the required properties without a value (SR-243 AK4)", () => {
  /** A third element of fixtures/SR-001/two-elements: no status, an empty and an absent required property. */
  const RAIN = {
    id: "5a6b7c8d-1111-4222-8333-0a0b0c0d0e0f",
    file: "requirements/SR-0a0b0c0d0e0f.md",
    content:
      "---\nid: 5a6b7c8d-1111-4222-8333-0a0b0c0d0e0f\ntype: system-requirement\ntitle: Show rain\nrequirement-type:\n---\n\nThe station shows the rain.\n",
  };
  const WIND_ID = "e8df96ea-a168-4d90-8d65-6328cee88fb3";
  const GUSTS_ID = "3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c";

  const opened = async (): Promise<Opened> => {
    const fixture = await createFixtureWorkspace({
      fixture: "SR-001/two-elements",
      files: { [RAIN.file]: RAIN.content },
    });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    return { fixture, workspace };
  };

  /** Each problem as element, code, key and line. */
  const named = (output: Output): unknown[] =>
    (output.problems ?? []).map((p) => [p.elementId, p.code, p.severity, p.key, p.line]);

  it("[SR-243/AK-h5mc] sets the status and names every required property without a value of each element", async () => {
    const ws = await opened();
    const refs = [WIND_ID, GUSTS_ID, RAIN.id];
    const set = await setStatus(ws, { refs, status: "approved" });
    expect(set.files).toEqual([
      "requirements/SR-6328cee88fb3.md",
      "requirements/SR-1d2e3f4a5b6c.md",
      RAIN.file,
    ]);
    // The line of the empty key, in the file as written.
    const rain = (await read(ws, RAIN.file)).split("\n");
    const line = rain.indexOf("requirement-type:") + 1;
    const missing = [
      [WIND_ID, "element.missing-required", "warning", "requirement-type", undefined],
      [WIND_ID, "element.missing-required", "warning", "acceptance-criteria", undefined],
      [RAIN.id, "element.missing-required", "warning", "requirement-type", line],
      [RAIN.id, "element.missing-required", "warning", "acceptance-criteria", undefined],
    ];
    expect(named(set)).toEqual(missing);
    expect(set.answer).toBe("Set the status of 3 elements to approved; 4 problems.");
    // The file was just written, so the message does not say that no file changes.
    expect(set.problems?.[0]?.message).toBe(
      "Required property Requirement Type (requirement-type) of type System Requirement (system-requirement) has no value",
    );
    // The status is set already: no file is written, the properties are still named.
    const again = await setStatus(ws, { refs, status: "approved" });
    expect([again.files, named(again)]).toEqual([[], missing]);
    // An element whose required properties all have a value gives none.
    expect(await setStatus(ws, { refs: [GUSTS_ID], status: "draft" })).toEqual({
      answer: "Set the status of 1 element to draft.",
      files: ["requirements/SR-1d2e3f4a5b6c.md"],
      problems: [],
    });
  });

  it("[SR-243/AK-h5mc] names them before the hints of a status marked invalid (SR-072 AK2)", async () => {
    const ws = await opened();
    const set = await setStatus(ws, { refs: [WIND_ID], status: "obsolete" });
    expect((set.problems ?? []).map((p) => [p.code, p.elementId, p.key])).toEqual([
      ["element.missing-required", WIND_ID, "requirement-type"],
      ["element.missing-required", WIND_ID, "acceptance-criteria"],
      ["relation.target-superseded", GUSTS_ID, "derives-from"],
    ]);
  });
});

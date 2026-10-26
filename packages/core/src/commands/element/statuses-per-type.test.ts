// Statuses per type (#306): element.create, element.setStatus and element.supersede offer and take
// only the statuses of the element's type; a type without status gets none.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

/** Elements of fixtures/enabler-306/statuses-per-type. */
const NEED = "elements/N-000000aaa001.md";
const SR_DRAFT = "elements/SR-000000bbb001.md";
const SR_ACCEPTED = "elements/SR-000000bbb002.md";
const SSR = "elements/SSR-000000ccc001.md";
const DECISION = "elements/D-000000ddd001.md";
const TERM = "elements/T-000000eee001.md";

interface Opened {
  readonly fixture: FixtureWorkspace;
  readonly workspace: Workspace;
}

const open = async (files: Readonly<Record<string, string>> = {}): Promise<Opened> => {
  const fixture = await createFixtureWorkspace({ fixture: "enabler-306/statuses-per-type", files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const read = (opened: Opened, file: string): Promise<string> =>
  fs.readFile(opened.fixture.path(file), "utf8");

const errorOf = async (run: () => Promise<unknown>): Promise<CommandError> => {
  try {
    await run();
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the command to fail");
};

const create = async (opened: Opened, type: string): Promise<CommandOutput<"element.create">> =>
  (await invoke(
    "element.create",
    { type, title: `A new ${type}`, folder: "elements" },
    { workspace: opened.workspace },
  )) as CommandOutput<"element.create">;

const setStatus = (opened: Opened, refs: readonly string[], status: string): Promise<unknown> =>
  invoke("element.setStatus", { refs, status }, { workspace: opened.workspace });

const supersede = (opened: Opened, input: Record<string, unknown>): Promise<unknown> =>
  invoke("element.supersede", input, { workspace: opened.workspace });

describe("element.create with statuses per type (#306)", () => {
  it("gives a new element the initial status when its type has it, also a type without a list", async () => {
    const opened = await open();
    const need = await create(opened, "need");
    const requirement = await create(opened, "requirement");
    expect([need.element.status, requirement.element.status]).toEqual(["draft", "draft"]);
    expect(await read(opened, requirement.element.file)).toMatch(
      /^---\nid: [0-9a-f-]+\ntype: requirement\nstatus: draft\n/,
    );
  });

  it("gives the first status of the type in metamodel order when the type does not have the initial one", async () => {
    const opened = await open();
    const decision = await create(opened, "decision");
    expect(decision.element.status).toBe("accepted");
    expect(decision.problems).toEqual([]);
  });

  it("never gives a new element an invalid status: it skips them, and refuses a type with only invalid ones", async () => {
    const model = await fs.readFile(
      new URL("../../../../../fixtures/enabler-306/statuses-per-type/metamodel/model.yaml", import.meta.url),
      "utf8",
    );
    // `superseded` (invalid) comes before `archived` in the metamodel's statuses.
    const opened = await open({
      "metamodel/model.yaml": model
        .replace(
          "properties:\n  - key: title",
          "  - { key: ruling, name: Ruling, prefix: RUL, properties: [title], statuses: [archived, superseded] }\n  - { key: tombstone, name: Tombstone, prefix: TS, properties: [title], statuses: [obsolete, superseded] }\n\nproperties:\n  - key: title",
        )
        .replace(
          "  - { key: superseded, name: Superseded, invalid: true }\n",
          "  - { key: superseded, name: Superseded, invalid: true }\n  - { key: archived, name: Archived }\n",
        ),
    });
    const metamodel = (await invoke(
      "metamodel.get",
      {},
      { workspace: opened.workspace },
    )) as CommandOutput<"metamodel.get">;
    expect(metamodel.problems).toEqual([
      {
        code: "metamodel.invalid",
        severity: "warning",
        repository: "system",
        message:
          "Type tombstone has only statuses marked invalid (obsolete, superseded); element.create refuses new elements of it, as they would be superseded at once",
        file: "metamodel/model.yaml",
        line: 34,
      },
    ]);
    const ruling = (await invoke(
      "element.create",
      { type: "ruling", title: "A ruling", folder: "elements" },
      { workspace: opened.workspace },
    )) as CommandOutput<"element.create">;
    expect(ruling.element.status).toBe("archived");
    const error = await errorOf(() =>
      invoke(
        "element.create",
        { type: "tombstone", title: "Gone", folder: "elements" },
        { workspace: opened.workspace },
      ),
    );
    expect(error.toJSON()).toEqual({
      code: "input.invalid",
      message:
        "Type Tombstone (tombstone) has only statuses marked invalid, so a new element of it would be superseded at once; give the type a status that is not invalid",
      details: { type: "tombstone", reason: "initial-status", statuses: ["obsolete", "superseded"] },
    });
  });

  it("writes no status for a type without status and gives no hint", async () => {
    const opened = await open();
    const term = await create(opened, "term");
    expect(term.element).not.toHaveProperty("status");
    expect(term.problems).toEqual([]);
    expect(await read(opened, term.element.file)).toMatch(
      new RegExp(`^---\nid: ${term.element.id}\ntype: term\ntitle: A new term\n---\n`),
    );
  });
});

describe("element.setStatus with statuses per type (#306)", () => {
  it("sets a status of the type, also one it inherits or adds to its parent's", async () => {
    const opened = await open();
    await setStatus(opened, ["SR-bbb001", "SSR-ccc001"], "obsolete");
    await setStatus(opened, ["N-aaa001"], "accepted");
    expect(await read(opened, SR_DRAFT)).toContain("status: obsolete\n");
    expect(await read(opened, SSR)).toContain("status: obsolete\n");
    expect(await read(opened, NEED)).toContain("status: accepted\n");
  });

  it("refuses a status of the metamodel that the type does not have, before any file is written", async () => {
    const opened = await open();
    const before = await Promise.all([SR_DRAFT, DECISION].map((f) => read(opened, f)));
    const error = await errorOf(() => setStatus(opened, ["D-ddd001", "SR-bbb001"], "Accepted"));
    expect(error.toJSON()).toEqual({
      code: "input.invalid",
      message:
        "accepted is not a status of type Requirement (requirement) of SR-bbb001; its statuses are: draft (Draft), obsolete (Obsolete)",
      details: {
        ref: "SR-bbb001",
        type: "requirement",
        status: "accepted",
        allowed: ["draft", "obsolete"],
        reason: "status-not-allowed",
      },
    });
    expect(await Promise.all([SR_DRAFT, DECISION].map((f) => read(opened, f)))).toEqual(before);
  });

  it("refuses any status for an element of a type without status", async () => {
    const opened = await open();
    const before = await read(opened, TERM);
    const error = await errorOf(() => setStatus(opened, ["T-eee001"], "draft"));
    expect(error.toJSON()).toEqual({
      code: "input.invalid",
      message: "Type Glossary Term (term) has no status, so T-eee001 cannot get one",
      details: { ref: "T-eee001", type: "term", status: "draft", allowed: [], reason: "type-without-status" },
    });
    expect(await read(opened, TERM)).toBe(before);
  });

  it("still refuses a value that is no status of the metamodel with every status", async () => {
    const opened = await open();
    const error = await errorOf(() => setStatus(opened, ["T-eee001"], "frozen"));
    expect(error.details).toMatchObject({
      reason: "unknown-status",
      allowed: ["draft", "approved", "accepted", "obsolete", "superseded"],
    });
  });
});

describe("element.supersede with statuses per type (#306)", () => {
  it("takes an invalid status of the type and names the type when refusing another one", async () => {
    const opened = await open();
    const before = await read(opened, DECISION);
    const error = await errorOf(() => supersede(opened, { ref: "D-ddd001", status: "obsolete" }));
    expect(error.toJSON()).toEqual({
      code: "input.invalid",
      message:
        "obsolete is not a status of type Decision (decision) of D-ddd001; the invalid statuses of type Decision (decision) are: superseded (Superseded)",
      details: {
        ref: "D-ddd001",
        type: "decision",
        status: "obsolete",
        reason: "status-not-allowed",
        allowed: ["superseded"],
      },
    });
    expect(await read(opened, DECISION)).toBe(before);
    await supersede(opened, { ref: "D-ddd001", status: "superseded" });
    expect(await read(opened, DECISION)).toBe(before.replace("status: accepted", "status: superseded"));
  });

  it("lists only the type's invalid statuses for a status that is not invalid or unknown", async () => {
    const opened = await open();
    const notInvalid = await errorOf(() => supersede(opened, { ref: "SR-bbb002", status: "draft" }));
    expect(notInvalid.toJSON()).toMatchObject({
      message:
        "draft is not marked invalid in the metamodel, so it cannot supersede an element; the invalid statuses of type Requirement (requirement) are: obsolete (Obsolete)",
      details: { reason: "not-invalid", allowed: ["obsolete"] },
    });
    const unknown = await errorOf(() => supersede(opened, { ref: "N-aaa001", status: "gone" }));
    // A type with every status lists every invalid one, without naming the type.
    expect(unknown.toJSON()).toMatchObject({
      message:
        "gone is not a status of the metamodel; the invalid statuses are: obsolete (Obsolete), superseded (Superseded)",
      details: { reason: "unknown-status", allowed: ["obsolete", "superseded"] },
    });
  });

  it("refuses to supersede an element of a type without invalid status", async () => {
    const opened = await open();
    const before = await read(opened, TERM);
    const error = await errorOf(() => supersede(opened, { ref: "T-eee001", status: "obsolete" }));
    expect(error.toJSON()).toEqual({
      code: "input.invalid",
      message: "Type Glossary Term (term) has no status marked invalid, so T-eee001 cannot be superseded",
      details: {
        ref: "T-eee001",
        type: "term",
        status: "obsolete",
        reason: "no-invalid-status",
        allowed: [],
      },
    });
    expect(await read(opened, TERM)).toBe(before);
  });

  it("reports an unknown element before the status", async () => {
    const opened = await open();
    const error = await errorOf(() => supersede(opened, { ref: "SR-999999", status: "gone" }));
    expect(error.code).toBe("ref.unknown");
  });

  it("keeps the earlier refusal when the metamodel marks no status invalid", async () => {
    const opened = await open();
    const model = await read(opened, "metamodel/model.yaml");
    await opened.fixture.write("metamodel/model.yaml", model.replaceAll(", invalid: true", ""));
    const error = await errorOf(() => supersede(opened, { ref: "SR-bbb002", status: "obsolete" }));
    expect(error.toJSON()).toMatchObject({
      message:
        "obsolete is not marked invalid in the metamodel, so it cannot supersede an element; the metamodel marks no status invalid",
      details: { reason: "not-invalid", allowed: [] },
    });
    expect(await read(opened, SR_ACCEPTED)).toContain("status: accepted\n");
  });
});

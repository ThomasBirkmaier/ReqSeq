// Statuses per type (#306): element.create, element.setStatus and element.supersede offer and take
// only the statuses of the element's type; a type without status gets none.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput, Problem } from "../../catalog.js";
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

const setStatus = (opened: Opened, refs: readonly string[], status: string | null): Promise<unknown> =>
  invoke("element.setStatus", { refs, status }, { workspace: opened.workspace });

const supersede = (opened: Opened, input: Record<string, unknown>): Promise<unknown> =>
  invoke("element.supersede", input, { workspace: opened.workspace });

const fixtureModel = (): Promise<string> =>
  fs.readFile(
    new URL("../../../../../fixtures/enabler-306/statuses-per-type/metamodel/model.yaml", import.meta.url),
    "utf8",
  );

const metamodelProblems = async (opened: Opened): Promise<readonly Problem[]> =>
  ((await invoke("metamodel.get", {}, { workspace: opened.workspace })) as CommandOutput<"metamodel.get">)
    .problems ?? [];

const statusHints = async (opened: Opened): Promise<readonly string[]> =>
  (
    (await invoke("workspace.check", {}, { workspace: opened.workspace })) as CommandOutput<"workspace.check">
  ).problems
    .filter((p) => p.code === "element.missing-status" || p.code === "element.status-not-allowed")
    .map((p) => `${p.code} ${p.file ?? ""}`);

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

  it("never gives a new element an invalid status: it skips them, and gives none to a type with only invalid ones", async () => {
    // `superseded` (invalid) comes before `archived` in the metamodel's statuses.
    const opened = await open({
      "metamodel/model.yaml": (await fixtureModel())
        .replace(
          "properties:\n  - key: title",
          "  - { key: ruling, name: Ruling, prefix: RUL, properties: [title], statuses: [archived, superseded] }\n  - { key: tombstone, name: Tombstone, prefix: TS, properties: [title], statuses: [obsolete, superseded] }\n\nproperties:\n  - key: title",
        )
        .replace(
          "  - { key: superseded, name: Superseded, invalid: true }\n",
          "  - { key: superseded, name: Superseded, invalid: true }\n  - { key: archived, name: Archived }\n",
        ),
    });
    // A type with only invalid statuses is no metamodel problem any more (#344, option 1), only an
    // info note (#343).
    expect(
      (await metamodelProblems(opened)).map((p) => `${p.severity} ${p.message.split(" (")[0] ?? ""}`),
    ).toEqual(["info Type tombstone has an optional status"]);
    const ruling = await create(opened, "ruling");
    expect(ruling.element.status).toBe("archived");
    const tombstone = await create(opened, "tombstone");
    expect(tombstone.element).not.toHaveProperty("status");
    expect(tombstone.problems).toEqual([]);
    expect(await read(opened, tombstone.element.file)).toMatch(
      /^---\nid: [0-9a-f-]+\ntype: tombstone\ntitle: /,
    );
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

/** Glossary terms that can be retired: one status, marked invalid (decision on #344, option 1). */
const RETIRABLE = {
  type: "  - { key: glossary-term, name: Glossary Term, prefix: GT, properties: [title], statuses: [retired] }\n\nproperties:\n  - key: title",
  status:
    "  - { key: superseded, name: Superseded, invalid: true }\n  - { key: retired, name: Retired, invalid: true }\n",
};
const GLOSSARY = "elements/GT-000000fff001.md";
const GLOSSARY_TEXT =
  "---\nid: 6f6f6f6f-6666-4666-8666-000000fff001\ntype: glossary-term\ntitle: Baseline\n---\n";

const openRetirable = async (): Promise<Opened> =>
  open({
    "metamodel/model.yaml": (await fixtureModel())
      .replace("properties:\n  - key: title", RETIRABLE.type)
      .replace("  - { key: superseded, name: Superseded, invalid: true }\n", RETIRABLE.status),
    [GLOSSARY]: GLOSSARY_TEXT,
  });

describe("a type whose statuses are all marked invalid (#344, option 1)", () => {
  it("is no metamodel problem but an info note (#343), and an element of it without status gets no hint", async () => {
    const opened = await openRetirable();
    expect(await metamodelProblems(opened)).toEqual([
      {
        code: "metamodel.invalid",
        severity: "info",
        repository: "system",
        message:
          "Type glossary-term has an optional status (only invalid statuses: retired): an element of it without status is current, element.supersede retires it, and element.setStatus with status null makes it current again",
        file: "metamodel/model.yaml",
        line: 33,
      },
    ]);
    // The hints of the fixture itself, none for the glossary term.
    expect(await statusHints(opened)).toEqual([
      "element.status-not-allowed elements/D-000000ddd002.md",
      "element.status-not-allowed elements/SR-000000bbb002.md",
      "element.missing-status elements/SR-000000bbb003.md",
      "element.status-not-allowed elements/T-000000eee002.md",
    ]);
  });

  it("gives a new element of it no status, so it is current", async () => {
    const opened = await openRetirable();
    const term = await create(opened, "glossary-term");
    expect(term.element).not.toHaveProperty("status");
    expect(term.problems).toEqual([]);
    expect(await read(opened, term.element.file)).toBe(
      `---\nid: ${term.element.id}\ntype: glossary-term\ntitle: A new glossary-term\n---\n`,
    );
  });

  it("retires an element of it with element.supersede, which appends the status line (ADR-0007)", async () => {
    const opened = await openRetirable();
    const out = await supersede(opened, { ref: "GT-fff001", status: "Retired" });
    expect(out).toMatchObject({ files: [GLOSSARY] });
    expect(await read(opened, GLOSSARY)).toBe(
      GLOSSARY_TEXT.replace("title: Baseline\n", "title: Baseline\nstatus: retired\n"),
    );
    expect((await statusHints(opened)).filter((h) => h.includes("GT-"))).toEqual([]);
  });

  it("still takes only its own invalid statuses", async () => {
    const opened = await openRetirable();
    const error = await errorOf(() => supersede(opened, { ref: "GT-fff001", status: "superseded" }));
    expect(error.details).toMatchObject({ reason: "status-not-allowed", allowed: ["retired"] });
    expect(await read(opened, GLOSSARY)).toBe(GLOSSARY_TEXT);
  });
});

describe("an initial status that is marked invalid (#350)", () => {
  /** `gone` is the initial status and marked invalid; `draft` is no longer initial. */
  const openInvalidInitial = async (): Promise<Opened> =>
    open({
      "metamodel/model.yaml": (await fixtureModel())
        .replace(
          "properties:\n  - key: title",
          "  - { key: gone-only, name: Gone only, prefix: GO, properties: [title], statuses: [gone] }\n\nproperties:\n  - key: title",
        )
        .replace(
          "  - { key: draft, name: Draft, initial: true }\n",
          "  - key: gone\n    name: Gone\n    initial: true\n    invalid: true\n  - { key: draft, name: Draft }\n",
        ),
    });

  it("is a metamodel warning on its invalid line", async () => {
    const opened = await openInvalidInitial();
    expect((await metamodelProblems(opened)).filter((p) => p.severity !== "info")).toEqual([
      {
        code: "metamodel.invalid",
        severity: "warning",
        repository: "system",
        message:
          "Status gone is initial and marked invalid; element.create does not give it to new elements, as they would be superseded at once, but the first status of their type that is not marked invalid (none when there is no such status)",
        file: "metamodel/model.yaml",
        line: 53,
      },
    ]);
  });

  it("is never written on create: a type gets its first status that is not invalid, or none", async () => {
    const opened = await openInvalidInitial();
    const need = await create(opened, "need");
    expect(need.element.status).toBe("draft");
    const decision = await create(opened, "decision");
    expect(decision.element.status).toBe("accepted");
    const gone = await create(opened, "gone-only");
    expect(gone.element).not.toHaveProperty("status");
    expect(await read(opened, gone.element.file)).not.toContain("status:");
  });
});

describe("removing a status with element.setStatus and status null (#343)", () => {
  const TERM_DRAFT = "elements/T-000000eee002.md";
  const RETIRED = "elements/GT-000000fff002.md";
  const RETIRED_TEXT =
    "---\nid: 6f6f6f6f-6666-4666-8666-000000fff002\ntype: glossary-term\nstatus: retired\ntitle: Retired by mistake\n---\nText\n";
  const LEFTOVER = "elements/GT-000000fff003.md";
  const LEFTOVER_TEXT =
    "---\nid: 6f6f6f6f-6666-4666-8666-000000fff003\ntype: glossary-term\nstatus: draft\ntitle: Migrated\n---\n";

  it("removes a leftover status from an element of a type without status: only the status line goes", async () => {
    const opened = await open();
    expect(await statusHints(opened)).toContain(`element.status-not-allowed ${TERM_DRAFT}`);
    const out = await setStatus(opened, ["T-eee002"], null);
    expect(out).toEqual({ files: [TERM_DRAFT], problems: [] });
    expect(await read(opened, TERM_DRAFT)).toBe(
      "---\nid: 5e5e5e5e-5555-4555-8555-000000eee002\ntype: term\ntitle: Term with a status\n---\n",
    );
    expect((await statusHints(opened)).filter((h) => h.includes("T-000000eee"))).toEqual([]);
  });

  it("makes a retired element of a retire-only type current again and clears a leftover working status (#344)", async () => {
    const opened = await open({
      "metamodel/model.yaml": (await fixtureModel())
        .replace("properties:\n  - key: title", RETIRABLE.type)
        .replace("  - { key: superseded, name: Superseded, invalid: true }\n", RETIRABLE.status),
      [RETIRED]: RETIRED_TEXT,
      [LEFTOVER]: LEFTOVER_TEXT,
    });
    expect((await statusHints(opened)).filter((h) => h.includes("GT-"))).toEqual([
      `element.status-not-allowed ${LEFTOVER}`,
    ]);
    const out = await setStatus(opened, ["GT-fff002", "GT-fff003"], null);
    expect(out).toEqual({ files: [RETIRED, LEFTOVER], problems: [] });
    expect(await read(opened, RETIRED)).toBe(RETIRED_TEXT.replace("status: retired\n", ""));
    expect(await read(opened, LEFTOVER)).toBe(LEFTOVER_TEXT.replace("status: draft\n", ""));
    expect((await statusHints(opened)).filter((h) => h.includes("GT-"))).toEqual([]);
    const view = (await invoke("element.get", { ref: "GT-fff002" }, { workspace: opened.workspace })) as {
      element: Record<string, unknown>;
    };
    expect(view.element).not.toHaveProperty("status");
  });

  it("is lossless: comments, other keys, the text and CRLF line endings stay byte for byte (ADR-0007)", async () => {
    const text =
      "---\r\nid: 5e5e5e5e-5555-4555-8555-000000eee002\r\n# the type\r\ntype: term\r\nstatus: draft # from Logseq\r\n# about the title\r\ntitle: 'Term with a status'\r\n---\r\nSome *text*.\r\n";
    const opened = await open({ [TERM_DRAFT]: text });
    await setStatus(opened, ["T-eee002"], null);
    expect(await read(opened, TERM_DRAFT)).toBe(text.replace("status: draft # from Logseq\r\n", ""));
  });

  it("refuses it on a type that requires a status, before any file is written", async () => {
    const opened = await open();
    const files = [TERM_DRAFT, SR_DRAFT, NEED];
    const before = await Promise.all(files.map((f) => read(opened, f)));
    const error = await errorOf(() => setStatus(opened, ["T-eee002", "SR-bbb001"], null));
    expect(error.toJSON()).toEqual({
      code: "input.invalid",
      message:
        "Type Requirement (requirement) of SR-bbb001 requires a status, so it cannot be removed; its statuses are: draft (Draft), obsolete (Obsolete)",
      details: {
        ref: "SR-bbb001",
        type: "requirement",
        status: null,
        allowed: ["draft", "obsolete"],
        reason: "status-required",
      },
    });
    // A type without a list has every status, so it requires one too.
    const need = await errorOf(() => setStatus(opened, ["N-aaa001"], null));
    expect(need.details).toMatchObject({ reason: "status-required", type: "need" });
    expect(await Promise.all(files.map((f) => read(opened, f)))).toEqual(before);
  });

  it("writes no file for an element without a status line, and removes an empty one", async () => {
    const empty = "---\nid: 5e5e5e5e-5555-4555-8555-000000eee002\ntype: term\nstatus:\ntitle: Empty\n---\n";
    const opened = await open({ [TERM_DRAFT]: empty });
    const before = await read(opened, TERM);
    expect(await setStatus(opened, ["T-eee001", "T-eee001"], null)).toEqual({ files: [], problems: [] });
    expect(await read(opened, TERM)).toBe(before);
    expect(await setStatus(opened, ["T-eee002"], null)).toEqual({ files: [TERM_DRAFT], problems: [] });
    expect(await read(opened, TERM_DRAFT)).toBe(empty.replace("status:\n", ""));
  });

  it("still needs the status field: leaving it out is no removal", async () => {
    const opened = await open();
    const before = await read(opened, TERM_DRAFT);
    const error = await errorOf(() =>
      invoke("element.setStatus", { refs: ["T-eee002"] }, { workspace: opened.workspace }),
    );
    expect(error.code).toBe("input.invalid");
    expect(await read(opened, TERM_DRAFT)).toBe(before);
  });
});

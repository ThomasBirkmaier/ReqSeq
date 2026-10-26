import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput, Problem } from "../catalog.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { statusProblemsState } from "./index.js";

const CODES = new Set(["element.status-not-allowed", "element.missing-status"]);

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

const hint = (
  code: "element.status-not-allowed" | "element.missing-status",
  file: string,
  id: string,
  message: string,
  line?: number,
): Problem => ({
  code,
  severity: "warning",
  message,
  repository: "system",
  file: `elements/${file}`,
  elementId: id,
  elementShortId: `${file.replace(/-.*$/, "")}-${id.slice(-6)}`,
  ...(line === undefined ? {} : { line }),
});

const UNKNOWN = hint(
  "element.status-not-allowed",
  "D-000000ddd002.md",
  "4d4d4d4d-4444-4444-8444-000000ddd002",
  "Status frozen is not in the metamodel; the statuses of type Decision (decision) are accepted (Accepted), superseded (Superseded); LogReq changes no file",
  4,
);
const OTHER_TYPE = hint(
  "element.status-not-allowed",
  "SR-000000bbb002.md",
  "2b2b2b2b-2222-4222-8222-000000bbb002",
  "Status Accepted (accepted) is not a status of type Requirement (requirement), whose statuses are draft (Draft), obsolete (Obsolete); LogReq changes no file",
  4,
);
const MISSING = hint(
  "element.missing-status",
  "SR-000000bbb003.md",
  "2b2b2b2b-2222-4222-8222-000000bbb003",
  "Type Requirement (requirement) has statuses, but the element has none; they are draft (Draft), obsolete (Obsolete); LogReq changes no file",
);
const NO_STATUS = hint(
  "element.status-not-allowed",
  "T-000000eee002.md",
  "5e5e5e5e-5555-4555-8555-000000eee002",
  "Type Glossary Term (term) has no status, but the element has status draft; LogReq changes no file",
  4,
);

const check = async (opened: Opened): Promise<CommandOutput<"workspace.check">> =>
  (await invoke("workspace.check", {}, { workspace: opened.workspace })) as CommandOutput<"workspace.check">;

const statusHints = async (opened: Opened): Promise<readonly Problem[]> =>
  (await check(opened)).problems.filter((p) => CODES.has(p.code));

describe("status hints of elements against the statuses of their type (#306)", () => {
  it("reports a status outside the type, a status on a type without status and a missing status as warnings", async () => {
    const opened = await open();
    const out = await check(opened);
    // Every other element is fine: a need has every status, a safety requirement its own and its parent's.
    expect(out.problems).toEqual([UNKNOWN, OTHER_TYPE, MISSING, NO_STATUS]);
    // Hints are warnings: they block nothing, so the check passes by default (failOn: error, #304).
    expect(out.ok).toBe(true);
  });

  it("lists them as hints", async () => {
    const opened = await open();
    const out = (await invoke(
      "hint.list",
      {},
      { workspace: opened.workspace },
    )) as CommandOutput<"hint.list">;
    expect(out.hints.map((h) => h.code)).toEqual([
      "element.status-not-allowed",
      "element.status-not-allowed",
      "element.missing-status",
      "element.status-not-allowed",
    ]);
  });

  it("shows the hint of one element with element.get, with the line of an empty status key", async () => {
    const opened = await open({
      "elements/SR-000000bbb003.md":
        "---\nid: 2b2b2b2b-2222-4222-8222-000000bbb003\ntype: requirement\nstatus:\ntitle: Without status\n---\n",
    });
    const get = (ref: string): Promise<CommandOutput<"element.get">> =>
      invoke("element.get", { ref }, { workspace: opened.workspace }) as Promise<
        CommandOutput<"element.get">
      >;
    expect((await get("SR-bbb003")).element.problems).toEqual([{ ...MISSING, line: 4 }]);
    expect((await get("T-eee002")).element.problems).toEqual([NO_STATUS]);
    expect((await get("T-eee001")).element).not.toHaveProperty("status");
  });

  it("reports a status that is not text as not allowed", async () => {
    const opened = await open({
      "elements/D-000000ddd002.md":
        "---\nid: 4d4d4d4d-4444-4444-8444-000000ddd002\ntype: decision\nstatus: [accepted]\ntitle: List\n---\n",
    });
    expect((await statusHints(opened))[0]).toMatchObject({
      code: "element.status-not-allowed",
      message:
        'Status ["accepted"] is not in the metamodel; the statuses of type Decision (decision) are accepted (Accepted), superseded (Superseded); LogReq changes no file',
      line: 4,
    });
  });

  it("gives no hint for an element of an unknown type or while the metamodel is not valid", async () => {
    const opened = await open({
      "elements/X-f00000000001.md":
        "---\nid: 6f6f6f6f-6666-4666-8666-f00000000001\ntype: gadget\nstatus: frozen\ntitle: x\n---\n",
    });
    expect(await statusHints(opened)).toEqual([UNKNOWN, OTHER_TYPE, MISSING, NO_STATUS]);
    await opened.fixture.write("metamodel/broken.yaml", "logreq-metamodel: 2\n");
    const broken = new Workspace(opened.fixture.root);
    onTestFinished(() => broken.close());
    expect(await broken.get(statusProblemsState)).toEqual([]);
  });

  it("follows a changed file and a changed metamodel without reading every file again", async () => {
    const opened = await open();
    expect(await statusHints(opened)).toHaveLength(4);
    const file = opened.fixture.path("elements/SR-000000bbb002.md");
    await invoke(
      "element.setStatus",
      { refs: ["SR-bbb002"], status: "draft" },
      { workspace: opened.workspace },
    );
    expect(await fs.readFile(file, "utf8")).toContain("status: draft\n");
    expect(await statusHints(opened)).toEqual([UNKNOWN, MISSING, NO_STATUS]);
    // Without a list on the requirement type, it has every status; the missing status stays a hint.
    const model = await fs.readFile(opened.fixture.path("metamodel/model.yaml"), "utf8");
    await opened.fixture.write(
      "metamodel/model.yaml",
      model.replace("    statuses: [draft, obsolete]\n", ""),
    );
    const changed = new Workspace(opened.fixture.root);
    onTestFinished(() => changed.close());
    const out = (await invoke(
      "workspace.check",
      {},
      { workspace: changed },
    )) as CommandOutput<"workspace.check">;
    expect(out.problems.filter((p) => CODES.has(p.code))).toEqual([
      UNKNOWN,
      {
        ...MISSING,
        message:
          "Type Requirement (requirement) has statuses, but the element has none; they are draft (Draft), approved (Approved), accepted (Accepted), obsolete (Obsolete), superseded (Superseded); LogReq changes no file",
      },
      NO_STATUS,
    ]);
  });
});

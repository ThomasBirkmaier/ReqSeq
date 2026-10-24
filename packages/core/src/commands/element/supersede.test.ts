import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput, Problem } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { metamodelState } from "../../metamodel/index.js";
import { currentTarget, elementStoreState, supersededTargetProblemsState } from "../../model/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
import { workspaceLayoutState } from "../../workspace/index.js";

type Output = CommandOutput<"element.supersede">;

/** The elements of fixtures/SR-072/supersede. */
const N_OLD = { id: "7a1e0c2b-4d3f-4a5b-8c6d-a1b2c3d4e5f6", file: "needs/N-a1b2c3d4e5f6.md" };
const N_NEW = { id: "7a1e0c2b-4d3f-4a5b-8c6d-b2c3d4e5f6a7", file: "needs/N-b2c3d4e5f6a7.md" };
const SR_OLD = { id: "7a1e0c2b-4d3f-4a5b-8c6d-c3d4e5f6a7b8", file: "requirements/SR-c3d4e5f6a7b8.md" };
const SR_NEW = { id: "7a1e0c2b-4d3f-4a5b-8c6d-d4e5f6a7b8c9", file: "requirements/SR-d4e5f6a7b8c9.md" };
const SR_CHILD = { id: "7a1e0c2b-4d3f-4a5b-8c6d-e5f6a7b8c9d0", file: "requirements/SR-e5f6a7b8c9d0.md" };
const FILES = [N_OLD.file, N_NEW.file, SR_OLD.file, SR_NEW.file, SR_CHILD.file];
const MODEL = "metamodel/standard-model.yaml";

/** An element of a type the metamodel does not know (SR-016 AK3). */
const GADGET = { id: "7a1e0c2b-4d3f-4a5b-8c6d-f6a7b8c9d0e1", file: "requirements/X-f6a7b8c9d0e1.md" };
const GADGET_FILE = `---\nid: ${GADGET.id}\ntype: gadget\nstatus: draft\ntitle: Gadget\n---\n`;

interface Opened {
  readonly fixture: FixtureWorkspace;
  readonly workspace: Workspace;
}

const open = async (options: FixtureOptions = {}, root = ""): Promise<Opened> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-072/supersede", ...options });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(root === "" ? fixture.root : fixture.path(root));
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const supersede = async (opened: Opened, input: Record<string, unknown>): Promise<Output> =>
  (await invoke("element.supersede", input, { workspace: opened.workspace })) as Output;

const supersedeError = async (opened: Opened, input: Record<string, unknown>): Promise<CommandError> => {
  try {
    await supersede(opened, input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected element.supersede to fail");
};

const read = (opened: Opened, file: string): Promise<string> =>
  fs.readFile(opened.fixture.path(file), "utf8");

const readAll = async (opened: Opened, files: readonly string[] = FILES): Promise<string[]> =>
  Promise.all(files.map((file) => read(opened, file)));

/** The standard model of the fixture, changed by `change`. */
const changedModel = async (change: (text: string) => string): Promise<string> =>
  change(
    await fs.readFile(new URL(`../../../../../fixtures/SR-072/supersede/${MODEL}`, import.meta.url), "utf8"),
  );

/** The target a relation to `id` gets when it is set now (SR-021), from a source in `repository`. */
const targetNow = async (
  opened: Opened,
  repository: string,
  target: { readonly id: string; readonly repository?: string },
): Promise<Record<string, string>> => {
  const { workspace } = opened;
  const context = {
    layout: await workspace.get(workspaceLayoutState),
    metamodel: await workspace.get(metamodelState),
    store: await workspace.get(elementStoreState),
  };
  return { ...(await currentTarget(context, repository, target)) };
};

const hint = (
  source: { readonly id: string; readonly file: string },
  target: { readonly id: string },
  line: number,
  message: string,
): Problem => ({
  code: "relation.target-superseded",
  severity: "warning",
  message,
  repository: "system",
  file: source.file,
  elementId: source.id,
  targetId: target.id,
  line,
});

describe("element.supersede sets the chosen invalid status and on request a relation from the successor (SR-072 AK1)", () => {
  it("[SR-072/AK1] sets the chosen invalid status and changes only the status line", async () => {
    const opened = await open();
    const [before, ...others] = await readAll(opened, [N_OLD.file, N_NEW.file, SR_OLD.file, SR_NEW.file]);
    const out = await supersede(opened, { ref: "N-d4e5f6", status: "obsolete" });
    expect(out.files).toEqual([N_OLD.file]);
    expect(await read(opened, N_OLD.file)).toBe(before?.replace("status: approved", "status: obsolete"));
    expect(await readAll(opened, [N_NEW.file, SR_OLD.file, SR_NEW.file])).toEqual(others);
    const store = await opened.workspace.get(elementStoreState);
    expect(store.byId.get(N_OLD.id)?.map((r) => r.data["status"])).toEqual(["obsolete"]);
  });

  it("[SR-072/AK1] writes the relation with the element's UUID, current version and title into the successor's file", async () => {
    const opened = await open();
    const before = await read(opened, N_NEW.file);
    // The status is not content (D-013), so the version stays the same when it changes.
    const target = await targetNow(opened, "system", { id: N_OLD.id });
    expect(Object.keys(target)).toEqual(["id", "version", "title"]);
    expect([target["id"], target["title"]]).toEqual([N_OLD.id, "See the wind"]);
    expect(target["version"]).toMatch(/^n1:[0-9a-f]{16}$/);
    // Only `supersedes` goes from a need to a need; `replaces` is for system requirements.
    const out = await supersede(opened, { ref: N_OLD.id, status: "obsolete", successor: "N-e5f6a7" });
    expect(out.files).toEqual([N_OLD.file, N_NEW.file]);
    expect(await read(opened, N_NEW.file)).toBe(
      before.replace(
        "title: See wind and gusts\n",
        `title: See wind and gusts\nsupersedes:\n  - { id: ${N_OLD.id}, version: ${String(target["version"])}, title: See the wind }\n`,
      ),
    );
    const store = await opened.workspace.get(elementStoreState);
    expect(store.byId.get(N_OLD.id)?.map((r) => r.data["status"])).toEqual(["obsolete"]);
    expect(store.byId.get(N_NEW.id)?.map((r) => r.data["supersedes"])).toEqual([[target]]);
  });

  it("[SR-072/AK1] uses the relation kind the caller names when several fit", async () => {
    const opened = await open();
    const before = await readAll(opened);
    const error = await supersedeError(opened, { ref: SR_OLD.id, status: "obsolete", successor: SR_NEW.id });
    expect([error.code, error.details]).toEqual([
      "input.invalid",
      {
        sourceType: "system-requirement",
        targetType: "system-requirement",
        reason: "relation-ambiguous",
        candidates: ["supersedes", "replaces"],
      },
    ]);
    expect(error.message).toBe(
      "More than one relation kind with the meaning replacement fits from System Requirement to System Requirement: supersedes, replaces; name one as relation",
    );
    expect(await readAll(opened)).toEqual(before);
    const out = await supersede(opened, {
      ref: SR_OLD.id,
      status: "obsolete",
      successor: SR_NEW.id,
      relation: "replaces",
    });
    expect(out.files).toEqual([SR_OLD.file, SR_NEW.file]);
    expect(await read(opened, SR_NEW.file)).toMatch(
      new RegExp(
        `\\nreplaces:\\n {2}- \\{ id: ${SR_OLD.id}, version: n1:[0-9a-f]{16}, title: Show wind speed \\}\\n---\\n`,
      ),
    );
  });

  it("[SR-072/AK1] refuses a relation kind that has no meaning replacement or does not fit the types", async () => {
    const opened = await open();
    const before = await readAll(opened);
    const notReplacement = await supersedeError(opened, {
      ref: SR_OLD.id,
      status: "obsolete",
      successor: SR_NEW.id,
      relation: "derives-from",
    });
    expect([notReplacement.code, notReplacement.details]).toEqual([
      "input.invalid",
      { relation: "derives-from", reason: "not-a-replacement", allowed: ["supersedes", "replaces"] },
    ]);
    const notAllowed = await supersedeError(opened, {
      ref: SR_OLD.id,
      status: "obsolete",
      successor: N_NEW.id,
      relation: "replaces",
    });
    expect([notAllowed.code, notAllowed.message, notAllowed.details]).toEqual([
      "relation.not-allowed",
      "Relation Replaces (replaces) from Need to System Requirement is not allowed",
      { relation: "replaces", sourceType: "need", targetType: "system-requirement" },
    ]);
    const relationOnly = await supersedeError(opened, {
      ref: SR_OLD.id,
      status: "obsolete",
      relation: "replaces",
    });
    expect([relationOnly.code, relationOnly.details]).toEqual([
      "input.invalid",
      { relation: "replaces", reason: "relation-without-successor" },
    ]);
    expect(await readAll(opened)).toEqual(before);
  });

  it("[SR-072/AK1] refuses when no relation kind with the meaning replacement fits or none has it", async () => {
    const restricted = await open({
      files: {
        [MODEL]: await changedModel((text) =>
          text.replace(
            "    inverse-name: Superseded by\n",
            "    inverse-name: Superseded by\n    source-types: [system-requirement]\n",
          ),
        ),
      },
    });
    const before = await readAll(restricted);
    const none = await supersedeError(restricted, { ref: N_OLD.id, status: "obsolete", successor: N_NEW.id });
    expect([none.code, none.message, none.details]).toEqual([
      "relation.not-allowed",
      "No relation kind with the meaning replacement may go from Need to Need",
      { sourceType: "need", targetType: "need", candidates: [] },
    ]);
    expect(await readAll(restricted)).toEqual(before);

    const unassigned = await open({
      files: { [MODEL]: await changedModel((text) => text.replaceAll("    meaning: replacement\n", "")) },
    });
    const error = await supersedeError(unassigned, {
      ref: N_OLD.id,
      status: "obsolete",
      successor: N_NEW.id,
    });
    expect([error.code, error.details]).toEqual([
      "metamodel.meaning-unassigned",
      { meaning: "replacement", list: "relations", command: "element.supersede" },
    ]);
    // Without a successor no relation kind is needed.
    expect((await supersede(unassigned, { ref: N_OLD.id, status: "obsolete" })).files).toEqual([N_OLD.file]);
  });

  it("[SR-072/AK1] keeps a relation the successor already has, with its stored version, and writes nothing twice", async () => {
    const stored = `  - { id: ${SR_OLD.id}, version: n1:3333333333333333, title: Old title }\n`;
    const successor = `---\nid: ${SR_NEW.id}\ntype: system-requirement\nstatus: draft\ntitle: New\nsupersedes:\n${stored}---\n`;
    const opened = await open({ files: { [SR_NEW.file]: successor } });
    const out = await supersede(opened, {
      ref: SR_OLD.id,
      status: "obsolete",
      successor: SR_NEW.id,
      relation: "supersedes",
    });
    expect(out.files).toEqual([SR_OLD.file]);
    expect(await read(opened, SR_NEW.file)).toBe(successor);
    const again = await supersede(opened, {
      ref: SR_OLD.id,
      status: "obsolete",
      successor: SR_NEW.id,
      relation: "supersedes",
    });
    expect(again.files).toEqual([]);
    expect(again.problems).toEqual(out.problems);
  });

  it("[SR-072/AK1] repeats without relation when the successor already has the relation under one of the kinds that fit", async () => {
    const stored = (key: string): string =>
      `${key}:\n  - { id: ${SR_OLD.id}, version: n1:3333333333333333, title: Old title }\n`;
    const successor = (keys: readonly string[]): string =>
      `---\nid: ${SR_NEW.id}\ntype: system-requirement\nstatus: draft\ntitle: New\n${keys.map(stored).join("")}---\n`;
    // Both `supersedes` and `replaces` fit from a system requirement to one; the successor has `replaces`.
    const opened = await open({ files: { [SR_NEW.file]: successor(["replaces"]) } });
    const out = await supersede(opened, { ref: SR_OLD.id, status: "obsolete", successor: SR_NEW.id });
    expect(out.files).toEqual([SR_OLD.file]);
    expect(await read(opened, SR_NEW.file)).toBe(successor(["replaces"]));
    expect((out.problems ?? []).map((p) => [p.file, p.line])).toContainEqual([SR_NEW.file, 7]);

    // Under both kinds, the caller still has to name one.
    const both = await open({ files: { [SR_NEW.file]: successor(["supersedes", "replaces"]) } });
    const before = await readAll(both);
    const error = await supersedeError(both, { ref: SR_OLD.id, status: "obsolete", successor: SR_NEW.id });
    expect([error.code, error.details?.["reason"]]).toEqual(["input.invalid", "relation-ambiguous"]);
    expect(await readAll(both)).toEqual(before);
  });

  it("[SR-072/AK1] writes the element's file back when the successor's file is refused at write time (read-only)", async () => {
    const opened = await open();
    const before = await readAll(opened);
    await fs.chmod(opened.fixture.path(N_NEW.file), 0o444);
    onTestFinished(() => fs.chmod(opened.fixture.path(N_NEW.file), 0o644));
    const error = await supersedeError(opened, { ref: N_OLD.id, status: "obsolete", successor: N_NEW.id });
    // The element's file could be restored, so the error is the writer's as it is, without `written`.
    expect(error.code).toBe("file.read-only");
    expect(error.details).toBeUndefined();
    expect(await readAll(opened)).toEqual(before);
    const store = await opened.workspace.get(elementStoreState);
    expect(store.byId.get(N_OLD.id)?.map((r) => r.data["status"])).toEqual(["approved"]);
    await fs.chmod(opened.fixture.path(N_NEW.file), 0o644);
    const out = await supersede(opened, { ref: N_OLD.id, status: "obsolete", successor: N_NEW.id });
    expect(out.files).toEqual([N_OLD.file, N_NEW.file]);
  });

  it("[SR-072/AK1] writes a relation to an element of another repository with the repository name and no title (D-058)", async () => {
    const platformNeed = "4c1d9e7a-8b2f-4a3c-9d5e-6f7a8b9c0d1e";
    const file = "needs/N-0a1b2c3d4e5f.md";
    const opened = await open(
      {
        fixture: "SR-005/cross-repository",
        files: {
          [`system/${file}`]: `---\nid: 7a1e0c2b-4d3f-4a5b-8c6d-0a1b2c3d4e5f\ntype: need\nstatus: draft\ntitle: Gusts in red\n---\n`,
        },
      },
      "system",
    );
    const target = await targetNow(opened, "system", { id: platformNeed, repository: "platform" });
    expect(Object.keys(target)).toEqual(["id", "version", "repository"]);
    const out = await supersede(opened, { ref: platformNeed, status: "obsolete", successor: "N-3d4e5f" });
    expect(out.files).toEqual(["../platform-checkout/needs/N-6f7a8b9c0d1e.md", file]);
    expect(await read(opened, `system/${file}`)).toContain(
      `supersedes:\n  - { id: ${platformNeed}, version: ${String(target["version"])}, repository: platform }\n`,
    );
    expect(await read(opened, "platform-checkout/needs/N-6f7a8b9c0d1e.md")).toContain("status: obsolete\n");
    // The system requirement derives from the platform need across repositories (AK2).
    expect((out.problems ?? []).map((p) => [p.code, p.repository, p.file, p.elementId, p.targetId])).toEqual([
      ["relation.target-superseded", "system", file, "7a1e0c2b-4d3f-4a5b-8c6d-0a1b2c3d4e5f", platformNeed],
      [
        "relation.target-superseded",
        "system",
        "requirements/SR-1a3c5e7b9d0f.md",
        "8f1e3d5c-7b9a-4c2e-a4f6-1a3c5e7b9d0f",
        platformNeed,
      ],
    ]);
  });

  it("[SR-072/AK1] refuses a status that is not marked invalid and writes no file", async () => {
    const opened = await open();
    const before = await readAll(opened);
    for (const [status, reason] of [
      ["approved", "not-invalid"],
      ["gone", "unknown-status"],
    ] as const) {
      const error = await supersedeError(opened, { ref: N_OLD.id, status, successor: N_NEW.id });
      expect([error.code, error.details]).toEqual([
        "input.invalid",
        { status, reason, allowed: ["obsolete"] },
      ]);
    }
    expect((await supersedeError(opened, { ref: N_OLD.id, status: "draft" })).message).toBe(
      "draft is not marked invalid in the metamodel, so it cannot supersede an element; the invalid statuses are: obsolete",
    );
    expect(await readAll(opened)).toEqual(before);

    const noInvalid = await open({
      files: { [MODEL]: await changedModel((text) => text.replace(", invalid: true", "")) },
    });
    const error = await supersedeError(noInvalid, { ref: N_OLD.id, status: "obsolete" });
    expect([error.message, error.details]).toEqual([
      "obsolete is not marked invalid in the metamodel, so it cannot supersede an element; the metamodel marks no status invalid",
      { status: "obsolete", reason: "not-invalid", allowed: [] },
    ]);
  });

  it("[SR-072/AK1] refuses the element as its own successor and an unknown successor", async () => {
    const opened = await open();
    const before = await readAll(opened);
    const self = await supersedeError(opened, { ref: "N-d4e5f6", status: "obsolete", successor: N_OLD.id });
    expect([self.code, self.details]).toEqual(["input.invalid", { ref: "N-d4e5f6", reason: "self" }]);
    const unknown = await supersedeError(opened, {
      ref: N_OLD.id,
      status: "obsolete",
      successor: "N-ffffff",
    });
    expect(unknown.code).toBe("ref.unknown");
    expect(await readAll(opened)).toEqual(before);
  });

  it("[SR-072/AK1] writes no file when the successor's file changed on disk since it was read", async () => {
    const opened = await open();
    await opened.workspace.get(elementStoreState);
    const changed = `${await read(opened, N_NEW.file)}Changed by hand.\n`;
    await opened.fixture.write(N_NEW.file, changed);
    const before = await read(opened, N_OLD.file);
    const error = await supersedeError(opened, { ref: N_OLD.id, status: "obsolete", successor: N_NEW.id });
    expect([error.code, error.details]).toEqual([
      "file.changed-on-disk",
      { file: N_NEW.file, repository: "system" },
    ]);
    expect([await read(opened, N_OLD.file), await read(opened, N_NEW.file)]).toEqual([before, changed]);
  });

  it("[SR-016/AK3] refuses an element or a successor of an unknown type and writes no file", async () => {
    const opened = await open({ files: { [GADGET.file]: GADGET_FILE } });
    const before = await readAll(opened, [...FILES, GADGET.file]);
    for (const input of [
      { ref: GADGET.id, status: "obsolete" },
      { ref: N_OLD.id, status: "obsolete", successor: GADGET.id },
    ]) {
      const error = await supersedeError(opened, input);
      expect([error.code, error.details]).toEqual([
        "element.read-only",
        { id: GADGET.id, type: "gadget", reason: "unknown-type" },
      ]);
    }
    expect(await readAll(opened, [...FILES, GADGET.file])).toEqual(before);
  });
});

describe("relations to a superseded element get a hint each (SR-072 AK2)", () => {
  const SEE_THE_WIND = "Need N-d4e5f6, which is superseded (status Obsolete)";

  it("[SR-072/AK2] element.supersede gives one hint per relation to the superseded element, with its line", async () => {
    const opened = await open();
    const out = await supersede(opened, { ref: N_OLD.id, status: "obsolete", successor: N_NEW.id });
    const successor = "; successor: Need N-e5f6a7";
    expect(out.problems).toEqual([
      hint(N_NEW, N_OLD, 7, `Relation Supersedes (supersedes) from Need N-e5f6a7 points to ${SEE_THE_WIND}`),
      hint(
        SR_OLD,
        N_OLD,
        10,
        `Relation Derives from (derives-from) from System Requirement SR-f6a7b8 points to ${SEE_THE_WIND}${successor}`,
      ),
      hint(
        SR_CHILD,
        N_OLD,
        11,
        `Relation Derives from (derives-from) from System Requirement SR-b8c9d0 points to ${SEE_THE_WIND}${successor}`,
      ),
    ]);
    // The relations to elements that are not superseded get none.
    expect((out.problems ?? []).map((p) => p.targetId)).not.toContain(SR_OLD.id);
  });

  it("[SR-072/AK2] gives a hint for every relation kind and every relation to the element", async () => {
    const opened = await open();
    const out = await supersede(opened, {
      ref: SR_OLD.id,
      status: "obsolete",
      successor: SR_NEW.id,
      relation: "replaces",
    });
    expect((out.problems ?? []).map((p) => [p.file, p.line, p.message])).toEqual([
      [
        SR_NEW.file,
        10,
        "Relation Replaces (replaces) from System Requirement SR-a7b8c9 points to System Requirement SR-f6a7b8, which is superseded (status Obsolete)",
      ],
      [
        SR_CHILD.file,
        10,
        "Relation Derives from (derives-from) from System Requirement SR-b8c9d0 points to System Requirement SR-f6a7b8, which is superseded (status Obsolete); successor: System Requirement SR-a7b8c9",
      ],
      [
        SR_CHILD.file,
        13,
        "Relation Refines (refines) from System Requirement SR-b8c9d0 points to System Requirement SR-f6a7b8, which is superseded (status Obsolete); successor: System Requirement SR-a7b8c9",
      ],
    ]);
  });

  it("[SR-072/AK2] gives the same hints when element.setStatus sets the invalid status", async () => {
    const superseded = await open();
    const expected = (await supersede(superseded, { ref: N_OLD.id, status: "obsolete" })).problems;
    expect(expected).toHaveLength(2);
    const opened = await open();
    const out = (await invoke(
      "element.setStatus",
      { refs: [N_OLD.id, N_NEW.id], status: "obsolete" },
      { workspace: opened.workspace },
    )) as CommandOutput<"element.setStatus">;
    expect(out).toEqual({ files: [N_OLD.file, N_NEW.file], problems: expected });
    // Back to a valid status: no hint.
    const back = (await invoke(
      "element.setStatus",
      { refs: [N_OLD.id], status: "approved" },
      { workspace: opened.workspace },
    )) as CommandOutput<"element.setStatus">;
    expect(back).toEqual({ files: [N_OLD.file], problems: [] });
  });

  it("[SR-072/AK2] element.update gives the hints on the relations of the element it writes", async () => {
    const opened = await open();
    await supersede(opened, { ref: N_OLD.id, status: "obsolete", successor: N_NEW.id });
    const update = async (ref: string): Promise<readonly Problem[]> =>
      (
        (await invoke(
          "element.update",
          { ref, text: "Changed.\n" },
          { workspace: opened.workspace },
        )) as CommandOutput<"element.update">
      ).problems ?? [];
    expect(await update(SR_OLD.id)).toEqual([
      hint(
        SR_OLD,
        N_OLD,
        10,
        `Relation Derives from (derives-from) from System Requirement SR-f6a7b8 points to ${SEE_THE_WIND}; successor: Need N-e5f6a7`,
      ),
    ]);
    // The successor's own relation names no successor: the store's copy of it is not another one.
    expect(await update(N_NEW.id)).toEqual([
      hint(N_NEW, N_OLD, 7, `Relation Supersedes (supersedes) from Need N-e5f6a7 points to ${SEE_THE_WIND}`),
    ]);
    // An element without relations to a superseded element gets none.
    expect(await update(N_OLD.id)).toEqual([]);
  });

  it("[SR-072/AK2] gives the same hints for a status set by hand in the file, for the whole workspace", async () => {
    const superseded = await open();
    const expected = (await supersede(superseded, { ref: N_OLD.id, status: "obsolete" })).problems;
    const byHand = await fs.readFile(superseded.fixture.path(N_OLD.file), "utf8");
    const opened = await open({ files: { [N_OLD.file]: byHand } });
    expect(await opened.workspace.get(supersededTargetProblemsState)).toEqual(expected);
    const none = await open();
    expect(await none.workspace.get(supersededTargetProblemsState)).toEqual([]);
  });
});

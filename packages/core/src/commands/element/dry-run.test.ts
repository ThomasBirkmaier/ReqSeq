// element.create and element.update as a dry run (SR-246): every check and the output of the command,
// but no file or folder is created or changed, and the store does not learn the result. On
// fixtures/enabler-305/identifiers: N-001, D-047, SR-036 (derives from N-001) and SR-037 (derives from SR-036).
import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import type { EvidenceRecord } from "../../evidence/index.js";
import { evidenceRecordsState } from "../../evidence/index.js";
import { currentVersionsOf, elementStoreState } from "../../model/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Created = CommandOutput<"element.create"> & { readonly answer: string };
type Updated = CommandOutput<"element.update"> & { readonly answer: string };

interface Opened {
  readonly workspace: Workspace;
  /** Every file and folder of the workspace, a file with its content. */
  readonly tree: () => Promise<Record<string, string>>;
  readonly path: (file: string) => string;
  readonly call: (name: string, input: Record<string, unknown>) => Promise<unknown>;
}

const open = async (options: Partial<FixtureOptions> = {}): Promise<Opened> => {
  const ws = await createFixtureWorkspace({ fixture: "enabler-305/identifiers", ...options });
  onTestFinished(() => ws.cleanup());
  const workspace = new Workspace(ws.root);
  onTestFinished(() => workspace.close());
  const tree = async (): Promise<Record<string, string>> => {
    const entries = (await fs.readdir(ws.root, { recursive: true, withFileTypes: true })).filter(
      (entry) => !entry.parentPath.includes(".git"),
    );
    const listed = await Promise.all(
      entries.map(async (entry) => {
        const file = path.join(entry.parentPath, entry.name);
        const shown = path.relative(ws.root, file).split(path.sep).join("/");
        return [shown, entry.isDirectory() ? "<folder>" : await fs.readFile(file, "utf8")] as const;
      }),
    );
    return Object.fromEntries(listed.sort(([a], [b]) => a.localeCompare(b)));
  };
  return {
    workspace,
    tree,
    path: (file) => (file === "" ? ws.root : ws.path(file)),
    call: (name, input) => invoke(name, input, { workspace }),
  };
};

const NEW = { type: "system-requirement", title: "Preview identifiers", text: "Shown before saving." };

/** What `element.list` and `element.get` of every element give, to compare before and after. */
const listed = async (opened: Opened): Promise<unknown> => {
  const list = (await opened.call("element.list", {})) as CommandOutput<"element.list">;
  const got = await Promise.all((list.elements ?? []).map((e) => opened.call("element.get", { ref: e.id })));
  return { list, got };
};

const fileSha256Of = async (opened: Opened, ref: string): Promise<string> =>
  ((await opened.call("element.get", { ref })) as CommandOutput<"element.get">).fileSha256;

/** The parts of an output that name the random UUID of a new element, masked. */
const masked = (output: Created): unknown =>
  JSON.parse(
    JSON.stringify(output)
      .replaceAll(output.element.id, "<id>")
      .replaceAll(output.element.id.slice(-12), "<tail12>")
      .replaceAll(output.element.shortId, "<short>")
      .replace(/"version":"n[12]:[0-9a-f]+"/g, '"version":"<version>"'),
  );

describe("a dry run writes nothing (SR-246 AK1)", () => {
  it("[SR-246/AK-x516] a dry run of create and update changes no file or folder, and list and get give the same", async () => {
    const opened = await open();
    const tree = await opened.tree();
    const before = await listed(opened);
    // Into the default folder of the type and into a folder that does not exist: neither is created.
    await opened.call("element.create", { ...NEW, dryRun: true });
    await opened.call("element.create", { ...NEW, folder: "new/deeper", dryRun: true });
    await opened.call("element.update", {
      ref: "SR-036",
      title: "Accept identifiers",
      text: "Changed.",
      set: { "spec-id": "SR-136" },
      removeRelations: { "derives-from": "N-001" },
      expectedFileSha256: await fileSha256Of(opened, "SR-036"),
      dryRun: true,
    });
    expect(await opened.tree()).toEqual(tree);
    expect(await listed(opened)).toEqual(before);
    // A new workspace reads the same, too.
    const again = new Workspace(opened.path(""));
    onTestFinished(() => again.close());
    expect(await invoke("element.list", {}, { workspace: again })).toEqual(
      (before as { list: unknown }).list,
    );
  });
});

describe("a dry run refuses what the command refuses (SR-246 AK2)", () => {
  it("[SR-246/AK-x4c8] invalid input, a changed file and a faulty metamodel give the same error", async () => {
    const opened = await open();
    const tree = await opened.tree();
    const errorOf = async (name: string, input: Record<string, unknown>): Promise<unknown> => {
      try {
        await opened.call(name, input);
      } catch (error) {
        return error;
      }
      throw new Error(`${name} was not refused`);
    };
    const refused = [
      ["element.create", { ...NEW, type: "no-such-type" }],
      ["element.create", { ...NEW, properties: { "spec-id": "SR-1" }, nextIdentifier: true }],
      ["element.update", { ref: "SR-036", title: "Other", expectedFileSha256: "0".repeat(64) }],
      ["element.update", { ref: "SR-036", title: "Other" }],
      ["element.update", { ref: "SR-999", set: { "spec-id": "SR-1" } }],
    ] as const;
    for (const [name, input] of refused) {
      const without = await errorOf(name, input);
      expect(without).toMatchObject({ code: expect.any(String) as unknown });
      expect([name, await errorOf(name, { ...input, dryRun: true })]).toEqual([name, without]);
    }
    expect(await opened.tree()).toEqual(tree);

    // A write command the tool refuses for a faulty metamodel (SR-011 AK3).
    const broken = await open({ files: { "metamodel/broken.yaml": "types: [" } });
    const create = async (input: Record<string, unknown>): Promise<unknown> =>
      broken.call("element.create", input).catch((error: unknown) => error);
    const refusal = await create(NEW);
    expect(refusal).toMatchObject({ code: "workspace.read-only" });
    expect(await create({ ...NEW, dryRun: true })).toEqual(refusal);
  });
});

describe("a dry run shows what the command shows (SR-246 AK3, AK4)", () => {
  it("[SR-246/AK-pwg2] a dry run gives the element, the problems and the affected count as without it", async () => {
    const dry = await open();
    const real = await open();
    const created = (await dry.call("element.create", { ...NEW, dryRun: true })) as Created;
    const written = (await real.call("element.create", NEW)) as Created;
    const pick = ({ element, problems, names }: Created): unknown =>
      masked({ element, problems, names } as Created);
    expect(pick(created)).toEqual(pick(written));
    // The new element of the type has its verification status as on a create.
    expect(created.element.verification).toEqual(written.element.verification);

    const change = {
      ref: "SR-036",
      text: "",
      set: { "spec-id": "SR-136" },
      expectedFileSha256: await fileSha256Of(dry, "SR-036"),
    };
    const updated = (await dry.call("element.update", { ...change, dryRun: true })) as Updated;
    const saved = (await real.call("element.update", change)) as Updated;
    const { answer: _a, files: _f, fileSha256: _s, ...rest } = saved;
    expect(updated).toMatchObject(rest);
    expect(updated.affected).toBe(1);
    // The emptied text is a finding of the dry run too (#677).
    expect((updated.problems ?? []).map((p) => p.code)).toContain("element.text-emptied");
  });

  it("[SR-246/AK-y5vf] the output is marked as a dry run, names the files to write and no written file", async () => {
    const opened = await open();
    const created = (await opened.call("element.create", { ...NEW, dryRun: true })) as Created;
    const tail = created.element.id.slice(-12);
    expect(created).toMatchObject({
      dryRun: true,
      files: [],
      filesToWrite: [`system-requirement/SR-${tail}.md`],
    });
    expect(created.answer).toBe(
      `Dry run: would create System Requirement ${created.element.shortId}; 1 file to write; no file written; 1 problem.`,
    );
    const into = (await opened.call("element.create", { ...NEW, folder: "new", dryRun: true })) as Created;
    expect(into.filesToWrite).toEqual([`new/SR-${into.element.id.slice(-12)}.md`]);

    const updated = (await opened.call("element.update", {
      ref: "SR-037",
      set: { "spec-id": "SR-137" },
      dryRun: true,
    })) as Updated;
    expect(updated).toMatchObject({
      dryRun: true,
      files: [],
      filesToWrite: ["requirements/SR-0000000b0037.md"],
    });
    expect(updated.answer).toBe("Dry run: would update SR-137; 1 file to write; no file written.");

    // A change that changes nothing writes nothing.
    const same = (await opened.call("element.update", {
      ref: "SR-037",
      set: { "spec-id": "SR-037" },
      dryRun: true,
    })) as Updated;
    expect(same).toMatchObject({ dryRun: true, files: [], filesToWrite: [] });
    expect(same.answer).toBe("Dry run: would update SR-037; no file to write; no file written.");

    // Without a dry run the output has neither field.
    const plain = (await opened.call("element.update", {
      ref: "SR-037",
      set: { "spec-id": "SR-037" },
    })) as Updated;
    expect(["dryRun" in plain, "filesToWrite" in plain]).toEqual([false, false]);
  });
});

describe("the file hash of a dry run of an update (SR-246 AK5)", () => {
  it("[SR-246/AK-wy8y] is that of the file as read, and an update that expects it is not refused", async () => {
    const opened = await open();
    const read = await fileSha256Of(opened, "SR-036");
    const updated = (await opened.call("element.update", {
      ref: "SR-036",
      title: "Accept identifiers",
      expectedFileSha256: read,
      dryRun: true,
    })) as Updated;
    expect(updated.fileSha256).toBe(read);
    const saved = (await opened.call("element.update", {
      ref: "SR-036",
      title: "Accept identifiers",
      expectedFileSha256: updated.fileSha256,
    })) as Updated;
    expect(saved.files).toEqual(["requirements/SR-0000000b0036.md"]);
    expect(saved.fileSha256).not.toBe(read);
  });
});

describe("the element a dry run of a create names (SR-246 AK6)", () => {
  it("[SR-246/AK-tcxn] is no element of the workspace by its ID, short ID or file", async () => {
    const opened = await open();
    const created = (await opened.call("element.create", { ...NEW, dryRun: true })) as Created;
    for (const ref of [created.element.id, created.element.shortId]) {
      await expect(opened.call("element.get", { ref })).rejects.toMatchObject({ code: "ref.unknown" });
    }
    await expect(fs.stat(opened.path(created.filesToWrite?.[0] ?? ""))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const list = (await opened.call("element.list", {})) as CommandOutput<"element.list">;
    const files = (list.elements ?? []).map((e) => e.file);
    expect(files).not.toContain(created.element.file);
  });
});

describe("the identifier of a dry run with nextIdentifier (SR-246 AK7)", () => {
  it("[SR-246/AK-jbkb] is the one a create without dry run gives at that moment", async () => {
    const opened = await open();
    const input = { ...NEW, nextIdentifier: true };
    const dry = (await opened.call("element.create", { ...input, dryRun: true })) as Created;
    expect(dry.element.properties["spec-id"]).toBe("SR-038");
    const created = (await opened.call("element.create", input)) as Created;
    expect(created.element.properties["spec-id"]).toBe("SR-038");
    // After that create, a dry run names the next one.
    const next = (await opened.call("element.create", { ...input, dryRun: true })) as Created;
    expect(next.element.properties["spec-id"]).toBe("SR-039");
  });
});

describe("a dry run refuses a file the update would refuse to replace (SR-246 AK2)", () => {
  it("[SR-246/AK-x4c8] a read-only element file gives file.read-only with and without dry run", async () => {
    const opened = await open();
    const file = opened.path("requirements/SR-0000000b0037.md");
    await fs.chmod(file, 0o444);
    onTestFinished(() => fs.chmod(file, 0o644));
    const change = { ref: "SR-037", set: { "spec-id": "SR-137" } };
    const errorOf = (input: Record<string, unknown>): Promise<unknown> =>
      opened.call("element.update", input).then(
        () => undefined,
        (error: unknown) => error,
      );
    const refusal = await errorOf(change);
    expect(refusal).toMatchObject({ code: "file.read-only" });
    expect(await errorOf({ ...change, dryRun: true })).toEqual(refusal);
  });
});

describe("the verification status of a dry run (SR-246 AK3)", () => {
  const B1 = "5e031a7d-2b4f-4c61-9d08-0b0000000001";
  const STATUS = { fixture: "SR-031/status" };

  /** Gives the workspace of `opened` the evidence records `records`, in place of those of its files. */
  const withRecords = async (opened: Opened, records: readonly EvidenceRecord[]): Promise<void> => {
    const { workspace } = opened;
    await workspace.replace(
      evidenceRecordsState,
      workspace.get(evidenceRecordsState),
      Promise.resolve(records),
    );
  };

  it("[SR-246/AK-pwg2] is measured in both normal forms of the planned bytes, as on an update", async () => {
    const change = async (opened: Opened): Promise<Record<string, unknown>> => ({
      ref: B1,
      text: "The station shows the wind speed and its gusts.",
      expectedFileSha256: await fileSha256Of(opened, B1),
    });
    // The n1 version the change gives, from an update in a copy of its own.
    const probe = await open(STATUS);
    await probe.call("element.update", await change(probe));
    const store = await probe.workspace.get(elementStoreState);
    const record = store.byId.get(B1)?.[0];
    const n1 =
      record === undefined ? undefined : (await currentVersionsOf(probe.workspace, [record])).get(record);
    expect(n1?.kind).toBe("version");
    const version = n1?.kind === "version" ? n1.forms.n1 : "";
    // A passed record of that version in n1, the form the element does not show.
    const passed: EvidenceRecord = {
      element: B1,
      version,
      kind: "verification",
      method: "test",
      item: "build-1",
      result: "passed",
      date: "2026-11-20T10:00:00Z",
    };
    const dry = await open(STATUS);
    const real = await open(STATUS);
    await withRecords(dry, [passed]);
    await withRecords(real, [passed]);
    const planned = (await dry.call("element.update", { ...(await change(dry)), dryRun: true })) as Updated;
    const saved = (await real.call("element.update", await change(real))) as Updated;
    expect(planned.element.version).toBe(saved.element.version);
    expect(planned.element.verification).toEqual(saved.element.verification);
    expect(planned.element.verification?.some((entry) => entry.status !== "open")).toBe(true);
  });

  it("[SR-246/AK-pwg2] has no version for a counted value without a normal form, as on an update", async () => {
    const files = {
      "requirements/SR-b0000000000a.md":
        "---\nid: 2b2b2b2b-2222-4222-8222-b0000000000a\ntype: system-requirement\nstatus: draft\ntitle: Endless\nverification-method: test\nweight: .inf\n---\n\nText.\n",
    };
    const prepared = async (): Promise<Opened> => {
      const opened = await open({ fixture: "SR-019/findings", files });
      const model = await fs.readFile(opened.path("metamodel/model.yaml"), "utf8");
      await fs.writeFile(
        opened.path("metamodel/model.yaml"),
        model.replace(
          "{ key: weight, name: Weight, kind: number }",
          "{ key: weight, name: Weight, kind: number, content: true }",
        ),
      );
      return opened;
    };
    const dry = await prepared();
    const real = await prepared();
    const change = { ref: "SR-00000a", set: { "verification-method": "test" }, title: "Endless gusts" };
    const planned = (await dry.call("element.update", {
      ...change,
      expectedFileSha256: await fileSha256Of(dry, "SR-00000a"),
      dryRun: true,
    })) as Updated;
    const saved = (await real.call("element.update", {
      ...change,
      expectedFileSha256: await fileSha256Of(real, "SR-00000a"),
    })) as Updated;
    expect(planned.element.version).toBeUndefined();
    expect([planned.element.verification, planned.element.problems]).toEqual([
      saved.element.verification,
      saved.element.problems,
    ]);
  });
});

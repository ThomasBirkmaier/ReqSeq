// A repeated ReqIF import whose write fails part way (SR-056, ADR-0013 "Import"): every step it
// already took is undone, nothing that was there before is deleted (D-045), and what could not be
// undone is named in `details.written`. The failing steps are simulated.
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import type * as FilesWrite from "../../files/write.js";
import type * as ModelWrite from "../../model/write.js";
import type * as NewFiles from "../../model/new-files.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

const fail = vi.hoisted(
  (): {
    copies: Error | undefined;
    /** The copy call (one per repository, from 1) that fails. */
    copiesAt: number;
    copyCalls: number;
    updates: Error | undefined;
    creates: (() => Promise<Error>) | undefined;
  } => ({ copies: undefined, copiesAt: 1, copyCalls: 0, updates: undefined, creates: undefined }),
);

vi.mock("../../files/write.js", async (importOriginal) => {
  const original = await importOriginal<typeof FilesWrite>();
  return {
    ...original,
    createFilesAtomic: async (...args: Parameters<typeof original.createFilesAtomic>) => {
      // The copies of updated elements are the only call with images alone.
      if (fail.copies !== undefined && args[1].every((f) => f.path.endsWith(".png"))) {
        fail.copyCalls += 1;
        if (fail.copyCalls >= fail.copiesAt) {
          throw fail.copies;
        }
      }
      return original.createFilesAtomic(...args);
    },
  };
});
vi.mock("../../model/write.js", async (importOriginal) => {
  const original = await importOriginal<typeof ModelWrite>();
  return {
    ...original,
    writeElementFiles: async (...args: Parameters<typeof original.writeElementFiles>) => {
      if (fail.updates !== undefined) {
        throw fail.updates;
      }
      return original.writeElementFiles(...args);
    },
  };
});
vi.mock("../../model/new-files.js", async (importOriginal) => {
  const original = await importOriginal<typeof NewFiles>();
  return {
    ...original,
    createElementFiles: async (...args: Parameters<typeof original.createElementFiles>) => {
      if (fail.creates !== undefined) {
        throw await fail.creates();
      }
      return original.createElementFiles(...args);
    },
  };
});

afterEach(() => {
  fail.copies = undefined;
  fail.copiesAt = 1;
  fail.copyCalls = 0;
  fail.updates = undefined;
  fail.creates = undefined;
});

const sample = (name: string): string =>
  readFileSync(new URL(`../../../../../fixtures/SR-056/delivery/${name}`, import.meta.url), "utf8");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const DELIVERY_2 = sample("lieferung-2.reqif").replace(
  "The station measures the wind speed every 10 s.",
  'The station measures the wind speed every 10 s. <xhtml:object data="img/a.png" type="image/png">a</xhtml:object>',
);

/** Delivery 1 imported; delivery 2 updates REQ-1 with an image copy, REQ-2 and REQ-3, and creates REQ-5. */
const delivered = async (): Promise<{
  workspace: Workspace;
  root: string;
  files: () => Promise<string[]>;
}> => {
  const fixture = await createFixtureWorkspace({
    fixture: "SR-004/one-repository",
    files: {
      "in/1.reqif": sample("lieferung-1.reqif"),
      "in/2.reqif": DELIVERY_2,
      "reqif/kunde-a.yaml": sample("kunde-a.yaml"),
    },
  });
  onTestFinished(() => fixture.cleanup());
  await fs.mkdir(fixture.path("in/img"));
  await fs.writeFile(fixture.path("in/img/a.png"), PNG);
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  await invoke(
    "reqif.import",
    { file: "in/1.reqif", mapping: "reqif/kunde-a.yaml", delivery: "D1" },
    { workspace },
  );
  const folder = fixture.path("Kunde-A");
  const files = async (): Promise<string[]> => {
    const out: string[] = [];
    for (const entry of await fs.readdir(folder, { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) {
        const file = path.join(entry.parentPath, entry.name);
        out.push(`${path.relative(folder, file)} ${(await fs.readFile(file)).toString("base64")}`);
      }
    }
    return out.sort();
  };
  return { workspace, root: fixture.root, files };
};

const importTwo = async (workspace: Workspace): Promise<unknown> =>
  invoke(
    "reqif.import",
    { file: "in/2.reqif", mapping: "reqif/kunde-a.yaml", delivery: "D2" },
    { workspace },
  ).catch((e: unknown) => e);

describe("a repeated ReqIF import that fails while writing (SR-056)", () => {
  it("restores the updated files and removes the image copies when the new files fail", async () => {
    const { workspace, files } = await delivered();
    const before = await files();
    fail.creates = () => Promise.resolve(new CommandError("file.read-only", "simulated"));
    const error = await importTwo(workspace);
    expect(error).toBeInstanceOf(CommandError);
    expect([(error as CommandError).code, (error as CommandError).details?.["written"]]).toEqual([
      "file.read-only",
      undefined,
    ]);
    expect(await files()).toEqual(before);
    // The store was read again: a new import works.
    fail.creates = undefined;
    const out = (await importTwo(workspace)) as CommandOutput<"reqif.import">;
    expect(out.created.map((c) => c.identifier)).toEqual(["REQ-5"]);
  });

  it.each([[["Kunde-A/elsewhere.md"]], [undefined]])(
    "names an updated file and an image copy that changed after the write and are therefore left (written %j)",
    async (written) => {
      const { workspace, root } = await delivered();
      const changed: string[] = [];
      fail.creates = async () => {
        // Someone edits an updated file and the new image copy between the write and the rollback.
        const folder = path.join(root, "Kunde-A");
        const names = (await fs.readdir(folder)).filter((f) => f.endsWith(".md"));
        const contents = await Promise.all(names.map((f) => fs.readFile(path.join(folder, f), "utf8")));
        const one = String(names[contents.findIndex((c) => c.includes("source-identifier: REQ-1\n"))]);
        changed.push(`Kunde-A/${one}`, `Kunde-A/${one.slice(0, -".md".length)}/a.png`);
        for (const file of changed) {
          await fs.appendFile(path.join(root, file), "edited meanwhile\n");
        }
        return new CommandError("file.read-only", "simulated", written === undefined ? {} : { written });
      };
      const error = (await importTwo(workspace)) as CommandError;
      expect(error.code).toBe("file.read-only");
      expect(error.details?.["written"]).toEqual([...(written ?? []), ...changed]);
    },
  );

  it("removes the image copies when the updates fail, and passes an error that is no CommandError on", async () => {
    const { workspace, files } = await delivered();
    const before = await files();
    fail.updates = new Error("disk gone");
    const error = await importTwo(workspace);
    // The access layer reports it as internal (catalog.ts).
    expect((error as CommandError).code).toBe("internal");
    expect(await files()).toEqual(before);
  });

  it("removes the copies it made when copying an image of an updated element fails", async () => {
    const { workspace, files } = await delivered();
    const before = await files();
    fail.copies = new CommandError("file.read-only", "simulated copy");
    const error = (await importTwo(workspace)) as CommandError;
    expect([error.code, error.message]).toEqual(["file.read-only", "simulated copy"]);
    expect(await files()).toEqual(before);
  });

  it("removes the copies in one repository when copying into the next one fails", async () => {
    const fixture = await createFixtureWorkspace({
      fixture: "SR-004/three-repositories",
      files: {
        "system/in/1.reqif": sample("lieferung-1.reqif"),
        "system/in/2.reqif": DELIVERY_2.replace(
          "The station stores the wind speed for 30 days.",
          'The station stores the wind speed for 30 days. <xhtml:object data="img/a.png" type="image/png">a</xhtml:object>',
        ),
        "system/reqif/kunde-a.yaml": sample("kunde-a.yaml"),
      },
    });
    onTestFinished(() => fixture.cleanup());
    await fs.mkdir(fixture.path("system/in/img"));
    await fs.writeFile(fixture.path("system/in/img/a.png"), PNG);
    const first = new Workspace(fixture.path("system"));
    onTestFinished(() => first.close());
    const out = (await invoke(
      "reqif.import",
      { file: "in/1.reqif", mapping: "reqif/kunde-a.yaml", delivery: "D1" },
      { workspace: first },
    )) as CommandOutput<"reqif.import">;
    // REQ-1 lives in sensor now, REQ-3 stays in system: one copy per repository.
    const one = String(out.files[0]);
    await fs.rename(fixture.path(`system/${one}`), fixture.path(`sensor/${path.basename(one)}`));
    const workspace = new Workspace(fixture.path("system"));
    onTestFinished(() => workspace.close());
    fail.copies = new CommandError("file.read-only", "simulated second copy");
    fail.copiesAt = 2;
    const error = (await importTwo(workspace)) as CommandError;
    expect([error.code, error.details?.["written"], fail.copyCalls]).toEqual([
      "file.read-only",
      undefined,
      2,
    ]);
    for (const folder of ["sensor", "system/Kunde-A"]) {
      const copies = await fs.readdir(fixture.path(folder), { recursive: true });
      expect(copies.filter((f) => f.endsWith(".png"))).toEqual([]);
    }
  });
});

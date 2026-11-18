// A ReqIF import whose save of the source model fails (SR-158, ADR-0013 "Import"): the element
// writes before it are undone, so the import stays all or nothing. The failing write is simulated.
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { CommandError } from "../../catalog.js";
import type * as FilesWrite from "../../files/write.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

const fail = vi.hoisted((): { mapping: boolean } => ({ mapping: false }));

vi.mock("../../files/write.js", async (importOriginal) => {
  const original = await importOriginal<typeof FilesWrite>();
  return {
    ...original,
    writeFileAtomic: async (...args: Parameters<typeof original.writeFileAtomic>) => {
      if (fail.mapping && args[1].endsWith("kunde-a.yaml")) {
        throw new CommandError("file.read-only", "simulated");
      }
      return original.writeFileAtomic(...args);
    },
  };
});

afterEach(() => {
  fail.mapping = false;
});

const sample = (name: string): string =>
  readFileSync(new URL(`../../../../../fixtures/SR-056/delivery/${name}`, import.meta.url), "utf8");
const MAPPING = sample("kunde-a.yaml");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const IMAGE = '<xhtml:object data="img/a.png" type="image/png">a</xhtml:object>';
/** Delivery 2 with an image in the changed REQ-1 and in the new REQ-5. */
const DELIVERY_2 = sample("lieferung-2.reqif")
  .replace(
    "The station measures the wind speed every 10 s.",
    `The station measures the wind speed every 10 s. ${IMAGE}`,
  )
  .replace("The station warns above 20 m/s.", `The station warns above 20 m/s. ${IMAGE}`);

/** Every file below the folder of the source, with its bytes. */
const filesOf = async (root: string): Promise<string[]> => {
  const folder = path.join(root, "Kunde-A");
  const out: string[] = [];
  for (const entry of await fs.readdir(folder, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const file = path.join(entry.parentPath, entry.name);
      out.push(`${path.relative(folder, file)} ${(await fs.readFile(file)).toString("base64")}`);
    }
  }
  return out.sort();
};

const importOf = (workspace: Workspace, file: string, delivery: string): Promise<unknown> =>
  invoke("reqif.import", { file, mapping: "reqif/kunde-a.yaml", delivery }, { workspace }).catch(
    (e: unknown) => e,
  );

describe("a ReqIF import whose source model cannot be saved (SR-158)", () => {
  it("restores the updated files and removes the new files and image copies, and leaves the mapping", async () => {
    const fixture = await createFixtureWorkspace({
      fixture: "SR-004/one-repository",
      files: {
        "in/1.reqif": sample("lieferung-1.reqif"),
        "in/2.reqif": DELIVERY_2,
        "reqif/kunde-a.yaml": MAPPING,
      },
    });
    onTestFinished(() => fixture.cleanup());
    await fs.mkdir(fixture.path("in/img"));
    await fs.writeFile(fixture.path("in/img/a.png"), PNG);
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    expect(await importOf(workspace, "in/1.reqif", "D1")).not.toBeInstanceOf(Error);
    // Without its source model again, so delivery 2 has one to save.
    await fs.writeFile(fixture.path("reqif/kunde-a.yaml"), MAPPING);
    const before = await filesOf(fixture.root);
    fail.mapping = true;
    const error = await importOf(workspace, "in/2.reqif", "D2");
    expect(error).toBeInstanceOf(CommandError);
    expect([(error as CommandError).code, (error as CommandError).details?.["written"]]).toEqual([
      "file.read-only",
      undefined,
    ]);
    // No image copy and no new file is left; the image folders the call made stay, empty (#530).
    expect(await filesOf(fixture.root)).toEqual(before);
    expect(await fs.readFile(fixture.path("reqif/kunde-a.yaml"), "utf8")).toBe(MAPPING);
    const listed = (await invoke("element.list", {}, { workspace })) as { elements: unknown[] };
    expect(listed.elements.length).toBeGreaterThan(0);
  });

  it("undoes the updates of a delivery that creates nothing", async () => {
    const fixture = await createFixtureWorkspace({
      fixture: "SR-004/one-repository",
      files: {
        "in/1.reqif": sample("lieferung-1.reqif"),
        "in/1b.reqif": sample("lieferung-1.reqif").replace("stores the wind speed.", "stores the gusts."),
        "reqif/kunde-a.yaml": MAPPING,
      },
    });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    expect(await importOf(workspace, "in/1.reqif", "D1")).not.toBeInstanceOf(Error);
    await fs.writeFile(fixture.path("reqif/kunde-a.yaml"), MAPPING);
    const before = await filesOf(fixture.root);
    fail.mapping = true;
    fail.mapping = false;
    const preview = (await invoke(
      "reqif.analyze",
      { file: "in/1b.reqif", mapping: "reqif/kunde-a.yaml" },
      { workspace },
    )) as { changed: unknown[] };
    expect(preview.changed).toHaveLength(1);
    fail.mapping = true;
    const error = await importOf(workspace, "in/1b.reqif", "D1b");
    expect((error as CommandError).code).toBe("file.read-only");
    expect(await filesOf(fixture.root)).toEqual(before);
  });
});

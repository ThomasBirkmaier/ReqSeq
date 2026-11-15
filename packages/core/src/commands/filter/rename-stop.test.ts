// filter.rename (SR-217 AK7) when a write fails part-way, or a folder is not writable: the write of
// one file and the writability of a folder are made to fail here, as a full disk or a permission
// would.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { CommandError } from "../../catalog.js";
import type * as files from "../../files/index.js";
import type * as workspaceBlock from "../../workspace/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

const fail = vi.hoisted(() => ({
  write: undefined as string | undefined,
  rename: false,
  back: false,
  folder: undefined as string | undefined,
}));

vi.mock("../../files/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof files>();
  return {
    ...actual,
    writeFileAtomic: (...args: Parameters<typeof actual.writeFileAtomic>) =>
      args[1] === fail.write
        ? Promise.reject(new CommandError("internal", `Not written: ${args[1]} (ENOSPC)`))
        : actual.writeFileAtomic(...args),
    renameFileAtomic: (...args: Parameters<typeof actual.renameFileAtomic>) =>
      fail.rename || (fail.back && args[1] === fail.write)
        ? Promise.reject(new Error("not a command error"))
        : actual.renameFileAtomic(...args),
  };
});

vi.mock("../../workspace/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof workspaceBlock>();
  return {
    ...actual,
    isWritableFolder: async (folder: string) =>
      fail.folder !== undefined && folder.endsWith(fail.folder) ? false : actual.isWritableFolder(folder),
  };
});

const SENSORS = "reqseq-filter: 1\nname: Sensors\nwhere: { package: PKG-0000d1 }\n";
const perspective = (name: string, filter = "Sensors"): string =>
  `reqseq-perspective: 1\nname: ${name}\nfilter: ${filter}\nwhere: { all: [] }\n`;

const open = async (): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> => {
  const fixture = await createFixtureWorkspace({
    fixture: "SR-069/filter",
    files: {
      "filters/sensors.yaml": SENSORS,
      "perspectives/a.yaml": perspective("A"),
      "perspectives/b.yaml": perspective("B"),
    },
  });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  onTestFinished(() => {
    fail.write = undefined;
    fail.rename = false;
    fail.back = false;
    fail.folder = undefined;
  });
  return { fixture, workspace };
};

const rename = (workspace: Workspace): Promise<unknown> =>
  invoke("filter.rename", { name: "Sensors", newName: "Sensor package" }, { workspace });

const read = (fixture: FixtureWorkspace, file: string): Promise<string> =>
  fs.readFile(fixture.path(file), "utf8").catch(() => "(none)");

describe("filter.rename that stops part-way (SR-217)", () => {
  it("[SR-217/AK-q14p] names the files already changed and the file that failed, and the same call again finishes the rename", async () => {
    const { fixture, workspace } = await open();
    fail.write = "perspectives/b.yaml";
    const error = (await rename(workspace).catch((e: unknown) => e)) as CommandError;
    expect([error.code, error.message, error.details]).toEqual([
      "internal",
      "Not written: perspectives/b.yaml (ENOSPC). Already changed: perspectives/a.yaml; the same call again finishes the rename",
      { written: ["perspectives/a.yaml"] },
    ]);
    expect(await read(fixture, "perspectives/a.yaml")).toBe(perspective("A", "Sensor package"));
    expect(await read(fixture, "filters/sensors.yaml")).toBe(SENSORS);

    // The renamed file whose name line cannot be written is renamed back.
    fail.write = "filters/sensor-package.yaml";
    const stopped = (await rename(workspace).catch((e: unknown) => e)) as CommandError;
    expect(stopped.details).toEqual({ written: ["perspectives/b.yaml"] });
    expect(await read(fixture, "filters/sensors.yaml")).toBe(SENSORS);
    expect(await read(fixture, "filters/sensor-package.yaml")).toBe("(none)");

    fail.write = undefined;
    expect(await rename(workspace)).toEqual({
      files: ["filters/sensor-package.yaml"],
      renamed: [{ from: "filters/sensors.yaml", to: "filters/sensor-package.yaml" }],
      perspectives: [],
      problems: [],
    });
    expect(await read(fixture, "filters/sensor-package.yaml")).toBe(
      SENSORS.replace("Sensors", "Sensor package"),
    );
    expect(await read(fixture, "perspectives/b.yaml")).toBe(perspective("B", "Sensor package"));
  });

  it("[SR-217/AK-q14p] keeps a file that hides a duplicate of its old name from taking over, and names a file that cannot be renamed back", async () => {
    const { fixture, workspace } = await open();
    await fs.writeFile(fixture.path("filters/zz.yaml"), SENSORS);
    fail.write = "filters/sensor-package.yaml";
    await rename(workspace).catch(() => undefined);
    fail.write = undefined;
    // The same call again renames the file it renamed before, not the duplicate it hides.
    expect(((await rename(workspace)) as { renamed: unknown }).renamed).toEqual([
      { from: "filters/sensors.yaml", to: "filters/sensor-package.yaml" },
    ]);
    expect(await read(fixture, "filters/zz.yaml")).toBe(SENSORS);

    const again = await open();
    fail.write = "filters/sensor-package.yaml";
    fail.back = true;
    const error = (await rename(again.workspace).catch((e: unknown) => e)) as CommandError;
    expect(error.details).toEqual({
      written: ["perspectives/a.yaml", "perspectives/b.yaml", "filters/sensor-package.yaml"],
    });
    expect(error.message).toContain("filters/sensor-package.yaml keeps the old name in its file");
  });

  it("[SR-217/AK-q14p] passes on an error that is no command error, and a failure of the first write as it is", async () => {
    const { workspace } = await open();
    fail.write = "perspectives/a.yaml";
    const first = (await rename(workspace).catch((e: unknown) => e)) as CommandError;
    expect([first.message, first.details]).toEqual(["Not written: perspectives/a.yaml (ENOSPC)", undefined]);
    fail.write = undefined;
    fail.rename = true;
    const other = (await rename(workspace).catch((e: unknown) => e)) as CommandError;
    expect([other.code, other.details]).toEqual(["internal", { command: "filter.rename" }]);
  });

  it("[SR-217/AK-q14p] refuses before the first write when a folder to write into is not writable", async () => {
    const { fixture, workspace } = await open();
    fail.folder = "filters";
    const error = (await rename(workspace).catch((e: unknown) => e)) as CommandError;
    expect([error.code, error.details]).toEqual([
      "file.read-only",
      { repository: "system", folder: "filters" },
    ]);
    expect(await read(fixture, "perspectives/a.yaml")).toBe(perspective("A"));
  });
});

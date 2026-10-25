// Errors that are bugs, not findings, are passed on by the current versions (#259): only
// `file.faulty` from the image lookup and the RangeError of a value without a normal form become
// entries without a version. Everything else rejects, and a check that failed is not kept for the
// next caller. The image lookup and the version are replaced by stand-ins that fail on request.
import { createFixtureWorkspace } from "@logreq/testkit";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { Workspace } from "../runtime/workspace.js";
import { currentVersions } from "./current-versions.js";
import type * as Images from "./images.js";
import type * as View from "./view.js";

const failures = vi.hoisted(() => ({
  images: undefined as Error | undefined,
  version: undefined as Error | undefined,
}));

vi.mock("./images.js", async (original) => {
  const real = await original<typeof Images>();
  return {
    ...real,
    lookUpImages: (...args: Parameters<typeof real.lookUpImages>) =>
      failures.images === undefined ? real.lookUpImages(...args) : Promise.reject(failures.images),
  };
});

vi.mock("./view.js", async (original) => {
  const real = await original<typeof View>();
  return {
    ...real,
    elementVersion: (...args: Parameters<typeof real.elementVersion>) => {
      if (failures.version !== undefined) {
        throw failures.version;
      }
      return real.elementVersion(...args);
    },
  };
});

afterEach(() => {
  failures.images = undefined;
  failures.version = undefined;
});

const open = async (): Promise<{
  write: (file: string, text: string) => Promise<void>;
  workspace: Workspace;
}> => {
  const fixture = await createFixtureWorkspace({
    fixture: "SR-019/findings",
    files: {
      "pictures/N-c00000000001.md":
        "---\nid: 7c7c7c7c-7777-4777-8777-c00000000001\ntype: need\nstatus: draft\ntitle: Pictured\n---\n\n![a](img/a.png)\n",
      "pictures/img/a.png": "A",
    },
  });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { write: (file, text) => fixture.write(file, text), workspace };
};

describe("errors of the current versions that are bugs (#259)", () => {
  it("passes on an image lookup that fails with anything but file.faulty", async () => {
    const { workspace } = await open();
    failures.images = new Error("bug in the image lookup");
    await expect(currentVersions(workspace)).rejects.toThrow("bug in the image lookup");
  });

  it("passes on a version that fails with anything but a RangeError", async () => {
    const { workspace } = await open();
    failures.version = new Error("bug in the version");
    await expect(currentVersions(workspace)).rejects.toThrow("bug in the version");
  });

  it("does not keep a check that failed: the next caller checks again", async () => {
    const { write, workspace } = await open();
    await currentVersions(workspace);
    await write("pictures/img/a.png", "AA");
    failures.images = new Error("bug in the image lookup");
    await expect(currentVersions(workspace)).rejects.toThrow("bug in the image lookup");
    failures.images = undefined;
    const versions = await currentVersions(workspace);
    expect([...versions.byRecord.values()].filter((v) => v.kind === "version").length).toBeGreaterThan(0);
  });
});

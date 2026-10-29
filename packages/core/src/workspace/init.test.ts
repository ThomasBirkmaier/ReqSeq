import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { CommandError } from "../catalog.js";
import type * as FilesBlock from "../files/index.js";
import { writeFileAtomic } from "../files/index.js";
import { WORKSPACE_FILE } from "./config.js";
import { FALLBACK_REPOSITORY_NAME, createWorkspace, repositoryNameFor } from "./init.js";

// The real files block, with writeFileAtomic wrapped so that a test can make one write fail.
vi.mock("../files/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof FilesBlock>();
  return { ...original, writeFileAtomic: vi.fn(original.writeFileAtomic) };
});

afterEach(() => {
  vi.mocked(writeFileAtomic).mockReset();
});

describe("repositoryNameFor", () => {
  it("builds the main repository's name from the folder name", () => {
    expect(repositoryNameFor("/work/Weather Station")).toBe("weather-station");
    expect(repositoryNameFor("/work/Müller_Ölpumpe.v2")).toBe("muller_olpumpe.v2");
    expect(repositoryNameFor("/work/--Sensor  (Pro)--")).toBe("sensor-pro");
    expect(repositoryNameFor("/work/system")).toBe("system");
  });

  it("falls back to main when the folder name has no letter or digit", () => {
    expect(repositoryNameFor("/work/測試")).toBe(FALLBACK_REPOSITORY_NAME);
    expect(repositoryNameFor("/")).toBe("main");
  });
});

describe("createWorkspace when the workspace file cannot be written", () => {
  const model = { name: "standard-model.yaml", text: "reqseq-metamodel: 1\n" };

  /** Lets the first `failAt - 1` writes through and fails the next one with `error`. */
  const failWrite = async (failAt: number, error: unknown): Promise<void> => {
    const real = (await vi.importActual<typeof FilesBlock>("../files/index.js")).writeFileAtomic;
    let calls = 0;
    vi.mocked(writeFileAtomic).mockImplementation(async (...args) => {
      calls += 1;
      if (calls === failAt) {
        throw error;
      }
      return real(...args);
    });
  };

  const folder = async (): Promise<string> => {
    const ws = await createFixtureWorkspace();
    onTestFinished(() => ws.cleanup());
    return ws.root;
  };

  it("names the metamodel file that was written before, with the code of the failure", async () => {
    await failWrite(2, new CommandError("file.read-only", "Not written: reqseq-workspace.yaml is read-only"));
    const error = await createWorkspace(await folder(), { name: "W", metamodelFile: model }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(CommandError);
    expect(error).toMatchObject({
      code: "file.read-only",
      message:
        "Not written: reqseq-workspace.yaml is read-only; metamodel/standard-model.yaml was written already and is left in place; remove it before running workspace.init again.",
      details: { written: ["metamodel/standard-model.yaml"] },
    });
  });

  it("passes the failure on unchanged when nothing was written before it, or when it is no CommandError", async () => {
    const readOnly = new CommandError("file.read-only", "Not written", { file: WORKSPACE_FILE });
    await failWrite(1, readOnly);
    const own = { name: "W", metamodel: { repository: "metamodel" }, metamodelFile: model };
    await expect(createWorkspace(await folder(), own)).rejects.toBe(readOnly);
    const plain = new Error("disk gone");
    await failWrite(2, plain);
    await expect(createWorkspace(await folder(), { name: "W", metamodelFile: model })).rejects.toBe(plain);
  });
});

import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { metamodelState } from "../metamodel/index.js";
import { elementStoreState, shortIdState } from "../model/index.js";
import { answerNames } from "./answer-names.js";
import { Workspace } from "./workspace.js";

const WIND = "e8df96ea-a168-4d90-8d65-6328cee88fb3";
const GUST_ALARM = "22200000-0000-4000-8000-0000000000d1";

const open = async (fixture: string): Promise<Workspace> => {
  const repository = await createFixtureWorkspace({ fixture });
  const workspace = new Workspace(repository.root);
  onTestFinished(async () => {
    await workspace.close();
    await repository.cleanup();
  });
  return workspace;
};

describe("the names of an answer (SR-224 AK1)", () => {
  it("names an element of the input by its identifier, else its short ID, from the states the command left (#1998)", async () => {
    const criteria = await open("SR-222/criteria");
    await criteria.get(shortIdState);
    const names = await answerNames(criteria);
    // A UUID, the short ID and the identifier in any case give the same name; so does the copy a command takes.
    expect([
      names.element("22200000-0000-4000-8000-0000000000D1"),
      names.element("SR-0000d1"),
      names.element("sr-036"),
      names.element(GUST_ALARM, { repository: undefined, file: "requirements/SR-0000000000d1.md" }),
    ]).toEqual(["SR-036", "SR-036", "SR-036", "SR-036"]);
    // A reference that names no element, or none in the copy, stays as given.
    expect([names.element("SR-ffffff"), names.element(GUST_ALARM, { file: "elsewhere.md" })]).toEqual([
      "SR-ffffff",
      GUST_ALARM,
    ]);
    expect(names.type("system-requirement")).toBe("System Requirement");

    const plain = await open("SR-001/two-elements");
    await plain.get(shortIdState);
    expect((await answerNames(plain)).element(WIND)).toBe("SR-e88fb3");
  });

  it("waits for the short IDs a command started, and builds none for an answer", async () => {
    const started = await open("SR-222/criteria");
    await Promise.all([started.get(elementStoreState), started.get(metamodelState)]);
    void started.get(shortIdState);
    expect((await answerNames(started)).element(GUST_ALARM)).toBe("SR-036");

    const without = await open("SR-222/criteria");
    await Promise.all([without.get(elementStoreState), without.get(metamodelState)]);
    expect((await answerNames(without)).element(GUST_ALARM)).toBe(GUST_ALARM);
    expect(without.peek(shortIdState)).toBeUndefined();
  });

  it("names an element by the reference as given, and a type by its key, when no command read the workspace or a state failed", async () => {
    const workspace = await open("SR-222/criteria");
    const fresh = await answerNames(workspace);
    expect([fresh.element(GUST_ALARM), fresh.type("system-requirement")]).toEqual([
      GUST_ALARM,
      "system-requirement",
    ]);
    await workspace.get(shortIdState);
    const peek = vi.spyOn(workspace, "peek");
    peek.mockReturnValue(Promise.reject(new Error("reset")));
    const failed = await answerNames(workspace);
    expect([failed.element(GUST_ALARM), failed.type("system-requirement")]).toEqual([
      GUST_ALARM,
      "system-requirement",
    ]);
    // Short IDs that failed while the store is there.
    peek.mockImplementation((key) =>
      key === shortIdState ? Promise.reject(new Error("reset")) : workspace.get(key),
    );
    expect((await answerNames(workspace)).element(GUST_ALARM)).toBe(GUST_ALARM);
    // The metamodel failed: the short IDs cannot be matched to it.
    peek.mockImplementation((key) =>
      key === metamodelState ? Promise.reject(new Error("reset")) : workspace.get(key),
    );
    expect((await answerNames(workspace)).element(GUST_ALARM)).toBe(GUST_ALARM);
  });

  it("fails on an error other than an unknown or ambiguous reference, which is a bug", async () => {
    const workspace = await open("SR-222/criteria");
    const shortIds = await workspace.get(shortIdState);
    vi.spyOn(shortIds, "identifierOf").mockImplementation(() => {
      throw new TypeError("broken");
    });
    const names = await answerNames(workspace);
    expect(() => names.element(GUST_ALARM)).toThrow("broken");
  });
});

// The order of nextIdentifier (SR-245 AK2, AK3) on a store built by hand: repositories in the order
// of the workspace file need not be in the order of their names, which decides a tie.
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { findType, metamodelState } from "../metamodel/index.js";
import type { Metamodel } from "../metamodel/index.js";
import { Workspace } from "../runtime/workspace.js";
import type { ElementRecord } from "./elements.js";
import { nextIdentifier } from "./next-identifier.js";
import type { ElementStore } from "./store.js";
import { elementStoreState } from "./store.js";

interface Base {
  readonly metamodel: Metamodel;
  readonly template: ElementRecord;
}

/** The metamodel of fixtures/enabler-305/identifiers and one of its requirements as a template. */
const base = async (): Promise<Base> => {
  const ws = await createFixtureWorkspace({ fixture: "enabler-305/identifiers" });
  onTestFinished(() => ws.cleanup());
  const workspace = new Workspace(ws.root);
  onTestFinished(() => workspace.close());
  const store = await workspace.get(elementStoreState);
  const template = store.elements.find((e) => e.type === "system-requirement");
  if (template === undefined) {
    throw new Error("fixture without a requirement");
  }
  return { metamodel: await workspace.get(metamodelState), template };
};

/** Requirements with these identifiers (none for undefined), in this order, in `repository`/`file`. */
const storeOf = (
  template: ElementRecord,
  entries: readonly (readonly [string, string, string | undefined])[],
): ElementStore =>
  ({
    elements: entries.map(([repository, file, specId]) => ({
      ...template,
      repository,
      file,
      data: specId === undefined ? {} : { "spec-id": specId },
    })),
  }) as unknown as ElementStore;

const next = async (
  entries: readonly (readonly [string, string, string | undefined])[],
  prefix?: string,
): Promise<string> => {
  const { metamodel, template } = await base();
  const type = findType(metamodel, "system-requirement");
  if (type === undefined) {
    throw new Error("no type");
  }
  return nextIdentifier(storeOf(template, entries), metamodel, type, {}, prefix).identifier;
};

describe("nextIdentifier", () => {
  it("[SR-245/AK-w5bw] takes, among equal identifiers, the one of the repository first by name, in either order of the workspace file", async () => {
    expect(
      await next([
        ["zeta", "a.md", "SR-5"],
        ["alpha", "b.md", "sr-5"],
        ["alpha", "c.md", undefined],
      ]),
    ).toBe("sr-6");
    expect(
      await next([
        ["alpha", "b.md", "sr-5"],
        ["zeta", "a.md", "SR-5"],
      ]),
    ).toBe("sr-6");
    expect(
      await next([
        ["alpha", "c.md", "SR-5"],
        ["alpha", "b.md", "sr-5"],
      ]),
    ).toBe("sr-6");
  });

  it("[SR-245/AK-zh91] lists prefixes with as many identifiers in ascending order in any case, whatever order they come in", async () => {
    for (const order of [
      ["b-1", "A-1", "c-1"],
      ["c-1", "b-1", "A-1"],
    ]) {
      await expect(
        next(order.map((id, index) => ["spec", `${String(index)}.md`, id] as const)),
      ).rejects.toMatchObject({ details: { prefixes: ["A-", "b-", "c-"] } });
    }
  });
});

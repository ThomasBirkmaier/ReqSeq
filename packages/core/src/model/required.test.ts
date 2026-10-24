import { createFixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { Metamodel } from "../metamodel/index.js";
import { metamodelState } from "../metamodel/index.js";
import { Workspace } from "../runtime/workspace.js";
import type { ElementRecord } from "./elements.js";
import { allRequiredFindings, requiredFindings } from "./required.js";
import { valueFindings } from "./values.js";
import type { ElementStore } from "./store.js";
import { elementStoreState } from "./store.js";

const MODEL = [
  "logreq-metamodel: 1",
  "types:",
  "  - { key: base, name: Base, prefix: B, properties: [title, tags], required: [title, tags] }",
  "  - { key: derived, name: Derived, prefix: D, extends: base, properties: [weight], required: [weight] }",
  "properties:",
  "  - { key: title, name: Title, kind: text, meaning: title }",
  "  - { key: tags, name: Tags, kind: text, many: true }",
  "  - { key: weight, name: Weight, kind: number }",
  "statuses:",
  "  - { key: draft, name: Draft, initial: true }",
  "",
].join("\n");

const WORKSPACE =
  "logreq-workspace: 1\nname: W\nrepositories:\n  - { name: system, url: x, main: true }\nmetamodel: { repository: system, path: metamodel }\n";

const loaded = async (): Promise<{ metamodel: Metamodel; store: ElementStore }> => {
  const fixture = await createFixtureWorkspace({
    files: { "logreq-workspace.yaml": WORKSPACE, "metamodel/model.yaml": MODEL },
  });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { metamodel: await workspace.get(metamodelState), store: await workspace.get(elementStoreState) };
};

const record = (type: string, data: Readonly<Record<string, unknown>>): ElementRecord => ({
  id: "0b7c6e1a-1111-4222-8333-444455556666",
  type,
  repository: "system",
  file: "x.md",
  data: { id: "0b7c6e1a-1111-4222-8333-444455556666", type, status: "draft", ...data },
  eol: "\n",
  closingEol: "\n",
  bom: false,
  snapshot: { path: "x.md", size: 0, mtimeMs: 0, sha256: "0".repeat(64) },
});

const keys = (element: ElementRecord, metamodel: Metamodel): readonly unknown[] =>
  requiredFindings(element, metamodel).map((f) => f.path[0]);

describe("requiredFindings", () => {
  it("[SR-015/AK3] reports a required property that is absent, null, blank or an empty list", async () => {
    const { metamodel } = await loaded();
    expect(keys(record("base", {}), metamodel)).toEqual(["title", "tags"]);
    expect(keys(record("base", { title: null, tags: [] }), metamodel)).toEqual(["title", "tags"]);
    expect(keys(record("base", { title: "  ", tags: ["a"] }), metamodel)).toEqual(["title"]);
    expect(keys(record("base", { title: "x", tags: ["a"] }), metamodel)).toEqual([]);
    // Inherited required properties come first; 0 is a value.
    expect(keys(record("derived", {}), metamodel)).toEqual(["title", "tags", "weight"]);
    expect(keys(record("derived", { title: "x", tags: ["a"], weight: 0 }), metamodel)).toEqual([]);
  });

  it("[SR-015/AK3] gives one hint for an empty value of a required number, not also a wrong value kind", async () => {
    const { metamodel } = await loaded();
    for (const weight of ["", "  ", []]) {
      const element = record("derived", { title: "x", tags: ["a"], weight });
      expect(keys(element, metamodel)).toEqual(["weight"]);
      expect(valueFindings(element, metamodel)).toEqual([]);
    }
    // A value that is there but of the wrong kind is a wrong value kind, and no missing value.
    const heavy = record("derived", { title: "x", tags: ["a"], weight: "heavy" });
    expect(keys(heavy, metamodel)).toEqual([]);
    expect(valueFindings(heavy, metamodel).map((f) => f.problem.code)).toEqual(["element.wrong-value-kind"]);
  });

  it("gives the finding with type, property and element, and none for an unknown type", async () => {
    const { metamodel } = await loaded();
    expect(requiredFindings(record("derived", { title: "x", tags: ["a"] }), metamodel)).toEqual([
      expect.objectContaining({
        path: ["weight"],
        at: "key",
        problem: {
          code: "element.missing-required",
          severity: "warning",
          message:
            "Required property Weight (weight) of type Derived (derived) has no value; LogReq changes no file",
          repository: "system",
          file: "x.md",
          elementId: "0b7c6e1a-1111-4222-8333-444455556666",
        },
      }),
    ]);
    expect(requiredFindings(record("gadget", {}), metamodel)).toEqual([]);
  });

  it("names a required key by its key when the metamodel does not define it", async () => {
    const { metamodel } = await loaded();
    // A faulty metamodel (read-only workspace, SR-011 AK3) can name a property it does not define.
    const faulty: Metamodel = {
      ...metamodel,
      properties: metamodel.properties.filter((p) => p.key !== "weight"),
    };
    expect(requiredFindings(record("derived", { title: "x", tags: ["a"] }), faulty)[0]?.problem.message).toBe(
      "Required property weight (weight) of type Derived (derived) has no value; LogReq changes no file",
    );
  });

  it("collects the findings of every element of the store", async () => {
    const { metamodel, store } = await loaded();
    const elements = [record("base", {}), record("base", { title: "x", tags: ["a"] })];
    expect(allRequiredFindings({ ...store, elements }, metamodel).map((f) => f.path[0])).toEqual([
      "title",
      "tags",
    ]);
  });
});

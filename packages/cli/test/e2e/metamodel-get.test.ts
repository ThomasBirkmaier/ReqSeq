// `logreq metamodel get` end to end (SR-130 AK6, SR-080): the built binary gives the metamodel the app
// draws as a graph, on fixtures/SR-130/metamodel: the types with their parents, properties (own and
// inherited), required properties and statuses, and the relation kinds with their source and target
// types, as JSON and in its readable output, which names the same values by the shape of the output
// (ADR-0009). Run after `pnpm build` with `pnpm test:e2e`.
import type { MetamodelGetOutput } from "@logreq/core";
import type { FixtureWorkspace } from "@logreq/testkit";
import { createFixtureWorkspace } from "@logreq/testkit";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { logreq, requireBuiltCli } from "../support/logreq.js";

let fixture: FixtureWorkspace;

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

beforeEach(async () => {
  fixture = await createFixtureWorkspace({ fixture: "SR-130/metamodel" });
});

afterEach(async () => {
  await fixture.cleanup();
});

describe("logreq metamodel get (SR-130)", () => {
  it("[SR-130/AK6] logreq metamodel get gives the types, inheritance, properties, statuses and relation kinds as JSON and names them in its text output", async () => {
    const json = await logreq(["metamodel", "get", "--json"], { cwd: fixture.root });
    expect([json.code, json.stderr]).toEqual([0, ""]);
    const output = JSON.parse(json.stdout) as MetamodelGetOutput;
    expect(
      output.types.map((type) => [
        type.key,
        type.name,
        type.prefix,
        type.extends,
        type.properties,
        type.statuses,
      ]),
    ).toEqual([
      ["item", "Item", "ITM", undefined, ["title"], ["draft", "approved", "retired"]],
      [
        "requirement",
        "System Requirement",
        "SR",
        "item",
        ["title", "rationale", "packages"],
        ["draft", "approved", "retired"],
      ],
      [
        "software-requirement",
        "Software Requirement",
        "SWR",
        "requirement",
        ["title", "rationale", "packages", "component"],
        ["draft", "approved", "retired"],
      ],
      ["decision", "Decision", "D", undefined, ["title"], ["open", "decided"]],
      ["package", "Package", "PKG", undefined, ["title"], []],
    ]);
    expect(output.types.map((type) => type.required)).toEqual([
      ["title"],
      ["title"],
      ["title", "component"],
      [],
      [],
    ]);
    expect(output.properties.map((property) => [property.key, property.kind])).toEqual([
      ["title", "text"],
      ["rationale", "text"],
      ["component", "choice"],
      ["packages", "relation"],
      ["severity", "number"],
    ]);
    expect(output.relations.map((kind) => [kind.key, kind["source-types"], kind["target-types"]])).toEqual([
      ["derives-from", ["software-requirement"], ["requirement", "software-requirement"]],
      ["replaces", ["requirement"], ["requirement"]],
      ["delegates-to", ["requirement"], ["software-requirement"]],
      ["based-on", undefined, ["decision"]],
      ["concerns", undefined, ["requirement", "decision"]],
      ["refines", undefined, undefined],
      ["traces-to", ["decision"], undefined],
      ["blocks", [], ["requirement"]],
    ]);

    // The readable output names the same values (YAML by the shape of the output, ADR-0009).
    const text = await logreq(["metamodel", "get"], { cwd: fixture.root });
    expect([text.code, text.stderr]).toEqual([0, ""]);
    expect(text.stdout).toContain("extends: requirement");
    expect(text.stdout).toContain("source-types: []");
    // Then the problems, here none.
    const { problems, ...rest } = output;
    expect(problems).toEqual([]);
    expect(text.stdout.endsWith("\nNo problems.\n")).toBe(true);
    expect(parse(text.stdout.slice(0, -"No problems.\n".length))).toEqual(JSON.parse(JSON.stringify(rest)));
  });
});

// Catalog test (ADR-0002 rule 2): implementations, the registry list and schemas/commands/catalog.json agree.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { AnyCommand } from "../catalog.js";
import { loadContracts } from "../runtime/contracts.js";
import { createCommandRuntime } from "../runtime/invoke.js";
import { commands } from "./index.js";

/**
 * Stages (D-035) whose catalog commands must all be implemented. A stage is added here when it is
 * done, in a PR with green CI before its acceptance is prepared (lead-run skill, "Stage done"); until
 * then its commands arrive one SR at a time.
 */
const COMPLETED_STAGES: readonly number[] = [1, 2, 3, 4];

const commandsDir = import.meta.dirname;
const isImplementation = (file: string): boolean =>
  file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.endsWith(".d.ts");

/** `commands/<group>/<action>.ts` files, as `group.action`. */
const commandFiles = (): string[] =>
  fs
    .readdirSync(commandsDir, { withFileTypes: true })
    .filter((group) => group.isDirectory())
    .flatMap((group) =>
      fs
        .readdirSync(path.join(commandsDir, group.name))
        .filter(isImplementation)
        .map((file) => `${group.name}.${file.slice(0, -".ts".length)}`),
    )
    .sort();

const contracts = loadContracts();
const registered = commands.map((c) => c.name);

describe("command registry", () => {
  it("lists every command file exactly once, under the name of its path", async () => {
    const files = commandFiles();
    expect([...registered].sort()).toEqual(files);
    for (const name of files) {
      const [group = "", action = ""] = name.split(".");
      // A file URL, so Vite does not try to resolve the dynamic import at build time.
      const url = pathToFileURL(path.join(commandsDir, group, `${action}.ts`)).href;
      const mod = (await import(url)) as { readonly default?: AnyCommand };
      expect(mod.default?.name, `commands/${group}/${action}.ts`).toBe(name);
      expect(commands).toContain(mod.default);
    }
  });

  it("registers every listed command once", () => {
    expect(createCommandRuntime({ commands }).commands.size).toBe(commands.length);
  });

  it("keeps the list sorted by name", () => {
    expect(registered).toEqual([...registered].sort());
  });

  it("has a catalog entry for every implementation", () => {
    const missing = registered.filter((name) => contracts.entry(name) === undefined);
    expect(missing, "implementations without catalog entry").toEqual([]);
  });

  it("implements every catalog command of a completed stage exactly once", () => {
    for (const stage of COMPLETED_STAGES) {
      for (const entry of contracts.commands.filter((c) => c.stage === stage)) {
        expect(
          registered.filter((name) => name === entry.name),
          `stage ${String(stage)}: ${entry.name}`,
        ).toHaveLength(1);
      }
    }
  });

  it("only lists stages that exist in the catalog", () => {
    const stages = new Set(contracts.commands.map((c) => c.stage));
    expect(COMPLETED_STAGES.filter((s) => !stages.has(s))).toEqual([]);
  });
});

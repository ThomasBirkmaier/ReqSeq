// `logreq data export` end to end (SR-061): the built binary on fixtures/SR-061/export (two Git
// repositories `system` and `sensor`, Markdown and JUnit record files, variants, a package, a saved
// filter and baselines; its README lists the elements and the expected selections), as lines and as
// JSON, and the JSON against the schema files on disk with the Ajv setup of scripts/contracts
// (ADR-0003). Run after `pnpm build` with `pnpm test:e2e`.
import type { FixtureWorkspace } from "@logreq/testkit";
import { createFixtureWorkspace } from "@logreq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Run } from "../support/logreq.js";
import { logreq as run, requireBuiltCli } from "../support/logreq.js";

const fixtures: FixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

const P = "61061061-0000-4000-8000-0000000000";

interface Exported {
  readonly repositories: readonly {
    readonly name: string;
    readonly commit?: string;
    readonly dirty?: boolean;
  }[];
  readonly elements: readonly {
    readonly id: string;
    readonly version?: string;
    readonly properties: Readonly<Record<string, unknown>>;
    readonly relations: readonly { readonly id: string; readonly outdated?: boolean }[];
    readonly verification?: readonly { readonly view: string; readonly status: string }[];
    readonly validation?: string;
    readonly validity?: readonly string[];
    readonly packages?: readonly string[];
  }[];
}

/** A Git copy of the fixture: its workspace `system/` and the heads of both repositories. */
const fixture = async (): Promise<FixtureWorkspace> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-061/export", git: ["system", "sensor"] });
  fixtures.push(ws);
  return ws;
};

const exportIn = (ws: FixtureWorkspace, args: readonly string[]): Promise<Run> =>
  run(["data", "export", ...args], { cwd: ws.path("system") });

/** A validator of Ajv: the check, and the errors of the last call. */
interface Validate {
  (data: unknown): boolean;
  errors?: unknown;
}

/** What scripts/contracts/load.mjs gives (ADR-0003): one Ajv with every schema of schemas/, strict, with formats. */
interface ContractsModule {
  readonly loadContracts: () => { readonly ajv: { getSchema: (id: string) => Validate | undefined } };
  readonly BASE: string;
}

/** The validator of `schema` (a file of schemas/) as scripts/contracts sets it up, from the files on disk. */
const schemaValidator = async (schema: string): Promise<Validate | undefined> => {
  // A URL, not a module path: the script is no part of the package and has no types.
  const load = new URL("../../../../scripts/contracts/load.mjs", import.meta.url).href;
  const { loadContracts, BASE } = (await import(load)) as ContractsModule;
  return loadContracts().ajv.getSchema(`${BASE}${schema}`);
};

describe("logreq data export (SR-061)", () => {
  it("[SR-061/AK1] logreq data export --json gives every element with properties, relations, version, status and validity read from the files", async () => {
    const ws = await fixture();
    const result = await exportIn(ws, ["--json"]);
    expect([result.code, result.stderr]).toEqual([0, ""]);
    const out = JSON.parse(result.stdout) as Exported;
    expect(out.repositories).toEqual([
      { name: "system", available: true, commit: await ws.head("system"), dirty: false },
      { name: "sensor", available: true, commit: await ws.head("sensor"), dirty: false },
    ]);
    expect(out.elements.map((e) => e.id.slice(-2))).toEqual([
      "a1",
      "d1",
      "b1",
      "b2",
      "b3",
      "b4",
      "c1",
      "c2",
      "e1",
    ]);
    const byId = new Map(out.elements.map((e) => [e.id.slice(-2), e]));
    expect(byId.get("b1")).toMatchObject({
      version: "n1:d7089e63fea26191",
      properties: { "x-supplier": "Anemo Ltd" },
      validity: [`${P}c1`],
      packages: [`${P}d1`],
      // The Markdown record of the variant Coast.
      verification: [{ view: `${P}c1`, status: "verified" }],
    });
    // The validation record of the need (SR-038).
    expect(byId.get("a1")?.validation).toBe("validated");
    // The failed test case of the JUnit file, and the outdated link to the need.
    expect(byId.get("b2")?.verification?.[0]).toEqual({ view: "core", status: "failed" });
    expect(byId.get("b2")?.relations.find((r) => r.id === `${P}a1`)?.outdated).toBe(true);
    expect(byId.get("e1")?.relations.map((r) => [r.id, r.outdated])).toEqual([[`${P}b1`, false]]);
  });

  it("[SR-061/AK1] logreq data export prints one line per element", async () => {
    const result = await exportIn(await fixture(), []);
    expect([result.code, result.stderr]).toEqual([0, ""]);
    const lines = result.stdout.split("\n");
    expect(lines.slice(lines.indexOf("elements:") + 1).filter((l) => l !== "")).toEqual([
      "  N-0000a1  draft  Know the wind  [validation: validated]",
      "  PKG-0000d1  draft  Display",
      "  SR-0000b1  draft  Show the wind speed  [verification: VAR-0000c1 verified]",
      "  SR-0000b2  draft  Show the gusts  [verification: core failed, VAR-0000c1 open, VAR-0000c2 open]",
      "  SR-0000b3  draft  Show the wind direction  [verification: VAR-0000c2 open]",
      "  SR-0000b4  obsolete  Show the wind  [verification: core open, VAR-0000c1 open, VAR-0000c2 open]",
      "  VAR-0000c1  draft  Coast",
      "  VAR-0000c2  draft  Mountain",
      "  SR-0000e1  draft  Heat the anemometer  [verification: core open, VAR-0000c1 open, VAR-0000c2 open]",
    ]);
  });

  it("[SR-061/AK2] logreq data export gives only the selection of a package, a saved filter, a baseline and a variant", async () => {
    const ws = await fixture();
    const cases: readonly [Readonly<Record<string, unknown>>, readonly string[]][] = [
      [{ package: "PKG-0000d1" }, ["b1", "b2"]],
      [{ filter: "Functional" }, ["b1", "b3", "b4"]],
      [{ baseline: "Release 1" }, ["a1", "b1", "b3"]],
      [{ view: "VAR-0000c1" }, ["a1", "d1", "b1", "b2", "b4", "c1", "c2", "e1"]],
    ];
    for (const [selection, expected] of cases) {
      const result = await exportIn(ws, ["--input", JSON.stringify({ selection }), "--json"]);
      expect([selection, result.code, result.stderr]).toEqual([selection, 0, ""]);
      const out = JSON.parse(result.stdout) as Exported;
      expect([selection, out.elements.map((e) => e.id.slice(-2))]).toEqual([selection, expected]);
    }
  });

  it("[SR-061/AK3] the JSON of logreq data export matches schemas/data-export.schema.json", async () => {
    const ws = await fixture();
    const validate = await schemaValidator("data-export.schema.json");
    for (const args of [[], ["--input", JSON.stringify({ selection: { baseline: "release-1" } })]]) {
      const result = await exportIn(ws, [...args, "--json"]);
      expect([args, result.code, result.stderr]).toEqual([args, 0, ""]);
      const valid = validate?.(JSON.parse(result.stdout));
      expect([args, valid, validate?.errors ?? null]).toEqual([args, true, null]);
    }
  });
});

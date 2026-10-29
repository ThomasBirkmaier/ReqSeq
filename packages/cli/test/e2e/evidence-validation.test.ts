// `reqseq element get`, `reqseq evidence status` and `reqseq element list` end to end with the
// validation status (SR-038): the built binary on fixtures/SR-038/validation, whose README lists every
// element, its Markdown records and the expected status. Run after `pnpm build` with `pnpm test:e2e`.
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Run } from "../support/reqseq.js";
import { reqseq as run, requireBuiltCli } from "../support/reqseq.js";

const fixtures: FixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

const U = (tail: string): string => `38383838-3838-4838-8838-00000000${tail}`;

const reqseq = async (args: readonly string[]): Promise<Run> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-038/validation" });
  fixtures.push(ws);
  return run(args, { cwd: ws.root });
};

const firstLine = async (ref: string): Promise<string> => {
  const result = await reqseq(["element", "get", ref]);
  expect([result.code, result.stderr]).toEqual([0, ""]);
  return result.stdout.split("\n")[0] ?? "";
};

describe("reqseq and the validation status (SR-038)", () => {
  it("[SR-038/AK1] reqseq element get shows the validation status of a need apart from the verification status", async () => {
    expect(await firstLine("N-00a001")).toBe("N-00a001  approved  Know the wind  [validation: validated]");
    expect(await firstLine("SR-00b001")).toBe(
      "SR-00b001  approved  Show wind speed  [verification: core failed]  [validation: validated]",
    );
  });

  it("[SR-038/AK2] reqseq element get shows outdated for a need validated on an older version", async () => {
    expect(await firstLine("N-00a003")).toBe("N-00a003  approved  Know the pressure  [validation: outdated]");
  });

  it("[SR-038/AK3] reqseq evidence status prints the validation status of every element", async () => {
    const result = await reqseq(["evidence", "status"]);
    expect([result.code, result.stderr]).toEqual([0, ""]);
    expect(result.stdout).toBe(
      [
        "elements:",
        "  N-00a001  approved  Know the wind  [validation: validated]",
        "  N-00a002  approved  Know the rain  [validation: failed]",
        "  N-00a003  approved  Know the pressure  [validation: outdated]",
        "  N-00a004  draft  Know the humidity  [validation: open]",
        "  N-00a005  approved  Know the temperature  [validation: failed]",
        "  N-00a006  approved  Know the sunshine  [validation: validated]",
        "  SR-00b001  approved  Show wind speed  [verification: core failed]  [validation: validated]",
        "  SR-00b002  draft  Show wind direction  [verification: core verified]",
        "  UC-00e001  approved  Read the wind  [validation: failed]",
        "total: 9",
        "",
      ].join("\n"),
    );
  });

  it("[SR-038/AK3] reqseq element list --json with a validation condition gives the validated elements", async () => {
    const input = JSON.stringify({ selection: { where: { validation: ["validated"] } } });
    const result = await reqseq(["element", "list", "--input", input, "--json"]);
    expect([result.code, result.stderr]).toEqual([0, ""]);
    const out = JSON.parse(result.stdout) as { readonly elements: readonly { readonly id: string }[] };
    expect(out.elements.map((e) => e.id)).toEqual([U("a001"), U("a006"), U("b001")]);
  });
});

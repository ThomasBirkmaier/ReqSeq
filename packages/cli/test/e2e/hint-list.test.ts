// `logreq hint list` and the hints of `logreq element get` end to end (SR-026, ADR-0009): the built
// binary with the product commands on fixtures/SR-026/hints, its exit code, its JSON and its
// readable output. The list in the app (AK1) and the hint at the element in the app (AK3) come with
// the app in stage 3 (#127 option 1); core and this test cover the function now.
// Run after `pnpm build` with `pnpm test:e2e`.
import type { FixtureWorkspace } from "@logreq/testkit";
import { createFixtureWorkspace } from "@logreq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Run } from "../support/logreq.js";
import { logreq as run, requireBuiltCli } from "../support/logreq.js";

const logreq = (args: readonly string[], cwd: string): Promise<Run> => run(args, { cwd });

interface Hint {
  readonly code: string;
  readonly elementId?: string;
  readonly targetId?: string;
  readonly message: string;
  readonly line?: number;
  readonly storedDate?: string | null;
  readonly currentDate?: string | null;
}

interface Output {
  readonly hints: readonly Hint[];
  readonly incomplete: boolean;
}

const fixtures: FixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

const fixture = async (): Promise<FixtureWorkspace> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-026/hints", git: true });
  fixtures.push(ws);
  return ws;
};

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

const P = "26a0b000-0000-4000-8000-0000000000";

const rows = (output: Output): unknown[] => output.hints.map((h) => [h.code, h.elementId, h.targetId]);

describe("logreq hint list (SR-026)", () => {
  it("[SR-026/AK1] prints every open hint with kind, element, target and reason, as JSON and readable, with exit code 0", async () => {
    const ws = await fixture();
    const json = await logreq(["hint", "list", "--json"], ws.root);
    expect([json.code, json.stderr]).toEqual([0, ""]);
    const output = JSON.parse(json.stdout) as Output;
    expect(output.incomplete).toBe(false);
    expect(rows(output)).toEqual([
      ["element.missing-required", `${P}b2`, undefined],
      ["element.unknown-property", `${P}a2`, undefined],
      ["element.unknown-property", `${P}b4`, undefined],
      ["relation.target-superseded", `${P}b3`, `${P}b9`],
      ["variant.superseded-in-validity", `${P}b3`, `${P}c3`],
      ["relation.outdated", `${P}b1`, `${P}a1`],
      ["relation.outdated", `${P}b1`, `${P}a1`],
    ]);
    const outdated = output.hints.at(-2);
    expect(outdated?.message).toMatch(
      /^Relation Derives from \(derives-from\) of System Requirement SR-0000b1 points to an older version of Need N-0000a1: stored version from no date .*, current version from \d{4}-/,
    );
    expect(outdated?.currentDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const human = await logreq(["hint", "list"], ws.root);
    expect([human.code, human.stderr]).toEqual([0, ""]);
    // One line per hint: element, kind, reason, and the hint ID of a hint that can be confirmed (#310).
    const lines = human.stdout.split("\n");
    expect(lines[0]).toBe("hints:");
    expect(lines).toContain(
      "  SR-0000b3  variant.superseded-in-validity  Property Validity (validity) of System Requirement SR-0000b3 lists Variant VAR-0000c3, which is superseded (status Obsolete)",
    );
    expect(lines.filter((l) => l.startsWith("  SR-0000b1  relation.outdated  "))).toEqual([
      expect.stringMatching(/ {2}hint: relation\.outdated\/system\/.*\/derives-from\/.*\?version=n1:0{16}$/),
      expect.stringMatching(/ {2}hint: relation\.outdated\/system\/.*\/@text\/.*&n=1$/),
    ]);
    expect(lines).toHaveLength(9);
  });

  it("[SR-026/AK2] prints only the hints that pass the filters", async () => {
    const ws = await fixture();
    const filtered = await logreq(
      [
        "hint",
        "list",
        "--type",
        "system-requirement",
        "--variant",
        "VAR-0000c2",
        "--kind",
        "element.unknown-property",
        "--json",
      ],
      ws.root,
    );
    expect([filtered.code, filtered.stderr]).toEqual([0, ""]);
    expect(rows(JSON.parse(filtered.stdout) as Output)).toEqual([
      ["element.unknown-property", `${P}b4`, undefined],
    ]);
    const packaged = await logreq(["hint", "list", "--package", "PKG-0000d2", "--json"], ws.root);
    expect(rows(JSON.parse(packaged.stdout) as Output)).toEqual([
      ["element.missing-required", `${P}b2`, undefined],
    ]);
    const unknown = await logreq(["hint", "list", "--ref", "SR-ffffff", "--json"], ws.root);
    expect(unknown.code).toBe(2);
    expect(JSON.parse(unknown.stderr)).toMatchObject({ code: "ref.unknown" });
  });

  it("[SR-026/AK3] element get shows the outdated relation of the element", async () => {
    const ws = await fixture();
    const json = await logreq(["element", "get", "SR-0000b1", "--json"], ws.root);
    expect([json.code, json.stderr]).toEqual([0, ""]);
    const { element } = JSON.parse(json.stdout) as { element: { problems: readonly Hint[] } };
    expect(element.problems.map((p) => [p.code, p.targetId, p.line])).toEqual([
      ["relation.outdated", `${P}a1`, 14],
      ["relation.outdated", `${P}a1`, 17],
    ]);
  });
});

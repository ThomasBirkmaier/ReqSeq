// `reqseq hint list` and the hints of `reqseq element get` end to end (SR-026, ADR-0009): the built
// binary with the product commands on fixtures/SR-026/hints, its exit code, its JSON and its
// readable output. The list in the app (AK1) and the hint at the element in the app (AK3) come with
// the app in stage 3 (ThomasBirkmaier/ReqSeq-archive#127 option 1); core and this test cover the function now.
// fixtures/SR-045/core-changed gives the hint on a changed core requirement (SR-045 AK1); its
// place on the pages of the app comes with the app package of stage 5.
// Run after `pnpm build` with `pnpm test:e2e`.
import fs from "node:fs/promises";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Run } from "../support/reqseq.js";
import { reqseq as run, requireBuiltCli } from "../support/reqseq.js";

const reqseq = (args: readonly string[], cwd: string): Promise<Run> => run(args, { cwd });

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

describe("reqseq hint list (SR-026)", () => {
  it("[SR-026/AK-vs4d] prints every open hint with kind, element, target and reason, as JSON and readable, with exit code 0", async () => {
    const ws = await fixture();
    const json = await reqseq(["hint", "list", "--json"], ws.root);
    expect([json.code, json.stderr]).toEqual([0, ""]);
    const output = JSON.parse(json.stdout) as Output;
    expect(output.incomplete).toBe(false);
    expect(rows(output)).toEqual([
      ["element.missing-required", `${P}b2`, undefined],
      ["element.unknown-property", `${P}a2`, undefined],
      ["element.unknown-property", `${P}b4`, undefined],
      ["relation.target-superseded", `${P}b3`, `${P}b9`],
      ["variant.superseded-in-validity", `${P}b3`, `${P}c3`],
      ["trace.no-parent", `${P}b4`, undefined],
      ["relation.outdated", `${P}b1`, `${P}a1`],
      ["relation.outdated", `${P}b1`, `${P}a1`],
    ]);
    const outdated = output.hints.at(-2);
    expect(outdated?.message).toMatch(
      /^Relation Derives from \(derives-from\) of System Requirement SR-0000b1 points to an older version of Need N-0000a1: stored version from no date, current version from \d{4}-.* \(not committed, or Git cannot tell\)$/,
    );
    expect(outdated?.currentDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const human = await reqseq(["hint", "list"], ws.root);
    expect([human.code, human.stderr]).toEqual([0, ""]);
    // The counts per kind first (SR-026 AK6), then one line per hint: element → target with their
    // titles (#172, #252, SR-026 AK6), kind, reason, and the hint ID of a hint that can be confirmed
    // (ThomasBirkmaier/ReqSeq-archive#310).
    const lines = human.stdout.split("\n");
    expect(lines.slice(0, 3)).toEqual(["kinds:", "  - code: element.missing-required", "    count: 1"]);
    const hintsAt = lines.indexOf("hints:");
    expect(hintsAt).toBe(1 + 2 * output.kinds.length);
    expect(lines).toContain(
      "  SR-0000b3  Show wind direction → VAR-0000c3  Old basic  variant.superseded-in-validity  Property Validity (validity) of System Requirement SR-0000b3 lists Variant VAR-0000c3, which is superseded (status Obsolete)",
    );
    expect(
      lines.filter((l) =>
        l.startsWith("  SR-0000b1  Show wind speed → N-0000a1  See the wind  relation.outdated  "),
      ),
    ).toEqual([
      expect.stringMatching(/ {2}hint: relation\.outdated\/system\/.*\/derives-from\/.*\?version=n1:0{16}$/),
      expect.stringMatching(/ {2}hint: relation\.outdated\/system\/.*\/@text\/.*&n=1$/),
    ]);
    // The hints, then their total (#146): all of them on one page, so no page note.
    expect(lines.at(-2)).toBe(`total: ${String(output.hints.length)}`);
    expect(lines).toHaveLength(hintsAt + 11);
  });

  it("[SR-026/AK-g7cj] prints only the hints that pass the filters", async () => {
    const ws = await fixture();
    const filtered = await reqseq(
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
    const packaged = await reqseq(["hint", "list", "--package", "PKG-0000d2", "--json"], ws.root);
    expect(rows(JSON.parse(packaged.stdout) as Output)).toEqual([
      ["element.missing-required", `${P}b2`, undefined],
    ]);
    const unknown = await reqseq(["hint", "list", "--ref", "SR-ffffff", "--json"], ws.root);
    expect(unknown.code).toBe(2);
    expect(JSON.parse(unknown.stderr)).toMatchObject({ code: "ref.unknown" });
  });

  it("[SR-026/AK-w590] element get shows the outdated relation of the element", async () => {
    const ws = await fixture();
    const json = await reqseq(["element", "get", "SR-0000b1", "--json"], ws.root);
    expect([json.code, json.stderr]).toEqual([0, ""]);
    const { element } = JSON.parse(json.stdout) as { element: { problems: readonly Hint[] } };
    expect(element.problems.map((p) => [p.code, p.targetId, p.line])).toEqual([
      ["relation.outdated", `${P}a1`, 14],
      ["relation.outdated", `${P}a1`, 17],
    ]);
  });
});

describe("reqseq hint list with a changed core requirement (SR-045)", () => {
  it("[SR-045/AK-yryh] lists one hint at the replacement with both versions, also for its variant, and none beside it", async () => {
    const ws = await createFixtureWorkspace({ fixture: "SR-045/core-changed", git: true });
    fixtures.push(ws);
    const file = ws.path("requirements/SR-0000000000a1.md");
    await fs.writeFile(file, (await fs.readFile(file, "utf8")).replace("within 10 ms.\n", "within 12 ms.\n"));
    await ws.commit();
    const json = await reqseq(["hint", "list", "--variant", "VAR-0000c1", "--json"], ws.root);
    expect([json.code, json.stderr]).toEqual([0, ""]);
    const { hints } = JSON.parse(json.stdout) as {
      readonly hints: readonly (Hint & { storedVersion: string; currentVersion: string })[];
    };
    const C = "45045045-0000-4000-8000-0000000000";
    // B2 has no validity: its replacement stays an outdated relation (SR-041 AK6). The fixture's
    // requirements have no parent (SR-022 AK6), which this test does not look at.
    const changed = hints.filter((h) => h.code !== "trace.no-parent");
    expect(changed.map((h) => [h.code, h.elementId, h.targetId])).toEqual([
      ["variant.core-changed", `${C}b1`, `${C}a1`],
      ["relation.outdated", `${C}b2`, `${C}a1`],
    ]);
    expect(changed[0]?.storedVersion).toBe("n1:0b18d8dadbb9f1a5");
    expect(changed[0]?.currentVersion).not.toBe("n1:0b18d8dadbb9f1a5");
    expect(changed[0]?.currentDate).toMatch(/^\d{4}-/);
    const human = await reqseq(["hint", "list", "--variant", "VAR-0000c1"], ws.root);
    expect(human.stdout).toMatch(
      /\n {2}SR-0000b1 {2}Response time at most 20 ms → SR-0000a1 {2}Response time at most 10 ms {2}variant\.core-changed {2}Core requirement System Requirement SR-0000a1, which System Requirement SR-0000b1 replaces, has changed .* {2}hint: variant\.core-changed\/system\/.*\/replaces\/.*\?version=n1:0b18d8dadbb9f1a5\n/,
    );
    const mountain = await reqseq(
      ["hint", "list", "--variant", "VAR-0000c2", "--kind", "variant.core-changed", "--json"],
      ws.root,
    );
    expect((JSON.parse(mountain.stdout) as Output).hints).toEqual([]);
  });
});

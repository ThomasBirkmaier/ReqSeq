// The display rule of the verification degree (SR-037, ThomasBirkmaier/ReqSeq-archive#592 Q3): one decimal, rounded down, on every access.
import { readFile } from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../catalog.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import {
  degreePercent,
  degreeShareOf,
  minimumHeadText,
  packageSummaryText,
  summaryViewText,
} from "./degree-text.js";

describe("minimumHeadText (SR-153)", () => {
  it("names the rows that meet the minima, of those they apply to, and their share rounded down", () => {
    expect(minimumHeadText(2, 5, 2 / 5)).toBe("2 of 5 · 40 %");
    expect(minimumHeadText(2, 3, 2 / 3)).toBe("2 of 3 · 66.6 %");
  });
});

describe("degreePercent (SR-037)", () => {
  it("[SR-037/AK-zxtb] shows 6 of 10 as 60 %", () => {
    expect(degreePercent(6 / 10)).toBe("60 %");
  });

  it("rounds down to one decimal, so 100 % only when everything counted is verified (ThomasBirkmaier/ReqSeq-archive#592 Q3)", () => {
    expect([2 / 3, 9 / 14, 0.29, 1, 0, 1 / 3, 999 / 1000, 49_999 / 50_000].map(degreePercent)).toEqual([
      "66.6 %",
      "64.2 %",
      "29 %",
      "100 %",
      "0 %",
      "33.3 %",
      "99.9 %",
      "99.9 %",
    ]);
  });

  it("never drops a whole tenth for a fraction of up to 2,000 requirements", () => {
    const wrong: string[] = [];
    for (let n = 1; n <= 2000; n += 1) {
      for (let k = 0; k <= n; k += 1) {
        // Integer arithmetic: the exact tenths of k/n, rounded down.
        const exact = `${String(Math.floor((1000 * k) / n) / 10)} %`;
        if (degreePercent(k / n) !== exact) {
          wrong.push(`${String(k)}/${String(n)}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("degreeShareOf (SR-037)", () => {
  it("gives the share of a value with a number share next to an object counts", () => {
    expect(degreeShareOf({ share: 0.6, total: 10, counts: { open: 2 } })).toBe(0.6);
  });

  it("gives nothing for any other value", () => {
    expect(
      [
        undefined,
        null,
        0.6,
        "0.6",
        [{ share: 0.6, counts: {} }],
        { total: 0, counts: {} },
        { share: "60 %", counts: {} },
        { share: 0.6 },
        { share: 0.6, counts: null },
        { share: 0.6, counts: [1, 2] },
        { share: 0.6, counts: 3 },
      ].map(degreeShareOf),
    ).toEqual(Array.from({ length: 11 }, () => undefined));
  });
});

const counts = (verified: number, indirect: number, failed: number, outdated: number, open: number) => ({
  verified,
  indirect,
  failed,
  outdated,
  open,
});

describe("packageSummaryText (SR-112)", () => {
  it("[SR-112/AK-s1rj] sums the coverage over the requirement levels and names the count of each status that occurs", () => {
    const levels = [
      { total: 1, withChildren: 1 },
      { total: 6, withChildren: 0, withEvidence: 5 },
      { total: 4, withChildren: 0, withEvidence: 3 },
    ];
    expect(
      packageSummaryText(levels, { degree: { share: 0.6, counts: counts(6, 0, 1, 1, 2) }, view: "core" }),
    ).toBe("Coverage 8 of 10 with evidence · Degree (core) 60 % (6 verified, 1 failed, 1 outdated, 2 open)");
    expect(
      packageSummaryText(levels, { degree: { share: 0.7, counts: counts(5, 2, 0, 0, 3) }, view: "core" }),
    ).toBe("Coverage 8 of 10 with evidence · Degree (core) 70 % (5 verified, 2 indirect, 3 open)");
  });

  it("[SR-112/AK-s1rj] gives for package P3 of fixtures/SR-037/degree the numbers of evidence.coverage and evidence.degree", async () => {
    const fixture = await createFixtureWorkspace({ fixture: "SR-037/degree" });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    const input = { selection: { package: "PKG-00d003" } };
    const coverage = (await invoke("evidence.coverage", input, {
      workspace,
    })) as CommandOutput<"evidence.coverage">;
    const degree = (await invoke("evidence.degree", input, {
      workspace,
    })) as CommandOutput<"evidence.degree">;
    // P3 holds a need and two obsolete requirements: neither is in the line.
    expect(coverage.levels.map((level) => level.type)).toEqual(["need", "system-requirement"]);
    expect(packageSummaryText(coverage.levels, degree)).toBe(
      "Coverage 8 of 10 with evidence · Degree (core) 60 % (6 verified, 1 failed, 1 outdated, 2 open)",
    );
  });

  it("[SR-112/AK-cg1v] gives zeros for requirements without records, and no line without requirements", () => {
    expect(
      packageSummaryText([{ total: 10, withEvidence: 0 }], {
        degree: { share: 0, counts: counts(0, 0, 0, 0, 10) },
        view: "core",
      }),
    ).toBe("Coverage 0 of 10 with evidence · Degree (core) 0 % (10 open)");
    expect(
      packageSummaryText([{ total: 2 }], { degree: { counts: counts(0, 0, 0, 0, 0) }, view: "core" }),
    ).toBe(undefined);
    expect(packageSummaryText([], { degree: { counts: counts(0, 0, 0, 0, 0) }, view: "core" })).toBe(
      undefined,
    );
  });

  it("[SR-112/AK-s1rj] names a variant view by its title, as the modeline does, else by its short ID or ID", () => {
    const coastal = { id: "uuid-v1", repository: "spec", shortId: "VAR-0000c1", title: "Coastal station" };
    const untitled = { id: "uuid-v2", repository: "spec", shortId: "VAR-0000c2", title: "" };
    expect(
      packageSummaryText([{ total: 10, withEvidence: 8 }], {
        degree: { share: 0.6, counts: counts(6, 0, 1, 1, 2) },
        view: "uuid-v1",
        names: [coastal],
      }),
    ).toBe(
      "Coverage 8 of 10 with evidence · Degree (Coastal station) 60 % (6 verified, 1 failed, 1 outdated, 2 open)",
    );
    expect(summaryViewText("uuid-v2", [coastal, untitled])).toBe("VAR-0000c2");
    expect(summaryViewText("uuid-v3", [coastal])).toBe("uuid-v3");
    expect(summaryViewText("uuid-v3", undefined)).toBe("uuid-v3");
    expect(summaryViewText("core", [coastal])).toBe("core");
  });

  it("[SR-112/AK-s1rj] names the variant of the selection's view as evidence.degree gives it (fixtures/SR-069/filter)", async () => {
    const fixture = await createFixtureWorkspace({ fixture: "SR-069/filter" });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    const input = { selection: { package: "PKG-0000000000d1", view: "VAR-0000000000c1" } };
    const coverage = (await invoke("evidence.coverage", input, {
      workspace,
    })) as CommandOutput<"evidence.coverage">;
    const degree = (await invoke("evidence.degree", input, {
      workspace,
    })) as CommandOutput<"evidence.degree">;
    expect(packageSummaryText(coverage.levels, degree)).toBe(
      "Coverage 0 of 2 with evidence · Degree (Coastal) 0 % (2 open)",
    );
  });

  it("shows a degree without share as 0 %", () => {
    expect(
      packageSummaryText([{ total: 1, withEvidence: 0 }], {
        degree: { counts: counts(0, 0, 0, 0, 1) },
        view: "core",
      }),
    ).toBe("Coverage 0 of 1 with evidence · Degree (core) 0 % (1 open)");
  });
});

describe("degree-text.ts (SR-037)", () => {
  it("imports nothing: the app's renderer loads it as @reqseq/core/verification-degree, without the rest of core", async () => {
    const source = await readFile(new URL("degree-text.ts", import.meta.url), "utf8");
    expect(source.split("\n").filter((line) => /^\s*(import|export .* from)\b/.test(line))).toEqual([]);
  });
});

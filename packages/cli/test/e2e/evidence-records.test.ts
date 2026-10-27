// Evidence records end to end (SR-028, ADR-0012): `logreq workspace check` on fixtures/SR-028/records,
// whose records lie in the evidence folder of `ci-results`, the repository of another tool. Also the
// CLI test of SR-025 AK4 (outdated evidence), which waited for real record files (#127 option 1).
// Run after `pnpm build` with `pnpm test:e2e`.
import type { FixtureWorkspace } from "@logreq/testkit";
import { createFixtureWorkspace } from "@logreq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Run } from "../support/logreq.js";
import { logreq as run, requireBuiltCli } from "../support/logreq.js";

interface Problem {
  readonly code: string;
  readonly severity: string;
  readonly repository?: string;
  readonly file?: string;
  readonly line?: number;
  readonly message: string;
  readonly elementId?: string;
  readonly elementShortId?: string;
  readonly elementRepository?: string;
  readonly elementFile?: string;
  readonly targetId?: string;
  readonly storedVersion?: string;
  readonly currentVersion?: string;
}

interface Output {
  readonly ok: boolean;
  readonly problems: readonly Problem[];
  readonly checkedElements: number;
}

/** Requirement B of the fixture, whose only record is of an older version. */
const B = "3c3c3c3c-3333-4333-8333-0d0000000002";
const UNKNOWN = "9f9f9f9f-9999-4999-8999-0d00000000ff";
const B_RECORD = "evidence/nightly/2026-10-21-SR-000002-inspection.md";

const fixtures: FixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

/** fixtures/SR-028/records with `files` on top; the workspace is `system/`. */
const fixture = async (files: Readonly<Record<string, string>> = {}): Promise<string> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-028/records", files });
  fixtures.push(ws);
  return ws.path("system");
};

/** `logreq workspace check --json` with `args`. */
const checkJson = async (cwd: string, args: readonly string[] = []): Promise<Output> => {
  const json = await run(["workspace", "check", ...args, "--json"], { cwd });
  expect(json.stderr).toBe("");
  return JSON.parse(json.stdout) as Output;
};

/** The check as text and as JSON, for the tests that assert both. */
const check = async (cwd: string, args: readonly string[] = []): Promise<{ human: Run; output: Output }> => ({
  human: await run(["workspace", "check", ...args], { cwd }),
  output: await checkJson(cwd, args),
});

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

describe("logreq workspace check with evidence records (SR-028)", () => {
  it("[SR-028/AK1] logreq workspace check reads a record from a repository of another tool", async () => {
    const output = await checkJson(await fixture());
    // The record of B in ci-results (nested folder) is read: its version is compared with B's.
    expect(output.problems.map((p) => [p.code, p.repository, p.file, p.elementId])).toEqual([
      ["evidence.outdated", "ci-results", B_RECORD, B],
    ]);
    expect(output.checkedElements).toBe(2);
  });

  it("[SR-028/AK3] logreq workspace check lists a record that names an unknown UUID", async () => {
    const record =
      "---\nlogreq-record: 1\nkind: verification\n" +
      `element: ${UNKNOWN}\nversion: n1:e62ed39c555648e2\nmethod: test\nitem: build-513\n` +
      "result: failed\ndate: 2026-10-23T10:00:00Z\n---\n";
    const cwd = await fixture({ "ci-results/evidence/2026-10-23-unknown-test.md": record });
    const { human, output } = await check(cwd);
    const message = `The verification record names element ${UNKNOWN}, which the workspace does not have`;
    expect(output.problems.filter((p) => p.code === "evidence.unknown-element")).toEqual([
      {
        code: "evidence.unknown-element",
        severity: "warning",
        message,
        repository: "ci-results",
        file: "evidence/2026-10-23-unknown-test.md",
        line: 1,
        targetId: UNKNOWN,
      },
    ]);
    expect(human.code).toBe(0);
    expect(human.stdout).toContain(
      `warning  evidence.unknown-element  ci-results:evidence/2026-10-23-unknown-test.md:1  ${message}`,
    );
  });
});

describe("outdated evidence in workspace check (SR-025)", () => {
  it("[SR-025/AK4] logreq workspace check reports evidence.outdated for a record file of an older version", async () => {
    const { human, output } = await check(await fixture(), ["--fail-on", "warning"]);
    expect(human.code).toBe(1);
    expect(output.ok).toBe(false);
    expect(output.problems).toEqual([
      {
        code: "evidence.outdated",
        severity: "warning",
        message:
          "The newest verification record of System Requirement SR-000002, from 2026-10-21T09:00:00Z, is for an older version",
        repository: "ci-results",
        file: B_RECORD,
        line: 1,
        elementId: B,
        elementShortId: "SR-000002",
        elementRepository: "system",
        elementFile: "requirements/SR-0d0000000002.md",
        storedVersion: "n1:00000000000000b2",
        currentVersion: "n1:1b52356e55a694d7",
      },
    ]);
  });
});

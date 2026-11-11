// `reqseq element update --set-items` end to end (#177): the built binary changes one acceptance
// criterion by its position with the `key=value` form of ADR-0009, repeated and merged with `--input`.
// Run after `pnpm build` with `pnpm test:e2e`.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { reqseq as run, requireBuiltCli } from "../support/reqseq.js";

const FILE = "requirements/SR-000000000177.md";
const CRITERIA = [
  "---",
  "id: 17700000-0000-4000-8000-000000000177",
  "type: system-requirement",
  "status: draft",
  "title: Criteria",
  "acceptance-criteria:",
  // With their criterion keys (SR-204), so the lines of a criterion that does not change stay.
  "  - key: first",
  '    text: "Given a quoted first, then it stays."',
  "  - key: secnd",
  "    text: Given a plain second, then it is shown.",
  "---",
  "",
].join("\n");

const fixtures: FixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

describe("reqseq element update --set-items (#177)", () => {
  it("replaces and appends criteria by position; the other lines of the file stay", async () => {
    const ws = await createFixtureWorkspace({ fixture: "SR-001/two-elements", files: { [FILE]: CRITERIA } });
    fixtures.push(ws);
    const hash = createHash("sha256").update(CRITERIA).digest("hex");
    const out = await run(
      [
        "element",
        "update",
        "SR-000177",
        "--set-items",
        'acceptance-criteria={"2":"Given a plain second, when it changes, then it is shown."}',
        "--set-items",
        'acceptance-criteria={"2":"Given a plain second, when it changed, then it is shown.","3":"Third"}',
        "--input",
        JSON.stringify({ setItems: { "acceptance-criteria": { "1": "Not written" } } }),
        "--expected-file-sha256",
        hash,
      ],
      { cwd: ws.root },
    );
    expect([out.code, out.stderr]).toEqual([0, ""]);
    // The last value of a key counts, and the flag wins over the same key of --input.
    // The changed criterion keeps its key, the appended one gets a new key (SR-204 AK1, AK6).
    const written = await fs.readFile(ws.path(FILE), "utf8");
    const key = /- key: ([a-z][a-z0-9]{3})\n {4}text: Third\n/u.exec(written)?.[1] ?? "";
    expect(key).toMatch(/^[a-z][a-z0-9]{3}$/u);
    expect(written).toBe(
      CRITERIA.replace(
        "    text: Given a plain second, then it is shown.\n",
        `    text: Given a plain second, when it changed, then it is shown.\n  - key: ${key}\n    text: Third\n`,
      ),
    );
    const refused = await run(
      ["element", "update", "SR-000177", "--set-items", 'acceptance-criteria={"1":"x"}'],
      { cwd: ws.root },
    );
    expect(refused.code).not.toBe(0);
    expect(refused.stderr).toContain("expectedFileSha256 is required to change text, title or setItems");
  });
});

// The verification status per view (SR-047) on fixtures/SR-043/example with an evidence location
// `evidence` and hand-written records: variant A „Coast“ (c1) replaces K1 (a1) by A1 (b1) and
// excludes K2 (a2); B „Mountain“ (c2) and C „Desert“ (c3) change nothing. The spec's „C excludes“
// is A here: the fixture's excluding variant. The same on every access in
// packages/cli/test/cross-access.test.ts; the CLI in packages/cli/test/e2e/evidence-per-variant.test.ts.
import fs from "node:fs/promises";
import path from "node:path";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

const P = "43043043-0000-4000-8000-0000000000";
const V = "n1:67ebd0624004c969";
const [A, B, C] = [`${P}c1`, `${P}c2`, `${P}c3`];

/** A verification record of `tail` with `result`, for `variant` when given (ADR-0012 format). */
const recordFile = (tail: string, result: string, variant?: string): string =>
  `---\nreqseq-record: 1\nkind: verification\nelement: ${P}${tail}\nversion: ${V}\nmethod: test\n` +
  `${variant === undefined ? "" : `variant: ${variant}\n`}item: build-47\nresult: ${result}\ndate: 2026-11-01T10:00:00Z\n---\n`;

/** The example with an evidence location and the records of SR-047 (see the file comment). */
const FILES: Readonly<Record<string, string>> = {
  "reqseq-workspace.yaml":
    "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
    '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
    "metamodel: { repository: system, path: metamodel }\nevidence:\n  - { repository: system, path: evidence }\n",
  // AK1: K3 passed for A only.
  "evidence/k3-a.md": recordFile("a3", "passed", A),
  // AK2: K4 passed without variant.
  "evidence/k4-core.md": recordFile("a4", "passed"),
  // AK3: K2 (excluded in A) passed without variant, failed for B, none for C.
  "evidence/k2-core.md": recordFile("a2", "passed"),
  "evidence/k2-b.md": recordFile("a2", "failed", B),
  // AK3: K1 (replaced in A by A1) with a hand-written record for A that counts nowhere; A1 failed in A.
  "evidence/k1-a.md": recordFile("a1", "passed", A),
  "evidence/a1-a.md": recordFile("b1", "failed", A),
};

const open = async (): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-043/example", files: FILES });
  const workspace = new Workspace(fixture.root);
  onTestFinished(async () => {
    await workspace.close();
    await fixture.cleanup();
  });
  return { fixture, workspace };
};

type Rows = { readonly view: string; readonly status: string }[];

/** The verification rows of every requirement, by the last two digits of its UUID (`evidence.status`). */
const statusRows = async (workspace: Workspace): Promise<Record<string, Rows>> => {
  const out = (await invoke("evidence.status", {}, { workspace })) as CommandOutput<"evidence.status">;
  return Object.fromEntries(
    out.elements.flatMap((e) =>
      e.verification === undefined
        ? []
        : [[e.id.slice(-2), e.verification.map(({ view, status }) => ({ view, status }))]],
    ),
  );
};

/** The verification rows element.get gives for `ref`. */
const getRows = async (workspace: Workspace, ref: string): Promise<Rows | undefined> =>
  (
    (await invoke("element.get", { ref }, { workspace })) as CommandOutput<"element.get">
  ).element.verification?.map(({ view, status }) => ({ view, status }));

/** The refusal of `evidence.record` for `ref` in `variant`; the evidence folder is unchanged. */
const refused = async (
  fixture: FixtureWorkspace,
  workspace: Workspace,
  ref: string,
  variant: string,
): Promise<CommandError> => {
  const before = await fs.readdir(path.join(fixture.root, "evidence"));
  const input = { ref, kind: "verification", method: "test", item: "build-47", result: "passed", variant };
  const error = await invoke("evidence.record", input, { workspace }).then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(CommandError);
  expect(await fs.readdir(path.join(fixture.root, "evidence"))).toEqual(before);
  return error as CommandError;
};

describe("verification status per variant (SR-047)", () => {
  it("[SR-047/AK1] a passed record for A leaves the status in B open", async () => {
    const { workspace } = await open();
    expect((await statusRows(workspace))["a3"]).toEqual([
      { view: "core", status: "open" },
      { view: A, status: "verified" },
      { view: B, status: "open" },
      { view: C, status: "open" },
    ]);
  });

  it("[SR-047/AK2] a record without variant counts only for the core", async () => {
    const { workspace } = await open();
    expect((await statusRows(workspace))["a4"]).toEqual([
      { view: "core", status: "verified" },
      { view: A, status: "open" },
      { view: B, status: "open" },
      { view: C, status: "open" },
    ]);
  });

  it("[SR-047/AK3] the status shows one row for the core and each variant it is in, none for excluding or replacing variants", async () => {
    const { workspace } = await open();
    const rows = await statusRows(workspace);
    // K2, excluded in A: core verified · B: failed · C: open, no row for A.
    const k2 = [
      { view: "core", status: "verified" },
      { view: B, status: "failed" },
      { view: C, status: "open" },
    ];
    // K1, replaced in A by A1: no row for A, though a record for A exists; A1 has its own status there.
    const k1 = [
      { view: "core", status: "open" },
      { view: B, status: "open" },
      { view: C, status: "open" },
    ];
    expect([rows["a2"], rows["a1"], rows["b1"]]).toEqual([k2, k1, [{ view: A, status: "failed" }]]);
    // element.get (the requirement's page) gives the same rows from the record it reads again.
    expect([await getRows(workspace, "SR-0000a2"), await getRows(workspace, "SR-0000a1")]).toEqual([k2, k1]);
  });

  it("[SR-047/AK4] evidence.record for C refuses a core requirement excluded or replaced in C, naming the exclusion or the replacement", async () => {
    const { fixture, workspace } = await open();
    const excluded = await refused(fixture, workspace, "SR-0000a2", "VAR-0000c1");
    expect([excluded.code, excluded.message, excluded.details]).toEqual([
      "input.invalid",
      "SR-0000a2 is excluded in VAR-0000c1, so a record for it there would count nowhere (SR-047)",
      { command: "evidence.record", fields: ["variant"], reason: "excluded-in-variant", variant: A },
    ]);
    // Given by UUID, as the app gives it, the refusal still names short IDs.
    const replaced = await refused(fixture, workspace, `${P}a1`, A);
    expect([replaced.code, replaced.message, replaced.details]).toEqual([
      "input.invalid",
      "SR-0000a1 is replaced in VAR-0000c1 by SR-0000b1, so a record for it there would count nowhere; record SR-0000b1 instead (SR-047)",
      {
        command: "evidence.record",
        fields: ["variant"],
        reason: "replaced-in-variant",
        variant: A,
        replacedBy: [`${P}b1`],
      },
    ]);
    // In B, where K1 and K2 are, a record is written.
    const written = (await invoke(
      "evidence.record",
      {
        ref: "SR-0000a2",
        kind: "verification",
        method: "test",
        item: "build-47",
        result: "passed",
        variant: "VAR-0000c2",
      },
      { workspace },
    )) as CommandOutput<"evidence.record">;
    expect(written.record.variant).toBe(B);
  });
});

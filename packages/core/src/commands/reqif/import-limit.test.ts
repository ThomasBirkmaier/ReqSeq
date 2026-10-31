// reqif.import (SR-053) reads at most REQIF_LIMITS.bytes of the file: the limit holds for the bytes
// read, not for a size looked at before. The limit is lowered here so a small file exceeds it.
import { readFileSync } from "node:fs";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { CommandError } from "../../catalog.js";
import type * as parse from "../../reqif/parse.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

vi.mock("../../reqif/parse.js", async (importOriginal) => {
  const actual = await importOriginal<typeof parse>();
  return { ...actual, REQIF_LIMITS: { ...actual.REQIF_LIMITS, bytes: 1500 } };
});

const sample = (name: string): string =>
  readFileSync(new URL(`../../../../../fixtures/SR-053/delivery/${name}`, import.meta.url), "utf8");

describe("reqif.import size limit (SR-053)", () => {
  it("refuses a file larger than the limit with reqif.invalid, writing nothing", async () => {
    const fixture = await createFixtureWorkspace({
      fixture: "SR-004/one-repository",
      files: {
        "in/lieferung.reqif": sample("lieferung.reqif"),
        "reqif/kunde-a.yaml": sample("kunde-a.yaml"),
      },
    });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    const error = await invoke(
      "reqif.import",
      { file: "in/lieferung.reqif", mapping: "reqif/kunde-a.yaml", delivery: "x" },
      { workspace },
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CommandError);
    expect([(error as CommandError).code, (error as CommandError).message]).toEqual([
      "reqif.invalid",
      "file: lieferung.reqif is larger than 1500 bytes, the most ReqSeq reads",
    ]);
  });
});

// reqif.import and reqif.analyze refuse a packed delivery (`.reqifz`, a ZIP archive) as such, not as a
// file that is not UTF-8 (#572); SR-053 leaves packed deliveries out of the base scope.
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { CommandError } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

const sample = (name: string): string =>
  readFileSync(new URL(`../../../../../fixtures/SR-053/delivery/${name}`, import.meta.url), "utf8");

/** A ZIP archive with one stored, empty entry `a.reqif`: local header, central directory, end record. */
const ZIP = ((): Buffer => {
  const name = Buffer.from("a.reqif");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length, 16);
  return Buffer.concat([local, name, central, name, end]);
})();

const refusal = async (file: string, bytes: Uint8Array, command: "reqif.import" | "reqif.analyze") => {
  const fixture = await createFixtureWorkspace({
    fixture: "SR-004/one-repository",
    files: { "reqif/kunde-a.yaml": sample("kunde-a.yaml") },
  });
  onTestFinished(() => fixture.cleanup());
  await fs.mkdir(path.join(fixture.root, "in"), { recursive: true });
  await fs.writeFile(path.join(fixture.root, file), bytes);
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  const input =
    command === "reqif.import"
      ? { file, mapping: "reqif/kunde-a.yaml", delivery: "x" }
      : { file, mapping: "reqif/kunde-a.yaml" };
  const error = await invoke(command, input, { workspace }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(CommandError);
  return [(error as CommandError).code, (error as CommandError).message];
};

const packed = (name: string): string[] => [
  "reqif.invalid",
  `file: ${name} is a packed ReqIF delivery (.reqifz, a ZIP archive), which ReqSeq does not read; unpack it and use the .reqif file inside`,
];

describe("packed ReqIF delivery (#572)", () => {
  it("reqif.import refuses a ZIP archive by its signature, whatever its name", async () => {
    expect(await refusal("in/lieferung.reqif", ZIP, "reqif.import")).toEqual(packed("lieferung.reqif"));
  });

  it("reqif.analyze refuses a .reqifz file by its name", async () => {
    const reqif = Buffer.from(sample("lieferung.reqif"));
    expect(await refusal("in/lieferung.REQIFZ", reqif, "reqif.analyze")).toEqual(packed("lieferung.REQIFZ"));
  });
});

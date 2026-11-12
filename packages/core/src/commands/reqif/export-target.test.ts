// reqif.export (SR-207) replaces a file at its output only when it is a ReqIF file, an XML file
// whose root element is `REQ-IF`; any other file, such as a JUnit result, stays as it is.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

const WIND = "52052052-0000-4000-8000-0000000052a1";
const HISTORY = "52052052-0000-4000-8000-0000000052a2";
const PICTURES = "52052052-0000-4000-8000-0000000052b6";
const JUNIT =
  '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites><testsuite name="s" tests="0"/></testsuites>\n';

const open = async (files: Readonly<Record<string, string>>) => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-052/package", files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const exported = (workspace: Workspace, output: string, id: string) =>
  invoke("reqif.export", { output, selection: { ids: [id] } }, { workspace }) as Promise<
    CommandOutput<"reqif.export">
  >;

describe("reqif.export to an existing file (SR-207)", () => {
  it("[SR-207/AK-gbbc] refuses an XML file that is no ReqIF file, names why and leaves it and the image folder as they are", async () => {
    const { fixture, workspace } = await open({ "results.xml": JUNIT, "broken.reqif": "<REQ-IF>" });
    // WIND embeds an image, which would be copied next to the output.
    const error = await exported(workspace, "results.xml", WIND).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CommandError);
    expect((error as CommandError).code).toBe("file.faulty");
    expect((error as CommandError).message).toBe(
      "Not exported: results.xml is no ReqIF file (its root element is <testsuites>, not <REQ-IF>); ReqSeq replaces only a ReqIF file",
    );
    expect(await fs.readFile(fixture.path("results.xml"), "utf8")).toBe(JUNIT);
    await expect(fs.stat(fixture.path("results-images"))).rejects.toThrow();
    // A file that is no readable XML is no ReqIF file either, whatever its name.
    const broken = await exported(workspace, "broken.reqif", HISTORY).catch((e: unknown) => e);
    expect((broken as CommandError).message).toMatch(
      /^Not exported: broken\.reqif is no readable XML \(line 1\)/,
    );
    expect(await fs.readFile(fixture.path("broken.reqif"), "utf8")).toBe("<REQ-IF>");
  });

  it("[SR-207/AK-kyqf] replaces an unchanged ReqIF file", async () => {
    const other = '<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd"/>\n';
    const { fixture, workspace } = await open({ "other.reqif": other });
    await exported(workspace, "s.reqif", WIND);
    await exported(workspace, "s.reqif", HISTORY);
    expect(await fs.readFile(fixture.path("s.reqif"), "utf8")).toContain(`IDENTIFIER="_sh-${HISTORY}"`);
    expect(await fs.readFile(fixture.path("s.reqif"), "utf8")).not.toContain(`IDENTIFIER="_sh-${WIND}"`);
    await exported(workspace, "other.reqif", HISTORY);
    expect(await fs.readFile(fixture.path("other.reqif"), "utf8")).toContain(`IDENTIFIER="_sh-${HISTORY}"`);
  });

  it("[SR-207/AK-h192] refuses a file in the image folder that is no image by its content, and writes nothing", async () => {
    // Two images: the first copy goes to a free place, the second onto a text file.
    const copies = ["s-images/SR-0000000052b6/anemometer.png", "s-images/SR-0000000052b6/anemometer-2.png"];
    const { fixture, workspace } = await open({
      "requirements/SR-0000000052b6.md": [
        "---",
        `id: ${PICTURES}`,
        "type: system-requirement",
        "status: draft",
        "title: Pictures",
        "---",
        "",
        "![a](SR-0000000052a1/anemometer.png) ![b](other/anemometer.png)",
        "",
      ].join("\n"),
      "requirements/other/anemometer.png": "GIF89a other",
      [copies[1] ?? ""]: "notes, not a picture\n",
    });
    const error = await exported(workspace, "s.reqif", PICTURES).catch((e: unknown) => e);
    expect([(error as CommandError).code, (error as CommandError).message]).toEqual([
      "file.faulty",
      `Not exported: ${copies[1] ?? ""} is no image by its content; ReqSeq replaces only an image there`,
    ]);
    expect(await fs.readFile(fixture.path(copies[1] ?? ""), "utf8")).toBe("notes, not a picture\n");
    await expect(fs.stat(fixture.path(copies[0] ?? ""))).rejects.toThrow();
    await expect(fs.stat(fixture.path("s.reqif"))).rejects.toThrow();
  });

  it("refuses an image place it cannot replace before any copy is written", async () => {
    const copies = ["s-images/SR-0000000052a1/anemometer.png"];
    const { fixture, workspace } = await open({ [`${copies[0] ?? ""}/inside.txt`]: "a folder\n" });
    const error = await exported(workspace, "s.reqif", WIND).catch((e: unknown) => e);
    expect((error as CommandError).code).toBe("file.faulty");
    expect((error as CommandError).message).toMatch(
      /^Not exported: s-images\/SR-0000000052a1\/anemometer\.png cannot be replaced: /,
    );
    await expect(fs.stat(fixture.path("s.reqif"))).rejects.toThrow();
  });
});

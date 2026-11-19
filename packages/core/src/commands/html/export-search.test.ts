// html.export (SR-231 AK7): the search over identifier, short ID and title that the written folder holds, run under
// happy-dom on a written page with the written index file.
import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { InvokedOutput } from "../../catalog.js";
import { searchPage } from "../../html-export/search.test-helper.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

const WIND = "e8df96ea-a168-4d90-8d65-6328cee88fb3";
const GUSTS = "3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c";
const OLD = "0b7c6e1a-1111-4222-8333-444455556666";
const BARE = "4b4b4b4b-1111-4222-8333-000000000003";

const element = (id: string, lines: readonly string[]): string =>
  ["---", `id: ${id}`, "type: system-requirement", ...lines, "---", "", "Text.", ""].join("\n");

const open = async () => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-001/two-elements" });
  onTestFinished(() => fixture.cleanup());
  const model = path.join(fixture.root, "metamodel", "standard-model.yaml");
  const text = await fs.readFile(model, "utf8");
  await fs.writeFile(
    model,
    text
      .replace(
        "    prefix: SR\n    meaning: requirement\n    properties:\n      [\n        title,",
        "    prefix: SR\n    meaning: requirement\n    properties:\n      [\n        title,\n        spec-id,",
      )
      .replace(
        "properties:\n  - key: title",
        "properties:\n  - { key: spec-id, name: Spec ID, kind: text, meaning: identifier }\n  - key: title",
      ),
  );
  const files: Record<string, string> = {
    "requirements/SR-6328cee88fb3.md": element(WIND, [
      "status: draft",
      "title: Show wind speed",
      "spec-id: WS-7",
    ]),
    "requirements/SR-1d2e3f4a5b6c.md": element(GUSTS, [
      "status: draft",
      "title: Show gusts",
      "spec-id: WS-12",
    ]),
    "requirements/SR-444455556666.md": element(OLD, [
      "status: obsolete",
      "title: Show wind rain",
      "spec-id: WS-9",
    ]),
    "requirements/SR-000000000003.md": element(BARE, ["status: draft"]),
  };
  for (const [file, content] of Object.entries(files)) {
    await fs.writeFile(path.join(fixture.root, file), content);
  }
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

/** Lets the promises of the script settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("html.export: search (SR-231 AK7)", () => {
  it("[SR-231/AK-c1hj] finds the elements with every typed word in identifier, short ID or title, in any case and as a word part, each with a link to its page", async () => {
    const { fixture, workspace } = await open();
    const output = (await invoke(
      "html.export",
      { output: "site" },
      { workspace },
    )) as InvokedOutput<"html.export">;
    expect(output.pages).toBe(3);
    const site = path.join(fixture.root, "site");
    const read = (file: string) => fs.readFile(path.join(site, file), "utf8");
    const elementPage = await read(`elements/${WIND}.html`);
    expect(elementPage).toContain('<reqseq-search class="astro-');
    expect(elementPage).toContain('<script src="../assets/reqseq.js"></script>');
    const script = await read("assets/reqseq.js");
    expect(script).toContain("function searchScript(");
    // ASCII only, so a server's charset cannot change the script.
    expect(script).toMatch(/^[\0-\x7f]*$/u);
    const body = /<body[^>]*>([^]*)<\/body>/u.exec(elementPage)?.[1] ?? "";
    const page = searchPage({ html: body });
    page.key("k", { ctrlKey: true });
    expect(page.added[0]?.getAttribute("src")).toBe("../assets/search-index.js");
    page.load(await read("assets/search-index.js"));
    const found = async (query: string) => {
      page.type(query);
      await settle();
      return page.hits().map((hit) => hit.href);
    };
    expect(await found("WIND sh")).toEqual([`../elements/${WIND}.html`]);
    expect(await found("ws-1")).toEqual([`../elements/${GUSTS}.html`]);
    expect(await found("sr-E88F")).toEqual([`../elements/${WIND}.html`]);
    expect(await found("show")).toEqual([`../elements/${GUSTS}.html`, `../elements/${WIND}.html`]);
    expect(page.hits().map((hit) => hit.text)).toEqual([
      "WS-12 Show gusts | System Requirement · SR-4a5b6c",
      "WS-7 Show wind speed | System Requirement · SR-e88fb3",
    ]);
    // An element with an invalid status has no page and is not found; one without identifier or title is.
    expect(await found("rain")).toEqual([]);
    expect(await found("ws-9")).toEqual([]);
    expect(await found("000003")).toEqual([`../elements/${BARE}.html`]);
    expect(await found("text")).toEqual([]);
  });
});

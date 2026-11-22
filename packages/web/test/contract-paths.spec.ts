// SR-248 AK4: a request to the UI server that gives a command a local path outside the repositories of the open
// workspace is refused as over the API (SR-142 AK1): the same error as core gives the access `api` for the same
// input, and nothing is written outside. Opening or creating a workspace outside, and listing folders for it
// (`workspace.listFolder`), work. The requests come from the page, with its token.
import fs from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
import { CommandError, Workspace, invoke } from "@reqseq/core";
import type { Ui } from "./fixtures.js";
import { expect, test as base } from "./fixtures.js";
import { scratch } from "./contract.js";
import { createWorkspace, runOn, startUi } from "./start-ui.js";

const test = base.extend<object, { ui: Ui }>({
  ui: [
    async ({ kind }, use) => {
      const workspace = await createWorkspace(kind);
      const server = await startUi(workspace.root);
      await use({ server, root: workspace.root, run: runOn(workspace.root) });
      await server.close();
      await workspace.cleanup();
    },
    { scope: "worker" },
  ],
});

interface Answer {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

/** `POST <route>` with `body` from the page, with the token and the generation of the workspace. */
const post = (page: Page, ui: Ui, route: string, body: unknown, generation: number): Promise<Answer> =>
  page.evaluate(
    async ({ route, body, token, generation }) => {
      const response = await fetch(route, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          "x-reqseq-workspace": String(generation),
        },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    },
    { route, body, token: ui.server.token, generation },
  );

/** The error core gives the API for `input` (SR-142 AK1), as its error body. */
async function overApi(root: string, name: string, input: unknown): Promise<Record<string, unknown>> {
  const workspace = new Workspace(root);
  try {
    await invoke(name, input, { workspace, access: "api" });
  } catch (error) {
    if (error instanceof CommandError) {
      return { code: error.code, message: error.message, details: error.details };
    }
    throw error;
  } finally {
    await workspace.close();
  }
  throw new Error(`The API ran ${name} with a path outside`);
}

test("[SR-248/AK-nyy5] a local path outside the repositories is refused as over the API, except to open or create a workspace", async ({
  page,
  open,
  ui,
}) => {
  const outside = await scratch();
  try {
    const at = (name: string): string => path.join(outside.dir, name);
    await fs.writeFile(at("image.png"), Buffer.from("89504e470d0a1a0a", "hex"));
    await fs.writeFile(at("run.xml"), '<testsuites><testsuite name="s"/></testsuites>\n');
    await fs.writeFile(at("delivery.reqif"), "<REQ-IF/>\n");
    const before = (await fs.readdir(outside.dir)).sort();
    const { partial = [] } = await ui.run("element.list", { limit: 1, fields: ["title"] });
    const ref = partial[0]?.id ?? "";
    const relative = path.relative(ui.root, at("out.html"));
    const inputs: readonly [string, Record<string, unknown>][] = [
      ["data.store", { folder: outside.dir }],
      ["element.addAttachment", { ref, sourcePath: at("image.png") }],
      ["evidence.enrichJunit", { file: at("run.xml"), item: "build 1" }],
      ["evidence.enrichJunit", { file: "evidence/run.xml", item: "build 1", output: at("copy.xml") }],
      ["html.export", { output: at("html") }],
      ["html.export", { output: relative }],
      ["reqif.analyze", { file: at("delivery.reqif") }],
      ["reqif.export", { output: at("export.reqif") }],
      ["reqif.import", { file: at("delivery.reqif"), delivery: "Outside" }],
      [
        "reqif.saveMapping",
        { mapping: { "reqseq-reqif-mapping": 1, source: { name: "Outside" } }, file: at("map.yaml") },
      ],
      ["workspace.check", { changedFiles: [at("run.xml")] }],
    ];
    await open();
    for (const [name, input] of inputs) {
      const answer = await post(page, ui, `api/${name}`, input, 1);
      const api = await overApi(ui.root, name, input);
      // The same refusal: its code and details; the message names the web UI as the access.
      expect({
        name,
        status: answer.status,
        code: answer.body["code"],
        details: answer.body["details"],
      }).toEqual({
        name,
        status: 400,
        code: api["code"],
        details: api["details"],
      });
      // Each one the refusal of SR-142 AK1, not of another check of the input.
      expect(String(answer.body["message"]), name).toContain(
        "ReqSeq accepts only local paths inside the repositories of the workspace",
      );
    }
    expect((await fs.readdir(outside.dir)).sort()).toEqual(before);

    // Listing folders outside, and creating and opening a workspace there.
    const listed = await post(
      page,
      ui,
      "api/workspace.listFolder",
      { path: `${outside.dir}${path.sep}`, files: true },
      1,
    );
    expect(listed.status).toBe(200);
    expect(JSON.stringify(listed.body)).toContain("image.png");
    const made = at("new-workspace");
    await fs.mkdir(made);
    const init = await post(page, ui, "api/workspace.init", { path: made, name: "Outside", skill: false }, 1);
    expect(init.status).toBe(200);
    await expect(fs.stat(path.join(made, "reqseq-workspace.yaml"))).resolves.toBeDefined();
    const opened = await post(page, ui, "ui/workspace", { path: made }, 1);
    expect(opened.status).toBe(200);
    expect(opened.body["root"]).toBe(made);
    const status = await post(page, ui, "api/workspace.status", {}, Number(opened.body["generation"]));
    expect(status.body["name"]).toBe("Outside");
  } finally {
    await outside.done();
  }
});

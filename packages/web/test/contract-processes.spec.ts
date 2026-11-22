// SR-248 AK2: the server of the web UI starts a program (Git included) or opens a file of the workspace only in a
// catalog command, in opening the workspace, or in detecting and taking over changed files (SR-007). The built
// `reqseq ui --no-open` runs with the preload of the test kit (`record-access.mjs`), which records each program
// started and each file opened with the step that started or opened it (`access-record.ts` says how the step is
// found); the page reads and changes elements, and a file changes outside the server.
import fs from "node:fs/promises";
import path from "node:path";
import { accessViolations, isBelow, parseAccessRecords } from "@reqseq/testkit";
import { RECORD_ACCESS, scratch, startCliUi } from "./contract.js";
import { drawn, expect, open, test } from "./fixtures.js";
import { createWorkspace, runOn } from "./start-ui.js";

test("[SR-248/AK-spzg] programs and workspace files only in a command, the open of the workspace or the watcher", async ({
  page,
  kind,
}) => {
  const workspace = await createWorkspace(kind);
  const home = await scratch();
  const record = path.join(home.dir, "access.jsonl");
  const run = runOn(workspace.root);
  try {
    const ui = await startCliUi({
      root: workspace.root,
      home: home.dir,
      preloads: [RECORD_ACCESS],
      env: { REQSEQ_ACCESS_RECORD: record },
    });
    try {
      // Reading: the overview, a queue, the changes since the baseline, an element.
      await open(page, ui.url);
      await open(page, ui.url, "/q/drafts");
      await open(page, ui.url, "/c");
      const { partial = [] } = await run("element.list", { limit: 100, fields: ["identifier", "title"] });
      const [first, second] = partial;
      if (first === undefined || second === undefined) {
        throw new Error("The workspace has fewer than two elements");
      }
      const ref = first.identifier ?? first.shortId;
      await open(page, ui.url, `/e/${ref}`);
      // Changing: the title in the form.
      await page.getByRole("link", { name: "Edit", exact: true }).click();
      await page.locator("#f-title").fill("Changed in the web UI");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.locator("#card h1")).toHaveText("Changed in the web UI");
      // A change outside the server: its watcher takes it over, and the page shows it.
      const other = await run("element.get", { ref: second.id });
      await run("element.update", {
        ref: second.id,
        title: "Changed outside",
        expectedFileSha256: other.fileSha256,
      });
      const otherRef = second.identifier ?? second.shortId;
      await expect(async () => {
        await open(page, ui.url, `/e/${otherRef}`);
        await page.reload();
        await drawn(page, `/e/${otherRef}`);
        await expect(page.locator("#card h1")).toHaveText("Changed outside", { timeout: 1000 });
      }).toPass();
    } finally {
      await ui.stop();
    }
    const records = parseAccessRecords(await fs.readFile(record, "utf8"));
    const { repositories } = await run("workspace.status");
    const folders = repositories.map((r) => r.absolutePath ?? path.join(workspace.root, r.path ?? ""));
    // The record is there: Git ran in commands, and files of the workspace were opened in each step.
    expect(records.some((r) => r.kind === "program" && r.step === "command")).toBe(true);
    const steps = new Set(
      records
        .filter((r) => r.kind === "file" && r.file !== null && folders.some((f) => isBelow(r.file ?? "", f)))
        .map((r) => (r.kind === "file" ? r.step : null)),
    );
    expect([...steps].sort()).toEqual(["command", "open", "watcher"]);
    expect(accessViolations(records, folders)).toEqual([]);
  } finally {
    await home.done();
    await workspace.cleanup();
  }
});

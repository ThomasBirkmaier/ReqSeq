// A workspace the server could not mark as opened (SR-247 AK12): the page shows the reason the server got from
// `workspace.markOpened`, after a refusal at start on the first page loaded, and after a switch. The server runs
// with the product's runtime, except that `workspace.markOpened` refuses.
import { createUiServer } from "@reqseq/api";
import type { InvokeContext } from "@reqseq/core";
import { CommandError, getCommandRuntime } from "@reqseq/core";
import { drawn, expect, test } from "./fixtures.js";
import { PAGES, createWorkspace } from "./start-ui.js";

const REASON = "Not marked: another process is writing the list of recent workspaces; run the command again";

const refusing = (() => {
  const runtime = getCommandRuntime();
  return {
    contracts: runtime.contracts,
    invoke: (name: string, input: unknown, ctx: InvokeContext): Promise<unknown> =>
      name === "workspace.markOpened"
        ? Promise.reject(new CommandError("file.changed-on-disk", REASON))
        : runtime.invoke(name, input, ctx),
  };
})();

test("the page shows why the workspace was not marked as opened, at start and after a switch", async ({
  page,
}) => {
  const first = await createWorkspace("no-identifier");
  const second = await createWorkspace("no-identifier");
  const server = await createUiServer({ pages: PAGES, runner: refusing, workspace: first.root });
  try {
    const notice = page.locator("#not-marked");
    await page.goto(server.url);
    await drawn(page, "/q/overview");
    await expect(notice).toHaveText(`The workspace was not marked as opened: ${REASON} Close`);
    // Only the first page loaded after the start gets it.
    await page.reload();
    await drawn(page, "/q/overview");
    await expect(notice).toHaveCount(0);

    await page.evaluate(() => {
      location.hash = "/w/open";
    });
    await drawn(page, "/w/open");
    await page.getByLabel("Folder of the workspace").fill(second.root);
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await drawn(page, "/q/overview");
    await expect(notice).toContainText(REASON);
    // It stays through a redraw, and closes.
    await page.evaluate(() => {
      location.hash = "/w/open";
    });
    await drawn(page, "/w/open");
    await expect(notice).toContainText(REASON);
    await notice.getByRole("button", { name: "Close" }).click();
    await expect(notice).toHaveCount(0);
  } finally {
    await server.close();
    await first.cleanup();
    await second.cleanup();
  }
});

// Playwright fixtures of the UI tests: one workspace and one UI server per worker, on the workspace kind of the
// project; `open` loads the page with the token and goes to a route; `run` asks core what the page should show.
import type { Page } from "@playwright/test";
import { test as base, expect } from "@playwright/test";
import type { UiServer } from "@reqseq/api";
import type { Run, WorkspaceKind } from "./start-ui.js";
import { createWorkspace, runOn, startUi } from "./start-ui.js";

export interface Ui {
  readonly server: UiServer;
  readonly root: string;
  readonly run: Run;
}

export interface Options {
  readonly kind: WorkspaceKind;
}

export const test = base.extend<{ open: (route?: string) => Promise<void> }, Options & { ui: Ui }>({
  kind: ["spec", { option: true, scope: "worker" }],
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
  open: async ({ page, ui }, use) => {
    await use((route) => open(page, ui.server.url, route));
  },
});

/** Waits until the page drew `route` (`#app` names the route it drew last and is no longer busy). */
export const drawn = async (page: Page, route: string): Promise<void> => {
  await expect(page.locator(`#app[data-route="${route}"][aria-busy="false"]`)).toBeAttached();
};

/**
 * Opens the address the server prints, so the page takes the token, then goes to `route` (default the overview)
 * and waits until it is drawn.
 */
export async function open(page: Page, url: string, route = "/q/overview"): Promise<void> {
  if (!page.url().startsWith(url.replace(/#.*$/, ""))) {
    await page.goto(url);
    await drawn(page, "/q/overview");
  }
  if (route !== "/q/overview" || !page.url().endsWith("/")) {
    await page.evaluate((hash) => {
      location.hash = hash;
    }, route);
  }
  await drawn(page, route);
}

export { expect };

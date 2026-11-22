// The workspace area: open and create workspaces, the problems of the workspace, exports into its repositories,
// the ReqIF import and the settings. What each page shows is what core answers on the same folder.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { drawn, expect, open as openUrl, test } from "./fixtures.js";
import { createWorkspace, runOn, startUi } from "./start-ui.js";

const AREA = ["/w/open", "/w/problems", "/w/export", "/w/import", "/w/settings"];

/** A folder of its own for a test, removed by `done`. */
async function scratch(): Promise<{ readonly dir: string; readonly done: () => Promise<void> }> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-web-")));
  return { dir, done: () => fs.rm(dir, { recursive: true, force: true }) };
}

const workspaceName = (page: Page) => page.getByRole("navigation", { name: "Workspace" }).locator(".wsn");

test("without a workspace only the page to open one is shown, and opening one shows its overview", async ({
  page,
}) => {
  const workspace = await createWorkspace("no-identifier");
  const server = await startUi();
  try {
    await page.goto(server.url);
    await drawn(page, "/w/open");
    await expect(page.getByRole("heading", { level: 1, name: "Workspaces" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Workspace" })).toHaveCount(0);
    // Any other page leads back to it.
    await page.evaluate(() => {
      location.hash = "/q/drafts";
    });
    await drawn(page, "/w/open");

    await page.getByLabel("Folder of the workspace").fill(workspace.root);
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await drawn(page, "/q/overview");
    const status = await runOn(workspace.root)("workspace.status");
    await expect(workspaceName(page)).toHaveText(status.name);
  } finally {
    await server.close();
    await workspace.cleanup();
  }
});

test("a folder without a workspace is refused in plain words", async ({ page }) => {
  const folder = await scratch();
  const server = await startUi();
  try {
    await page.goto(server.url);
    await drawn(page, "/w/open");
    await page.getByLabel("Folder of the workspace").fill(folder.dir);
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("There is no workspace in this folder.");
    await expect(page.getByRole("heading", { level: 1, name: "Workspaces" })).toBeVisible();
  } finally {
    await server.close();
    await folder.done();
  }
});

test("a new workspace is created in the folder named and opened", async ({ page }) => {
  const folder = await scratch();
  const server = await startUi();
  try {
    await page.goto(server.url);
    await drawn(page, "/w/open");
    const root = path.join(folder.dir, "new-space");
    await page.getByLabel("Folder", { exact: true }).fill(root);
    await page.getByLabel("Name", { exact: true }).fill("Brakes");
    await page.getByLabel("Write the skill file for AI agents").uncheck();
    await page.getByRole("button", { name: "Create and open" }).click();
    await drawn(page, "/q/overview");
    await expect(workspaceName(page)).toHaveText("Brakes");
    expect((await runOn(root)("workspace.status")).name).toBe("Brakes");
  } finally {
    await server.close();
    await folder.done();
  }
});

test("the folder field completes the folders of the typed path", async ({ page, open }) => {
  const folder = await scratch();
  try {
    await fs.mkdir(path.join(folder.dir, "alpha"));
    await fs.mkdir(path.join(folder.dir, "beta"));
    await open("/w/open");
    const field = page.getByLabel("Folder of the workspace");
    await field.fill(`${folder.dir}/`);
    const options = page.locator(`#${(await field.getAttribute("list")) ?? ""} option`);
    await expect(options).toHaveCount(2);
    expect(await options.evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value))).toEqual([
      `${folder.dir}/alpha/`,
      `${folder.dir}/beta/`,
    ]);
  } finally {
    await folder.done();
  }
});

test("the problems page lists what the check of the workspace finds", async ({ page, open, ui }) => {
  const check = await ui.run("workspace.check", { severity: "info" });
  await open("/w/problems");
  await expect(page.getByRole("status").first()).toHaveText(check.answer);
  for (const severity of ["error", "warning", "info"] as const) {
    const count = check.problems.filter((p) => p.severity === severity).length;
    await expect(page.locator(`.plist[data-severity="${severity}"] > li`)).toHaveCount(Math.min(count, 500));
  }
  const broken = check.problems.filter((p) => p.severity !== "info").length;
  await expect(page.locator('[data-num="q:w-problems"]')).toHaveText(String(broken));
});

test("each export writes into the folder named and shows the path written", async ({ page, open, ui }) => {
  // The folders above the HTML pages and the ReqIF file must exist; the JSON export creates its own.
  await fs.mkdir(path.join(ui.root, "exports"), { recursive: true });
  try {
    await open("/w/export");
    const html = page.getByRole("region", { name: "HTML pages" });
    await html.getByRole("button", { name: "Export HTML" }).click();
    await expect(html.getByRole("status")).toContainText("Written to exports/html");
    await expect(fs.stat(path.join(ui.root, "exports", "html", "index.html"))).resolves.toBeTruthy();

    const reqif = page.getByRole("region", { name: "ReqIF" });
    const file = await reqif.getByLabel("File").inputValue();
    expect(file).toMatch(/^exports\/[a-z0-9-]+\.reqif$/);
    await reqif.getByRole("button", { name: "Export ReqIF" }).click();
    await expect(reqif.getByRole("status")).toContainText(`Written to ${file}`);
    await expect(fs.stat(path.join(ui.root, file))).resolves.toBeTruthy();

    const json = page.getByRole("region", { name: "JSON" });
    await json.getByRole("button", { name: "Export JSON" }).click();
    await expect(json.getByRole("status")).toContainText("Written to exports/json/");
    expect((await fs.readdir(path.join(ui.root, "exports", "json"))).length).toBe(1);
  } finally {
    await fs.rm(path.join(ui.root, "exports"), { recursive: true, force: true });
  }
});

test("an export to a folder whose parent is missing says so and writes nothing", async ({
  page,
  open,
  ui,
}) => {
  await open("/w/export");
  const html = page.getByRole("region", { name: "HTML pages" });
  await html.getByLabel("Folder").fill("nowhere/html");
  await html.getByRole("button", { name: "Export HTML" }).click();
  await expect(html.getByRole("alert")).toContainText("The folder to write into does not exist.");
  await expect(fs.stat(path.join(ui.root, "nowhere"))).rejects.toThrow();
});

test("a ReqIF file is checked first and then imported with the delivery named", async ({ page }) => {
  const source = await createWorkspace("no-identifier");
  const target = await scratch();
  try {
    await runOn(source.root)("reqif.export", { output: "delivery.reqif" });
    await runOn(target.dir)("workspace.init", { path: target.dir, name: "Target", skill: false });
    await fs.mkdir(path.join(target.dir, "in"));
    await fs.copyFile(
      path.join(source.root, "delivery.reqif"),
      path.join(target.dir, "in", "delivery.reqif"),
    );
    const run = runOn(target.dir);
    const analysis = await run("reqif.analyze", { file: "in/delivery.reqif" });
    const server = await startUi(target.dir);
    try {
      await openUrl(page, server.url, "/w/import");
      await page.getByLabel("ReqIF file").fill("in/delivery.reqif");
      await page.getByRole("button", { name: "Check file" }).click();
      await expect(page.getByRole("status").first()).toHaveText(analysis.answer);
      const plan = page.getByRole("region", { name: "What the import would do" });
      await expect(plan.locator("dt", { hasText: "New elements" }).locator("+ dd")).toHaveText(
        String(analysis.new.length),
      );
      await plan.getByLabel("Name of the delivery").fill("First delivery");
      await plan.getByRole("button", { name: "Import" }).click();
      await expect(plan.getByRole("status")).toContainText(/\S/);
      const list = await run("element.list", { limit: 1 });
      expect(list.total).toBe(analysis.new.length);
    } finally {
      await server.close();
    }
  } finally {
    await source.cleanup();
    await target.done();
  }
});

test("the settings show the workspace, its metamodel, the agent setup and the version", async ({
  page,
  open,
  ui,
}) => {
  const [status, mm, info, setup] = await Promise.all([
    ui.run("workspace.status"),
    ui.run("metamodel.get"),
    ui.run("tool.info"),
    ui.run("workspace.connectAgent", { client: "claude-code" }),
  ]);
  await open("/w/settings");
  const workspace = page.getByRole("region", { name: "Workspace", exact: true });
  await expect(workspace).toContainText(status.name);
  await expect(workspace).toContainText(info.workspace.path);
  const types = page.getByRole("region", { name: "Metamodel" }).locator("table").first();
  await expect(types.locator("tbody tr")).toHaveCount(mm.types.filter((t) => !t.abstract).length);
  await expect(page.getByRole("region", { name: "Version" })).toContainText(info.versions.cli);

  const agents = page.getByRole("region", { name: "AI agents" });
  await agents.getByLabel("Program").selectOption("claude-code");
  await agents.getByRole("button", { name: "Show setup" }).click();
  await expect(agents.locator("[data-setup]")).toHaveText(setup.setup?.text ?? "");

  await page.getByLabel("Dark").check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByLabel("As the system").check();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /./);
});

for (const scheme of ["light", "dark"] as const) {
  test(`the pages of the area have no WCAG 2.1 AA violations (${scheme})`, async ({ page, open }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    const problems: string[] = [];
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (const route of AREA) {
      await open(route);
      await expect(page.locator(".notice.bad:visible")).toHaveCount(0);
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      for (const v of result.violations) {
        problems.push(`${route}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
      }
    }
    expect(errors).toEqual([]);
    expect(problems, problems.join("\n")).toEqual([]);
  });
}

test("on a phone the pages of the area fit the width", async ({ page, open }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  for (const route of AREA) {
    await open(route);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), route).toBeLessThanOrEqual(390);
  }
});

// The workspace area: open and create workspaces, the problems of the workspace, exports into its repositories,
// the ReqIF import and the settings. What each page shows is what core answers on the same folder.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import type { MetamodelGetOutput } from "@reqseq/core";
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
    await expect(page).toHaveURL(/#\/w\/open$/);
    await drawn(page, "/w/open");

    await page.getByLabel("Folder of the workspace").fill(workspace.root);
    await page
      .getByRole("region", { name: "Open a workspace" })
      .getByRole("button", { name: "Open", exact: true })
      .click();
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
    await page
      .getByRole("region", { name: "Open a workspace" })
      .getByRole("button", { name: "Open", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("There is no workspace in this folder.");
    await expect(page.getByRole("heading", { level: 1, name: "Workspaces" })).toBeVisible();
    // A relative path is refused: the server and the commands would resolve it from different folders.
    await page.getByLabel("Folder of the workspace").fill("some/folder");
    await page
      .getByRole("region", { name: "Open a workspace" })
      .getByRole("button", { name: "Open", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("This needs the full path of the folder.");
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
    // The dialog of the operating system is only in the desktop shell (SR-253); the browser keeps the field.
    await expect(page.getByRole("button", { name: /^Choose/ })).toHaveCount(0);
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
  // Each export creates the missing folder exports/ itself.
  await expect(fs.stat(path.join(ui.root, "exports"))).rejects.toThrow();
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

test("an export into missing folders of the repository creates them", async ({ page, open, ui }) => {
  try {
    await open("/w/export");
    const html = page.getByRole("region", { name: "HTML pages" });
    await html.getByLabel("Folder").fill("nowhere/deeper/html");
    await html.getByRole("button", { name: "Export HTML" }).click();
    await expect(html.getByRole("status")).toContainText("Written to nowhere/deeper/html");
    await expect(
      fs.stat(path.join(ui.root, "nowhere", "deeper", "html", "index.html")),
    ).resolves.toBeTruthy();
  } finally {
    await fs.rm(path.join(ui.root, "nowhere"), { recursive: true, force: true });
  }
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
      const done = plan.getByRole("status");
      await expect(done).toContainText(`Files written: `);
      const list = await run("element.list", { limit: 1 });
      expect(list.total).toBe(analysis.new.length);
      // The import changed the workspace; the page keeps its answer when it hears of the change.
      await page.waitForTimeout(1500);
      await expect(done).toContainText("Files written: ");
      await expect(plan.getByLabel("Name of the delivery")).toHaveValue("First delivery");
    } finally {
      await server.close();
    }
  } finally {
    await source.cleanup();
    await target.done();
  }
});

/** A ReqIF file of another tool: two object types (one with an enumeration), a relation type and three objects. */
const FOREIGN = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd"><THE-HEADER><REQ-IF-HEADER IDENTIFIER="h"/></THE-HEADER>',
  "<CORE-CONTENT><REQ-IF-CONTENT><DATATYPES>",
  '<DATATYPE-DEFINITION-STRING IDENTIFIER="dt-s" MAX-LENGTH="1000"/>',
  '<DATATYPE-DEFINITION-ENUMERATION IDENTIFIER="dt-k"><SPECIFIED-VALUES>',
  ...["Functional", "Quality"].map(
    (v) =>
      `<ENUM-VALUE IDENTIFIER="k-${v}" LONG-NAME="${v}"><PROPERTIES><EMBEDDED-VALUE KEY="0" OTHER-CONTENT=""/></PROPERTIES></ENUM-VALUE>`,
  ),
  "</SPECIFIED-VALUES></DATATYPE-DEFINITION-ENUMERATION></DATATYPES><SPEC-TYPES>",
  '<SPEC-OBJECT-TYPE IDENTIFIER="ot-r" LONG-NAME="Requirement"><SPEC-ATTRIBUTES>',
  '<ATTRIBUTE-DEFINITION-STRING IDENTIFIER="a-t" LONG-NAME="Title"><TYPE><DATATYPE-DEFINITION-STRING-REF>dt-s</DATATYPE-DEFINITION-STRING-REF></TYPE></ATTRIBUTE-DEFINITION-STRING>',
  '<ATTRIBUTE-DEFINITION-ENUMERATION IDENTIFIER="a-k" LONG-NAME="Requirement type" MULTI-VALUED="false"><TYPE><DATATYPE-DEFINITION-ENUMERATION-REF>dt-k</DATATYPE-DEFINITION-ENUMERATION-REF></TYPE></ATTRIBUTE-DEFINITION-ENUMERATION>',
  '<ATTRIBUTE-DEFINITION-STRING IDENTIFIER="a-l" LONG-NAME="Legacy"><TYPE><DATATYPE-DEFINITION-STRING-REF>dt-s</DATATYPE-DEFINITION-STRING-REF></TYPE></ATTRIBUTE-DEFINITION-STRING>',
  "</SPEC-ATTRIBUTES></SPEC-OBJECT-TYPE>",
  '<SPEC-OBJECT-TYPE IDENTIFIER="ot-h" LONG-NAME="Heading"><SPEC-ATTRIBUTES>',
  '<ATTRIBUTE-DEFINITION-STRING IDENTIFIER="a-h" LONG-NAME="Caption"><TYPE><DATATYPE-DEFINITION-STRING-REF>dt-s</DATATYPE-DEFINITION-STRING-REF></TYPE></ATTRIBUTE-DEFINITION-STRING>',
  "</SPEC-ATTRIBUTES></SPEC-OBJECT-TYPE>",
  '<SPEC-RELATION-TYPE IDENTIFIER="rt" LONG-NAME="satisfies"/>',
  "</SPEC-TYPES><SPEC-OBJECTS>",
  ...[
    ["R-1", "One", "Functional"],
    ["R-2", "Two", "Quality"],
  ].map(
    ([id, title, kind]) =>
      `<SPEC-OBJECT IDENTIFIER="${String(id)}"><VALUES><ATTRIBUTE-VALUE-STRING THE-VALUE="${String(title)}"><DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>a-t</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION></ATTRIBUTE-VALUE-STRING><ATTRIBUTE-VALUE-ENUMERATION><DEFINITION><ATTRIBUTE-DEFINITION-ENUMERATION-REF>a-k</ATTRIBUTE-DEFINITION-ENUMERATION-REF></DEFINITION><VALUES><ENUM-VALUE-REF>k-${String(kind)}</ENUM-VALUE-REF></VALUES></ATTRIBUTE-VALUE-ENUMERATION></VALUES><TYPE><SPEC-OBJECT-TYPE-REF>ot-r</SPEC-OBJECT-TYPE-REF></TYPE></SPEC-OBJECT>`,
  ),
  '<SPEC-OBJECT IDENTIFIER="H-1"><VALUES/><TYPE><SPEC-OBJECT-TYPE-REF>ot-h</SPEC-OBJECT-TYPE-REF></TYPE></SPEC-OBJECT>',
  "</SPEC-OBJECTS><SPEC-RELATIONS>",
  '<SPEC-RELATION IDENTIFIER="L-1"><SOURCE><SPEC-OBJECT-REF>R-1</SPEC-OBJECT-REF></SOURCE><TARGET><SPEC-OBJECT-REF>R-2</SPEC-OBJECT-REF></TARGET><TYPE><SPEC-RELATION-TYPE-REF>rt</SPEC-RELATION-TYPE-REF></TYPE></SPEC-RELATION>',
  "</SPEC-RELATIONS></REQ-IF-CONTENT></CORE-CONTENT></REQ-IF>",
  "",
].join("\n");

/** The keys the mapping test picks: a concrete requirement type, a choice property of it with two choices, a relation kind. */
function targetsOf(mm: MetamodelGetOutput): {
  readonly type: string;
  readonly property: string;
  readonly first: string;
  readonly second: string;
  readonly relation: string;
} {
  const type = mm.types.find((t) => t.meaning === "requirement" && !t.abstract);
  const property = mm.properties.find(
    (p) => p.kind === "choice" && type?.properties.includes(p.key) === true && p.meaning === undefined,
  );
  const [first, second] = property?.choices ?? [];
  const relation = mm.relations[0];
  if (
    type === undefined ||
    property === undefined ||
    first === undefined ||
    second === undefined ||
    relation === undefined
  ) {
    throw new Error(
      "the standard metamodel lacks a requirement type with a choice property, or a relation kind",
    );
  }
  return {
    type: type.key,
    property: property.key,
    first: first.key,
    second: second.key,
    relation: relation.key,
  };
}

test("the mapping of a file of another tool is chosen on the page, saved, and the file imported with it", async ({
  page,
}) => {
  const target = await scratch();
  try {
    const run = runOn(target.dir);
    await run("workspace.init", { path: target.dir, name: "Target", skill: false });
    await fs.mkdir(path.join(target.dir, "in"));
    await fs.writeFile(path.join(target.dir, "in", "tool.reqif"), FOREIGN);
    const to = targetsOf(await run("metamodel.get"));
    const server = await startUi(target.dir);
    try {
      await openUrl(page, server.url, "/w/import");
      await page.getByLabel("ReqIF file").fill("in/tool.reqif");
      await page.getByRole("button", { name: "Check file" }).click();
      const map = page.getByRole("region", { name: "Map the file" });
      await expect(map).toBeVisible();
      const axe = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(axe.violations.map((v) => v.id)).toEqual([]);
      await expect(map.getByLabel("Name of the source")).toHaveValue("tool");
      await map.getByLabel("Name of the source").fill("Other tool");

      const requirement = map.getByRole("group", { name: "Type Requirement" });
      await requirement.getByLabel("Import as").selectOption(`=${to.type}`);
      // The attribute named like the title is guessed; a property is picked by its name.
      await expect(requirement.getByLabel("Title", { exact: true })).toHaveValue("=title");
      await requirement.getByLabel("Requirement type").selectOption(`=${to.property}`);
      await requirement.getByLabel("Legacy").selectOption({ label: "Leave out" });

      const heading = map.getByRole("group", { name: "Type Heading" });
      await heading.getByLabel("Import as").selectOption({ label: "Leave out" });
      await expect(heading.getByLabel("Caption")).toBeHidden();
      await map
        .getByRole("group", { name: "Relation types" })
        .getByLabel("satisfies")
        .selectOption(`=${to.relation}`);
      await map.getByRole("button", { name: "Save mapping" }).click();
      await expect(page.getByRole("status").first()).toContainText("Saved the mapping in");
      const mappingFile = await page.getByLabel("Mapping file").inputValue();
      expect(mappingFile).toMatch(/\.yaml$/);

      // The enumeration values come once the attribute goes to a choice property; each has a first guess or none.
      const values = map.getByRole("group", { name: "Values of Requirement type (Requirement)" });
      for (const v of ["Functional", "Quality"]) {
        await values.getByLabel(v).selectOption(`=${v === "Functional" ? to.first : to.second}`);
      }
      const axe2 = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(axe2.violations.map((v) => v.id)).toEqual([]);
      await map.getByRole("button", { name: "Save mapping" }).click();
      await expect(map).toHaveCount(0);

      const analysis = await run("reqif.analyze", { file: "in/tool.reqif", mapping: mappingFile });
      expect(analysis.unmapped).toEqual([]);
      const plan = page.getByRole("region", { name: "What the import would do" });
      await expect(plan.locator("dt", { hasText: "New elements" }).locator("+ dd")).toHaveText("2");
      await plan.getByLabel("Name of the delivery").fill("First");
      await plan.getByRole("button", { name: "Import" }).click();
      await expect(plan.getByRole("status")).toContainText(/\S/);
      const list = await run("element.list", { limit: 5 });
      expect(list.total).toBe(2);
      const one = list.elements?.find((e) => e.title === "One");
      expect(one?.properties[to.property]).toBe(to.first);
    } finally {
      await server.close();
    }
  } finally {
    await target.done();
  }
});

test("a saved mapping that ReqSeq refuses keeps its choices on the page to change the refused one", async ({
  page,
}) => {
  const target = await scratch();
  try {
    const run = runOn(target.dir);
    await run("workspace.init", { path: target.dir, name: "Target", skill: false });
    await fs.mkdir(path.join(target.dir, "in"));
    await fs.writeFile(path.join(target.dir, "in", "tool.reqif"), FOREIGN);
    const to = targetsOf(await run("metamodel.get"));
    const server = await startUi(target.dir);
    try {
      await openUrl(page, server.url, "/w/import");
      await page.getByLabel("ReqIF file").fill("in/tool.reqif");
      await page.getByRole("button", { name: "Check file" }).click();
      const map = page.getByRole("region", { name: "Map the file" });
      const requirement = map.getByRole("group", { name: "Type Requirement" });
      await requirement.getByLabel("Import as").selectOption(`=${to.type}`);
      // A text attribute into a choice property: ReqSeq refuses it when it checks the file with the mapping.
      await requirement.getByLabel("Legacy").selectOption(`=${to.property}`);
      await requirement.getByLabel("Requirement type").selectOption({ label: "Leave out" });
      await map
        .getByRole("group", { name: "Type Heading" })
        .getByLabel("Import as")
        .selectOption({ label: "Leave out" });
      await map
        .getByRole("group", { name: "Relation types" })
        .getByLabel("satisfies")
        .selectOption({ label: "Leave out" });
      await map.getByRole("button", { name: "Save mapping" }).click();
      await expect(page.getByRole("alert")).toContainText("Legacy");
      await expect(requirement.getByLabel("Legacy")).toHaveValue(`=${to.property}`);
      await expect(requirement.getByLabel("Import as")).toHaveValue(`=${to.type}`);

      await requirement.getByLabel("Legacy").selectOption({ label: "Leave out" });
      await map.getByRole("button", { name: "Save mapping" }).click();
      await expect(map).toHaveCount(0);
      const plan = page.getByRole("region", { name: "What the import would do" });
      await expect(plan.locator("dt", { hasText: "New elements" }).locator("+ dd")).toHaveText("2");
    } finally {
      await server.close();
    }
  } finally {
    await target.done();
  }
});

test("a mapping file this page did not build is not changed here", async ({ page }) => {
  const target = await scratch();
  try {
    const run = runOn(target.dir);
    await run("workspace.init", { path: target.dir, name: "Target", skill: false });
    await fs.mkdir(path.join(target.dir, "in"));
    await fs.writeFile(path.join(target.dir, "in", "tool.reqif"), FOREIGN);
    await fs.writeFile(
      path.join(target.dir, "in", "map.yaml"),
      "reqseq-reqif-mapping: 1\nsource: { name: Other }\ntypes: [{ source: Heading, omit: true }]\n",
    );
    const server = await startUi(target.dir);
    try {
      await openUrl(page, server.url, "/w/import");
      await page.getByLabel("ReqIF file").fill("in/tool.reqif");
      await page.getByLabel("Mapping file").fill("in/map.yaml");
      await page.getByRole("button", { name: "Check file" }).click();
      const plan = page.getByRole("region", { name: "What the import would do" });
      await expect(plan).toContainText("this page chooses only for a mapping it builds itself");
      await expect(page.getByRole("region", { name: "Map the file" })).toHaveCount(0);
    } finally {
      await server.close();
    }
  } finally {
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

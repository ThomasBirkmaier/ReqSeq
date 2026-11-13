// The command prompt on the built app (SR-108, SR-121, SR-133, ThomasBirkmaier/ReqSeq-archive#85): what was chosen for a typed text comes
// first the next time, also after the app restarts; the commands that fit the shown view come first; a catalog
// command asks its arguments with the values core gives; a write command ("Confirm hints") runs from it.
// Keys use ControlOrMeta, so the same tests run on Linux and macOS. With REQSEQ_SCREENSHOTS set, the argument
// entry is also saved as a screenshot there; the criteria hits of SR-215 AK1 always are (`SHOTS`).
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, listAll, modifier } from "./support/app.js";

const FIXTURE = { fixture: "SR-069/filter" };

/** Where a screenshot of a test goes: REQSEQ_SCREENSHOTS, else the folder the CI artifact holds. */
const SHOTS =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

const names = (window: Page) => window.locator('.candidates [role="option"] .name');

test.describe("the command prompt", () => {
  let running: RunningApp;

  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-121/AK-ynwj] a text typed for a command puts that command first the next time, also after a restart", async () => {
    running = await launchApp(FIXTURE);
    let { window } = running;
    await listAll(window);
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("fl");
    // By match "Filter list by type" is first for "fl", then the other filters by name.
    await expect(names(window).first()).toHaveText("Filter list by type");
    await window.keyboard.press("ArrowDown");
    await window.keyboard.press("ArrowDown");
    await window.keyboard.press("ArrowDown");
    await expect(window.locator('.candidates [aria-selected="true"] .name')).toHaveText(
      "Filter list by status",
    );
    await window.keyboard.press("Enter");
    await expect(window.locator("label.prompt-label")).toHaveText("Status");
    await window.keyboard.press("Escape");
    // The same text now puts the chosen command first.
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("fl");
    await expect(names(window).first()).toHaveText("Filter list by status");
    await window.keyboard.press("Escape");

    const { kept } = running;
    await running.close({ keep: true });
    running = await launchApp(undefined, { kept });
    ({ window } = running);
    await listAll(window);
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("fl");
    await expect(names(window).first()).toHaveText("Filter list by status");
    // Another text is not changed.
    await window.keyboard.press("Escape");
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("flt");
    await expect(names(window).first()).toHaveText("Filter list by type");
  });

  test('[SR-121/AK-yx6t] "lae", the initials of List all elements, puts it first, and Enter runs it', async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("lae");
    await expect(names(window).first()).toHaveText("List all elements");
    await window.keyboard.press("Enter");
    await expect(window.getByRole("listbox", { name: "All elements" })).toBeVisible();
    await expect(window.locator("label.prompt-label")).toHaveCount(0);
  });

  test("[SR-133/AK-w23t] Bulk update elements, which needs the selection of a list, is found only on a list or a package page, and no write command is found while the tool refuses writes", async () => {
    const input = (window: Page): Locator => window.locator("#prompt-input");
    /** The prompt, with `typed` in it, offers `typed` as a candidate; the prompt closes again. */
    const finds = async (window: Page, typed: string): Promise<void> => {
      await window.keyboard.press("ControlOrMeta+Shift+P");
      await window.keyboard.type(typed);
      await expect(input(window)).toHaveValue(typed);
      await expect(names(window).filter({ hasText: new RegExp(`^${typed}$`, "u") })).toHaveCount(1);
      await window.keyboard.press("Escape");
      await expect(window.locator("label.prompt-label")).toHaveCount(0);
    };
    /**
     * The prompt finds nothing for `typed`: the list of candidates, open with everything before the text, has
     * closed for it, so the check reads the result for the whole text and not the list before it.
     */
    const findsNothing = async (window: Page, typed: string): Promise<void> => {
      await window.keyboard.press("ControlOrMeta+Shift+P");
      await expect(input(window)).toHaveAttribute("aria-expanded", "true");
      await window.keyboard.type(typed);
      await expect(input(window)).toHaveValue(typed);
      await expect(input(window)).toHaveAttribute("aria-expanded", "false");
      await expect(names(window)).toHaveCount(0);
      await window.keyboard.press("Escape");
      await expect(window.locator("label.prompt-label")).toHaveCount(0);
    };
    running = await launchApp(FIXTURE);
    let { window } = running;
    await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
    // It needs the selection of a list: not on the overview, nor on an element, also not by search.
    await finds(window, "Search elements");
    await findsNothing(window, "Bulk update elements");
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type("Measure wind speed");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("Measure wind speed");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toContainText("Measure wind speed");
    await finds(window, "Set status");
    await findsNothing(window, "Bulk update elements");
    // A list and a package page have a selection.
    await listAll(window);
    await finds(window, "Bulk update elements");
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type("Sensors");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("Sensors");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText("Sensors");
    await expect(window.locator(".members .row").first()).toBeVisible();
    await finds(window, "Bulk update elements");
    await running.close();

    // A metamodel file that is no YAML: the tool refuses writes (SR-011 AK3), so no write command is found.
    running = await launchApp({ ...FIXTURE, files: { "metamodel/broken.yaml": "types: [\n" } });
    ({ window } = running);
    await listAll(window);
    const status = await running.cli(["workspace", "status"]);
    expect((JSON.parse(status.stdout) as { readOnly?: boolean }).readOnly).toBe(true);
    // Reading still works.
    await finds(window, "Show evidence coverage");
    for (const write of ["Set status", "Create relation", "Bulk update elements", "Create element"]) {
      await findsNothing(window, write);
    }
  });

  test("a catalog read command asks its arguments in the minibuffer, the optional ones with the values the catalog allows, and shows its output", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    const label = window.locator("label.prompt-label");
    await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type("Measure wind speed");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("Measure wind speed");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toContainText("Measure wind speed");
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("Show trace chain");
    await expect(names(window).first()).toHaveText("Show trace chain");
    // Ctrl/Cmd+Enter: the arguments, and then the optional ones.
    await window.keyboard.press("ControlOrMeta+Enter");
    await expect(label).toHaveText("Show trace chain · ref:");
    await expect(names(window).first()).toHaveText("SR-0000b1 Measure wind speed");
    await window.keyboard.press("ControlOrMeta+Enter");
    await expect(label).toHaveText("Show trace chain SR-0000b1 · more arguments:");
    await expect(names(window).nth(0)).toHaveText("Run");
    await expect(names(window).nth(1)).toHaveText("direction");
    await window.keyboard.press("ArrowDown");
    await window.keyboard.press("Enter");
    await expect(label).toHaveText("Show trace chain SR-0000b1 · direction:");
    await expect(names(window)).toHaveText(["up", "down", "both"]);
    await window.keyboard.type("up");
    const shots = process.env["REQSEQ_SCREENSHOTS"];
    if (shots !== undefined) {
      await window.screenshot({ path: path.join(shots, "catalog-prompt.png") });
    }
    await window.keyboard.press("Enter");
    await expect(names(window).first()).toHaveText("Run");
    await window.keyboard.press("Enter");
    await expect(window.locator(".modeline")).toContainText("Show trace chain SR-0000b1 up");
    await expect(window.locator(".result")).toContainText("N-0000a1");
  });

  test("[SR-215/AK-fj75] Record evidence offers the criteria with their key beside and the evidence locations as hits, and writes what was chosen", async () => {
    running = await launchApp({ fixture: "SR-031/criteria" });
    const { window } = running;
    const label = window.locator("label.prompt-label");
    const hits = window.locator('.candidates [role="option"]');
    await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type("Show temperature");
    await expect(hits.first()).toContainText("Show temperature");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toContainText("Show temperature");
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("Record evidence");
    await expect(names(window).first()).toHaveText("Record evidence");
    await window.keyboard.press("Enter");
    await window.keyboard.press("Enter");
    await expect(label).toHaveText(/^Record evidence SR-\S+ · kind:$/);
    await window.keyboard.type("verif");
    await window.keyboard.press("Enter");
    await window.keyboard.type("passed");
    await window.keyboard.press("ControlOrMeta+Enter");
    await expect(label).toHaveText(/ · more arguments:$/);
    await window.keyboard.type("method");
    await window.keyboard.press("Enter");
    await window.keyboard.type("inspection");
    await window.keyboard.press("ControlOrMeta+Enter");
    await window.keyboard.type("item");
    await window.keyboard.press("Enter");
    await expect(label).toHaveText(/ · item:$/);
    await window.keyboard.type("Sample C1");
    await window.keyboard.press("ControlOrMeta+Enter");
    await expect(label).toHaveText(/ · more arguments:$/);
    await window.keyboard.type("criteria");
    await window.keyboard.press("Enter");
    await expect(label).toHaveText(/ · criteria:$/);
    // Each criterion with a key by its number and text, the key beside it, quieter than the name.
    await expect(names(window)).toHaveText([
      "AK1 Given a reading, then it shows.",
      "AK2 Given no reading, then a dash shows.",
      "AK3 Given frost, then a mark shows.",
    ]);
    await expect(hits.locator(".hint")).toHaveText(["kred", "kdas", "kfro"]);
    // The hits with their keys, in light, for the CI artifact.
    await fs.mkdir(SHOTS, { recursive: true });
    await window.screenshot({ path: path.join(SHOTS, "sr-215-criteria-light.png") });
    await window.keyboard.type("frost");
    await expect(names(window)).toHaveText(["AK3 Given frost, then a mark shows."]);
    await window.keyboard.press("Enter");
    await expect(names(window)).toHaveText([
      "AK1 Given a reading, then it shows.",
      "AK2 Given no reading, then a dash shows.",
    ]);
    // Ctrl/Cmd+Enter on the empty input ends the list and offers the other arguments.
    await window.keyboard.press("ControlOrMeta+Enter");
    await window.keyboard.type("folder");
    await window.keyboard.press("Enter");
    await expect(label).toHaveText(/ · folder:$/);
    await expect(names(window)).toHaveText(["evidence"]);
    await expect(hits.locator(".hint")).toHaveText(["system"]);
    await window.keyboard.press("ControlOrMeta+Enter");
    await expect(names(window).first()).toHaveText("Run");
    await window.keyboard.press("Enter");
    await expect(window.locator(".result")).toContainText("evidence/");
    const written = /evidence\/\S+\.md/u.exec(await window.locator(".result").innerText())?.[0];
    expect(written).toBeDefined();
    const record = await fs.readFile(path.join(running.workspace?.root ?? "", written ?? ""), "utf8");
    expect(record).toContain("kfro");
    expect(record).not.toContain("kred");
  });

  test("[SR-067/AK-fcfh] Create relation with the target open writes only the file of the source", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    const root = running.workspace?.root ?? "";
    const label = window.locator("label.prompt-label");
    /** Every file of the workspace with its text. */
    const files = async (): Promise<Map<string, string>> => {
      const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });
      const texts = new Map<string, string>();
      for (const entry of entries.filter((found) => found.isFile())) {
        const file = path.join(entry.parentPath, entry.name);
        texts.set(path.relative(root, file), await fs.readFile(file, "utf8"));
      }
      return texts;
    };
    // The target is open in the app; the source is another element.
    await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type("See the wind");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("See the wind");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText("See the wind");
    const before = await files();
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("Create relation");
    await expect(names(window).first()).toHaveText("Create relation");
    await window.keyboard.press("Enter");
    await expect(label).toHaveText("Create relation · source:");
    await window.keyboard.type("Send data");
    await expect(names(window).first()).toHaveText("SR-0000b5 Send data to the cloud");
    await window.keyboard.press("Enter");
    await expect(label).toHaveText("Create relation SR-0000b5 · kind:");
    await window.keyboard.type("derives");
    await expect(names(window).first()).toHaveText("Derives from");
    await window.keyboard.press("Enter");
    await window.keyboard.type("See the wind");
    await expect(names(window).first()).toHaveText("N-0000a1 See the wind");
    await window.keyboard.press("Enter");
    await expect(window.locator(".result")).toBeVisible();
    const source = path.join("requirements", "SR-0000000000b5.md");
    await expect
      .poll(async () => (await fs.readFile(path.join(root, source), "utf8")).includes("0000000000a1"))
      .toBe(true);
    const after = await files();
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    expect([...after].filter(([file, text]) => before.get(file) !== text).map(([file]) => file)).toEqual([
      source,
    ]);
  });

  test("[SR-133/AK-w23t] in an element and in a list, the empty prompt shows the first nine fitting commands, then All commands…", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type("Measure wind speed");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("Measure wind speed");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toContainText("Measure wind speed");
    // Without use: the letters after the prefix key in the order of the next keys, then the own shortcuts.
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await expect(names(window)).toHaveText([
      "Create relation",
      "Set status",
      "Confirm hints",
      "List all elements",
      "Open perspective",
      "Show overview",
      "Close buffer",
      "Go to element or buffer",
      "Search elements",
      "All commands…",
    ]);
    await fs.mkdir(SHOTS, { recursive: true });
    await window.screenshot({ path: path.join(SHOTS, "sr-133-prompt-element-light.png") });
    // A command that does not fit is found by typing.
    await window.keyboard.type("workspace status");
    await expect(names(window).first()).toHaveText("Show workspace status");
    await window.keyboard.press("Escape");
    await listAll(window);
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await expect(names(window)).toHaveText([
      "List all elements",
      "Open perspective",
      "Show overview",
      "Filter list by type",
      "Sort list",
      "Close buffer",
      "Go to element or buffer",
      "Search elements",
      "Show traceability matrix",
      "All commands…",
    ]);
    await window.keyboard.press("Escape");
  });

  test("[SR-133/AK-w7wd] [SR-134/AK-trng] Escape in the first argument of a command chosen from All commands… goes back to that list", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    const label = window.locator("label.prompt-label");
    await listAll(window);
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.locator('.candidates [role="option"]').filter({ hasText: "All commands…" }).click();
    await expect(label).toHaveText("All commands");
    await window.keyboard.type("Filter list by status");
    await expect(names(window).first()).toHaveText("Filter list by status");
    await window.keyboard.press("Enter");
    await expect(label).toHaveText("Status");
    await window.keyboard.press("Escape");
    await expect(label).toHaveText("All commands");
    await expect(window.locator(".prompt-input")).toHaveValue("");
    await window.keyboard.press("Escape");
    await expect(label).toHaveCount(0);
  });

  test("Confirm hints: Enter, Enter, Enter on an element with one outdated relation confirms it", async () => {
    // The text of D1 changed, so that S1's `based-on` D1 is outdated (SR-025), as in neighbourhood.spec.ts.
    const d1 = "5e107a7d-2b4f-4c61-9d08-0d0000000001";
    running = await launchApp({
      fixture: "SR-107/neighbourhood",
      files: {
        "decisions/D-0d0000000001.md": `---\nid: ${d1}\ntype: decision\nstatus: approved\ntitle: Use a cup anemometer\n---\n\nA cup anemometer with three cups measures the wind speed.\n`,
      },
    });
    const { window } = running;
    const label = window.locator("label.prompt-label");
    const hints = async (): Promise<string[]> => {
      const listed = await running.cli(["hint", "list"]);
      expect(listed.code).toBe(0);
      // The fixture's requirement without a parent (SR-022 AK6) is a hint that cannot be confirmed.
      return (JSON.parse(listed.stdout) as { hints: { code: string; elementShortId: string }[] }).hints
        .filter((hint) => hint.code !== "trace.no-parent")
        .map((hint) => `${hint.code} ${hint.elementShortId}`);
    };
    expect(await hints()).toEqual(["relation.outdated SR-b0000000001"]);
    await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type("SR-b0000000001");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("Show wind speed");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toContainText("Show wind speed");
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("Confirm hints");
    await expect(names(window).first()).toHaveText("Confirm hints");
    await window.keyboard.press("Enter");
    await expect(label).toHaveText("Confirm hints · ref:");
    await expect(names(window).first()).toHaveText("SR-b0000000001 Show wind speed");
    await window.keyboard.press("Enter");
    await expect(label).toHaveText("Confirm hints SR-b0000000001 · hintIds:");
    // A hint is named by its target first, and a long one wraps instead of scrolling the card sideways (#293).
    await expect(names(window).first()).toHaveText(/^D-[0-9a-f]+ · .* points to an older version of /);
    const card = window.locator(".candidates");
    expect(await card.evaluate((list) => list.scrollWidth <= list.clientWidth)).toBe(true);
    await window.keyboard.press("Enter");
    await expect(window.locator(".modeline")).toContainText("Confirm hints SR-b0000000001");
    await expect(window.locator(".result")).toContainText("confirmed");
    expect(await hints()).toEqual([]);
  });

  test("List hints offers the problem codes as kind, and lists only the hints of the code taken (#1575)", async () => {
    const common = JSON.parse(
      await fs.readFile(new URL("../../../schemas/common.schema.json", import.meta.url), "utf8"),
    ) as { readonly $defs: { readonly problemCode: { readonly enum: readonly string[] } } };
    const codes = common.$defs.problemCode.enum;
    running = await launchApp(FIXTURE);
    const { window } = running;
    const label = window.locator("label.prompt-label");
    await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("List hints");
    await expect(names(window).first()).toHaveText("List hints");
    await window.keyboard.press("ControlOrMeta+Enter");
    await expect(label).toHaveText("List hints · more arguments:");
    await expect(names(window).nth(1)).toHaveText("kind");
    await window.keyboard.press("ArrowDown");
    await window.keyboard.press("Enter");
    await expect(label).toHaveText("List hints · kind:");
    await expect(names(window).first()).toHaveText(codes[0] ?? "");
    await window.keyboard.type("unknown-prop");
    await expect(names(window).first()).toHaveText("element.unknown-property");
    await window.keyboard.press("Enter");
    // A list field takes one value per Enter; Enter on an empty input ends it.
    await window.keyboard.press("Enter");
    await expect(names(window).first()).toHaveText("Run");
    await window.keyboard.press("Enter");
    await expect(window.locator(".modeline")).toContainText("List hints");
    const cli = await running.cli(["hint", "list", "--kind", "element.unknown-property"]);
    const listed = (JSON.parse(cli.stdout) as { hints: { code: string; elementShortId: string }[] }).hints;
    expect(listed.map((hint) => hint.elementShortId)).toEqual(["SR-0000b4"]);
    await expect(window.locator(".result")).toContainText("SR-0000b4");
    await expect(window.locator(".result")).toContainText("element.unknown-property");
    await expect(window.locator(".result")).not.toContainText("relation.outdated");
  });

  test.describe("arguments completed with the values of the metamodel (SR-108 AK4)", () => {
    /** What the CLI gives for `metamodel get`. */
    interface Metamodel {
      readonly types: readonly { readonly key: string; readonly statuses: readonly string[] }[];
      readonly statuses: readonly { readonly key: string; readonly name: string }[];
      readonly properties: readonly {
        readonly key: string;
        readonly name: string;
        readonly meaning?: string;
        readonly choices?: readonly { readonly name: string }[];
      }[];
    }
    const metamodel = async (): Promise<Metamodel> =>
      JSON.parse((await running.cli(["metamodel", "get"])).stdout) as Metamodel;
    const label = (window: Page) => window.locator("label.prompt-label");
    const open = async (window: Page, shortId: string, title: string): Promise<void> => {
      await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
      await window.keyboard.press("ControlOrMeta+P");
      await window.keyboard.type(shortId);
      await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
      await window.keyboard.press("Enter");
      await expect(window.locator("article h1")).toContainText(title);
    };
    const command = async (window: Page, title: string): Promise<void> => {
      await window.keyboard.press("ControlOrMeta+Shift+P");
      await window.keyboard.type(title);
      await expect(names(window).first()).toHaveText(title);
      await window.keyboard.press("Enter");
    };

    test("[SR-108/AK-v62v] Set status offers only the statuses of the element's type, and a typed fragment finds one first", async () => {
      // Software requirements may only be draft or approved; "Obsolete" is a status of the metamodel.
      running = await launchApp({
        ...FIXTURE,
        files: {
          "metamodel/software.yaml": [
            "reqseq-metamodel: 1",
            "types:",
            "  - key: software-requirement",
            "    name: Software Requirement",
            "    prefix: SWR",
            "    extends: system-requirement",
            "    properties: [priority]",
            "    statuses: [draft, approved]",
            "properties:",
            "  - { key: priority, name: Priority, kind: number }",
            "",
          ].join("\n"),
        },
      });
      const { window } = running;
      await open(window, "SWR-0000f1", "Filter the sensor signal");
      await command(window, "Set status");
      await expect(label(window)).toHaveText("Set status · refs:");
      await window.keyboard.press("Enter");
      await expect(label(window)).toHaveText("Set status SWR-0000f1 · refs:");
      await window.keyboard.press("Enter");
      await expect(label(window)).toHaveText("Set status SWR-0000f1 · status:");
      const model = await metamodel();
      const allowed = model.types.find((type) => type.key === "software-requirement")?.statuses ?? [];
      expect(model.statuses.map((status) => status.name)).toContain("Obsolete");
      await expect(names(window)).toHaveText(
        model.statuses.filter((status) => allowed.includes(status.key)).map((status) => status.name),
      );
      await expect(names(window)).toHaveText(["Draft", "Approved"]);
      await window.keyboard.type("aprv");
      await expect(names(window).first()).toHaveText("Approved");
      await expect(names(window).first().locator("mark")).toHaveText(["Ap", "r", "v"]);
      await window.keyboard.press("Enter");
      await expect(window.locator(".result")).toBeVisible();
      const element = await running.cli(["element", "get", "SWR-0000f1"]);
      expect((JSON.parse(element.stdout) as { element: { status: string } }).element.status).toBe("approved");
    });

    test("[SR-108/AK-v62v] Create relation offers the kinds relation options gives and only targets of their types, also for a target typed with a typo", async () => {
      // One more decision whose title has a word of a requirement and a need ("wind").
      running = await launchApp({
        ...FIXTURE,
        files: {
          "decisions/D-0000000000e2.md":
            "---\nid: 69069069-0000-4000-8000-0000000000e2\ntype: decision\nstatus: draft\ntitle: Shield the wind vane\n---\n",
        },
      });
      const { window } = running;
      await open(window, "SR-0000b1", "Measure wind speed");
      await command(window, "Create relation");
      await expect(label(window)).toHaveText("Create relation · source:");
      await window.keyboard.press("Enter");
      await expect(label(window)).toHaveText("Create relation SR-0000b1 · kind:");
      const options = await running.cli(["relation", "options", "SR-0000b1"]);
      const kinds = (JSON.parse(options.stdout) as { kinds: { name: string }[] }).kinds.map(
        (kind) => kind.name,
      );
      // "Excludes" is a kind of the metamodel that a system requirement may not have.
      expect(kinds).not.toContain("Excludes");
      await expect(names(window)).toHaveText(kinds);
      await window.keyboard.type("based");
      await expect(names(window).first()).toHaveText("Based on");
      await window.keyboard.press("Enter");
      await expect(label(window)).toHaveText("Create relation SR-0000b1 Based on · target:");
      // Only decisions: "wind" also names a requirement and a need, which are no targets of "Based on".
      await window.keyboard.type("wind");
      await expect(names(window)).toHaveText(["D-0000e2 Shield the wind vane"]);
      await window.keyboard.press("ControlOrMeta+A");
      await window.keyboard.type("ultrasnd");
      await expect(names(window).first()).toHaveText("D-0000e1 Use ultrasound");
      await window.keyboard.press("Enter");
      await expect(window.locator(".result")).toBeVisible();
      const element = await running.cli(["element", "get", "SR-0000b1"]);
      const relations = (
        JSON.parse(element.stdout) as { element: { relations: { kind: string; shortId?: string }[] } }
      ).element.relations;
      expect(relations.map((relation) => `${relation.kind} ${relation.shortId ?? ""}`)).toContain(
        "based-on D-0000e1",
      );
    });

    test("[SR-108/AK-v62v] Bulk update offers the metamodel's properties and that property's values", async () => {
      running = await launchApp(FIXTURE);
      const { window } = running;
      await listAll(window);
      await command(window, "Bulk update elements");
      await expect(label(window)).toHaveText("Bulk update elements · property:");
      const model = await metamodel();
      await expect(names(window)).toHaveText(
        model.properties.filter((property) => property.meaning !== "title").map((property) => property.name),
      );
      await window.keyboard.type("Requirement Type");
      await expect(names(window).first()).toHaveText("Requirement Type");
      await window.keyboard.press("Enter");
      await expect(label(window)).toHaveText("Bulk update elements Requirement Type · operation:");
      await window.keyboard.type("set");
      await expect(names(window).first()).toHaveText("set");
      await window.keyboard.press("Enter");
      await expect(label(window)).toHaveText("Bulk update elements Requirement Type set · value:");
      const choices = model.properties.find((property) => property.key === "requirement-type")?.choices ?? [];
      await expect(names(window)).toHaveText(choices.map((choice) => choice.name));
      // Escape: one argument back (SR-134 AK1), and nothing is written.
      await window.keyboard.press("Escape");
      await expect(label(window)).toHaveText("Bulk update elements Requirement Type · operation:");
    });

    test("Bulk update on the list of all elements takes every element (#856)", async () => {
      running = await launchApp(FIXTURE);
      const { window } = running;
      // The plain list of all elements, no view chosen: it has no selection of its own.
      await listAll(window);
      await command(window, "Bulk update elements");
      await window.keyboard.type("Rationale");
      await expect(names(window).first()).toHaveText("Rationale");
      await window.keyboard.press("Enter");
      await window.keyboard.type("set");
      await expect(names(window).first()).toHaveText("set");
      await window.keyboard.press("Enter");
      await window.keyboard.type("Every element");
      await window.keyboard.press("Enter");
      // The preview (no confirm) of every element, as the CLI gives it for the empty selection.
      await expect(window.locator(".result")).toBeVisible();
      await expect(window.locator(".minibuffer .echo")).not.toContainText("selection is required");
      const cli = await running.cli([
        "element",
        "bulk-update",
        "--input",
        JSON.stringify({ selection: {}, property: "rationale", operation: "set", value: "Every element" }),
      ]);
      const preview = JSON.parse(cli.stdout) as {
        readonly count: number;
        readonly affected: readonly { readonly shortId: string }[];
      };
      expect(preview.count).toBeGreaterThan(1);
      for (const { shortId } of preview.affected) {
        await expect(window.locator(".result")).toContainText(shortId);
      }
    });

    test("Bulk update with confirm yes writes only after its preview was shown, with its plan (#836)", async () => {
      running = await launchApp(FIXTURE);
      const { window } = running;
      const rationale = async (): Promise<unknown> =>
        (
          JSON.parse((await running.cli(["element", "get", "SR-0000b1"])).stdout) as {
            readonly element: { readonly properties: Readonly<Record<string, unknown>> };
          }
        ).element.properties["rationale"];
      const confirmed = async (): Promise<void> => {
        // The system requirements: a list with a selection (the list of all elements has none).
        await listAll(window);
        await command(window, "Filter list by type");
        await expect(label(window)).toHaveText("Type");
        await window.keyboard.type("system-requirement");
        await expect(names(window).first()).toHaveText("system-requirement");
        await window.keyboard.press("Enter");
        await expect(window.getByRole("listbox", { name: "type: system-requirement" })).toBeVisible();
        await command(window, "Bulk update elements");
        await window.keyboard.type("Rationale");
        await expect(names(window).first()).toHaveText("Rationale");
        await window.keyboard.press("Enter");
        await window.keyboard.type("set");
        await expect(names(window).first()).toHaveText("set");
        await window.keyboard.press("Enter");
        await expect(label(window)).toHaveText("Bulk update elements Rationale set · value:");
        await window.keyboard.type("Previewed first");
        await window.keyboard.press("ControlOrMeta+Enter");
        await expect(label(window)).toContainText("more arguments:");
        await window.keyboard.type("confirm");
        await expect(names(window).first()).toHaveText("confirm");
        await window.keyboard.press("Enter");
        await window.keyboard.type("yes");
        await expect(names(window).first()).toHaveText("yes");
        await window.keyboard.press("Enter");
        await expect(names(window).first()).toHaveText("Run");
        await window.keyboard.press("Enter");
      };
      await confirmed();
      // No preview was shown: the preview is, and nothing is written.
      await expect(window.locator(".minibuffer .echo")).toHaveText(
        "Bulk update elements: nothing was written; confirm again to write what the preview shows",
      );
      await expect(window.locator(".result")).toContainText("plan");
      expect(await rationale()).toBeUndefined();
      // The same change again, with its preview open: written.
      await confirmed();
      await expect(window.locator(".result")).toContainText("applied");
      await expect.poll(rationale).toBe("Previewed first");
    });
  });
});

/** Opens the element "Measure wind speed" with "Go to". */
const openElement = async (window: Page, mod: string): Promise<void> => {
  await window.locator('[aria-label="Sheet"] > *').first().waitFor();
  await window.keyboard.press(`${mod}+P`);
  await window.keyboard.type("Measure wind speed");
  await expect(window.locator('.candidates [role="option"]').first()).toContainText("Measure wind speed");
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toContainText("Measure wind speed");
};

/** The prefix key as the renderer's platform writes it: "Ctrl+K", or "⌘K" on macOS. */
const prefixOf = async (window: Page): Promise<string> =>
  (await window.evaluate(() => navigator.platform.startsWith("Mac"))) ? "⌘K" : "Ctrl+K";

test.describe("the prefix key Ctrl/Cmd+K and the shortcuts in the prompt", () => {
  let running: RunningApp;

  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-109/AK-kwtg] Ctrl/Cmd+K and a pause show the next keys, and L lists all elements", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    const mod = await modifier(window);
    await openElement(window, mod);
    await window.keyboard.press(`${mod}+K`);
    await expect(window.locator(".minibuffer .echo")).toHaveText(`${await prefixOf(window)}-`);
    await window.waitForTimeout(700);
    const rows = window.getByRole("list", { name: "Next keys" });
    await expect(rows).toBeVisible();
    await expect(rows.locator(".name")).toContainText([
      "Create element",
      "List all elements",
      "Show overview",
    ]);
    await expect(rows).toContainText("List all elements");
    await expect(rows).not.toContainText("Filter list by type");
    await expect(rows.locator("li").filter({ hasText: "List all elements" }).locator(".key")).toHaveText("L");
    await window.keyboard.press("l");
    await expect(window.locator(".row").first()).toBeVisible();
    await expect(rows).toHaveCount(0);
  });

  test("[SR-109/AK-kwtg] the letter after Ctrl/Cmd+K is never typed into the text", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    const mod = await modifier(window);
    const text = window.locator('article [data-field="Text"] .cm-content');
    const topic = window.locator('[data-field="topic"] .cm-content');
    await openElement(window, mod);
    await expect(text).toHaveText("b1: derives from N1, in package P1.");

    // The caret in the text: Ctrl/Cmd+K, O shows the overview; the text has no "o".
    await text.click();
    await window.keyboard.press("End");
    await window.keyboard.press(`${mod}+K`);
    await window.keyboard.press("o");
    await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
    await openElement(window, mod);
    await expect(text).toHaveText("b1: derives from N1, in package P1.");

    // The caret in a property box.
    await topic.locator(".cm-line").click();
    await window.keyboard.press("End");
    await window.keyboard.press(`${mod}+K`);
    await window.keyboard.press("o");
    await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
    await openElement(window, mod);
    await expect(topic).toHaveText("Wind");

    // Fast, from the text: Ctrl/Cmd+K, L lists all elements, and no next keys are ever shown.
    await window.evaluate(() => {
      const seen = { rows: false };
      (window as unknown as { seenRows: typeof seen }).seenRows = seen;
      new MutationObserver(() => {
        if (document.querySelector('[aria-label="Next keys"]') !== null) {
          seen.rows = true;
        }
      }).observe(document.body, { childList: true, subtree: true });
    });
    await text.click();
    await window.keyboard.press(`${mod}+K`);
    await window.keyboard.press("l");
    await expect(window.locator(".row").first()).toBeVisible();
    await window.waitForTimeout(700);
    expect(
      await window.evaluate(() => (window as unknown as { seenRows: { rows: boolean } }).seenRows.rows),
    ).toBe(false);
    await openElement(window, mod);
    await expect(text).toHaveText("b1: derives from N1, in package P1.");
  });

  test("Ctrl/Cmd+K, Ctrl/Cmd+O shows the overview and never opens the folder dialog of the menu's Ctrl/Cmd+O", async () => {
    running = await launchApp(FIXTURE);
    const { app, window } = running;
    const mod = await modifier(window);
    await app.evaluate(({ dialog }) => {
      const counted = globalThis as unknown as { dialogs: number };
      counted.dialogs = 0;
      dialog.showOpenDialog = () => {
        counted.dialogs += 1;
        return Promise.resolve({ canceled: true, filePaths: [] });
      };
    });
    const dialogs = (): Promise<number> =>
      app.evaluate(() => (globalThis as unknown as { dialogs: number }).dialogs);
    await openElement(window, mod);
    // The keys go in as native input of the window (`sendInputEvent`), the path a menu accelerator
    // listens on; Playwright's keys reach only the page.
    const native = (keyCode: string): Promise<void> =>
      app.evaluate(
        ({ BrowserWindow }, [code, mac]) => {
          const contents = BrowserWindow.getAllWindows()[0]?.webContents;
          const modifiers = [mac ? "meta" : "control"] as ("meta" | "control")[];
          contents?.sendInputEvent({ type: "keyDown", keyCode: code, modifiers });
          contents?.sendInputEvent({ type: "char", keyCode: code.toLowerCase(), modifiers });
          contents?.sendInputEvent({ type: "keyUp", keyCode: code, modifiers });
        },
        [keyCode, mod === "Meta"] as const,
      );
    await native("K");
    await native("O");
    await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
    await expect(window.getByRole("list", { name: "Next keys" })).toHaveCount(0);
    // macOS: Electron hands a key the page did not take to the native menu only with the event of the
    // OS, which a key from `sendInputEvent` lacks, so the menu's Cmd+O never fires here and neither
    // check below could fail. They run where the menu takes such keys (Windows, Linux).
    if (mod === "Meta") {
      return;
    }
    await window.waitForTimeout(500);
    expect(await dialogs()).toBe(0);
    // Without the prefix the same key is the menu's: the stub counts, so the check above can fail.
    await native("O");
    await expect.poll(dialogs).toBe(1);
  });

  test("[SR-121/AK-q4xh] the command prompt shows Ctrl+K L next to List all elements", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    const mod = await modifier(window);
    await window.locator('[aria-label="Sheet"] > *').first().waitFor();
    await window.keyboard.press(`${mod}+Shift+P`);
    await window.keyboard.type("List all elements");
    const option = window.locator('.candidates [role="option"]').filter({ hasText: "List all elements" });
    await expect(option.locator(".hint")).toHaveText(`${await prefixOf(window)} L`);
    await window.keyboard.press("Escape");
  });

  test("[SR-109/AK-d5b0] the shortcut stands at the right of its hit, quieter than the name", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    const mod = await modifier(window);
    await window.locator('[aria-label="Sheet"] > *').first().waitFor();
    await window.keyboard.press(`${mod}+Shift+P`);
    await window.keyboard.type("Search elements");
    const option = window
      .locator('.candidates [role="option"]')
      .filter({ hasText: "Search elements" })
      .first();
    const hint = option.locator(".hint");
    await expect(hint).toBeVisible();
    const [box, hintBox, nameBox] = await Promise.all([
      option.boundingBox(),
      hint.boundingBox(),
      option.locator(".name").boundingBox(),
    ]);
    if (box === null || hintBox === null || nameBox === null) {
      throw new Error("the hit is not laid out");
    }
    // At the right edge of the hit (its padding), and the name to its left.
    expect(box.x + box.width - (hintBox.x + hintBox.width)).toBeLessThanOrEqual(16);
    expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(hintBox.x);
    const colour = (selector: string) =>
      option.locator(selector).evaluate((element) => getComputedStyle(element).color);
    expect(await colour(".hint")).not.toBe(await colour(".name"));
    await window.keyboard.press("Escape");
  });

  test("marks that fill the minibuffer line cut their labels and keep their × and the input visible (SR-215 AK9, #1645)", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    await listAll(window);
    await window.setViewportSize({ width: 520, height: 700 });
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await expect(window.locator("#prompt-input")).toBeFocused();
    // No prompt of this part of #1645 has marks yet: three long ones in the markup `Marks` renders, on the
    // app's own stylesheet and line.
    await window.evaluate(() => {
      const input = document.querySelector("#prompt-input");
      const marks = document.createElement("span");
      marks.className = "prompt-marks";
      for (const text of ["type: system-requirement", "status: approved", "text: performance thresholds"]) {
        const mark = document.createElement("span");
        mark.className = "prompt-mark";
        const label = document.createElement("span");
        label.className = "prompt-mark-label";
        label.textContent = text;
        const unmark = document.createElement("button");
        unmark.className = "prompt-unmark";
        unmark.textContent = "×";
        mark.append(label, unmark);
        marks.append(mark);
      }
      input?.before(marks);
    });
    const boxes = await window.evaluate(() =>
      [...document.querySelectorAll(".prompt-mark")].map((mark) => {
        const outer = mark.getBoundingClientRect();
        const unmark = mark.querySelector(".prompt-unmark")?.getBoundingClientRect();
        const label = mark.querySelector(".prompt-mark-label");
        return {
          inside: unmark !== undefined && unmark.left >= outer.left && unmark.right <= outer.right + 0.5,
          cut: label !== null && label.scrollWidth > label.clientWidth,
          ellipsis: label !== null && getComputedStyle(label).textOverflow === "ellipsis",
        };
      }),
    );
    expect(boxes.every((box) => box.inside && box.ellipsis)).toBe(true);
    // The line is too narrow for them: at least one label is cut.
    expect(boxes.some((box) => box.cut)).toBe(true);
    const input = await window
      .locator("#prompt-input")
      .evaluate((element) => element.getBoundingClientRect().width);
    expect(input).toBeGreaterThan(60);
    await window.keyboard.press("Escape");
  });

  test("a long refused-input message in the minibuffer keeps the sheet as wide as the window (#1631)", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    await listAll(window);
    const sheetWidth = (): Promise<number> =>
      window.locator(".sheet").evaluate((sheet) => sheet.getBoundingClientRect().width);
    const before = await sheetWidth();
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("Save perspective");
    await expect(names(window).first()).toHaveText("Save perspective");
    await window.keyboard.press("Enter");
    await window.keyboard.type("SR - S: ID - G: Pgk");
    await window.keyboard.press("Enter");
    // A condition in JSON that core refuses, with a message longer than the window is wide; the mark stands
    // again (SR-215 AK6).
    await window.keyboard.type('{"bogus":1}');
    await window.keyboard.press("Enter");
    await window.keyboard.press("Enter");
    await expect(window.locator(".minibuffer")).toContainText("Invalid input for perspective.save");
    await expect(window.getByRole("list", { name: "Marks" }).getByRole("listitem")).toHaveText([
      '{"bogus":1}×',
    ]);
    // The message is wider than the minibuffer line, so without the fix it would widen the sheet.
    const line = window.locator(".minibuffer");
    expect(await line.evaluate((minibuffer) => minibuffer.scrollWidth > minibuffer.clientWidth)).toBe(true);
    expect(await sheetWidth()).toBe(before);
    expect(before).toBe(await window.evaluate(() => globalThis.innerWidth));
  });
});

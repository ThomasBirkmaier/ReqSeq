// The command prompt on the built app (SR-108, SR-121, SR-133, #85): what was chosen for a typed text comes
// first the next time, also after the app restarts; the commands that fit the shown view come first; a catalog
// command asks its arguments with the values core gives; a write command ("Confirm hints") runs from it.
// Keys use ControlOrMeta, so the same tests run on Linux and macOS. With REQSEQ_SCREENSHOTS set, the argument
// entry is also saved as a screenshot there.
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, listAll, modifier } from "./support/app.js";

const FIXTURE = { fixture: "SR-069/filter" };

const names = (window: Page) => window.locator('.candidates [role="option"] .name');

test.describe("the command prompt", () => {
  let running: RunningApp;

  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-121/AK2] a text typed for a command puts that command first the next time, also after a restart", async () => {
    running = await launchApp(FIXTURE);
    let { window } = running;
    await listAll(window);
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("fl");
    // By match "Filter list by type" is first for "fl".
    await expect(names(window).first()).toHaveText("Filter list by type");
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

  test("a catalog read command asks its arguments in the minibuffer, with the kinds core allows, and shows its output", async () => {
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
    await window.keyboard.type("sro");
    await expect(names(window).first()).toHaveText("Show relation options");
    // Ctrl/Cmd+Enter: the arguments, and then the optional ones.
    await window.keyboard.press("ControlOrMeta+Enter");
    await expect(label).toHaveText("Show relation options · ref:");
    await expect(names(window).first()).toHaveText("SR-0000b1 Measure wind speed");
    await window.keyboard.press("ControlOrMeta+Enter");
    await expect(label).toHaveText("Show relation options SR-0000b1 · more arguments:");
    await expect(names(window)).toHaveText(["Run", "kind"]);
    await window.keyboard.press("ArrowDown");
    await window.keyboard.press("Enter");
    await expect(label).toHaveText("Show relation options SR-0000b1 · kind:");
    const options = await running.cli(["relation", "options", "SR-0000b1"]);
    const kinds = (JSON.parse(options.stdout) as { kinds: { name: string }[] }).kinds.map(
      (kind) => kind.name,
    );
    await expect(names(window)).toHaveText(kinds);
    await window.keyboard.type("der");
    const shots = process.env["REQSEQ_SCREENSHOTS"];
    if (shots !== undefined) {
      await window.screenshot({ path: path.join(shots, "catalog-prompt.png") });
    }
    await window.keyboard.press("Enter");
    await window.keyboard.press("Enter");
    await expect(window.locator(".modeline")).toContainText("Show relation options SR-0000b1 Derives from");
    await expect(window.locator(".result .line").first()).toHaveText("kinds1");
    await expect(window.locator(".result")).toContainText("derives-from");
  });

  test("[SR-133/AK1] in an element, the commands with an element argument come before the others when nothing is typed", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type("Measure wind speed");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("Measure wind speed");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toContainText("Measure wind speed");
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await expect(names(window).filter({ hasText: "Show workspace status" })).toHaveCount(1);
    const wanted = ["Show relation options", "Show trace chain", "Show workspace status"];
    const shown = (await names(window).allTextContents()).filter((name) => wanted.includes(name));
    // In the catalog "Show workspace status" comes first; it needs no element, so it is below them now. A
    // missing name fails the check too.
    expect(shown).toEqual(wanted);
    await window.keyboard.press("Escape");
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
      return (JSON.parse(listed.stdout) as { hints: { code: string; elementShortId: string }[] }).hints.map(
        (hint) => `${hint.code} ${hint.elementShortId}`,
      );
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
    await window.keyboard.press("Enter");
    await expect(window.locator(".modeline")).toContainText("Confirm hints SR-b0000000001");
    await expect(window.locator(".result")).toContainText("confirmed");
    expect(await hints()).toEqual([]);
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

    test("[SR-108/AK4] Set status offers only the statuses of the element's type, and a typed fragment finds one first", async () => {
      // Software requirements may only be draft or approved; "Obsolete" is a status of the metamodel.
      running = await launchApp({
        ...FIXTURE,
        files: {
          "metamodel/software.yaml": [
            "logreq-metamodel: 1",
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

    test("[SR-108/AK4] Create relation offers the kinds relation options gives and only targets of their types, also for a target typed with a typo", async () => {
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

    test("[SR-108/AK4] Bulk update offers the metamodel's properties and that property's values", async () => {
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
      // Escape: nothing is written.
      await window.keyboard.press("Escape");
      await expect(label(window)).toHaveCount(0);
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

  test("[SR-109/AK3] Ctrl/Cmd+K and a pause show the next keys, and L lists all elements", async () => {
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

  test("[SR-109/AK3] the letter after Ctrl/Cmd+K is never typed into the text", async () => {
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

  test("[SR-121/AK3] the command prompt shows Ctrl+K L next to List all elements", async () => {
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

  test("[SR-109/AK1] the shortcut stands at the right of its hit, quieter than the name", async () => {
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
});

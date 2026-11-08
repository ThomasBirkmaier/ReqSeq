import { SHORTCUT_TABLES, shortcutReference } from "@reqseq/app";
import { getCommandRuntime } from "@reqseq/core";
import { describe, expect, it } from "vitest";
import { SHORTCUTS_PAGE, shortcutsPage } from "./shortcuts.js";
import { readGeneratedContracts, referencePages } from "./reference.js";
import { readProblemCodes } from "./codes.js";
import { readExamples } from "./formats.js";
import { readStandardModel } from "./standard-model.js";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** The table row of the page whose last cell is `does`. */
const rowOf = (page: string, does: string): string | undefined =>
  page.split("\n").find((line) => line.startsWith("| ") && line.endsWith(` | ${does} |`));

describe("keyboard shortcuts page", () => {
  it("[SR-139/AK5] lists every key of the app for Windows and Linux and for macOS with what it does, built from the app's tables", async () => {
    const runtime = getCommandRuntime();
    const pages = await referencePages(
      {
        runtime,
        generated: await readGeneratedContracts(repoRoot),
        codes: await readProblemCodes(repoRoot),
        schemas: runtime.contracts.schemas,
        examples: await readExamples(repoRoot),
        standardModel: await readStandardModel(repoRoot),
      },
      "/ReqSeq",
    );
    const page = pages.find((candidate) => candidate.path === SHORTCUTS_PAGE)?.text ?? "";
    const commands = runtime.contracts.commands;
    expect(page).toBe(shortcutsPage(shortcutReference(commands)));
    expect(page).toContain("| Windows and Linux | macOS | What it does |");
    // Every row of the app's tables is on the page, with its keys on both systems.
    const sections = shortcutReference(commands);
    const rows = sections.slice(0, -1).flatMap((section) => section.rows);
    expect(rows.length).toBeGreaterThan(40);
    for (const row of rows) {
      expect(row.keys.length + row.mac.length, row.does).toBeGreaterThan(0);
      expect(page, row.does).toContain(` | ${row.mac.map((key) => `\`${key}\``).join(", ") || "—"} | `);
    }
    // The last section names the actions without a key, each with its anchor (SR-141 AK3).
    expect(sections.at(-1)?.title).toBe("Actions without a key");
    expect(rowOf(page, "Close all buffers")).toBe(
      '| <span id="action-close-all"></span>— | — | Close all buffers |',
    );
    expect(
      rowOf(page, "Open the command prompt: the actions and commands that apply to the shown buffer"),
    ).toBe(
      "| `Ctrl+Shift+P` | `⌘⇧P` | Open the command prompt: the actions and commands that apply to the shown buffer |",
    );
    expect(rowOf(page, "Create element")).toBe("| `Ctrl+K E` | `⌘K E` | Create element |");
    // An action's row carries its anchor, where F1 in the command prompt opens the page (SR-141 AK3).
    expect(rowOf(page, "Save element")).toBe(
      '| <span id="action-save"></span>`Ctrl+S` | `⌘S` | Save element |',
    );
    // A changed key in the app's table changes the page, with no page edited by hand.
    const changed = shortcutsPage(
      shortcutReference(commands, {
        ...SHORTCUT_TABLES,
        actions: SHORTCUT_TABLES.actions.map((action) =>
          action.id === "save" ? { ...action, shortcut: { mod: true, shift: true, key: "w" } } : action,
        ),
        bindings: SHORTCUT_TABLES.bindings.map((binding) =>
          binding.id === "command:element.create" ? { ...binding, key: "n" } : binding,
        ),
      }),
    );
    expect(rowOf(changed, "Save element")).toBe(
      '| <span id="action-save"></span>`Ctrl+Shift+W` | `⌘⇧W` | Save element |',
    );
    expect(rowOf(changed, "Create element")).toBe("| `Ctrl+K N` | `⌘K N` | Create element |");
  });

  it("writes a dash where a key does not exist on a system and escapes the texts", () => {
    const page = shortcutsPage([
      {
        title: "Only <here>",
        about: "A *note*.",
        rows: [{ keys: [], mac: ["⌃N", "Down"], does: "Next | row" }],
      },
    ]);
    expect(page).toContain("## Only \\<here\\>\n\nA \\*note\\*.\n");
    expect(page).toContain("| — | `⌃N`, `Down` | Next \\| row |");
    expect(
      shortcutsPage([
        {
          title: "T",
          about: "A.",
          rows: [{ keys: ["F1"], mac: ["F1"], does: "Help", actions: ["a", "b-c"] }],
        },
      ]),
    ).toContain('| <span id="action-a"></span><span id="action-b-c"></span>`F1` | `F1` | Help |');
  });
});

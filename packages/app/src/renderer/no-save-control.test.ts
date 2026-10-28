// SR-105 AK3 in the source of the app: saving needs no control. The window has no button and no dialog to
// save (the end-to-end test `test/autosave.spec.ts` looks at the running app, the main process test at
// main's dialogs); the only buttons are the copy symbols of the fields (SR-128).
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SOURCE = fileURLToPath(new URL("..", import.meta.url));

/** The product sources of the app: every `.ts` and `.tsx` file below `src` but the tests. */
const sources = (folder: string): string[] =>
  readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      return sources(file);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [file] : [];
  });

describe("no save control (SR-105 AK3)", () => {
  it("[SR-105/AK3] no source of the app makes a save button, a save dialog or a message box", () => {
    const found = sources(SOURCE).flatMap((file) => {
      const text = readFileSync(file, "utf8");
      const hits = [
        /showSaveDialog|showMessageBox|showErrorBox/,
        /<dialog\b|role="(alert)?dialog"|aria-modal/,
        /\bwindow\.(confirm|alert|prompt)\(/,
        /<button[^>]*>[^<]*save/i,
      ].filter((pattern) => pattern.test(text));
      return hits.map((pattern) => `${path.relative(SOURCE, file)}: ${String(pattern)}`);
    });
    expect(found).toEqual([]);
    // The one kind of button the window has: the copy symbol of a field.
    const buttons = sources(SOURCE).filter((file) => readFileSync(file, "utf8").includes("<button"));
    expect(buttons.map((file) => path.relative(SOURCE, file))).toEqual([
      path.join("renderer", "FieldBox.tsx"),
    ]);
  });
});

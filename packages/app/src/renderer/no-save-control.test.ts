// SR-105 AK3 in the source of the app: saving needs no control. The window has no button and no dialog to
// save (the end-to-end test `test/autosave.spec.ts` looks at the running app, the main process test at
// main's dialogs); the only buttons are the copy symbols of the fields (SR-128), "Copy all" of the window
// "About ReqSeq", the one window D-062 allows besides the folder dialog (SR-161), and "help" in the explanation
// line of the command prompt, which opens the command help (SR-210 AK4); none of them saves anything.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SOURCE = fileURLToPath(new URL("..", import.meta.url));
const ABOUT = path.join("renderer", "AboutWindow.tsx");

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
  it("[SR-105/AK-ptsm] no source of the app makes a save button, a save dialog or a message box", () => {
    const found = sources(SOURCE).flatMap((file) => {
      const text = readFileSync(file, "utf8");
      const about = path.relative(SOURCE, file) === ABOUT;
      const hits = [
        /showSaveDialog|showMessageBox|showErrorBox/,
        // The window "About ReqSeq" is a dialog by D-062's exception (SR-161); a save dialog stays forbidden there too.
        about ? /<dialog\b|role="alertdialog"|save/i : /<dialog\b|role="(alert)?dialog"|aria-modal/,
        /\bwindow\.(confirm|alert|prompt)\(/,
        /<button[^>]*>[^<]*save/i,
      ].filter((pattern) => pattern.test(text));
      return hits.map((pattern) => `${path.relative(SOURCE, file)}: ${String(pattern)}`);
    });
    expect(found).toEqual([]);
    // The buttons the window has: the copy symbol of a field, Copy all of "About ReqSeq", and "help" of the
    // explanation line.
    const buttons = sources(SOURCE).filter((file) => readFileSync(file, "utf8").includes("<button"));
    expect(buttons.map((file) => path.relative(SOURCE, file)).sort()).toEqual(
      [ABOUT, path.join("renderer", "FieldBox.tsx"), path.join("renderer", "Minibuffer.tsx")].sort(),
    );
  });
});

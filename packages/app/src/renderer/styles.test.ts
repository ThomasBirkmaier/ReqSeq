// The colours of the sheet in both schemes (SR-113): every colour is a custom property with a light and
// a dark value, the text reaches WCAG 2.2 AA on the sheet and on the selection, and no rule uses a
// colour of its own.
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { SHEET } from "../shared/theme.js";
import type { Scheme } from "../shared/theme.js";

const read = (relative: string): string => fs.readFileSync(new URL(relative, import.meta.url), "utf8");
const CSS = read("./styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
const EDITOR = read("./editor/Editor.tsx");

const TOKENS = ["text", "muted", "rule", "sheet", "select", "accent-outdated", "shadow"] as const;

/** The `:root` rule of styles.css: its declarations, and the rest of the file. */
const root = ((): { readonly body: string; readonly rest: string } => {
  const match = /(^|\n):root \{([\s\S]*?)\n\}/.exec(CSS);
  if (match?.[2] === undefined) {
    throw new Error("no :root rule");
  }
  return { body: match[2], rest: CSS.replace(match[0], "") };
})();

/** The two values of `--name: light-dark(a, b);`, split at the top-level comma. */
const values = (name: string): Record<Scheme, string> => {
  const match = new RegExp(`--${name}:\\s*light-dark\\(([^;]*)\\);`).exec(root.body);
  const inner = match?.[1];
  if (inner === undefined) {
    throw new Error(`--${name} is not a light-dark() token`);
  }
  let depth = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const char = inner.charAt(i);
    depth += char === "(" ? 1 : char === ")" ? -1 : 0;
    if (char === "," && depth === 0) {
      return { light: inner.slice(0, i).trim(), dark: inner.slice(i + 1).trim() };
    }
  }
  throw new Error(`--${name} has one value only`);
};

/** WCAG relative luminance of `#rrggbb`. */
const luminance = (hex: string): number => {
  const channel = (offset: number): number => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
};

const ratio = (a: string, b: string): number => {
  const [high = 0, low = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};

// A hex colour, a colour function, or a colour name (`white-space` is not one).
const COLOUR_LITERAL =
  /#[0-9a-f]{3,8}\b|(?<![-\w])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|(?<![-\w])(?:white|black)(?![-\w])/i;

describe("the colours of the sheet", () => {
  it("has the seven tokens, each with a light and a dark value", () => {
    for (const name of TOKENS) {
      const both = values(name);
      expect(both.light, name).not.toBe("");
      expect(both.dark, name).not.toBe("");
    }
  });

  it.each(["light", "dark"] as const)(
    "keeps the text readable on the sheet and on the selection (%s)",
    (scheme) => {
      const at = (name: string): string => values(name)[scheme];
      for (const ground of [at("sheet"), at("select")]) {
        for (const name of ["text", "muted", "accent-outdated"]) {
          expect(ratio(at(name), ground), `${name} on ${ground}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    },
  );

  it.each(["light", "dark"] as const)(
    "keeps the selection and the rules visible on the sheet (%s)",
    (scheme) => {
      for (const name of ["select", "rule"]) {
        expect(ratio(values(name)[scheme], values("sheet")[scheme]), name).toBeGreaterThanOrEqual(1.1);
      }
    },
  );

  it("gives the main process the same sheet colour as the --sheet token", () => {
    expect(SHEET).toEqual(values("sheet"));
  });

  it("follows the system, and lets a command choose a scheme", () => {
    expect(root.body).toMatch(/color-scheme:\s*light dark;/);
    expect(root.rest).toMatch(/:root\[data-theme="light"\]\s*\{\s*color-scheme:\s*light;/);
    expect(root.rest).toMatch(/:root\[data-theme="dark"\]\s*\{\s*color-scheme:\s*dark;/);
  });

  it("uses no colour of its own outside the tokens: not in styles.css, not in the editor theme", () => {
    const declarations = root.body.replace(/--[a-z-]+:\s*light-dark\([^;]*\);/g, "");
    expect(declarations).not.toMatch(COLOUR_LITERAL);
    expect(root.rest).not.toMatch(COLOUR_LITERAL);
    const theme = /EditorView\.theme\(\{([\s\S]*?)\n\}\);/.exec(EDITOR)?.[1];
    expect(theme).toBeDefined();
    expect(theme).toContain("var(--text)");
    expect(theme).not.toMatch(COLOUR_LITERAL);
  });
});

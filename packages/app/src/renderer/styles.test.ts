// The colours of the sheet in both schemes (SR-113): every colour is a custom property with a light and
// a dark value, the text reaches WCAG 2.2 AA on the sheet and on the selection, and no rule uses a
// colour of its own.
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { SHEET } from "../shared/theme.js";
import { CARD_LINES } from "./actions.js";
import type { Scheme } from "../shared/theme.js";

const read = (relative: string): string => fs.readFileSync(new URL(relative, import.meta.url), "utf8");
const CSS = read("./styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
const EDITOR = read("./editor/Editor.tsx");

const TOKENS = [
  "text",
  "muted",
  "rule",
  "edge",
  "sheet",
  "select",
  "raised",
  "accent-outdated",
  "accent-gap",
  "shadow",
  "outside-change",
] as const;

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
  it("has the ten tokens, each with a light and a dark value", () => {
    for (const name of TOKENS) {
      const both = values(name);
      expect(both.light, name).not.toBe("");
      expect(both.dark, name).not.toBe("");
    }
  });

  it.each(["light", "dark"] as const)(
    "keeps the text readable on the sheet, the selection and the raised tone (%s)",
    (scheme) => {
      const at = (name: string): string => values(name)[scheme];
      for (const ground of [at("sheet"), at("select"), at("raised"), at("outside-change")]) {
        for (const name of ["text", "muted", "accent-outdated", "accent-gap"]) {
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

  it.each(["light", "dark"] as const)(
    "sets the raised tone (prompt card, modeline) quietly apart from the sheet, the selection visible on it (%s)",
    (scheme) => {
      const at = (name: string): string => values(name)[scheme];
      const off = ratio(at("raised"), at("sheet"));
      expect(off).toBeGreaterThan(1.03);
      expect(off).toBeLessThan(1.1);
      expect(ratio(at("select"), at("raised"))).toBeGreaterThanOrEqual(1.1);
      expect(ratio(at("rule"), at("raised"))).toBeGreaterThanOrEqual(1.1);
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

  it("[SR-129] overrides every colour of the base theme of the autocomplete tooltip by tokens (the editor theme above has no literal)", () => {
    const theme = /EditorView\.theme\(\{([\s\S]*?)\n\}\);/.exec(EDITOR)?.[1] ?? "";
    // The rules of the library that set a colour: the box, the selected entry, the disabled one, the detail.
    for (const selector of [
      '".cm-tooltip.cm-tooltip-autocomplete": {',
      '".cm-tooltip-autocomplete ul li[aria-selected]": {',
      '".cm-tooltip.cm-tooltip-autocomplete-disabled ul li[aria-selected]": {',
      '".cm-completionDetail": {',
      '".cm-tooltip .cm-tooltip-section:not(:first-child)": {',
    ]) {
      const rule = theme.slice(theme.indexOf(selector));
      expect(theme, selector).toContain(selector);
      expect(rule.slice(0, rule.indexOf("}")), selector).toMatch(/var\(--(text|muted|rule|sheet|select)\)/);
    }
    expect(theme).toContain('".cm-completionMatchedText": { textDecoration: "none"');
  });
});

/** The declarations of the rule whose selector list is exactly `selector` (as written, one line). */
const ruleOf = (selector: string): string => {
  const at = CSS.split("\n}\n").find((rule) => rule.trim().replace(/\s+/g, " ").startsWith(`${selector} {`));
  if (at === undefined) {
    throw new Error(`no rule for ${selector}`);
  }
  return at;
};

describe("the traceability matrix (SR-125, SR-153)", () => {
  it("[SR-153/AK1] marks a gap in the accent colour, by a token, and the outdated and missing marks as the element view does", () => {
    expect(ruleOf(".matrix .gap")).toMatch(/color:\s*var\(--accent-gap\);/);
    expect(ruleOf(".matrix .outdated")).toMatch(/color:\s*var\(--accent-outdated\);/);
    expect(ruleOf(".matrix .unavailable, .matrix .state")).toMatch(/color:\s*var\(--muted\);/);
    // The gap is the accent colour of "outdated": one accent in both schemes (D-062).
    expect(values("accent-gap")).toEqual(values("accent-outdated"));
  });

  it("[SR-153/AK2] shows an empty cell that is no gap in the muted colour, as an unavailable end, with no new token", () => {
    expect(ruleOf(".matrix .none")).toMatch(/color:\s*var\(--muted\);/);
  });
});

describe("the copy symbol of a field (SR-128)", () => {
  it("[SR-128/AK1] is hidden, and seen only while the pointer is over the field or the focus is in it", () => {
    expect(ruleOf(".copy")).toMatch(/visibility:\s*hidden;/);
    // The rows of "About ReqSeq" show it the same way (SR-161 AK3).
    const shown = ruleOf(
      ".field:hover > .copy, .field:focus-within > .copy, .about-row:hover > .copy, .about-row:focus-within > .copy",
    );
    expect(shown).toMatch(/visibility:\s*visible;/);
    // Nothing else shows it: no rule makes a copy symbol visible by another selector.
    expect(CSS.match(/visibility:\s*visible;/g)).toHaveLength(1);
  });

  it("[SR-128/AK1] is very quiet: the muted colour, no frame, and the text colour only under the pointer", () => {
    expect(ruleOf(".copy")).toMatch(/color:\s*var\(--muted\);/);
    expect(ruleOf(".copy")).toMatch(/border:\s*0;/);
    expect(ruleOf(".copy:hover")).toMatch(/color:\s*var\(--text\);/);
  });

  it("[SR-128/AK1] sits at the right edge of the field, in the room the field keeps for it", () => {
    expect(ruleOf(".element .field > .copy")).toMatch(/position:\s*absolute;[\s\S]*right:\s*0;/);
    expect(ruleOf(".element .field")).toMatch(/padding-right:\s*1\.75rem;/);
    expect(ruleOf(".element .field")).toMatch(/position:\s*relative;/);
    // A hit area of about 20 px: 1.5rem of the 14 px root.
    expect(ruleOf(".copy")).toMatch(/width:\s*1\.5rem;[\s\S]*height:\s*1\.5rem;/);
  });
});

describe("the field the focus is in (SR-155)", () => {
  it("[SR-155/AK1] has the background of the selected row of a list", () => {
    expect(ruleOf(".element .field:focus-within")).toMatch(/background:\s*var\(--select\);/);
    expect(ruleOf('.row[aria-selected="true"]')).toMatch(/background:\s*var\(--select\);/);
    // A selection and code in the field take the sheet colour, so they stay visible on the tint.
    expect(ruleOf(".element .field:focus-within")).toMatch(/--in-field:\s*var\(--sheet\);/);
    expect(EDITOR.match(/backgroundColor: "var\(--in-field, var\(--select\)\)"/g)).toHaveLength(3);
  });

  it("[SR-155/AK3] is tinted only while the focus is in it: no other rule gives a field a background", () => {
    const tinted = CSS.split("\n}\n").filter((rule) => /\.field\b[^{]*\{[^}]*background:/.test(rule));
    expect(tinted.map((rule) => rule.trim().split(" {")[0])).toEqual([".element .field:focus-within"]);
  });
});

describe("the shortcut next to a hit of the command line (SR-109)", () => {
  it("[SR-109/AK1] writes the shortcut quietly at the right of the hit: muted, smaller than the name", () => {
    // The name on the left, the shortcut pushed to the right edge of the row.
    const row = ruleOf(".card-list li");
    expect(row).toMatch(/display:\s*flex;/);
    expect(row).toMatch(/justify-content:\s*space-between;/);
    const hint = ruleOf(".card-list .hint");
    expect(hint).toMatch(/color:\s*var\(--muted\);/);
    const size = (rule: string): number => Number(/font-size:\s*(\d+)px;/.exec(rule)?.[1]);
    expect(size(hint)).toBeLessThan(size(ruleOf(".card-list")));
  });
});

describe("the hits of the search prompt (SR-183)", () => {
  it("[SR-183/AK1] the card is CARD_LINES lines high, and a hit takes one line, or two with its snippet", () => {
    expect(ruleOf(".card-list")).toContain(`max-height: calc(var(--line) * ${String(CARD_LINES)});`);
    expect(ruleOf(".card-list li.hit")).toMatch(/box-sizing:\s*border-box;[\s\S]*height:\s*var\(--line\);/);
    expect(ruleOf(".card-list li.hit.snipped")).toMatch(/height:\s*calc\(var\(--line\) \* 2\);/);
  });
});

describe("the look of the window (ThomasBirkmaier/ReqSeq-archive#490)", () => {
  it("lifts the candidates of a prompt as a card: the raised tone, a thin edge, round corners, a shadow upwards", () => {
    const card = ruleOf(".card-list");
    expect(card).toMatch(/background:\s*var\(--raised\);/);
    expect(card).toMatch(/border:\s*1px solid var\(--rule\);/);
    expect(card).toMatch(/border-radius:\s*8px;/);
    expect(card).toMatch(/box-shadow:\s*0 -\d+px \d+px var\(--shadow\);/);
    // It rises above the modeline, whose row is --modeline high.
    expect(ruleOf(".card")).toMatch(/bottom:\s*calc\(100% \+ var\(--modeline\) \+ [\d.]+rem\);/);
    expect(ruleOf(".shell")).toMatch(
      /grid-template-rows:\s*minmax\(0, 1fr\) var\(--modeline\) var\(--line\);/,
    );
  });

  it("makes the modeline one rounded bar of segments joined by a thin rounded edge, in the tones of the sheet", () => {
    const bar = ruleOf(".modeline");
    expect(bar).toMatch(/border-radius:\s*999px;/);
    expect(bar).toMatch(/border:\s*1px solid var\(--rule\);/);
    expect(bar).toMatch(/background:\s*var\(--raised\);/);
    expect(ruleOf(".modeline .segment")).toMatch(/border-radius:\s*999px 0 0 999px;/);
    expect(ruleOf(".modeline .segment + .segment")).toMatch(/box-shadow:\s*-1px 0 0 var\(--rule\);/);
    const head = ruleOf(".modeline .parts .segment:first-child, .modeline .workspace .segment:first-child");
    expect(head).toMatch(/background:\s*var\(--select\);/);
    expect(head).toMatch(/color:\s*var\(--text\);/);
  });

  it("gives macOS a title bar strip of the sheet that moves the window and only names it", () => {
    const strip = ruleOf(".titlebar");
    expect(strip).toMatch(/-webkit-app-region:\s*drag;/);
    expect(strip).toMatch(/background:\s*var\(--sheet\);/);
    expect(strip).toMatch(/color:\s*var\(--muted\);/);
    expect(strip).toMatch(/user-select:\s*none;/);
    expect(ruleOf(".shell:has(> .titlebar)")).toMatch(
      /grid-template-rows:\s*var\(--titlebar\) minmax\(0, 1fr\)/,
    );
  });
});

describe("the links of the graph", () => {
  it.each(["light", "dark"] as const)(
    "[SR-111] draws the links of the graph visibly on the sheet: 3:1 (WCAG 1.4.11), derivations darker (%s)",
    (scheme) => {
      const at = (name: string): string => values(name)[scheme];
      expect(ratio(at("edge"), at("sheet"))).toBeGreaterThanOrEqual(3);
      expect(ratio(at("muted"), at("sheet"))).toBeGreaterThan(ratio(at("edge"), at("sheet")));
      expect(ruleOf(".graph-edge")).toMatch(/stroke:\s*var\(--edge\);/);
      expect(ruleOf(".graph-edge.derivation")).toMatch(/stroke:\s*var\(--muted\);/);
      expect(ruleOf(".graph-edge.reference")).toMatch(/stroke-dasharray:/);
    },
  );

  it("[SR-111] keeps the accent on an outdated link, also on a link of the selected box", () => {
    expect(ruleOf(".graph-edge.outdated")).toMatch(/stroke:\s*var\(--accent-outdated\);/);
    expect(ruleOf(".graph-edge.selected")).toMatch(/stroke:\s*var\(--text\);/);
    // Same specificity: the later rule wins.
    expect(CSS.indexOf(".graph-edge.outdated {")).toBeGreaterThan(CSS.indexOf(".graph-edge.selected {"));
  });
});

describe("the highlight of a change from outside (SR-116)", () => {
  /** The three channels of `#rrggbb`. */
  const channels = (hex: string): number[] => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));

  it.each(["light", "dark"] as const)(
    "[SR-116/AK1] tints in grey, no colour, and visibly on the sheet (%s)",
    (scheme) => {
      const tint = values("outside-change")[scheme];
      const [red = 0, green = 0, blue = 0] = channels(tint);
      // A grey: the channels lie close together, like those of the other greys (--select, --rule).
      expect(Math.max(red, green, blue) - Math.min(red, green, blue)).toBeLessThanOrEqual(12);
      expect(ratio(tint, values("sheet")[scheme])).toBeGreaterThanOrEqual(1.1);
    },
  );

  it("[SR-116/AK2] fades within the 3 s the mark stays, and stays still without motion", () => {
    const rule = ruleOf(".outside-change");
    expect(rule).toMatch(/animation:\s*outside-change 2\.5s/);
    // The end of the animation is no tint: nothing is left standing when the class goes at 3 s.
    expect(CSS).toMatch(/@keyframes outside-change \{[\s\S]*?to \{\s*box-shadow:[^;]*transparent;/);
    expect(CSS).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.outside-change \{\s*animation: none;\s*box-shadow:[^;]*var\(--outside-change\);/,
    );
  });
});

describe("the block of a field whose file changed under the input (SR-106)", () => {
  it("[SR-106/AK2] is quiet and in greys: the muted text, the rule as its edge, and what differs in heavier weight", () => {
    const rule = ruleOf(".element .on-disk");
    expect(rule).toContain("color: var(--muted);");
    expect(rule).toContain("border-left: 2px solid var(--rule);");
    expect(rule).not.toMatch(/var\(--accent\)/);
    expect(ruleOf("mark")).toMatch(/font-weight:\s*700;/);
    expect(ruleOf("mark")).toMatch(/background:\s*none;/);
  });
});

describe("the inactive area of a split window (SR-150)", () => {
  it("[SR-150/AK8] is a shade lighter: its text takes the muted grey, which reads at 4.5:1 on the sheet and on a selection in both schemes", () => {
    const rule = ruleOf(".area:not([data-active])");
    expect(rule).toContain("--text: var(--muted);");
    expect(rule).toContain("color: var(--text);");
    // The active area keeps the text colour: no other rule of an area sets it.
    expect(ruleOf(".area")).not.toContain("color");
    for (const scheme of ["light", "dark"] as const) {
      expect(ratio(values("muted")[scheme], values("sheet")[scheme])).toBeGreaterThanOrEqual(4.5);
      expect(ratio(values("muted")[scheme], values("select")[scheme])).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("the card of the command line in motion (SR-182)", () => {
  /** A `--card-*` time in ms, from the card's `:root` rule. */
  const time = (name: string): number => {
    const value = new RegExp(`--card-${name}:\\s*(\\d+)ms;`).exec(CSS)?.[1];
    if (value === undefined) {
      throw new Error(`no --card-${name}`);
    }
    return Number(value);
  };
  /** The colour `#rrggbb` under the black of `--dim` with alpha `alpha` (0..1). */
  const dimmed = (hex: string, alpha: number): string =>
    `#${[1, 3, 5]
      .map((at) =>
        Math.round(parseInt(hex.slice(at, at + 2), 16) * (1 - alpha))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;
  const alphaOf = (scheme: Scheme): number => {
    const match = /^rgb\(0 0 0 \/ (\d+)%\)$/.exec(values("dim")[scheme]);
    if (match?.[1] === undefined) {
      throw new Error("--dim is no black with an alpha");
    }
    return Number(match[1]) / 100;
  };

  it("[SR-182/AK1] rises in at most 200 ms, easing out", () => {
    expect(time("in")).toBeLessThanOrEqual(200);
    // Ease-out: the curve starts steep and ends flat (cubic-bezier with y2 = 1).
    expect(CSS).toMatch(/--card-ease:\s*cubic-bezier\([\d.]+, [\d.]+, [\d.]+, 1\);/);
  });

  it.each(["light", "dark"] as const)(
    "[SR-182/AK2] dims the backdrop visibly, and the text behind it keeps 4.5:1 (%s)",
    (scheme) => {
      const alpha = alphaOf(scheme);
      expect(alpha).toBeGreaterThan(0);
      const at = (name: string): string => dimmed(values(name)[scheme], alpha);
      for (const ground of ["sheet", "select", "raised", "outside-change"]) {
        for (const name of ["text", "muted", "accent-outdated", "accent-gap"]) {
          expect(ratio(at(name), at(ground)), `${name} on ${ground}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    },
  );

  it("[SR-182/AK2] blurs a seam as wide as the blur of the card's shadow", () => {
    const blur = /box-shadow:\s*0 -\d+px (\d+)px var\(--shadow\);/.exec(ruleOf(".card-list"))?.[1];
    expect(CSS).toMatch(new RegExp(`--card-seam:\\s*${String(blur)}px;`));
    expect(ruleOf(".card-seam")).toMatch(/backdrop-filter:\s*blur\(var\(--card-blur\)\);/);
    expect(ruleOf(".card-backdrop")).toMatch(/background:\s*var\(--dim\);/);
  });

  it("[SR-182/AK6] runs back in less time than it rises", () => {
    expect(time("out")).toBeLessThan(time("in"));
  });

  it("[SR-182/AK7] moves only without the system's reduced motion", () => {
    const motion = /@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? "";
    expect(motion).toMatch(/card-rise/);
    const outside = CSS.replace(motion, "");
    expect(outside).not.toMatch(/animation:\s*card-/);
  });
});

describe("the window About ReqSeq (SR-161)", () => {
  const alpha = (name: string, scheme: Scheme): number => {
    const match = /^rgb\(0 0 0 \/ (\d+)%\)$/.exec(values(name)[scheme]);
    if (match?.[1] === undefined) {
      throw new Error(`--${name} is no black with an alpha`);
    }
    return Number(match[1]) / 100;
  };
  const px = (name: string): number => Number(new RegExp(`--${name}:\\s*(\\d+)px;`).exec(CSS)?.[1]);

  it.each(["light", "dark"] as const)(
    "[SR-161/AK6] dims and blurs the whole backdrop more than behind the card of the command line (%s)",
    (scheme) => {
      expect(alpha("about-dim", scheme)).toBeGreaterThanOrEqual(4 * alpha("dim", scheme));
      expect(px("about-blur")).toBeGreaterThanOrEqual(4 * px("card-blur"));
      const backdrop = ruleOf(".about-backdrop");
      expect(backdrop).toMatch(/inset:\s*0;/);
      expect(backdrop).toMatch(/background:\s*var\(--about-dim\);/);
      expect(backdrop).toMatch(/backdrop-filter:\s*blur\(var\(--about-blur\)\);/);
    },
  );

  it("[SR-161/AK6] stands centered as a soft card with a shadow, like the card of the command line", () => {
    expect(ruleOf(".about-backdrop")).toMatch(/place-items:\s*center;/);
    const card = ruleOf(".about");
    const list = ruleOf(".card-list");
    for (const part of [
      /background:\s*var\(--raised\);/,
      /border:\s*1px solid var\(--rule\);/,
      /border-radius:\s*8px;/,
    ]) {
      expect(card).toMatch(part);
      expect(list).toMatch(part);
    }
    const blur = (rule: string): string | undefined =>
      /box-shadow:\s*0 -?\d+px (\d+)px var\(--shadow\);/.exec(rule)?.[1];
    expect(blur(card)).toBe(blur(list));
  });
});

// Drawing primitives of the architecture diagrams (diagrams.ts): boxes, arrows and text in one SVG whose colours
// follow the reader's light or dark scheme, with system fonts only (no network, ADR-0017).

/** The colour family of a box or lane: Ubuntu, macOS, Windows, or anything else. */
export type Family = "u" | "m" | "w" | "o";

export const escapeXml = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** The family of a runner label such as `ubuntu-24.04`. */
export function family(label: string): Family {
  if (label.startsWith("ubuntu")) {
    return "u";
  }
  if (label.startsWith("macos")) {
    return "m";
  }
  return label.startsWith("windows") ? "w" : "o";
}

/** Text sizes in px and their estimated advance per character, for sizing boxes without a font engine. */
export const FONT = {
  name: { size: 12.5, advance: 7.6 },
  sub: { size: 10.5, advance: 6 },
} as const;

export const textWidth = (text: string, font: keyof typeof FONT): number => text.length * FONT[font].advance;

/** Splits `text` at spaces into lines of at most `max` characters (a longer word keeps its own line). */
export function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(" ")) {
    const last = lines.at(-1);
    if (last !== undefined && last.length + 1 + word.length <= max) {
      lines[lines.length - 1] = `${last} ${word}`;
    } else {
      lines.push(word);
    }
  }
  return lines;
}

const STYLE = `<style>
svg { --bg: #ffffff; --fg: #18202b; --muted: #5a6575; --line: #c6ced9; --u: #c4521b; --m: #5d6c84; --w: #1c6db0; --o: #7a4fb0; --req: #0d8257; --req-fg: #ffffff; }
@media (prefers-color-scheme: dark) { svg { --bg: #0d1117; --fg: #e2e7ee; --muted: #98a3b3; --line: #344050; --u: #ee7c45; --m: #a7b4c8; --w: #5ea8e8; --o: #b79cf0; --req: #3cc68e; --req-fg: #0c1a14; } }
text { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; fill: var(--fg); font-size: ${String(FONT.sub.size)}px; }
.bg { fill: var(--bg); }
.n { font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; font-size: ${String(FONT.name.size)}px; font-weight: 600; }
.h { font-size: 15px; font-weight: 600; }
.s { fill: var(--muted); }
.box { fill: var(--bg); stroke-width: 1.6; }
.trig { fill: var(--bg); stroke: var(--fg); stroke-width: 1.2; stroke-dasharray: 4 3; }
.lane { stroke: var(--line); stroke-width: 1; fill-opacity: 0.07; }
.lh { font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; font-weight: 600; letter-spacing: 0.08em; }
.u { stroke: var(--u); } .m { stroke: var(--m); } .w { stroke: var(--w); } .o { stroke: var(--o); }
.lane.u { fill: var(--u); } .lane.m { fill: var(--m); } .lane.w { fill: var(--w); } .lane.o { fill: var(--o); }
.lh.u { fill: var(--u); } .lh.m { fill: var(--m); } .lh.w { fill: var(--w); } .lh.o { fill: var(--o); }
.sep { stroke: var(--line); stroke-width: 1; }
.arr { fill: none; stroke: var(--fg); stroke-width: 1.3; }
.arr.dev { stroke-dasharray: 5 4; }
.ah { fill: var(--fg); }
.req { fill: var(--req); } .reqt { fill: var(--req-fg); font-size: 9.5px; font-weight: 700; }
</style>`;

/** The whole SVG document: the style, a background, and the parts. */
export function svgDocument(width: number, height: number, label: string, parts: readonly string[]): string {
  const [w, h] = [String(Math.ceil(width)), String(Math.ceil(height))];
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${escapeXml(label)}">`,
    STYLE,
    `<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0,0 L10,5 L0,10 z"/></marker></defs>`,
    `<rect class="bg" width="${w}" height="${h}"/>`,
    ...parts,
    "</svg>",
    "",
  ].join("\n");
}

export const text = (x: number, y: number, content: string, cls: string, anchor = "start"): string =>
  `<text class="${cls}" x="${String(x)}" y="${String(y)}"${anchor === "start" ? "" : ` text-anchor="${anchor}"`}>${escapeXml(content)}</text>`;

export const rect = (x: number, y: number, w: number, h: number, cls: string, radius = 5): string =>
  `<rect class="${cls}" x="${String(x)}" y="${String(y)}" width="${String(w)}" height="${String(h)}" rx="${String(radius)}"/>`;

/** A polyline through `points`, with an arrow head at its end unless `head` is false. */
export function arrow(points: readonly (readonly [number, number])[], cls = "arr", head = true): string {
  const d = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${String(x)},${String(y)}`).join(" ");
  return `<path class="${cls}" d="${d}"${head ? ' marker-end="url(#ah)"' : ""}/>`;
}

/** The green `required` pill at the top right corner of a box. */
export const requiredBadge = (right: number, top: number): string =>
  `${rect(right - 60, top - 7, 52, 14, "req", 7)}${text(right - 34, top + 3.5, "required", "reqt", "middle")}`;

/** A box with a bold mono first line and muted lines below it. */
export function box(
  x: number,
  y: number,
  w: number,
  h: number,
  cls: string,
  lines: readonly string[],
): string {
  const [name = "", ...rest] = lines;
  return [
    rect(x, y, w, h, cls),
    text(x + 10, y + 19, name, "n"),
    ...rest.map((line, i) => text(x + 10, y + 35 + i * 14, line, "s")),
  ].join("");
}

/** The height of a box with `lines` lines. */
export const boxHeight = (lines: number): number => 14 + lines * 14 + (lines > 1 ? 4 : 0);

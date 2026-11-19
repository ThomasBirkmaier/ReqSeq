// Whether an SVG file may be copied into the HTML export (SR-235 AK4). An `<img>` never runs an SVG's
// scripts, but the copy is a file of the export that a reader can open by its address, where it would.
// So an SVG is copied only when its text holds nothing that runs or loads: no script, no event
// attribute, no animation, no character reference, no `javascript:` or `data:` address, no foreign object, no reference outside the file and
// no entity declaration. The test is on the text, in lower case, and refuses rather than parses.

/** What makes `bytes` (an SVG by its content) unsafe to copy, or undefined. */
export const svgRisk = (bytes: Uint8Array): string | undefined => {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).toLowerCase();
  if (/<\s*script|<\s*foreignobject|<!entity|<\s*(?:iframe|embed|object|handler|listener)\b/u.test(text)) {
    return "a script or embedded content";
  }
  if (/\son[a-z]+\s*=/u.test(text)) {
    return "an event attribute";
  }
  // An animation can set an address, and a character reference can hide one from the tests below.
  if (/<\s*(?:animate[a-z]*|set)\b|&#/u.test(text)) {
    return "an animation or a character reference";
  }
  if (/javascript:|vbscript:|data:/u.test(text)) {
    return "a script or data address";
  }
  if (
    /(?:href|src)\s*=\s*["']?\s*(?!#)[^\s"'>]/u.test(text) ||
    /url\(\s*["']?\s*(?!#)[^\s"')]/u.test(text) ||
    text.includes("@import")
  ) {
    return "a reference outside the file";
  }
  return undefined;
};

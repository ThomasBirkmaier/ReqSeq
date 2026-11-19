// Whether an SVG file may be copied into the HTML export (SR-235 AK4). An `<img>` never runs an SVG's
// scripts, but the copy is a file of the export that a reader can open by its address, where it would.
// So an SVG is copied only when its text holds nothing that runs or loads: no namespace but SVG and
// XLink (so no XHTML element can come in under a prefix), no script, foreign object, embedded content
// or animation under any prefix, no event attribute, no character reference, no `javascript:` or
// `data:` address, no reference outside the file and no entity declaration. The test is on the text,
// in lower case, and refuses rather than parses.

/** The namespaces an SVG of the export may bind, by `xmlns` or `xmlns:<prefix>`. */
const NAMESPACES: ReadonlySet<string> = new Set([
  "http://www.w3.org/2000/svg",
  "http://www.w3.org/1999/xlink",
]);
/** An element by its local name, whatever its prefix. */
const element = (names: string): RegExp =>
  new RegExp(`<\\s*(?:[^\\s<>/:]+:)?(?:${names})(?![a-z0-9_.:-])`, "u");
const RUNS = element("script|foreignobject|iframe|embed|object|handler|listener");
const ANIMATES = element("animate[a-z]*|set");

/** Whether `text` binds only the namespaces of NAMESPACES, each in a form the test reads. */
const knownNamespaces = (text: string): boolean => {
  const bindings = [...text.matchAll(/\bxmlns(?::[^\s=<>]+)?\s*=\s*(["'])([^"']*)\1/gu)];
  const all = text.match(/\bxmlns\b/gu) ?? [];
  return bindings.length === all.length && bindings.every((b) => NAMESPACES.has(String(b[2]).trim()));
};

/** What makes `bytes` (an SVG by its content) unsafe to copy, or undefined. */
export const svgRisk = (bytes: Uint8Array): string | undefined => {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).toLowerCase();
  if (!knownNamespaces(text)) {
    return "a namespace other than SVG and XLink";
  }
  if (RUNS.test(text) || text.includes("<!entity")) {
    return "a script or embedded content";
  }
  if (/\s(?:[^\s=<>:]+:)?on[a-z]+\s*=/u.test(text)) {
    return "an event attribute";
  }
  // An animation can set an address, and a character reference can hide one from the tests below.
  if (ANIMATES.test(text) || text.includes("&#")) {
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

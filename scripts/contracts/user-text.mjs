// The texts users read without the internal references of this repository (#642): the IDs of issues
// (#306), decisions (D-030), system requirements and needs of ReqSeq's own spec (SR-087, N-036), ADRs
// (ADR-0004) and acceptance criteria (AK3), which a user cannot look up and which look like the user's
// own short IDs. The sources (schemas/, the catalog) keep them for traceability; the generator writes
// the contracts that the CLI help, MCP, the API and the documentation show with `userTexts`.
//
// A reference goes when it stands alone in parentheses, `(D-030, SR-087)`, or as an item of them,
// `(the key, #306)` → `(the key)`, or as a lead, `SR-153 AK1: only …` → `Only …`. A reference in running
// text stays (`such as SR-036` is an example of an identifier); `internalReferences` finds those.

/** An issue or PR, also one of the repository before the move: `#306`, `ThomasBirkmaier/ReqSeq-archive#306`. */
const ISSUE = String.raw`(?:ThomasBirkmaier\/ReqSeq-archive)?#\d+`;
/** One reference, with the words that narrow it: `SR-034 AK2`, `#528 Q1`, `ADR-0002 rule 5`, `#141 c`. */
const ONE = String.raw`(?:${ISSUE}|\b(?:D|SR|N)-\d{3}\b|\bADR-\d{4}\b|\bAK\d+\b)(?:\s+(?:AK\d+|Q\d+|rule\s+\d+|[a-z]\b|\([a-z]\)|"[^"]*"))*`;
/** The words that may introduce a reference. */
const LEAD = String.raw`(?:(?:[Ss]pec questions?|[Ss]pec-frage|[Dd]ecisions? on|[Ss]ee|[Aa]ssumption(?: on)?|[Ff]ollow-up(?: of)?|[Ff]rom|[Pp]er|[Aa]s in|[Aa]s)\s+)?`;
const REF = `${LEAD}${ONE}`;
/** References joined by `,`, `/`, `and` or `to`, and further criteria or questions (`#528 Q1, Q2`). */
const LIST = String.raw`${REF}(?:\s*(?:,|/|and|to)\s*${REF}|\s*,\s*(?:AK|Q)\d+)*`;
const ONLY = new RegExp(String.raw`^\s*${LIST}\s*$`);
const PREFIX = new RegExp(String.raw`^\s*${LIST}\s*:\s*`);
const FOUND = new RegExp(
  String.raw`${ISSUE}|\b(?:D|SR|N)-\d{3}\b|\bADR-\d{4}\b|\bAK\d+\b|product owner decision`,
);
/** The origin of a rule, `product owner decision, 2026-11-02`, which goes as a reference does. */
const ORIGIN = /\bproduct owner decision,\s*\d{4}-\d{2}-\d{2}/g;
/** The mark of an assumption, which says nothing once its spec question went: `(assumption, #591)`. */
const ASSUMPTION = /^\s*assumption\s*$/;
/** A code span, kept as it is: `--fields id,title` is no list, `x(#5)` no group. */
const CODE = /`[^`]*`/g;
const FOUND_ALL = new RegExp(FOUND.source, "g");

/** `part` without a leading reference, its first letter upper case when one went. */
const withoutLead = (part) => {
  const lead = PREFIX.exec(part);
  if (lead === null) {
    return part;
  }
  const rest = part.slice(lead[0].length);
  return rest.charAt(0).toUpperCase() + rest.slice(1);
};

/** The items of `inner` split at `separator` without those that are only references, each without a lead. */
const kept = (inner, separator, inside) =>
  inner
    .split(separator)
    .map((item) => (ONLY.test(item) || ASSUMPTION.test(item) ? "" : inside(item.replace(PREFIX, ""))))
    .filter((item) => item.trim() !== "");

/**
 * One parenthesized group without its references; "" when nothing else was in it. Its parts at `;` go
 * first, so that `(AK2; spec questions #528 Q1, Q2)` goes whole, then the items of a part at `,`.
 */
const group = (whole, space, written) => {
  if (!FOUND.test(written)) {
    return whole;
  }
  const inner = written.replace(ORIGIN, "#0");
  const parts = kept(inner, /;\s*/, (part) => kept(part, /,\s*/, (item) => item).join(", "));
  const joined = parts.join("; ").trim();
  if (joined === "") {
    return "";
  }
  // Only a group that lost a reference is written anew, so the spacing of every other one stays.
  return internalReferences(joined).length === internalReferences(written).length
    ? whole
    : `${space}(${joined})`;
};

/** `text` without the internal references that stand alone in parentheses or as its lead. */
export const userText = (text) => {
  // Code spans are set aside first, so that nothing in them is a group, a list or a reference.
  const spans = [];
  let out = text.replace(CODE, (span) => `\uE000${spans.push(span) - 1}\uE000`);
  out = withoutLead(out);
  let before;
  do {
    before = out;
    out = out.replace(/(\s?)\(([^()]*)\)/g, group);
  } while (out !== before);
  // A text that began with a group that went begins with its next word.
  if (out !== text && /^\s/.test(out) && !/^\s/.test(text)) {
    out = out.trimStart();
    out = out.charAt(0).toUpperCase() + out.slice(1);
  }
  return out.replace(/\uE000(\d+)\uE000/g, (_, i) => spans[Number(i)]);
};

/** The internal references still in `text` (in running text), for checks of the texts users read. */
export const internalReferences = (text) => text.match(FOUND_ALL) ?? [];

/** The keys whose string values are texts users read: `description`, `summary` and `title`. */
const TEXT_KEYS = new Set(["description", "summary", "title"]);

/** `node` with `userText` applied to every string under a key of `TEXT_KEYS`, at any depth. */
export const userTexts = (node) => {
  if (Array.isArray(node)) {
    return node.map(userTexts);
  }
  if (node !== null && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [
        key,
        typeof value === "string" && TEXT_KEYS.has(key) ? userText(value) : userTexts(value),
      ]),
    );
  }
  return node;
};

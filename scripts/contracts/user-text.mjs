// The texts users read without the internal references of this repository (#642): the IDs of issues
// (#306), decisions (D-030), system requirements and needs of ReqSeq's own spec (SR-087, N-036), ADRs
// (ADR-0004) and acceptance criteria (AK3), which a user cannot look up and which look like the user's
// own short IDs. The sources (schemas/, the catalog) keep them for traceability; the generator writes
// the contracts that the CLI help, MCP, the API and the documentation show with `userTexts`.
//
// A reference goes when it stands alone in parentheses, `(D-030, SR-087)`, or as an item of them,
// `(the key, #306)` → `(the key)`, or as a lead, `SR-153 AK1: only …` → `Only …`. A reference in running
// text stays (`such as SR-036` is an example of an identifier); `internalReferences` finds those.

/** One reference, with the words that narrow it: `SR-034 AK2`, `#528 Q1`, `ADR-0002 rule 5`, `#141 c`. */
const ONE = String.raw`(?:#\d+|\b(?:D|SR|N)-\d{3}\b|\bADR-\d{4}\b|\bAK\d+\b)(?:\s+(?:AK\d+|Q\d+|rule\s+\d+|[a-z]\b|\([a-z]\)|"[^"]*"))*`;
/** The words that may introduce a reference. */
const LEAD = String.raw`(?:(?:spec questions?|spec-frage|decisions? on|see|assumption(?: on)?|follow-up(?: of)?|from|per|as in|as)\s+)?`;
const REF = `${LEAD}${ONE}`;
/** References joined by `,`, `/`, `and` or `to`, and further criteria or questions (`#528 Q1, Q2`). */
const LIST = String.raw`${REF}(?:\s*(?:,|/|and|to)\s*${REF}|\s*,\s*(?:AK|Q)\d+)*`;
const ONLY = new RegExp(String.raw`^\s*${LIST}\s*$`, "i");
const PREFIX = new RegExp(String.raw`^\s*${LIST}\s*:\s*`, "i");
const FOUND = /#\d+|\b(?:D|SR|N)-\d{3}\b|\bADR-\d{4}\b|\bAK\d+\b/;
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
    .map((item) => (ONLY.test(item) ? "" : inside(item.replace(PREFIX, ""))))
    .filter((item) => item.trim() !== "");

/**
 * One parenthesized group without its references; "" when nothing else was in it. Its parts at `;` go
 * first, so that `(AK2; spec questions #528 Q1, Q2)` goes whole, then the items of a part at `,`.
 */
const group = (whole, space, inner) => {
  if (!FOUND.test(inner)) {
    return whole;
  }
  const parts = kept(inner, /;\s*/, (part) => kept(part, /,\s*/, (item) => item).join(", "));
  const joined = parts.join("; ").trim();
  if (joined === "") {
    return "";
  }
  // Only a group that lost a reference is written anew, so the spacing of every other one stays.
  return internalReferences(joined).length === internalReferences(inner).length
    ? whole
    : `${space}(${joined})`;
};

/** `text` without the internal references that stand alone in parentheses or as its lead. */
export const userText = (text) => {
  let out = withoutLead(text);
  let before;
  do {
    before = out;
    out = out.replace(/(\s?)\(([^()]*)\)/g, group);
  } while (out !== before);
  return out;
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

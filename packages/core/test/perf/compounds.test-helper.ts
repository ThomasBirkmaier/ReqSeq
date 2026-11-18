// Compound words for the performance suite (SR-221: word parts, ADR-0011). The generated workspace
// of N-036 has few words of letters, so a word part would cost nothing there; real texts hold many
// compounds ("Paketseite", "Verifikationsstatus"), and a common part stands inside thousands of
// distinct words. This builds such a vocabulary: 400 heads of three syllables and 400 tails of two,
// from two sets of syllables, so a tail never begins a word and is never a word of its own; the
// tails are drawn by Zipf's law (the first one most often), the heads evenly, with a fixed seed. The
// sentence they stand in has no other word of the generated texts, so the other rows search what they
// searched before (a "the" before a compound would add places to the phrase `"the s`).
import type { GeneratedWorkspace } from "@reqseq/testkit";

// No head begins with a letter the other rows type alone or as two letters (`s`, `th`, `se`, `re`,
// `in`, `dr`, `t`, `w`), so their word starts derive what they derived before.
const HEAD_SYLLABLES = [
  "ka",
  "lo",
  "mi",
  "ze",
  "fa",
  "po",
  "ni",
  "vu",
  "go",
  "he",
  "ja",
  "ko",
  "nu",
  "pe",
  "bu",
];
const TAIL_SYLLABLES = [
  "bor",
  "dak",
  "fen",
  "gul",
  "hix",
  "jor",
  "kem",
  "lun",
  "mos",
  "nap",
  "pir",
  "quo",
  "rax",
  "sut",
  "tev",
  "uld",
  "vim",
  "wex",
  "yor",
  "zun",
];

const HEADS = 400;
const TAILS = 400;

/** A generator of numbers in [0, 1) with a fixed seed (mulberry32). */
const random = (seed: number): (() => number) => {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const heads: readonly string[] = Array.from({ length: HEADS }, (_, n) =>
  [0, 1, 2]
    .map((k) => HEAD_SYLLABLES[Math.floor(n / HEAD_SYLLABLES.length ** k) % HEAD_SYLLABLES.length])
    .join(""),
);

/** The tails, the most frequent first. */
const TAIL_WORDS: readonly string[] = Array.from(
  { length: TAILS },
  (_, n) => `${String(TAIL_SYLLABLES[n % 20])}${String(TAIL_SYLLABLES[Math.floor(n / 20) % 20])}`,
);

/** Zipf weights of the tails: the k-th drawn 1/k as often as the first. */
const cumulative = (() => {
  const weights = TAIL_WORDS.map((_, k) => 1 / (k + 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let sum = 0;
  return weights.map((weight) => (sum += weight / total));
})();

/** `count` compounds drawn by `next`. */
const compounds = (next: () => number, count: number): string[] =>
  Array.from({ length: count }, () => {
    const head = String(heads[Math.floor(next() * HEADS)]);
    const draw = next();
    const tail = String(TAIL_WORDS[cumulative.findIndex((sum) => draw <= sum)] ?? TAIL_WORDS.at(-1));
    return `${head}${tail}`;
  });

/**
 * `tree` with compounds: `perText` of them in a sentence appended to the text of every element, and
 * one at the end of the title of every `titleEvery`th element (none for 0). Returns the tree and every
 * compound written.
 */
export const withCompounds = (
  tree: GeneratedWorkspace,
  options: { readonly perText: number; readonly titleEvery: number },
): { readonly tree: GeneratedWorkspace; readonly words: ReadonlySet<string> } => {
  const next = random(221);
  const files = new Map(tree.files);
  const words = new Set<string>();
  tree.elements.forEach((element, n) => {
    const file = `${element.repository}/${element.file}`;
    let content = files.get(file);
    if (content === undefined) {
      return;
    }
    if (options.titleEvery > 0 && n % options.titleEvery === 3) {
      const [word = ""] = compounds(next, 1);
      words.add(word);
      content = content.replace(/^title: (.*)$/mu, `title: $1 ${word}`);
    }
    const drawn = compounds(next, options.perText);
    for (const word of drawn) {
      words.add(word);
    }
    files.set(file, drawn.length === 0 ? content : `${content}\nKept: ${drawn.join(", ")}.\n`);
  });
  return { tree: { ...tree, files }, words };
};

/**
 * The costliest word part of `words` for a search: the 4-letter string that stands, after their
 * start, inside the most distinct words of them, and the tail that does (whole query words).
 */
export const costliestParts = (
  words: ReadonlySet<string>,
): { readonly four: string; readonly tail: string } => {
  const counts = new Map<string, number>();
  for (const word of words) {
    const seen = new Set<string>();
    for (let at = 1; at + 4 <= word.length; at++) {
      seen.add(word.slice(at, at + 4));
    }
    for (const part of seen) {
      counts.set(part, (counts.get(part) ?? 0) + 1);
    }
  }
  const four = [...counts].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
  // Every compound ends with its tail of 6 letters.
  const tails = new Map<string, number>();
  for (const word of words) {
    const tail = word.slice(-6);
    tails.set(tail, (tails.get(tail) ?? 0) + 1);
  }
  const tail = [...tails].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
  return { four, tail };
};

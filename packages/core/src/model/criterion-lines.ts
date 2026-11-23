// The generator of new criterion keys (SR-204 AK1) that `newCriterionKey` uses, with the random source
// passed in (`crypto.randomInt`, or `seededRandom` of `acceptance-criteria.ts`).

/** A random integer from 0 below `below`. */
export type RandomInt = (below: number) => number;

/** The first character of a generated criterion key: consonants, so a key reads as no word. */
const FIRST = "bcdfghjkmnpqrstvwxyz";
/** The other characters of a generated key. */
const REST = `${FIRST}0123456789`;
/** Characters of a generated key; 540,000 keys, drawn again against those `taken` holds (SR-204 AK1). */
const GENERATED_LENGTH = 4;

/** A new criterion key that `taken` does not hold: 4 characters, the first a consonant (SR-204 AK1). */
export const drawCriterionKey = (taken: ReadonlySet<string>, random: RandomInt): string => {
  for (;;) {
    let key = FIRST.charAt(random(FIRST.length));
    while (key.length < GENERATED_LENGTH) {
      key += REST.charAt(random(REST.length));
    }
    if (!taken.has(key)) {
      return key;
    }
  }
};

// The next identifier of a new element (SR-245): the one after the highest identifier of its type with
// the same identifier prefix, the part of an identifier before the digits 0 to 9 at its end. Prefixes
// compare as identifiers do (`identifierMatch`, SR-088 AK4), the digits as numbers without an upper
// bound (SR-075 AK1). Only the elements of the local copy count, those of exactly this type, also
// superseded ones and those with an invalid status; a file that is no element counts for nothing.
// Reading the store reads nothing, and the write queue of the workspace (SR-166 AK1) makes a second
// call in the same process see the element of the first.
import { CommandError } from "../catalog.js";
import type { ElementInputValue, MetamodelEffectiveType } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import type { ElementRecord } from "./elements.js";
import { identifierKeyOf, identifierMatch, identifierValue } from "./identifier-index.js";
import type { ElementStore } from "./store.js";

/** Prefixes an `identifier.prefixes` refusal names at most (SR-245 AK3). */
const LISTED_PREFIXES = 20;
/** Characters a given prefix may have at most (SR-245 AK5), and a prefix with more, counted in code points. */
const MAX_PREFIX = 100;
const TOO_LONG = /^[\s\S]{101}/u;

/** An identifier that counts: its prefix, its digits and where its element is. */
interface Counted {
  readonly prefix: string;
  readonly digits: string;
  readonly number: bigint;
  readonly element: ElementRecord;
}

const invalid = (message: string, details: Record<string, unknown>): CommandError =>
  new CommandError("input.invalid", message, details);

/** Prefix and digits of an identifier; undefined when it does not end in a digit or is only digits (SR-245 AK1). */
const split = (identifier: string): { readonly prefix: string; readonly digits: string } | undefined => {
  let start = identifier.length;
  while (start > 0 && /[0-9]/u.test(identifier.charAt(start - 1))) {
    start -= 1;
  }
  return start === 0 || start === identifier.length
    ? undefined
    : { prefix: identifier.slice(0, start), digits: identifier.slice(start) };
};

/** By repository, then path, by code units (SR-245 AK2): files are unique, so this never ties. */
const byPlace = (a: ElementRecord, b: ElementRecord): number =>
  a.repository !== b.repository ? (a.repository < b.repository ? -1 : 1) : a.file < b.file ? -1 : 1;

/** Whether `a` comes before `b` as the identifier the next one follows: higher number, more digits, place (SR-245 AK2). */
const before = (a: Counted, b: Counted): boolean =>
  a.number !== b.number
    ? a.number > b.number
    : a.digits.length !== b.digits.length
      ? a.digits.length > b.digits.length
      : byPlace(a.element, b.element) < 0;

/** The identifier that follows `highest`: its prefix as written, the number plus one, padded to its digits (SR-245 AK2). */
const following = (highest: Counted): string =>
  `${highest.prefix}${(highest.number + 1n).toString().padStart(highest.digits.length, "0")}`;

/** Why a given prefix that no identifier carries is refused (SR-245 AK5); undefined when it is not. */
const prefixFault = (prefix: string): string | undefined => {
  if (prefix === "") {
    return "is empty";
  }
  if (TOO_LONG.test(prefix)) {
    return `is longer than ${String(MAX_PREFIX)} characters`;
  }
  if (/[0-9]$/u.test(prefix)) {
    return "ends with a digit";
  }
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(prefix)) {
    return "contains a control character or a line break";
  }
  if (/^\s|\s$/u.test(prefix)) {
    return "starts or ends with white space";
  }
  return undefined;
};

/** The highest identifier of each prefix, by `identifierMatch` of the prefix, with the count of identifiers that carry it. */
const highestByPrefix = (
  store: ElementStore,
  typeKey: string,
  key: string,
): Map<string, { highest: Counted; count: number }> => {
  const prefixes = new Map<string, { highest: Counted; count: number }>();
  for (const element of store.elements) {
    const parts = element.type === typeKey ? split(identifierValue(element, key) ?? "") : undefined;
    if (parts === undefined) {
      continue;
    }
    const counted: Counted = { ...parts, number: BigInt(parts.digits), element };
    const match = identifierMatch(parts.prefix);
    const seen = prefixes.get(match);
    if (seen === undefined) {
      prefixes.set(match, { highest: counted, count: 1 });
    } else {
      seen.count += 1;
      if (before(counted, seen.highest)) {
        seen.highest = counted;
      }
    }
  }
  return prefixes;
};

/**
 * The identifier `element.create` gives a new element of `type` when asked to (SR-245), with the
 * key of the property it goes into. Refused with `input.invalid`: a type without a property with
 * the meaning `identifier` (AK6, `no-identifier-property`), an identifier also given as a property
 * (AK7, `identifier-given`), a given prefix that no identifier carries and that is not fit (AK5,
 * `invalid-prefix`), no identifier that counts and no prefix given (AK8, `no-identifiers`), and
 * several prefixes but none given (AK3, `several-prefixes`). Nothing is written before.
 */
export const nextIdentifier = (
  store: ElementStore,
  metamodel: Metamodel,
  type: MetamodelEffectiveType,
  given: Readonly<Record<string, unknown>>,
  prefix: string | undefined,
): { readonly key: string; readonly identifier: string } => {
  const key = identifierKeyOf(metamodel);
  if (key === undefined || !type.properties.includes(key)) {
    throw invalid(
      `nextIdentifier: type ${type.key} has no property with the meaning identifier, so no identifier can be assigned`,
      { type: type.key, reason: "no-identifier-property" },
    );
  }
  if (Object.hasOwn(given, key)) {
    throw invalid(
      `nextIdentifier: the identifier is also given as property ${key}; give either nextIdentifier or ${key}`,
      { key, reason: "identifier-given" },
    );
  }
  const prefixes = highestByPrefix(store, type.key, key);
  if (prefix !== undefined) {
    const carried = prefixes.get(identifierMatch(prefix));
    if (carried !== undefined) {
      return { key, identifier: following(carried.highest) };
    }
    const fault = prefixFault(prefix);
    if (fault !== undefined) {
      throw invalid(`identifierPrefix: the identifier prefix ${JSON.stringify(prefix)} ${fault}`, {
        identifierPrefix: prefix,
        reason: "invalid-prefix",
      });
    }
    return { key, identifier: `${prefix}1` };
  }
  const [only, ...others] = [...prefixes.values()];
  if (only === undefined) {
    throw invalid(
      `nextIdentifier: no element of type ${type.key} has an identifier that ends in digits after a prefix, so there is none to follow; give identifierPrefix to start with 1`,
      { type: type.key, reason: "no-identifiers" },
    );
  }
  if (others.length > 0) {
    const listed = [only, ...others]
      .map(({ highest, count }) => ({ prefix: highest.prefix, count }))
      .sort((a, b) => {
        const [x, y] = [identifierMatch(a.prefix), identifierMatch(b.prefix)];
        return b.count - a.count || (x < y ? -1 : 1);
      })
      .slice(0, LISTED_PREFIXES)
      .map((entry) => entry.prefix);
    const count = others.length + 1;
    throw invalid(
      `nextIdentifier: the identifiers of type ${type.key} carry ${String(count)} identifier prefixes (${listed
        .map((p) => JSON.stringify(p))
        .join(", ")}${count > LISTED_PREFIXES ? ", ..." : ""}); give one of them as identifierPrefix`,
      { type: type.key, count, prefixes: listed, reason: "several-prefixes" },
    );
  }
  return { key, identifier: following(only.highest) };
};

/** The input of `element.create` that `withNextIdentifier` reads. */
export interface NextIdentifierInput {
  readonly properties?: Readonly<Record<string, ElementInputValue>>;
  readonly nextIdentifier?: boolean;
  readonly identifierPrefix?: string;
}

/**
 * The given properties of a new element, with the identifier of `nextIdentifier` when asked for
 * (SR-245); `identifierPrefix` without `nextIdentifier: true` is refused (AK10,
 * `prefix-without-next-identifier`).
 */
export const withNextIdentifier = (
  store: ElementStore,
  metamodel: Metamodel,
  type: MetamodelEffectiveType,
  input: NextIdentifierInput,
): Readonly<Record<string, ElementInputValue>> => {
  const given = input.properties ?? {};
  if (input.nextIdentifier !== true) {
    if (input.identifierPrefix !== undefined) {
      throw invalid("identifierPrefix: an identifier prefix is only taken with nextIdentifier", {
        reason: "prefix-without-next-identifier",
      });
    }
    return given;
  }
  const { key, identifier } = nextIdentifier(store, metamodel, type, given, input.identifierPrefix);
  return { ...given, [key]: identifier };
};

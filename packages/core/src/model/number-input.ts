// Values of number properties in the input of a write command (#614). `element.create`,
// `element.update` and `element.bulkUpdate` (`set`, `add`) refuse a value that is no number with
// `input.invalid` (`reason: not-a-number`), as `relationTargetRefs` refuses an item of a
// relation-valued property that is no reference: a text such as "3" is not converted.
// A value that counts as no value (`isEmptyValue`) is kept, as for every kind.
// A hand-written file is still read as it is and gets the hint of SR-085 (`values.ts`). The app's
// number box and the CLI's `--set` send what they read as a number as a number.
import { CommandError } from "../catalog.js";
import type { ElementInputValue } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { isEmptyValue } from "./required.js";
import { describe } from "./values.js";

/** Whether `key` is a property of kind number. */
export const isNumberProperty = (metamodel: Metamodel, key: string): boolean =>
  metamodel.properties.some((p) => p.key === key && p.kind === "number");

/** The number JSON reads `text` as, else undefined: `"3"` was sent as text where `3` was meant. */
const asJsonNumber = (text: string): number | undefined => {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "number" ? value : undefined;
  } catch {
    return undefined;
  }
};

/**
 * What to do about a value that is no number: a text that JSON reads as a number lost its number
 * only by its quotes; one that only JavaScript reads as a number (`.5`, `0x10`) is shown as a
 * decimal number; anything else needs a decimal number.
 */
const remedy = (value: unknown): string => {
  if (typeof value === "string") {
    if (asJsonNumber(value) !== undefined) {
      return "give it as a number, without quotes";
    }
    const read = Number(value);
    if (value.trim() !== "" && Number.isFinite(read)) {
      return `give a decimal number such as ${String(read)}`;
    }
  }
  return "give a decimal number";
};

/**
 * The value of the number property `key` as given, or `input.invalid` with `reason: not-a-number`
 * (and the `index` of a list item) for a value or list item that is no finite number.
 */
export const numberInput = (key: string, given: ElementInputValue): ElementInputValue => {
  if (isEmptyValue(given)) {
    return given;
  }
  const check = (item: unknown, index: number | undefined): void => {
    if (typeof item === "number" && Number.isFinite(item)) {
      return;
    }
    const at = index === undefined ? "" : ` item ${String(index + 1)}`;
    throw new CommandError("input.invalid", `${key}${at}: ${describe(item)} is no number; ${remedy(item)}`, {
      key,
      ...(index === undefined ? {} : { index }),
      reason: "not-a-number",
    });
  };
  if (Array.isArray(given)) {
    (given as unknown[]).forEach((item, i) => {
      check(item, i);
    });
  } else {
    check(given, undefined);
  }
  return given;
};

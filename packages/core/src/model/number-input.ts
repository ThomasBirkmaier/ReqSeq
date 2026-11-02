// Values of number properties in the input of a write command (#614). `element.create`,
// `element.update` and `element.bulkUpdate` refuse a value that is no number with `input.invalid`
// (`reason: not-a-number`), as `relationTargetRefs` refuses an item of a relation-valued property
// that is no reference: a text such as "3" is not converted (product owner decision, 2026-11-02).
// A value that counts as no value (`isEmptyValue`) is kept, as for every kind. A hand-written file
// is still read as it is and gets the hint of SR-085 (`values.ts`).
import { CommandError } from "../catalog.js";
import type { ElementInputValue } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { isEmptyValue } from "./required.js";

/** Whether `key` is a property of kind number. */
export const isNumberProperty = (metamodel: Metamodel, key: string): boolean =>
  metamodel.properties.some((p) => p.key === key && p.kind === "number");

/** How a value that is no number is named in the message; a text that reads as a number says so. */
const describe = (value: unknown): string => {
  if (typeof value === "string") {
    const shown = JSON.stringify(value);
    return value.trim() !== "" && Number.isFinite(Number(value))
      ? `the text ${shown}; give it as a number, without quotes`
      : `the text ${shown}`;
  }
  if (value === null) {
    return "empty";
  }
  if (Array.isArray(value)) {
    return "a list";
  }
  // The input schema allows numbers, booleans, mappings and lists besides text.
  return typeof value === "number" || typeof value === "boolean"
    ? `the ${typeof value} ${String(value)}`
    : "a mapping";
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
    throw new CommandError(
      "input.invalid",
      `${key}:${at} is ${describe(item)}; a property of kind number takes a number`,
      { key, ...(index === undefined ? {} : { index }), reason: "not-a-number" },
    );
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

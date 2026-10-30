// Which evidence records count for a baseline (SR-094 AK2): a record dated at or before the
// baseline, compared by date and time; when either date has no time, by day, so a record of the
// baseline's day counts. The day of a date is its date as written (ADR-0018 "date": the baseline's
// UTC day), never converted to another time zone. A date that cannot be read counts as before all
// others. `instant` is the twin of `instantOf` (evidence/by-element.ts), which this block cannot
// import (the evidence block lies above it); change both together.
// Valid baseline and record files always carry a time (`common.schema.json#/$defs/dateTime`); the
// day rule holds for records given otherwise (assumption of spec question #471).

/** A calendar date without time (RFC 3339 full-date). */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The instant of `date`; a date that cannot be read is before all others. */
const instant = (date: string): number => {
  const time = Date.parse(date);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
};

/** Whether a record dated `date` counts for a baseline dated `baselineDate` (see the file comment). */
export const countsFor = (baselineDate: string): ((date: string) => boolean) => {
  const day = baselineDate.slice(0, 10);
  const at = instant(baselineDate);
  const dayOnly = DAY.test(baselineDate);
  return (date) => (dayOnly || DAY.test(date) ? date.slice(0, 10) <= day : instant(date) <= at);
};

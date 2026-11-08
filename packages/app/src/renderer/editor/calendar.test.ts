// SR-200: the days of the calendar of the slash menu's "Date"; the calendar in the editor is tested in
// slash-menu.test.ts.
import { describe, expect, it } from "vitest";
import { addDays, monthOf, WEEKDAYS } from "./calendar.js";

describe("the days of the calendar (SR-200)", () => {
  it("[SR-200/AK2] moves by days and weeks across months and years", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-02", -7)).toBe("2026-02-23");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    // Daylight saving changes nothing: the calendar counts days.
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
  });

  it("shows a month from Monday, with the days of the months around it", () => {
    expect(WEEKDAYS[0]).toBe("Mo");
    const november = monthOf("2026-11-08");
    expect(november.title).toBe("November 2026");
    // 1 November 2026 is a Sunday.
    expect(november.weeks[0]?.map((day) => day.iso)).toEqual([
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
    expect(november.weeks[0]?.map((day) => day.inMonth)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
    expect(november.weeks).toHaveLength(6);
    expect(november.weeks.at(-1)?.at(-1)?.iso).toBe("2026-12-06");
    // February 2021 starts on a Monday and fills four weeks exactly.
    expect(monthOf("2021-02-14").weeks).toHaveLength(4);
  });
});

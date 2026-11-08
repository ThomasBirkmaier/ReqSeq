// The calendar of the slash menu's "Date" (SR-200 AK2, AK3): a small month at the caret with today chosen.
// Left and Right choose the day before or after, Up and Down the same weekday a week before or after, also
// across months; Enter or a click writes the day as `YYYY-MM-DD` in place of the `/` and its query (through
// `insertHeld`, one undo step), Escape closes it and leaves the `/` and its query as typed. Typing, moving
// the caret or leaving the editor closes it as Escape does. The calendar edits the text only (ADR-0002).
import { EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, keymap, showTooltip } from "@codemirror/view";
import type { Tooltip, TooltipView } from "@codemirror/view";
import { insertHeld, pendingField, setPending } from "./reference-pick.js";

/** A day as its year, month (1..12) and day of the month. */
interface Day {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const parse = (iso: string): Day => {
  const [year = 0, month = 1, day = 1] = iso.split("-").map(Number);
  return { year, month, day };
};

/** The day of a UTC date as `YYYY-MM-DD`: calendar arithmetic in UTC knows no daylight saving. */
const format = (date: Date): string => date.toISOString().slice(0, 10);

/** The day `days` after `iso` (before it, for a negative number), across months and years. */
export const addDays = (iso: string, days: number): string => {
  const { year, month, day } = parse(iso);
  return format(new Date(Date.UTC(year, month - 1, day + days)));
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** The weekdays, starting on Monday (ISO 8601). */
export const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** The month of `iso`: its name with the year, and its weeks from Monday, with the days of the months around it. */
export const monthOf = (
  iso: string,
): {
  readonly title: string;
  readonly weeks: readonly (readonly { readonly iso: string; readonly inMonth: boolean }[])[];
} => {
  const { year, month } = parse(iso);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // The days of the month before, back to Monday (Monday is 0).
  const lead = (first.getUTCDay() + 6) % 7;
  const start = addDays(format(first), -lead);
  const weeks = Array.from({ length: Math.ceil((lead + length) / 7) }, (_, week) =>
    Array.from({ length: 7 }, (_unused, weekday) => {
      const day = addDays(start, week * 7 + weekday);
      return { iso: day, inMonth: parse(day).month === month };
    }),
  );
  return { title: `${String(MONTHS[month - 1])} ${String(year)}`, weeks };
};

interface Open {
  /** The chosen day. */
  readonly day: string;
  /** The tooltip, the same while the calendar is open, so it is drawn again rather than made anew. */
  readonly tooltip: Tooltip;
}

const openEffect = StateEffect.define<Open>();
const chooseEffect = StateEffect.define<string>();
const closeEffect = StateEffect.define();

/** The open calendar, or null. Any change of the text or the selection closes it. */
const calendarField = StateField.define<Open | null>({
  create: () => null,
  update: (value, transaction) => {
    let next =
      value !== null && (transaction.docChanged || transaction.selection !== undefined) ? null : value;
    for (const effect of transaction.effects) {
      if (effect.is(openEffect)) {
        next = effect.value;
      } else if (effect.is(chooseEffect) && next !== null) {
        next = { ...next, day: effect.value };
      } else if (effect.is(closeEffect)) {
        next = null;
      }
    }
    return next;
  },
  provide: (field) => showTooltip.from(field, (open) => open?.tooltip ?? null),
});

/** Whether the calendar is open in `state`. */
export const calendarOpen = (state: EditorState): boolean =>
  (state.field(calendarField, false) ?? null) !== null;

/** The month table of the calendar, drawn again for every chosen day. */
const draw = (dom: HTMLElement, chosen: string, today: string): void => {
  const { title, weeks } = monthOf(chosen);
  const caption = document.createElement("div");
  caption.className = "cm-lr-calendar-title";
  caption.textContent = title;
  const table = document.createElement("table");
  table.setAttribute("role", "grid");
  table.setAttribute("aria-label", title);
  const head = table.createTHead().insertRow();
  for (const name of WEEKDAYS) {
    const cell = document.createElement("th");
    cell.textContent = name;
    cell.setAttribute("scope", "col");
    head.append(cell);
  }
  const body = table.createTBody();
  for (const week of weeks) {
    const row = body.insertRow();
    for (const { iso, inMonth } of week) {
      const cell = row.insertCell();
      cell.textContent = String(parse(iso).day);
      cell.dataset["day"] = iso;
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-selected", String(iso === chosen));
      if (iso === today) {
        cell.setAttribute("aria-current", "date");
      }
      if (!inMonth) {
        cell.className = "cm-lr-calendar-other";
      }
    }
  }
  dom.replaceChildren(caption, table);
};

const tooltipAt = (pos: number, today: string): Tooltip => ({
  pos,
  above: false,
  create: (view): TooltipView => {
    const dom = document.createElement("div");
    dom.className = "cm-lr-calendar";
    // A press anywhere on the calendar keeps the focus in the editor; on a day it writes that day.
    dom.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const day = (event.target as HTMLElement).closest<HTMLElement>("[data-day]")?.dataset["day"];
      if (day !== undefined) {
        insertHeld(view, day);
      }
    });
    let shown = "";
    const update = (state: EditorState): void => {
      const day = state.field(calendarField)?.day;
      if (day !== undefined && day !== shown) {
        shown = day;
        draw(dom, day, today);
      }
    };
    update(view.state);
    return {
      dom,
      update: (change) => {
        update(change.state);
      },
    };
  },
});

/**
 * Opens the calendar at the `/` of `view` (where the slash menu stood) with `today` chosen (the `/` and its query wait in
 * `pendingField`, set before).
 */
export const askDate = (view: EditorView, today: string): void => {
  view.dispatch({
    effects: openEffect.of({
      day: today,
      tooltip: tooltipAt(
        view.state.field(pendingField, false)?.from ?? view.state.selection.main.head,
        today,
      ),
    }),
  });
};

/** Closes the calendar; the `/` and its query stay as typed. */
const close = (view: EditorView): boolean => {
  if (!calendarOpen(view.state)) {
    return false;
  }
  view.dispatch({ effects: [closeEffect.of(null), setPending.of(null)] });
  return true;
};

/** Moves the chosen day by `days`. */
const move =
  (days: number) =>
  (view: EditorView): boolean => {
    const open = view.state.field(calendarField);
    if (open === null) {
      return false;
    }
    view.dispatch({ effects: chooseEffect.of(addDays(open.day, days)) });
    return true;
  };

/** The calendar as editor extensions. */
export const calendar: Extension = [
  calendarField,
  // A calendar that closes for another reason (typing, the caret moved) lets the `/` and its query go.
  EditorState.transactionExtender.of((transaction) =>
    transaction.startState.field(calendarField) !== null &&
    (transaction.docChanged || transaction.selection !== undefined) &&
    !transaction.effects.some((effect) => effect.is(setPending)) &&
    (transaction.startState.field(pendingField, false) ?? null) !== null
      ? { effects: setPending.of(null) }
      : null,
  ),
  Prec.highest(
    keymap.of([
      { key: "ArrowLeft", run: move(-1) },
      { key: "ArrowRight", run: move(1) },
      { key: "ArrowUp", run: move(-7) },
      { key: "ArrowDown", run: move(7) },
      {
        key: "Enter",
        run: (view) => {
          const open = view.state.field(calendarField);
          if (open === null) {
            return false;
          }
          insertHeld(view, open.day);
          return true;
        },
      },
      { key: "Escape", run: close },
    ]),
  ),
  EditorView.domEventHandlers({
    // Leaving the editor closes it, but not the window losing the focus (another app, a notification).
    blur: (_event, view) => {
      if (document.hasFocus()) {
        close(view);
      }
    },
  }),
];

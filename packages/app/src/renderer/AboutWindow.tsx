// The window "About ReqSeq" (SR-161, the exception of D-062): centered over the whole app, a soft card with
// a shadow like the card of the command line, over a backdrop dimmed and blurred more than behind that card
// (AK6). Read only (AK1). Each row copies its value with the copy symbol of a field (SR-128), seen on hover
// or focus, or with Enter or Ctrl/Cmd+C while it has the focus (Up, Down and Tab move it); "Copy all" (also
// Ctrl/Cmd+Shift+C) copies the whole content as one block (AK3). Escape or a click beside it
// closes it. While it is open it takes every key, so no shortcut of the app acts behind it.
import { useEffect, useMemo, useRef } from "react";
import type { AboutInfo, AboutRow } from "./about.js";
import { aboutGroups, aboutText } from "./about.js";
import { CopySymbol } from "./FieldBox.js";

export interface AboutWindowProps {
  readonly info: AboutInfo;
  readonly mac: boolean;
  readonly onCopy: (label: string, text: string) => void;
  readonly onClose: () => void;
}

/** Some text of the window is selected: Ctrl/Cmd+C copies it as anywhere else. */
const selected = (): boolean => document.getSelection()?.isCollapsed === false;

/** Enter, or Ctrl/Cmd+C without a selection, copies the row with the focus. */
const copiesRow = (key: string, mod: boolean): boolean =>
  key === "Enter" || (mod && key.toLowerCase() === "c" && !selected());

/** What the focus walks with Tab, Up and Down: the rows, then Copy all. */
const stopsOf = (root: HTMLElement | null): HTMLElement[] => [
  ...(root?.querySelectorAll<HTMLElement>(".about-row, .about-copy-all") ?? []),
];

export const AboutWindow = ({ info, mac, onCopy, onClose }: AboutWindowProps): React.JSX.Element => {
  const groups = useMemo(() => aboutGroups(info), [info]);
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement;
    // The window takes the keys, scrolled to its top.
    card.current?.focus({ preventScroll: true });
    return () => {
      // Back where the focus was, when that is still there (else the window's default).
      if (before instanceof HTMLElement && before.isConnected) {
        before.focus();
      }
    };
  }, []);
  const copyAll = (): void => {
    onCopy("About ReqSeq", aboutText(groups));
  };
  /** The row of an element of the window, when it is in one. */
  const rowOf = (target: EventTarget): AboutRow | undefined => {
    const label = (target as HTMLElement).closest<HTMLElement>(".about-row")?.dataset["label"];
    return groups.flatMap((group) => group.rows).find((one) => one.label === label);
  };
  /** Moves the focus by `by` stops; Tab wraps around, Up and Down stop at the ends. */
  const move = (by: number, wrap: boolean): void => {
    const stops = stopsOf(card.current);
    const at = stops.indexOf(document.activeElement as HTMLElement);
    const from = at === -1 && by < 0 ? stops.length : at;
    const next = wrap
      ? (from + by + stops.length) % stops.length
      : Math.min(stops.length - 1, Math.max(0, from + by));
    stops[next]?.focus();
  };
  const onKeyDown = (event: React.KeyboardEvent): void => {
    // No shortcut of the window acts behind the open window.
    event.stopPropagation();
    const mod = mac ? event.metaKey : event.ctrlKey;
    const key = event.key.toLowerCase();
    const line = rowOf(event.target);
    if (event.key === "Escape") {
      onClose();
    } else if (mod && event.shiftKey && key === "c") {
      copyAll();
    } else if (line !== undefined && copiesRow(event.key, mod)) {
      onCopy(line.label, line.value);
    } else if (event.key === "Tab") {
      move(event.shiftKey ? -1 : 1, true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      move(event.key === "ArrowDown" ? 1 : -1, false);
    } else {
      return;
    }
    event.preventDefault();
  };
  return (
    <div
      className="about-backdrop"
      onKeyDown={onKeyDown}
      onMouseUp={(event) => {
        // The mouse buttons Back and Forward switch no buffer behind it (SR-163).
        event.stopPropagation();
      }}
      onMouseDown={(event) => {
        // A click beside the card closes it.
        if (event.target === event.currentTarget) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div
        className="about"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        tabIndex={-1}
        ref={card}
      >
        <h1 id="about-title" className="about-title">
          About ReqSeq
        </h1>
        {groups.map((group) => (
          <section key={group.heading} className="about-group" aria-label={group.heading}>
            <h2 className="about-heading">{group.heading}</h2>
            <dl className="about-rows">
              {group.rows.map((line) => (
                <div key={line.label} className="about-row" data-label={line.label} tabIndex={0}>
                  <dt>{line.label}</dt>
                  <dd>{line.value}</dd>
                  <CopySymbol
                    label={line.label}
                    onCopy={() => {
                      onCopy(line.label, line.value);
                    }}
                  />
                </div>
              ))}
            </dl>
          </section>
        ))}
        <footer className="about-footer">
          <span className="about-hint">Esc closes</span>
          <button type="button" className="about-copy-all" onClick={copyAll}>
            Copy all
          </button>
        </footer>
      </div>
    </div>
  );
};

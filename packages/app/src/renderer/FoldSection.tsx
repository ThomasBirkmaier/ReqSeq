// A section that folds its lines away under a head (SR-032 AK3, shared with the list fold of SR-201):
// the head "▸ <label> (<count>)", with the triangle of the editor's fold toggle (SR-191), ▾ while open.
// It starts closed and is closed again whenever it is shown anew; a click on the head, or Enter, Space or
// Tab on it (SR-193 AK1) without a modifier, opens and closes it. The lines are rendered only while open.
// `FoldLine` folds under a head of any text (the rows of the Evidence section, SR-032 AK4).
// `FoldHead` is the head's content alone; the list of SR-201 (`ListView.tsx`) puts it into its cursor row.
import { useId, useState } from "react";

/** The head's content: the triangle, the label and the count, "▸ Older records (2)". */
export const FoldHead = ({
  label,
  count,
  open,
}: {
  readonly label: string;
  readonly count: number;
  readonly open: boolean;
}): React.JSX.Element => (
  <>
    <span className="fold-mark" aria-hidden="true">
      {open ? "▾" : "▸"}
    </span>{" "}
    {label} <span className="count">({String(count)})</span>
  </>
);

/** Whether `event` toggles a fold head: Enter, Space or Tab without a modifier. */
export const togglesFold = (
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
): boolean =>
  !event.ctrlKey &&
  !event.metaKey &&
  !event.altKey &&
  !event.shiftKey &&
  (event.key === "Enter" || event.key === " " || event.key === "Tab");

export const FoldSection = ({
  label,
  count,
  className,
  children,
}: {
  readonly label: string;
  readonly count: number;
  readonly className?: string;
  readonly children: React.ReactNode;
}): React.JSX.Element => {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={className}>
      <p
        className="fold-head"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setOpen((before) => !before);
        }}
        onKeyDown={(event) => {
          if (togglesFold(event)) {
            event.preventDefault();
            setOpen((before) => !before);
          }
        }}
      >
        <FoldHead label={label} count={count} open={open} />
      </p>
      <div id={id}>{open ? children : null}</div>
    </div>
  );
};

/**
 * A line that folds lines away under itself (SR-032 AK4): the triangle, then `head` as it is; closed at
 * first, toggled like `FoldSection`. `status` colours a failed or outdated head (D-062).
 */
export const FoldLine = ({
  head,
  status,
  className,
  children,
}: {
  readonly head: string;
  readonly status?: "failed" | "outdated" | undefined;
  readonly className?: string;
  readonly children: React.ReactNode;
}): React.JSX.Element => {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={className}>
      <p
        className="fold-head"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-controls={id}
        {...(status === undefined ? {} : { "data-status": status })}
        onClick={() => {
          setOpen((before) => !before);
        }}
        onKeyDown={(event) => {
          if (togglesFold(event)) {
            event.preventDefault();
            setOpen((before) => !before);
          }
        }}
      >
        <span className="fold-mark" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>{" "}
        {head}
      </p>
      <div id={id} className="fold-body">
        {open ? children : null}
      </div>
    </div>
  );
};

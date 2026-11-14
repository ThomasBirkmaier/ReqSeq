// The muted lines under the boxes of a requirement (D-062: only when they say something): where it is
// replaced or excluded (SR-046 AK2), its verification status per view as a row of badges, each the name on
// the left and the status with its details on the right, such as the missing children of an indirect
// verification (SR-047 AK3, SR-157, SR-034 AK2), and its validation status (SR-038 AK1); on the page of a
// variant, its hints since its newest baseline (SR-103 AK1, AK7), one line each. Layout only:
// `variant-lines.ts` builds them from the element buffer's last answer of `element.get`, so they ask
// nothing of their own and follow the element's reads. A variant or replacement is a link to its element.
import { useId, useMemo, useState } from "react";
import type { ElementGetOutput } from "@reqseq/core";
import type { ElementBuffer } from "./buffers.js";
import type { Badge, LinePart } from "./variant-lines.js";
import { variantLines } from "./variant-lines.js";

export interface VariantLinesProps {
  /** The answer of `element.get` the lines are built from. */
  readonly output: Pick<ElementGetOutput, "element" | "names">;
  readonly onOpenRelation: (target: ElementBuffer) => void;
}

/** A part of a line: its text, or a link that opens its element (Enter or a click). */
export const Part = ({
  part,
  onOpen,
  className,
}: {
  readonly part: LinePart;
  readonly onOpen: (target: ElementBuffer) => void;
  /** Given, the part is a span of this class also as text (the half of a badge). */
  readonly className?: string;
}): React.JSX.Element => {
  if (!("open" in part)) {
    return className === undefined ? <>{part.text}</> : <span className={className}>{part.text}</span>;
  }
  const { open } = part;
  return (
    <span
      className={className}
      role="link"
      tabIndex={0}
      data-target-id={part.id}
      data-target-repository={open.repository}
      title={open.name}
      onClick={() => {
        onOpen(open);
      }}
      onKeyDown={(event) => {
        // Enter with Ctrl, Cmd or Alt is a shortcut of the window ("Follow reference" opens the focused target).
        if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          onOpen(open);
        }
      }}
    >
      {part.text}
    </span>
  );
};

/**
 * A muted line of `parts`. With `whole` (the whole reason the line cuts, #862) it is shown on demand
 * (D-062): on hover as its title, and by a click, Enter, Space or Tab (SR-193), which open and close the whole reason
 * under the line; a link in the line opens its element as before.
 */
export const CutLine = ({
  parts,
  label,
  whole,
  className = "variant-line",
  onOpen,
}: {
  readonly parts: readonly LinePart[];
  readonly label: string;
  readonly whole?: string | undefined;
  readonly className?: string;
  readonly onOpen: (target: ElementBuffer) => void;
}): React.JSX.Element => {
  const [open, setOpen] = useState(false);
  const id = useId();
  const toggle =
    whole === undefined
      ? {}
      : {
          tabIndex: 0,
          // The title only while the reason is closed: open, a tooltip would cover it.
          ...(open ? {} : { title: whole }),
          "aria-expanded": open,
          "aria-controls": id,
          onClick: (event: React.MouseEvent<HTMLElement>) => {
            // A link opens its element; a click in the open reason or marking text keeps it open.
            const inside =
              event.target instanceof Element &&
              event.target.closest('[role="link"], .whole-reason') !== null;
            if (!inside && (window.getSelection()?.toString() ?? "") === "") {
              setOpen((before) => !before);
            }
          },
          onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
            // Enter or Space alone: with a modifier the key stays the app's (Ctrl+Space, Ctrl/Cmd+Enter).
            const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
            // Tab too: it toggles on the line that opens (SR-193 AK1); Shift+Tab still goes to the field before.
            if (
              plain &&
              event.target === event.currentTarget &&
              (event.key === "Enter" || event.key === " " || event.key === "Tab")
            ) {
              event.preventDefault();
              setOpen((before) => !before);
            }
          },
        };
  return (
    <p className={className} role="group" aria-label={label} {...toggle}>
      {parts.map((part, at) => (
        <Part key={at} part={part} onOpen={onOpen} />
      ))}
      {open && whole !== undefined ? (
        <span id={id} className="whole-reason">
          {whole}
        </span>
      ) : null}
    </p>
  );
};

/**
 * The verification status as badges (SR-157 AK1): a pill per view, its left half the name (a variant's a
 * link to it, AK5), its right half the status with its details; `data-status` gives the right half its
 * colour, which only failed and outdated have (AK3). A hidden ": " between the halves lets a screen reader say
 * "Core: verified".
 */
export const Badges = ({
  badges,
  onOpen,
}: {
  readonly badges: readonly Badge[];
  readonly onOpen: (target: ElementBuffer) => void;
}): React.JSX.Element => (
  <p className="variant-line badges" role="group" aria-label="Verification">
    {badges.map((badge, at) => (
      <span key={at} className="badge" data-status={badge.status}>
        <Part part={badge.name} className="badge-name" onOpen={onOpen} />
        <span className="badge-separator">: </span>
        <span className="badge-status">
          {badge.parts.map((part, index) => (
            <Part key={index} part={part} onOpen={onOpen} />
          ))}
        </span>
      </span>
    ))}
  </p>
);

export const VariantLines = ({ output, onOpenRelation }: VariantLinesProps): React.JSX.Element => {
  const lines = useMemo(() => variantLines(output), [output]);
  return (
    <>
      {lines.use === undefined ? null : (
        <CutLine parts={lines.use} label="Replaced or excluded" onOpen={onOpenRelation} />
      )}
      {lines.verification === undefined ? null : (
        <Badges badges={lines.verification} onOpen={onOpenRelation} />
      )}
      {lines.validation === undefined ? null : (
        <CutLine
          parts={lines.validation}
          label="Validation"
          whole={lines.validationTitle}
          onOpen={onOpenRelation}
        />
      )}
      {lines.sinceBaseline.map((hint) => (
        <p
          key={hint.message}
          className="variant-line since-baseline"
          role="group"
          aria-label={
            hint.kind === "new" ? "New since the newest baseline" : "Changed since the newest baseline"
          }
        >
          {hint.message}
        </p>
      ))}
    </>
  );
};

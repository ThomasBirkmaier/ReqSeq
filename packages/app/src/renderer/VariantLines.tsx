// The muted lines under the boxes of a requirement (D-062: only when they say something): where it is
// replaced or excluded (SR-046 AK2) and its verification status per view (SR-047 AK3); on the page of a
// variant, its hints since its newest baseline (SR-103 AK1, AK7), one line each. Layout only:
// `variant-lines.ts` builds them from the element buffer's last answer of `element.get`, so they ask
// nothing of their own and follow the element's reads. A variant or replacement is a link to its element.
import { useMemo } from "react";
import type { ElementGetOutput } from "@reqseq/core";
import type { ElementBuffer } from "./buffers.js";
import type { LinePart } from "./variant-lines.js";
import { variantLines } from "./variant-lines.js";

export interface VariantLinesProps {
  /** The answer of `element.get` the lines are built from. */
  readonly output: Pick<ElementGetOutput, "element" | "names">;
  readonly onOpenRelation: (target: ElementBuffer) => void;
}

const Part = ({
  part,
  onOpen,
}: {
  readonly part: LinePart;
  readonly onOpen: (target: ElementBuffer) => void;
}): React.JSX.Element => {
  if (!("open" in part)) {
    return <>{part.text}</>;
  }
  const { open } = part;
  return (
    <span
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

const Line = ({
  parts,
  label,
  onOpen,
}: {
  readonly parts: readonly LinePart[] | undefined;
  readonly label: string;
  readonly onOpen: (target: ElementBuffer) => void;
}): React.JSX.Element | null =>
  parts === undefined ? null : (
    <p className="variant-line" role="group" aria-label={label}>
      {parts.map((part, at) => (
        <Part key={at} part={part} onOpen={onOpen} />
      ))}
    </p>
  );

export const VariantLines = ({ output, onOpenRelation }: VariantLinesProps): React.JSX.Element => {
  const lines = useMemo(() => variantLines(output), [output]);
  return (
    <>
      <Line parts={lines.use} label="Replaced or excluded" onOpen={onOpenRelation} />
      <Line parts={lines.verification} label="Verification" onOpen={onOpenRelation} />
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

// The line under the title of a package page (SR-112 AK3, AK4): its coverage and verification degree, muted,
// without colour (D-062). Layout only: `askPackageSummary` asks core, which counts and formats. It is asked
// again when the workspace changed and keeps what it shows meanwhile, so the text does not jump with every
// save; an older answer is dropped. Until the first answer, and for a package without requirements, the
// line is hidden. A click on the line, or Enter on it, opens the requirements behind its numbers (SR-036
// AK2): the coverage answer it was counted from, in a result buffer. A list of its own shows the same line
// for the elements it shows (`SummaryLine` with its selection).
import type { EvidenceCoverageOutput } from "@reqseq/core";
import { useEffect, useState } from "react";
import type { ResultBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import type { SummarySelection } from "./package-page.js";
import { askSummary, selectionCoverageBuffer } from "./package-page.js";

export interface PackageSummaryProps {
  readonly call: Call;
  /** The UUID of the package. */
  readonly id: string;
  /** The name of the package buffer, for the name of the coverage buffer. */
  readonly name: string;
  /** Counts up when the workspace changed. */
  readonly revision: number;
  readonly onEcho: (message: string) => void;
  readonly onOpenResult: (buffer: ResultBuffer) => void;
}

export const PackageSummaryLine = ({ id, ...props }: PackageSummaryProps): React.JSX.Element | null => (
  <SummaryLine selection={{ package: id }} {...props} />
);

export type SummaryLineProps = Omit<PackageSummaryProps, "id"> & {
  /** What the line counts: a package, or the selection of a list. */
  readonly selection: SummarySelection;
};

export const SummaryLine = ({
  call,
  selection,
  name,
  revision,
  onEcho,
  onOpenResult,
}: SummaryLineProps): React.JSX.Element | null => {
  // The selection by value: a new object of the same selection does not ask again.
  const key = JSON.stringify(selection);
  const [line, setLine] = useState<
    | {
        readonly text: string | undefined;
        readonly coverage: EvidenceCoverageOutput;
        /** The revision the answer was asked at: a buffer from an older answer asks core again. */
        readonly asked: number;
      }
    | undefined
  >(undefined);
  useEffect(() => {
    let current = true;
    const asked = revision;
    void askSummary(call, selection).then((summary) => {
      if (!current) {
        return;
      }
      if (summary.ok) {
        setLine({ text: summary.line, coverage: summary.coverage, asked });
      } else {
        onEcho(summary.message);
      }
    });
    return () => {
      current = false;
    };
  }, [call, key, revision]);
  if (line === undefined) {
    return null;
  }
  const open = (): void => {
    onOpenResult(selectionCoverageBuffer(selection, name, line.coverage, line.asked));
  };
  return (
    <p className="package-summary" hidden={line.text === undefined}>
      <span
        role="link"
        tabIndex={0}
        title="Show the requirements behind these numbers"
        onClick={open}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
            event.preventDefault();
            // In a list, Enter on the line must not also open its selected row.
            event.stopPropagation();
            open();
          }
        }}
      >
        {line.text}
      </span>
    </p>
  );
};

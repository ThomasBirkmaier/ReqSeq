// The line under the title of a package page (SR-112 AK3, AK4): its coverage and verification degree, muted,
// without colour (D-062). Layout only: `askPackageSummary` asks core, which counts and formats. It is asked
// again when the workspace changed and keeps what it shows meanwhile, so the text does not jump with every
// save; an older answer is dropped. Until the first answer, and for a package without requirements, the
// line is hidden. A click on the line, or Enter on it, opens the requirements behind its numbers (SR-036
// AK2): the coverage answer it was counted from, in a result buffer.
import type { EvidenceCoverageOutput } from "@reqseq/core";
import { useEffect, useState } from "react";
import type { ResultBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import { askPackageSummary, coverageBuffer } from "./package-page.js";

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

export const PackageSummaryLine = ({
  call,
  id,
  name,
  revision,
  onEcho,
  onOpenResult,
}: PackageSummaryProps): React.JSX.Element | null => {
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
    void askPackageSummary(call, id).then((summary) => {
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
  }, [call, id, revision]);
  if (line === undefined) {
    return null;
  }
  const open = (): void => {
    onOpenResult(coverageBuffer(id, name, line.coverage, line.asked));
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
            open();
          }
        }}
      >
        {line.text}
      </span>
    </p>
  );
};

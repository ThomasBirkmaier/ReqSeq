// The line under the title of a package page (SR-112 AK3, AK4): its coverage and verification degree, muted,
// without colour (D-062). Layout only: `askPackageSummary` asks core, which counts and formats. It is asked
// again when the workspace changed and keeps what it shows meanwhile, so the text does not jump with every
// save; an older answer is dropped. Until the first answer, and for a package without requirements, the
// line is hidden.
import { useEffect, useState } from "react";
import type { Call } from "./call.js";
import { askPackageSummary } from "./package-page.js";

export interface PackageSummaryProps {
  readonly call: Call;
  /** The UUID of the package. */
  readonly id: string;
  /** Counts up when the workspace changed. */
  readonly revision: number;
  readonly onEcho: (message: string) => void;
}

export const PackageSummaryLine = ({
  call,
  id,
  revision,
  onEcho,
}: PackageSummaryProps): React.JSX.Element | null => {
  const [line, setLine] = useState<{ readonly text: string | undefined } | undefined>(undefined);
  useEffect(() => {
    let current = true;
    void askPackageSummary(call, id).then((summary) => {
      if (!current) {
        return;
      }
      if (summary.ok) {
        setLine({ text: summary.line });
      } else {
        onEcho(summary.message);
      }
    });
    return () => {
      current = false;
    };
  }, [call, id, revision]);
  return line === undefined ? null : (
    <p className="package-summary" hidden={line.text === undefined}>
      {line.text}
    </p>
  );
};

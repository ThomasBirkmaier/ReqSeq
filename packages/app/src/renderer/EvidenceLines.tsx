// The evidence records of a requirement or need on its page (SR-032): a muted "Evidence" group under the
// status lines, one line per record of `evidence.list` (`evidence-lines.ts` lays them out), and nothing when
// the element has no record (D-062). The records are asked for when the page shows the element and again
// on each change of the workspace or from outside (`seen`), not after a save of the element's own input:
// a save writes no record. `evidence.list` names the element by its UUID alone (it takes no repository), so
// an element whose UUID a file in another repository shares (SR-088) shows no records. A failed read shows
// nothing; the CLI says why.
import { useEffect, useMemo, useState } from "react";
import type { ElementGetOutput, EvidenceListOutput } from "@reqseq/core";
import type { ElementBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import { evidenceLines } from "./evidence-lines.js";
import { Part } from "./VariantLines.js";

export interface EvidenceLinesProps {
  readonly call: Call;
  /** The element the records are of. */
  readonly buffer: Pick<ElementBuffer, "id">;
  /** Counts up on each change of the workspace and from outside: the records are asked for again. */
  readonly seen: number;
  /**
   * The element's answer of `element.get`: only a requirement or need (one with a verification or
   * validation status) is asked for its records; `names` names the variants of the records.
   */
  readonly output: Pick<ElementGetOutput, "element" | "names">;
  readonly onOpenRelation: (target: ElementBuffer) => void;
}

export const EvidenceLines = ({
  call,
  buffer,
  seen,
  output: { element, names },
  onOpenRelation,
}: EvidenceLinesProps): React.JSX.Element | null => {
  const [listed, setListed] = useState<Pick<EvidenceListOutput, "records">>();
  const asked = element.verification !== undefined || element.validation !== undefined;
  useEffect(() => {
    if (!asked) {
      setListed(undefined);
      return;
    }
    let current = true;
    void call("evidence.list", { ref: buffer.id }).then((answer) => {
      if (current) {
        setListed(answer.ok ? answer.output : undefined);
      }
    });
    return () => {
      current = false;
    };
  }, [call, buffer.id, seen, asked]);
  const lines = useMemo(() => (listed === undefined ? [] : evidenceLines(listed, names)), [listed, names]);
  if (lines.length === 0) {
    return null;
  }
  return (
    <div className="evidence-lines" role="group" aria-label="Evidence">
      <p className="variant-line">Evidence</p>
      {lines.map((parts, at) => (
        <p key={at} className="variant-line evidence-record" role="group" aria-label="Evidence record">
          {parts.map((part, index) => (
            <Part key={index} part={part} onOpen={onOpenRelation} />
          ))}
        </p>
      ))}
    </div>
  );
};

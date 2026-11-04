// The evidence records of a requirement or need on its page (SR-032): a muted "Evidence" group under the
// status lines, one line per record of `evidence.list` and one note per problem of its answer
// (`evidence-lines.ts` lays them out), and nothing when it has neither (D-062). The records are asked for
// when the page shows the element and again on each change of the workspace or from outside, but not for a
// change that is only this buffer's own saves of its input: each save of the element (`ownSaves` counts
// those that answered, before core's `written` comes) writes no record, and autosave saves every second. A
// failed read keeps the lines it had; the CLI says why. `evidence.list` names the element by its UUID
// alone (it takes no repository), so an element whose UUID a file in another repository shares (SR-088)
// shows no records (#821).
import { useEffect, useMemo, useRef, useState } from "react";
import type { ElementGetOutput, EvidenceListOutput } from "@reqseq/core";
import type { ElementBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import { evidenceLines, evidenceNotes, evidenceWholeReasons } from "./evidence-lines.js";
import { hasStatus } from "./variant-lines.js";
import { CutLine } from "./VariantLines.js";

export interface EvidenceLinesProps {
  readonly call: Call;
  /** The element the records are of. */
  readonly buffer: Pick<ElementBuffer, "id">;
  /** Counts up on each change of the workspace, a write of this window included. */
  readonly revision: number;
  /** Counts up on each change from outside. */
  readonly outside: number;
  /** How many saves of this buffer have answered so far. */
  readonly ownSaves: () => number;
  /**
   * The element's answer of `element.get`: only a requirement or need (one with a verification or
   * validation status) is asked for its records; `names` names the variants of the records.
   */
  readonly output: Pick<ElementGetOutput, "element" | "names">;
  readonly onOpenRelation: (target: ElementBuffer) => void;
}

type Listed = Pick<EvidenceListOutput, "records" | "problems" | "incomplete">;

/**
 * Counts up when the records are to be asked for again: a change from outside, or more changes of the
 * workspace than saves of this buffer since the last count.
 */
const useAsks = (revision: number, outside: number, ownSaves: () => number): number => {
  const [asks, setAsks] = useState(0);
  const last = useRef({ revision, outside, saves: ownSaves() });
  useEffect(() => {
    const before = last.current;
    const saves = ownSaves();
    last.current = { revision, outside, saves };
    if (outside !== before.outside || revision - before.revision > saves - before.saves) {
      setAsks((count) => count + 1);
    }
  }, [revision, outside]);
  return asks;
};

export const EvidenceLines = ({
  call,
  buffer,
  revision,
  outside,
  ownSaves,
  output: { element, names },
  onOpenRelation,
}: EvidenceLinesProps): React.JSX.Element | null => {
  const [listed, setListed] = useState<Listed>();
  const asked = hasStatus(element);
  const asks = useAsks(revision, outside, ownSaves);
  useEffect(() => {
    if (!asked) {
      setListed(undefined);
      return;
    }
    let current = true;
    void call("evidence.list", { ref: buffer.id }).then((answer) => {
      if (current && answer.ok) {
        setListed(answer.output);
      }
    });
    return () => {
      current = false;
    };
  }, [call, buffer.id, asks, asked]);
  const lines = useMemo(() => (listed === undefined ? [] : evidenceLines(listed, names)), [listed, names]);
  const wholes = useMemo(() => (listed === undefined ? [] : evidenceWholeReasons(listed)), [listed]);
  const notes = useMemo(() => (listed === undefined ? [] : evidenceNotes(listed)), [listed]);
  if (lines.length === 0 && notes.length === 0) {
    return null;
  }
  return (
    <div className="evidence-lines" role="group" aria-label="Evidence">
      <p className="variant-line">Evidence</p>
      {lines.map((parts, at) => (
        <CutLine
          key={at}
          className="variant-line evidence-record"
          parts={parts}
          label="Evidence record"
          whole={wholes[at]}
          onOpen={onOpenRelation}
        />
      ))}
      {notes.map((note, at) => (
        <p key={at} className="variant-line evidence-record" role="note">
          {note}
        </p>
      ))}
    </div>
  );
};

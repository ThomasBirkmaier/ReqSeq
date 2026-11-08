// The evidence records of a requirement or need on its page (SR-032): a muted "Evidence" group under the
// status lines, one line per record of `evidence.list` and one note per problem of its answer
// (`evidence-lines.ts` lays them out), and nothing when it has neither (D-062). The records are asked for
// when the page shows the element and again on each change of the workspace or from outside, but not for a
// change that is only this buffer's own saves of its input: each save of the element (`ownSaves` counts
// those that answered, before core's `written` comes) writes no record, and autosave saves every second. A
// failed read keeps the lines it had; the CLI says why. `evidence.list` names the element by its UUID and
// repository, so an element whose UUID a file in another repository shares (SR-088) shows its records too.
// Open stand only the records that bear the status (AK3, core's `bearing`); the others are in a folded
// section "Older records (<count>)" under them (`FoldSection`), closed whenever the page shows anew.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ElementGetOutput, EvidenceListOutput } from "@reqseq/core";
import type { ElementBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import type { EvidenceRow } from "./evidence-lines.js";
import { evidenceNotes, evidenceParts } from "./evidence-lines.js";
import { FoldSection } from "./FoldSection.js";
import { hasStatus } from "./variant-lines.js";
import { CutLine } from "./VariantLines.js";

export interface EvidenceLinesProps {
  readonly call: Call;
  /** The element the records are of. */
  readonly buffer: Pick<ElementBuffer, "id" | "repository">;
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

type Listed = Pick<EvidenceListOutput, "records" | "bearing" | "problems" | "incomplete">;

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
    void call("evidence.list", { ref: buffer.id, repository: buffer.repository }).then((answer) => {
      if (current && answer.ok) {
        setListed(answer.output);
      }
    });
    return () => {
      current = false;
    };
  }, [call, buffer.id, buffer.repository, asks, asked]);
  const parts = useMemo(
    () => (listed === undefined ? { open: [], folded: [] } : evidenceParts(listed, names)),
    [listed, names],
  );
  const notes = useMemo(() => (listed === undefined ? [] : evidenceNotes(listed)), [listed]);
  if (parts.open.length === 0 && parts.folded.length === 0 && notes.length === 0) {
    return null;
  }
  const line = (row: EvidenceRow): React.JSX.Element => (
    <CutLine
      key={row.key}
      className="variant-line evidence-record"
      parts={row.parts}
      label="Evidence record"
      whole={row.whole}
      onOpen={onOpenRelation}
    />
  );
  return (
    <div className="evidence-lines" role="group" aria-label="Evidence">
      <p className="variant-line">Evidence</p>
      {parts.open.map(line)}
      {parts.folded.length === 0 ? null : (
        <FoldSection className="evidence-older" label="Older records" count={parts.folded.length}>
          {parts.folded.map(line)}
        </FoldSection>
      )}
      {notes.map((note, at) => (
        <p key={at} className="variant-line evidence-record" role="note">
          {note}
        </p>
      ))}
    </div>
  );
};
